// netlify/functions/newsletter-review.js
// Agency-only approval page for a drafted newsletter (reached via the token
// link in the approval email).
//   GET  ?token=...            -> HTML preview + "Send" / "Discard" buttons
//   POST ?token=... action=send    -> send to all active subscribers
//   POST ?token=... action=discard -> mark the draft discarded
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL

const SITE = process.env.URL || "https://www.vossriskadvisors.com";

const html = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/html; charset=utf-8" },
  body,
});

const page = (title, inner) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#F5F0E6;color:#1C2433;margin:0;padding:30px 16px}
.card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e7e2d6;padding:28px}
h1{font-family:Georgia,serif;color:#0C2340}
.btn{display:inline-block;border:none;cursor:pointer;padding:13px 26px;font-size:14px;text-decoration:none;color:#fff;background:#0C2340}
.btn.gold{background:#C09C48;color:#001830}.btn.ghost{background:#8A8578}
.prev{border:1px solid #eee;margin-top:20px}</style></head><body><div class="card">${inner}</div></body></html>`;

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL } = process.env;
  const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (!token) return html(400, page("Not found", "<h1>Invalid link</h1><p>This approval link is missing its token.</p>"));

  const sbHeaders = { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };

  // Load the draft
  let draft;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletters?token=eq.${encodeURIComponent(token)}&select=*`, { headers: sbHeaders });
    const rows = await r.json();
    draft = rows && rows[0];
  } catch (e) { return html(500, page("Error", "<h1>Something went wrong</h1>")); }
  if (!draft) return html(404, page("Not found", "<h1>Not found</h1><p>This newsletter draft no longer exists.</p>"));

  // ----- GET: show preview + actions -----
  if (event.httpMethod !== "POST") {
    if (draft.status !== "draft") {
      return html(200, page("Already handled", `<h1>Already ${draft.status}</h1><p>This issue was already <strong>${draft.status}</strong>${draft.sent_at ? " on " + new Date(draft.sent_at).toDateString() : ""}.</p>`));
    }
    const preview = draft.body_html.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, "#");
    return html(200, page("Review newsletter", `
      <h1>Review this month's newsletter</h1>
      <p><strong>Subject:</strong> ${draft.subject}</p>
      <p>Review the preview below, then send it to all current subscribers or discard it.</p>
      <form method="POST" style="margin:18px 0">
        <button class="btn gold" name="action" value="send" type="submit">Approve &amp; send to all subscribers</button>
        <button class="btn ghost" name="action" value="discard" type="submit" style="margin-left:8px">Discard</button>
      </form>
      <div class="prev">${preview}</div>`));
  }

  // ----- POST: perform the action -----
  const params = new URLSearchParams(event.body || "");
  const action = params.get("action");

  if (draft.status !== "draft") {
    return html(200, page("Already handled", `<h1>Already ${draft.status}</h1><p>No action taken.</p>`));
  }

  if (action === "discard") {
    await fetch(`${SUPABASE_URL}/rest/v1/newsletters?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH", headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "discarded" }),
    });
    return html(200, page("Discarded", "<h1>Discarded</h1><p>This issue was discarded. Nothing was sent.</p>"));
  }

  if (action !== "send") return html(400, page("Error", "<h1>Unknown action</h1>"));

  // Load active subscribers
  let subs = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?unsubscribed=eq.false&select=email,token`, { headers: sbHeaders });
    subs = await r.json();
  } catch (e) { return html(500, page("Error", "<h1>Could not load subscribers</h1>")); }
  subs = (subs || []).filter((s) => s.email);

  // Send in batches of 100 via Resend's batch endpoint
  let sent = 0;
  for (let i = 0; i < subs.length; i += 100) {
    const chunk = subs.slice(i, i + 100).map((s) => {
      const unsub = `${SITE}/unsubscribe?token=${encodeURIComponent(s.token || "")}`;
      return {
        from: `Voss Risk Advisors <${FROM_EMAIL}>`,
        to: [s.email],
        subject: draft.subject,
        html: draft.body_html.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsub),
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    });
    try {
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify(chunk),
      });
      if (r.ok) sent += chunk.length; else console.error("batch send failed", await r.text());
    } catch (e) { console.error("batch error", e); }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/newsletters?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH", headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), recipient_count: sent }),
  });

  return html(200, page("Sent", `<h1>Sent ✓</h1><p>This month's newsletter went out to <strong>${sent}</strong> subscriber${sent === 1 ? "" : "s"}.</p>`));
};
