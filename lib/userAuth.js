const { findUserById } = require("./db");
const { getSession } = require("./site");

function unauthorized(res, message) {
  return res.status(401).json({
    success: false,
    auth: false,
    message: message || "Please login again."
  });
}

async function requireUser(db, req, res) {
  const session = await getSession(db, req);
  if (!session || session.role !== "user" || !session.userId) {
    unauthorized(res);
    return null;
  }

  const user = await findUserById(db, session.userId);
  if (!user) {
    unauthorized(res, "Session expired. Please login again.");
    return null;
  }

  return { user, session };
}

module.exports = {
  requireUser,
  unauthorized
};
