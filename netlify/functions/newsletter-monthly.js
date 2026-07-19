// netlify/functions/newsletter-monthly.js
// Scheduled monthly (see netlify.toml). Composes a branded digest from the
// latest published blog posts, stores it as a DRAFT, and emails the agency an
// approval link. It never sends to subscribers on its own — you approve first.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL
//      URL (Netlify-provided site URL; falls back to the production domain)

const { randomUUID } = require("crypto");

const NAVY = "#0C2340", NAVY_INK = "#001830", GOLD = "#C09C48", CREAM = "#F5F0E6", INK = "#1C2433", MUTED = "#8A8578";
const SITE = process.env.URL || "https://www.vossriskadvisors.com";
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Per-recipient shell. {{UNSUBSCRIBE_URL}} is swapped in at send time.
const shell = (inner) => `
<div style="background:${CREAM};padding:24px 0;font-family:Arial,Helvetica,sans-serif">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#fff;border:1px solid #e7e2d6">
   <tr><td style="background:${NAVY};padding:24px 34px" align="center">
     <div style="font-family:Georgia,serif;color:${CREAM};font-size:24px;letter-spacing:.18em">VOSS</div>
     <div style="height:1px;width:36px;background:${GOLD};margin:9px auto"></div>
     <div style="color:${GOLD};font-size:10px;letter-spacing:.32em;text-transform:uppercase">Risk Advisors</div>
   </td></tr>
   <tr><td style="padding:30px 34px">${inner}</td></tr>
   <tr><td style="background:${NAVY_INK};padding:20px 34px">
     <div style="color:${CREAM};font-size:12px;line-height:1.7"><strong>Voss Risk Advisors LLC</strong><br>13155 Noel Rd Ste 900, Dallas, TX 75240 &middot; (214) 725-3348</div>
     <div style="color:${MUTED};font-size:11px;margin-top:10px">You're receiving this because you subscribed at vossriskadvisors.com. <a href="{{UNSUBSCRIBE_URL}}" style="color:${GOLD}">Unsubscribe</a>.</div>
   </td></tr>
  </table>
 </td></tr></table>
</div>`;

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
  const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` },
  });

  // 1) Latest published posts to feature
  let posts = [];
  try {
    const r = await sb("blog_posts?status=eq.published&order=published_at.desc&limit=3&select=slug,title,excerpt,category");
    if (r.ok) posts = await r.json();
  } catch (e) { console.error("posts fetch failed", e); }

  const cards = (posts || []).map((p) => `
    <div style="border-top:1px solid #eee;padding:16px 0">
      <div style="color:${GOLD};font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">${esc(p.category || "Guide")}</div>
      <div style="font-family:Georgia,serif;color:${NAVY};font-size:18px;font-weight:bold">${esc(p.title)}</div>
      <p style="color:${INK};font-size:14px;line-height:1.65;margin:6px 0 0">${esc(p.excerpt || "")}</p>
    </div>`).join("");

  const inner = `
    <h2 style="font-family:Georgia,serif;color:${NAVY};font-size:22px;margin:0 0 6px">This month from Voss Risk Advisors</h2>
    <p style="color:${INK};font-size:14px;line-height:1.7;margin:0 0 18px">A few quick reads to help you protect your home, auto, and property in Texas.</p>
    ${cards || `<p style="color:${INK};font-size:14px">Have questions about your coverage? Reply any time or call (214) 725-3348.</p>`}
    <div style="margin-top:22px"><a href="${SITE}/" style="background:${GOLD};color:${NAVY_INK};padding:12px 22px;text-decoration:none;font-size:13px;letter-spacing:.1em;text-transform:uppercase">Read more on our site</a></div>`;

  const subject = "Voss Risk Advisors — this month's insurance tips";
  const body_html = shell(inner);
  const token = randomUUID();

  // 2) Store draft
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, Prefer: "return=minimal" },
      body: JSON.stringify({ subject, body_html, status: "draft", token }),
    });
    if (!r.ok) { console.error("draft insert failed", await r.text()); return { statusCode: 500, body: "draft insert failed" }; }
  } catch (e) { console.error(e); return { statusCode: 500, body: "draft error" }; }

  // 3) Count current subscribers (for the approval email)
  let count = 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?unsubscribed=eq.false&select=email`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, Prefer: "count=exact", Range: "0-0" },
    });
    const cr = r.headers.get("content-range"); // e.g. 0-0/42
    if (cr && cr.includes("/")) count = parseInt(cr.split("/")[1], 10) || 0;
  } catch (e) { /* non-fatal */ }

  // 4) Email the agency an approval link
  const reviewUrl = `${SITE}/newsletter/review?token=${token}`;
  const approvalHtml = `
    <div style="font-family:Arial,sans-serif;color:${INK};max-width:560px">
      <h2 style="font-family:Georgia,serif;color:${NAVY}">This month's newsletter is ready to review</h2>
      <p>A draft has been prepared for <strong>${count}</strong> subscriber${count === 1 ? "" : "s"}. Nothing has been sent yet — review it and choose to send or discard.</p>
      <p style="margin:22px 0"><a href="${reviewUrl}" style="background:${NAVY};color:#fff;padding:13px 26px;text-decoration:none">Review &amp; send &rarr;</a></p>
      <p style="color:${MUTED};font-size:12px">Or open: ${reviewUrl}</p>
    </div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [AGENCY_EMAIL], subject: `[Approve] ${subject}`, html: approvalHtml }),
    });
  } catch (e) { console.error("approval email failed", e); }

  return { statusCode: 200, body: `draft created for ${count} subscribers` };
};
