// netlify/functions/drip-runner.js
// Scheduled (see netlify.toml): sends every post-issue campaign touch that is
// due — branded emails, and texts via Twilio or the agency's "texts to send"
// digest — and creates renewal re-shop tasks. See lib/drip.js.
const { runDue, ensureRenewalTasks, sendTaskDigest } = require("./lib/drip.js");

exports.handler = async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) return { statusCode: 500, body: "Supabase not configured" };
  try {
    const counts = await runDue();
    // Renewal re-shop tasks for policies renewing in the next ~50 days.
    const created = await ensureRenewalTasks();
    await sendTaskDigest(created);
    counts.tasks_created = created.length;
    console.log("drip-runner", counts);
    return { statusCode: 200, body: JSON.stringify(counts) };
  } catch (e) {
    console.error("drip-runner", e.message);
    return { statusCode: 500, body: "error" };
  }
};
