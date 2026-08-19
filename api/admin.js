const {
  getDatabase,
  readJsonBody
} = require("../lib/db");

const {
  getMaintenance,
  setMaintenance,
  getSession,
  deleteSession
} = require("../lib/site");

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
  const [
    totalUsers,
    totalOrders,
    completedOrders,
    inProgress,
    failedBuys,
    successfulLogins,
    failedLogins,
    otpReceived,
    revenueRows,
    recentLogs,
    maintenance
  ] = await Promise.all([
    db.collection("users").countDocuments(),
    db.collection("orders").countDocuments(),
    db.collection("orders").countDocuments({ status: "completed" }),
    db.collection("orders").countDocuments({ status: "purchased" }),
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
    db.collection("logs").find().sort({ created_at: -1 }).limit(25).toArray(),
    getMaintenance(db)
  ]);

  const revenue = revenueRows.length
    ? Number(revenueRows[0].total || 0)
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
          in_progress: {
            $sum: { $cond: [{ $eq: ["$status", "purchased"] }, 1, 0] }
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
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

  const rows = users.map(user => {
    const stats = map[user._id] || {};

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
      $lookup: {
        from: "users",
        localField: "user_id",
        foreignField: "_id",
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
    pass: order.pass || "",
    price: Number(order.price || 0),
    provider_price: Number(order.provider_price || 0),
    status: order.status || "purchased",
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
