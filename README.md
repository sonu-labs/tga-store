# 🛒 TGA Store — Telegram Account Store (Website + Admin Panel)

TGA Store is a dark-themed, mobile-friendly web store where users can buy Telegram accounts (phone numbers + OTP), top up their wallet (UPI / FamPay / Binance Pay / Crypto), and an admin can control the entire store from one panel. The website shares the same MongoDB database used by the Telegram bot (`bot.py`).

> **Live URL:** https://tga-store.vercel.app
> **API Docs:** https://tga-store.vercel.app/docs
> **Admin Panel:** https://tga-store.vercel.app/admin
> **Admin Login:** https://tga-store.vercel.app/admin_login

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML + CSS + vanilla JavaScript (`public/`) — no framework |
| Backend | Node.js serverless function (`api/[...slug].js`) — Vercel Functions |
| Database | MongoDB Atlas (database name: `TGAStoreBot`) |
| Auth | bcrypt-hashed passwords + Bearer token sessions (admin) |
| Telegram | Bot HTTP API (`api.telegram.org`) for sales/admin/buyer notifications |
| Number provider | **TG-Lion** (`https://TG-Lion.net`) — the website's only provider |
| Payments | UPI Gateway, FamPay, Binance Pay, OxaPay (USDT crypto) |
| Hosting | Vercel (static + serverless) |

Dependencies (`package.json`): `mongodb`, `bcryptjs`.

---

## 🗂️ File / Folder Structure

