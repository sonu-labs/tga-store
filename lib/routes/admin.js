const {
  getDatabase,
  readJsonBody
} = require("../db");

const {
  getMaintenance,
  setMaintenance,
  getSession,
  deleteSession
} = require("../site");

const {
  getPaymentSettings,
  setPaymentSettings
} = require("../payments");

const {
  notifyConfig,
  notifyDeploy,
  currentDeployId
} = require("../notify");

const {
  THEMES,
  getSiteTheme,
  setSiteTheme
} = require("../themes");

const { displayStatus } = require("../orders");

function serialize(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (typeof value === "object") {
    const output = {};

    for (const [key, val] of Object.entries(value)) {
      if (
        key === "_id" &&
        val &&
        typeof val.toHexString === "function"
      ) {
        output[key] = val.toHexString();
      } else {
        output[key] = serialize(val);
      }
    }

    return output;
  }

  return value;
}

function escapeRegex(value) {
  return String(value || "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function toNumber(value, fallback) {
  const num = Number(value);

  return Number.isFinite(num) && num >= 0
    ? Math.floor(num)
    : fallback;
}

function getToken(req) {
  const header = String(req.headers["authorization"] || "");

  return header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : header.trim();
}

async function getOverview(db) {
  const [totalUsers, totalOrders, completedOrders, inProgress, failedBuys, successfulLogins, failedLogins, otpReceived, revenueRows, rechargeRows, recentLogs, maintenance] = await Promise.all([
    db.collection("users").countDocuments(),
    db.collection("orders").countDocuments(),
    // Website orders keep status "purchased" (bot.py filters on it), so an
    // order counts as completed once its OTP was delivered.
    db.collection("orders").countDocuments({
      $or: [
        { status: "completed" },
        { delivery_status: "completed" },
        { otp: { $nin: [null, ""] } }
      ]
    }),
    db.collection("orders").countDocuments({
      status: "purchased",
      delivery_status: { $ne: "completed" },
      $or: [{ otp: null }, { otp: "" }, { otp: { $exists: false } }]
    }),
    db.collection("logs").countDocuments({ type: "buy", status: "failed" }),
    db.collection("logs").countDocuments({ type: "login", status: "success" }),
    db.collection("logs").countDocuments({ type: "login", status: "failed" }),
    db.collection("logs").countDocuments({ type: "otp", status: "success" }),
    db.collection("orders").aggregate([
      {
        $match: { status: { $in: ["purchased", "completed"] } }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $convert: {
                input: "$price",
                to: "double",
                onError: 0,
                onNull: 0
              }
            }
          }
        }
      }
    ]).toArray(),
    db.collection("transactions").aggregate([
      {
        $match: { status: { $in: ["paid", "success", "approved"] } }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $convert: {
                input: "$amount",
                to: "double",
                onError: 0,
                onNull: 0
              }
            }
          }
        }
      }
    ]).toArray(),
    db.collection("logs").find().sort({ created_at: -1 }).limit(25).toArray(),
    getMaintenance(db)
  ]);

  const revenue = revenueRows.length
    ? Number(revenueRows[0].total || 0)
    : 0;

  const totalRecharge = rechargeRows.length
    ? Number(rechargeRows[0].total || 0)
    : 0;

  return {
    totalUsers,
    totalOrders,
    completedOrders,
    inProgress,
    failedBuys,
    successfulLogins,
    failedLogins,
    otpReceived,
    revenue,
    totalRecharge,
    recentLogs: recentLogs.map(serialize),
    maintenance
  };
}

