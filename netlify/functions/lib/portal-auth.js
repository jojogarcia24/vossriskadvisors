// netlify/functions/lib/portal-auth.js
// Supabase Auth + Storage helpers for the client portal (service role, server
// side only). Clients sign in with a one-time email link that we generate with
// the Auth admin API and send in our own branded email, so only existing
// clients ever get a link.
const E = require("./lead-email.js");

const SITE = () => (process.env.URL || "https://www.vossriskadvisors.com").replace(/\/$/, "");
const base = () => process.env.SUPABASE_URL;
const svc = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`, "Content-Type": "application/json" });
const BUCKET = "client-docs";

// Create the Auth user for a client email if it doesn't exist yet.
async function ensureAuthUser(email) {
  const r = await fetch(`${base()}/auth/v1/admin/users`, { method: "POST", headers: svc(), body: JSON.stringify({ email, email_confirm: true }) });
  if (r.ok) return true;
  const t = await r.text();
  if (r.status === 422 || /already/i.test(t)) return true; // already registered
  throw new Error("auth user: " + r.status + " " + t.slice(0, 200));
}

// One-time sign-in link that lands on /portal.
async function magicLink(email) {
  const r = await fetch(`${base()}/auth/v1/admin/generate_link`, {
    method: "POST", headers: svc(),
    body: JSON.stringify({ type: "magiclink", email, redirect_to: SITE() + "/portal" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("magic link: " + r.status + " " + JSON.stringify(j).slice(0, 200));
  return j.action_link || (j.properties && j.properties.action_link);
}

// The signed-in user for a portal access token, or null.
async function userFromToken(accessToken) {
  if (!accessToken) return null;
  const r = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  return r.json();
}

async function uploadObject(path, buffer, contentType) {
  const r = await fetch(`${base()}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`, "Content-Type": contentType || "application/octet-stream", "x-upsert": "false" },
    body: buffer,
  });
  if (!r.ok) throw new Error("upload: " + r.status + " " + (await r.text()).slice(0, 200));
}
async function deleteObject(path) {
  await fetch(`${base()}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: svc(), body: JSON.stringify({ prefixes: [path] }) }).catch(() => {});
}
// Short-lived download URL for a private document.
async function signedUrl(path, seconds = 900) {
  const r = await fetch(`${base()}/storage/v1/object/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", headers: svc(), body: JSON.stringify({ expiresIn: seconds }) });
  const j = await r.json().catch(() => ({}));
  const u = j.signedURL || j.signedUrl;
  return u ? `${base()}/storage/v1${u.startsWith("/") ? "" : "/"}${u}` : null;
}

// Branded "your portal is ready / sign-in link" email.
function portalEmail(client, link, invite) {
  const es = client.lang === "es";
  const first = E.esc(client.first_name);
  const subject = invite
    ? (es ? "Su portal de cliente de Voss está listo" : "Your Voss client portal is ready")
    : (es ? "Su enlace para entrar al portal de Voss" : "Your sign-in link for the Voss client portal");
  const html = E.layout({
    title: subject,
    preheader: es ? "Vea sus pólizas y documentos en cualquier momento." : "See your policies and documents anytime.",
    eyebrow: es ? "Portal de cliente" : "Client portal",
    eyebrowNote: es ? "el enlace vence en 1 hora" : "link expires in 1 hour",
    cards: E.textCard({
      heading: invite ? (es ? `${first}, su portal está listo` : `${first}, your portal is ready`) : (es ? `Hola ${first}, aquí está su enlace` : `Hi ${first}, here's your sign-in link`),
      paragraphs: es ? [
        "En su portal puede ver sus pólizas y fechas de renovación, descargar documentos y tarjetas de seguro, y pedir cambios.",
        "Toque el botón para entrar. No necesita contraseña. El enlace funciona una vez y vence en una hora; puede pedir otro en vossriskadvisors.com/portal.",
      ] : [
        "Your portal has your policies and renewal dates, your documents and ID cards, and a one-tap way to request changes.",
        "Tap the button to sign in. No password needed. The link works once and expires in an hour; you can always request a new one at vossriskadvisors.com/portal.",
      ],
      buttons: E.button(es ? "Entrar a mi portal" : "Sign in to my portal", link, true),
    }),
    footerNote: es ? "¿No pidió este enlace? Puede ignorar este correo." : "Didn't ask for this? You can ignore this email; nobody can sign in without this link.",
  });
  return { subject, html };
}

module.exports = { ensureAuthUser, magicLink, userFromToken, uploadObject, deleteObject, signedUrl, portalEmail, BUCKET };
