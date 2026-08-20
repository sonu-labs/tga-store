# 🛒 TGA Store — Telegram Account Store (Website + Admin Panel)

TGA Store ek dark-themed, mobile-friendly web store hai jisme users Telegram accounts (phone numbers + OTP) kharid sakte hain, wallet recharge kar sakte hain (UPI / FamPay / Binance Pay / Crypto), aur admin poore store ko ek panel se control karta hai. Website same MongoDB database use karti hai jo Telegram bot (`bot.py`) use karta hai.

> **Live URL:** https://tga-store.vercel.app
> **Admin Panel:** https://tga-store.vercel.app/admin
> **Admin Login:** https://tga-store.vercel.app/admin_login

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML + CSS + vanilla JavaScript (`public/`) — koi framework nahi |
| Backend | Node.js serverless functions (`api/`) — Vercel Functions |
| Database | MongoDB Atlas (database name: `TGAStoreBot`) |
| Auth | bcrypt-hashed passwords + Bearer token sessions (admin) |
| Telegram | Bot HTTP API (`api.telegram.org`) for sales/admin/buyer notifications |
| Number provider | **TG-Lion** (`https://TG-Lion.net`) — website ka ekmatra provider |
| Payments | UPI Gateway, FamPay, Binance Pay, OxaPay (USDT crypto) |
| Hosting | Vercel (static + serverless) |

Dependencies (`package.json`): `mongodb`, `bcryptjs`.

---

## 🗂️ File / Folder Structure

```
tga-store/
├── api/                        # Serverless backend functions
│   ├── login.js                # User login (Telegram ID / Email / Phone + password)
│   ├── account.js              # Register, change password, bot-connect token
│   ├── dashboard.js            # User dashboard: balance, orders, stats
│   ├── countries.js            # Live country list + stock + price (TG-Lion)
│   ├── buy.js                  # Purchase a number (deduct balance, call TG-Lion)
│   ├── code.js                 # Fetch OTP/code for a purchased number
│   ├── recharge.js             # Wallet recharge: create + verify (UPI/FamPay/Crypto/Binance)
│   ├── status.js               # Public maintenance check
│   ├── qr_proxy.js             # Proxy QR images (fixes hot-linking + download)
│   ├── admin.js                # Admin API (overview, logs, users, orders, settings)
│   └── admin_login.js          # Admin login → session token
│
├── lib/                        # Shared backend logic
│   ├── db.js                   # Mongo client, user lookup helpers, CORS
│   ├── auth.js                 # bcrypt hashing, email/phone validation, tokens
│   ├── site.js                 # Maintenance toggle, sessions, event logs
│   ├── money.js                # Selling price markup (USD → INR)
│   ├── payments.js             # UPI, FamPay, Binance, OxaPay integrations
│   ├── tglion.js               # TG-Lion API wrapper (country/number/code)
│   ├── server2.js              # Unified country fetch + profit margin
│   └── notify.js               # Telegram sales/admin/buyer notifications
│
├── public/                     # Static frontend (served as-is by Vercel)
│   ├── index.html              # User-facing store (single page app)
│   ├── admin.html              # Admin dashboard (single page app)
│   └── admin_login.html        # Admin login page
│
├── bot.py                      # Telegram bot (alag se hosted; website iske DB se share karti hai)
├── BOT_PATCH_INSTRUCTIONS.md   # Bot ke andar website login/register/connect ke patch notes
├── vercel.json                 # Vercel rewrites (/admin → admin.html)
└── package.json
```

---

## 👤 User Features (A to Z)

### 1. Authentication
- **Login methods:**
  - ✈️ **Telegram** — Telegram User ID + password (bot se `/start register` karke password milta hai)
  - 📧 **Email** — website pe register karke
  - 📱 **Phone** — country code ke saath (e.g. `+919876543210`)
- **Register** (website): username + email/phone + password (min 6 chars). Password bcrypt se hash hota hai.
- **Telegram registration** sirf bot se hoti hai (`/start register`) — bot strong auto-generated password deta hai.
- Legacy plain-password users automatically bcrypt hash me migrate ho jaate hain first login pe.

### 2. Home / Dashboard
- Welcome message + username
- 💳 **Total Balance** (INR stored; display currency USD / INR / USDT selectable)
- ⚡ **Total Recharge** count
- 🔑 **Total Orders** count
- 📢 Announcement section
- Live available countries (first 6 with stock)

