// netlify/functions/drip-runner.js
// Scheduled (see netlify.toml): sends every post-issue campaign touch that is
// due — branded emails, and texts via Twilio or the agency's "texts to send"
// digest. See lib/drip.js for the schedule and copy.
const { runDue } = require("./lib/drip.js");

exports.handler = async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) return { statusCode: 500, body: "Supabase not configured" };
  try {
    const counts = await runDue();
    console.log("drip-runner", counts);
    return { statusCode: 200, body: JSON.stringify(counts) };
  } catch (e) {
    console.error("drip-runner", e.message);
    return { statusCode: 500, body: "error" };
  }
};
