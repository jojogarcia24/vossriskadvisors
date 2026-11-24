// netlify/functions/chat.js
// The website chat concierge (public/voss-chat.js). An AI assistant answers
// insurance questions first; once the visitor wants help and leaves a name and
// a phone or email, it becomes a lead: saved to Supabase (quote_requests,
// source "chat") and emailed to the agency with the full conversation. Later
// messages in the same chat keep the lead's transcript current (signed token).
//
// POST { messages:[{role:'user'|'assistant', content}], page_url, lead_id?, lead_token?, lead_saved? }
//   -> { ok, reply, page?, quote?, lead_id?, lead_token?, lead_saved? }
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY,
//      FROM_EMAIL, AGENCY_EMAIL, CHAT_AI_MODEL (optional)
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { chatLeadEmail } = require("./lib/lead-email.js");

const MODEL = process.env.CHAT_AI_MODEL || "claude-opus-5-5";
const PHONE = "(945) 407-8370";
const MAX_TURNS = 30, MAX_CHARS = 1500;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const clean = (v, n = 200) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signLead = (id) => crypto.createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE || "x").update("voss-chat:" + id).digest("base64url").slice(0, 32);

// Best-effort per-IP limit (per warm function instance): 30 replies / 10 min.
const hits = new Map();
function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 30;
}

// Pages the assistant can point to (the widget shows a button for them).
const PAGES = ["homeowners", "auto", "renters", "landlord", "flood", "umbrella", "private-client", "commercial",
  "life", "disability", "health", "coverage", "carriers", "support", "service", "about", "resources", "faq", "contact", "book", "es", "realtors"];
// Quote-form coverage values the widget can pre-select.
const QUOTE = ["Homeowners", "Auto", "Renters", "Landlord / Rental", "Flood", "Umbrella", "Private client / high-value",
  "Commercial / business", "Life", "Disability", "Bundle / multiple"];

const SYSTEM = `You are the website assistant for Voss Risk Advisors LLC, an independent insurance agency at 13155 Noel Rd Ste 900, Dallas, TX 75240. Phone ${PHONE}, email info@VossRiskAdvisors.com, hours Mon–Fri 9am–6pm CT. You chat with visitors in a small chat window on the website.

About the agency:
- Independent: we shop coverage across multiple carriers instead of selling one company's product. A dedicated licensed advisor handles quotes, renewals, changes, and claim help. Every request gets a response within one business day. Comparing costs nothing.
- Licensed in Texas for Property & Casualty and Life, Accident & Health (TDI License #3514065). We serve Texas.
- Coverage we place: homeowners, auto, renters, landlord / rental property, flood, personal umbrella, private client (high-value homes, collections, multiple properties, collector cars, boats), commercial (BOP, general liability, workers' comp, commercial auto and trucking, umbrella, cyber, E&O, D&O, bonds), life (term and permanent), and disability income (built for self-employed and 1099 earners). Marketplace (ACA) health plans are coming soon; visitors can join the waitlist on the health page.
- Claims and payments are handled directly with the carrier; the Claims & Payments page ("support") has carrier links. Existing clients can request policy changes, auto ID cards, certificates of insurance, address or lender changes on the Policy service page ("service"). Visitors can also book a call on the "book" page. Plain-English checklists for life changes (new home, teen driver, marriage or baby, starting a business, retiring) are on the "resources" page.
- A new agency: there are no reviews yet. Never invent reviews, client counts, years in business, carrier lists, ratings, or awards.

What you do:
- Answer insurance questions warmly and briefly: 1–3 short sentences, plain text, no markdown, no lists. Explain coverage in plain language.
- Point to the most relevant page when it helps by setting "page" (the site shows a button). Set "quote" to the matching quote-form coverage when the visitor wants a quote, so the site can open the form pre-filled.
- When the visitor wants a quote, a policy review, help with their policy, or to talk to someone, offer to have a licensed advisor reach out. Collect, one question at a time and in this order: what they want covered (if not clear yet), their first AND last name (ask for both together: "What's your first and last name?"; if they give only a first name, ask for their last name), their phone number, then their email address. We need both a phone number and an email so the advisor can call and send the quote options. If they give one, ask for the other.
- Once you have a first name, a last name, a phone number AND an email, and they agreed to be contacted, set lead.ready to true and tell them a licensed advisor will reach out within one business day. Only if the visitor clearly refuses to share their last name, phone or email after you asked once, accept what they gave (a first name plus a phone or an email), set lead.declined to true and lead.ready to true. Never pressure them. Then keep helping: ask one useful question at a time an advisor will want to know (what they want covered, when their current policy renews, the property ZIP or vehicles, whether they want to bundle). Never say goodbye unless they do.

Rules:
- You are an AI assistant. If asked, say so plainly. Never claim to be a person or a licensed agent.
- Never quote prices, premiums, rates, discounts, or savings, and never promise approval or that a carrier will offer coverage. Pricing needs a real quote from an advisor.
- You cannot bind, change, or cancel coverage. Never tell someone they are covered. Never decide whether a claim is covered; that depends on the policy, so connect them with an advisor and their carrier. For an emergency or a new claim, tell them to contact their carrier's claims line right away (the Claims & Payments page has links) and to call ${PHONE}.
- No legal, tax, medical, or investment advice.
- Do not ask for Social Security numbers, dates of birth, driver's license numbers, bank or card numbers, or medical details. If someone shares them, tell them not to share sensitive information in chat and that an advisor will collect what is needed securely.
- If the visitor writes in Spanish, answer in Spanish. The agency serves Spanish-speaking clients; the Spanish page is "es".
- Stay on topic: insurance and this agency. Politely decline unrelated requests.
- Keep lead fields exactly as the visitor gave them; use null for anything you do not know.`;