### 3. Buy Page
- 250+ countries (flag, name, ISO code, dial code)
- 🔍 Live search (name / code / dial code)
- Real-time stock + price from TG-Lion
- **Price logic:** provider price (USD) pe 20% markup (`SELLING_MARKUP = 1.20`), then × ₹100 (INR). Example: provider $0.45 → selling $0.54 → **₹54.00**.
- "Buy Now" → terms modal → purchase → success modal with number.

### 4. Purchase Flow
1. User country select karta hai → price confirm karta hai.
2. `/api/buy` balance check karta hai, paise kaatta hai, TG-Lion se number kharidta hai.
3. Number turant milta hai; success modal me "Get OTP" button.
4. OTP aane par `/api/code` se code + password fetch hota hai.
5. Agar purchase ke beech me error aaye to **automatic refund** hota hai.
6. Teen Telegram notifications fire hote hain (fire-and-forget): public sales channel, private admin log, buyer DM.

### 5. Recharge / Wallet (`/api/recharge`)
| Method | Flow |
|---|---|
| 💳 **UPI Gateway** | Amount enter karo → QR generate → kisi bhi UPI app se pay karo → "Verify Payment" (auto-check). 60 min expiry. |
| 💳 **FamPay (UPI Gateway)** | Bina amount ke QR generate → **any amount** pay karo → verify. Duplicate transaction block. |
| 🅱️ **Binance Pay** | Pay ID + QR dikhta hai → Binance app se pay → Order ID / Txn ID daal kar verify. |
| 🪙 **Crypto (OxaPay)** | USDT amount (min 0.1) → OxaPay invoice → exact amount bhejo → "I Have Paid". Rate ₹90/USDT, 30 min expiry. |

- Recharge history (last 10 successful) UPI/Crypto/Binance sab combined.
- Admin panel se koi bhi gateway live on/off kiya ja sakta hai — turant reflect hota hai.

### 6. Orders Page
- Saari purchases ki list (country, number, OTP, date, price, status)
- Status: `purchased` (in progress / OTP pending) → `completed` (OTP received)
- Dates IST me (`Asia/Kolkata`)

### 7. Settings Page
- 🤖 **Bot Connect** — Telegram bot link generate karke account link karte hain (purchase alerts + future features)
- 🔒 **Change Password** (current + new; min 6 chars)
- 💱 **Currency** — USD / INR / USDT display
- 🌙 **Dark / Light theme** (localStorage me save)
- 📄 Terms & Conditions modal
- 📢 Telegram Channel link
- 🎧 Contact Support link
- 🚪 Logout

### 8. UX Details
- Mobile-first bottom navigation (Home / Buy / Recharge / Orders / Settings)
- Pull-to-refresh style header refresh button
- Maintenance mode pe poora UI block ho jaata hai (full-screen overlay)
- QR images apne `/api/qr_proxy` se serve hoti hain — broken image aur cross-origin download dono fix
- 30-second interval pe maintenance auto-check
- Session localStorage me (`tga_user_id`, `tga_telegram_id`, `tga_username`)

---

## 🛡️ Admin Panel Features (A to Z)

Admin panel `/admin` pe hai. Login `/admin_login` se. Admin credentials env vars me set hote hain (`ADMIN_ID`, `ADMIN_PASSWORD`) — **password kisi ko mat do, aur default ko production me badal dena**.

Admin session 7 din ka Bearer token hai (Mongo `sessions` collection me stored).

### 1. ◧ Overview Tab
Real-time dashboard with 9 stat cards:
- 👥 Total Users
- 🛒 Total Orders
- 💰 Revenue (completed + purchased orders ka sum)
- 💸 Total Recharged (paid transactions ka sum)
- ⏳ Buying Now (purchased / in-progress orders)
- ✅ Completed Orders
- 🔑 Successful Logins
- ❌ Failed Logins
- 🚫 Failed Buys

Neeche **Recent Activity** feed (last 25 logs) — login, buy, OTP, recharge sab events.

### 2. ≡ Activity Logs Tab
- Filter by type: All / Logins / Login Success / Login Failed / Buys / Buy Success / Buy Failed / OTP / Recharges
- 🔍 Search by username, number, country, message
- Table columns: Time (IST), Event pill, User, Details, Status
- Pagination via `limit`/`skip` (default 200, max 1000)

### 3. 👥 Users Tab
- Har user ka: Username, Telegram ID, Balance, Total Logins, Last Login, Total Orders, Buying Now (active), Failed Buys, Total Spent
- 🔍 Search by username ya numeric ID
- A → Z sorted
- Aggregations `orders` + `logs` collections se real-time calculate hote hain

