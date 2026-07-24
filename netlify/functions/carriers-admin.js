// netlify/functions/carriers-admin.js
// Password-protected admin API for the carrier-appointment tracker.
//
// All requests are POST JSON: { action, password, ...payload }
// The password is checked against ADMIN_PASSWORD (server-side env var) on every
// call — the carrier logins/passwords never travel to the browser without it.
//
// Actions:
//   list                -> all carriers (incl. login info)
//   save {carrier}       -> insert/update one carrier, then push to Google
//   delete {id}          -> remove a carrier
//   set_status {id,status}
//   export_csv           -> { csv } (browser turns it into a download)
//   sync_all_to_google   -> push every carrier to the Google sheet
//   list_proposals       -> pending Claude doc-review proposals
//   review_doc {carrier_id?|carrier_name?, text} -> Claude reads a bulletin and
//                           stores a proposal of ONLY the changed fields
//   apply_proposal {id}  -> merge a proposal's changes into the carrier
//   discard_proposal {id}
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, ADMIN_PASSWORD,
//      ANTHROPIC_API_KEY, ANTHROPIC_MODEL (optional),
//      GOOGLE_SHEET_WEBAPP_URL + CARRIER_SYNC_SECRET (optional, for Google sync)

const { randomUUID } = require("crypto");
const {
  REVIEWABLE_FIELDS, ARRAY_FIELDS, VALID_STATUS,
  json, sbSelect, sbWrite, checkAuth, slugify, toCsv, pushToGoogle,
} = require("./lib/carriers");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const SAVE_FIELDS = [
  "name", "status", "product_lines", "states", "best_for", "website",
  "login_url", "login_username", "login_password", "portal_notes",
  "appetite", "requirements", "do_not_submit", "helpful_hints", "sort_order",
];

// Normalise an incoming array field: accept an array, or a "a; b; c" string.
function toArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null || v === "") return [];
  return String(v).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
}

