const TG_LION_BASE_URL = "https://TG-Lion.net";

// Keep same ISO map as bot.py (partial but covers most)
const ISO_COUNTRY_MAP = {
  "AF": "Afghanistan 🇦🇫","AX": "Åland Islands 🇦🇽","AL": "Albania 🇦🇱","DZ": "Algeria 🇩🇿","AS": "American Samoa 🇦🇸","AD": "Andorra 🇦🇩","AO": "Angola 🇦🇴","AI": "Anguilla 🇦🇮","AQ": "Antarctica 🇦🇶","AG": "Antigua & Barbuda 🇦🇬","AR": "Argentina 🇦🇷","AM": "Armenia 🇦🇲","AW": "Aruba 🇦🇼","AU": "Australia 🇦🇺","AT": "Austria 🇦🇹","AZ": "Azerbaijan 🇦🇿","BS": "Bahamas 🇧🇸","BH": "Bahrain 🇧🇭","BD": "Bangladesh 🇧🇩","BB": "Barbados 🇧🇧","BY": "Belarus 🇧🇾","BE": "Belgium 🇧🇪","BZ": "Belize 🇧🇿","BJ": "Benin 🇧🇯","BM": "Bermuda 🇧🇲","BT": "Bhutan 🇧🇹","BO": "Bolivia 🇧🇴","BQ": "Caribbean Netherlands 🇧🇶","BA": "Bosnia & Herzegovina 🇧🇦","BW": "Botswana 🇧🇼","BV": "Bouvet Island 🇧🇻","BR": "Brazil 🇧🇷","IO": "British Indian Ocean Territory 🇮🇴","VG": "British Virgin Islands 🇻🇬","BN": "Brunei 🇧🇳","BG": "Bulgaria 🇧🇬","BF": "Burkina Faso 🇧🇫","BI": "Burundi 🇧🇮","CV": "Cabo Verde 🇨🇻","KH": "Cambodia 🇰🇭","CM": "Cameroon 🇨🇲","CA": "Canada 🇨🇦","KY": "Cayman Islands 🇰🇾","CF": "Central African Republic 🇨🇫","TD": "Chad 🇹🇩","CL": "Chile 🇨🇱","CN": "China 🇨🇳","CX": "Christmas Island 🇨🇽","CC": "Cocos (Keeling) Islands 🇨🇨","CO": "Colombia 🇨🇴","KM": "Comoros 🇰🇲","CD": "Congo (DRC) 🇨🇩","CG": "Congo (Republic) 🇨🇬","CK": "Cook Islands 🇨🇰","CR": "Costa Rica 🇨🇷","HR": "Croatia 🇭🇷","CU": "Cuba 🇨🇺","CW": "Curaçao 🇨🇼","CY": "Cyprus 🇨🇾","CZ": "Czechia 🇨🇿","CI": "Côte d'Ivoire 🇨🇮","DK": "Denmark 🇩🇰","DJ": "Djibouti 🇩🇯","DM": "Dominica 🇩🇲","DO": "Dominican Republic 🇩🇴","EC": "Ecuador 🇪🇨","EG": "Egypt 🇪🇬","SV": "El Salvador 🇸🇻","GQ": "Equatorial Guinea 🇬🇶","ER": "Eritrea 🇪🇷","EE": "Estonia 🇪🇪","SZ": "Eswatini 🇸🇿","ET": "Ethiopia 🇪🇹","FK": "Falkland Islands 🇫🇰","FO": "Faroe Islands 🇫🇴","FJ": "Fiji 🇫🇯","FI": "Finland 🇫🇮","FR": "France 🇫🇷","GF": "French Guiana 🇬🇫","PF": "French Polynesia 🇵🇫","TF": "French Southern Territories 🇹🇫","GA": "Gabon 🇬🇦","GM": "Gambia 🇬🇲","GE": "Georgia 🇬🇪","DE": "Germany 🇩🇪","GH": "Ghana 🇬🇭","GI": "Gibraltar 🇬🇮","GR": "Greece 🇬🇷","GL": "Greenland 🇬🇱","GD": "Grenada 🇬🇩","GP": "Guadeloupe 🇬🇵","GU": "Guam 🇬🇺","GT": "Guatemala 🇬🇹","GG": "Guernsey 🇬🇬","GN": "Guinea 🇬🇳","GW": "Guinea-Bissau 🇬🇼","GY": "Guyana 🇬🇾","HT": "Haiti 🇭🇹","HM": "Heard & McDonald Islands 🇭🇲","VA": "Vatican City 🇻🇦","HN": "Honduras 🇭🇳","HK": "Hong Kong 🇭🇰","HU": "Hungary 🇭🇺","IS": "Iceland 🇮🇸","IN": "India 🇮🇳","ID": "Indonesia 🇮🇩","IR": "Iran 🇮🇷","IQ": "Iraq 🇮🇶","IE": "Ireland 🇮🇪","IM": "Isle of Man 🇮🇲","IL": "Israel 🇮🇱","IT": "Italy 🇮🇹","JM": "Jamaica 🇯🇲","JP": "Japan 🇯🇵","JE": "Jersey 🇯🇪","JO": "Jordan 🇯🇴","KZ": "Kazakhstan 🇰🇿","KE": "Kenya 🇰🇪","KI": "Kiribati 🇰🇮","KP": "North Korea 🇰🇵","KR": "South Korea 🇰🇷","KW": "Kuwait 🇰🇼","KG": "Kyrgyzstan 🇰🇬","LA": "Laos 🇱🇦","LV": "Latvia 🇱🇻","LB": "Lebanon 🇱🇧","LS": "Lesotho 🇱🇸","LR": "Liberia 🇱🇷","LY": "Libya 🇱🇾","LI": "Liechtenstein 🇱🇮","LT": "Lithuania 🇱🇹","LU": "Luxembourg 🇱🇺","MO": "Macau 🇲🇴","MG": "Madagascar 🇲🇬","MW": "Malawi 🇲🇼","MY": "Malaysia 🇲🇾","MV": "Maldives 🇲🇻","ML": "Mali 🇲🇱","MT": "Malta 🇲🇹","MH": "Marshall Islands 🇲🇭","MQ": "Martinique 🇲🇶","MR": "Mauritania 🇲🇷","MU": "Mauritius 🇲🇺","YT": "Mayotte 🇾🇹","MX": "Mexico 🇲🇽","FM": "Micronesia 🇫🇲","MD": "Moldova 🇲🇩","MC": "Monaco 🇲🇨","MN": "Mongolia 🇲🇳","ME": "Montenegro 🇲🇪","MS": "Montserrat 🇲🇸","MA": "Morocco 🇲🇦","MZ": "Mozambique 🇲🇿","MM": "Myanmar 🇲🇲","NA": "Namibia 🇳🇦","NR": "Nauru 🇳🇷","NP": "Nepal 🇳🇵","NL": "Netherlands 🇳🇱","NC": "New Caledonia 🇳🇨","NZ": "New Zealand 🇳🇿","NI": "Nicaragua 🇳🇮","NE": "Niger 🇳🇪","NG": "Nigeria 🇳🇬","NU": "Niue 🇳🇺","NF": "Norfolk Island 🇳🇫","MK": "North Macedonia 🇲🇰","MP": "Northern Mariana Islands 🇲🇵","NO": "Norway 🇳🇴","OM": "Oman 🇴🇲","PK": "Pakistan 🇵🇰","PW": "Palau 🇵🇼","PS": "Palestine 🇵🇸","PA": "Panama 🇵🇦","PG": "Papua New Guinea 🇵🇬","PY": "Paraguay 🇵🇾","PE": "Peru 🇵🇪","PH": "Philippines 🇵🇭","PN": "Pitcairn Islands 🇵🇳","PL": "Poland 🇵🇱","PT": "Portugal 🇵🇹","PR": "Puerto Rico 🇵🇷","QA": "Qatar 🇶🇦","RE": "Réunion 🇷🇪","RO": "Romania 🇷🇴","RU": "Russia 🇷🇺","RW": "Rwanda 🇷🇼","BL": "St. Barthélemy 🇧🇱","SH": "St. Helena 🇸🇭","KN": "St. Kitts & Nevis 🇰🇳","LC": "St. Lucia 🇱🇨","MF": "St. Martin 🇲🇫","PM": "St. Pierre & Miquelon 🇵🇲","VC": "St. Vincent & Grenadines 🇻🇨","WS": "Samoa 🇼🇸","SM": "San Marino 🇸🇲","ST": "Sao Tome & Principe 🇸🇹","SA": "Saudi Arabia 🇸🇦","SN": "Senegal 🇸🇳","RS": "Serbia 🇷🇸","SC": "Seychelles 🇸🇨","SL": "Sierra Leone 🇸🇱","SG": "Singapore 🇸🇬","SX": "Sint Maarten 🇸🇽","SK": "Slovakia 🇸🇰","SI": "Slovenia 🇸🇮","SB": "Solomon Islands 🇸🇧","SO": "Somalia 🇸🇴","ZA": "South Africa 🇿🇦","GS": "South Georgia 🇬🇸","SS": "South Sudan 🇸🇸","ES": "Spain 🇪🇸","LK": "Sri Lanka 🇱🇰","SD": "Sudan 🇸🇩","SR": "Suriname 🇸🇷","SJ": "Svalbard & Jan Mayen 🇸🇯","SE": "Sweden 🇸🇪","CH": "Switzerland 🇨🇭","SY": "Syria 🇸🇾","TW": "Taiwan 🇹🇼","TJ": "Tajikistan 🇹🇯","TZ": "Tanzania 🇹🇿","TH": "Thailand 🇹🇭","TL": "Timor-Leste 🇹🇱","TG": "Togo 🇹🇬","TK": "Tokelau 🇹🇰","TO": "Tonga 🇹🇴","TT": "Trinidad & Tobago 🇹🇹","TN": "Tunisia 🇹🇳","TR": "Türkiye 🇹🇷","TM": "Turkmenistan 🇹🇲","TC": "Turks & Caicos Islands 🇹🇨","TV": "Tuvalu 🇹🇻","UG": "Uganda 🇺🇬","UA": "Ukraine 🇺🇦","AE": "UAE 🇦🇪","GB": "UK 🇬🇧","US": "USA 🇺🇸","UM": "U.S. Outlying Islands 🇺🇲","UY": "Uruguay 🇺🇾","UZ": "Uzbekistan 🇺🇿","VU": "Vanuatu 🇻🇺","VE": "Venezuela 🇻🇪","VN": "Vietnam 🇻🇳","VI": "U.S. Virgin Islands 🇻🇮","WF": "Wallis & Futuna 🇼🇫","EH": "Western Sahara 🇪🇭","YE": "Yemen 🇾🇪","ZM": "Zambia 🇿🇲","ZW": "Zimbabwe 🇿🇼"
};

