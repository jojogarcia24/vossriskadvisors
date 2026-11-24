// netlify/functions/realtor-referral.js
// Realtor referrals from /realtors. Saves the buyer as a lead
// (quote_requests, source "referral", with the agent and closing date), then
// sends three branded emails: an alert to the agency (closing date flagged),
// a thank-you to the agent, and an intro to the buyer.
// Status updates back to the agent (quoted / policy issued) are sent from
// clients-admin.js, and only when the agent confirmed the buyer agreed.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL
const E = require("./lib/lead-email.js");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const clean = (v, n = 300) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const PHONE = "(945) 407-8370", SITE = "https://www.vossriskadvisors.com";
const fmtDate = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", timeZone: "UTC" }) : "";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let d; try { d = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  if (clean(d.hp)) return json(200, { ok: true });
  if (Number(d.elapsed_ms || 0) > 0 && Number(d.elapsed_ms) < 2500) return json(200, { ok: true });

  const agent = { name: clean(d.agent_name, 120), email: clean(d.agent_email, 160).toLowerCase(), phone: clean(d.agent_phone, 30), brokerage: clean(d.agent_brokerage, 120) };
  const buyer = { first: clean(d.client_first, 80), last: clean(d.client_last, 80), email: clean(d.client_email, 160).toLowerCase(), phone: clean(d.client_phone, 30) };
  const address = clean(d.property_address, 300);
  const closing = /^\d{4}-\d{2}-\d{2}$/.test(d.closing_date || "") ? d.closing_date : null;
  const coverages = (Array.isArray(d.coverages) ? d.coverages : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 8);
  const notes = clean(d.notes, 1500);
  const consent = d.client_consent === true, share = d.share_status === true;

  if (!agent.name || !okEmail(agent.email)) return json(400, { error: "Please add your name and email." });
  if (!buyer.first || (!okEmail(buyer.email) && buyer.phone.replace(/\D/g, "").length < 10)) return json(400, { error: "Please add your client's name and an email or phone." });
  if (!consent) return json(400, { error: "Please confirm your client agreed to be contacted." });

  const coverage = coverages.length > 1 ? "Bundle / multiple" : coverages[0] || "Homeowners";
  const daysToClose = closing ? Math.round((new Date(closing + "T12:00:00Z") - Date.now()) / 86400000) : null;
  const message = [
    `Realtor referral from ${agent.name}${agent.brokerage ? " (" + agent.brokerage + ")" : ""}`,
    coverages.length ? "Needs: " + coverages.join(", ") : "",
    closing ? `Closing: ${closing}${daysToClose != null ? ` (${daysToClose} days)` : ""}` : "",
    share ? "Client OK'd status updates to the agent." : "No status updates to the agent.",
    notes,
  ].filter(Boolean).join("\n");

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, Prefer: "return=minimal" },
        body: JSON.stringify({
          first_name: buyer.first, last_name: buyer.last || "", email: buyer.email || "", phone: buyer.phone || null,
          coverage_type: coverage, address, message, source: "referral",
          referred_by_name: agent.name, referred_by_email: agent.email, referred_by_phone: agent.phone || null,
          referred_by_brokerage: agent.brokerage || null, closing_date: closing, share_status: share,
        }),
      });
      if (!r.ok) console.error("referral: supabase", r.status, await r.text().catch(() => ""));
    } catch (e) { console.error("referral: supabase", e.message); }
  }

  if (RESEND_API_KEY && FROM_EMAIL) {
    const buyerName = `${buyer.first} ${buyer.last}`.trim();
    const urgent = daysToClose != null && daysToClose <= 14;
    const send = (to, subject, html, replyTo) => fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    }).catch((e) => console.error("referral: resend", e.message));
    const bd = E.digits(buyer.phone), ad = E.digits(agent.phone);
    const details = E.detailsCard("The referral", [
      ["Buyer", E.esc(buyerName)],
      ["Buyer phone", buyer.phone ? E.esc(E.prettyPhone(buyer.phone)) : ""],
      ["Buyer email", E.esc(buyer.email)],
      ["Property", E.esc(address)],
      ["Closing", closing ? `<b>${E.esc(fmtDate(closing))}</b>${daysToClose != null ? ` (${daysToClose} days)` : ""}` : ""],
      ["Coverage", E.esc(coverages.join(", "))],
      ["Agent", `${E.esc(agent.name)}${agent.brokerage ? " &middot; " + E.esc(agent.brokerage) : ""}<br>${E.esc(agent.email)}${agent.phone ? " &middot; " + E.esc(E.prettyPhone(agent.phone)) : ""}`],
      ["Status updates", share ? "Yes, buyer agreed" : "No"],
      ["Notes", E.esc(notes)],
    ]);
    const agencyHtml = E.layout({
      title: `Realtor referral: ${buyerName}`, preheader: `${agent.name} referred ${buyerName}${closing ? ", closing " + fmtDate(closing) : ""}.`,
      eyebrow: "Realtor referral", eyebrowNote: closing ? (urgent ? "closing in " + daysToClose + " days" : "closing " + fmtDate(closing)) : "reply within one business day",
      cards: E.textCard({
        eyebrow: urgent ? "Closing soon" : "New referral",
        heading: E.esc(buyerName),
        paragraphs: [`Referred by <b>${E.esc(agent.name)}</b>${agent.brokerage ? " of " + E.esc(agent.brokerage) : ""}.${closing ? ` Closing <b>${E.esc(fmtDate(closing))}</b>.` : ""}`],
        buttons: [bd.length === 10 ? E.button("Call " + buyer.first, "tel:+1" + bd, true) : "", buyer.email ? E.button("Email buyer", "mailto:" + buyer.email, bd.length !== 10) : "", ad.length === 10 ? E.button("Call agent", "tel:+1" + ad, false) : ""].join(""),
      }) + details,
      footerNote: "Saved in Admin &rarr; Clients &amp; Leads (source: referral). When you mark it quoted or Policy issued, the agent is updated automatically if the buyer agreed.",
    });
    const agentHtml = E.layout({
      title: "Thanks for the referral", preheader: `We'll reach out to ${buyer.first} within one business day.`,
      eyebrow: "Referral received",
      cards: E.textCard({
        heading: `Thank you, ${E.esc(agent.name.split(" ")[0])}!`,
        paragraphs: [
          `We've got <b>${E.esc(buyerName)}</b>${address ? " for " + E.esc(address) : ""}. A licensed advisor will reach out within one business day${urgent ? ", and sooner given the closing date" : ""}, shop the coverage across our carriers, and work to have evidence of insurance ready for the lender before closing.`,
          share ? "We'll email you when your client has options and again once the policy is issued, so you can keep the closing on track." : "Your client didn't opt in to status updates, so we'll keep the details between us and them. You're always welcome to call.",
          `Questions or a tight timeline? Call or text <b>${PHONE}</b>.`,
        ],
        buttons: E.button("Refer another client", SITE + "/realtors", true),
      }) + E.textCard({
        eyebrow: "Your personal referral link",
        paragraphs: [`Share this link with buyers and we'll know they came from you:<br><a href="${SITE}/contact?ref=${encodeURIComponent(agent.name)}" style="color:#0C2340">${SITE.replace("https://", "")}/contact?ref=${E.esc(encodeURIComponent(agent.name))}</a>`],
      }),
    });
    const buyerHtml = buyer.email ? E.layout({
      title: `${agent.name} introduced you to Voss Risk Advisors`, preheader: "We'll help you get insurance in place before closing.",
      eyebrow: "Introduction",
      cards: E.textCard({
        heading: `Hi ${E.esc(buyer.first)}, ${E.esc(agent.name.split(" ")[0])} asked us to help.`,
        paragraphs: [
          `Your agent, <b>${E.esc(agent.name)}</b>, introduced us to help with insurance${address ? " for <b>" + E.esc(address) + "</b>" : ""}. Your lender will need proof of homeowners insurance before closing${closing ? " on <b>" + E.esc(fmtDate(closing)) + "</b>" : ""}.`,
          "We're an independent agency, so we'll compare several carriers for you and explain the options in plain English. A licensed advisor will reach out within one business day.",
          `Want to get started now? Call or text <b>${PHONE}</b>, or reply to this email.`,
        ],
        buttons: E.button("Call " + PHONE, "tel:+19454078370", true) + E.button("Book a call", SITE + "/book", false),
      }),
    }) : null;
    await Promise.all([
      AGENCY_EMAIL ? send(AGENCY_EMAIL, `${urgent ? "⏱ " : ""}Realtor referral: ${buyerName}${closing ? " — closing " + fmtDate(closing) : ""}`, agencyHtml, agent.email) : null,
      send(agent.email, `Thanks for referring ${buyer.first} — Voss Risk Advisors`, agentHtml),
      buyerHtml ? send(buyer.email, `${agent.name} introduced you to Voss Risk Advisors`, buyerHtml, AGENCY_EMAIL || undefined) : null,
    ]);
  }
  return json(200, { ok: true });
};