async function getCarriers() {
  return sbSelect("carriers?select=*&order=sort_order.asc,name.asc");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return json(500, { error: "Server not configured (Supabase env missing)." });
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (!checkAuth(data.password)) return json(401, { error: "Wrong password." });

  const action = data.action;
  try {
    // -------- READ --------
    if (action === "list") {
      return json(200, { carriers: await getCarriers() });
    }

    if (action === "list_proposals") {
      const proposals = await sbSelect(
        "carrier_change_proposals?status=eq.proposed&select=*&order=created_at.desc"
      );
      return json(200, { proposals });
    }

    if (action === "export_csv") {
      const carriers = await getCarriers();
      return json(200, { csv: toCsv(carriers), count: carriers.length });
    }

    // -------- SAVE / UPSERT --------
    if (action === "save") {
      const c = data.carrier || {};
      const row = {};
      for (const f of SAVE_FIELDS) {
        if (!(f in c)) continue;
        if (ARRAY_FIELDS.includes(f)) row[f] = toArray(c[f]);
        else if (f === "sort_order") row[f] = Number(c[f]) || 100;
        else row[f] = c[f] === "" ? null : c[f];
      }
      if (row.status && !VALID_STATUS.includes(row.status)) {
        return json(400, { error: `Invalid status "${row.status}".` });
      }

      let saved;
      if (c.id) {
        saved = await sbWrite("PATCH", `carriers?id=eq.${encodeURIComponent(c.id)}`, row);
      } else {
        if (!row.name) return json(400, { error: "Carrier name is required." });
        row.slug = slugify(c.slug || row.name) || `carrier-${randomUUID().slice(0, 8)}`;
        saved = await sbWrite("POST", "carriers", row);
      }
      const carrier = Array.isArray(saved) ? saved[0] : saved;
      const google = await pushToGoogle([carrier]);
      return json(200, { carrier, google });
    }

    if (action === "set_status") {
      if (!VALID_STATUS.includes(data.status)) return json(400, { error: "Invalid status." });
      const saved = await sbWrite(
        "PATCH", `carriers?id=eq.${encodeURIComponent(data.id)}`, { status: data.status }
      );
      const carrier = Array.isArray(saved) ? saved[0] : saved;
      const google = await pushToGoogle([carrier]);
      return json(200, { carrier, google });
    }

    if (action === "delete") {
      await sbWrite("DELETE", `carriers?id=eq.${encodeURIComponent(data.id)}`);
      return json(200, { ok: true });
    }

    if (action === "sync_all_to_google") {
      const carriers = await getCarriers();
      const google = await pushToGoogle(carriers);
      return json(200, { google, count: carriers.length });
    }

    // -------- CLAUDE DOC REVIEW --------
    if (action === "review_doc") {
      return await reviewDoc(data);
    }

    if (action === "apply_proposal") {
      return await applyProposal(data);
    }

    if (action === "discard_proposal") {
      await sbWrite(
        "PATCH", `carrier_change_proposals?id=eq.${encodeURIComponent(data.id)}`,
        { status: "discarded" }
      );
      return json(200, { ok: true });
    }

    return json(400, { error: `Unknown action "${action}".` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};

// ---- Claude reads a carrier bulletin and proposes only the changed fields ----
async function reviewDoc(data) {
  const text = String(data.text || "").trim();
  if (!text) return json(400, { error: "Paste or upload the bulletin text first." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  // Find the carrier being updated (by id, or by name — creating a shell if new).
  let carrier = null;
  if (data.carrier_id) {
    const rows = await sbSelect(`carriers?id=eq.${encodeURIComponent(data.carrier_id)}&select=*`);
    carrier = rows && rows[0];
  }
  if (!carrier) return json(400, { error: "Pick which carrier this update is for." });

  const current = {};
  for (const f of REVIEWABLE_FIELDS) current[f] = carrier[f] || (ARRAY_FIELDS.includes(f) ? [] : "");

  const system =
    "You maintain a carrier-appetite database for an independent insurance agency. " +
    "You are given a carrier's CURRENT record and a NEW bulletin/update the agent pasted. " +
    "Your job: merge the new information into the record, changing ONLY what the bulletin " +
    "actually changes or adds. PRESERVE all existing detail that the bulletin does not touch — " +
    "never blank out or drop content just because it isn't repeated in the new text. " +
    "For the long text fields (appetite, requirements, do_not_submit, helpful_hints) return the " +
    "FULL updated text for that field (existing content + merged changes), formatted as short " +
    "dashed bullet lines, so it can replace the field directly. " +
    "For product_lines and states return the full updated array. " +
    "Only include a field in `changes` if it should actually change. If nothing should change, " +
    "return an empty changes object. " +
    "Allowed fields: " + REVIEWABLE_FIELDS.join(", ") + ". " +
    "status must be one of: " + VALID_STATUS.join(", ") + ". " +
    "Return ONLY valid JSON, no preamble, shaped exactly: " +
    '{ "summary": "<one or two plain-English sentences on what you changed>", ' +
    '"changes": { "<field>": <new value>, ... } }';

  const userMsg =
    `CARRIER: ${carrier.name}\n\n` +
    `CURRENT RECORD (JSON):\n${JSON.stringify(current, null, 2)}\n\n` +
    `NEW BULLETIN / UPDATE:\n${text}`;

  let parsed;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const body = await res.json();
    if (!res.ok) return json(502, { error: `Claude API error: ${body && body.error && body.error.message || res.status}` });
    let out = (body.content && body.content[0] && body.content[0].text || "").trim();
    // Strip code fences if the model added them.
    out = out.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(out);
  } catch (e) {
    return json(502, { error: "Couldn't parse Claude's response. Try again or shorten the text." });
  }

  // Keep only allowed fields and coerce array fields.
  const changes = {};
  for (const [k, v] of Object.entries(parsed.changes || {})) {
    if (!REVIEWABLE_FIELDS.includes(k)) continue;
    if (k === "status" && !VALID_STATUS.includes(v)) continue;
    changes[k] = ARRAY_FIELDS.includes(k) ? toArray(v) : v;
  }

  const proposalRow = {
    carrier_id: carrier.id,
    carrier_name: carrier.name,
    status: "proposed",
    summary: parsed.summary || "Proposed update.",
    changes,
    source_excerpt: text.slice(0, 8000),
  };
  const saved = await sbWrite("POST", "carrier_change_proposals", proposalRow);
  const proposal = Array.isArray(saved) ? saved[0] : saved;
  // Attach the current values so the UI can show a before/after diff.
  const before = {};
  for (const k of Object.keys(changes)) before[k] = carrier[k];
  return json(200, { proposal, before });
}

// ---- Apply a proposal: merge just its `changes` into the carrier row ----
async function applyProposal(data) {
  const rows = await sbSelect(`carrier_change_proposals?id=eq.${encodeURIComponent(data.id)}&select=*`);
  const proposal = rows && rows[0];
  if (!proposal) return json(404, { error: "Proposal not found." });
  if (proposal.status !== "proposed") return json(400, { error: `Already ${proposal.status}.` });

  // The client may pass an edited/approved subset of changes; default to all.
  const approved = data.changes && typeof data.changes === "object" ? data.changes : proposal.changes;
  const row = {};
  for (const [k, v] of Object.entries(approved || {})) {
    if (!REVIEWABLE_FIELDS.includes(k)) continue;
    if (k === "status" && !VALID_STATUS.includes(v)) continue;
    row[k] = ARRAY_FIELDS.includes(k) ? toArray(v) : v;
  }
  if (Object.keys(row).length === 0) return json(400, { error: "No changes to apply." });

  const savedCarrier = await sbWrite(
    "PATCH", `carriers?id=eq.${encodeURIComponent(proposal.carrier_id)}`, row
  );
  await sbWrite(
    "PATCH", `carrier_change_proposals?id=eq.${encodeURIComponent(proposal.id)}`,
    { status: "applied" }
  );
  const carrier = Array.isArray(savedCarrier) ? savedCarrier[0] : savedCarrier;
  const google = await pushToGoogle([carrier]);
  return json(200, { carrier, google });
}
