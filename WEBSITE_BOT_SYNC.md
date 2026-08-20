# Website ↔ Bot Sync — kya fix hua, kya bot.py me baaki hai

Ye document us problem ka poora hisaab hai jahan **website se kiya gaya purchase
(`+918053118669`) bot ki "📂 View Purchase Logs" me nahi dikh raha tha** aur
**koi notification logs channel ya buyer ke DM me nahi aa rahi thi**.

`bot.py` me **koi change nahi kiya gaya** — saare fix website side
(`api/`, `lib/`) me hain, aur is tarah likhe gaye hain ki bot ka maujuda code
bina chhue kaam karne lage.

---

## 1. Root cause — 4 alag bugs the

### Bug A — order galat `user_id` ke neeche save ho raha tha

Bot purchase history aise nikaalta hai (`bot.py:3864`, aur `history` ~3830):

```python
s12_orders = list(orders_col.find({"user_id": user_id, "status": "purchased"}))
#                                   ^^^^^^^^^ cq.from_user.id  → NUMBER
```

Bot ke apne orders (`bot.py:1412` Server 2, `bot.py:1770` Server 1) hamesha
numeric `user_id` likhte hain, isliye wo hamesha dikhte hain.

Website (`api/buy.js`) pehle ye karti thi:

```js
const userIdForOrder = telegramId !== null ? telegramId : resolveUserId(user);
//                                            ↑ ObjectId hex string "68f0c4…"
```

`telegram_id` sirf tab set hota hai jab user bot-connect deep link
(`t.me/TGAStore1Bot?start=connect_<hex>`, 15 min TTL — `api/account.js`) se
account link kare. Jis buyer ne link nahi kiya, uska order **24-char ObjectId
string** ke neeche chala jaata tha → bot ki numeric query se kabhi match nahi
hota.

### Bug B — OTP milte hi order history se gayab ho jaata tha

`api/code.js:114` OTP aane ke baad `status: "completed"` likh deta tha.
Bot Server 1/2 ke liye **sirf `"purchased"`** filter karta hai (lines 3380,
3831, 3865) aur number lookup bhi (`bot.py:1501`)
`{"number": ..., "status": "purchased"}` par hai.

Matlab: numeric `user_id` hone ke baad bhi, OTP nikaalte hi order history se
gayab. Bot ka Server 3 code already `{"$in": ["purchased","completed","delivered"]}`
use karta hai — Server 1/2 wala filter kabhi widen nahi hua. README ki schema
table dono statuses document karti hai, yaani bot spec se behak raha hai.

### Bug C — notification bhejne se pehle hi lambda mar jaata tha

`api/buy.js` fire-and-forget karta tha:

```js
notifyWebsitePurchase({...}).catch(e => console.error(e));   // await nahi
return res.status(200).json({...});                          // response chala gaya
```

Vercel serverless function ko **response bhejte hi freeze** kar deta hai.
Detached promise ka `fetch` aksar Telegram tak pahunchne se pehle hi kill ho
jaata tha. Isi wajah se register/password wale admin messages (jo await hote the)
aate the, lekin purchase wale nahi.

Doosri wajah: DM ka target `telegramId || user._id` tha — unlinked account par
ye ObjectId string banta tha, jise Telegram `chat_id` maan hi nahi sakta
(400 Bad Request), aur error `Promise.allSettled` me chup-chaap dab jaata tha.

### Bug D — Pass hamesha "N/A"

`bot.py:3888`:

```python
num_doc = db["numbers_col"].find_one({"number": ph_number})
#            ^^^^^^^^^^^^^ collection ka naam "numbers" hai, "numbers_col" nahi
```

`numbers_col` to Python variable ka naam hai (`numbers_col = db["numbers"]`).
`db["numbers_col"]` ek **khaali collection** banata hai → `num_doc` hamesha
`None` → Pass hamesha `N/A`.

Achhi baat: bot pehle `order.get("password")` check karta hai. Isliye website
agar order doc me hi `password` likh de, to bot bina patch ke sahi pass dikhayega.