async function getLogs(db, query) {
  const type = String(query.type || "all");
  const search = String(query.q || "").trim();
  const limit = Math.min(toNumber(query.limit, 200), 1000);
  const skip = Math.max(toNumber(query.skip, 0), 0);

  const filter = {};

  if (type !== "all") {
    const parts = type.split("_");

    if (parts[0] === "login" || parts[0] === "buy") {
      filter.type = parts[0];

      if (parts[1] === "success" || parts[1] === "failed") {
        filter.status = parts[1];
      }
    } else {
      filter.type = type;
    }
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");

    filter.$or = [
      { username: regex },
      { number: regex },
      { country: regex },
      { message: regex }
    ];
  }

  const logs = await db.collection("logs")
    .find(filter)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await db.collection("logs").countDocuments(filter);

  return {
    logs: logs.map(serialize),
    total,
    limit,
    skip
  };
}

async function getUsers(db, query) {
  const search = String(query.q || "").trim();
  const limit = Math.min(toNumber(query.limit, 300), 1000);

  const filter = {};

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const numeric = Number(search);
    const or = [{ username: regex }];

    if (Number.isInteger(numeric)) {
      or.push({ _id: numeric });
    }

    filter.$or = or;
  }

  const users = await db.collection("users")
    .find(filter)
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();

  const [orderStats, loginStats, failStats] = await Promise.all([
    db.collection("orders").aggregate([
      {
        $group: {
          _id: "$user_id",
          orders: { $sum: 1 },
          // Website orders stay status="purchased" so bot.py keeps listing
          // them, so "completed" is decided by delivery_status / otp instead.
          in_progress: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$status", "completed"] },
                    { $ne: ["$delivery_status", "completed"] },
                    { $in: [{ $ifNull: ["$otp", ""] }, ["", null]] }
                  ]
                },
                1,
                0
              ]
            }
          },
          completed: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$status", "completed"] },
                    { $eq: ["$delivery_status", "completed"] },
                    { $not: { $in: [{ $ifNull: ["$otp", ""] }, ["", null]] } }
                  ]
                },
                1,
                0
              ]
            }
          },
          spent: {
            $sum: {
              $convert: {
                input: "$price",
                to: "double",
                onError: 0,
                onNull: 0
              }
            }
          }
        }
      }
    ]).toArray(),

    db.collection("logs").aggregate([
      { $match: { type: "login", status: "success" } },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: "$user_id",
          logins: { $sum: 1 },
          last_login: { $first: "$created_at" }
        }
      }
    ]).toArray(),

    db.collection("logs").aggregate([
      { $match: { type: "buy", status: "failed" } },
      {
        $group: {
          _id: "$user_id",
          failed_buys: { $sum: 1 }
        }
      }
    ]).toArray()
  ]);

  const map = {};

  for (const row of orderStats) {
    map[row._id] = { ...row };
  }

  for (const row of loginStats) {
    if (!map[row._id]) {
      map[row._id] = {};
    }

    Object.assign(map[row._id], row);
  }

  for (const row of failStats) {
    if (!map[row._id]) {
      map[row._id] = {};
    }

    Object.assign(map[row._id], row);
  }

  // Stats are grouped by orders.user_id, which for a website account is the
  // linked numeric telegram id rather than the account's ObjectId — so look
  // the user up under both keys and merge whatever is found.
  const statsFor = user => {
    const keys = [user._id, user.telegram_id, String(user._id)]
      .filter(k => k !== null && k !== undefined && k !== "")
      .map(String);

    const merged = {};
    const seen = new Set();

    for (const key of keys) {
      if (seen.has(key) || !map[key]) continue;
      seen.add(key);

      for (const [field, value] of Object.entries(map[key])) {
        if (field === "_id") continue;
        merged[field] = typeof value === "number"
          ? Number(merged[field] || 0) + value
          : value;
      }
    }

    return merged;
  };

  const rows = users.map(user => {
    const stats = statsFor(user);

    return {
      telegramId: user._id,
      username: user.username || "User",
      balance: Number(user.balance || 0),
      last_login: stats.last_login || null,
      logins: stats.logins || 0,
      orders: stats.orders || 0,
      in_progress: stats.in_progress || 0,
      completed: stats.completed || 0,
      failed_buys: stats.failed_buys || 0,
      spent: stats.spent || 0
    };
  });

  rows.sort((a, b) =>
    String(a.username).toLowerCase()
      .localeCompare(String(b.username).toLowerCase())
  );

  return {
    users: rows.map(serialize),
    total: rows.length
  };
}

