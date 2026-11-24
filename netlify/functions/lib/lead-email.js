// netlify/functions/lib/lead-email.js
// Branded, card-style HTML email for a new website chat lead: navy header
// with the Voss logo, a lead card with one-tap Call / Text / Email buttons,
// the details, and the conversation as chat bubbles. Table-based and inline
// styled so it renders in Gmail, Outlook and Apple Mail.

const NAVY = "#0C2340", NAVY_INK = "#001830", GOLD = "#C09C48",
      CREAM = "#F5F0E6", PAPER = "#FBFAF7", INK = "#1C2433", MUTED = "#6B665B", LINE = "#E7E1D6";
const LOGO_URL = "https://www.vossriskadvisors.com/email-logo.png";
const SITE = "https://www.vossriskadvisors.com";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const digits = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const prettyPhone = (p) => { const d = digits(p); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || ""); };

function button(label, href, primary) {
  return `<td style="padding:0 6px 8px 0">
    <a href="${esc(href)}" style="display:inline-block;padding:11px 18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:bold;text-decoration:none;border-radius:4px;${primary ? `background:${GOLD};color:${NAVY_INK};border:1px solid ${GOLD}` : `background:#ffffff;color:${NAVY};border:1px solid ${NAVY}`}">${esc(label)}</a></td>`;
}

function detailRow(label, value, last) {
  if (!value) return "";
  return `<tr><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${LINE};`}color:${MUTED};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;width:120px;vertical-align:top">${esc(label)}</td>
    <td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${LINE};`}color:${INK};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">${value}</td></tr>`;
}

