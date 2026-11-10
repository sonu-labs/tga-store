/* ==========================================================================
   TGA STORE — MAIN APP SCRIPT
   ==========================================================================
   Extracted from the inline <script> in index.html so the browser can cache it
   (repeat visits / every Mini App launch no longer re-download ~90 KB of JS
   with the HTML). It is a classic script loaded at the same position, so every
   function stays global and all inline on* handlers keep working.
   ========================================================================== */
/* ==================================================
   CONFIG
================================================== */

/*
  Balance is assumed to be stored in INR.

  Example:
  ₹4700 = $47 at ₹100/USD
*/

const INR_PER_USDT = 100;

/*
  Display selling price markup.
  20% = price × 1.20
*/
const SELLING_MARKUP = 1.20;

const LOGO_URL = "/assets/logo.png";
const PAY_ICONS = {
  upi: "/assets/upi.png",
  binance: "/assets/binance.png",
  crypto: "/assets/crypto.png"
};

function getSessionToken(){
  try{ return localStorage.getItem("tga_session") || ""; }catch(e){ return ""; }
}

function authHeaders(json){
  const headers = {};
  if(json) headers["Content-Type"] = "application/json";
  const token = getSessionToken();
  if(token) headers["Authorization"] = "Bearer " + token;
  return headers;
}

function saveSession(token, user){
  try{
    if(token) localStorage.setItem("tga_session", token);
    if(user){
      const uid = String(user.userId || user.telegramId || "");
      if(uid) localStorage.setItem("tga_user_id", uid);
      if(user.telegramId) localStorage.setItem("tga_telegram_id", String(user.telegramId));
      else if(uid) localStorage.setItem("tga_telegram_id", uid);
      if(user.username) localStorage.setItem("tga_username", user.username);
      if(user.photoUrl) localStorage.setItem("tga_photo", user.photoUrl);
      if(user.firstName) localStorage.setItem("tga_first_name", user.firstName);
      if(user.lastName) localStorage.setItem("tga_last_name", user.lastName);
    }
  }catch(e){}
}

function clearSession(){
  try{
    localStorage.removeItem("tga_session");
    localStorage.removeItem("tga_user_id");
    localStorage.removeItem("tga_telegram_id");
    localStorage.removeItem("tga_username");
    localStorage.removeItem("tga_photo");
    localStorage.removeItem("tga_first_name");
    localStorage.removeItem("tga_last_name");
    localStorage.removeItem("tga_login_source");
  }catch(e){}
}

function forceLogin(message){
  clearSession();
  currentUserId = null;
  currentTelegramId = null;
  dashboardData = null;
  currentOrders = [];
  selectedCountry = null;
  currentAccount = null;
  closeAllModals();
  const dash = document.getElementById("dashboardScreen");
  const login = document.getElementById("loginScreen");
  if(dash) dash.style.display = "none";
  if(login) login.style.display = "";
  if(message) showLoginError(message);
}

/*
  ---------------------------------------------------------------------------
  API CALLS THAT DO NOT LOG PEOPLE OUT BY ACCIDENT
  ---------------------------------------------------------------------------
  The old version treated the FIRST 401 as "the account is gone": it wiped
  localStorage and threw the user back to the login form. In practice a 401 can
  be a race (a Mini App sign-in creating a fresh session while an older request
  is still in flight) or a stale token from a previous visit — so now we try to
  recover first, and only sign the user out when the server rejects BOTH the
  request and a direct session probe.
*/
async function apiRequest(url, options){

  const opts = options || {};
  const hasBody = opts.body != null;
  const tokenAtSend = getSessionToken();

  opts.headers = Object.assign(authHeaders(hasBody), opts.headers || {});
  opts.cache = opts.cache || "no-store";

  let response = await fetch(url, opts);
  let result = {};
  try{ result = await response.json(); }catch(e){}

  if(response.status === 401 && result && result.auth === false){

    const recovered = await recoverSession(tokenAtSend);

    if(recovered){
      // Retry the very same call once, with the refreshed token.
      const retryOptions = Object.assign({}, opts, {
        headers: Object.assign(
          authHeaders(hasBody),
          (options && options.headers) || {}
        )
      });

      response = await fetch(url, retryOptions);
      result = {};
      try{ result = await response.json(); }catch(e){}

      if(!(response.status === 401 && result && result.auth === false)){
        return { response, result };
      }
    }

    expireSession(result.message || "Please sign in again.");
    const error = new Error(result.message || "Please sign in again.");
    error.auth = false;
    throw error;
  }

  return { response, result };
}

/*
  Give the session a second chance:
   1. a newer token already exists (Mini App sign-in finished mid-request),
   2. Telegram can mint a fresh session silently inside the Mini App,
   3. the session endpoint says the token is actually fine.
*/
let recoverSessionPromise = null;

function recoverSession(tokenAtSend){
  if(getSessionToken() && getSessionToken() !== tokenAtSend){
    return Promise.resolve(true);
  }
  if(recoverSessionPromise) return recoverSessionPromise;

  recoverSessionPromise = (async function(){
    try{
      for(let i = 0; i < 3; i++){
        await new Promise(function(r){ setTimeout(r, 220); });
        if(getSessionToken() && getSessionToken() !== tokenAtSend) return true;
      }

      if(window.__tgaInTelegram && typeof window.__tgaTelegramRetry === "function"){
        try{
          if(await window.__tgaTelegramRetry()) return true;
        }catch(e){}
      }

      return await probeSession();
    }catch(e){
      return false;
    }finally{
      recoverSessionPromise = null;
    }
  })();

  return recoverSessionPromise;
}

/* Small toast used for "reconnecting" / offline notices. */
function toast(message, type){
  try{
    let el = document.getElementById("tgaToast");
    if(!el){
      el = document.createElement("div");
      el.id = "tgaToast";
      el.className = "tga-toast";
      el.setAttribute("role","status");
      el.setAttribute("aria-live","polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = "tga-toast show" + (type ? " " + type : "");
    clearTimeout(el.__timer);
    el.__timer = setTimeout(function(){
      el.className = "tga-toast";
    }, 3200);
  }catch(e){}
}


/* ==================================================
   GLOBAL STATE
================================================== */

let currentUserId = null;
let currentTelegramId = null; // backward compat alias
let loginMethod = 'telegram';
let registerMethod = 'email';
let authTab = 'login';

let dashboardData = null;

let currentOrders = [];

let countriesData = {};

let selectedCountry = null;

let currentAccount = null;

let currentCurrency =
  localStorage.getItem("tga_currency") || "USD";


/* ==================================================
   COUNTRY MASTER MAPPING
   The emoji column is kept only for backwards compatibility of the tuple
   shape; every flag shown in the UI is an inline SVG (see /icons.js).
================================================== */

const COUNTRIES = [

  ["Afghanistan","🇦🇫","AF","+93"],
  ["Albania","🇦🇱","AL","+355"],
  ["Algeria","🇩🇿","DZ","+213"],
  ["Andorra","🇦🇩","AD","+376"],
  ["Angola","🇦🇴","AO","+244"],
  ["Antigua and Barbuda","🇦🇬","AG","+1"],
  ["Argentina","🇦🇷","AR","+54"],
  ["Armenia","🇦🇲","AM","+374"],
  ["Australia","🇦🇺","AU","+61"],
  ["Austria","🇦🇹","AT","+43"],
  ["Azerbaijan","🇦🇿","AZ","+994"],
  ["Bahamas","🇧🇸","BS","+1"],
  ["Bahrain","🇧🇭","BH","+973"],
  ["Bangladesh","🇧🇩","BD","+880"],
  ["Barbados","🇧🇧","BB","+1"],
  ["Belarus","🇧🇾","BY","+375"],
  ["Belgium","🇧🇪","BE","+32"],
  ["Belize","🇧🇿","BZ","+501"],
  ["Benin","🇧🇯","BJ","+229"],
  ["Bhutan","🇧🇹","BT","+975"],
  ["Bolivia","🇧🇴","BO","+591"],
  ["Bosnia and Herzegovina","🇧🇦","BA","+387"],
  ["Botswana","🇧🇼","BW","+267"],
  ["Brazil","🇧🇷","BR","+55"],
  ["Brunei","🇧🇳","BN","+673"],
  ["Bulgaria","🇧🇬","BG","+359"],
  ["Burkina Faso","🇧🇫","BF","+226"],
  ["Burundi","🇧🇮","BI","+257"],
  ["Cabo Verde","🇨🇻","CV","+238"],
  ["Cambodia","🇰🇭","KH","+855"],
  ["Cameroon","🇨🇲","CM","+237"],
  ["Canada","🇨🇦","CA","+1"],
  ["Central African Republic","🇨🇫","CF","+236"],
  ["Chad","🇹🇩","TD","+235"],
  ["Chile","🇨🇱","CL","+56"],
  ["China","🇨🇳","CN","+86"],
  ["Colombia","🇨🇴","CO","+57"],
  ["Comoros","🇰🇲","KM","+269"],
  ["Congo","🇨🇬","CG","+242"],
  ["Costa Rica","🇨🇷","CR","+506"],
  ["Croatia","🇭🇷","HR","+385"],
  ["Cuba","🇨🇺","CU","+53"],
  ["Cyprus","🇨🇾","CY","+357"],
  ["Czechia","🇨🇿","CZ","+420"],
  ["Denmark","🇩🇰","DK","+45"],
  ["Djibouti","🇩🇯","DJ","+253"],
  ["Dominica","🇩🇲","DM","+1"],
  ["Dominican Republic","🇩🇴","DO","+1"],
  ["Ecuador","🇪🇨","EC","+593"],
  ["Egypt","🇪🇬","EG","+20"],
  ["El Salvador","🇸🇻","SV","+503"],
  ["Equatorial Guinea","🇬🇶","GQ","+240"],
  ["Eritrea","🇪🇷","ER","+291"],
  ["Estonia","🇪🇪","EE","+372"],
  ["Eswatini","🇸🇿","SZ","+268"],
  ["Ethiopia","🇪🇹","ET","+251"],
  ["Fiji","🇫🇯","FJ","+679"],
  ["Finland","🇫🇮","FI","+358"],
  ["France","🇫🇷","FR","+33"],
  ["Gabon","🇬🇦","GA","+241"],
  ["Gambia","🇬🇲","GM","+220"],
  ["Georgia","🇬🇪","GE","+995"],
  ["Germany","🇩🇪","DE","+49"],
  ["Ghana","🇬🇭","GH","+233"],
  ["Greece","🇬🇷","GR","+30"],
  ["Grenada","🇬🇩","GD","+1"],
  ["Guatemala","🇬🇹","GT","+502"],
  ["Guinea","🇬🇳","GN","+224"],
  ["Guinea-Bissau","🇬🇼","GW","+245"],
  ["Guyana","🇬🇾","GY","+592"],
  ["Haiti","🇭🇹","HT","+509"],
  ["Honduras","🇭🇳","HN","+504"],
  ["Hungary","🇭🇺","HU","+36"],
  ["Iceland","🇮🇸","IS","+354"],
  ["India","🇮🇳","IN","+91"],
  ["Indonesia","🇮🇩","ID","+62"],
  ["Iran","🇮🇷","IR","+98"],
  ["Iraq","🇮🇶","IQ","+964"],
  ["Ireland","🇮🇪","IE","+353"],
  ["Israel","🇮🇱","IL","+972"],
  ["Italy","🇮🇹","IT","+39"],
  ["Jamaica","🇯🇲","JM","+1"],
  ["Japan","🇯🇵","JP","+81"],
  ["Jordan","🇯🇴","JO","+962"],
  ["Kazakhstan","🇰🇿","KZ","+7"],
  ["Kenya","🇰🇪","KE","+254"],
  ["Kiribati","🇰🇮","KI","+686"],
  ["Kuwait","🇰🇼","KW","+965"],
  ["Kyrgyzstan","🇰🇬","KG","+996"],
  ["Laos","🇱🇦","LA","+856"],
  ["Latvia","🇱🇻","LV","+371"],
  ["Lebanon","🇱🇧","LB","+961"],
  ["Lesotho","🇱🇸","LS","+266"],
  ["Liberia","🇱🇷","LR","+231"],
  ["Libya","🇱🇾","LY","+218"],
  ["Liechtenstein","🇱🇮","LI","+423"],
  ["Lithuania","🇱🇹","LT","+370"],
  ["Luxembourg","🇱🇺","LU","+352"],
  ["Madagascar","🇲🇬","MG","+261"],
  ["Malawi","🇲🇼","MW","+265"],
  ["Malaysia","🇲🇾","MY","+60"],
  ["Maldives","🇲🇻","MV","+960"],
  ["Mali","🇲🇱","ML","+223"],
  ["Malta","🇲🇹","MT","+356"],
  ["Marshall Islands","🇲🇭","MH","+692"],
  ["Mauritania","🇲🇷","MR","+222"],
  ["Mauritius","🇲🇺","MU","+230"],
  ["Mexico","🇲🇽","MX","+52"],
  ["Micronesia","🇫🇲","FM","+691"],
  ["Moldova","🇲🇩","MD","+373"],
  ["Monaco","🇲🇨","MC","+377"],
  ["Mongolia","🇲🇳","MN","+976"],
  ["Montenegro","🇲🇪","ME","+382"],
  ["Morocco","🇲🇦","MA","+212"],
  ["Mozambique","🇲🇿","MZ","+258"],
  ["Myanmar","🇲🇲","MM","+95"],
  ["Namibia","🇳🇦","NA","+264"],
  ["Nauru","🇳🇷","NR","+674"],
  ["Nepal","🇳🇵","NP","+977"],
  ["Netherlands","🇳🇱","NL","+31"],
  ["New Zealand","🇳🇿","NZ","+64"],
  ["Nicaragua","🇳🇮","NI","+505"],
  ["Niger","🇳🇪","NE","+227"],
  ["Nigeria","🇳🇬","NG","+234"],
  ["North Korea","🇰🇵","KP","+850"],
  ["North Macedonia","🇲🇰","MK","+389"],
  ["Norway","🇳🇴","NO","+47"],
  ["Oman","🇴🇲","OM","+968"],
  ["Pakistan","🇵🇰","PK","+92"],
  ["Palau","🇵🇼","PW","+680"],
  ["Palestine","🇵🇸","PS","+970"],
  ["Panama","🇵🇦","PA","+507"],
  ["Papua New Guinea","🇵🇬","PG","+675"],
  ["Paraguay","🇵🇾","PY","+595"],
  ["Peru","🇵🇪","PE","+51"],
  ["Philippines","🇵🇭","PH","+63"],
  ["Poland","🇵🇱","PL","+48"],
  ["Portugal","🇵🇹","PT","+351"],
  ["Qatar","🇶🇦","QA","+974"],
  ["Romania","🇷🇴","RO","+40"],
  ["Russia","🇷🇺","RU","+7"],
  ["Rwanda","🇷🇼","RW","+250"],
  ["Saint Kitts and Nevis","🇰🇳","KN","+1"],
  ["Saint Lucia","🇱🇨","LC","+1"],
  ["Saint Vincent and the Grenadines","🇻🇨","VC","+1"],
  ["Samoa","🇼🇸","WS","+685"],
  ["San Marino","🇸🇲","SM","+378"],
  ["Sao Tome and Principe","🇸🇹","ST","+239"],
  ["Saudi Arabia","🇸🇦","SA","+966"],
  ["Senegal","🇸🇳","SN","+221"],
  ["Serbia","🇷🇸","RS","+381"],
  ["Seychelles","🇸🇨","SC","+248"],
  ["Sierra Leone","🇸🇱","SL","+232"],
  ["Singapore","🇸🇬","SG","+65"],
  ["Slovakia","🇸🇰","SK","+421"],
  ["Slovenia","🇸🇮","SI","+386"],
  ["Solomon Islands","🇸🇧","SB","+677"],
  ["Somalia","🇸🇴","SO","+252"],
  ["South Africa","🇿🇦","ZA","+27"],
  ["South Korea","🇰🇷","KR","+82"],
  ["South Sudan","🇸🇸","SS","+211"],
  ["Spain","🇪🇸","ES","+34"],
  ["Sri Lanka","🇱🇰","LK","+94"],
  ["Sudan","🇸🇩","SD","+249"],
  ["Suriname","🇸🇷","SR","+597"],
  ["Sweden","🇸🇪","SE","+46"],
  ["Switzerland","🇨🇭","CH","+41"],
  ["Syria","🇸🇾","SY","+963"],
  ["Taiwan","🇹🇼","TW","+886"],
  ["Tajikistan","🇹🇯","TJ","+992"],
  ["Tanzania","🇹🇿","TZ","+255"],
  ["Thailand","🇹🇭","TH","+66"],
  ["Timor-Leste","🇹🇱","TL","+670"],
  ["Togo","🇹🇬","TG","+228"],
  ["Tonga","🇹🇴","TO","+676"],
  ["Trinidad and Tobago","🇹🇹","TT","+1"],
  ["Tunisia","🇹🇳","TN","+216"],
  ["Türkiye","🇹🇷","TR","+90"],
  ["Turkmenistan","🇹🇲","TM","+993"],
  ["Tuvalu","🇹🇻","TV","+688"],
  ["Uganda","🇺🇬","UG","+256"],
  ["Ukraine","🇺🇦","UA","+380"],
  ["United Arab Emirates","🇦🇪","AE","+971"],
  ["United Kingdom","🇬🇧","GB","+44"],
  ["United States","🇺🇸","US","+1"],
  ["Uruguay","🇺🇾","UY","+598"],
  ["Uzbekistan","🇺🇿","UZ","+998"],
  ["Vanuatu","🇻🇺","VU","+678"],
  ["Vatican City","🇻🇦","VA","+379"],
  ["Venezuela","🇻🇪","VE","+58"],
  ["Vietnam","🇻🇳","VN","+84"],
  ["Yemen","🇾🇪","YE","+967"],
  ["Zambia","🇿🇲","ZM","+260"],
  ["Zimbabwe","🇿🇼","ZW","+263"],
  ["Kosovo","🇽🇰","XK","+383"],
  ["Hong Kong","🇭🇰","HK","+852"],
  ["Macau","🇲🇴","MO","+853"],
  ["Puerto Rico","🇵🇷","PR","+1"],
  ["Curaçao","🇨🇼","CW","+599"],
  ["Aruba","🇦🇼","AW","+297"],
  ["Bermuda","🇧🇲","BM","+1"],
  ["Cayman Islands","🇰🇾","KY","+1"],
  ["Gibraltar","🇬🇮","GI","+350"],
  ["Isle of Man","🇮🇲","IM","+44"],
  ["Jersey","🇯🇪","JE","+44"],
  ["Guernsey","🇬🇬","GG","+44"],
  ["Faroe Islands","🇫🇴","FO","+298"],
  ["Greenland","🇬🇱","GL","+299"],
  ["New Caledonia","🇳🇨","NC","+687"],
  ["French Polynesia","🇵🇫","PF","+689"],
  ["Guam","🇬🇺","GU","+1"],
  ["Northern Mariana Islands","🇲🇵","MP","+1"],
  ["American Samoa","🇦🇸","AS","+1"],
  ["British Virgin Islands","🇻🇬","VG","+1"],
  ["US Virgin Islands","🇻🇮","VI","+1"],
  ["Martinique","🇲🇶","MQ","+596"],
  ["Reunion","🇷🇪","RE","+262"],
  ["Mayotte","🇾🇹","YT","+262"],
  ["Western Sahara","🇪🇭","EH","+212"],
  ["Åland Islands","🇦🇽","AX","+358"],
  ["Christmas Island","🇨🇽","CX","+61"],
  ["Cocos Islands","🇨🇨","CC","+61"],
  ["Falkland Islands","🇫🇰","FK","+500"],
  ["Montserrat","🇲🇸","MS","+1"],
  ["Saint Helena","🇸🇭","SH","+290"],
  ["Turks and Caicos Islands","🇹🇨","TC","+1"],
  ["Wallis and Futuna","🇼🇫","WF","+681"],
  ["Cook Islands","🇨🇰","CK","+682"],
  ["Niue","🇳🇺","NU","+683"],
  ["Tokelau","🇹🇰","TK","+690"],
  ["Saint Pierre and Miquelon","🇵🇲","PM","+508"],
  ["British Indian Ocean Territory","🇮🇴","IO","+246"],
  ["Pitcairn Islands","🇵🇳","PN","+64"],
  ["South Georgia","🇬🇸","GS","+500"],
  ["Antarctica","🇦🇶","AQ","+672"]
];


/* ==================================================
   LOGIN
================================================== */

function switchAuthTab(tab){
  authTab = tab;
  document.getElementById("loginFormArea").classList.toggle("hidden", tab!=="login");
  document.getElementById("registerFormArea").classList.toggle("hidden", tab!=="register");

  // Tab + method buttons are styled entirely by their .active class now.
  const tabLoginEl = document.getElementById("tabLogin");
  const tabRegisterEl = document.getElementById("tabRegister");
  if(tabLoginEl){
    tabLoginEl.classList.toggle("active", tab==="login");
    tabLoginEl.setAttribute("aria-selected", tab==="login" ? "true" : "false");
  }
  if(tabRegisterEl){
    tabRegisterEl.classList.toggle("active", tab==="register");
    tabRegisterEl.setAttribute("aria-selected", tab==="register" ? "true" : "false");
  }
  hideLoginError();
}


function setLoginMethod(m){
  loginMethod=m;
  document.getElementById("telegramLoginBox").classList.toggle("hidden", m!=="telegram");
  document.getElementById("emailLoginBox").classList.toggle("hidden", m!=="email");
  document.getElementById("phoneLoginBox").classList.toggle("hidden", m!=="phone");
  setActiveMethodButton(["lmTelegram","lmEmail","lmPhone"], m);

  // Move focus to the field the user is about to type in.
  const target = m==="email" ? "loginEmailInput" : m==="phone" ? "loginPhoneInput" : "telegramIdInput";
  const input = document.getElementById(target);
  if(input && !input.value) setTimeout(()=>input.focus({ preventScroll:true }), 60);
}


function setRegisterMethod(m){
  registerMethod=m;
  document.getElementById("regEmailBox").classList.toggle("hidden", m!=="email");
  document.getElementById("regPhoneBox").classList.toggle("hidden", m!=="phone");
  setActiveMethodButton(["rmEmail","rmPhone"], m);
}


function setActiveMethodButton(ids, method){
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const on = id.toLowerCase().includes(method);
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  });
}


