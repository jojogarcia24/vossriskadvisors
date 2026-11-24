// netlify/functions/monthly-report.js
// Scheduled for the 1st of each month (see netlify.toml): emails AGENCY_EMAIL
// a branded report on last month. The admin Clients page can also send it on
// demand (clients-admin.js, action "report").
const { buildReport } = require("./lib/report.js");
const { sendEmail } = require("./lib/drip.js");

exports.handler = async () => {
  if (!process.env.AGENCY_EMAIL) return { statusCode: 500, body: "AGENCY_EMAIL not set" };
  try {
    const r = await buildReport();
    await sendEmail(process.env.AGENCY_EMAIL, r.subject, r.html);
    return { statusCode: 200, body: JSON.stringify(r.stats) };
  } catch (e) {
    console.error("monthly-report", e.message);
    return { statusCode: 500, body: "error" };
  }
};
