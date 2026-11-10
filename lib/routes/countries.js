const TG_LION_BASE_URL = "https://TG-Lion.net";
const { fetchServer2Countries } = require("../server2");
const { getDatabase } = require("../db");

/* ==========================================================================
   SPEED: in-memory country cache
   ==========================================================================
   Every page load used to call TG-Lion upstream, wait for the full country
   list and only then paint the grid — that single round-trip is most of the
   "the website is slow" feeling. Numbers/stock do not change second by second,
   so a successful answer is held in the warm serverless instance and reused for
   a short window (45s). Failures are never cached.
   ========================================================================== */

const CACHE_TTL_MS = 45 * 1000;
const cache = { at: 0, body: null };

function rememberCountries(body) {
  try {
    cache.body = body;
    cache.at = Date.now();
  } catch (e) {}
  return body;
}

function sendCountries(res, body, source) {
  res.setHeader(
    "Cache-Control",
    "public, max-age=20, s-maxage=45, stale-while-revalidate=120"
  );
  res.setHeader("X-Cache", source || "miss");
  return res.status(200).json(body);
}

async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Default: do not cache anything; sendCountries() flips this on success.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  // ---- cache hit (fresh enough) -------------------------------------------
  if (cache.body && Date.now() - cache.at < CACHE_TTL_MS) {
    return sendCountries(res, cache.body, "hit");
  }

  try {
    // Try Server 2 logic (website uses TG-Lion only)
    try {
      const db = await getDatabase();
      const { countries, activeApi, config, fallback } = await fetchServer2Countries(db);
      if (countries && countries.length) {
        const dict = {};
        for (const c of countries) {
          dict[c.code] = {
            name: c.name,
            code: c.code,
            code_Num: "",
            qty: c.qty,
            price: c.price
          };
        }
        return sendCountries(res, rememberCountries({
          success: true,
          countries: dict,
          total: Object.keys(dict).length,
          updatedAt: new Date().toISOString(),
          provider: activeApi,
          profit: config ? config.s2_profit : 0,
          fallback: Boolean(fallback)
        }), "miss");
      }
    } catch (e) {
      console.error("Server2 countries fallback:", e);
    }

    // Fallback: direct TG-Lion (original logic)
    const apiKey = process.env.TG_LION_API_KEY;
    const yourId = process.env.TG_LION_YOUR_ID;

    if (!apiKey || !yourId) {
      return res.status(500).json({
        success: false,
        message: "Number provider API configuration is missing."
      });
    }

    const url = new URL(TG_LION_BASE_URL);

    url.searchParams.set(
      "action",
      "available_countries"
    );

    url.searchParams.set(
      "apiKey",
      apiKey
    );

    url.searchParams.set(
      "YourID",
      yourId
    );

    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error(
        "TG-Lion invalid response:",
        text
      );

      return res.status(502).json({
        success: false,
        message: "Invalid response received from the number provider."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: "Provider request failed.",
        providerStatus: response.status
      });
    }

    if (
      !data ||
      data.status !== "ok" ||
      !data.countries
    ) {
      return res.status(502).json({
        success: false,
        message:
          data?.message ||
          "The number provider did not return available countries."
      });
    }

    const countries = {};

    for (
      const [countryCode, country]
      of Object.entries(data.countries)
    ) {

      if (!country || typeof country !== "object") {
        continue;
      }

      const code =
        String(
          country.code ||
          countryCode ||
          ""
        ).toUpperCase();

      const qty =
        Number(country.qty || 0);

      const price =
        Number(country.price || 0);

      countries[code] = {
        name:
          country.name || code,

        code: code,

        code_Num:
          country.code_Num ||
          "",

        qty:
          Number.isFinite(qty)
            ? qty
            : 0,

        price:
          Number.isFinite(price)
            ? price
            : 0
      };
    }

    return sendCountries(res, rememberCountries({
      success: true,
      countries: countries,
      total: Object.keys(countries).length,
      updatedAt: new Date().toISOString()
    }), "miss");

  } catch (error) {

    console.error(
      "Countries API error faah:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Could not fetch countries from the number provider."
    });
  }
};