/* Show / hide a password field (eye button inside the input). */
function togglePasswordVisibility(inputId, button){
  const input=document.getElementById(inputId);
  if(!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  if(button){
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    const use = button.querySelector("use");
    if(use) use.setAttribute("href", "/icons.svg#i-" + (show ? "eye-off" : "eye"));
  }
}


async function handleRegister(){
  const username=document.getElementById("regUsernameInput").value.trim();
  const email=document.getElementById("regEmailInput").value.trim();
  const phone=document.getElementById("regPhoneInput").value.trim();
  const password=document.getElementById("regPasswordInput").value;
  const btn=document.getElementById("registerBtn");
  hideLoginError();
  if(!username || username.length<2){ showLoginError("Enter username (min 2 chars)."); return; }
  if(registerMethod==="email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showLoginError("Enter valid email."); return; }
  if(registerMethod==="phone" && !/^\+\d{7,15}$/.test(phone.replace(/\s/g,""))){ showLoginError("Enter valid phone e.g. +919876543210"); return; }
  if(!password || password.length<6){ showLoginError("Password min 6 chars."); return; }
  btn.disabled=true; btn.textContent="Creating...";
  try{
    const body={ method: registerMethod, username, password };
    if(registerMethod==="email") body.email=email;
    else body.phone=phone;
    const { response, result } = await apiRequest("/api/account?action=register",{ method:"POST", body:JSON.stringify(body)});
    if(!response.ok || !result.success){ showLoginError(result.message||"Register failed."); return; }
    showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Registered", "Account created! Now login with your credentials.");
    switchAuthTab("login");
    if(registerMethod==="email") { setLoginMethod("email"); document.getElementById("loginEmailInput").value=email; }
    else { setLoginMethod("phone"); document.getElementById("loginPhoneInput").value=phone; }
  }catch(e){ showLoginError("Unable to connect."); } finally{ btn.disabled=false; btn.textContent="Create Account"; }
}
async function handleLogin(){

  let identifier="";
  if(loginMethod==="telegram") identifier=document.getElementById("telegramIdInput").value.trim();
  else if(loginMethod==="email") identifier=document.getElementById("loginEmailInput").value.trim();
  else if(loginMethod==="phone") identifier=document.getElementById("loginPhoneInput").value.trim();

  const password =
    document
      .getElementById("passwordInput")
      .value;

  const btn =
    document.getElementById("loginBtn");

  hideLoginError();

  if(!identifier){

    showLoginError(
      loginMethod==="telegram" ? "Enter Telegram ID." : loginMethod==="email" ? "Enter email." : "Enter phone."
    );

    return;
  }

  if(!password){

    showLoginError(
      "Enter your password."
    );

    return;
  }

  btn.disabled=true;
  btn.textContent="Logging in...";

  try{

    const { response, result } =
      await apiRequest("/api/login",{
        method:"POST",
        body:JSON.stringify({
          identifier,
          method: loginMethod,
          password
        })
      });

    if(result && result.maintenance){

      showMaintenance(
        result.message
      );

      return;
    }

    if(
      !response.ok ||
      !result.success
    ){

      showLoginError(
        result.message ||
        "Login failed."
      );

      return;
    }

    currentUserId = String(result.user.userId || result.user.telegramId);
    currentTelegramId = result.user.telegramId ? String(result.user.telegramId) : currentUserId;
    saveSession(result.token, result.user);

    showDashboard();

  }catch(error){

    console.error(
      "Login:",
      error
    );

    showLoginError(
      "Unable to connect to server."
    );

  }finally{

    btn.disabled=false;
    btn.textContent="Login Now";

  }
}


/* ==================================================
   DASHBOARD API
================================================== */

/*
  ---------------------------------------------------------------------------
  LOCAL CACHE (instant paint, then refresh in the background)
  ---------------------------------------------------------------------------
  Every repeat visit painted "$0.00 / 0 orders / Loading countries…" and waited
  for two network round-trips before showing what the user already had on the
  previous visit. A tiny localStorage snapshot fixes that: the last known
  dashboard + countries are rendered synchronously, then replaced by fresh
  server data as soon as it arrives (stale-while-revalidate).
*/
const TGA_CACHE = {
  dashboard: "tga_cache_dashboard_v1",
  countries: "tga_cache_countries_v1"
};

function readCache(key, maxAgeMs){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return null;
    if(parsed.at && maxAgeMs && Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.data || null;
  }catch(e){
    return null;
  }
}

function writeCache(key, data){
  try{
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data }));
  }catch(e){}
}

function clearDataCaches(){
  try{
    localStorage.removeItem(TGA_CACHE.dashboard);
    localStorage.removeItem(TGA_CACHE.countries);
  }catch(e){}
}

async function loadDashboardData(){

  // The bearer token is the real credential — the ids are only UI state.
  if(!getSessionToken() && !currentUserId && !currentTelegramId){
    return;
  }

  try{

    const { response, result } =
      await apiRequest(
        "/api/dashboard",
        { method:"GET" }
      );

    if(
      !response.ok ||
      !result.success
    ){

      throw new Error(
        result.message ||
        "Could not load dashboard."
      );
    }

    dashboardData=result;

    // Remember the payload for the next visit (max 30 min old).
    writeCache(TGA_CACHE.dashboard, result);

    applyDashboardData(result);

  }catch(error){

    console.error(
      "Dashboard:",
      error
    );

  }
}

