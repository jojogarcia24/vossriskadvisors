// netlify/functions/lib/referral-updates.js
// Status emails to the real estate agent who referred a buyer (only when the
// agent confirmed the buyer agreed to share status). Sent from clients-admin.js
// when a referral lead is marked "quoted" or "Policy issued". No premiums or
// policy numbers are shared, just where things stand for the closing.
const E = require("./lead-email.js");
const { sendEmail } = require("./drip.js");

const fmtDate = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

async function notifyAgent(lead, kind, policy) {
  if (!lead || !lead.referred_by_email || !lead.share_status) return false;
  const first = String(lead.referred_by_name || "").split(" ")[0] || "there";
  const buyer = `${lead.first_name} ${lead.last_name || ""}`.trim();
  let subject, heading, paragraphs;
  if (kind === "quoted") {
    subject = `Update: ${buyer} has insurance options`;
    heading = `${E.esc(buyer)} has options`;
    paragraphs = [
      `Quick update, ${E.esc(first)}: we've shopped the coverage${lead.address ? " for <b>" + E.esc(lead.address) + "</b>" : ""} and sent ${E.esc(lead.first_name)} their options.`,
      lead.closing_date ? `We're working toward the <b>${E.esc(fmtDate(lead.closing_date))}</b> closing and will let you know as soon as the policy is issued.` : "We'll let you know as soon as the policy is issued.",
    ];
  } else {
    subject = `${buyer} is covered — policy issued`;
    heading = `${E.esc(buyer)} is covered`;
    paragraphs = [
      `Good news, ${E.esc(first)}: ${E.esc(lead.first_name)}'s ${E.esc((policy && policy.line || "homeowners").toLowerCase())} policy is issued${policy && policy.carrier ? " with <b>" + E.esc(policy.carrier) + "</b>" : ""}${policy && policy.effective_date ? ", effective <b>" + E.esc(fmtDate(policy.effective_date)) + "</b>" : ""}.`,
      "If the lender or title company needs evidence of insurance, have them email or call us and we'll send it right over.",
      "Thank you for the referral. We'll take great care of your client.",
    ];
  }
  const html = E.layout({
    title: subject, preheader: subject,
    eyebrow: "Referral update", eyebrowNote: lead.closing_date ? "closing " + fmtDate(lead.closing_date) : "",
    cards: E.textCard({ heading, paragraphs, buttons: E.button("Refer another client", "https://www.vossriskadvisors.com/realtors", true) + E.button("Call (945) 407-8370", "tel:+19454078370", false) }),
    footerNote: "You're getting this because you referred this client and they agreed we could keep you posted.",
  });
  await sendEmail(lead.referred_by_email, subject, html);
  return true;
}

module.exports = { notifyAgent };
