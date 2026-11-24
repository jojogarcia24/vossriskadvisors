// netlify/functions/client-unsubscribe.js
// One-click opt-out from the marketing touches (review, checkup, referral) of
// the post-issue campaign. Opening the link shows a confirm button; only the
// POST changes anything, because email security scanners open every link.
const { sb } = require("./lib/drip.js");

const page = (title, body) => ({
  statusCode: 200,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#F5F0E6;font-family:Arial,Helvetica,sans-serif;color:#1C2433">
<div style="max-width:520px;margin:60px auto;background:#fff;border:1px solid #E7E1D6;border-radius:8px;overflow:hidden">
<div style="background:#0C2340;padding:24px;text-align:center;color:#F5F0E6;font-family:Georgia,serif;letter-spacing:.18em;font-size:24px">VOSS<div style="color:#C09C48;font-family:Arial;font-size:10px;letter-spacing:.34em;margin-top:8px">RISK ADVISORS</div></div>
<div style="padding:30px 28px;line-height:1.7">${body}</div></div></body></html>`,
});

exports.handler = async (event) => {
  const t = String((event.queryStringParameters || {}).t || "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
  if (!t) return page("Unsubscribe", "<p>This link is incomplete.</p>");
  if (event.httpMethod === "POST") {
    try { await sb("PATCH", `clients?unsub_token=eq.${t}`, { unsubscribed: true }, "return=minimal"); } catch (e) { console.error(e.message); }
    return page("Unsubscribed", `<h2 style="font-family:Georgia,serif;color:#0C2340;margin-top:0">You're unsubscribed.</h2><p>You won't get review, checkup or referral emails from us anymore. We'll still send messages about policies you hold, like renewal reminders.</p><p>Changed your mind? Call or text (945) 407-8370.</p>`);
  }
  return page("Unsubscribe", `<h2 style="font-family:Georgia,serif;color:#0C2340;margin-top:0">Unsubscribe from Voss emails?</h2><p>You'll stop getting review, checkup and referral emails. Messages about policies you hold, like renewal reminders, will still come.</p>
<form method="post"><button style="background:#0C2340;color:#fff;border:0;padding:14px 26px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer">Unsubscribe me</button></form>`);
};