/*
  Paint the dashboard from /api/dashboard (or from the local cache). Kept in one
  place so both paths render exactly the same thing.
*/
function applyDashboardData(result){

  if(!result) return;

  /*
    Merge what the API gave us with what was saved at sign-in time. The
    dashboard route returns the full profile (first/last name, photo), but
    for older sessions or partial payloads fall back to the values the
    login stored so the UI never regresses to "User" / an empty avatar.
  */
  const apiUser = result.user || {};
  const saved = (key) => { try { return localStorage.getItem(key) || ""; } catch(e){ return ""; } };

  // Keep the globals in sync (a session restored without tga_user_id still
  // becomes a fully identified user here).
  if(apiUser.userId) currentUserId = String(apiUser.userId);
  if(apiUser.telegramId){
    currentTelegramId = String(apiUser.telegramId);
    try{ localStorage.setItem("tga_telegram_id", currentTelegramId); }catch(e){}
  }

  const profile = Object.assign({}, apiUser, {
    firstName: apiUser.firstName || saved("tga_first_name") || null,
    lastName:  apiUser.lastName  || saved("tga_last_name")  || null,
    photoUrl:  apiUser.photoUrl  || saved("tga_photo")      || null,
    username:  apiUser.username  || saved("tga_username")   || null,
    telegramId: apiUser.telegramId || saved("tga_telegram_id") || null,
  });

  try {
    if(profile.photoUrl)  localStorage.setItem("tga_photo", profile.photoUrl);
    if(profile.firstName) localStorage.setItem("tga_first_name", profile.firstName);
    if(profile.lastName)  localStorage.setItem("tga_last_name", profile.lastName);
    if(profile.username)  localStorage.setItem("tga_username", profile.username);
    if(profile.telegramId) localStorage.setItem("tga_telegram_id", String(profile.telegramId));
  } catch(e) {}

  const displayName =
    [profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

  const nameEl = document.getElementById("welcomeName");
  if(nameEl){
    nameEl.textContent =
      displayName ||
      profile.username ||
      "User";
  }

  renderTelegramAccount(profile);

  const ordersEl = document.getElementById("totalOrders");
  if(ordersEl) ordersEl.textContent = result.totalOrders || 0;

  const rechargeEl = document.getElementById("totalRecharge");
  if(rechargeEl) rechargeEl.textContent = result.totalRecharge || 0;

  updateBalance();

  renderOrders(
    result.orders || []
  );
}

/* Synchronous first paint from the cache — no network, no flicker. */
function paintCachedDashboard(){
  const cached = readCache(TGA_CACHE.dashboard, 30 * 60 * 1000);
  if(!cached || !cached.user) return false;
  dashboardData = cached;
  try{ applyDashboardData(cached); }catch(e){}
  return true;
}


/* ==================================================
   CURRENCY
================================================== */

function changeCurrency(currency){

  if(
    !["USD","INR","USDT"]
      .includes(currency)
  ){
    currency="USD";
  }

  currentCurrency=currency;

  localStorage.setItem(
    "tga_currency",
    currency
  );

  updateBalance();

  renderAllCountries();

  updatePurchasePrice();

  if(dashboardData){
    renderOrders(dashboardData.orders || []);
  }
}


/*
  Balance stored in INR.

  INR -> USD:
  ₹4700 / 100 = $47

  INR -> USDT:
  ₹4700 / 100 = 47 USDT
*/

function formatMoney(inr){

  const amount =
    Number(inr || 0);

  if(!Number.isFinite(amount)){
    return "$0.00";
  }

  if(currentCurrency==="INR"){
    return "₹"+amount.toFixed(2);
  }

  if(currentCurrency==="USDT"){
    return (
      amount / INR_PER_USDT
    ).toFixed(2)+" USDT";
  }

  return (
    "$"+
    (amount / INR_PER_USDT)
      .toFixed(2)
  );
}


/*
  API price is treated as USD/USDT base price.

  20% markup:
  $0.45 × 1.20 = $0.54
*/

function getSellingPrice(price){

  const base =
    Number(price || 0);

  if(
    !Number.isFinite(base) ||
    base < 0
  ){
    return 0;
  }

  return base * SELLING_MARKUP;
}


function formatPrice(price){

  const base =
    Number(price || 0);

  const sellingPrice =
    getSellingPrice(base);

  if(
    !Number.isFinite(sellingPrice)
  ){
    return "$0.00";
  }

  if(currentCurrency==="INR"){

    return (
      "₹"+
      (
        sellingPrice *
        INR_PER_USDT
      ).toFixed(2)
    );
  }

  if(currentCurrency==="USDT"){

    return (
      sellingPrice.toFixed(2)+
      " USDT"
    );
  }

  return (
    "$"+
    sellingPrice.toFixed(2)
  );
}


/*
  Wallet and saved orders are INR.

  Live catalog prices from the number provider are USD
  (0.45, 0.80) and go through formatPrice.

  Old orders sometimes stored that USD value
  directly. Values under 20 are treated as USD
  and converted at ₹100 per $1. Larger values
  are already INR, so they must NOT be
  multiplied by 100 or marked up again.

  Example:
  80 INR -> ₹80.00
  0.80 USD -> ₹80.00
  never ₹8000 / ₹8400
*/
function getAmountInr(value){

  const amount =
    Number(value || 0);

  if(!Number.isFinite(amount) || amount <= 0){
    return 0;
  }

  if(amount < 20){
    return amount * INR_PER_USDT;
  }

  return amount;
}


function formatOrderMoney(value){
  return formatMoney(getAmountInr(value));
}


function updateBalance(){

  if(!dashboardData){
    return;
  }

  const balance =
    Number(
      dashboardData.user?.balance || 0
    );

  document.getElementById(
    "balanceValue"
  ).textContent =
    formatMoney(balance);

  /*
    Secondary value always shows
    another useful currency.
  */

  if(currentCurrency==="INR"){

    document.getElementById(
      "balanceSecondary"
    ).textContent =
      "$"+
      (balance / INR_PER_USDT)
        .toFixed(2);

  }else{

    document.getElementById(
      "balanceSecondary"
    ).textContent =
      "₹"+
      balance.toFixed(2);
  }

  document.getElementById(
    "rechargeBalance"
  ).textContent =
    formatMoney(balance);

  const selector =
    document.getElementById(
      "currencySelect"
    );

  if(selector){
    selector.value=
      currentCurrency;
  }
}


/* ==================================================
   COUNTRY API
================================================== */

async function loadCountries(force){

  /*
    Paint the previous visit's stock instantly, then refresh. The API itself is
    cached for ~45s on the server (and by the browser/CDN), so a normal reload
    costs one cheap request instead of a fresh provider round-trip.
  */
  if(!force && (!countriesData || !Object.keys(countriesData).length)){
    const cached = readCache(TGA_CACHE.countries, 60 * 60 * 1000);
    if(cached){
      countriesData = normalizeCountries(cached);
      renderAllCountries();
    }
  }

  try{

    const response =
      await fetch(
        "/api/countries",
        {
          method:"GET",
          headers:{
            "Accept":"application/json"
          }
        }
      );

    const result =
      await response.json();

    if(
      !response.ok ||
      !result.success
    ){

      throw new Error(
        result.message ||
        "Country API failed."
      );
    }

    countriesData =
      normalizeCountries(
        result.countries || {}
      );

    writeCache(TGA_CACHE.countries, result.countries || {});

  }catch(error){

    console.error(
      "Countries:",
      error
    );

    /*
      Keep old data if refresh fails.
      This prevents the UI from becoming
      completely empty because of a
      temporary API failure.
    */

    if(
      !countriesData ||
      Object.keys(countriesData).length===0
    ){
      countriesData={};
    }
  }

  renderAllCountries();
}


/* ==================================================
   NORMALIZE COUNTRY DATA
================================================== */

function normalizeCountries(data){

  const output={};

  if(
    !data ||
    typeof data!=="object"
  ){
    return output;
  }

  /*
    Expected normal structure:

    {
      "AF":{
        qty:478,
        price:0.45
      }
    }
  */

  Object.entries(data)
    .forEach(([key,value])=>{

      if(
        value === null ||
        value === undefined
      ){
        return;
      }

      const upperKey =
        String(key)
          .trim()
          .toUpperCase();

      /*
        If API directly returns an object
        for country code.
      */

      if(
        typeof value==="object" &&
        !Array.isArray(value)
      ){

        output[upperKey]=value;

        return;
      }

      /*
        If API returns a simple number,
        treat it as stock quantity.
      */

      if(
        typeof value==="number"
      ){

        output[upperKey]={
          qty:value,
          price:0
        };

      }

    });

  return output;
}


/* ==================================================
   COUNTRY HELPERS
================================================== */

function getCountry(code){

  const target =
    String(code || "")
      .toUpperCase();

  return COUNTRIES.find(
    country =>
      country[2].toUpperCase()===target
  );
}


function getCountryApiData(code){

  const key =
    String(code || "")
      .trim()
      .toUpperCase();

  return (
    countriesData[key] ||
    countriesData[
      String(code || "")
        .trim()
        .toLowerCase()
    ] ||
    null
  );
}


function getCountryQuantity(api){

  if(!api){
    return 0;
  }

  const possible =
    api.qty ??
    api.quantity ??
    api.stock ??
    api.available ??
    0;

  const qty =
    Number(possible);

  return Number.isFinite(qty)
    ? Math.max(0,qty)
    : 0;
}


function getCountryBasePrice(api){

  if(!api){
    return 0;
  }

  const possible =
    api.price ??
    api.cost ??
    api.amount ??
    0;

  const price =
    Number(possible);

  return Number.isFinite(price)
    ? Math.max(0,price)
    : 0;
}


/* Country name to ISO code: used by flagSvg() for API-provided names */
window.TGA_COUNTRY_ISO = window.TGA_COUNTRY_ISO || (function(){
  const map = {};
  try{
    COUNTRIES.forEach(c=>{
      if(!c || !c[2]) return;
      map[String(c[0]).toLowerCase()] = c[2];
    });
  }catch(e){}
  return map;
})();


/* ==================================================
   COUNTRY CARD
================================================== */

function countryCard(country){

  const name=country[0];
  const flag=country[1];
  const code=country[2];
  const dial=country[3];

  const api =
    getCountryApiData(code);

  const qty =
    getCountryQuantity(api);

  const basePrice =
    getCountryBasePrice(api);

  const available =
    Boolean(api) && qty>0;

  /*
    IMPORTANT:
    The displayed price includes 20%
    selling markup.
  */

  const displayPrice =
    getSellingPrice(basePrice);

  const purchaseData={
    name,
    flag,
    code,
    dial,
    qty,
    price:basePrice
  };

  return `
    <div class="country-card">

      <div class="country-flag">
        ${flagSvg(code)}
      </div>

      <div class="country-name">
        ${escapeHtml(name)}
      </div>

      <div class="country-code">
        ${escapeHtml(code)}
        ·
        ${escapeHtml(dial)}
      </div>

      <div class="country-price">

        ${
          available
            ? formatPrice(basePrice)
            : "Currently unavailable"
        }

      </div>

      <div class="${
        available
          ? "stock"
          : "stock out-stock"
      }">

        ${
          available
            ? qty.toLocaleString()+" in stock"
            : "Out of stock"
        }

      </div>

      <div class="quality">

        ${
          available
            ? "● Good Quality"
            : "● Unavailable"
        }

      </div>

      <button
        class="buy-now"
        type="button"
        ${
          available
            ? ""
            : "disabled"
        }
        onclick='openPurchase(${JSON.stringify(purchaseData).replace(/'/g,"&#39;")})'
      >
        Buy Now
      </button>

    </div>
  `;
}


/* ==================================================
   RENDER COUNTRIES
================================================== */

function getUniqueCountries(){

  const seen=new Set();

  return COUNTRIES.filter(country=>{

    const code =
      country[2].toUpperCase();

    if(seen.has(code)){
      return false;
    }

    seen.add(code);

    return true;
  });
}


const COUNTRY_CHUNK_SIZE = 24;
let countryRenderSeq = 0;
let countryObserver = null;

function renderAllCountries(){

  const uniqueCountries =
    getUniqueCountries();

  const grid =
    document.getElementById(
      "countriesGrid"
    );

  const homeGrid =
    document.getElementById(
      "homeCountries"
    );

  /*
    BUY PAGE:
    All mapped countries, rendered in lazy chunks — the first screenful is
    instant and the rest is appended as the user scrolls (IntersectionObserver).
  */

  if(grid){
    renderCountryListLazy(grid, uniqueCountries);
  }


  /*
    HOME PAGE:
    Show first 6 countries which
    actually exist in live API data.
  */

  const liveCountries =
    uniqueCountries
      .filter(country =>
        getCountryApiData(country[2])
      )
      .slice(0,6);

  const home =
    liveCountries
      .map(countryCard)
      .join("");

  if(homeGrid){

    homeGrid.innerHTML =
      home ||
      `
        <div class="loading">
          No live countries available.
        </div>
      `;
  }
}


/*
  Render a long country list in chunks. Keeps first paint fast on phones and
  stops the browser from building hundreds of SVG flags at once.
*/
function renderCountryListLazy(grid, list){

  if(!grid) return;

  const seq = ++countryRenderSeq;

  if(!list || !list.length){
    grid.innerHTML = `
      <div class="loading">
        No countries available.
      </div>
    `;
    return;
  }

  grid.innerHTML = "";
  let index = 0;

  const paintNext = function(){
    if(seq !== countryRenderSeq) return false;
    const slice = list.slice(index, index + COUNTRY_CHUNK_SIZE);
    index += slice.length;
    if(slice.length){
      grid.insertAdjacentHTML("beforeend", slice.map(countryCard).join(""));
    }
    return index < list.length;
  };

  let more = paintNext();
  if(!more) return;

  if(typeof IntersectionObserver !== "function"){
    while(paintNext()){}
    return;
  }

  const sentinel = document.createElement("div");
  sentinel.className = "lazy-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  grid.appendChild(sentinel);

  if(countryObserver){
    try{ countryObserver.disconnect(); }catch(e){}
  }

  countryObserver = new IntersectionObserver(function(entries){
    if(seq !== countryRenderSeq){
      try{ countryObserver.disconnect(); }catch(e){}
      return;
    }
    for(const entry of entries){
      if(!entry.isIntersecting) continue;
      const stillMore = paintNext();
      if(stillMore){
        grid.appendChild(sentinel);
      }else{
        sentinel.remove();
        try{ countryObserver.disconnect(); }catch(e){}
      }
    }
  }, { rootMargin: "700px 0px" });

  countryObserver.observe(sentinel);
}


/* ==================================================
   COUNTRY SEARCH
================================================== */

function filterCountries(){

  const input =
    document.getElementById(
      "countrySearch"
    );

  if(!input){
    return;
  }

  const query =
    input.value
      .trim()
      .toLowerCase();

  const countries =
    getUniqueCountries();

  if(!query){

    const grid = document.getElementById("countriesGrid");
    if(grid){
      countryRenderSeq += 1;
      grid.innerHTML = countries.map(countryCard).join("");
    }

    return;
  }

  const filtered =
    countries.filter(country=>{

      const name =
        String(country[0] || "")
          .toLowerCase();

      const code =
        String(country[2] || "")
          .toLowerCase();

      const dial =
        String(country[3] || "")
          .toLowerCase();

      return (
        name.includes(query) ||
        code.includes(query) ||
        dial.includes(query)
      );
    });

  const filteredGrid = document.getElementById("countriesGrid");
  if(filteredGrid){
    countryRenderSeq += 1;
    filteredGrid.innerHTML =
      filtered.length
        ? filtered.map(countryCard).join("")
        : `
          <div class="loading">
            No country found.
          </div>
        `;
  }
}


/* ==================================================
   PURCHASE
================================================== */

function openPurchase(country){

  if(!country){
    return;
  }

  selectedCountry=country;

  const priceEl =
    document.getElementById(
      "purchasePrice"
    );

  priceEl.innerHTML =
    'Price: <b>'+
    escapeHtml(formatPrice(country.price))+
    '</b> · '+flagSvg(country.code,'sm')+
    ' <span style="margin-left:6px">'+escapeHtml(stripEmoji(country.name))+'</span>';

  document.getElementById(
    "purchaseModal"
  ).classList.add("show");
}


function updatePurchasePrice(){

  if(!selectedCountry){
    return;
  }

  const priceEl =
    document.getElementById(
      "purchasePrice"
    );

  priceEl.innerHTML =
    'Price: <b>'+
    escapeHtml(formatPrice(selectedCountry.price))+
    '</b> · '+flagSvg(selectedCountry.code,'sm')+
    ' <span style="margin-left:6px">'+escapeHtml(stripEmoji(selectedCountry.name))+'</span>';
}


async function confirmPurchase(){

  if(!selectedCountry){
    return;
  }

  if(!currentUserId && !currentTelegramId){

    showMessage(
      "Login Required",
      "Please login again before purchasing."
    );

    return;
  }

  const button =
    document.getElementById(
      "confirmPurchaseButton"
    );

  button.disabled=true;
  button.textContent="Processing...";

  try{

    /*
      Backend:
      POST /api/buy

      {
        telegramId,
        country_code
      }

      Price is NOT sent from frontend.
      Backend should calculate/charge the
      real configured selling price.
    */

    const { response, result } =
      await apiRequest(
        "/api/buy",
        {
          method:"POST",
          body:JSON.stringify({
            country_code: selectedCountry.code
          })
        }
      );

    if(result && result.maintenance){

      showMaintenance(
        result.message
      );

      return;
    }

    if(
      !response.ok ||
      !result.success
    ){

      throw new Error(
        result.message ||
        "Purchase failed."
      );
    }

    currentAccount=result;

    closeModal(
      "purchaseModal"
    );

    showAccountResult(
      result
    );

    await loadDashboardData();

    /*
      Refresh stock after purchase.
    */

    await loadCountries();

  }catch(error){

    console.error(
      "Purchase:",
      error
    );

    showMessage(
      "Purchase Failed",
      error.message ||
      "Unable to complete purchase."
    );

  }finally{

    button.disabled=false;
    button.textContent="Accept";

  }
}


/* ==================================================
   ACCOUNT RESULT
================================================== */

function showAccountResult(result){

  const number =
    result.Number ||
    result.number ||
    "Not received";

  const name =
    result.name ||
    selectedCountry?.name ||
    "Unknown";

  const chargedInr =
    result.price != null
      ? getAmountInr(result.price)
      : getSellingPrice(selectedCountry?.price || 0) * INR_PER_USDT;

  currentAccount={
    ...result,
    Number:number
  };

  document.getElementById(
    "accountInfo"
  ).innerHTML=`

    <div class="info-row">

      <div class="info-label">
        Country
      </div>

      <div class="info-value">
        ${escapeHtml(name)}
      </div>

    </div>

    <div class="info-row">

      <div class="info-label">
        Number
      </div>

      <div class="info-value">
        ${escapeHtml(number)}
      </div>

    </div>

    <div class="info-row">

      <div class="info-label">
        Code
      </div>

      <div
        id="accountCode"
        class="info-value"
      >
        Not received
      </div>

    </div>

    <div class="info-row">

      <div class="info-label">
        Password
      </div>

      <div
        id="accountPassword"
        class="info-value"
      >
        Get OTP first
      </div>

    </div>

    <div class="info-row">

      <div class="info-label">
        Price
      </div>

      <div class="info-value">
        ${formatMoney(chargedInr)}
      </div>

    </div>
  `;

  document.getElementById(
    "successModal"
  ).classList.add("show");
}


/* ==================================================
   GET OTP
================================================== */

async function fetchOtp(number, orderId){

  const body={
    userId: currentUserId || currentTelegramId,
    number:number
  };

  if(orderId){
    body.orderId=orderId;
  }

  const { response, result } =
    await apiRequest(
      "/api/code",
      {
        method:"POST",
        body:JSON.stringify(body)
      }
    );

  if(!result){
    const err = new Error(
      "Could not read server response."
    );
    err.statusCode=response.status;
    throw err;
  }

  if(result && result.maintenance){

    showMaintenance(
      result.message
    );

    const err = new Error(
      result.message ||
      "Under maintenance."
    );

    err.statusCode=response.status;
    throw err;
  }

  if(
    !response.ok ||
    !result.success
  ){

    const err = new Error(
      result.message ||
      "OTP not received."
    );

    err.statusCode=response.status;
    throw err;
  }

  return {
    code: result.code || "",
    pass: result.pass || "",
    number: result.number || result.Number || number
  };
}


async function getOTP(){

  if(!currentAccount){
    return;
  }

  const number =
    currentAccount.Number ||
    currentAccount.number;

  if(!number){

    showMessage(
      "OTP",
      "Number not found."
    );

    return;
  }

  const button =
    document.getElementById(
      "getOtpButton"
    );

  if(button){
    button.disabled=true;
    button.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> Getting OTP…";
  }

  try{

    let result=null;
    let lastError=null;

    // The provider often needs a few seconds after purchase to deliver the SMS.
    // Retry a handful of times so the code appears as soon as it responds.
    for(let attempt=0; attempt<8; attempt++){

      try{

        result=await fetchOtp(number, null);
        break;

      }catch(error){

        lastError=error;

        if(error.statusCode!==409){
          throw error;
        }

        await new Promise(resolve=>setTimeout(resolve,2500));
      }
    }

    if(!result){
      throw lastError || new Error("OTP not received.");
    }

    const codeEl =
      document.getElementById(
        "accountCode"
      );

    const passwordEl =
      document.getElementById(
        "accountPassword"
      );

    if(codeEl){
      codeEl.textContent =
        result.code ||
        "Not received";
    }

    if(passwordEl){
      passwordEl.textContent =
        result.pass ||
        "Not received";
    }

    currentAccount={
      ...currentAccount,
      ...result,
      otp:result.code,
      pass:result.pass
    };

  }catch(error){

    console.error(
      "OTP:",
      error
    );

    showMessage(
      "OTP Failed",
      error.message ||
      "OTP could not be received."
    );

  }finally{

    if(button){
      button.disabled=false;
      button.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-inbox></use></svg> Get OTP";
    }

  }
}


/* ==================================================
   GET OTP FROM ORDER HISTORY
================================================== */

async function getOrderOTP(index){

  const order =
    currentOrders &&
    currentOrders[index];

  if(!order){
    return;
  }

  const number =
    order.number ||
    order.Number;

  if(!number){

    showMessage(
      "OTP",
      "Number not found for this order."
    );

    return;
  }

  const button =
    document.getElementById(
      "orderOtpBtn-"+index
    );

  const area =
    document.getElementById(
      "orderOtpArea-"+index
    );

  if(button){
    button.disabled=true;
    button.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> Getting OTP…";
  }

  if(area){
    area.innerHTML=
      '<span class="muted">Contacting provider…</span>';
  }

  try{

    const result =
      await fetchOtp(
        number,
        order._id || order.id || null
      );

    const otpEl =
      document.getElementById(
        "orderOtp-"+index
      );

    const passEl =
      document.getElementById(
        "orderPass-"+index
      );

    const statusEl =
      document.getElementById(
        "orderStatus-"+index
      );

    if(otpEl){
      otpEl.textContent =
        result.code ||
        "Not received";

      otpEl.classList.add(
        "code-val"
      );
    }

    if(passEl){
      passEl.textContent =
        result.pass ||
        "—";

      passEl.classList.add(
        "code-val"
      );
    }

    if(statusEl){
      statusEl.textContent="completed";
      statusEl.className=
        "status-pill status-completed";
    }

    if(area){
      area.innerHTML=
        '<span style="color:var(--green)"><svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> OTP received</span>';
    }

    // Keep the local order data in sync so re-renders show the OTP too.
    order.otp=result.code;
    order.pass=result.pass;
    order.status="completed";

  }catch(error){

    console.error(
      "Order OTP:",
      error
    );

    if(area){
      area.innerHTML=
        '<span style="color:var(--red)">'+
        escapeHtml(
          error.message ||
          "Could not get OTP."
        )+
        "</span>";
    }

  }finally{

    if(button){
      button.disabled=false;
      button.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-refresh></use></svg> Get OTP Again";
    }

  }
}


/* ==================================================
   ORDERS
================================================== */

function renderOrders(orders){

  const container =
    document.getElementById(
      "ordersList"
    );

  if(!container){
    return;
  }

  currentOrders =
    Array.isArray(orders)
      ? orders
      : [];

  if(!currentOrders.length){

    container.innerHTML=
      `
        <div class="loading">
          No orders yet.
        </div>
      `;

    return;
  }

  container.innerHTML =
    currentOrders.map((order,index)=>{

      const status =
        String(
          order.status ||
          "waiting"
        );

      const hasOtp =
        Boolean(
          order.otp &&
          String(order.otp).trim()
        );

      return `

        <div class="order-card">

          <div style="flex:1;min-width:0">

            <div class="order-country">
              <svg class=icon aria-hidden=true><use href=/icons.svg#i-globe></use></svg>
              ${escapeHtml(
                order.country ||
                "Unknown"
              )}
            </div>

            <div class="order-detail">

              <b>Number:</b>
              ${escapeHtml(
                order.number ||
                "N/A"
              )}

              <br>

              <b>OTP:</b>
              <span
                id="orderOtp-${index}"
                class="${hasOtp ? "code-val" : ""}"
              >
                ${escapeHtml(
                  order.otp ||
                  "Not received"
                )}
              </span>

              <br>

              <b>Password:</b>
              <span
                id="orderPass-${index}"
                class="${order.pass ? "code-val" : ""}"
              >
                ${escapeHtml(
                  order.pass ||
                  "—"
                )}
              </span>

              <br>

              <b>Date:</b>
              ${formatDate(
                order.created_at
              )}

            </div>

            <div
              id="orderOtpArea-${index}"
              class="order-otp"
            ></div>

            <button
              class="otp-btn"
              type="button"
              id="orderOtpBtn-${index}"
              onclick="getOrderOTP(${index})"
            >
              ${hasOtp ? "<svg class=icon aria-hidden=true><use href=/icons.svg#i-refresh></use></svg> Get OTP Again" : "<svg class=icon aria-hidden=true><use href=/icons.svg#i-inbox></use></svg> Get OTP"}
            </button>

          </div>

          <div class="order-right">

            <div class="order-price">
              ${formatOrderMoney(order.price || 0)}
            </div>

            <span
              id="orderStatus-${index}"
              class="
                status-pill
                ${getStatusClass(status)}
              "
            >
              ${escapeHtml(status)}
            </span>

          </div>

        </div>

      `;

    }).join("");
}


function getStatusClass(status){

  const value =
    String(status)
      .toLowerCase();

  if(
    value.includes("complet")
  ){
    return "status-completed";
  }

  if(
    value.includes("cancel")
  ){
    return "status-cancelled";
  }

  return "status-waiting";
}


/* ==================================================
   RECHARGE (Bot-like flow — UPI/Binance/Crypto)
================================================== */

let rechargeSettings = null;
let rechargeMeta = null;
const RECHARGE_USDT_TO_INR = 90;
const RECHARGE_MIN_USDT = 0.1;

async function loadRechargeSettings(){
  try{
    const res = await fetch("/api/recharge?action=settings&t="+Date.now(), { cache:"no-store" });
    const data = await res.json();
    if(data && data.success){
      rechargeSettings = data.settings;
      rechargeMeta = data;
      return data;
    }
  }catch(e){
    console.error("Recharge settings:",e);
  }
  // fallback disabled
  rechargeSettings = { active_inr_gateway:null, binance_enabled:false, crypto_enabled:false };
  rechargeMeta = { binance:{pay_id:"",qr_url:""}, usdt_to_inr:90, min_usdt:0.1 };
  return null;
}

function renderRechargeMethods(){
  const box = document.getElementById("rechargeMethods");
  if(!box) return;

  if(!rechargeSettings){
    box.innerHTML = `<div class="loading"><div class="spinner"></div>Loading...</div>`;
    return;
  }

  const gateway = rechargeSettings.active_inr_gateway;
  const binanceOn = Boolean(rechargeSettings.binance_enabled);
  const cryptoOn = Boolean(rechargeSettings.crypto_enabled);

  const upiEnabled = gateway === "upi";
  const fampayEnabled = gateway === "fampay";
  const upiAutoEnabled = upiEnabled || fampayEnabled;

  // UPI card is always branded "UPI Gateway" — whichever gateway powers it behind the scenes
  let upiCard = "";
  if(upiAutoEnabled){
    upiCard = cardRecharge("upi",payIcon("upi"),"UPI Gateway","Scan QR & pay — auto verification","ON","upi");
  }else{
    upiCard = cardRecharge("upi",payIcon("upi"),"UPI Gateway","Currently disabled<br>Contact support","OFF",null,true);
  }

  const binanceCard = binanceOn
    ? cardRecharge("binance",payIcon("binance"),"Binance Pay (Auto)","Send to Pay ID & verify","ON","binance")
    : cardRecharge("binance",payIcon("binance"),"Binance Pay","Currently disabled","OFF",null,true);

  const cryptoCard = cryptoOn
    ? cardRecharge("crypto",payIcon("crypto"),"Crypto (Auto)","USDT via OxaPay<br>Min 0.1 USDT","ON","crypto")
    : cardRecharge("crypto",payIcon("crypto"),"Crypto","Currently disabled","OFF",null,true);

  box.innerHTML = upiCard + binanceCard + cryptoCard;

  if(!upiAutoEnabled && !binanceOn && !cryptoOn){
    box.innerHTML += `<div class="recharge-note" style="grid-column:1/-1"><svg class=icon aria-hidden=true><use href=/icons.svg#i-alert></use></svg> <b>All payment methods are currently disabled.</b> Please contact support or try again later. Admin can enable them from Payment Settings.</div>`;
  }
}

function payIcon(kind){
  const src = PAY_ICONS[kind] || "/assets/logo.png";
  const alt = kind === "upi" ? "UPI" : kind === "binance" ? "Binance" : "Crypto";
  return `<img class="pay-icon" src="${src}" alt="${alt}" width="56" height="56">`;
}

function cardRecharge(id,icon,title,sub,badge,method,disabled){
  const isDisabled = Boolean(disabled);
  const badgeClass = (badge==="ON"||badge==="UPI") ? "recharge-method-badge" : "recharge-method-badge off";
  const click = isDisabled ? "" : `onclick="openRechargeForm('${method||id}')"`;
  const cls = isDisabled ? "recharge-method-card disabled" : "recharge-method-card";
  return `
    <div class="${cls}" ${click}>
      <div class="recharge-method-icon">${icon}</div>
      <div class="recharge-method-title">${title}</div>
      <div class="recharge-method-sub">${sub}</div>
      <span class="${badgeClass}">${badge}</span>
    </div>
  `;
}

function openRechargeForm(method){
  // The UPI card is always branded "UPI Gateway" — resolve which backend
  // gateway actually powers it (fampay gateway still shows as UPI Gateway)
  if(method === "upi" && rechargeSettings && rechargeSettings.active_inr_gateway === "fampay"){
    method = "fampay";
  }

  const formArea = document.getElementById("rechargeFormArea");
  const invoiceArea = document.getElementById("rechargeInvoiceArea");
  if(!formArea || !invoiceArea) return;

  // Highlight the selected method card
  document.querySelectorAll(".recharge-method-card").forEach(function(card){
    card.classList.remove("selected");
  });
  var activeCard = document.querySelector('.recharge-method-card[onclick*="' + method + '"]');
  if(activeCard) activeCard.classList.add("selected");

  invoiceArea.classList.add("hidden");
  invoiceArea.innerHTML = "";
  formArea.classList.remove("hidden");

  if(method==="upi"){
    formArea.innerHTML = `
      <div style="font-weight:850;font-size:18px;margin-bottom:6px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-card></use></svg> UPI Gateway — Enter Amount</div>
      <div style="color:var(--muted);font-size:13px">Enter amount in INR. You will get a QR to scan with any UPI app.</div>
      <input id="upiAmountInput" class="recharge-input" type="number" inputmode="numeric" placeholder="Amount in INR (e.g. 100)" min="1" step="1">
      <div class="recharge-actions">
        <button class="primary-btn" type="button" onclick="createUPIInvoice()" style="margin-top:0">Generate QR</button>
        <button class="secondary-btn" type="button" onclick="closeRechargeForm()">Cancel</button>
      </div>
      <div class="recharge-note"><svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> <b>Expires in 60 minutes.</b> Pay via any UPI app, then tap <b>Verify Payment</b>. We also auto-check.</div>
    `;
    const input = document.getElementById("upiAmountInput");
    if(input){ input.focus(); input.scrollIntoView({ behavior:"smooth", block:"center" }); }
  }else if(method==="fampay"){
    formArea.innerHTML = `
      <div style="font-weight:850;font-size:18px;margin-bottom:6px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-card></use></svg> UPI Gateway — Scan & Pay</div>
      <div style="color:var(--muted);font-size:13px">Tap Generate to get a QR. You can pay <b>any amount</b> and verify.</div>
      <div class="recharge-actions">
        <button class="primary-btn" type="button" onclick="createFamPayInvoice()" style="margin-top:0">Generate QR</button>
        <button class="secondary-btn" type="button" onclick="closeRechargeForm()">Cancel</button>
      </div>
      <div class="recharge-note"><svg class=icon aria-hidden=true><use href=/icons.svg#i-phone></use></svg> <b>No amount needed upfront.</b> Scan QR, pay any amount, then tap Verify. Duplicate transactions are blocked.</div>
    `;
    formArea.scrollIntoView({ behavior:"smooth", block:"center" });
  }else if(method==="crypto"){
    formArea.innerHTML = `
      <div style="font-weight:850;font-size:18px;margin-bottom:6px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-coins></use></svg> Crypto (Auto) — USDT</div>
      <div style="color:var(--muted);font-size:13px">Enter USDT amount (Min ${RECHARGE_MIN_USDT}). You will receive INR at ₹${RECHARGE_USDT_TO_INR}/USDT.</div>
      <input id="cryptoAmountInput" class="recharge-input" type="number" inputmode="decimal" placeholder="Amount in USDT (e.g. 5)" min="0.1" step="0.1">
      <div class="recharge-actions">
        <button class="primary-btn" type="button" onclick="createCryptoInvoice()" style="margin-top:0">Generate Invoice</button>
        <button class="secondary-btn" type="button" onclick="closeRechargeForm()">Cancel</button>
      </div>
      <div class="recharge-note"><svg class=icon aria-hidden=true><use href=/icons.svg#i-alert></use></svg> <b>Send EXACT amount</b> shown on the payment link. Expires in 30 minutes.</div>
    `;
    const cinput = document.getElementById("cryptoAmountInput");
    if(cinput){ cinput.focus(); cinput.scrollIntoView({ behavior:"smooth", block:"center" }); }
  }else if(method==="binance"){
    const payId = rechargeMeta && rechargeMeta.binance ? rechargeMeta.binance.pay_id : "";
    const qrUrl = rechargeMeta && rechargeMeta.binance ? rechargeMeta.binance.qr_url : "";
    formArea.innerHTML = `
      <div style="font-weight:850;font-size:18px;margin-bottom:6px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-coins></use></svg> Binance Pay (Auto)</div>
      <div class="recharge-meta">
        <b>Pay ID:</b> <code style="user-select:all">${escapeHtml(payId||"Not configured")}</code>
        ${payId ? `<button class="secondary-btn" type="button" style="margin-top:0;padding:6px 10px;font-size:12px" data-v="${escapeHtml(payId)}" onclick="copyToClipboard(this.dataset.v)"><svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copy</button>` : ``}<br>
        ${qrUrl ? `<img src="${escapeHtml(qrProxy(qrUrl))}" class="recharge-qr" alt="Binance QR" loading="lazy">` : ``}
        ${qrUrl ? `<div class="recharge-actions" style="margin-top:6px"><a class="secondary-btn" style="display:inline-block;text-decoration:none;margin-top:0;text-align:center" href="${escapeHtml(qrDownload(qrUrl,'binance_qr.png'))}" download="binance_qr.png"><svg class=icon aria-hidden=true><use href=/icons.svg#i-download></use></svg> Download QR</a></div>` : ``}
        <div style="margin-top:8px">Send payment via Binance app to this Pay ID, then enter your <b>Order ID / Transaction ID</b> below and verify.</div>
      </div>
      <input id="binanceOrderInput" class="recharge-input" type="text" placeholder="Enter Binance Order ID / Transaction ID">
      <div class="recharge-actions">
        <button class="primary-btn" type="button" onclick="verifyBinanceFromInput()" style="margin-top:0">Verify Payment</button>
        <button class="secondary-btn" type="button" onclick="closeRechargeForm()">Back</button>
      </div>
      ${payId ? `<div class="recharge-note"><svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> <b>Tip:</b> Tap <svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copy to copy the Pay ID. After paying in Binance, paste Order ID here.</div>` : ``}
    `;
    const binput = document.getElementById("binanceOrderInput");
    if(binput){ binput.focus(); binput.scrollIntoView({ behavior:"smooth", block:"center" }); }
  }
}

function closeRechargeForm(){
  const f = document.getElementById("rechargeFormArea");
  if(f){ f.classList.add("hidden"); f.innerHTML=""; }
}

function closeRechargeInvoice(){
  const a = document.getElementById("rechargeInvoiceArea");
  if(a){ a.classList.add("hidden"); a.innerHTML=""; }
}

async function createUPIInvoice(){
  const input = document.getElementById("upiAmountInput");
  const amount = input ? input.value.trim() : "";
  if(!amount || isNaN(Number(amount)) || Number(amount)<=0 || !/^\d+(\.\d+)?$/.test(amount)){
    showMessage("Invalid Amount","Please enter a valid numeric amount.");
    return;
  }
  const btn = document.querySelector('#rechargeFormArea .primary-btn');
  if(btn){ btn.disabled=true; btn.textContent="Generating..."; }
  try{
    const { response: res, result: data } = await apiRequest("/api/recharge?action=create",{
      method:"POST",
      body:JSON.stringify({ method:"upi", amount: amount })
    });
    if(!res.ok || !data.success) throw new Error(data.message||"Failed to generate QR.");
    showUPIInvoice(data);
    closeRechargeForm();
  }catch(e){
    showMessage("UPI Error", e.message||"Could not generate QR.");
  }finally{
    if(btn){ btn.disabled=false; btn.textContent="Generate QR"; }
  }
}

function showUPIInvoice(data){
  const area = document.getElementById("rechargeInvoiceArea");
  const upiId = rechargeMeta ? (rechargeMeta.upi_id || "") : "";
  area.classList.remove("hidden");
  area.innerHTML = `
    <div style="font-weight:850;font-size:18px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-phone></use></svg> UPI Payment (Auto)</div>
    <img src="${escapeHtml(qrProxy(data.qr_url))}" class="recharge-qr" alt="UPI QR" loading="lazy">
    <div class="recharge-actions" style="margin-top:6px">
      <a class="secondary-btn" style="display:inline-block;text-decoration:none;margin-top:0;text-align:center" href="${escapeHtml(qrDownload(data.qr_url,'upi_qr_'+data.order_id+'.png'))}" download="upi_qr_${escapeHtml(data.order_id)}.png"><svg class=icon aria-hidden=true><use href=/icons.svg#i-download></use></svg> Download QR</a>
    </div>
    <div class="recharge-meta">
      <b>Amount:</b> ₹${escapeHtml(String(data.amount))}<br>
      <b>Order ID:</b> <code>${escapeHtml(data.order_id)}</code><br>
      ${upiId ? `<b>Pay to:</b> <code style="user-select:all">${escapeHtml(upiId)}</code> <button class="secondary-btn" type="button" style="margin-top:0;padding:4px 10px;font-size:12px" data-v="${escapeHtml(upiId)}" onclick="copyToClipboard(this.dataset.v)"><svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copy</button><br>` : ``}
      <b>Expires:</b> ${data.expires_in_min||60} minutes
    </div>
    <div class="recharge-note">Scan with any UPI app and pay exactly ₹${escapeHtml(String(data.amount))}. Then tap Verify.</div>
    <div class="recharge-actions">
      <button class="primary-btn" type="button" onclick="verifyUPI('${escapeHtml(data.order_id)}')" style="margin-top:0"><svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Verify Payment</button>
      <button class="secondary-btn" type="button" onclick="closeRechargeInvoice()">Close</button>
    </div>
  `;
}

async function createFamPayInvoice(){
  const btn = document.querySelector('#rechargeFormArea .primary-btn');
  if(btn){ btn.disabled=true; btn.textContent="Generating..."; }
  try{
    const { response: res, result: data } = await apiRequest("/api/recharge?action=create",{
      method:"POST",
      body:JSON.stringify({ method:"fampay" })
    });
    if(!res.ok || !data.success) throw new Error(data.message||"Failed to generate QR.");
    const area = document.getElementById("rechargeInvoiceArea");
    const fampayUpi = rechargeMeta ? (rechargeMeta.fampay_upi || "") : "";
    area.classList.remove("hidden");
    area.innerHTML = `
      <div style="font-weight:850;font-size:18px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-card></use></svg> UPI Gateway — Pay Any Amount</div>
      <img src="${escapeHtml(qrProxy(data.qr_url))}" class="recharge-qr" alt="UPI QR" loading="lazy">
      <div class="recharge-actions" style="margin-top:6px">
        <a class="secondary-btn" style="display:inline-block;text-decoration:none;margin-top:0;text-align:center" href="${escapeHtml(qrDownload(data.qr_url,'fampay_qr_'+data.order_id+'.png'))}" download="fampay_qr_${escapeHtml(data.order_id)}.png"><svg class=icon aria-hidden=true><use href=/icons.svg#i-download></use></svg> Download QR</a>
      </div>
      <div class="recharge-meta">
        <b>Order ID:</b> <code>${escapeHtml(data.order_id)}</code><br>
        ${fampayUpi ? `<b>Pay to (FamPay):</b> <code style="user-select:all">${escapeHtml(fampayUpi)}</code> <button class="secondary-btn" type="button" style="margin-top:0;padding:4px 10px;font-size:12px" data-v="${escapeHtml(fampayUpi)}" onclick="copyToClipboard(this.dataset.v)"><svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copy</button><br>` : ``}
        ${data.expire ? `<b>Expires:</b> ${escapeHtml(data.expire)}<br>` : ``}
        <b>Note:</b> Pay any amount you wish, then verify.
      </div>
      <div class="recharge-actions">
        <button class="primary-btn" type="button" onclick="verifyFamPay('${escapeHtml(data.order_id)}')" style="margin-top:0"><svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Verify Payment</button>
        <button class="secondary-btn" type="button" onclick="closeRechargeInvoice()">Close</button>
      </div>
    `;
    closeRechargeForm();
  }catch(e){
    showMessage("UPI Error", e.message||"Could not generate QR.");
  }finally{
    if(btn){ btn.disabled=false; btn.textContent="Generate QR"; }
  }
}

async function createCryptoInvoice(){
  const input = document.getElementById("cryptoAmountInput");
  const amount = input ? input.value.trim() : "";
  const usdt = Number(amount);
  if(!amount || !Number.isFinite(usdt) || usdt < RECHARGE_MIN_USDT){
    showMessage("Invalid Amount",`Minimum is ${RECHARGE_MIN_USDT} USDT.`);
    return;
  }
  const btn = document.querySelector('#rechargeFormArea .primary-btn');
  if(btn){ btn.disabled=true; btn.textContent="Generating..."; }
  try{
    const { response: res, result: data } = await apiRequest("/api/recharge?action=create",{
      method:"POST",
      body:JSON.stringify({ method:"crypto", amount: usdt })
    });
    if(!res.ok || !data.success) throw new Error(data.message||"Failed to generate invoice.");
    const area = document.getElementById("rechargeInvoiceArea");
    area.classList.remove("hidden");
    const inr = data.amount_inr;
    area.innerHTML = `
      <div style="font-weight:850;font-size:18px"><svg class=icon aria-hidden=true><use href=/icons.svg#i-coins></use></svg> Crypto Invoice</div>
      <div class="recharge-meta">
        <b>Amount:</b> ${escapeHtml(String(data.amount_usdt))} USDT<br>
        <b>INR Value:</b> ₹${escapeHtml(String(inr))}<br>
        <b>Track ID:</b> <code>${escapeHtml(data.track_id)}</code><br>
        <b>Pay URL:</b> <a href="${escapeHtml(data.pay_url)}" target="_blank" rel="noopener" style="color:var(--green);word-break:break-all">${escapeHtml(data.pay_url)}</a>
      </div>
      <div class="recharge-actions">
        <a class="primary-btn" href="${escapeHtml(data.pay_url)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center"><svg class=icon aria-hidden=true><use href=/icons.svg#i-card></use></svg> Pay Now</a>
        <button class="secondary-btn" type="button" onclick="verifyCrypto('${escapeHtml(data.track_id)}')"><svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> I Have Paid</button>
      </div>
      <div class="recharge-note"><svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> Expires in 30 minutes. Send exact amount.</div>
    `;
    closeRechargeForm();
  }catch(e){
    showMessage("Crypto Error", e.message||"Could not generate invoice.");
  }finally{
    if(btn){ btn.disabled=false; btn.textContent="Generate Invoice"; }
  }
}

async function verifyUPI(orderId){
  if(!orderId) return;
  const area = document.getElementById("rechargeInvoiceArea");
  const btn = area ? area.querySelector(".primary-btn") : null;
  if(btn){ btn.disabled=true; btn.textContent="Verifying..."; }
  try{
    const { result: data } = await apiRequest("/api/recharge?action=verify",{
      method:"POST",
      body:JSON.stringify({ method:"upi", order_id: orderId })
    });
    if(data.success){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Payment Verified", data.message || `₹${data.amount} credited. New balance: ₹${(data.balance||0).toFixed(2)}`);
      closeRechargeInvoice();
      await loadDashboardData();
      await loadRechargeHistory();
    }else{
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> Not yet", data.message||"Payment not received yet. Try again.");
    }
  }catch(e){
    showMessage("Verify Failed", e.message||"Could not verify.");
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Verify Payment"; }
  }
}

async function verifyFamPay(orderId){
  if(!orderId) return;
  const area = document.getElementById("rechargeInvoiceArea");
  const btn = area ? area.querySelector(".primary-btn") : null;
  if(btn){ btn.disabled=true; btn.textContent="Verifying..."; }
  try{
    const { result: data } = await apiRequest("/api/recharge?action=verify",{
      method:"POST",
      body:JSON.stringify({ method:"fampay", order_id: orderId })
    });
    if(data.success){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Payment Verified", data.message || `₹${data.amount} credited. New balance: ₹${(data.balance||0).toFixed(2)}`);
      closeRechargeInvoice();
      await loadDashboardData();
      await loadRechargeHistory();
    }else{
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-note></use></svg> Not yet", data.message||"Payment not received yet.");
    }
  }catch(e){
    showMessage("Verify Failed", e.message||"Could not verify.");
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Verify Payment"; }
  }
}

async function verifyCrypto(trackId){
  if(!trackId) return;
  const area = document.getElementById("rechargeInvoiceArea");
  const btn = area ? area.querySelector(".secondary-btn") : null;
  if(btn){ btn.disabled=true; btn.textContent="Checking..."; }
  try{
    const { result: data } = await apiRequest("/api/recharge?action=verify",{
      method:"POST",
      body:JSON.stringify({ method:"crypto", track_id: trackId, order_id: trackId })
    });
    if(data.success){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Crypto Verified", data.message || `${data.amount_usdt||""} USDT (₹${data.amount}) credited.`);
      closeRechargeInvoice();
      await loadDashboardData();
      await loadRechargeHistory();
    }else{
      showMessage("Crypto Status", data.message||"Not confirmed yet.");
    }
  }catch(e){
    showMessage("Verify Failed", e.message||"Could not verify.");
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> I Have Paid"; }
  }
}

async function verifyBinanceFromInput(){
  const input = document.getElementById("binanceOrderInput");
  const orderId = input ? input.value.trim() : "";
  if(!orderId){
    showMessage("Order ID Required","Please enter your Binance Order ID / Transaction ID.");
    return;
  }
  const btn = document.querySelector('#rechargeFormArea .primary-btn');
  if(btn){ btn.disabled=true; btn.textContent="Verifying..."; }
  try{
    const { result: data } = await apiRequest("/api/recharge?action=verify",{
      method:"POST",
      body:JSON.stringify({ method:"binance", order_id: orderId })
    });
    if(data.success){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Binance Verified", data.message || `₹${data.amount} credited.`);
      closeRechargeForm();
      await loadDashboardData();
      await loadRechargeHistory();
    }else{
      showMessage("Binance", data.message||"Not found. Try again after a minute.");
    }
  }catch(e){
    showMessage("Verify Failed", e.message||"Could not verify.");
  }finally{
    if(btn){ btn.disabled=false; btn.textContent="Verify Payment"; }
  }
}

async function loadRechargeHistory(){
  if(!currentUserId && !currentTelegramId) return;
  const box = document.getElementById("rechargeHistoryList");
  if(!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Loading history...</div>`;
  try{
    const { response: res, result: data } = await apiRequest("/api/recharge?action=history&t="+Date.now(),{ cache:"no-store" });
    if(!res.ok || !data.success) throw new Error(data.message||"Failed");
    const list = data.history || [];
    if(!list.length){
      box.innerHTML = `<div class="loading">No successful recharges yet.</div>`;
      return;
    }
    box.innerHTML = list.map(tx=>{
      const d = tx.date ? formatDate(tx.date) : "—";
      let method = String(tx.method||"").toUpperCase();
      if(method === "FAMPAY") method = "UPI"; // unified UPI gateway branding
      method = escapeHtml(method);
      const amount = Number(tx.amount||0).toFixed(2);
      const sub = tx.amount_usdt ? `${tx.amount_usdt} USDT` : `₹${amount}`;
      return `
        <div class="recharge-history-item">
          <div>
            <div><b>${method}</b> — ${sub}</div>
            <div class="muted">${escapeHtml(d)} • <code>${escapeHtml(tx.order_id||"")}</code></div>
          </div>
          <div style="text-align:right"><b style="color:var(--green)"><svg class=icon aria-hidden=true><use href=/icons.svg#i-check></use></svg> Paid</b></div>
        </div>
      `;
    }).join("");
  }catch(e){
    console.error("Recharge history:", e);
    const reason = (e && e.message) ? e.message : "Could not load history.";
    box.innerHTML = `<div class="loading">${escapeHtml(reason)}</div>`;
  }
}

async function initRechargePage(){
  if(!currentUserId && !currentTelegramId) return;
  await loadRechargeSettings();
  renderRechargeMethods();
  await loadRechargeHistory();
  const sub = document.getElementById("rechargeBalanceSub");
  if(sub && dashboardData){
    const bal = Number(dashboardData.user?.balance||0);
    sub.textContent = "Current: "+formatMoney(bal)+" — Choose method to add funds (auto verification)";
  }
}

/* ==================================================
   NAVIGATION
================================================== */

function openPage(page){

  document.querySelectorAll(
    ".page"
  ).forEach(element=>{
    element.classList.remove(
      "active"
    );
  });

  const target =
    document.getElementById(
      page+"Page"
    );

  if(target){

    target.classList.add(
      "active"
    );
  }

  document.querySelectorAll(
    ".nav-btn"
  ).forEach(button=>{

    button.classList.toggle(
      "active",
      button.dataset.page===page
    );

  });

  if(typeof window.refreshIcons === "function"){
    try{ window.refreshIcons(document); }catch(e){}
  }

  // Instant jump, not smooth: smooth scrolling while the bottom nav is
  // position:fixed (and backdrop-filtered) makes the bar glitch/detach on
  // mobile browsers. An instant jump is what fixed-page apps use anyway.
  window.scrollTo(0,0);

  if(page==="buy"){

    loadCountries();
  }

  if(page==="orders"){

    loadDashboardData();
  }

  if(page==="recharge"){

    initRechargePage();
  }

  if(page==="home"){
    loadDashboardData();
    loadCountries();
  }
  if(page==="settings"){ refreshBotStatus(); }
}


/* ==================================================
   THEME
================================================== */

// Active store theme chosen by the admin (from /api/status). "default" means
// the user keeps the original dark theme and their own dark/light toggle.
let siteTheme = "default";

// ?preview_theme=<id> forces a theme for this tab only (used by the admin
// panel's "Live preview" button). It never touches the saved store theme.
let previewTheme = null;
try{
  const qs = new URLSearchParams(location.search);
  const pv = qs.get("preview_theme");
  if(pv){ previewTheme = pv; }
}catch(e){}

function isCustomTheme(){
  return Boolean(siteTheme) && siteTheme !== "default";
}

function applySiteTheme(id){
  const next = (typeof id === "string" && id) ? id : "default";
  const changed = next !== siteTheme;
  siteTheme = next;
  const body = document.body;

  if(isCustomTheme()){
    body.setAttribute("data-theme", siteTheme);
    // Admin theme wins over the user's local dark/light toggle.
    body.classList.remove("light");
  }else{
    body.removeAttribute("data-theme");
    // Fall back to the user's own dark/light preference.
    loadTheme();
  }

  // Remember it so the next page load paints the right UI immediately
  // (previews are per-tab and must not be cached).
  if(!previewTheme){
    try{ localStorage.setItem("tga_site_theme", siteTheme); }catch(e){}
  }

  // Themes are full UI redesigns, so re-run the light/dark row state and give
  // the layout one animation tick when the admin swaps a theme live.
  if(changed){
    body.classList.add("theme-swapping");
    setTimeout(()=>body.classList.remove("theme-swapping"), 520);
  }

  updateThemeLockNote();

  // Keep the browser chrome colour in sync with the page background.
  try{
    const bg = getComputedStyle(body).getPropertyValue("--bg").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta && bg){ meta.setAttribute("content", bg); }
  }catch(e){}

  updateThemeSwitch();
}


function toggleTheme(){

  // While the admin has set a store theme, the local dark/light switch is a no-op.
  if(isCustomTheme()){
    return;
  }

  document.body.classList.toggle(
    "light"
  );

  const light =
    document.body.classList.contains(
      "light"
    );

  localStorage.setItem(
    "tga_theme",
    light
      ? "light"
      : "dark"
  );

  updateThemeSwitch();
}


// Human labels for the admin-selected full-UI themes (used in Settings).
const SITE_THEME_LABELS = {
  default:"Default", glass:"Glass", neo:"Neumorphic", brutal:"Neo Brutalist",
  prism:"Holo Prism", neon3d:"Neon Pulse", obsidian:"Obsidian Glow", paper:"Paper",
  crystal:"Crystal 3D", console:"Pro Console", hud:"Cyber HUD", ember:"Ember Forge",
  candy:"Candy Pop", nova:"Nova Glow", organic:"Organic", chrome3d:"Liquid Chrome",
  plasma:"Plasma Core", clay:"Claymorphism", abyss:"Deep Abyss",
  steel:"Industrial", sakura:"Zen Sakura", midnight:"Midnight Pro"
};

function siteThemeLabel(){
  return SITE_THEME_LABELS[siteTheme] || siteTheme;
}

// Small floating tag so nobody confuses a preview tab with the live store.
function showThemePreviewBadge(id){
  if(document.getElementById("themePreviewBadge")) return;
  const badge = document.createElement("div");
  badge.id = "themePreviewBadge";
  badge.className = "theme-preview-badge";
  badge.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-eye></use></svg> Preview: " + (SITE_THEME_LABELS[id] || id);
  document.body.appendChild(badge);
}

// The dark/light row is only meaningful on the default theme — every other
// theme ships its own complete look, so the row explains that instead.
function updateThemeLockNote(){

  const note = document.getElementById("themeModeSub");
  const row  = document.getElementById("themeModeRow");
  const sw   = document.getElementById("themeSwitch");

  if(note){
    note.textContent = isCustomTheme()
      ? ("Store theme active: " + siteThemeLabel())
      : "Toggle dark/light theme";
  }

  if(row){
    row.classList.toggle("theme-locked", isCustomTheme());
  }

  if(sw){
    sw.disabled = isCustomTheme();
    sw.style.opacity = isCustomTheme() ? ".45" : "";
    sw.style.cursor  = isCustomTheme() ? "not-allowed" : "pointer";
  }

  updateThemeSwitch();
}


function updateThemeSwitch(){

  const switcher =
    document.getElementById(
      "themeSwitch"
    );

  if(!switcher){
    return;
  }

  const light =
    document.body.classList.contains(
      "light"
    );

  switcher.classList.toggle(
    "on",
    !light
  );
}


function loadTheme(){

  // Don't clobber an admin-selected theme with the local preference.
  if(isCustomTheme()){
    return;
  }

  const theme =
    localStorage.getItem(
      "tga_theme"
    ) || "dark";

  if(theme==="light"){

    document.body.classList.add(
      "light"
    );

  }else{

    document.body.classList.remove(
      "light"
    );
  }

  updateThemeSwitch();
}


/* ==================================================
   TERMS / MESSAGE
================================================== */

function openTerms(){

  document.getElementById(
    "termsModal"
  ).classList.add("show");
}


function showComingSoon(title){

  showMessage(
    title,
    "This setting is ready in the UI but the backend functionality will be added later."
  );
}


/*
  Every message goes through one sanitizer.

  Titles used to be written with .textContent, so an icon passed in as markup
  printed the raw <svg> tag (the "Bot Connected <svg class=icon …>" bug in the
  screenshot). Titles now accept markup, but only a whitelist: sprite icons,
  <b>, <i> and <br>. Everything else — including anything an API response puts
  in a message — is escaped, so a server string can never inject HTML.
*/
var MSG_ICON_RE =
  /<svg[^>]*>\s*<use[^>]*?\/icons\.svg#i-([a-z0-9-]+)[^>]*>\s*<\/use>\s*<\/svg>/gi;

function safeMessageHtml(value){
  var raw = String(value == null ? "" : value);
  var icons = [];

  // 1. pull the trusted icon snippets out first (they survive escaping)
  var rest = raw.replace(MSG_ICON_RE, function(_m, name){
    icons.push(String(name).toLowerCase());
    return "\u0000" + (icons.length - 1) + "\u0000";
  });

  // 2. escape everything that is left
  rest = escapeHtml(rest);

  // 3. re-allow the tiny bit of formatting the UI itself uses
  rest = rest
    .replace(/&lt;b&gt;/gi, "<b>")
    .replace(/&lt;\/b&gt;/gi, "</b>")
    .replace(/&lt;i&gt;/gi, "<i>")
    .replace(/&lt;\/i&gt;/gi, "</i>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");

  // 4. put the icons back, rendered from the verified name only
  return rest.replace(/\u0000(\d+)\u0000/g, function(_m, index){
    var name = icons[Number(index)];
    return window.icon ? window.icon(name) : "";
  });
}

function setMessageField(el, value){
  if(!el) return;
  var str = String(value == null ? "" : value);
  // Markup only when the UI itself asked for it; plain strings stay plain text
  // (so a message like "Balance < 10" is never parsed as HTML).
  if(/<\/?[a-z]/i.test(str)) el.innerHTML = safeMessageHtml(str);
  else el.textContent = str;
}

function showMessage(title,text){

  setMessageField(
    document.getElementById("messageTitle"),
    title
  );

  setMessageField(
    document.getElementById("messageText"),
    text
  );

  document.getElementById(
    "messageModal"
  ).classList.add("show");
}


function closeModal(id){

  const modal =
    document.getElementById(id);

  if(modal){

    modal.classList.remove(
      "show"
    );
  }
}


/* ==================================================
   REFRESH
================================================== */

async function refreshCurrentPage(){

  const button =
    document.getElementById(
      "refreshButton"
    );

  if(!button){
    return;
  }

  if(button.disabled){
    return;
  }

  button.disabled=true;

  button.classList.add(
    "refreshing"
  );

  try{

    /*
      Refresh dashboard and live stock
      independently so one API failure
      doesn't stop the other.
    */

    await Promise.all([
      loadDashboardData(),
      loadCountries()
    ]);

  }catch(error){

    console.error(
      "Refresh:",
      error
    );

  }finally{

    button.disabled=false;

    button.classList.remove(
      "refreshing"
    );
  }
}


/* ==================================================
   LOGOUT
================================================== */

function handleLogout(){
  try{
    fetch("/api/account?action=logout", {
      method:"POST",
      headers: authHeaders(true),
      cache:"no-store",
      body:"{}"
    }).catch(function(){});
  }catch(e){}
  clearSession();
  clearDataCaches();

  currentUserId=null;
  currentTelegramId=null;

  dashboardData=null;

  currentOrders=[];

  countriesData={};

  selectedCountry=null;

  currentAccount=null;

  closeAllModals();

  document.getElementById(
    "dashboardScreen"
  ).style.display="none";

  document.getElementById(
    "loginScreen"
  ).style.display="";

  document.getElementById(
    "telegramIdInput"
  ).value="";

  document.getElementById(
    "passwordInput"
  ).value="";

  hideLoginError();
}



async function refreshBotStatus(){
  const uid = currentUserId || currentTelegramId;
  if(!uid) return;
  try{
    const { result: data } = await apiRequest("/api/account?action=bot-connect&t="+Date.now(),{cache:"no-store"});
    const dot=document.getElementById("botConnectDot");
    const sub=document.getElementById("botConnectSub");
    if(!dot) return;
    if(data.success && data.bot_connected){
      dot.style.background="var(--green)";
      dot.style.boxShadow="0 0 8px var(--green)";
      if(sub) sub.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Connected as @"+(data.username||"")+" (Telegram: "+(data.telegram_id||"")+")";
    } else {
      dot.style.background="var(--red)";
      dot.style.boxShadow="none";
      if(sub) sub.innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-alert></use></svg> Not connected — tap to connect for purchase alerts";
    }
  }catch(e){}
}
async function openBotConnect(){
  const uid = currentUserId || currentTelegramId;
  if(!uid){ showMessage("Login required","Please login first."); return; }
  try{
    const { result: st } = await apiRequest("/api/account?action=bot-connect");
    if(st.success && st.bot_connected){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-bot></use></svg> Bot Connected", "Your Telegram is already connected <svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg>\nTelegram ID: "+st.telegram_id);
      return;
    }
  }catch(e){}
  // create token
  try{
    const { result: data } = await apiRequest("/api/account?action=bot-connect",{method:"POST", body:JSON.stringify({})});
    if(data.already_connected){ showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Already connected","Telegram ID: "+data.telegram_id); refreshBotStatus(); return; }
    if(!data.success) throw new Error(data.message||"Failed");
    const link=data.link;
    document.getElementById("messageTitle").innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-bot></use></svg> Connect Telegram Bot";
    document.getElementById("messageText").innerHTML='Tap the button below to connect:<br><br><a href="'+link+'" target="_blank" rel="noopener" style="display:inline-block;padding:12px 18px;background:#fff;color:#000;border-radius:12px;text-decoration:none;font-weight:800"><svg class=icon aria-hidden=true><use href=/icons.svg#i-telegram></use></svg> Open Bot — Connect</a><br><br><code style="word-break:break-all">'+link+'</code><br><br><span style="color:var(--muted)">Link expires in 15 minutes. After tapping Start in bot, refresh this page.</span>';
    document.getElementById("messageModal").classList.add("show");
  }catch(e){ showMessage("Error", e.message||"Could not create link."); }
}
function openChangePassword(){
  document.getElementById("messageTitle").innerHTML = "<svg class=icon aria-hidden=true><use href=/icons.svg#i-lock></use></svg> Change Password";
  document.getElementById("messageText").innerHTML='<div style="text-align:left"><div class="field-label">Current Password</div><input id="cpOld" class="field-input" type="password" placeholder="Current"><div class="field-label">New Password</div><input id="cpNew" class="field-input" type="password" placeholder="Min 6 chars"><button class="primary-btn" onclick="submitChangePassword()">Update Password</button></div>';
  document.getElementById("messageModal").classList.add("show");
}
async function submitChangePassword(){
  const oldP=document.getElementById("cpOld").value;
  const newP=document.getElementById("cpNew").value;
  if(!newP || newP.length<6){ showMessage("Error","New password min 6 chars."); return; }
  const uid=currentUserId||currentTelegramId;
  try{
    const { response: res, result: d }=await apiRequest("/api/account?action=change-password",{method:"POST", body:JSON.stringify({oldPassword: oldP, newPassword: newP})});
    if(!res.ok || !d.success) throw new Error(d.message||"Failed");
    closeModal("messageModal");
    showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-check-circle></use></svg> Updated","Password changed successfully.");
  }catch(e){ showMessage("Failed", e.message); }
}

function closeAllModals(){

  document.querySelectorAll(
    ".modal-overlay"
  ).forEach(modal=>{
    modal.classList.remove(
      "show"
    );
  });
}


/* ==================================================
   TELEGRAM ACCOUNT CHIP
================================================== */

/*
  Shows the account details the API just gave us: Telegram id, @username and
  (when Telegram provides it) the profile photo. Filled automatically for Mini
  App sign-ins and for a normal Telegram-ID login after the dashboard loads.
*/
function renderTelegramAccount(user){

  const box =
    document.getElementById(
      "tgAccount"
    );

  if(!box) return;

  const tgId =
    user && (user.telegramId || user.telegram_id)
      ? String(user.telegramId || user.telegram_id)
      : (localStorage.getItem("tga_telegram_id") || "");

  // Only useful when there is a real numeric Telegram id (email/phone-only
  // accounts get an ObjectId here, which means nothing to the user).
  if(!tgId || !/^\d+$/.test(tgId)){
    box.classList.add("hidden");
    return;
  }

  const rawUsername =
    (user && user.username) ||
    (localStorage.getItem("tga_username") || "");

  const handle = rawUsername
    ? "@" + String(rawUsername).replace(/^@/, "")
    : "";

  const displayName =
    (user && (user.firstName || user.first_name))
      ? [user.firstName || user.first_name, user.lastName || user.last_name]
          .filter(Boolean).join(" ")
      : "";

  /* ---- welcome row: avatar + name + handle ---- */

  const nameEl =
    document.getElementById(
      "welcomeName"
    );

  if(nameEl && displayName){
    nameEl.textContent = displayName;
  }

  const handleEl =
    document.getElementById(
      "welcomeHandle"
    );

  if(handleEl){
    const parts = [];
    if(handle) parts.push(handle);
    parts.push("Telegram ID " + tgId);
    handleEl.innerHTML =
      parts.map(p=>escapeHtml(p)).join(' <span class="dot-sep">·</span> ');
    handleEl.classList.remove("hidden");
  }

  /* ---- account strip ---- */

  const stripName =
    document.getElementById(
      "tgAccountName"
    );

  if(stripName){
    stripName.textContent = displayName || handle || "Telegram account";
  }

  const idEl =
    document.getElementById(
      "tgAccountId"
    );

  if(idEl) idEl.textContent = tgId;

  const photo =
    (user && (user.photoUrl || user.photo_url)) ||
    localStorage.getItem("tga_photo") ||
    "";

  paintAvatar(
    document.getElementById("tgAccountAvatar"),
    photo,
    displayName || rawUsername || "TG"
  );

  paintAvatar(
    document.getElementById("welcomeAvatar"),
    photo,
    displayName || rawUsername || "TG"
  );

  paintAvatar(
    document.getElementById("headerAvatar"),
    photo,
    displayName || rawUsername || "TG"
  );

  box.classList.remove("hidden");
}


/* "Sonu Kumar" -> SK, "@tg_demo" -> TD, "" -> TG */
function initialsOf(value){

  const words = String(value || "")
    .replace(/^@/, "")
    .replace(/[_.\-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if(!words.length) return "TG";

  if(words.length === 1){
    return words[0].slice(0, 2).toUpperCase();
  }

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}


/* Fill an avatar element with a photo, or initials as a fallback. */
function paintAvatar(container, photo, fallbackText){

  if(!container) return;

  const existing = container.querySelector("img");

  if(photo){
    const img = existing || document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = ()=>{
      img.remove();
      container.classList.remove("has-photo");
      // Photo broke (expired signed URL, offline): fall back to initials so
      // the avatar is not a blank circle.
      container.classList.remove("hidden");
      const fb = container.querySelector(
        ".welcome-avatar-fallback, .header-avatar-fallback, .tg-account-avatar-fallback"
      );
      if(fb) fb.textContent = initialsOf(fallbackText);
    };
    img.src = photo;
    if(!existing) container.appendChild(img);
    container.classList.add("has-photo");
    // BUGFIX: must un-hide the avatar here too — otherwise a user with a
    // photo_url keeps the `hidden` class and the avatar never appears.
    container.classList.remove("hidden");
    return;
  }

  if(existing) existing.remove();
  container.classList.remove("has-photo");

  // Initials fallback (works for the welcome avatar *and* the header avatar).
  const fallback = container.querySelector(
    ".welcome-avatar-fallback, .header-avatar-fallback, .tg-account-avatar-fallback"
  );

  if(fallback){
    fallback.textContent = initialsOf(fallbackText);
  }

  container.classList.remove("hidden");
}


function copyTelegramId(){

  const el =
    document.getElementById(
      "tgAccountId"
    );

  const id =
    el ? el.textContent.trim() : "";

  if(!id || id==="—") return;

  copyToClipboard(id);
}


/* ==================================================
   SHOW DASHBOARD
================================================== */

function showDashboard(){

  document.getElementById(
    "loginScreen"
  ).style.display="none";

  document.getElementById(
    "dashboardScreen"
  ).style.display="block";

  // Mini App sign-in succeeded (or a normal login finished): drop the
  // "Signing you in with Telegram…" state so a later logout shows the form.
  const bootBox = document.getElementById("telegramBooting");
  if(bootBox) bootBox.remove();

  document.querySelectorAll(".login-card .auth-tabs, .login-card .method-switch")
    .forEach(el=>el.classList.remove("hidden"));

  const loginArea = document.getElementById("loginFormArea");
  const registerArea = document.getElementById("registerFormArea");
  if(loginArea) loginArea.classList.toggle("hidden", authTab === "register");
  if(registerArea) registerArea.classList.toggle("hidden", authTab !== "register");

  // Dynamic markup (country grid, orders, modals) is written after boot; point
  // its #i-… references at the inline sprite copy as soon as it lands.
  if(typeof window.refreshIcons === "function"){
    try{ window.refreshIcons(document); }catch(e){}
  }

  // Prefer the saved display name; "@username" is only a fallback so the
  // dashboard never shows "User" after a successful Telegram sign-in.
  const savedFirst = localStorage.getItem("tga_first_name") || "";
  const savedLast = localStorage.getItem("tga_last_name") || "";
  const savedDisplay = (savedFirst + " " + savedLast).trim();
  const welcomeNameEl = document.getElementById("welcomeName");

  if(welcomeNameEl){
    welcomeNameEl.textContent =
      savedDisplay ||
      localStorage.getItem("tga_username") ||
      "User";
  }

  // Paint the avatar / Telegram chip straight from the saved session so a
  // returning Mini App user sees their photo instantly, not after the API
  // round-trip (loadDashboardData repaints with fresh server data).
  try {
    renderTelegramAccount({
      telegramId: localStorage.getItem("tga_telegram_id") || null,
      username: localStorage.getItem("tga_username") || null,
      firstName: savedFirst || null,
      lastName: savedLast || null,
      photoUrl: localStorage.getItem("tga_photo") || null,
    });
  } catch(e) {}

  // Instant paint: balance, name, avatar and orders from the last visit.
  try{ paintCachedDashboard(); }catch(e){}

  loadDashboardData();

  loadCountries();
}


/* ==================================================
   LOGIN ERROR
================================================== */

function showLoginError(message){

  const element =
    document.getElementById(
      "loginError"
    );

  element.textContent =
    message;

  element.style.display =
    "block";
}


function hideLoginError(){

  const element =
    document.getElementById(
      "loginError"
    );

  element.textContent="";
  element.style.display="none";
}


/* ==================================================
   DATE (Fixed — shows date + time in IST, handles Mongo dates)
================================================== */

function formatDate(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){
    return "N/A";
  }

  try{

    let raw = value;

    if(
      typeof value === "object" &&
      value !== null
    ){

      if(value.$date !== undefined){

        if(
          typeof value.$date === "object" &&
          value.$date !== null &&
          value.$date.$numberLong !== undefined
        ){
          raw = Number(value.$date.$numberLong);
        }else{
          raw = value.$date;
        }

      }else if(value.$oid){
        return "N/A";
      }

    }

    const date = new Date(raw);

    if(Number.isNaN(date.getTime())){
      return "N/A";
    }

    return date.toLocaleString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
      }
    ) + " IST";

  }catch{

    return "N/A";
  }
}


function formatDateTime(value){
  return formatDate(value);
}


/* ==================================================
   HTML ESCAPE
================================================== */

function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copied", text);
    }).catch(function(){
      fallbackCopyText(text);
    });
  }else{
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text){
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand("copy"); showMessage("<svg class=icon aria-hidden=true><use href=/icons.svg#i-copy></use></svg> Copied", text); }
  catch(e){ showMessage("Copy Failed", "Could not copy. Please copy manually."); }
  document.body.removeChild(ta);
}

