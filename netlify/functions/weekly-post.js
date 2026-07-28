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
// DUPLICATE PROTECTION (added):
//   - Before writing, we pull every post from the last DEDUP_DAYS days out of
//     Supabase, pick a TOPIC that hasn't been covered recently, and hand the
//     model the recent titles with an instruction to pick a fresh angle.
//   - After generation, if the new title is essentially the same as a recent
//     one, we regenerate once; if it's still a duplicate, we skip for the week
//     rather than publish a near-copy.
//
// IMAGES (added):
//   - Each article gets one inline, on-brand photo inserted into the body so
//     posts aren't a wall of text. Images render via the site's markdown parser.
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
const DEDUP_DAYS = 150; // don't repeat a subject covered within this window

// Topics rotate so posts stay on-brand and within Voss's licensed lines.
// `sig` = lowercase keywords used to detect whether a topic was covered recently.
const TOPICS = [
  { t: "homeowners insurance tips for Dallas-area homeowners", sig: ["homeowner"] },
  { t: "auto insurance basics for Texas drivers", sig: ["auto insurance", "car insurance", "driver"] },
  { t: "flood risk and flood insurance for North Texas properties", sig: ["flood"] },
  { t: "landlord and rental property insurance for Texas investors", sig: ["landlord", "rental"] },
  { t: "how bundling home and auto insurance works in Texas", sig: ["bundl"] },
  { t: "what to check at your policy renewal", sig: ["renewal", "renew"] },
  { t: "how independent agencies shop coverage for you", sig: ["independent agent", "independent agenc", "shop coverage"] },
  { t: "preparing your Texas home for storm and hail season", sig: ["storm", "hail"] },
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

// Normalise a title for fuzzy duplicate comparison.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// On-brand category photos in /public/img. Each category has a small pool
// (agency-supplied blog photos + the original section photo); we pick one at
// random per article so posts don't reuse the same shot. Relative paths so
// they work on any domain the site is served from. To add more variety, drop
// files in /public/img/blog and add their paths to the matching list.
const IMAGE_POOL = {
  auto: ["/img/blog/auto-1.jpg", "/img/blog/auto-2.jpg", "/img/blog/auto-3.jpg", "/img/auto.webp"],
  flood: ["/img/blog/flood-1.jpg", "/img/blog/flood-2.jpg", "/img/blog/flood-3.jpg", "/img/flood.webp"],
  landlord: ["/img/blog/landlord-1.jpg", "/img/blog/home-1.jpg", "/img/landlord.webp"],
  home: ["/img/blog/home-1.jpg", "/img/blog/home-2.jpg", "/img/homeowners.webp"],
};
const poolFor = (cat) => {
  const c = (cat || "").toLowerCase();
  if (c.indexOf("auto") > -1) return IMAGE_POOL.auto;
  if (c.indexOf("flood") > -1) return IMAGE_POOL.flood;
  if (c.indexOf("landlord") > -1 || c.indexOf("rental") > -1) return IMAGE_POOL.landlord;
  return IMAGE_POOL.home;
};
const pickImage = (cat) => {
  const p = poolFor(cat);
  return p[Math.floor(Math.random() * p.length)];
};
const catAlt = (cat) => {
  const c = (cat || "").toLowerCase();
  if (c.indexOf("auto") > -1) return "A car on a North Texas road";
  if (c.indexOf("flood") > -1) return "Storm clouds over a Dallas-area neighborhood";
  if (c.indexOf("landlord") > -1 || c.indexOf("rental") > -1) return "A Texas rental property";
  return "A well-kept Dallas-area home";
};

// Insert one inline image into the body: right before the first "## " subhead
// (i.e. just after the intro), so the reader hits a visual early.
function withInlineImage(bodyMd, category) {
  const img = `![${catAlt(category)}](${pickImage(category)})`;
  const idx = bodyMd.indexOf("\n## ");
  if (idx === -1) return `${bodyMd}\n\n${img}`;
  return `${bodyMd.slice(0, idx)}\n\n${img}\n${bodyMd.slice(idx)}`;
}

const sbHeaders = () => ({
  "Content-Type": "application/json",
  apikey: process.env.SUPABASE_SERVICE_ROLE,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
});

// Pull recent posts (any status) for duplicate detection.
async function fetchRecent() {
  const since = new Date(Date.now() - DEDUP_DAYS * 86400000).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/blog_posts` +
    `?select=title,slug,category,created_at&created_at=gte.${encodeURIComponent(since)}` +
    `&order=created_at.desc`;
  try {
    const r = await fetch(url, { headers: sbHeaders() });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) {
    console.error("fetchRecent failed", e);
    return [];
  }
}

// Choose a topic not covered in the recent window; if all were, pick the one
// whose most-recent coverage is oldest.
function chooseTopic(recent) {
  const titles = recent.map((p) => (p.title || "").toLowerCase());
  const usedRecently = (sig) => titles.some((t) => sig.some((s) => t.includes(s)));

  const fresh = TOPICS.filter((x) => !usedRecently(x.sig));
  if (fresh.length) {
    const week = Math.floor(Date.now() / (7 * 86400000));
    return fresh[week % fresh.length];
  }
  // Everything's been covered — pick the least-recently-used topic.
  return TOPICS.map((x) => {
    let last = 0;
    recent.forEach((p) => {
      const t = (p.title || "").toLowerCase();
      if (x.sig.some((s) => t.includes(s))) {
        const ts = Date.parse(p.created_at) || 0;
        if (ts > last) last = ts;
      }
    });
    return { x, last };
  }).sort((a, b) => a.last - b.last)[0].x;
}

// Is `title` essentially the same as something we already have?
function isDuplicate(title, recent) {
  const n = norm(title);
  if (!n) return false;
  return recent.some((p) => {
    const rn = norm(p.title);
    if (!rn) return false;
    if (rn === n) return true;
    // one clearly contains the other (e.g. same headline + trailing words)
    return rn.length > 12 && (n.includes(rn) || rn.includes(n));
  });
}

async function generate(topic, recentTitles, avoidExtra) {
  const system =
    "You write blog posts for Voss Risk Advisors, an INDEPENDENT insurance agency in Dallas, Texas, " +
    "licensed for Personal Lines Property & Casualty (home, auto, landlord/rental, flood). " +
    "STRICT RULES: (1) Never state specific prices, premiums, percentages off, or rates. " +
    "(2) Never guarantee savings, approval, or outcomes. (3) Never give legal or tax advice. " +
    "(4) Only discuss personal lines coverage Voss can write; do NOT market commercial/business insurance. " +
    "(5) Educational and helpful, plain English, Texas/Dallas context, ~600 words. " +
    "(6) No hype words like 'cheapest' or 'guaranteed'. " +
    "(7) Do NOT reuse or lightly reword any of the recent titles you are given — choose a genuinely " +
    "distinct, specific angle and a distinct, specific title. " +
    "Return ONLY valid JSON, no preamble, with keys: title, category (one of Home, Auto, Flood, Landlord, General), " +
    "excerpt (one sentence), body_md (markdown, use ## for subheads).";

  const recentBlock = recentTitles.length
    ? `\n\nRecent titles already published (do NOT duplicate or lightly reword any of these):\n- ${recentTitles.join("\n- ")}`
    : "";
  const avoidBlock = avoidExtra ? `\n\nYour previous attempt "${avoidExtra}" was too similar to an existing post — pick a clearly different title and angle.` : "";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1600,
      system,
      messages: [{
        role: "user",
        content: `Write this week's post about: ${topic}. Return only the JSON object.${recentBlock}${avoidBlock}`,
      }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  const reviewMode = (process.env.REVIEW_MODE || "draft").toLowerCase();

  // 0) Look at what already exists so we don't repeat ourselves.
  const recent = await fetchRecent();
  const recentTitles = recent.map((p) => p.title).filter(Boolean);
  const chosen = chooseTopic(recent);
  const topic = chosen.t;

  // 1) Generate — retry once if the first attempt duplicates an existing post.
  let post;
  try {
    post = await generate(topic, recentTitles, null);
    if (isDuplicate(post.title, recent)) {
      console.warn(`Duplicate title "${post.title}" — regenerating once.`);
      post = await generate(topic, recentTitles, post.title);
    }
  } catch (e) {
    console.error("Generation failed:", e);
    return { statusCode: 500, body: "generation failed" };
  }

  // If it's STILL a duplicate, skip this run rather than publish a near-copy.
  if (isDuplicate(post.title, recent)) {
    console.warn(`Still a duplicate after retry ("${post.title}") — skipping this week.`);
    return { statusCode: 200, body: `skipped duplicate: ${post.title}` };
  }

  // 2) Guardrail check
  const hay = `${post.title} ${post.excerpt} ${post.body_md}`.toLowerCase();
  const hit = BLOCKLIST.find((w) => hay.includes(w));
  if (hit) {
    console.warn("Blocked by guardrail keyword:", hit, "— saving as draft for review.");
  }

  // 3) Add an inline image + disclaimer.
  const withImage = withInlineImage(post.body_md, post.category);
  const body_md = `${withImage}\n\n---\n\n*${DISCLAIMER}*`;
  const status = reviewMode === "auto" && !hit ? "published" : "draft";
  const slug = `${slugify(post.title)}-${Date.now().toString(36)}`;
  const token = randomUUID();

  // 4) Store
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        slug, title: post.title, category: post.category || "General",
        excerpt: post.excerpt, body_md, read: "4 min read",
        status, published_at: status === "published" ? new Date().toISOString() : null,
        generated_by: "ai", token,
      }),
    });
    if (!r.ok) { console.error("Insert failed:", await r.text()); return { statusCode: 500, body: "insert failed" }; }
  } catch (e) { console.error(e); return { statusCode: 500, body: "insert error" }; }

  // 5) If it's a draft, email the agency a preview + Publish/Discard link.
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
