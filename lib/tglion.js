const TG_LION_BASE_URL = "https://TG-Lion.net";

function getConfig() {
  const apiKey = process.env.TG_LION_API_KEY;
  const yourId = process.env.TG_LION_YOUR_ID;

  if (!apiKey || !yourId) {
    const error = new Error("TG-Lion API configuration is missing.");
    error.statusCode = 500;
    throw error;
  }

  return { apiKey, yourId };
}

function providerMessage(data, fallback) {
  return (
    data?.message ||
    data?.error ||
    data?.msg ||
    fallback
  );
}

async function tgLionRequest(params) {
  const { apiKey, yourId } = getConfig();
  const url = new URL(TG_LION_BASE_URL);

  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("YourID", yourId);

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error("TG-Lion invalid response:", text);

    const error = new Error("Invalid response received from TG-Lion.");
    error.statusCode = 502;
    throw error;
  }

  return { response, data, text };
}

function isOk(data) {
  if (!data || typeof data !== "object") {
    return false;
  }

  const status = String(data.status || "").toLowerCase();

  return status === "ok" || status === "success" || status === "";
}

function pickCountry(data, code) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return (
    data.countries?.[code] ||
    data.countries?.[code.toLowerCase()] ||
    data.countries?.[code.toUpperCase()] ||
    (data.code || data.price != null || data.qty != null ? data : null)
  );
}

async function getCountryInfo(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  const { data } = await tgLionRequest({
    action: "country_info",
    country_code: code.toLowerCase()
  });

  let country = pickCountry(data, code);

  if (!country) {
    const listed = await tgLionRequest({
      action: "available_countries"
    });

    country = pickCountry(listed.data, code);
  }

  if (!country || typeof country !== "object") {
    const error = new Error(
      providerMessage(data, "Country is not available right now.")
    );
    error.statusCode = 502;
    throw error;
  }

  const qty = Number(country.qty ?? country.quantity ?? country.stock ?? 0);
  const price = Number(country.price ?? country.cost ?? 0);

  return {
    name: country.name || code,
    code: String(country.code || code).toUpperCase(),
    qty: Number.isFinite(qty) ? Math.max(0, qty) : 0,
    price: Number.isFinite(price) ? Math.max(0, price) : 0
  };
}

async function getNumber(countryCode, maxPrice) {
  const { response, data } = await tgLionRequest({
    action: "getNumber",
    country_code: String(countryCode || "").trim().toLowerCase(),
    maxPrice: maxPrice
  });

  if (!response.ok || !isOk(data) || !(data.Number || data.number)) {
    const error = new Error(
      providerMessage(data, "Could not purchase a number for this country.")
    );
    error.statusCode = 502;
    throw error;
  }

  return {
    name: data.name || String(countryCode || "").toUpperCase(),
    Number: data.Number || data.number,
    price: Number(data.price || 0),
    new_balance: data.new_balance
  };
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

async function getCode(number) {
  const { response, data } = await tgLionRequest({
    action: "getCode",
    number: String(number || "").trim()
  });

  if (!response.ok || !isOk(data)) {
    const error = new Error(
      providerMessage(data, "OTP is not available yet. Try again in a moment.")
    );
    error.statusCode = 502;
    throw error;
  }

  // TG-Lion returns the code/password in different shapes depending on
  // response version: {"status":"ok","Number":"...","code":"18190","pass":"..."}.
  // Accept every common variant and always coerce to a string so the
  // website can display it reliably.
  const code = normalizeText(
    data.code ??
      data.otp ??
      data.sms ??
      data.sms_code ??
      data.Code ??
      data.OTP ??
      ""
  );

  const pass = normalizeText(
    data.pass ??
      data.password ??
      data.Pass ??
      data.Password ??
      data.otp2 ??
      ""
  );

  return {
    Number: data.Number || data.number || number,
    code,
    pass
  };
}

module.exports = {
  getCountryInfo,
  getNumber,
  getCode
};