---

## 2. Website side me kya fix kiya (bot.py chhue bina)

| File | Change |
|---|---|
| `lib/orders.js` **(naya)** | Shared ownership/status helpers: `BOT_VISIBLE_STATUS`, `telegramIdOf`, `accountIdOf`, `ownerQueries`, `backfillOrderOwnership`, `displayStatus`. |
| `api/buy.js` | Order ab numeric telegram id ke neeche save; `telegram_id` / `account_id` / `password` / `delivery_status` / `source:"website"` fields add; status `"purchased"` hi rehta hai; notification ab **awaited**. |
| `api/code.js` | OTP ke baad `status` **`"purchased"` hi rehta hai**; asli state `delivery_status:"completed"` me; `pass` ko `password` me mirror; owner ids re-point; `notifyOtpDelivered` awaited. |
| `api/dashboard.js` | `backfillOrderOwnership()` se purane orders migrate; `ownerQueries()` se `$or` match; UI ko `displayStatus()` bhejta hai. |
| `api/status.js` | Har deploy/restart par **ek baar** `maybeNotifyDeploy(db)` — "Logs are ACTIVE" ping. |
| `api/admin.js` | Naya `?action=notify` (GET = config + recent notify logs, POST = test ping); orders `$lookup` widen; user stats numeric+ObjectId dono keys se merge; completed/in-progress count `delivery_status`/`otp` se. |
| `lib/notify.js` | Poora rewrite — env-driven chat ids, `isSendableChatId` guard, timeout ke saath fetch, 400 par `reply_markup` hata kar retry, `logs` collection me `notify` entry, "purchased via website" marker, deploy ping. |

### Bug A ka fix — order sahi id par

```js
const telegramId = telegramIdOf(lookupUser);          // numeric ya null
const accountId  = accountIdOf(lookupUser) || resolveUserId(lookupUser);
const userIdForOrder = telegramId !== null ? telegramId : accountId;
```

Aur order doc me teeno ids: `user_id`, `telegram_id`, `account_id`. Jab user
baad me bot connect karta hai, `backfillOrderOwnership()` (dashboard load par
chalta hai) purane ObjectId-wale orders ko numeric id par re-point kar deta hai
— yaani **purani purchases bhi bot me dikhne lagengi**.

### Bug B ka fix — status kabhi flip nahi hota

```js
status: BOT_VISIBLE_STATUS,      // hamesha "purchased" — bot isi par filter karta hai
delivery_status: "completed",    // asli state yahan
```

Website/admin UI `displayStatus(order)` use karti hai (pehle `delivery_status`,
phir `otp` ki presence, phir `status`), isliye site par "Completed" hi dikhta
hai — lekin DB me bot-compatible `"purchased"` rehta hai.

### Bug C ka fix — await + sendable-id guard

```js
notified = await notifyWebsitePurchase({ db, userId: telegramId, accountRef: accountId, ... });
```

`isSendableChatId()` ObjectId-jaise target ko pehle hi reject kar deta hai, aur
result `logs` collection me `type:"notify"` ke saath likha jaata hai, taaki
admin panel me dikhe ki ping gaya ya nahi (`sent` / `skipped` / `failed: <reason>`).

### Bug D ka fix — password order doc me

`api/buy.js` `password: null` likhta hai aur `api/code.js` OTP ke saath
`password: pass` set karta hai. Bot ka `order.get("password")` branch pehle
chalta hai, isliye Pass sahi dikhega — `db["numbers_col"]` typo tak pahunchna
hi nahi padega.

---

## 3. Zaroori environment variables (Vercel)

| Var | Default | Kis liye |
|---|---|---|
| `BOT_TOKEN` | — **(required)** | Iske bina koi Telegram message nahi jaayega. `GET /api/admin?action=notify` isko verify karta hai. |
| `SALES_CHAT_ID` | `-1002254383562` | Public sales log channel. |
| `ADMIN_LOG_CHAT_ID` | `-1003441797589` | Admin log channel. |
| `OWNER_TG_ID` | — | Deploy ping owner DM me bhi. |
| `DEPLOY_PING_ENABLED` | `1` | `0` karke restart ping band. |
| `DEPLOY_PING_SALES` | `0` | `1` karne par deploy ping sales channel me bhi. |

