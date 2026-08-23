// netlify/functions/admin-auth.js
// Multi-user login + agent management for the admin portal.
//
// POST JSON: { action, ...payload }
//   login        { email, password }            -> { token, user }  (also accepts the master password)
//   me           { token }                       -> { user }
//   list_users   { token }              (owner)  -> [{id,email,name,role,active,created_at}]
//   add_user     { token, email, name, password, role }  (owner)
//   set_active   { token, id, active }  (owner)
//   set_role     { token, id, role }    (owner)
//   set_password { token, id, password } (owner, or your own account)
//   delete_user  { token, id }          (owner)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, ADMIN_PASSWORD (legacy master), ANTHROPIC not needed.

const {
  json, sbSelect, sbWrite, checkAuth,
  hashPassword, verifyPassword, makeToken, verifyToken,
} = require("./lib/carriers");

const normEmail = (e) => String(e || "").trim().toLowerCase();
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, created_at: u.created_at });

// Resolve the caller from a token or the master password.
function caller(data) {
  if (data && data.token) { const p = verifyToken(data.token); if (p) return p; }
  if (data && data.password && checkAuth(data.password)) return { email: "owner", role: "owner", name: "Owner", master: true };
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  try {
    // ---------- LOGIN (no auth required) ----------
    if (data.action === "login") {
      const email = normEmail(data.email);
      const password = String(data.password || "");

      // Master password (break-glass) — works with or without an email.
      if (password && checkAuth(password)) {
        const user = { email: email || "owner", role: "owner", name: "Owner" };
        return json(200, { token: makeToken(user), user });
      }
      // Account login.
      if (!email) return json(401, { error: "Enter your email and password." });
      const rows = await sbSelect(`admin_users?email=eq.${encodeURIComponent(email)}&select=*`);
      const u = rows && rows[0];
      if (!u || !u.active || !verifyPassword(password, u.pass_salt, u.pass_hash)) {
        return json(401, { error: "Wrong email or password." });
      }
      const user = { id: u.id, email: u.email, name: u.name, role: u.role };
      return json(200, { token: makeToken(user), user });
    }

    // ---------- everything else needs a valid caller ----------
    const who = caller(data);
    if (!who) return json(401, { error: "Please sign in again." });

    if (data.action === "me") return json(200, { user: who });

    if (data.action === "list_users") {
      if (who.role !== "owner") return json(403, { error: "Owners only." });
      const users = await sbSelect("admin_users?select=id,email,name,role,active,created_at&order=created_at.asc");
      return json(200, { users });
    }

    if (data.action === "add_user") {
      if (who.role !== "owner") return json(403, { error: "Owners only." });
      const email = normEmail(data.email);
      const name = String(data.name || "").trim();
      const password = String(data.password || "");
      const role = data.role === "owner" ? "owner" : "agent";
      if (!email || !email.includes("@")) return json(400, { error: "A valid email is required." });
      if (password.length < 6) return json(400, { error: "Password must be at least 6 characters." });
      const existing = await sbSelect(`admin_users?email=eq.${encodeURIComponent(email)}&select=id`);
      if (existing && existing.length) return json(400, { error: "That email already has an account." });
      const { salt, hash } = hashPassword(password);
      const saved = await sbWrite("POST", "admin_users", {
        email, name: name || null, role, pass_salt: salt, pass_hash: hash, created_by: who.email || "owner",
      });
      return json(200, { user: publicUser(Array.isArray(saved) ? saved[0] : saved) });
    }

    if (data.action === "set_active") {
      if (who.role !== "owner") return json(403, { error: "Owners only." });
      await sbWrite("PATCH", `admin_users?id=eq.${encodeURIComponent(data.id)}`, { active: !!data.active });
      return json(200, { ok: true });
    }

    if (data.action === "set_role") {
      if (who.role !== "owner") return json(403, { error: "Owners only." });
      const role = data.role === "owner" ? "owner" : "agent";
      await sbWrite("PATCH", `admin_users?id=eq.${encodeURIComponent(data.id)}`, { role });
      return json(200, { ok: true });
    }

    if (data.action === "set_password") {
      // Owner can reset anyone; anyone can change their own.
      if (who.role !== "owner" && who.id !== data.id) return json(403, { error: "Not allowed." });
      const password = String(data.password || "");
      if (password.length < 6) return json(400, { error: "Password must be at least 6 characters." });
      const { salt, hash } = hashPassword(password);
      await sbWrite("PATCH", `admin_users?id=eq.${encodeURIComponent(data.id)}`, { pass_salt: salt, pass_hash: hash });
      return json(200, { ok: true });
    }

    if (data.action === "delete_user") {
      if (who.role !== "owner") return json(403, { error: "Owners only." });
      if (who.id && who.id === data.id) return json(400, { error: "You can't delete your own account." });
      await sbWrite("DELETE", `admin_users?id=eq.${encodeURIComponent(data.id)}`);
      return json(200, { ok: true });
    }

    return json(400, { error: `Unknown action "${data.action}".` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