### 4. 🛒 Orders Tab
- Saari purchases latest-first
- Columns: Time (IST), User (username + ID), Country (+ code), Number, OTP, Price (₹), Status pill
- Reload button

### 5. 💳 Recharge Tab
- Combined list of `transactions` + `crypto_invoices`
- Columns: Time (IST), User, Method (UPI / BINANCE / CRYPTO), Amount, Status, Order/Track ID
- FamPay ko UI me "UPI" dikhaya jaata hai (unified branding)
- Username lookup automatic (numeric + string + ObjectId forms match karke)

### 6. ⚙️ Settings Tab

#### 🛠️ Maintenance Mode
- One-tap on/off toggle
- Custom maintenance message (500 char max)
- "Last updated by admin · timestamp" dikhata hai
- On karne pe users ko poora store blocked dikhta hai (login + purchase + recharge sab); admin panel chalu rehta hai.

#### 💳 Payment Gateways
- **UPI Gateway switch:** UPI / FamPay / Disable — teeno buttons me se ek select. Yeh bot ke `/paymentsettings` ke equivalent hai.
- **Binance Pay toggle** (on/off) + Pay ID/QR preview
- **Crypto (OxaPay) toggle** — ₹90/USDT, min 0.1 USDT, 30 min expiry
- Env se UPI_ID, FAMPAY_UPI, BINANCE_PAY_ID, BINANCE_QR_URL display hote hain with copy buttons
- Changes DB `settings.payment_gateways` me save hote hain → bot + website dono pe turant lagu

#### 📡 TG-Lion Provider
- Active provider always **TG-Lion** (TGPVA ab supported nahi)
- **Profit Margin %** input — provider price ke upar add hota hai (Example: 20 = +20%). Yeh `/api/countries` ke prices aur purchase pricing dono ko affect karta hai.
- `settings.server_config.s2_profit` me save hota hai

#### Logout button
- Session token DB + browser dono se delete

### Admin Mobile UX
- Sidebar 820px se niche bottom nav me convert ho jaati hai (6 tabs)
- Tables horizontally scroll hote hain chhoti screen pe
- Auto-refresh every 20 seconds on Overview tab

---

## 🔌 API Endpoints Reference

### Public / User APIs
| Method | Endpoint | Kaam |
|---|---|---|
| GET | `/api/status` | Maintenance status (website har 30s poll karti hai) |
| GET | `/api/countries` | Live countries with stock + price from TG-Lion |
| POST | `/api/login` | Login (identifier + method + password) |
| POST | `/api/account?action=register` | Email/phone registration |
| GET/POST | `/api/account?action=bot-connect` | Bot connect token create / status check |
| POST | `/api/account?action=change-password` | Password update |
| GET | `/api/dashboard?userId=` | Balance, orders, total stats |
| POST | `/api/buy` | Purchase number `{userId, country_code}` |
| POST | `/api/code` | Get OTP `{userId, number}` |
| GET | `/api/recharge?action=settings` | Available payment methods |
| GET | `/api/recharge?action=history&userId=` | Last 10 paid recharges |
| POST | `/api/recharge?action=create` | UPI/FamPay/Crypto/Binance invoice create |
| POST | `/api/recharge?action=verify` | Payment verify + balance credit |
| GET | `/api/qr_proxy?url=&dl=` | QR image proxy (display + download) |

### Admin APIs (Bearer token required)
| Method | Endpoint | Kaam |
|---|---|---|
| POST | `/api/admin_login` | `{id, password}` → token |
| GET | `/api/admin?action=overview` | Dashboard stats + recent logs |
| GET | `/api/admin?action=logs&type=&q=` | Filter/search logs |
| GET | `/api/admin?action=users&q=` | User list with stats |
| GET | `/api/admin?action=orders` | All orders |
| GET | `/api/admin?action=recharges` | All transactions + crypto |
| GET/POST | `/api/admin?action=maintenance` | Get / toggle maintenance |
| GET/POST | `/api/admin?action=payments` | Get / update gateway settings |
| GET/POST | `/api/admin?action=server_config` | TG-Lion profit % |
| POST | `/api/admin?action=logout` | Session destroy |

---

## 🗄️ MongoDB Collections

Database name: **`TGAStoreBot`** (bot.py bhi same use karta hai).

