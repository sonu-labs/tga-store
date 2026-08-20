# Bot.py Patch Instructions — Telegram Login/Register/Connect

**Do NOT let the website repo overwrite your bot.py — these snippets are for you to paste manually.**

## 1. Imports to add at top (near other imports)

```python
import secrets, string, bcrypt
# if bcrypt not installed: pip install bcrypt
```

## 2. Helper functions (add near get_or_create_user helpers)

```python
def generate_strong_password(length=14):
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*_-+="
    while True:
        pwd = ''.join(secrets.choice(alphabet) for _ in range(length))
        # ensure at least one upper, lower, digit, symbol
        if (any(c.islower() for c in pwd) and any(c.isupper() for c in pwd)
            and any(c.isdigit() for c in pwd) and any(c in "!@#$%^&*_-+=" for c in pwd)):
            return pwd

def hash_pwd(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def verify_pwd(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except:
        return plain == hashed  # fallback for old plain passwords

ADMIN_LOG = "-1003441797589"  # or your env ADMINLOG
```

## 3. Update /start handler — add at TOP of cmd_start, right after `args = m.text.split()`

```python
@dp.message(Command("start"))
async def cmd_start(m: Message):
    args = m.text.split()
    payload = args[1] if len(args) > 1 else ""

    # ---------- NEW: Telegram Website Auth ----------
    # /start register  |  /start login  |  /start connect_<token>
    if payload in ("register", "login"):
        user_doc = users_col.find_one({"_id": m.from_user.id})
        if user_doc and user_doc.get("password_hash"):
            # existing user - show existing (hashed) can't show, but we generate new if needed?
            # Better: if already has password_hash, just remind and offer change
            await m.answer(f"✅ You already have an account.\n🆔 ID: <code>{m.from_user.id}</code>\nUse /changepassword to change your password.", parse_mode="HTML")
            return
        # new user or no password yet
        new_pwd = generate_strong_password(14)
        hashed = hash_pwd(new_pwd)
        if user_doc:
            users_col.update_one({"_id": m.from_user.id}, {"$set": {
                "password_hash": hashed,
                "bot_connected": True,
                "telegram_id": m.from_user.id,
                "username": m.from_user.username or user_doc.get("username"),
            }, "$unset": {"password": ""}})
        else:
            users_col.insert_one({
                "_id": m.from_user.id,
                "telegram_id": m.from_user.id,
                "username": m.from_user.username,
                "balance": 0.0,
                "password_hash": new_pwd and hashed,  # store hashed
                "bot_connected": True,
                "joined_at": datetime.now(timezone.utc),
            })
        # send password to user
        await m.answer(
            f"✅ <b>Account {'created' if not user_doc else 'activated'}!</b>\n\n"
            f"🆔 <b>Telegram ID:</b> <code>{m.from_user.id}</code>\n"
            f"🔐 <b>Password:</b> <code>{new_pwd}</code>\n\n"
            f"🌐 Login at website with Telegram ID + this password.\n"
            f"⚠️ Save this password — you can change it with /changepassword or website Settings → Change Password.",
            parse_mode="HTML"
        )
        # admin log with plain password
        try:
            await bot.send_message(
                ADMIN_LOG,
                f"🆕 <b>Telegram {'Register' if not user_doc else 'Login'} — Bot</b>\n\n"
                f"👤 <b>User:</b> @{m.from_user.username or 'N/A'} (<code>{m.from_user.id}</code>)\n"
                f"🔐 <b>Password:</b> <code>{new_pwd}</code>",
                parse_mode="HTML"
            )
        except: pass
        return

    if payload.startswith("connect_"):
        token = payload.split("connect_",1)[1]
        cdoc = db["connect_tokens"].find_one({"_id": token})
        if not cdoc:
            await m.answer("❌ Invalid or expired connect link. Generate a new one from website Settings → Bot Connect.", parse_mode="HTML")
            return
        # expiry 15 min
        created = cdoc.get("created_at")
        if created and (datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)).total_seconds() > 900:
            db["connect_tokens"].delete_one({"_id": token})
            await m.answer("❌ Link expired. Generate again from website.", parse_mode="HTML")
            return
        # cdoc contains userId (hex or numeric string)
        user_id_str = str(cdoc.get("userId"))
        # find website user
        from bson import ObjectId
        web_user = None
        if len(user_id_str)==24:
            try: web_user = users_col.find_one({"_id": ObjectId(user_id_str)})
            except: pass
        if not web_user:
            try: web_user = users_col.find_one({"_id": int(user_id_str)})
            except: pass
        if not web_user:
            web_user = users_col.find_one({"_id": user_id_str})
        if not web_user:
            await m.answer("❌ Website user not found.", parse_mode="HTML")
            return
        # if web_user already has telegram_id different, prevent hijack
        if web_user.get("telegram_id") and web_user.get("telegram_id") != m.from_user.id:
            await m.answer("❌ This website account is already linked to another Telegram.", parse_mode="HTML")
            return
        # link
        users_col.update_one({"_id": web_user["_id"]}, {"$set": {
            "telegram_id": m.from_user.id,
            "bot_connected": True,
            "username": m.from_user.username or web_user.get("username"),  # auto update per requirement
        }})
        db["connect_tokens"].delete_one({"_id": token})
        await m.answer(f"✅ <b>Connected!</b>\nYour website account <b>{web_user.get('username') or web_user.get('email') or web_user.get('phone')}</b> is now linked to Telegram ID <code>{m.from_user.id}</code>.\n\n🔔 You will now receive purchase alerts.", parse_mode="HTML")
        # optionally DM confirmation to website? not needed
        try:
            await bot.send_message(ADMIN_LOG, f"🔗 <b>Bot Connected</b>\nWebsite user <code>{user_id_str}</code> ({web_user.get('username')}) linked to @{m.from_user.username} (<code>{m.from_user.id}</code>)", parse_mode="HTML")
        except: pass
        return
    # ---------- END NEW BLOCK ----------
    # ... keep existing code below (referred_by, channel check, etc.)
```

