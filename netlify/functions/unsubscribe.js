// netlify/functions/unsubscribe.js
// One-click unsubscribe from the newsletter, reached via the per-subscriber
// token link in every issue's footer (and the List-Unsubscribe header).
//   GET/POST ?token=...  -> mark that subscriber unsubscribed
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE

const confirm = (title, msg) => ({
  statusCode: 200,
  headers: { "Content-Type": "text/html; charset=utf-8" },
  body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:Arial,Helvetica,sans-serif;background:#F5F0E6;color:#1C2433;margin:0;padding:60px 16px;text-align:center}
.card{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e2d6;padding:36px}
h1{font-family:Georgia,serif;color:#0C2340}a{color:#0C2340}</style></head>
<body><div class="card"><h1>${title}</h1><p>${msg}</p><p><a href="https://www.vossriskadvisors.com">Return to vossriskadvisors.com</a></p></div></body></html>`,
});

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (!token) return confirm("Invalid link", "This unsubscribe link is missing its token.");

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ unsubscribed: true }),
    });
    if (!r.ok) console.error("unsubscribe failed", await r.text());
  } catch (e) { console.error("unsubscribe error", e); }

  return confirm("You're unsubscribed", "You won't receive any more newsletters from Voss Risk Advisors. You can still reach us any time at (214) 725-3348.");
};
