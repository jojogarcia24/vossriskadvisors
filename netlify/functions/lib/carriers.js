// netlify/functions/lib/carriers.js
// Shared helpers for the carrier-appointments admin API and the Google sync
// webhook. NOT a Netlify function itself (lives in a subfolder), just a module
// the functions require().

// The editable carrier fields, in the order they appear in CSV / Google Sheets.
// (id + slug are the stable keys; updated_at is read-only.)
const FIELDS = [
  "id",
  "name",
  "slug",
  "status",
  "product_lines",
  "states",
  "best_for",
  "website",
  "login_url",
  "login_username",
  "login_password",
  "portal_notes",
  "appetite",
  "requirements",
  "do_not_submit",
  "helpful_hints",
  "sort_order",
  "updated_at",
];

// Fields Claude's doc-review may propose changes to.
const REVIEWABLE_FIELDS = [
  "status",
  "product_lines",
  "states",
  "best_for",
  "website",
  "login_url",
  "login_username",
  "login_password",
  "portal_notes",
  "appetite",
  "requirements",
  "do_not_submit",
  "helpful_hints",
];

const ARRAY_FIELDS = ["product_lines", "states"];
const VALID_STATUS = ["approved", "pending", "not_started", "declined"];

const json = (statusCode, body, extraHeaders) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(extraHeaders || {}),
  },
  body: JSON.stringify(body),
});

const sbHeaders = () => {
  const { SUPABASE_SERVICE_ROLE } = process.env;
  return {
    apikey: SUPABASE_SERVICE_ROLE,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
};

const sbUrl = (path) => `${process.env.SUPABASE_URL}/rest/v1/${path}`;

// GET rows from a table via PostgREST.
async function sbSelect(path) {
  const r = await fetch(sbUrl(path), { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase select failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// Insert/update; returns the affected rows.
async function sbWrite(method, path, body) {
  const r = await fetch(sbUrl(path), {
    method,
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} failed: ${r.status} ${text}`);
  try { return JSON.parse(text); } catch { return []; }
}

// Constant-ish-time admin password check.
function checkAuth(password) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  const a = String(password || "");
  if (a.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const slugify = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

// ---- CSV ----
function csvCell(v) {
  if (v == null) return "";
  let s = Array.isArray(v) ? v.join("; ") : String(v);
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows) {
  const header = FIELDS.filter((f) => f !== "id" && f !== "updated_at");
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((f) => csvCell(row[f])).join(","));
  }
  return lines.join("\r\n");
}

// ---- Google Sheets push (Voss -> Google) ----
// Fire-and-forget POST to a Google Apps Script Web App. If the two env vars
// aren't set, sync is simply dormant and this is a no-op (CSV export still
// works). Never throws — a Google hiccup must not break an admin save.
async function pushToGoogle(rows) {
  const url = process.env.GOOGLE_SHEET_WEBAPP_URL;
  const secret = process.env.CARRIER_SYNC_SECRET;
  if (!url || !secret) return { synced: false, reason: "not_configured" };
  try {
    const payload = rows.map((r) => {
      const o = {};
      for (const f of FIELDS) o[f] = Array.isArray(r[f]) ? r[f].join("; ") : (r[f] == null ? "" : r[f]);
      return o;
    });
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, source: "voss", rows: payload }),
    });
    return { synced: r.ok, status: r.status };
  } catch (e) {
    return { synced: false, reason: String(e && e.message) };
  }
}

module.exports = {
  FIELDS,
  REVIEWABLE_FIELDS,
  ARRAY_FIELDS,
  VALID_STATUS,
  json,
  sbSelect,
  sbWrite,
  sbUrl,
  sbHeaders,
  checkAuth,
  slugify,
  toCsv,
  pushToGoogle,
};