/* QR helpers — always route external QR images through our own /api/qr_proxy
   endpoint. This fixes two long-standing bugs:
     1. Broken image icon: some UPI/FamPay QR CDNs block hot-linking or serve
        short-lived signed URLs, so <img src="external"> shows nothing.
     2. "Download QR" opening in a new tab instead of saving the file:
        the HTML `download` attribute is IGNORED for cross-origin URLs by
        Chrome (especially on Android). Serving the bytes from our own origin
        + Content-Disposition: attachment forces a real file download. */
function qrProxy(url){
  if(!url) return "";
  return "/api/qr_proxy?url=" + encodeURIComponent(String(url));
}
function qrDownload(url, filename){
  if(!url) return "";
  var q = "/api/qr_proxy?url=" + encodeURIComponent(String(url));
  if(filename){ q += "&dl=" + encodeURIComponent(String(filename)); }
  return q;
}

function escapeHtml(value){

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* ==================================================
   CLOSE MODAL ON BACKDROP
================================================== */

document.addEventListener(
  "click",
  event=>{

    if(
      event.target.classList.contains(
        "modal-overlay"
      )
    ){

      event.target.classList.remove(
        "show"
      );
    }

  }
);


/* ==================================================
   KEYBOARD ESC
================================================== */

document.addEventListener(
  "keydown",
  event=>{

    if(event.key!=="Escape"){
      return;
    }

    closeAllModals();

  }
);


/* ==================================================
   MAINTENANCE
================================================== */

async function checkMaintenance(){

  try{

    const response =
      await fetch(
        "/api/status",
        {
          method:"GET",
          cache:"no-store"
        }
      );

    const result =
      await response.json();

    // Apply the admin-selected store theme (falls back to "default").
    // A ?preview_theme= tab keeps its forced theme instead.
    if(!previewTheme && result && typeof result.theme === "string"){
      applySiteTheme(result.theme);
    }

    if(
      result &&
      result.maintenance
    ){

      showMaintenance(
        result.message
      );

    }else{

      hideMaintenance();

    }

  }catch(error){

    console.error(
      "Maintenance check:",
      error
    );

  }
}


function showMaintenance(message){

  const overlay =
    document.getElementById(
      "maintenanceOverlay"
    );

  if(!overlay){
    return;
  }

  const text =
    document.getElementById(
      "maintenanceMessage"
    );

  if(text && message){

    text.textContent =
      message;

  }

  /* Hide both login and dashboard beneath the gate. This prevents the
     application from peeking through while a user waits for the update. */
  document.body.classList.add("maintenance-active");
  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
}


function hideMaintenance(){

  const overlay =
    document.getElementById(
      "maintenanceOverlay"
    );

  if(overlay){
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }

  document.body.classList.remove("maintenance-active");
}


/* ==================================================
   SAVED SESSION
================================================== */

/*
  ---------------------------------------------------------------------------
  WHO IS THIS VISITOR?
  ---------------------------------------------------------------------------
  telegram-web-app.js defines `window.Telegram.WebApp` in EVERY browser, not
  just inside Telegram. The old check treated its mere presence as "this is a
  Mini App launch", so every normal website visitor was pushed through the
  Telegram booting spinner and — when Telegram (correctly) had no initData —
  saw "Telegram sign-in did not complete" over a perfectly valid saved session.
  That is the "website auto logouts" bug.

  A real Mini App launch has a non-empty initData, a real platform
  (android / ios / tdesktop / macos / web), or the signed payload in the URL.
  Outside Telegram `platform` is "unknown" and initData is empty.
*/
function isTelegramMiniApp(){
  try{
    const app = window.Telegram && window.Telegram.WebApp;
    if(app){
      if(app.initData) return true;
      if(app.initDataUnsafe && app.initDataUnsafe.user) return true;
      const platform = String(app.platform || "").toLowerCase();
      if(platform && platform !== "unknown") return true;
    }
    if(location.hash && location.hash.indexOf("tgWebAppData") !== -1) return true;
    if(location.search && location.search.indexOf("tgWebAppData") !== -1) return true;
  }catch(e){}
  return false;
}

/* Backwards-compatible alias (older code paths still call this name). */
function detectMiniAppLaunch(){
  return isTelegramMiniApp();
}

/*
  A saved token is "live" until the SERVER says otherwise. We no longer discard
  it on our own just because the page booted inside Telegram.
*/
function hasLiveSession(){
  try{ return Boolean(getSessionToken()); }catch(e){ return false; }
}

/* Show the login screen without destroying anything. */
function showLoginScreen(message){
  const dash = document.getElementById("dashboardScreen");
  const login = document.getElementById("loginScreen");
  if(dash) dash.style.display = "none";
  if(login) login.style.display = "";
  activateLoginForm();
  if(message) showLoginError(message);
}

/* Restore the interactive login form (undo the "signing in with Telegram" state). */
function activateLoginForm(){
  const booting = document.getElementById("telegramBooting");
  if(booting) booting.remove();

  const tabs = document.querySelector(".login-card .auth-tabs");
  if(tabs) tabs.classList.remove("hidden");
  document.querySelectorAll(".login-card .method-switch").forEach(function(el){
    el.classList.remove("hidden");
  });

  const activeTab = authTab === "register" ? "register" : "login";
  const loginArea = document.getElementById("loginFormArea");
  const registerArea = document.getElementById("registerFormArea");
  if(loginArea) loginArea.classList.toggle("hidden", activeTab !== "login");
  if(registerArea) registerArea.classList.toggle("hidden", activeTab !== "register");
}

/*
  Confirmed dead session (the server rejected BOTH the original request and the
  session probe). Only now do we clear the stored token.
*/
function expireSession(message){
  clearSession();
  clearDataCaches();
  currentUserId = null;
  currentTelegramId = null;
  dashboardData = null;
  currentOrders = [];
  selectedCountry = null;
  currentAccount = null;
  closeAllModals();
  showLoginScreen(message || "Your session has expired. Please sign in again.");
}

/*
  Show the "Signing you in with Telegram…" state when there is NO saved
  session at all. A returning user keeps their dashboard instantly instead.
*/
function bootTelegramSession(){
  const dash = document.getElementById("dashboardScreen");
  if(dash) dash.style.display = "none";

  showTelegramBooting();

  // Watchdog: still nothing after a few seconds (offline, rejected initData,
  // very slow cold start) → give the user the normal form back, with a reason.
  setTimeout(function(){
    if(getSessionToken()) return;
    showNormalLoginAfterTelegram(
      (window.__tgaTelegramAuthFailed && TELEGRAM_FAIL_MESSAGES[window.__tgaTelegramAuthFailed.reason]) ||
      "Telegram sign-in is taking longer than usual. You can log in with your details below, or reopen the store from the bot."
    );
  }, 9000);
}

/*
  Boot: paint the saved dashboard FIRST (zero network), then verify quietly.
  A network hiccup, a slow server or a Mini App re-auth never logs anyone out.
*/
function restoreSavedSession(){

  window.__tgaInTelegram = isTelegramMiniApp();

  const savedToken = getSessionToken();
  const savedId =
    localStorage.getItem("tga_user_id") ||
    localStorage.getItem("tga_telegram_id");

  if(savedToken){

    currentUserId = savedId;
    currentTelegramId =
      localStorage.getItem("tga_telegram_id") || savedId || "";

    showDashboard();

    // Background verification — never blocks the first paint.
    setTimeout(verifySavedSession, 60);

    return true;
  }

  // No usable saved session.
  clearSession();

  if(window.__tgaInTelegram){
    bootTelegramSession();
  }else{
    showLoginScreen();
  }

  return false;
}

/* Ask the server whether the stored token is still valid. */
async function probeSession(){
  const token = getSessionToken();
  if(!token) return false;

  try{
    const response = await fetch("/api/account?action=session", {
      method:"GET",
      headers:authHeaders(false),
      cache:"no-store"
    });
    if(!response.ok) return true; // server problem → keep the session
    const data = await response.json();
    if(data && typeof data.auth === "boolean") return data.auth;
    return true;
  }catch(e){
    // Offline / flaky network: never log the user out for that.
    return true;
  }
}

let verifyInFlight = false;

async function verifySavedSession(){
  if(verifyInFlight) return;
  verifyInFlight = true;

  try{
    const ok = await probeSession();
    if(ok) return;

    // Inside Telegram a fresh initData sign-in may be seconds away.
    if(window.__tgaInTelegram && typeof window.__tgaTelegramRetry === "function"){
      const refreshed = await window.__tgaTelegramRetry();
      if(refreshed) return;
    }

    const message = window.__tgaInTelegram
      ? "Telegram sign-in could not be refreshed. Log in with your details, or reopen the store from the bot."
      : "Your session has expired. Please sign in again.";

    expireSession(message);
  } finally {
    verifyInFlight = false;
  }
}

/*
  Keeps an actively used session alive (the server slides expiry on every
  authenticated call). Runs only while the dashboard is open and the tab is
  visible, so idle tabs cost nothing.
*/
function startSessionKeepAlive(){
  if(window.__tgaKeepAliveStarted) return;
  window.__tgaKeepAliveStarted = true;

  const tick = function(){
    if(document.visibilityState !== "visible") return;
    if(!getSessionToken()) return;
    const dash = document.getElementById("dashboardScreen");
    if(!dash || dash.style.display === "none") return;
    probeSession().then(function(ok){
      if(!ok && window.__tgaInTelegram && typeof window.__tgaTelegramRetry === "function"){
        try{ window.__tgaTelegramRetry().catch(function(){}); }catch(e){}
      }
    }).catch(function(){});
  };

  setInterval(tick, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible") tick();
  });
}