const nstr = { anyOf: [{ type: "string" }, { type: "null" }] };
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["reply", "page", "quote", "lead"],
  properties: {
    reply: { type: "string", description: "What you say to the visitor: 1–3 short sentences, plain text." },
    page: { anyOf: [{ type: "string", enum: PAGES }, { type: "null" }], description: "A site page worth showing as a button, or null." },
    quote: { anyOf: [{ type: "string", enum: QUOTE }, { type: "null" }], description: "Quote-form coverage to pre-select when they want a quote, or null." },
    lead: {
      type: "object", additionalProperties: false,
      required: ["ready", "declined", "first_name", "last_name", "email", "phone", "coverage", "summary"],
      properties: {
        ready: { type: "boolean", description: "True once you have first name, last name, phone and email (or the visitor refused some after being asked) and they agreed to be contacted." },
        declined: { type: "boolean", description: "True only if the visitor clearly refused to share their last name, phone or email after being asked." },
        first_name: nstr, last_name: nstr, email: nstr, phone: nstr,
        coverage: { ...nstr, description: "What they want covered, in their words." },
        summary: { ...nstr, description: "One sentence for the advisor: who they are and what they need." },
      },
    },
  },
};

function transcript(history, reply) {
  const lines = history.map((m) => (m.role === "user" ? "Visitor: " : "Assistant: ") + m.content);
  if (reply) lines.push("Assistant: " + reply);
  return lines.join("\n").slice(-8000);
}

const sb = (path, opts = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: {
    "Content-Type": "application/json",
    apikey: process.env.SUPABASE_SERVICE_ROLE,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    ...(opts.headers || {}),
  },
});