| Collection | Purpose |
|---|---|
| `users` | `_id` (numeric Telegram ID ya ObjectId), `telegram_id`, `username`, `email`, `phone`, `balance` (INR), `password_hash`, `bot_connected`, `created_at`, `joined_at` |
| `orders` | `user_id`, `country`, `country_code`, `number`, `otp`, `pass`, `price` (INR), `provider_price` (USD), `status` (`purchased`/`completed`), `provider`, `created_at`, `code_at` |
| `transactions` | UPI/FamPay/Binance recharges: `_id` (order id), `user_id`, `method`, `amount`, `status` (`pending`/`paid`), `created_at`, `settled_at`, `expires_at`, `claimed_txn` |
| `crypto_invoices` | OxaPay invoices: `user_id`, `track_id`, `order_id`, `amount_usdt`, `amount_inr`, `status`, `payment_url`, `created_at` |
| `logs` | Event log: `type` (login/buy/otp/recharge/register), `status`, `user_id`, `username`, `country`, `number`, `message`, `price`, `created_at` |
| `settings` | Singleton docs: `_id: "maintenance"`, `_id: "payment_gateways"`, `_id: "server_config"` |
| `sessions` | Admin sessions: `_id` (token), `role: "admin"`, `id`, `created_at` — 7-day TTL |
| `connect_tokens` | Bot-connect links: `_id` (hex token), `userId`, `created_at` — 15-minute expiry |

---

## ⚙️ Environment Variables

Vercel project me ye sab set karne hain. **Koi bhi real password / API key yahan nahi likhi — apne values daalo.**

### Database
| Var | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (required) |

### Admin Login
| Var | Description |
|---|---|
| `ADMIN_ID` | Admin username (default `admin`) |
| `ADMIN_PASSWORD` | Admin password — **production me strong rakho, default mat chhodo** |

### Telegram Bot
| Var | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token (sales/admin/buyer notifications ke liye) |
| `SALES_CHAT_ID` / `SALES` | Public sales channel (e.g. `-1002254383562`) |
| `ADMIN_LOG_CHAT_ID` / `ADMINLOG` | Private admin log group (e.g. `-1003441797589`) |
| `BOT_USERNAME` / `BOTUSER` | Bot username without @ (e.g. `TGAStore1Bot`) |
| `BOT_CHANNEL` / `CHANNEL` | Channel username without @ (e.g. `TGAForu`) |

### TG-Lion (Number Provider)
| Var | Description |
|---|---|
| `TG_LION_API_KEY` | TG-Lion API key (required for countries + purchase) |
| `TG_LION_YOUR_ID` | TG-Lion YourID (required) |

### UPI Gateway
| Var | Description |
|---|---|
| `UPI_API_KEY` | UPI payment link API key |
| `UPI_API_URL` | UPI API endpoint (default `https://bot.jackdev.tech/paymentlinkbot/api.php`) |
| `UPI_ID` | UPI ID jo users ko dikhta hai (copy-able) |
| `DEFAULT_INR_GATEWAY` | `upi` ya `fampay` (admin panel se override ho sakta hai) |

### FamPay
| Var | Description |
|---|---|
| `FAMPAY_UPI` | FamPay UPI ID |
| `FAMPAY_API_KEY` | FamPay verify API key |
| `FAMPAY_QR_API_URL` | QR generate endpoint (default `https://anujbots.xyz/api/qr.php`) |
| `FAMPAY_VERIFY_API_URL` | Verify endpoint (default `https://fampay.anujbots.xyz/verify.php`) |

### Binance Pay
| Var | Description |
|---|---|
| `BINANCE_PAY_ID` | Binance Pay ID (users ko dikhta hai) |
| `BINANCE_QR_URL` | Binance QR image URL |
| `BINANCE_API_KEY` | Binance API key (verify ke liye) |
| `BINANCE_SECRET` | Binance API secret |

### OxaPay (Crypto)
| Var | Description |
|---|---|
| `OXAPAY_API_KEY` | OxaPay merchant API key |

> **Note:** Recharge rate `USDT_TO_INR = 90` aur `MIN_USDT = 0.1` code me constant hain (`lib/payments.js`). Badalna ho to wahan edit karo.

---

## 🚀 Deployment (Vercel)

1. GitHub repo ko Vercel se connect karo.
2. Framework preset: **Other** (plain static + functions).
3. Build command: khaali (koi build nahi).
4. Output directory: khaali / root.
5. Saari environment variables upar wali table ke hisaab se Vercel dashboard me daalo.
6. Deploy. `vercel.json` automatically `/admin` → `/admin.html` route kar deta hai.
7. `api/` ke saare files automatically serverless functions ban jaate hain.

