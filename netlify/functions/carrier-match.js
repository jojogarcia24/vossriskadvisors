// netlify/functions/carrier-match.js
// Password-gated AI assistant for the admin portal. Takes a client scenario,
// runs it against the AGENCY'S APPROVED carriers only, and asks Claude to rank
// the best-fit markets with reasons + cautions. Saves each result to
// carrier_recommendations so the portal can show a history.
//
// POST JSON: { action, password, ...payload }
//   match       { scenario, client_name?, history? } -> Claude ranks fits, saves, returns it
//   list_recs                                         -> saved recommendations (newest first)
//   delete_rec  { id }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, ADMIN_PASSWORD, ANTHROPIC_API_KEY,
//      ANTHROPIC_MODEL (optional)

const { json, sbSelect, sbWrite, checkAuth } = require("./lib/carriers");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

async function approvedCarriers() {
  // Only "active appointments" — carriers marked approved.
  return sbSelect(
    "carriers?status=eq.approved&select=name,product_lines,states,best_for,appetite,requirements,do_not_submit,helpful_hints&order=name.asc"
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (!checkAuth(data.password)) return json(401, { error: "Wrong password." });

  try {
    if (data.action === "list_recs") {
      const recs = await sbSelect("carrier_recommendations?select=*&order=created_at.desc");
      return json(200, { recommendations: recs });
    }

    if (data.action === "delete_rec") {
      await sbWrite("DELETE", `carrier_recommendations?id=eq.${encodeURIComponent(data.id)}`);
      return json(200, { ok: true });
    }

    if (data.action === "match") {
      return await match(data);
    }

    return json(400, { error: `Unknown action "${data.action}".` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};

async function match(data) {
  const scenario = String(data.scenario || "").trim();
  if (!scenario) return json(400, { error: "Describe the client / risk first." });
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: "ANTHROPIC_API_KEY is not set." });

  const carriers = await approvedCarriers();
  if (!carriers.length) {
    return json(200, {
      recommendation: {
        client_name: data.client_name || null,
        summary: "No approved carriers yet.",
        top_carrier: null,
        recommendations: [],
        note: "Mark at least one carrier as Approved in the portal, then try again — the assistant only matches against carriers you're actively appointed with.",
      },
      saved: false,
    });
  }

  const system =
    "You are a placement assistant for Voss Risk Advisors, an independent PERSONAL LINES insurance agency in Texas. " +
    "You are given (a) a short description of a client/risk and (b) the ONLY carriers the agency is appointed with (their appetite, requirements, do-not-submit rules, product lines, and states). " +
    "Recommend the best-fit carriers FROM THE PROVIDED LIST ONLY — never invent or suggest a carrier that isn't in the list. " +
    "Weigh product line, state availability, appetite, requirements, and especially do-not-submit rules. " +
    "If key facts are missing (state, year built, prior losses, roof age, coverage amount, etc.), still give your best ranking and list what to confirm. " +
    "Never quote specific prices or premiums. Be concise, practical, and honest about cautions. " +
    "Return ONLY valid JSON, no preamble, shaped exactly: " +
    '{ "client_name": string|null, "summary": string (one or two sentences), "top_carrier": string|null, ' +
    '"recommendations": [ { "carrier": string, "fit": "Strong"|"Possible"|"Avoid", "why": string, "cautions": string } ], ' +
    '"confirm": [ string ] }. Order recommendations best-first. Include any clearly-ineligible appointed carriers as "Avoid" with the reason.';

  const carrierBlock = carriers.map((c) => ({
    name: c.name,
    product_lines: c.product_lines,
    states: c.states,
    best_for: c.best_for,
    appetite: c.appetite,
    requirements: c.requirements,
    do_not_submit: c.do_not_submit,
    helpful_hints: c.helpful_hints,
  }));

  const messages = [];
  if (Array.isArray(data.history)) {
    for (const m of data.history) {
      if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({
    role: "user",
    content:
      `CLIENT / RISK:\n${scenario}\n\n` +
      `APPOINTED CARRIERS (JSON):\n${JSON.stringify(carrierBlock)}\n\n` +
      `Return the JSON object only.`,
  });

  let parsed;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages }),
    });
    const body = await res.json();
    if (!res.ok) return json(502, { error: `Claude API error: ${(body && body.error && body.error.message) || res.status}` });
    let out = ((body.content && body.content[0] && body.content[0].text) || "").trim();
    out = out.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(out);
  } catch (e) {
    return json(502, { error: "Couldn't read the assistant's response — try rephrasing." });
  }

  const recommendation = {
    client_name: parsed.client_name || data.client_name || null,
    summary: parsed.summary || "",
    top_carrier: parsed.top_carrier || (parsed.recommendations && parsed.recommendations[0] && parsed.recommendations[0].carrier) || null,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    confirm: Array.isArray(parsed.confirm) ? parsed.confirm : [],
  };

  // Save to history.
  let savedId = null;
  try {
    const saved = await sbWrite("POST", "carrier_recommendations", {
      client_name: recommendation.client_name,
      scenario,
      summary: recommendation.summary,
      top_carrier: recommendation.top_carrier,
      recommendations: recommendation.recommendations,
      transcript: { confirm: recommendation.confirm, history: data.history || [] },
    });
    savedId = Array.isArray(saved) ? (saved[0] && saved[0].id) : null;
  } catch (e) { /* non-fatal: still return the recommendation */ }

  return json(200, { recommendation, saved: !!savedId, id: savedId });
}