async function saveLead(lead, convo, pageUrl, history) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
  let id = null;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
    try {
      const r = await sb("quote_requests", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          first_name: lead.first_name, last_name: lead.last_name || "", email: lead.email || "", phone: lead.phone || "",
          coverage_type: lead.coverage || "", message: "Website chat" + (pageUrl ? " (" + pageUrl + ")" : "") + "\n\n" + convo,
          source: "chat",
        }),
      });
      const rows = r.ok ? await r.json() : [];
      if (!r.ok) console.error("chat: supabase insert", r.status, await r.text().catch(() => ""));
      id = rows && rows[0] && rows[0].id || null;
    } catch (e) { console.error("chat: supabase", e && e.message); }
  }
  if (RESEND_API_KEY && FROM_EMAIL && AGENCY_EMAIL) {
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
    const html = chatLeadEmail({ lead, history, pageUrl });
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [AGENCY_EMAIL], subject: `New chat lead: ${name}${lead.coverage ? " · " + lead.coverage : ""}`, html, ...(lead.email ? { reply_to: lead.email } : {}) }),
    }).catch((e) => console.error("chat: resend", e && e.message));
  }
  return id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { ok: false, error: "Bad JSON" }); }

  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return json(400, { ok: false, error: "Say something first." });
  if (history.length > MAX_TURNS * 2) {
    return json(200, { ok: true, reply: `This chat has gotten long. For anything else, call or text us at ${PHONE} and we'll take it from here.` });
  }
  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "";
  if (rateLimited(ip)) return json(429, { ok: false, reply: `Too many messages just now. Please try again in a few minutes, or call ${PHONE}.` });
  if (!process.env.ANTHROPIC_API_KEY) return json(200, { ok: true, reply: `Chat isn't set up yet. Please call or text ${PHONE}, or use the quote form.` });

  let out;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25000, maxRetries: 1 });
    const req = {
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: history,
    };
    let resp;
    try {
      // Server-side fallback: if a safety classifier declines, another model answers in the same call.
      resp = await client.beta.messages.create({ ...req, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.error("chat: retrying without fallbacks", e.message);
      resp = await client.messages.create(req);
    }
    if (resp.stop_reason === "refusal") {
      return json(200, { ok: true, reply: `I can't help with that one, but our team can. Call or text ${PHONE}.` });
    }
    const text = (resp.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    out = JSON.parse(text);
  } catch (e) {
    console.error("chat", e && e.status, e && e.message);
    return json(200, { ok: true, code: (e && e.status) || "error", reply: `Sorry, I had a hiccup. Could you say that again? Or call ${PHONE} and we'll help right away.` });
  }

  const reply = clean(out.reply, 1200) || "Tell me a bit more about what you'd like to protect.";
  const L = out.lead && typeof out.lead === "object" ? out.lead : {};
  const lead = {
    first_name: clean(L.first_name, 80), last_name: clean(L.last_name, 80), email: clean(L.email, 160).toLowerCase(),
    phone: clean(L.phone, 30), coverage: clean(L.coverage, 120), summary: clean(L.summary, 300),
  };
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) lead.email = "";
  if (String(lead.phone).replace(/\D/g, "").length < 10) lead.phone = "";
  const convo = transcript(history, reply);
  const pageUrl = clean(b.page_url, 300);

  let leadId = null, saved = false;
  if (UUID.test(String(b.lead_id || "")) && b.lead_token === signLead(b.lead_id)) {
    // Lead already made in this chat: keep its transcript current.
    leadId = b.lead_id;
    await sb("quote_requests?id=eq." + encodeURIComponent(leadId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ message: "Website chat" + (pageUrl ? " (" + pageUrl + ")" : "") + "\n\n" + convo }),
    }).catch(() => {});
  } else if (!b.lead_saved && L.ready === true && lead.first_name &&
             ((lead.last_name && lead.email && lead.phone) || (L.declined === true && (lead.email || lead.phone)))) {
    leadId = await saveLead(lead, convo, pageUrl, history.concat([{ role: "assistant", content: reply }]));
    saved = true;
  }

  return json(200, {
    ok: true, reply,
    ...(PAGES.includes(out.page) ? { page: out.page } : {}),
    ...(QUOTE.includes(out.quote) ? { quote: out.quote } : {}),
    ...(leadId ? { lead_id: leadId, lead_token: signLead(leadId) } : {}),
    ...(saved ? { lead_saved: true } : {}),
  });
};
