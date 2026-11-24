// netlify/functions/service-request.js
// Policy service requests from existing clients (the /service page): add a
// driver or vehicle, remove one, ID cards, certificate of insurance, change of
// address, lender change, or anything else. Saves to quote_requests
// (source "service", coverage_type "Service: <type>"), emails the agency a
// branded card, and sends the client a branded confirmation.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL
const E = require("./lib/lead-email.js");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const clean = (v, n = 300) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const PHONE = "(945) 407-8370";

const TYPES = {
  "add-driver": "Add a driver",
  "add-vehicle": "Add or replace a vehicle",
  "remove": "Remove a driver or vehicle",
  "id-cards": "Auto ID cards",
  "coi": "Certificate of insurance",
  "address": "Change of address",
  "lender": "Mortgage / lender change",
  "other": "Other policy change",
};
// Labels for the detail fields each request type can send.
const FIELDS = {
  policy: "Policy / carrier", effective: "Effective date",
  driver_name: "Driver's name", driver_rel: "Relationship",
  vehicle: "Vehicle", vin: "VIN", replacing: "Replacing", lienholder: "Lienholder",
  remove_what: "Remove", id_vehicles: "Cards needed for",
  holder_name: "Certificate holder", holder_address: "Holder address", holder_email: "Send certificate to",
  additional_insured: "Additional insured", job: "Project / job", needed_by: "Needed by",
  new_address: "New address", move_date: "Move date",
  lender_name: "New lender", lender_address: "Lender address",
  notes: "Details",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Invalid JSON" }); }
  if (clean(d.hp)) return json(200, { ok: true }); // honeypot
  if (Number(d.elapsed_ms || 0) > 0 && Number(d.elapsed_ms) < 2500) return json(200, { ok: true });

  const type = TYPES[d.type] ? d.type : "other";
  const label = TYPES[type];
  const first = clean(d.first_name, 80), last = clean(d.last_name, 80);
  const email = clean(d.email, 160).toLowerCase(), phone = clean(d.phone, 30);
  if (!first || !last || !email) return json(400, { error: "Name and email are required." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });

  const details = Object.keys(FIELDS).map((k) => [FIELDS[k], clean(d[k], k === "notes" ? 2000 : 300)]).filter((r) => r[1]);
  const message = `Service request: ${label}\n` + details.map((r) => `${r[0]}: ${r[1]}`).join("\n");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, Prefer: "return=minimal" },
        body: JSON.stringify({ first_name: first, last_name: last, email, phone, coverage_type: "Service: " + label, address: clean(d.new_address, 300), message, source: "service" }),
      });
      if (!r.ok) console.error("service: supabase", r.status, await r.text().catch(() => ""));
    } catch (e) { console.error("service: supabase", e && e.message); }
  }

  if (RESEND_API_KEY && FROM_EMAIL) {
    const name = `${first} ${last}`;
    const dg = E.digits(phone);
    const urgent = type === "coi" && d.needed_by;
    const agencyHtml = E.layout({
      title: `Service request: ${label} — ${name}`,
      preheader: `${name} needs: ${label}`,
      eyebrow: "Client service request",
      eyebrowNote: urgent ? "certificate needed by " + clean(d.needed_by, 40) : "reply within one business day",
      cards:
        E.textCard({
          eyebrow: label,
          heading: E.esc(name),
          paragraphs: [`${E.esc(email)}${phone ? " &middot; " + E.esc(E.prettyPhone(phone)) : ""}`],
          buttons: [
            dg.length === 10 ? E.button("Call " + first, "tel:+1" + dg, true) : "",
            E.button("Reply by email", "mailto:" + email + "?subject=" + encodeURIComponent(label + " — Voss Risk Advisors"), dg.length !== 10),
          ].join(""),
        }) +
        E.detailsCard("Request details", details.map((r) => [r[0], E.esc(r[1]).replace(/\n/g, "<br>")])),
      footerNote: "Saved in Supabase &rarr; <em>quote_requests</em> (source: service). Reply to this email to answer the client directly.",
    });
    const clientHtml = E.layout({
      title: "We received your request — Voss Risk Advisors",
      preheader: `We got your ${label.toLowerCase()} request.`,
      eyebrow: "Request received",
      cards:
        E.textCard({
          heading: `Thanks, ${E.esc(first)}. We've got your request.`,
          paragraphs: [
            `Your advisor will handle your <strong>${E.esc(label.toLowerCase())}</strong> request and reply within one business day${type === "coi" ? ", sooner if you told us a deadline" : ""}.`,
            "<strong>Please note:</strong> changes to your coverage aren't in effect until we confirm them with you in writing. If we need sensitive details like a driver's license number, we'll ask by phone, never by email.",
            `Need it sooner? Call or text <strong>${PHONE}</strong>.`,
          ],
          buttons: E.button("Call " + PHONE, "tel:+19454078370", true),
        }) +
        E.detailsCard("What you sent", details.map((r) => [r[0], E.esc(r[1]).replace(/\n/g, "<br>")])),
    });
    const send = (to, subject, html, replyTo) => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    }).catch((e) => console.error("service: resend", e && e.message));
    await Promise.all([
      AGENCY_EMAIL ? send(AGENCY_EMAIL, `${urgent ? "⏱ " : ""}Service request: ${label} — ${name}`, agencyHtml, email) : null,
      send(email, `We received your request: ${label} — Voss Risk Advisors`, clientHtml),
    ]);
  }
  return json(200, { ok: true });
};