function showTelegramBooting(){

  const screen =
    document.getElementById(
      "loginScreen"
    );

  if(!screen) return;

  screen.style.display="";

  const card =
    screen.querySelector(
      ".login-card"
    );

  if(!card) return;

  // Keep the logo + brand, replace the form area with a quiet "signing in"
  // state, so a Mini App launch never flashes the password form.
  ["loginFormArea","registerFormArea","loginError"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.add("hidden");
  });

  const tabs = card.querySelector(".auth-tabs");
  if(tabs) tabs.classList.add("hidden");

  card.querySelectorAll(".method-switch").forEach(function(el){
    el.classList.add("hidden");
  });

  if(document.getElementById("telegramBooting")) return;

  const box =
    document.createElement("div");

  box.id = "telegramBooting";

  box.style.cssText =
    "margin-top:22px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--muted);font-size:13px;line-height:1.6";

  box.innerHTML =
    '<div class="spinner" style="width:26px;height:26px;border:2px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:bootSpin .8s linear infinite"></div>' +
    '<div>Signing you in with Telegram…</div>' +
    '<div style="font-size:12px;opacity:.75">If this takes more than a few seconds, reopen the store from the bot.</div>';

  card.appendChild(box);

  if(!document.getElementById("telegramBootSpinStyle")){

    const style =
      document.createElement("style");

    style.id = "telegramBootSpinStyle";

    style.textContent =
      "@keyframes bootSpin{to{transform:rotate(360deg)}}";

    document.head.appendChild(style);

  }
}


