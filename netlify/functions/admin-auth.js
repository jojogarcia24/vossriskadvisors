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
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Email a new agent their login + temporary password (uses the existing Resend
// setup). No-op (returns sent:false) if Resend isn't configured.
async function sendWelcomeEmail(user, password) {
  const { RESEND_API_KEY, FROM_EMAIL } = process.env;
  const SITE = process.env.URL || "https://www.vossriskadvisors.com";
  if (!RESEND_API_KEY || !FROM_EMAIL) return { sent: false, reason: "email_not_configured" };
  const NAVY = "#0C2340", NAVY_INK = "#001830", GOLD = "#C09C48", CREAM = "#F5F0E6", INK = "#1C2433", MUTED = "#8A8578";
  const name = user.name || "there";
  const html = `
  <div style="margin:0;padding:24px 0;background:${CREAM};font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:92%;background:#fff;border:1px solid #e7e2d6">
        <tr><td style="background:${NAVY};padding:26px 34px" align="center">
          <div style="font-family:Georgia,serif;color:${CREAM};font-size:26px;letter-spacing:.18em">VOSS</div>
          <div style="height:1px;width:40px;background:${GOLD};margin:10px auto"></div>
          <div style="color:${GOLD};font-size:10px;letter-spacing:.34em;text-transform:uppercase">Risk Advisors</div>
        </td></tr>
        <tr><td style="padding:30px 34px;color:${INK};font-size:15px;line-height:1.7">
          <h2 style="font-family:Georgia,serif;color:${NAVY};margin:0 0 10px">You've been added to the carrier portal</h2>
          <p style="margin:0 0 14px">Hi ${esc(name)}, an account was created for you on the Voss Risk Advisors carrier admin portal.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="background:${CREAM};border:1px solid #e7e2d6;border-radius:6px;width:100%;margin:0 0 16px">
            <tr><td style="padding:14px 16px;font-size:14px;color:${INK}">
              <strong>Email:</strong> ${esc(user.email)}<br>
              <strong>Temporary password:</strong> ${esc(password)}
            </td></tr>
          </table>
          <p style="margin:0 0 20px"><a href="${SITE}/admin" style="background:${NAVY};color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Sign in to the portal &rarr;</a></p>
          <p style="margin:0;color:${MUTED};font-size:13px">Please change your password after you sign in (Team &rarr; Change my password).</p>
        </td></tr>
        <tr><td style="background:${NAVY_INK};padding:18px 34px;color:${MUTED};font-size:11px">Voss Risk Advisors LLC · This login is for agency staff only.</td></tr>
      </table>
    </td></tr></table>
  </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [user.email], subject: "Your Voss Risk Advisors portal login", html }),
    });
    return { sent: r.ok, reason: r.ok ? undefined : `resend_${r.status}` };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

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
      const u = publicUser(Array.isArray(saved) ? saved[0] : saved);
      let emailed = { sent: false, reason: "skipped" };
      if (data.sendEmail !== false) emailed = await sendWelcomeEmail({ email, name }, password);
      return json(200, { user: u, emailed: emailed.sent, emailReason: emailed.reason });
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
