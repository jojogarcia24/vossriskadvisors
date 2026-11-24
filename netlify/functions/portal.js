// netlify/functions/portal.js
// Client portal API (public/portal.html).
//
// POST { action: "request_link", email }   -> always { ok: true } (no account probing);
//        emails a branded one-time sign-in link if that email is a client.
// POST { action: "me", access_token }       -> { client, advisor, policies, documents }
//        for the signed-in client only; documents come with 15-minute download links.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL
const A = require("./lib/portal-auth.js");
const { sb, sendEmail } = require("./lib/drip.js");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const hits = new Map();
const limited = (key, max) => { const now = Date.now(); const l = (hits.get(key) || []).filter((t) => now - t < 3600000); l.push(now); hits.set(key, l); return l.length > max; };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let d; try { d = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

  if (d.action === "request_link") {
    const email = String(d.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });
    const ip = event.headers["x-nf-client-connection-ip"] || "";
    if (limited("ip:" + ip, 10) || limited("em:" + email, 4)) return json(200, { ok: true });
    try {
      const [client] = await sb("GET", `clients?email=eq.${encodeURIComponent(email)}&select=*`);
      if (client) {
        await A.ensureAuthUser(email);
        const link = await A.magicLink(email);
        const m = A.portalEmail(client, link, false);
        await sendEmail(email, m.subject, m.html);
      }
    } catch (e) { console.error("portal request_link", e.message); }
    return json(200, { ok: true });
  }

  if (d.action === "me") {
    const user = await A.userFromToken(d.access_token);
    if (!user || !user.email) return json(401, { error: "Your sign-in link has expired. Request a new one." });
    const email = String(user.email).toLowerCase();
    const [client] = await sb("GET", `clients?email=eq.${encodeURIComponent(email)}&select=id,first_name,last_name,email,phone,lang,advisor_name`);
    if (!client) return json(404, { error: "We couldn't find client records for this email. Call (945) 407-8370 and we'll sort it out." });
    const [policies, docs] = await Promise.all([
      sb("GET", `policies?client_id=eq.${client.id}&status=neq.cancelled&select=id,line,carrier,policy_number,effective_date,renewal_date,status&order=renewal_date.asc.nullslast`),
      sb("GET", `policy_documents?client_id=eq.${client.id}&select=id,title,policy_id,storage_path,content_type,created_at&order=created_at.desc`),
    ]);
    const documents = await Promise.all(docs.map(async (x) => ({ id: x.id, title: x.title, policy_id: x.policy_id, created_at: x.created_at, content_type: x.content_type, url: await A.signedUrl(x.storage_path) })));
    sb("PATCH", `clients?id=eq.${client.id}`, { last_portal_login_at: new Date().toISOString() }, "return=minimal").catch(() => {});
    return json(200, {
      client: { first_name: client.first_name, last_name: client.last_name, email: client.email, lang: client.lang },
      advisor: { name: client.advisor_name || "JoJo Garcia", phone: "(945) 407-8370", email: "info@VossRiskAdvisors.com", photo: "/img/advisor.webp" },
      policies, documents,
    });
  }
  return json(400, { error: "Unknown action" });
};
