// netlify/functions/submit-quote.js
// Receives a quote request from the website form, stores it in Supabase,
// emails the agency a lead alert, and emails the client a branded confirmation.
//
// Required environment variables (set in Netlify > Site settings > Environment):
//   SUPABASE_URL            e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE   the service_role key (SECRET — server only)
//   RESEND_API_KEY          from resend.com
//   FROM_EMAIL              e.g. info@vossriskadvisors.com  (verified domain)
//   AGENCY_EMAIL            where lead alerts go, e.g. info@vossriskadvisors.com

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

// Brand palette
const NAVY = "#0C2340", NAVY_INK = "#001830", GOLD = "#C09C48",
      CREAM = "#F5F0E6", PAPER = "#FBFAF7", INK = "#1C2433", MUTED = "#8A8578";
const LOGO_URL = "https://www.vossriskadvisors.com/email-logo.png";
const PHONE = "(214) 725-3348";
const AGENCY_ADDRESS = "13155 Noel Rd Ste 900, Dallas, TX 75240";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Branded HTML shell — navy header with logo + wordmark, content, navy footer.
const shell = (inner) => `
<div style="margin:0;padding:24px 0;background:${CREAM};font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#fff;border:1px solid #e7e2d6">
        <tr>
          <td style="background:${NAVY};padding:26px 34px" align="center">
            <img src="${LOGO_URL}" width="44" height="44" alt="Voss Risk Advisors"
                 style="display:block;border:0;margin:0 auto 12px;border-radius:8px">
            <div style="font-family:Georgia,'Times New Roman',serif;color:${CREAM};font-size:26px;letter-spacing:.18em;font-weight:normal">VOSS</div>
            <div style="height:1px;width:40px;background:${GOLD};margin:10px auto"></div>
            <div style="color:${GOLD};font-size:10px;letter-spacing:.34em;text-transform:uppercase">Risk Advisors</div>
          </td>
        </tr>
        <tr><td style="padding:34px 34px 10px">${inner}</td></tr>
        <tr>
          <td style="background:${NAVY_INK};padding:22px 34px">
            <div style="color:${CREAM};font-size:12px;line-height:1.7">
              <strong>Voss Risk Advisors LLC</strong><br>
              ${AGENCY_ADDRESS}<br>
              ${PHONE} &middot; <a href="mailto:info@vossriskadvisors.com" style="color:${GOLD};text-decoration:none">info@vossriskadvisors.com</a>
            </div>
            <div style="color:${MUTED};font-size:10px;line-height:1.6;margin-top:12px">
              Licensed in Texas &middot; Personal Lines Property &amp; Casualty &middot; Mon&ndash;Fri, 9am&ndash;6pm CT
            </div>
          </td>
        </tr>
      </table>
      <div style="color:${MUTED};font-size:11px;margin-top:16px">This is general information, not insurance advice.</div>
    </td></tr>
  </table>
</div>`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  // Silent bot filter: honeypot field filled, or form submitted implausibly
  // fast (a real person can't complete it in under ~2.5s). Return a fake
  // success so bots move on, without storing the row or sending emails.
  if ((data.hp || "").toString().trim()) return json(200, { ok: true });
  const elapsed = Number(data.elapsed_ms || 0);
  if (elapsed > 0 && elapsed < 2500) return json(200, { ok: true });

  const first = (data.first_name || "").trim();
  const last  = (data.last_name  || "").trim();
  const email = (data.email      || "").trim();
  const phone = (data.phone      || "").trim();
  const coverage = (data.coverage_type || "").trim();
  const address  = (data.address || "").trim();
  const message  = (data.message || "").trim();

  // basic validation
  if (!first || !last || !email) return json(400, { error: "Name and email are required." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;

  // 1) Store the lead in Supabase (via REST, service role)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ first_name: first, last_name: last, email, phone, coverage_type: coverage, address, message, source: "website" }),
    });
    if (!r.ok) console.error("Supabase insert failed:", await r.text());
  } catch (e) { console.error("Supabase error:", e); }

  // 2) Email the agency a lead alert + 3) branded confirmation to the client
  const send = (to, subject, html, replyTo) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    }).catch((e) => console.error("Resend error:", e));

  // ----- Agency lead alert (branded) -----
  const row = (label, val) => val
    ? `<tr><td style="padding:7px 0;color:${MUTED};font-size:13px;width:120px;vertical-align:top">${label}</td>
           <td style="padding:7px 0;color:${INK};font-size:14px">${esc(val).replace(/\n/g, "<br>")}</td></tr>`
    : "";
  const agencyInner = `
    <h2 style="font-family:Georgia,serif;color:${NAVY};font-size:22px;margin:0 0 6px">New quote request</h2>
    <p style="color:${GOLD};font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 18px">Website lead</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #eee">
      ${row("Name", `${first} ${last}`)}
      ${row("Email", email)}
      ${row("Phone", phone || "—")}
      ${row("Coverage", coverage || "—")}
      ${row("Address", address)}
      ${row("Details", message)}
    </table>`;

  // ----- Client confirmation (branded) -----
  const clientInner = `
    <h2 style="font-family:Georgia,serif;color:${NAVY};font-size:23px;margin:0 0 14px">Thanks, ${esc(first)} — we've got your request.</h2>
    <p style="color:${INK};font-size:15px;line-height:1.7;margin:0 0 16px">
      A licensed advisor at Voss Risk Advisors will reach out within <strong>one business day</strong> to shop your
      ${coverage ? esc(coverage.toLowerCase()) + " " : ""}coverage across our carriers and find the right fit.
    </p>
    ${(coverage || address) ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${PAPER};border:1px solid #ece7db;margin:0 0 18px">
      <tr><td style="padding:16px 18px">
        <div style="color:${MUTED};font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px">Your request</div>
        ${coverage ? `<div style="color:${INK};font-size:14px;margin:3px 0"><strong>Coverage:</strong> ${esc(coverage)}</div>` : ""}
        ${address ? `<div style="color:${INK};font-size:14px;margin:3px 0"><strong>Address:</strong> ${esc(address)}</div>` : ""}
      </td></tr>
    </table>` : ""}
    <p style="color:${INK};font-size:15px;line-height:1.7;margin:0 0 6px">
      If it's urgent, call us at <strong>${PHONE}</strong>.
    </p>`;

  await Promise.all([
    // agency alert: replies go to the client
    AGENCY_EMAIL ? send(AGENCY_EMAIL, `New quote request — ${first} ${last}`, shell(agencyInner), email) : null,
    // client confirmation: replies go to the agency inbox (FROM_EMAIL default)
    send(email, "We received your quote request — Voss Risk Advisors", shell(clientInner)),
  ]);

  return json(200, { ok: true });
};