function getCountryDisplayName(code) {
  return ISO_COUNTRY_MAP[code.toUpperCase()] || `${code.toUpperCase()} 🏳️`;
}

async function getServerConfig(db) {
  try {
    const doc = await db.collection("settings").findOne({ _id: "server_config" });
    if (!doc) return { s1: "active", s2: "active", s3: "maintenance", s2_api: "tglion", s2_profit: 0 };
    // Website always uses TG-Lion only
    return {
      s1: doc.s1 || "active",
      s2: doc.s2 || "active",
      s3: doc.s3 || "maintenance",
      s2_api: "tglion",
      s2_profit: Number(doc.s2_profit || 0)
    };
  } catch {
    return { s1: "active", s2: "active", s3: "maintenance", s2_api: "tglion", s2_profit: 0 };
  }
}

function safeExtractFloat(val) {
  if (!val) return 0;
  const m = String(val).match(/[-+]?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : 0;
}

async function fetchServer2Countries(db) {
  const config = await getServerConfig(db);
  const profitMargin = Number(config.s2_profit || 0);
  const countries = await tryTgLion(profitMargin);
  return { countries: countries.sort((x, y) => x.price - y.price), activeApi: "tglion", config };
}

async function tryTgLion(profitMargin) {
  const apiKey = process.env.TG_LION_API_KEY;
  const yourId = process.env.TG_LION_YOUR_ID;
  if (!apiKey || !yourId) return [];
  try {
    const url = new URL(TG_LION_BASE_URL);
    url.searchParams.set("action", "available_countries");
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("YourID", yourId);
    const res = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return []; }
    if (!data || data.status !== "ok" || !data.countries) return [];
    const list = [];
    for (const c of Object.values(data.countries)) {
      try {
        const basePrice = parseFloat(String(c.price));
        const qty = parseInt(String(c.qty || 0), 10);
        if (!Number.isFinite(basePrice) || basePrice <= 0) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const finalUsd = basePrice + (basePrice * profitMargin / 100);
        list.push({
          code: String(c.code).toUpperCase(),
          name: c.name || getCountryDisplayName(c.code),
          price: finalUsd,
          qty: qty,
          rawPrice: basePrice
        });
      } catch {}
    }
    return list;
  } catch (e) {
    console.error("TG-Lion fetch error:", e);
    return [];
  }
}

async function checkS2ApiBalance() {
  // returns { ok: boolean, api: string, balance: string }
  const lionKey = process.env.TG_LION_API_KEY;
  const lionId = process.env.TG_LION_YOUR_ID;
  try {
    if (lionKey && lionId) {
      const url = new URL(TG_LION_BASE_URL);
      url.searchParams.set("action", "get_balance");
      url.searchParams.set("apiKey", lionKey);
      url.searchParams.set("YourID", lionId);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data && data.status === "ok") {
        const bal = safeExtractFloat(data.balance);
        return { ok: bal > 0.1, api: "tglion", balance: String(data.balance) };
      }
    }
  } catch {}
  return { ok: false, api: "tglion", balance: "0" };
}

module.exports = {
  ISO_COUNTRY_MAP,
  getCountryDisplayName,
  getServerConfig,
  fetchServer2Countries,
  checkS2ApiBalance
};
