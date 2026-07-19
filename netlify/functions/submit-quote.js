// netlify/functions/submit-quote.js
// Receives a quote request from the website form, stores it in Supabase,
// emails the agency a lead alert, and emails the client a confirmation.
//
// Required environment variables (set in Netlify > Site settings > Environment):
//   SUPABASE_URL            e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE   the service_role key (SECRET — server only)
//   RESEND_API_KEY          from resend.com
//   FROM_EMAIL              e.g. quotes@vossriskadvisors.com  (verified domain)
//   AGENCY_EMAIL            where lead alerts go, e.g. info@vossriskadvisors.com

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const first = (data.first_name || "").trim();
  const last  = (data.last_name  || "").trim();
  const email = (data.email      || "").trim();
  const phone = (data.phone      || "").trim();
  const coverage = (data.coverage_type || "").trim();
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
      body: JSON.stringify({ first_name: first, last_name: last, email, phone, coverage_type: coverage, message, source: "website" }),
    });
    if (!r.ok) console.error("Supabase insert failed:", await r.text());
  } catch (e) { console.error("Supabase error:", e); }

  // 2) Email the agency a lead alert + 3) confirm to the client
  const send = (to, subject, html) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html }),
    }).catch((e) => console.error("Resend error:", e));

  const agencyHtml = `
    <h2>New quote request</h2>
    <p><b>${first} ${last}</b></p>
    <p>Email: ${email}<br>Phone: ${phone || "—"}<br>Coverage: ${coverage || "—"}</p>
    <p>${message ? message.replace(/</g, "&lt;") : "(no message)"}</p>`;

  const clientHtml = `
    <div style="font-family:Arial,sans-serif;color:#1C2433;max-width:520px">
      <h2 style="color:#0C2340">Thanks, ${first} — we've got your request.</h2>
      <p>A licensed advisor at Voss Risk Advisors will reach out within one business day to shop your
      ${coverage ? coverage.toLowerCase() + " " : ""}coverage across our carriers.</p>
      <p>If it's urgent, call us at <b>(214) 725-3348</b>.</p>
      <p style="color:#8A8578;font-size:13px;margin-top:28px">Voss Risk Advisors LLC · Dallas, TX ·
      Licensed in Texas · Personal Lines Property &amp; Casualty</p>
    </div>`;

  await Promise.all([
    AGENCY_EMAIL ? send(AGENCY_EMAIL, `New quote request — ${first} ${last}`, agencyHtml) : null,
    send(email, "We received your quote request — Voss Risk Advisors", clientHtml),
  ]);

  return json(200, { ok: true });
};