/*
  Telegram auto-login could not finish (expired initData, API unreachable,
  signature rejected…). Drop the "signing in" state and show the normal form so
  the user can still log in with ID / email / phone + password.
*/
function showNormalLoginAfterTelegram(customMessage){

  // A session may have been created in the meantime (manual login completed,
  // or the watcher already signed the user in). Never re-show the form or paint
  // an error over a live dashboard.
  try {
    if (hasLiveSession()) return;
  } catch (e) {}

  const booting =
    document.getElementById(
      "telegramBooting"
    );

  if(booting) booting.remove();

  const tabs = document.querySelector(".login-card .auth-tabs");
  if(tabs) tabs.classList.remove("hidden");
  document.querySelectorAll(".login-card .method-switch")
    .forEach(function(el){ el.classList.remove("hidden"); });

  const activeTab = authTab === "register" ? "register" : "login";
  const loginArea = document.getElementById("loginFormArea");
  const registerArea = document.getElementById("registerFormArea");
  if(loginArea) loginArea.classList.toggle("hidden", activeTab !== "login");
  if(registerArea) registerArea.classList.toggle("hidden", activeTab !== "register");

  showLoginError(
    customMessage ||
    "Telegram sign-in did not complete. Log in with your details, or reopen the store from the bot."
  );

  const screen =
    document.getElementById(
      "loginScreen"
    );

  if(screen) screen.style.display="";
}


