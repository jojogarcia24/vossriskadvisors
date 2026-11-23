// netlify/functions/submit-health.js
// Marketplace (ACA) "help me enroll" request from the Health page.
// Stores a CMS consent record (append-only table) + a lead, and emails the
// agency. Health details are sensitive — we store only what's needed to help
// quote/enroll and NEVER console.log the form contents.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  body: JSON.stringify(body),
});

const NAVY = "#0C2340", NAVY_INK = "#001830", GOLD = "#C09C48", CREAM = "#F5F0E6", INK = "#1C2433", MUTED = "#8A8578";
const PHONE = "(945) 407-8370";
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Canonical consent wording, server-owned and versioned. The client sends only
// consent:true + the version; we store the authoritative text here so the record
// can't be tampered with from the browser.
const CONSENT_TEXT = {
  "2026-11":
    "I authorize Voss Risk Advisors and its licensed agent to help me apply for and enroll in a Health Insurance Marketplace plan, including reviewing my eligibility for financial assistance such as premium tax credits. My information will be kept confidential and used only to assist with my Marketplace enrollment; my consent is voluntary, not a condition of buying anything, and I may revoke it anytime.",
};
const CURRENT_CONSENT_VERSION = "2026-11";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  // Bot filter (honeypot + too-fast submit) — mirror submit-quote.
  if ((data.hp || "").toString().trim()) return json(200, { ok: true });
  const elapsed = Number(data.elapsed_ms || 0);
  if (elapsed > 0 && elapsed < 2500) return json(200, { ok: true });

  const first = (data.first_name || "").trim();
  const last = (data.last_name || "").trim();
  const email = (data.email || "").trim();
  const phone = (data.phone || "").trim();
  if (!first || !last || !email) return json(400, { error: "Name and email are required." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });
  if (data.consent !== true) return json(400, { error: "Consent is required to help with a Marketplace application." });

  const version = CONSENT_TEXT[data.consent_version] ? data.consent_version : CURRENT_CONSENT_VERSION;
  const consentText = CONSENT_TEXT[version];

  const h = event.headers || {};
  const ip = (h["x-nf-client-connection-ip"] || (h["x-forwarded-for"] || "").split(",")[0] || "").trim();
  const userAgent = (h["user-agent"] || "").slice(0, 400);

  const zip = (data.zip || "").trim();
  const county = (data.county || "").trim();
  const household = (data.household_size || "").toString().trim();
  const income = (data.income || "").trim();
  const ages = (data.ages || "").trim();
  const current = (data.current_coverage || "").trim();
  const isAgent = data.is_agent === true;

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
  const sbHeaders = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };

  // 1) Store the CMS consent record (append-only table). Note: we do NOT log the body.
  let consentId = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_consents`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        consumer_name: `${first} ${last}`, email, phone,
        zip, county, household_size: household, income, ages, current_coverage: current,
        is_agent: isAgent, consent: true, consent_text: consentText, consent_version: version,
        ip, user_agent: userAgent,
      }),
    });
    if (r.ok) { const rows = await r.json(); consentId = Array.isArray(rows) ? (rows[0] && rows[0].id) : null; }
    else console.error("consent insert failed:", r.status);
  } catch (e) { console.error("consent insert error:", (e && e.message) || "error"); }

  // 2) Store a lead row (coverage_type Health). Keep structured details out of logs.
  try {
    const detail = [
      household ? `Household size: ${household}` : "",
      income ? `Household income (yearly): ${income}` : "",
      ages ? `Ages needing coverage: ${ages}` : "",
      current ? `Current coverage: ${current}` : "",
      isAgent ? "Real estate agent: Yes" : "",
      consentId ? `Consent record: ${consentId} (v${version})` : "",
    ].filter(Boolean).join("\n");
    await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        first_name: first, last_name: last, email, phone,
        coverage_type: "Health (Marketplace)",
        address: [zip, county].filter(Boolean).join(", "),
        message: detail, source: "health",
      }),
    });
  } catch (e) { console.error("lead insert error:", (e && e.message) || "error"); }

  // 3) Emails (branded, compact).
  const shell = (inner, footer) => `
  <div style="margin:0;padding:24px 0;background:${CREAM};font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#fff;border:1px solid #e7e2d6">
        <tr><td style="background:${NAVY};padding:26px 34px" align="center">
          <div style="font-family:Georgia,serif;color:${CREAM};font-size:26px;letter-spacing:.18em">VOSS</div>
          <div style="height:1px;width:40px;background:${GOLD};margin:10px auto"></div>
          <div style="color:${GOLD};font-size:10px;letter-spacing:.34em;text-transform:uppercase">Risk Advisors</div>
        </td></tr>
        <tr><td style="padding:30px 34px;color:${INK};font-size:15px;line-height:1.7">${inner}</td></tr>
        <tr><td style="background:${NAVY_INK};padding:18px 34px;color:${MUTED};font-size:11px">${footer}</td></tr>
      </table>
    </td></tr></table>
  </div>`;
  const send = (to, subject, html, replyTo) => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  }).catch((e) => console.error("Resend error:", (e && e.message) || "error"));

  const row = (l, v) => v ? `<div style="margin:3px 0"><strong>${l}:</strong> ${esc(v)}</div>` : "";
  const agencyInner = `
    <h2 style="font-family:Georgia,serif;color:${NAVY};margin:0 0 6px">New Marketplace health request</h2>
    <p style="color:${GOLD};font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 16px">Consent on file${consentId ? ` · ${esc(consentId)}` : ""}</p>
    ${row("Name", `${first} ${last}`)}${row("Email", email)}${row("Phone", phone)}
    ${row("ZIP / County", [zip, county].filter(Boolean).join(" / "))}${row("Household size", household)}
    ${row("Income (yearly)", income)}${row("Ages", ages)}${row("Current coverage", current)}${isAgent ? `<div style="margin:3px 0"><strong>Real estate agent:</strong> Yes</div>` : ""}
    <p style="color:${MUTED};font-size:13px;margin:14px 0 0">Work this in HealthSherpa. Consent (v${version}) is stored and timestamped.</p>`;
  const clientInner = `
    <h2 style="font-family:Georgia,serif;color:${NAVY};margin:0 0 12px">Thanks, ${esc(first)} — we've got it.</h2>
    <p style="margin:0 0 14px">A licensed Voss Risk Advisors agent will reach out within <strong>one business day</strong> to help you compare Marketplace plans and find the premium tax credit you qualify for.</p>
    <p style="margin:0 0 14px">Open enrollment for 2027 runs through <strong>Jan 15</strong>. You can also review plans anytime at <a href="https://www.healthcare.gov" style="color:${NAVY}">HealthCare.gov</a>.</p>
    <p style="margin:0">Questions now? Call <strong>${PHONE}</strong>.</p>`;
  const footer = `Voss Risk Advisors LLC &middot; Licensed in Texas &middot; Marketplace-registered agent<br>This is general information, not tax or medical advice.`;

  try {
    await Promise.all([
      AGENCY_EMAIL ? send(AGENCY_EMAIL, `New Marketplace health request — ${first} ${last}`, shell(agencyInner, footer), email) : null,
      send(email, "We received your Marketplace health request — Voss Risk Advisors", shell(clientInner, footer)),
    ]);
  } catch (e) { console.error("email error:", (e && e.message) || "error"); }

  return json(200, { ok: true });
};
