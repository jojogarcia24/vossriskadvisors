// netlify/functions/clients-admin.js
// Admin API for the Clients page (public/admin-clients.html). Same sign-in as
// the carrier portal: POST JSON { action, token, ...payload }.
//
//   list_leads                          recent quote/chat/service requests
//   set_lead_status {id, status}        new | contacted | quoted | bound | lost
//   list_clients                        clients with policies, documents, campaign status
//   issue {lead_id?, client, policy}    "Policy issued": creates/updates the client, adds the
//                                       policy, queues the touch campaign, sends the welcome now
//   update_policy {id, fields}          edit dates/carrier/number, or status "cancelled"
//   upload_doc {client_id, policy_id?, title, filename, content_type, data_base64}
//   delete_doc {id}
//   portal_invite {client_id}           emails a branded portal sign-in link
//   set_client {id, fields}             sms_opt_in, lang, drip_paused, unsubscribed, phone, notes
//   run_drip                            send anything due right now
//   report {month?: "YYYY-MM"}          email the monthly report to you now
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL,
//      TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM (optional, for automatic texts)
const crypto = require("crypto");
const { json, authOk } = require("./lib/carriers");
const D = require("./lib/drip.js");
const A = require("./lib/portal-auth.js");
const { buildReport } = require("./lib/report.js");

const clean = (v, n = 300) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : null;
const LEAD_STATUS = ["new", "contacted", "quoted", "bound", "lost"];
const CLIENT_FIELDS = ["sms_opt_in", "lang", "drip_paused", "unsubscribed", "phone", "notes", "advisor_name"];
const POLICY_FIELDS = ["line", "carrier", "policy_number", "effective_date", "renewal_date", "annual_premium", "status", "notes"];

function addYears(d, n) { const x = new Date(d + "T12:00:00Z"); x.setUTCFullYear(x.getUTCFullYear() + n); return x.toISOString().slice(0, 10); }
function addMonths(d, n) { const x = new Date(d + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); }