// history: [{role:'user'|'assistant', content}] plus the final reply.
function bubbles(history) {
  return history.map((m) => {
    const visitor = m.role === "user";
    return `<tr><td align="${visitor ? "right" : "left"}" style="padding:4px 0">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin:0 4px 3px">${visitor ? "Visitor" : "Voss assistant"}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:84%"><tr><td style="padding:11px 14px;border-radius:14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;${visitor ? `background:${NAVY};color:#ffffff;border-bottom-right-radius:4px` : `background:#ffffff;color:${INK};border:1px solid ${LINE};border-bottom-left-radius:4px`}">${esc(m.content).replace(/\n/g, "<br>")}</td></tr></table>
    </td></tr>`;
  }).join("");
}

function card(inner, pad = "26px 28px") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:8px;margin:0 0 18px"><tr><td style="padding:${pad}">${inner}</td></tr></table>`;
}


// Shared shell: navy header with logo, eyebrow bar, cream body with cards, footer.
function layout({ title, preheader, eyebrow, eyebrowNote, cards, footerNote }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${CREAM}">
<div style="display:none;max-height:0;overflow:hidden;color:${CREAM}">${esc(preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%">
    <tr><td style="background:${NAVY};padding:28px 32px;border-radius:8px 8px 0 0" align="center">
      <img src="${LOGO_URL}" width="44" height="44" alt="Voss Risk Advisors" style="display:block;border:0;margin:0 auto 12px;border-radius:8px">
      <div style="font-family:Georgia,'Times New Roman',serif;color:${CREAM};font-size:26px;letter-spacing:.18em">VOSS</div>
      <div style="height:1px;width:40px;background:${GOLD};margin:10px auto"></div>
      <div style="color:${GOLD};font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.34em;text-transform:uppercase">Risk Advisors</div>
    </td></tr>
    <tr><td style="background:${NAVY_INK};padding:14px 32px" align="center">
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${GOLD}">${esc(eyebrow)}</span>${eyebrowNote ? `<span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#C9D0DB"> &middot; ${esc(eyebrowNote)}</span>` : ""}
    </td></tr>
    <tr><td style="background:${CREAM};padding:22px 0 4px">${cards}</td></tr>
    <tr><td style="background:${NAVY_INK};padding:20px 32px;border-radius:0 0 8px 8px">
      <div style="color:${CREAM};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7">
        <strong>Voss Risk Advisors LLC</strong> &middot; 13155 Noel Rd Ste 900, Dallas, TX 75240 &middot; (945) 407-8370<br>
        ${footerNote || "Licensed in Texas &middot; Property &amp; Casualty &middot; Life, Accident &amp; Health"}
      </div>
      <div style="margin-top:10px"><a href="${SITE}" style="color:${GOLD};font-family:Arial,Helvetica,sans-serif;font-size:12px;text-decoration:none">vossriskadvisors.com</a></div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// A card with a gold eyebrow and label/value rows. rows: [[label, htmlValue], ...]
function detailsCard(eyebrow, rows) {
  rows = rows.filter((r) => r[1]);
  if (!rows.length) return "";
  return card(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${GOLD};margin-bottom:6px">${esc(eyebrow)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map((r, i) => detailRow(r[0], r[1], i === rows.length - 1)).join("")}</table>`);
}

// A text card: heading + paragraphs (already-escaped HTML allowed) + optional buttons row.
function textCard({ eyebrow, heading, paragraphs = [], buttons = "" }) {
  return card(`${eyebrow ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${GOLD};margin-bottom:8px">${esc(eyebrow)}</div>` : ""}
    ${heading ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:${NAVY};line-height:1.25;margin-bottom:10px">${heading}</div>` : ""}
    ${paragraphs.map((p) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${INK};margin:0 0 12px">${p}</p>`).join("")}
    ${buttons ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>${buttons}</tr></table>` : ""}`);
}

/* lead: { first_name, last_name, email, phone, coverage, summary }, history: messages incl. final reply */
function chatLeadEmail({ lead, history, pageUrl }) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Website visitor";
  const initials = ((lead.first_name || "?").charAt(0) + (lead.last_name || "").charAt(0)).toUpperCase();
  const d = digits(lead.phone);
  const actions = [
    d.length === 10 ? button("Call " + (lead.first_name || ""), "tel:+1" + d, true) : "",
    d.length === 10 ? button("Text", "sms:+1" + d, false) : "",
    lead.email ? button("Email", "mailto:" + lead.email + "?subject=" + encodeURIComponent("Your insurance quote request — Voss Risk Advisors"), false) : "",
  ].join("");
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";

  const leadCard = card(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="64" style="vertical-align:middle">
        <div style="width:52px;height:52px;border-radius:50%;background:${NAVY};color:${GOLD};font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:52px;text-align:center">${esc(initials)}</div>
      </td>
      <td style="vertical-align:middle">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:${NAVY};line-height:1.2">${esc(name)}</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};margin-top:3px">${esc(lead.coverage || "Insurance quote")} &middot; ${esc(when)}</div>
      </td>
    </tr></table>
    ${lead.summary ? `<div style="margin:18px 0 4px;padding:14px 16px;background:${PAPER};border-left:3px solid ${GOLD};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK}">${esc(lead.summary)}</div>` : ""}
    ${actions ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${actions}</tr></table>` : ""}`);

  const rows = [
    ["Phone", lead.phone ? `<a href="tel:+1${d}" style="color:${NAVY};text-decoration:none">${esc(prettyPhone(lead.phone))}</a>` : ""],
    ["Email", lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:${NAVY}">${esc(lead.email)}</a>` : ""],
    ["Coverage", esc(lead.coverage)],
    ["From page", pageUrl ? `<a href="${esc(pageUrl)}" style="color:${NAVY}">${esc(pageUrl.replace(/^https?:\/\//, ""))}</a>` : ""],
  ].filter((r) => r[1]);
  const contactCard = card(`
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${GOLD};margin-bottom:6px">Contact details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map((r, i) => detailRow(r[0], r[1], i === rows.length - 1)).join("")}</table>`);

  const convoCard = card(`
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${GOLD};margin-bottom:12px">The conversation</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};border-radius:6px"><tr><td style="padding:14px 14px 10px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bubbles(history)}</table>
    </td></tr></table>`);

  return layout({ title: `New chat lead: ${name}`, preheader: lead.summary || name + " asked for a quote in the website chat.", eyebrow: "New website chat lead", eyebrowNote: "reply within one business day", cards: leadCard + contactCard + convoCard, footerNote: `Saved in Supabase &rarr; <em>quote_requests</em> (source: chat). Reply to this email to answer ${esc(lead.first_name || "them")} directly.` });
}

module.exports = { chatLeadEmail, layout, card, detailsCard, textCard, button, esc, prettyPhone, digits, NAVY, GOLD, INK, MUTED };
