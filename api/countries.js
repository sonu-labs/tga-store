const TG_LION_BASE_URL = "https://TG-Lion.net";

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
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

  try {
    const apiKey = process.env.TG_LION_API_KEY;
    const yourId = process.env.TG_LION_YOUR_ID;

    if (!apiKey || !yourId) {
      return res.status(500).json({
        success: false,
        message: "TG-Lion API configuration is missing."
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
        message: "Invalid response received from TG-Lion."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: "TG-Lion request failed.",
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
          "TG-Lion did not return available countries."
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

    return res.status(200).json({
      success: true,
      countries: countries,
      total: Object.keys(countries).length,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {

    console.error(
      "Countries API error faah:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Could not fetch countries from TG-Lion."
    });
  }
};