async function getOrders(db, query) {
  const limit = Math.min(toNumber(query.limit, 300), 1000);

  const orders = await db.collection("orders").aggregate([
    { $sort: { created_at: -1 } },
    { $limit: limit },
    {
      // Orders can reference their owner in three ways:
      //   user_id      -> numeric telegram id (bot orders + new website orders)
      //   account_id   -> website account _id as a string (website orders)
      //   telegram_id  -> mirrored telegram id
      // A plain localField/foreignField join on _id misses the last two, which
      // is why website orders used to show up as "User" in the admin panel.
      $lookup: {
        from: "users",
        let: {
          uid: "$user_id",
          tgid: "$telegram_id",
          acc: "$account_id"
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$_id", "$$uid"] },
                  { $eq: [{ $toString: "$_id" }, { $toString: "$$uid" }] },
                  { $eq: [{ $toString: "$_id" }, { $toString: "$$acc" }] },
                  {
                    $and: [
                      { $ne: ["$$tgid", null] },
                      { $eq: [{ $toString: "$telegram_id" }, { $toString: "$$tgid" }] }
                    ]
                  },
                  {
                    $and: [
                      { $ne: ["$$uid", null] },
                      { $eq: [{ $toString: "$telegram_id" }, { $toString: "$$uid" }] }
                    ]
                  }
                ]
              }
            }
          },
          { $limit: 1 }
        ],
        as: "user"
      }
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true
      }
    }
  ]).toArray();

  const rows = orders.map(order => ({
    _id: order._id,
    user_id: order.user_id,
    username: order.user?.username || "User",
    country: order.country || "",
    country_code: order.country_code || "",
    number: order.number || "",
    otp: order.otp || "",
    pass: order.pass || order.password || "",
    price: Number(order.price || 0),
    provider_price: Number(order.provider_price || 0),
    // DB keeps status "purchased" for bot compatibility; show the real state here.
    status: displayStatus(order),
    source: order.source || "bot",
    created_at: order.created_at,
    code_at: order.code_at || null
  }));

  return {
    orders: rows.map(serialize),
    total: rows.length
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const db = await getDatabase();
    const session = await getSession(db, req);

    if (!session || session.role !== "admin") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please sign in again."
      });
    }

    const action = String(req.query.action || "overview");

    if (action === "overview") {
      if (req.method !== "GET") {
        return res.status(405).json({
          success: false,
          message: "Method not allowed."
        });
      }

      return res.status(200).json({
        success: true,
        data: await getOverview(db)
      });
    }

    if (action === "logs") {
      if (req.method !== "GET") {
        return res.status(405).json({
          success: false,
          message: "Method not allowed."
        });
      }

      return res.status(200).json({
        success: true,
        data: await getLogs(db, req.query)
      });
    }

    if (action === "users") {
      if (req.method !== "GET") {
        return res.status(405).json({
          success: false,
          message: "Method not allowed."
        });
      }

      return res.status(200).json({
        success: true,
        data: await getUsers(db, req.query)
      });
    }

    if (action === "orders") {
      if (req.method !== "GET") {
        return res.status(405).json({
          success: false,
          message: "Method not allowed."
        });
      }

      return res.status(200).json({
        success: true,
        data: await getOrders(db, req.query)
      });
    }

    if (action === "maintenance") {
      if (req.method === "GET") {
        const maintenance = await getMaintenance(db);

        return res.status(200).json({
          success: true,
          maintenance: serialize(maintenance)
        });
      }

      if (req.method === "POST") {
        const body = readJsonBody(req);
        const enabled = Boolean(body.enabled);
        const message = String(body.message || "");

        const maintenance = await setMaintenance(db, {
          enabled,
          message,
          updatedBy: session.id || "admin"
        });

        return res.status(200).json({
          success: true,
          maintenance: serialize(maintenance)
        });
      }

      return res.status(405).json({
        success: false,
        message: "Method not allowed."
      });
    }

    if (action === "payments" || action === "recharge_settings" || action === "payment_settings") {
      if (req.method === "GET") {
        const settings = await getPaymentSettings(db);
        return res.status(200).json({
          success: true,
          settings: serialize(settings),
          binance: {
            pay_id: process.env.BINANCE_PAY_ID || "",
            qr_url: process.env.BINANCE_QR_URL || ""
          },
          upi_id: process.env.UPI_ID || "",
          fampay_upi: process.env.FAMPAY_UPI || "",
          default_inr_gateway: process.env.DEFAULT_INR_GATEWAY || "upi"
        });
      }
      if (req.method === "POST") {
        const body = readJsonBody(req);
        const payload = body.settings || body;
        const updates = {};
        if ("active_inr_gateway" in payload) updates.active_inr_gateway = payload.active_inr_gateway;
        if ("binance_enabled" in payload) updates.binance_enabled = payload.binance_enabled;
        if ("crypto_enabled" in payload) updates.crypto_enabled = payload.crypto_enabled;
        const settings = await setPaymentSettings(db, updates);
        return res.status(200).json({
          success: true,
          settings: serialize(settings)
        });
      }
      return res.status(405).json({ success: false, message: "Method not allowed." });
    }

    if (action === "server_config" || action === "server2" || action === "servers") {
      if (req.method === "GET") {
        const doc = await db.collection("settings").findOne({ _id: "server_config" });
        const fallback = { s1: "active", s2: "active", s3: "maintenance", s2_api: "tglion", s2_profit: 0 };
        const data = doc ? { ...fallback, ...doc, s2_api: "tglion" } : fallback;
        return res.status(200).json({ success: true, config: serialize(data) });
      }
      if (req.method === "POST") {
        const body = readJsonBody(req);
        const updates = {};
        // Website uses TG-Lion only — TGPVA is not supported anymore
        updates.s2_api = "tglion";
        if ("s2_profit" in body) {
          const v = parseFloat(String(body.s2_profit));
          if (Number.isFinite(v) && v >= 0 && v <= 500) updates.s2_profit = v;
        }
        if ("s1" in body) updates.s1 = String(body.s1);
        if ("s2" in body) updates.s2 = String(body.s2);
        if ("s3" in body) updates.s3 = String(body.s3);
        if (Object.keys(updates).length) {
          await db.collection("settings").updateOne({ _id: "server_config" }, { $set: updates }, { upsert: true });
        }
        const doc = await db.collection("settings").findOne({ _id: "server_config" });
        return res.status(200).json({ success: true, config: serialize(doc || {}) });
      }
      return res.status(405).json({ success: false, message: "Method not allowed." });
    }

    // 🎨 Store theme: admin picks a theme, the USER site restyles itself.
    // The admin panel intentionally keeps its own look.
    if (action === "theme" || action === "themes" || action === "site_theme") {
      if (req.method === "GET") {
        return res.status(200).json({
          success: true,
          theme: await getSiteTheme(db),
          themes: THEMES
        });
      }

      if (req.method === "POST") {
        const body = readJsonBody(req);
        const theme = await setSiteTheme(db, body.theme || body.id || "", session.id || "admin");
        return res.status(200).json({
          success: true,
          theme,
          themes: THEMES
        });
      }

      return res.status(405).json({ success: false, message: "Method not allowed." });
    }

    if (action === "recharges" || action === "transactions") {
      if (req.method !== "GET") {
        return res.status(405).json({ success: false, message: "Method not allowed." });
      }
      const limit = Math.min(toNumber(req.query.limit, 200), 500);
      const txns = await db.collection("transactions").find({}).sort({ created_at: -1 }).limit(limit).toArray();
      const cryptos = await db.collection("crypto_invoices").find({}).sort({ created_at: -1 }).limit(limit).toArray();
      const combined = [];
      for (const t of txns) {
        combined.push({
          _id: t._id,
          user_id: t.user_id,
          method: t.method || "unknown",
          amount: Number(t.amount || 0),
          status: t.status || "pending",
          created_at: t.created_at,
          settled_at: t.settled_at || null,
          expires_at: t.expires_at || null,
          type: "transaction"
        });
      }
      for (const c of cryptos) {
        combined.push({
          _id: c.track_id || c._id,
          user_id: c.user_id,
          method: "crypto",
          amount: Number(c.amount_inr || 0),
          amount_usdt: Number(c.amount_usdt || 0),
          status: c.status || "pending",
          created_at: c.created_at,
          settled_at: c.settled_at || null,
          type: "crypto"
        });
      }
      combined.sort((a,b)=>{
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dbb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dbb - da;
      });
      const sliced = combined.slice(0, limit);
      // Attach usernames so the admin panel shows who recharged
      const userIds = [...new Set(sliced.map(x => x.user_id).filter(v => v !== null && v !== undefined))];
      const lookupIds = [];
      for (const id of userIds) {
        const num = Number(id);
        if (Number.isFinite(num)) lookupIds.push(num);
        lookupIds.push(String(id));
      }
      const userDocs = lookupIds.length
        ? await db.collection("users").find({ _id: { $in: lookupIds } }).toArray()
        : [];
      const userMap = {};
      for (const u of userDocs) {
        userMap[u._id] = u.username || "";
        const num = Number(u._id);
        if (Number.isFinite(num)) userMap[num] = u.username || "";
        userMap[String(u._id)] = u.username || "";
      }
      const rows = sliced.map(x => ({ ...x, username: userMap[x.user_id] || "" }));
      return res.status(200).json({ success: true, data: { recharges: rows.map(serialize), total: rows.length } });
    }

    // Telegram notification health: check the config and send a test ping so
    // you can confirm the logs channel + owner DM are wired up correctly.
    if (action === "notify" || action === "notify_test" || action === "notifications") {
      if (req.method === "GET") {
        const config = notifyConfig();
        const ping = await db.collection("settings").findOne({ _id: "deploy_ping" });
        const recent = await db.collection("logs")
          .find({ type: "notify" })
          .sort({ created_at: -1 })
          .limit(20)
          .toArray();

        return res.status(200).json({
          success: true,
          config,
          deploy_ping: serialize(ping || null),
          recent: recent.map(serialize),
          hint: config.bot_token_set
            ? "BOT_TOKEN is set. Use POST ?action=notify to send a test message."
            : "BOT_TOKEN env var is MISSING — no Telegram message can be sent."
        });
      }

      if (req.method === "POST") {
        const result = await notifyDeploy({
          db,
          deployId: currentDeployId(),
          reason: "Manual test from admin panel",
          manual: true
        });

        return res.status(200).json({
          success: result.ok,
          targets: result.targets,
          config: notifyConfig(),
          message: result.ok
            ? "Test notification sent."
            : "Test notification failed — check BOT_TOKEN and that the bot is an admin in the log channel."
        });
      }

      return res.status(405).json({ success: false, message: "Method not allowed." });
    }

    if (action === "logout") {
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          message: "Method not allowed."
        });
      }

      await deleteSession(db, getToken(req));

      return res.status(200).json({
        success: true
      });
    }

    return res.status(400).json({
      success: false,
      message: "Unknown action."
    });
  } catch (error) {
    console.error("Admin API error:", error);

    return res.status(500).json({
      success: false,
      message: "Admin API error.",
      error: error.message
    });
  }
};