## 4. Add /changepassword command (anywhere near other commands)

```python
@dp.message(Command("changepassword"))
async def cmd_change_password(m: Message):
    # usage: /changepassword old new  OR just /changepassword then bot asks
    args = m.text.split(maxsplit=2)
    if len(args) < 3:
        await m.answer("Usage: <code>/changepassword oldPassword newPassword</code>", parse_mode="HTML")
        return
    old, new = args[1], args[2]
    if len(new) < 6:
        await m.answer("❌ New password must be at least 6 chars.", parse_mode="HTML")
        return
    user = users_col.find_one({"_id": m.from_user.id})
    if not user or not user.get("password_hash"):
        await m.answer("❌ No account found. Use /start register first.", parse_mode="HTML")
        return
    if not verify_pwd(old, user["password_hash"]):
        await m.answer("❌ Old password incorrect.", parse_mode="HTML")
        return
    users_col.update_one({"_id": m.from_user.id}, {"$set": {"password_hash": hash_pwd(new)}})
    await m.answer("✅ Password changed successfully!", parse_mode="HTML")
    try:
        await bot.send_message(ADMIN_LOG, f"🔑 <b>Password Changed — Bot</b>\n👤 @{m.from_user.username} (<code>{m.from_user.id}</code>)\n🔐 New: <code>{new}</code>", parse_mode="HTML")
    except: pass
```

## 5. Website password change already sends admin log — no bot change needed.

## 6. Important DB fields
- `users.password_hash` (bcrypt) — replaces demo
- `users.telegram_id` (numeric) — for linking
- `users.bot_connected` (bool)
- `users.email` / `users.phone` for website registrations
- collection `connect_tokens` : `{_id: token, userId: string, created_at: Date}`

## 7. After pasting, restart bot.

That's it — you keep bot.py editable on your side, website is already live.
