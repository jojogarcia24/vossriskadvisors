// netlify/functions/weekly-post.js
// Runs on a schedule (see netlify.toml). Generates ONE Texas-focused insurance
// article with the Anthropic API, runs it through compliance guardrails, and
// writes it to Supabase.
//
// GUARDRAIL / SAFETY DESIGN:
//   - The system prompt forbids specific rates, guarantees, legal advice, and
//     any claim Voss can't back up. Every post ends with a disclaimer.
//   - REVIEW_MODE controls publishing:
//       "auto"   -> post is published immediately (hands-off)
//       "draft"  -> post is saved as 'draft' AND the agency is emailed a preview
//                   with a Publish/Discard link. Nothing goes live until approved.
//     Set REVIEW_MODE=draft in Netlify env if you'd rather approve each one.
//   - A keyword blocklist rejects a draft that slips past the prompt.
//
// Required environment variables:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE
//   RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL   (for the approval email)
//   REVIEW_MODE            "auto" or "draft"  (defaults to "draft")
//   ANTHROPIC_MODEL        optional, defaults to a current Sonnet model string
//   URL                    Netlify-provided site URL (fallback below)

const { randomUUID } = require("crypto");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const SITE = process.env.URL || "https://www.vossriskadvisors.com";

// Topics rotate so posts stay on-brand and within Voss's licensed lines.
const TOPICS = [
  "homeowners insurance tips for Dallas-area homeowners",
  "auto insurance basics for Texas drivers",
  "flood risk and flood insurance for North Texas properties",
  "landlord and rental property insurance for Texas investors",
  "how bundling home and auto works in Texas",
  "what to check at policy renewal time",
  "how independent agencies shop coverage for you",
  "preparing your Texas home for storm and hail season",
];

const BLOCKLIST = [
  "guaranteed", "guarantee", "cheapest", "lowest price", "we promise",
  "always cheaper", "risk-free", "100% covered", "never denied",
];

const DISCLAIMER =
  "This article is general information, not insurance, legal, or financial advice. " +
  "Coverage availability, terms, and pricing vary by carrier and by your specific situation. " +
  "Talk to a licensed advisor about your own needs.";

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

exports.handler = async () => {
  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  const reviewMode = (process.env.REVIEW_MODE || "draft").toLowerCase();
  const topic = TOPICS[new Date().getUTCDay() % TOPICS.length];

  const system =
    "You write blog posts for Voss Risk Advisors, an INDEPENDENT insurance agency in Dallas, Texas, " +
    "licensed for Personal Lines Property & Casualty (home, auto, landlord/rental, flood). " +
    "STRICT RULES: (1) Never state specific prices, premiums, percentages off, or rates. " +
    "(2) Never guarantee savings, approval, or outcomes. (3) Never give legal or tax advice. " +
    "(4) Only discuss personal lines coverage Voss can write; do NOT market commercial/business insurance. " +
    "(5) Educational and helpful, plain English, Texas/Dallas context, ~600 words. " +
    "(6) No hype words like 'cheapest' or 'guaranteed'. " +
    "Return ONLY valid JSON, no preamble, with keys: title, category (one of Home, Auto, Flood, Landlord, General), " +
    "excerpt (one sentence), body_md (markdown, use ## for subheads).";

  // 1) Generate
  let post;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: `Write this week's post about: ${topic}. Return only the JSON object.` }],
      }),
    });
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    post = JSON.parse(text);
  } catch (e) {
    console.error("Generation failed:", e);
    return { statusCode: 500, body: "generation failed" };
  }

  // 2) Guardrail check
  const hay = `${post.title} ${post.excerpt} ${post.body_md}`.toLowerCase();
  const hit = BLOCKLIST.find((w) => hay.includes(w));
  if (hit) {
    console.warn("Blocked by guardrail keyword:", hit, "— saving as draft for review.");
  }

  const body_md = `${post.body_md}\n\n---\n\n*${DISCLAIMER}*`;
  const status = reviewMode === "auto" && !hit ? "published" : "draft";
  const slug = `${slugify(post.title)}-${Date.now().toString(36)}`;
  const token = randomUUID();

  // 3) Store
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        slug, title: post.title, category: post.category || "General",
        excerpt: post.excerpt, body_md, read: "4 min read",
        status, published_at: status === "published" ? new Date().toISOString() : null,
        generated_by: "ai", token,
      }),
    });
    if (!r.ok) { console.error("Insert failed:", await r.text()); return { statusCode: 500, body: "insert failed" }; }
  } catch (e) { console.error(e); return { statusCode: 500, body: "insert error" }; }

  // 4) If it's a draft, email the agency a preview + Publish/Discard link.
  if (status === "draft") {
    const { RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
    const reviewUrl = `${SITE}/blog/review?token=${token}`;
    const flag = hit ? `<p style="color:#B4531F;font-size:13px"><strong>Heads up:</strong> a guardrail keyword ("${hit}") was detected — please read carefully before publishing.</p>` : "";
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `
      <div style="font-family:Arial,sans-serif;color:#1C2433;max-width:560px">
        <h2 style="font-family:Georgia,serif;color:#0C2340">This week's blog post is ready to review</h2>
        <p style="color:#8A8578;font-size:12px;letter-spacing:.12em;text-transform:uppercase">${esc(post.category || "General")}</p>
        <h3 style="font-family:Georgia,serif;color:#0C2340;margin:4px 0 8px">${esc(post.title)}</h3>
        <p style="font-size:14px;line-height:1.6">${esc(post.excerpt || "")}</p>
        ${flag}
        <p style="margin:22px 0"><a href="${reviewUrl}" style="background:#0C2340;color:#fff;padding:13px 26px;text-decoration:none">Review, then Publish &rarr;</a></p>
        <p style="color:#8A8578;font-size:12px">Nothing is live yet. Or open: ${reviewUrl}</p>
      </div>`;
    try {
      if (RESEND_API_KEY && FROM_EMAIL && AGENCY_EMAIL) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [AGENCY_EMAIL], subject: `[Review] New blog draft — ${post.title}`, html }),
        });
      }
    } catch (e) { console.error("approval email failed", e); }
  }

  return { statusCode: 200, body: `ok: ${status} — ${post.title}` };
};