async function sendInvite(client, invite) {
  await A.ensureAuthUser(client.email);
  const link = await A.magicLink(client.email);
  const m = A.portalEmail(client, link, invite);
  await D.sendEmail(client.email, m.subject, m.html);
  if (invite) await D.sb("PATCH", `clients?id=eq.${client.id}`, { portal_invited_at: new Date().toISOString() }, "return=minimal");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let d; try { d = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const who = authOk(d);
  if (!who) return json(401, { error: "Please sign in again." });
  const by = who.email || "admin";

  try {
    switch (d.action) {
      case "list_leads": {
        const leads = await D.sb("GET", "quote_requests?select=id,created_at,first_name,last_name,email,phone,coverage_type,address,message,source,status&order=created_at.desc&limit=300");
        return json(200, { leads });
      }
      case "set_lead_status": {
        if (!LEAD_STATUS.includes(d.status)) return json(400, { error: "Bad status" });
        await D.sb("PATCH", `quote_requests?id=eq.${encodeURIComponent(d.id)}`, { status: d.status }, "return=minimal");
        return json(200, { ok: true });
      }
      case "list_clients": {
        const clients = await D.sb("GET", "clients?select=*,policies(*),policy_documents(id,title,policy_id,created_at,content_type,size_bytes),drip_messages(id,policy_id,step,channel,status,due_at,sent_at,error)&order=created_at.desc&limit=500");
        return json(200, { clients, twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) });
      }
      case "issue": {
        const c = d.client || {}, p = d.policy || {};
        const email = clean(c.email, 160).toLowerCase();
        if (!clean(c.first_name) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Client first name and a valid email are required." });
        if (!clean(p.line)) return json(400, { error: "Pick the coverage line." });
        const effective = date(p.effective_date) || new Date().toISOString().slice(0, 10);
        const renewal = date(p.renewal_date) || (/auto/i.test(p.line) ? addMonths(effective, 6) : addYears(effective, 1));
        const [client] = await D.sb("POST", "clients?on_conflict=email", {
          first_name: clean(c.first_name, 80), last_name: clean(c.last_name, 80), email, phone: clean(c.phone, 30) || null,
          sms_opt_in: !!c.sms_opt_in, lang: c.lang === "es" ? "es" : "en",
          ...(d.lead_id ? { quote_request_id: d.lead_id } : {}),
        }, "return=representation,resolution=merge-duplicates");
        const [policy] = await D.sb("POST", "policies", {
          client_id: client.id, line: clean(p.line, 60), carrier: clean(p.carrier, 120) || null, policy_number: clean(p.policy_number, 80) || null,
          effective_date: effective, renewal_date: renewal,
          annual_premium: p.annual_premium !== "" && p.annual_premium != null && !isNaN(Number(String(p.annual_premium).replace(/[$,]/g, ""))) ? Number(String(p.annual_premium).replace(/[$,]/g, "")) : null,
          notes: clean(p.notes, 1000) || null,
        }, "return=representation");
        if (d.lead_id) await D.sb("PATCH", `quote_requests?id=eq.${encodeURIComponent(d.lead_id)}`, { status: "bound" }, "return=minimal").catch(() => {});
        const queued = await D.scheduleDrip(client, policy);
        let sent = null, invite = null;
        try { sent = await D.runDue({ clientId: client.id }); } catch (e) { sent = { error: e.message }; }
        try { if (d.send_portal_invite !== false) { await A.ensureAuthUser(email); invite = "ready"; } } catch (e) { invite = "error: " + e.message; }
        return json(200, { ok: true, client_id: client.id, policy_id: policy.id, queued: queued.length, sent, invite, by });
      }
      case "update_policy": {
        const f = {};
        for (const k of POLICY_FIELDS) if (d.fields && k in d.fields) f[k] = k.endsWith("_date") ? date(d.fields[k]) : k === "annual_premium" ? (d.fields[k] === "" ? null : Number(String(d.fields[k]).replace(/[$,]/g, ""))) : clean(d.fields[k], 500);
        const [policy] = await D.sb("PATCH", `policies?id=eq.${encodeURIComponent(d.id)}`, f, "return=representation");
        // A new renewal date re-schedules a renewal touch that hasn't gone out yet.
        if (policy && f.renewal_date) {
          await D.sb("DELETE", `drip_messages?policy_id=eq.${policy.id}&step=eq.renewal&status=eq.pending`, null, "return=minimal");
          const [client] = await D.sb("GET", `clients?id=eq.${policy.client_id}&select=*`);
          const at = new Date(f.renewal_date + "T15:00:00Z").getTime() - 45 * 86400000;
          if (at > Date.now()) {
            const rows = [{ client_id: client.id, policy_id: policy.id, step: "renewal", channel: "email", due_at: new Date(at).toISOString() }];
            if (client.phone) rows.push({ ...rows[0], channel: "sms" });
            await D.sb("POST", "drip_messages?on_conflict=policy_id,step,channel", rows, "return=minimal,resolution=merge-duplicates");
          }
        }
        return json(200, { ok: true, policy });
      }
      case "upload_doc": {
        const buf = Buffer.from(String(d.data_base64 || ""), "base64");
        if (!buf.length) return json(400, { error: "Empty file." });
        if (buf.length > 4.5 * 1024 * 1024) return json(400, { error: "Files must be under 4.5 MB." });
        const name = clean(d.filename, 120).replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-") || "document.pdf";
        const path = `${d.client_id}/${crypto.randomUUID().slice(0, 8)}-${name}`;
        await A.uploadObject(path, buf, clean(d.content_type, 80) || "application/pdf");
        const [doc] = await D.sb("POST", "policy_documents", {
          client_id: d.client_id, policy_id: d.policy_id || null, title: clean(d.title, 140) || name, storage_path: path,
          content_type: clean(d.content_type, 80) || null, size_bytes: buf.length, uploaded_by: by,
        }, "return=representation");
        return json(200, { ok: true, doc });
      }
      case "delete_doc": {
        const [doc] = await D.sb("GET", `policy_documents?id=eq.${encodeURIComponent(d.id)}&select=*`);
        if (doc) { await A.deleteObject(doc.storage_path); await D.sb("DELETE", `policy_documents?id=eq.${doc.id}`, null, "return=minimal"); }
        return json(200, { ok: true });
      }
      case "portal_invite": {
        const [client] = await D.sb("GET", `clients?id=eq.${encodeURIComponent(d.client_id)}&select=*`);
        if (!client) return json(404, { error: "Client not found." });
        await sendInvite(client, true);
        return json(200, { ok: true });
      }
      case "set_client": {
        const f = {};
        for (const k of CLIENT_FIELDS) if (d.fields && k in d.fields) f[k] = typeof d.fields[k] === "boolean" ? d.fields[k] : clean(d.fields[k], 1000);
        if ("lang" in f) f.lang = f.lang === "es" ? "es" : "en";
        await D.sb("PATCH", `clients?id=eq.${encodeURIComponent(d.id)}`, f, "return=minimal");
        return json(200, { ok: true });
      }
      case "run_drip": return json(200, { ok: true, counts: await D.runDue() });
      case "report": {
        const m = /^(\d{4})-(\d{2})$/.exec(d.month || "");
        const start = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1, 6)) : null;
        const r = await buildReport(start);
        const to = process.env.AGENCY_EMAIL || (who.email && who.email.includes("@") ? who.email : null);
        if (!to) return json(400, { error: "Set AGENCY_EMAIL in Netlify." });
        await D.sendEmail(to, r.subject, r.html);
        return json(200, { ok: true, to, stats: r.stats });
      }
      default: return json(400, { error: `Unknown action "${d.action}".` });
    }
  } catch (e) {
    console.error("clients-admin", d.action, e.message);
    return json(500, { error: String(e.message || e) });
  }
};