/*
  Listen at parse time (not DOMContentLoaded): /telegram-app.js fails fast when
  Telegram's initData is rejected, possibly before the startup handler exists.
*/
var TELEGRAM_FAIL_MESSAGES = {
  not_in_telegram:
    "This page was opened in Telegram's normal browser, so Telegram did not share your account. Open the store from the bot's menu button (or its \u201cOpen Store\u201d button) to sign in automatically.",
  no_init_data:
    "Telegram did not share your account details this time. Close this window and open the store again from the bot's menu button.",
  bad_hash:
    "Telegram rejected this login. Please reopen the store from the bot \u2014 the bot connected to the store must be the same bot that opened it.",
  expired:
    "This Telegram login link has expired. Please reopen the store from the bot.",
  bot_token_missing:
    "Telegram login is not configured on the server (BOT_TOKEN is missing).",
  missing_user:
    "Telegram did not share your account details. Please reopen the store from the bot.",
  network:
    "Could not reach the store server. Check your connection and try again.",
  auth_date_in_future:
    "Your phone's clock looks wrong, so Telegram's login was rejected. Fix the date & time and reopen the store."
};

window.addEventListener("tga:telegram-auth-failed", function(event){

  const detail = (event && event.detail) || window.__tgaTelegramAuthFailed || {};
  const reason = typeof detail === "string" ? detail : detail.reason;

  showNormalLoginAfterTelegram(
    TELEGRAM_FAIL_MESSAGES[reason] ||
    "Telegram sign-in did not complete. Log in with your details below, or reopen the store from the bot."
  );
});