```
tga-store/
├── api/                        # ONE serverless Function (catch-all router)
│   └── [...slug].js            # Single `/api/*` Function → dispatches to lib/routes/*
│
├── lib/                        # Shared backend logic
│   ├── routes/                 # Route handlers (regular modules, NOT deployed as Functions)
│   │   ├── login.js            # User login (Telegram ID / Email / Phone + password)
│   │   ├── account.js          # Register, change password, bot-connect token
│   │   ├── dashboard.js        # User dashboard: balance, orders, stats
│   │   ├── countries.js        # Live country list + stock + price (TG-Lion)
│   │   ├── buy.js              # Purchase a number (deduct balance, call TG-Lion)
│   │   ├── code.js             # Fetch OTP/code for a purchased number
│   │   ├── recharge.js         # Wallet recharge: create + verify (UPI/FamPay/Crypto/Binance)
│   │   ├── status.js           # Public maintenance check
│   │   ├── qr_proxy.js         # Proxy QR images (fixes hot-linking + download)
│   │   ├── admin.js            # Admin API (overview, logs, users, orders, settings)
│   │   ├── admin_login.js      # Admin login → session token
│   │   ├── apikey.js           # User API key management
│   │   ├── telegram.js         # Mini App sign-in (verify initData → session)
│   │   └── v1.js               # Public developer API (TGA Store API)
│   ├── db.js                   # Mongo client, user lookup helpers, CORS
│   ├── auth.js                 # bcrypt hashing, email/phone validation, tokens
│   ├── site.js                 # Maintenance toggle, sessions, event logs
│   ├── money.js                # Selling price markup (USD → INR)
│   ├── payments.js             # UPI, FamPay, Binance, OxaPay integrations
│   ├── tglion.js               # TG-Lion API wrapper (country/number/code)
│   ├── server2.js              # Unified country fetch + profit margin
│   ├── themes.js               # Store theme catalog (22 full-UI themes) + get/set
│   ├── telegramAuth.js         # Telegram WebApp initData verification (HMAC)
│   └── notify.js               # Telegram sales/admin/buyer notifications
│
├── public/                     # Static frontend (served as-is by Vercel)
│   ├── assets/                 # Logo + payment photos (circle-cropped in CSS)
│   │   ├── logo.png            # TGA Store logo
│   │   ├── upi.png             # UPI recharge icon
│   │   ├── binance.png         # Binance Pay icon
│   │   └── crypto.png          # Crypto / USDT icon
│   ├── index.html              # User-facing store (single page app)
│   ├── docs.html               # Standalone API Docs page (served at /docs)
│   ├── app-extras.js           # Emoji, header menu, /docs redirect, pricing modal
│   ├── telegram-app.js         # Telegram Mini App auto sign-in (initData → /api/telegram)
│   ├── theme-ui.css            # Full-UI theme engine (all 22 store themes)
│   ├── admin.html              # Admin dashboard (single page app)
│   └── admin_login.html        # Admin login page
│
├── dev/                        # Local development helpers (never deployed)
│   └── preview-server.js       # Static server + mock API for previewing themes
│
├── bot.py                      # Telegram bot (hosted separately; website shares its DB)
├── BOT_PATCH_INSTRUCTIONS.md   # Patch notes for website login/register/connect inside the bot
├── vercel.json                 # Vercel rewrites (/admin → admin.html)
└── package.json
```

---

## 👤 User Features (A to Z)

### 1. Authentication
- **Login methods:**
  - ✈️ **Telegram** — Telegram User ID + password (get the password from the bot via `/start register`)
  - 📧 **Email** — register on the website
  - 📱 **Phone** — with country code (e.g. `+919876543210`)
- **Telegram Mini App (automatic)** — when the page is opened from the bot
  (menu button "Store", the "Open Store" button after `/start register`, or any
  `web_app` button) Telegram hands the page a signed `initData` payload. It is
  posted to `POST /api/telegram`, verified server-side (HMAC-SHA256 with
  `BOT_TOKEN`, see `lib/telegramAuth.js`), and the user is signed in
  automatically: Telegram id, name, username, photo and balance are all filled
  in — no ID/password typing. A brand-new Telegram user gets a `users` document
  with the numeric Telegram id as `_id`, exactly like `bot.py` does, so balance
  and purchases are shared with the bot.
- **Register** (website): username + email/phone + password (min 6 chars). The password is hashed with bcrypt.
- **Telegram registration** is only done through the bot (`/start register`) — the bot generates a strong auto-generated password.
- Legacy plain-text passwords are automatically migrated to a bcrypt hash on first login.

### 2. Home / Dashboard
- Welcome message + username
- 💳 **Total Balance** (stored in INR; display currency selectable as USD / INR / USDT)
- ⚡ **Total Recharge** count
- 🔑 **Total Orders** count
- 📢 Announcement section
- Live available countries (first 6 with stock)

### 3. Buy Page
- 250+ countries (flag, name, ISO code, dial code)
- 🔍 Live search (name / code / dial code)
- Real-time stock and price from TG-Lion
- **Price logic:** a 20% markup is applied on the provider price (USD) via `SELLING_MARKUP = 1.20`, then × ₹100 (INR). Example: provider $0.45 → selling $0.54 → **₹54.00**.
- "Buy Now" → terms modal → purchase → success modal with the number.

### 4. Purchase Flow
1. User selects a country and confirms the price.
2. `/api/buy` checks the balance, deducts payment, and buys the number from TG-Lion.
3. The number is returned instantly; the success modal shows a "Get OTP" button.
4. When the OTP arrives, `/api/code` fetches the code + password.
5. If there is an error during purchase, an **automatic refund** is issued.
6. Three Telegram notifications are fired (fire-and-forget): public sales channel, private admin log, and buyer DM.

### 5. Recharge / Wallet (`/api/recharge`)
| Method | Flow |
|---|---|
| 💳 **UPI Gateway** | Enter an amount → generate a QR → pay with any UPI app → tap "Verify Payment" (auto-check). Expires in 60 minutes. |
| 💳 **FamPay (UPI Gateway)** | Generate a QR without an amount → pay **any amount** → verify. Duplicate transactions are blocked. |
| 🅱️ **Binance Pay** | Pay ID + QR shown → pay in the Binance app → enter Order ID / Txn ID to verify. |
| 🪙 **Crypto (OxaPay)** | USDT amount (min 0.1) → OxaPay invoice → send the exact amount → "I Have Paid". Rate ₹90/USDT, expires in 30 minutes. |

- Recharge history shows the last 10 successful recharges, combining UPI/Crypto/Binance.
- Any gateway can be turned on/off live from the admin panel — changes reflect instantly.

### 6. Orders Page
- List of all purchases (country, number, OTP, password, date, price, status)
- 📩 **Get OTP** button on every order — select the account you bought and tap it to fetch the OTP/password from TG-Lion without leaving the page. Works for both the success modal and any past order in the history.
- Status: `purchased` (in progress / OTP pending) → `completed` (OTP received)
- Dates shown in IST (`Asia/Kolkata`)

### 7. Settings Page
- 📖 **API Docs** — opens the standalone developer API page at **`/docs`** (key generation, request logs, live test area). Also linked from the login screen top corner and the header ⋯ menu
- 🤖 **Bot Connect** — generate a Telegram bot link to connect the account (purchase alerts + future features)
- 🔒 **Change Password** (current + new; min 6 chars)
- 💱 **Currency** — USD / INR / USDT display
- 🌙 **Dark / Light theme** (saved in localStorage — only active on the `default` store theme; every other theme ships its own complete look and the row shows which one is live)
- 📄 Terms & Conditions modal
- 📢 Telegram Channel link
- 🎧 Contact Support link
- 🚪 Logout

### 8. UX Details
- Mobile-first bottom navigation (Home / Buy / Recharge / Orders / Settings)
- Header refresh button (pull-to-refresh style)
- In maintenance mode the entire UI is blocked (full-screen overlay)
- QR images are served through our own `/api/qr_proxy` — fixes both broken images and cross-origin downloads
- Maintenance is auto-checked every 30 seconds
- Session stored in localStorage (`tga_user_id`, `tga_telegram_id`, `tga_username`)

---

## 🛡️ Admin Panel Features (A to Z)

The admin panel is at `/admin`. Login is at `/admin_login`. Admin credentials are set via environment variables (`ADMIN_ID`, `ADMIN_PASSWORD`) — **there is no default password in the code. If these env vars are missing, admin login is disabled.**

An admin session is a 7-day Bearer token stored in the MongoDB `sessions` collection.

### 1. ◧ Overview Tab
Real-time dashboard with 9 stat cards:
- 👥 Total Users
- 🛒 Total Orders
- 💰 Revenue (sum of completed + purchased orders)
- 💸 Total Recharged (sum of paid transactions)
- ⏳ Buying Now (purchased / in-progress orders)
- ✅ Completed Orders
- 🔑 Successful Logins
- ❌ Failed Logins
- 🚫 Failed Buys

Below it is a **Recent Activity** feed (last 25 logs) — login, buy, OTP, and recharge events.

### 2. ≡ Activity Logs Tab
- **← Back** button at the top (returns to Overview)
- Two tabs — **👥 User Logs** (default) and **⌁ API Logs** — whichever the admin selects is the log that shows:
  - **User Logs:** filter by type (All / Logins / Login Success / Login Failed / Buys / Buy Success / Buy Failed / OTP / Recharges) + 🔍 search by username, number, country, message. Columns: Time (IST), Event pill, User, Details, Status. Pagination via `limit`/`skip` (default 200, max 1000).
  - **API Logs:** developer API request audit trail with the creator details (username/email/phone/Telegram ID), masked API key, action, request params and status code. 🔍 Search by username, email, phone, action or key prefix.

### 3. 👥 Users Tab
- For every user: Username, Telegram ID, Balance, Total Logins, Last Login, Total Orders, Buying Now (active), Failed Buys, Total Spent
- 🔍 Search by username or numeric ID
- Sorted A → Z
- Aggregations are calculated in real-time from the `orders` + `logs` collections

### 4. 🛒 Orders Tab
- All purchases, newest first
- Columns: Time (IST), User (username + ID), Country (+ code), Number, OTP, Price (₹), Status pill
- Reload button

### 5. 💳 Recharge Tab
- Combined list of `transactions` + `crypto_invoices`
- Columns: Time (IST), User, Method (UPI / BINANCE / CRYPTO), Amount, Status, Order/Track ID
- FamPay is shown as "UPI" in the UI (unified branding)
- Username lookup is automatic (matches numeric + string + ObjectId forms)

### 6. ⚙️ Settings Tab

#### 🛠️ Maintenance Mode
- One-tap on/off toggle
- Custom maintenance message (max 500 chars)
- Shows "Last updated by admin · timestamp"
- When enabled, users see the whole store blocked (login + purchase + recharge); the admin panel stays live.

#### 💳 Payment Gateways
- **UPI Gateway switch:** UPI / FamPay / Disable — select one of the three buttons. This is equivalent to the bot's `/paymentsettings`.
- **Binance Pay toggle** (on/off) + Pay ID/QR preview
- **Crypto (OxaPay) toggle** — ₹90/USDT, min 0.1 USDT, 30 min expiry
- Displays UPI_ID, FAMPAY_UPI, BINANCE_PAY_ID, BINANCE_QR_URL from the environment with copy buttons
- Changes are saved to DB `settings.payment_gateways` → applied instantly to both bot and website

#### 📡 TG-Lion Provider
- The active provider is always **TG-Lion** (TGPVA is no longer supported)
- **Profit Margin %** input — added on top of the provider price (e.g. 20 = +20%). It affects both `/api/countries` prices and purchase pricing.
- Saved to `settings.server_config.s2_profit`

#### 🔑 API Keys
- Lists **every API key created by every user** — full key (with copy button), owner (username + Telegram/account ID), how many keys that user has, total requests made with the key, created + last-used times
- Summary pill up top: total users, total keys, total requests
- Backed by `GET /api/admin?action=api_keys` (joins `api_keys` + `users` + `api_logs` request counts)

#### 🎨 Store Theme
- 22 selectable themes; each one is a **full UI redesign** of the user store (layout, shapes, fonts, buttons, animations, backgrounds) — see the [Store Themes](#-store-themes-22-full-ui-themes) section
- Click a card to apply it instantly for every visitor; 👁 **Live preview** opens the store with that theme in a new tab without saving
- The admin panel itself never changes its look

#### Logout button
- Deletes the session token from both DB and browser

### Admin Mobile UX
- Below 820px the sidebar converts to a bottom nav (6 tabs)
- Tables scroll horizontally on small screens
- Auto-refreshes every 20 seconds on the Overview tab

---

## 🎨 Store Themes (22 full-UI themes)

The admin picks one theme in **Admin → Settings → 🎨 Store Theme** and the whole
user store rebuilds itself for every visitor. These are **not colour swaps** —
each theme changes layout, card shapes, typography, navigation style, button
behaviour, hover/press animations, page transitions, loading spinners and
background effects.

| # | Theme | What changes |
|---|---|---|
| 1 | 🌑 **Default** | Original TGA dark store — rounded cards, floating pill nav |
| 2 | 💎 **Glass** | Fully transparent frosted UI, heavy blur, drifting light blobs |
| 3 | 🫧 **Neumorphic** | Borderless puffy cards, soft dual shadows, press-in buttons |
| 4 | 🧱 **Neo Brutalist** | Zero radius, 3px black borders, offset shadows, snap hovers |
| 5 | 🖥️ **Terminal** | Monospace console, scanlines, `[ BRACKET ]` buttons, typing caret |
| 6 | 👾 **Retro Arcade** | Neon grid horizon, pixel edges, blinking labels, chunky press |
| 7 | 🌈 **Aurora** | Animated mesh gradient, giant soft cards, gradient text, slide pages |
| 8 | 📒 **Paper** | Ruled notebook texture, dashed borders, tilted taped cards |
| 9 | 📰 **Editorial** | Magazine serif type, hairline rules, full-width text nav, no shadows |
| 10 | 📊 **Pro Console** | Dense dashboard, 6-column grid, left side rail nav on desktop |
| 11 | 🛰️ **Cyber HUD** | Clipped corners, corner ticks, radar sweep, glitch hovers |
| 12 | 🥂 **Luxe** | Gold hairlines, serif caps, shimmering titles, slow elegant fades |
| 13 | 🍬 **Candy Pop** | Extra-round cards, spring easing, wiggle hover, bouncy nav |
| 14 | ◼️ **Swiss** | Strict grid, no radius/shadow, invert-on-hover tiles, huge type |
| 15 | 🌿 **Organic** | Asymmetric blob radii, earthy palette, gentle sway animation |
| 16 | 🌴 **Vaporwave** | Chrome sunset, retro grid floor, italic display, glow buttons |
| 17 | 🟦 **Metro Tiles** | Flat coloured square tiles, 3D tile press, full-width tile nav |
| 18 | 🧸 **Claymorphism** | Fat 3D clay shapes, inner highlights, squish press |
| 19 | 🌊 **Deep Abyss** | Rising bubbles, wave glow, floating cards, deep blue depth |
| 20 | ⚙️ **Industrial** | Brushed metal gradients, rivets, condensed caps, mechanical press |
| 21 | 🌸 **Zen Sakura** | Falling petals, airy spacing, serif headings, very soft motion |
| 22 | 🌌 **Midnight Pro** | Gradient hero balance card, indigo glow, modern product feel |

**How it works**

- `lib/themes.js` — the catalog (id, name, emoji, description, UI summary, swatch colours). Old colour-only theme ids (`neon`, `matrix`, `slate`, …) are auto-mapped to their closest new theme, so existing stores keep working.
- `GET/POST /api/admin?action=theme` — read/save the active theme (`settings.site_config.theme`).
- `GET /api/status` — returns the active theme to the store front-end.
- `public/theme-ui.css` — the theme engine: shared `--t-*` design tokens plus one block per theme, all scoped to `body[data-theme="<id>"]`. The default theme sets no attribute, so its original CSS is untouched.
- `public/index.html` — applies the theme, caches it in `localStorage` (`tga_site_theme`) so there is no flash on reload, and hosts the ambient FX layer (`.theme-fx`) used for bubbles/petals/blobs/grids/scanlines.
- **Live preview:** every card in the admin theme picker has a 👁 button that opens the store at `/?preview_theme=<id>` — that tab only, nothing is saved for real visitors.

---

## 🔌 API Endpoints Reference

### Public / User APIs
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/status` | Maintenance status (website polls every 30s) |
| GET | `/api/countries` | Live countries with stock + price from TG-Lion |
| POST | `/api/login` | Login (identifier + method + password) |
| POST | `/api/account?action=register` | Email/phone registration |
| GET/POST | `/api/account?action=bot-connect` | Create bot-connect token / check status |
| POST | `/api/account?action=change-password` | Update password |
| GET | `/api/dashboard?userId=` | Balance, orders, total stats |
| POST | `/api/buy` | Purchase number `{userId, country_code}` |
| POST | `/api/code` | Get OTP `{userId, number, orderId?}` |
| GET | `/api/recharge?action=settings` | Available payment methods |
| GET | `/api/recharge?action=history&userId=` | Last 10 paid recharges |
| POST | `/api/recharge?action=create` | Create UPI/FamPay/Crypto/Binance invoice |
| POST | `/api/recharge?action=verify` | Verify payment + credit balance |
| GET | `/api/qr_proxy?url=&dl=` | QR image proxy (display + download) |
| GET/POST | `/api/apikey?action=list/generate/revoke/logs` | User API key management and personal API request logs |
| GET/POST | `/api/telegram` | Mini App sign-in. `POST {initData}` → session token; `GET` → `{bot_username}` |
| GET/POST | `/api/v1?action=…` | Public developer API (see below) |

### Developer API (`/api/v1`) — "TGA Store API"
Documented on the standalone **API Docs page at `/docs`** (linked from the
login screen top corner, the header ⋯ menu, and Settings → API Docs). Every
"API Docs" entry point opens that page. Each user generates their own
`apiKey` on the page (key management + live test area included).

| Action | Parameters | Returns |
|---|---|---|
| `available_countries` | `apiKey` | All countries with stock/price |
| `country_info` | `apiKey`, `country_code?` | One country (or all) |
| `get_balance` | `apiKey` | Balance in USD |
| `getNumber` | `apiKey`, `country_code` | Buys a number (deducts balance) |
| `getCode` | `apiKey`, `number` | Login code + password for a purchase |

Example: `GET /api/v1?action=getNumber&apiKey=TGA_…&country_code=uz`

### Telegram Mini App sign-in
| Piece | File | What it does |
|---|---|---|
| SDK | `index.html`, `docs.html` | `<script src="https://telegram.org/js/telegram-web-app.js">` — first script on the page |
| Client | `public/telegram-app.js` | Reads `Telegram.WebApp.initData`, posts it to `/api/telegram`, saves the session like a normal login, opens the dashboard. No-op outside Telegram. Shows a short "Signing you in…" state, and falls back to the normal login form if verification fails |
| Verify | `lib/telegramAuth.js` | HMAC-SHA256 check (`WebAppData` + `BOT_TOKEN`), `auth_date` must be < 24 h old, `user.id` required |
| Route | `lib/routes/telegram.js` | Finds the user by numeric Telegram id (or `telegram_id`), creates it if missing (bot-compatible document), refreshes name/username/photo, returns a normal session token |
| Bot | `bot.py` | `set_chat_menu_button(MenuButtonWebApp(...))` on startup + `web_app` button after `/start register`; store URL comes from `WEBSITE_URL` (default `https://tga-store.vercel.app`) |

Requirements: the URL must be HTTPS and served from a domain the bot can use as
a Mini App. Nothing else is needed — the signature check uses the same
`BOT_TOKEN` the bot already has.

### Emoji
The user UI uses normal system emoji only. Telegram premium/custom emoji IDs and Lottie assets are not used.

### Admin APIs (Bearer token required)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin_login` | `{id, password}` → token |
| GET | `/api/admin?action=overview` | Dashboard stats + recent logs |
| GET | `/api/admin?action=logs&type=&q=` | Filter/search store logs |
| GET | `/api/admin?action=api_logs&q=` | API request logs with creator details (shown in Activity Logs → API Logs tab) |
| GET | `/api/admin?action=api_keys` | Every API key of every user (key, owner, created/last-used, request counts) — Settings tab |
| GET | `/api/admin?action=users&q=` | User list with stats |
| GET | `/api/admin?action=orders` | All orders |
| GET | `/api/admin?action=recharges` | All transactions + crypto |
| GET/POST | `/api/admin?action=maintenance` | Get / toggle maintenance |
| GET/POST | `/api/admin?action=payments` | Get / update gateway settings |
| GET/POST | `/api/admin?action=server_config` | TG-Lion profit % |
| POST | `/api/admin?action=logout` | Destroy session |

---

## 🗄️ MongoDB Collections

Database name: **`TGAStoreBot`** (also used by `bot.py`).

| Collection | Purpose |
|---|---|
| `users` | `_id` (numeric Telegram ID or ObjectId), `telegram_id`, `username`, `first_name`, `last_name`, `photo_url`, `email`, `phone`, `balance` (INR), `password_hash`, `bot_connected`, `auth_method`, `created_at`, `joined_at` |
| `orders` | `user_id`, `country`, `country_code`, `number`, `otp`, `pass`, `price` (INR), `provider_price` (USD), `status` (`purchased`/`completed`), `provider`, `created_at`, `code_at` |
| `transactions` | UPI/FamPay/Binance recharges: `_id` (order id), `user_id`, `method`, `amount`, `status` (`pending`/`paid`), `created_at`, `settled_at`, `expires_at`, `claimed_txn` |
| `crypto_invoices` | OxaPay invoices: `user_id`, `track_id`, `order_id`, `amount_usdt`, `amount_inr`, `status`, `payment_url`, `created_at` |
| `logs` | Event log: `type` (login/buy/otp/recharge/register), `status`, `user_id`, `username`, `country`, `number`, `message`, `price`, `created_at` |
| `settings` | Singleton docs: `_id: "maintenance"`, `_id: "payment_gateways"`, `_id: "server_config"` |
| `sessions` | Admin sessions: `_id` (token), `role: "admin"`, `id`, `created_at` — 7-day TTL |
| `connect_tokens` | Bot-connect links: `_id` (hex token), `userId`, `created_at` — 15-minute expiry |

---

## ⚙️ Environment Variables

Set all of these in the Vercel project. **No real password or API key is written here — use your own values.**

### Database
| Var | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (required) |

### Admin Login
| Var | Description |
|---|---|
| `ADMIN_ID` | Admin username — required, no fallback |
| `ADMIN_PASSWORD` | Admin password — **use a strong password in production, never keep the default** |

### Telegram Bot
| Var | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token (for sales/admin/buyer notifications) |
| `SALES_CHAT_ID` / `SALES` | Public sales channel (e.g. `-1002254383562`) |
| `ADMIN_LOG_CHAT_ID` / `ADMINLOG` | Private admin log group (e.g. `-1003441797589`) |
| `BOT_USERNAME` / `BOTUSER` | Bot username without @ (e.g. `TGAStore1Bot`) |
| `BOT_CHANNEL` / `CHANNEL` | Channel username without @ (e.g. `TGAForu`) |

### Telegram Mini App
| Var | Default | Purpose |
|---|---|---|
| `BOT_TOKEN` | — (required) | Also used to verify Mini App `initData` signatures |
| `BOT_USERNAME` | `TGAStore1Bot` | Public bot username (deep links, docs) |
| `WEBSITE_URL` | `https://tga-store.vercel.app` | Store URL used by the bot's Mini App menu button and `/start` button |

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
| `UPI_ID` | UPI ID shown to users (copy-able) |
| `DEFAULT_INR_GATEWAY` | `upi` or `fampay` (can be overridden from the admin panel) |

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
| `BINANCE_PAY_ID` | Binance Pay ID (shown to users) |
| `BINANCE_QR_URL` | Binance QR image URL |
| `BINANCE_API_KEY` | Binance API key (for verification) |
| `BINANCE_SECRET` | Binance API secret |

### OxaPay (Crypto)
| Var | Description |
|---|---|
| `OXAPAY_API_KEY` | OxaPay merchant API key |

> **Note:** The recharge rate `USDT_TO_INR = 90` and `MIN_USDT = 0.1` are constants in the code (`lib/payments.js`). Edit them there if you need to change them.

---

## 🚀 Deployment (Vercel)

1. Connect the GitHub repo to Vercel.
2. Framework preset: **Other** (plain static + functions).
3. Build command: leave empty (no build).
4. Output directory: leave empty / root.
5. Add all environment variables listed above in the Vercel dashboard.
6. Deploy. `vercel.json` automatically routes `/admin` → `/admin.html`.
7. The single catch-all `api/[...slug].js` becomes the one serverless Function, and every `/api/*` request is routed through it. All routes are consolidated here (instead of one Function per endpoint) so the project stays within the **Vercel Hobby plan's Function limit**.

### Local dev
```bash
npm install
vercel dev          # if you have the Vercel CLI
# or just serve the static files with any static server (api functions need the Vercel env)
```

**Theme preview (no database needed)**
```bash
node dev/preview-server.js          # http://localhost:3000
```
Serves `public/` with an in-memory mock API so the entire user flow
(login → home → buy → recharge → orders → settings) can be clicked through:

- `http://localhost:3000/?preview_theme=glass` — force any theme in one tab
- `http://localhost:3000/gallery` — all 22 themes rendered live side by side
- `http://localhost:3000/admin` — admin panel against the mock API
- `http://localhost:3000/docs` — API docs page (mock keys + logs, working test area)
- `http://localhost:3000/?preview_telegram=1` — pretend the page was opened inside
  Telegram, so the Mini App auto-login can be clicked through end to end

---

## 🤖 Telegram Bot Integration (`bot.py`)

The website and bot share the same MongoDB database. `BOT_PATCH_INSTRUCTIONS.md` contains the patches that must be pasted into the bot (manually):

- `/start register` and `/start login` handlers — generate a strong password for the website account and DM it to the user + log to admin
- `/start connect_<token>` — accepts a link generated from Website Settings → Bot Connect and links the user's `telegram_id`
- `/changepassword old new` command
- Uses the `users.password_hash` (bcrypt), `users.telegram_id`, `users.bot_connected` fields
- The website automatically sends the sales channel, admin log, and buyer DM on purchase (no extra bot code needed)

The bot must be restarted after pasting the patches.

---

## 💰 Pricing & Money Logic

- **Wallet balance is stored in INR** (`users.balance`).
- **Display currency** is selected by the user: USD / INR / USDT. Conversion: ₹100 = $1 = 1 USDT (`INR_PER_USDT = 100`).
- **Provider price** comes from TG-Lion in USD (e.g. 0.45).
- **Selling price** = provider USD × 1.20 (20% markup) → × 100 = INR. Example: 0.45 × 1.20 = 0.54 USD = **₹54.00**.
- **Admin profit margin** (Settings → TG-Lion) adds an extra % on top of the provider price before the 20% selling markup — the two are combined.
- On **Crypto recharge**, 1 USDT = ₹90 wallet credit (the provider rate and selling rate differ).

---

## 🧰 Troubleshooting

| Problem | Check |
|---|---|
| "Could not load history" in recharge | Check the `/api/recharge` logs — the real error message is now shown. Usually an MONGODB_URI or user resolution issue. |
| Countries not showing | Are `TG_LION_API_KEY` + `TG_LION_YOUR_ID` env vars set? Is the TG-Lion API reachable? |
| Buy says "Insufficient balance" | The user's `users.balance` is in INR; the price is charged in ₹. Old orders with values <20 are treated as USD. |
| UPI QR not showing | Is `UPI_API_KEY` set? Check `/api/qr_proxy` logs — is the upstream blocking the image? |
| OTP not arriving | Check TG-Lion balance (`checkS2ApiBalance`). Wait for the number status to become "Received". |
| Admin login invalid | Do `ADMIN_ID` / `ADMIN_PASSWORD` env vars match? There should be no stale token in the `sessions` collection. |
| Maintenance won't turn off | Delete the `_id: "maintenance"` doc in the `settings` collection, or toggle it from the admin panel. |
| Login says "Database connection error" | MONGODB_URI is missing / Atlas IP allowlist / network issue. |

---

## 🔒 Security Notes

- **No passwords, API keys, Mongo URIs, or admin credentials are stored in this repo.** If any were ever committed, rotate them immediately (Mongo password, admin password, TG-Lion / TGPVA / bot keys).
- Admin login **requires** `ADMIN_ID` + `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`) in the host environment. There is no fallback password in the code.
- Admin login is rate-limited (5 tries / 15 min per IP) and uses timing-safe comparison. A new admin login invalidates previous admin sessions. Admin sessions last 24 hours.
- User login/register is rate-limited. Failed login always returns the same generic message (no “user not found” leak).
- After login the website issues a **Bearer session token**. Dashboard, buy, OTP, recharge, password change, bot-connect and API-key routes no longer accept a raw `userId` from the client.
- User passwords are hashed with bcrypt (`SALT_ROUNDS = 12`). Legacy plaintext passwords are migrated on next successful login. Telegram notifications never include the user’s password.
- Admin session tokens are 32-byte random hex. User sessions last 7 days.
- Security headers (`X-Frame-Options: DENY`, `nosniff`, etc.) are set in `vercel.json`.
- The QR proxy only fetches `http`/`https` URLs; the content-type must be an image.
- When maintenance mode is on, login/buy/recharge/dashboard all return 503 — only the admin panel and `/api/status` stay live.

### After a leak (do this now)

1. Vercel → Project → Settings → Environment Variables: set a **new** `ADMIN_ID` and a **long new** `ADMIN_PASSWORD`. Redeploy.
2. Change the MongoDB Atlas user password and update `MONGODB_URI`.
3. Rotate `BOT_TOKEN`, `TG_LION_API_KEY`, `TGPVA_API_KEY`, Binance / OxaPay / UPI keys.
4. On the bot host, set `MONGO_URI`, `TG_LION_API_KEY`, `TG_LION_YOUR_ID`, `TGPVA_API_KEY` as env vars (they are no longer in `bot.py`).
5. Ask every user to log in again (old “just userId in localStorage” sessions no longer work).

---

## 📝 Editing This README

Feel free to edit this file as needed — update URLs, support links, the Telegram channel (@tgaforu / @OfcCuteSmile / @TGAStore1Bot), prices, or add new features here. **Never write passwords / API keys / the bot token in this file** — always keep them in Vercel environment variables.
Vercel environment variables.
