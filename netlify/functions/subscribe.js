// netlify/functions/subscribe.js
// Newsletter signup from the site footer. Stores the email in Supabase.
// Duplicate emails are ignored (no error). Bots are dropped via a honeypot.
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE

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

  // honeypot: silently succeed for bots
  if ((data.hp || "").toString().trim()) return json(200, { ok: true });

  const email = (data.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?on_conflict=email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ email, source: "website" }),
    });
    if (!r.ok && r.status !== 409) console.error("Subscribe insert failed:", await r.text());
  } catch (e) { console.error("Subscribe error:", e); }

  return json(200, { ok: true });
};