/* ==================================================
   STARTUP
================================================== */

window.addEventListener(
  "DOMContentLoaded",
  ()=>{

    // Restore the last known store theme instantly (the real value arrives
    // with /api/status a moment later).
    if(previewTheme){
      applySiteTheme(previewTheme);
      showThemePreviewBadge(previewTheme);
    }else{
      try{
        const cachedTheme = localStorage.getItem("tga_site_theme");
        if(cachedTheme){ applySiteTheme(cachedTheme); }
      }catch(e){}
    }

    loadTheme();

    updateThemeLockNote();

    checkMaintenance();

    // Maintenance/theme polling: once a minute, only while visible.
    setInterval(function(){
      if(document.visibilityState === "visible") checkMaintenance();
    }, 60000);

    const currencySelect =
      document.getElementById(
        "currencySelect"
      );

    if(currencySelect){

      currencySelect.value =
        currentCurrency;
    }

    restoreSavedSession();

    startSessionKeepAlive();

    if(window.__tgaTelegramAuthFailed){
      const failed = window.__tgaTelegramAuthFailed;
      showNormalLoginAfterTelegram(
        TELEGRAM_FAIL_MESSAGES[failed && failed.reason]
      );
    }

    // Telegram Mini App: /telegram-app.js signs the user in with the initData
    // Telegram handed to the page, then calls this hook. Defined unconditionally
    // so an early (cached) initData response never races the DOM.
    window.__tgaOpenDashboard = function(user){
      try{ sessionStorage.removeItem("tga_tg_reloaded"); }catch(e){}

      if(user){
        currentUserId = String(user.userId || user.telegramId || "");
        currentTelegramId = String(user.telegramId || currentUserId || "");
        if(user.username){
          try{ localStorage.setItem("tga_username", user.username); }catch(e){}
        }
        if(user.photoUrl){
          try{ localStorage.setItem("tga_photo", user.photoUrl); }catch(e){}
        }
        try{
          var first = user.firstName || user.first_name || "";
          var last = user.lastName || user.last_name || "";
          if(first) localStorage.setItem("tga_first_name", first);
          if(last) localStorage.setItem("tga_last_name", last);
        }catch(e){}
      }

      // Paint the Telegram name / @username / photo straight away so a Mini
      // App launch shows the real profile instantly instead of "User" while
      // /api/dashboard is still in flight. The API then refreshes the rest.
      if(user){
        try{ renderTelegramAccount(user); }catch(e){}
      }

      // Already showing this account (stale session restored, Telegram just
      // refreshed the token in the background): keep the screen as it is and
      // skip a duplicate /api/dashboard round-trip.
      const dashEl = document.getElementById("dashboardScreen");
      const alreadyOpen = dashEl && dashEl.style.display !== "none";
      const sameUser =
        !user ||
        !currentUserId ||
        !user.userId ||
        String(user.userId) === String(currentUserId);

      if(alreadyOpen && sameUser){
        if(typeof window.refreshIcons === "function"){
          try{ window.refreshIcons(document); }catch(e){}
        }
        return;
      }

      showDashboard();
    };


    /*
      Enter key on password.
    */

    document.getElementById(
      "passwordInput"
    ).addEventListener(
      "keydown",
      event=>{

        if(event.key==="Enter"){

          handleLogin();

        }

      }
    );

  }
);