### Local dev
```bash
npm install
vercel dev          # agar Vercel CLI hai
# ya sirf static files kisi bhi static server se serve karo (api functions ke liye Vercel env chahiye)
```

---

## 🤖 Telegram Bot Integration (`bot.py`)

Website aur bot ek hi MongoDB database share karte hain. `BOT_PATCH_INSTRUCTIONS.md` me ye patches hain jo bot ke andar daalne hain (manually):

- `/start register` aur `/start login` handlers — website account ke liye strong password generate karke user ko DM + admin log
- `/start connect_<token>` — website Settings → Bot Connect se generate link ko accept karta hai, user ka `telegram_id` link karta hai
- `/changepassword old new` command
- `users.password_hash` (bcrypt), `users.telegram_id`, `users.bot_connected` fields use hote hain
- Website purchase pe bot automatically sales channel, admin log, aur buyer DM bhej deti hai (alag se bot code ki zaroorat nahi)

Bot ko restart karna padta hai patches paste karne ke baad.

---

## 💰 Pricing & Money Logic

- **Wallet balance INR me store hota hai** (`users.balance`).
- **Display currency** user select karta hai: USD / INR / USDT. Conversion: ₹100 = $1 = 1 USDT (`INR_PER_USDT = 100`).
- **Provider price** TG-Lion se USD me aata hai (e.g. 0.45).
- **Selling price** = provider USD × 1.20 (20% markup) → × 100 = INR. Example: 0.45 × 1.20 = 0.54 USD = **₹54.00**.
- **Admin profit margin** (Settings → TG-Lion) provider price ke upar extra % add karta hai before the 20% selling markup — dono combine hote hain.
- **Crypto recharge** pe 1 USDT = ₹90 wallet credit (provider rate alag, selling rate alag).

---

## 🧰 Troubleshooting

| Problem | Check |
|---|---|
| "Could not load history" recharge me | `/api/recharge` logs dekho — ab sahi error message ata hai. Mostly MONGODB_URI ya user resolution issue. |
| Countries nahi dikh rahe | `TG_LION_API_KEY` + `TG_LION_YOUR_ID` env set hai? TG-Lion API reachable hai? |
| Buy "Insufficient balance" | User ka `users.balance` INR me hai; price ₹ me charge hoti hai. Old orders me <20 values USD treat hoti hain. |
| UPI QR nahi dikh raha | `UPI_API_KEY` set hai? `/api/qr_proxy` logs dekho — upstream image block to nahi kar raha. |
| OTP nahi aa raha | TG-Lion balance check karo (`checkS2ApiBalance`). Number status "Received" hone do. |
| Admin login invalid | `ADMIN_ID` / `ADMIN_PASSWORD` env vars match karo. `sessions` collection me stale token nahi hona chahiye. |
| Maintenance hat nahi raha | `settings` collection me `_id: "maintenance"` doc delete kar do ya admin panel se toggle karo. |
| Login "Database connection error" | MONGODB_URI missing / Atlas IP allowlist / network issue. |

---

## 🔒 Security Notes

- User passwords hamesha bcrypt (`SALT_ROUNDS = 10`) se hash hote hain; plain text kabhi store nahi hota (legacy auto-migrate hota hai).
- Admin session tokens 32-byte random hex hote hain; 7 din baad invalidate.
- Saare APIs CORS `*` allow karte hain (public read APIs) lekin admin actions Bearer token maangte hain.
- QR proxy sirf `http`/`https` URLs fetch karta hai; content-type image hi hone chahiye.
- Maintenance mode on karne pe login/buy/recharge/dashboard sab 503 dete hain — sirf admin panel aur `/api/status` chalu rehte hain.
- **Production me hamesha:** `ADMIN_PASSWORD` strong rakho, default `adminlogin123` ko replace karo, MONGODB_URI ko Vercel env me hi rakho (code me commit mat karo).

---

## 📝 Editing This README

Is file ko apne hisaab se edit kar sakte ho — URLs, support links, Telegram channel (@tgaforu / @OfcCuteSmile / @TGAStore1Bot), prices, ya naye features add karne ho to yahi update kar do. **Sirf passwords / API keys / Bot token is file me kabhi mat likho** — woh hamesha Vercel environment variables me raho.