> Bot ko dono channels me **admin** hona chahiye, warna Telegram
> `CHAT_WRITE_FORBIDDEN` deta hai. Test: `POST /api/admin?action=notify`.

---

## 4. Jo sirf `bot.py` edit karke hi theek ho sakta hai (abhi workaround se chal raha hai)

Neeche wale patches **optional** hain — website side workaround already lagaya
hua hai. Ye tab lagana jab bot ko bhi clean karna ho.

### 4.1 Status filter widen karna (Bug B ka asli fix)

`bot.py:3380`, `~3831`, `3865` aur `1501` — Server 1/2 queries:

```python
# ABHI
orders_col.find({"user_id": user_id, "status": "purchased"})

# SAHI (Server 3 wali line se consistent)
orders_col.find({"user_id": user_id, "status": {"$in": ["purchased", "completed", "delivered"]}})
```

Jab tak ye nahi hota, website `status` ko kabhi `"completed"` nahi karegi.

### 4.2 `numbers_col` typo (Bug D ka asli fix)

`bot.py:3888`:

```python
# ABHI (galat — aisa koi collection nahi)
num_doc = db["numbers_col"].find_one({"number": ph_number})

# SAHI
num_doc = numbers_col.find_one({"number": ph_number})
```

### 4.3 Website purchase ka bot-side marker (optional, cosmetic)

Purchase logs me source dikhana ho to:

```python
src = order.get("source") or "bot"
tag = " 🌐 <i>(via website)</i>" if src == "website" else ""
text += f"📱 <b>{ph_number}</b>{tag}\n"
```

`source` field website already likh rahi hai.

### 4.4 Purchase par bot-side log (optional)

Abhi bot SALES/ADMINLOG message **sirf** Server 2 OTP handler (`srv2_otp:` ~1500–1530)
ke andar bhejta hai — yaani sirf tab jab "Get Code" **bot me** dabaya jaaye.
Insert ke waqt koi log nahi hota. Website ab apna log khud bhejti hai, isliye
website purchases cover ho gaye; bot purchases ke insert-time log ke liye
`bot.py` me alag se add karna padega.

---

## 5. Verify kaise karein

1. **Config check** — `GET /api/admin?action=notify`
   → `bot_token_set: true` aur dono chat ids sahi hone chahiye.
2. **Test ping** — `POST /api/admin?action=notify`
   → admin log channel me "🚀 Website Notification Test" aana chahiye.
3. **Deploy ping** — deploy ke baad site kholein (`/api/status` chal jaata hai)
   → channel me ek baar "Logs are ACTIVE" message.
4. **Purchase** — website se number khareeden
   → sales + admin channel me "(via website)" wala log, buyer ke DM me confirmation
   (agar Telegram linked hai), aur buy response me `notified` object.
5. **Bot history** — bot me "📂 View Purchase Logs"
   → number dikhna chahiye, OTP nikaalne ke baad bhi list me rehna chahiye.
6. **Purane orders** — buyer ek baar website dashboard khole
   → `backfillOrderOwnership` purane orders ko numeric id par migrate kar dega.

## 6. `+918053118669` ka case

Ye order ObjectId string `user_id` ke saath bana tha aur OTP nikalne par
`status: "completed"` ho gaya tha — dono wajah se bot ki query se bahar tha,
aur notification detached-promise freeze me maar gayi thi. Buyer ke website
dashboard kholte hi `backfillOrderOwnership` ise numeric telegram id par
re-point kar dega; uske baad bot history me dikhega — bas `status` ko manually
`"purchased"` karna hoga (ya 4.1 wala patch lagana hoga), kyunki purane doc me
wo `"completed"` likha ja chuka hai:

```js
db.orders.updateOne(
  { number: "+918053118669" },
  { $set: { status: "purchased", delivery_status: "completed" } }
)
```
