// netlify/functions/lib/drip.js
// The post-issue touch campaign. When a policy is marked issued in the admin
// Clients page, scheduleDrip() queues these touches in drip_messages:
//
//   step       when                          email  text
//   welcome    right away                     yes    yes   policy summary, portal, save our number
//   review     3 days after issue             yes    yes   Google review request (/review)
//   explainer  10 days                        yes    -     your policy, ID cards & documents, claims steps
//   checkup    30 days                        yes    -     coverage gaps worth a look (cross-sell, no prices)
//   referral   60 days                        yes    -     know someone who should shop their coverage?
//   renewal    45 days before renewal date    yes    yes   we'll re-shop your renewal
//
// The scheduled drip-runner sends what is due. Texts go out through Twilio
// when TWILIO_* is set and the client opted in to texts; otherwise they're
// handed to the agency in a daily "texts to send" email with tap-to-send links.
// review / checkup / referral go once per client even with several policies.
// Clients can unsubscribe from the marketing touches; welcome, explainer and
// renewal are service messages about a policy they hold.
const E = require("./lead-email.js");

const SITE = process.env.URL || "https://www.vossriskadvisors.com";
const PHONE = "(945) 407-8370", PHONE_E164 = "+19454078370";
const REVIEW = SITE.replace(/\/$/, "") + "/review";
const PORTAL = SITE.replace(/\/$/, "") + "/portal";
const DAY = 86400000;

const SB = () => ({
  url: process.env.SUPABASE_URL,
  headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}` },
});
async function sb(method, path, body, prefer) {
  const { url, headers } = SB();
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${r.status} ${t}`);
  try { return JSON.parse(t); } catch { return []; }
}

const MARKETING = new Set(["review", "checkup", "referral"]);
const ONCE_PER_CLIENT = new Set(["review", "checkup", "referral"]);
const SMS_STEPS = new Set(["welcome", "review", "renewal"]);

// Queue the campaign for one policy. Returns the rows inserted.
async function scheduleDrip(client, policy, now = new Date()) {
  const t0 = now.getTime();
  const rows = [];
  const add = (step, at, channels) => channels.forEach((ch) => rows.push({ client_id: client.id, policy_id: policy.id, step, channel: ch, due_at: new Date(at).toISOString() }));
  const sms = client.phone ? ["sms"] : [];
  add("welcome", t0, ["email", ...sms]);
  add("review", t0 + 3 * DAY, ["email", ...sms]);
  add("explainer", t0 + 10 * DAY, ["email"]);
  add("checkup", t0 + 30 * DAY, ["email"]);
  add("referral", t0 + 60 * DAY, ["email"]);
  if (policy.renewal_date) {
    const at = new Date(policy.renewal_date + "T15:00:00Z").getTime() - 45 * DAY;
    if (at > t0 + 20 * DAY) add("renewal", at, ["email", ...sms]);
  }
  return sb("POST", "drip_messages?on_conflict=policy_id,step,channel", rows, "return=representation,resolution=ignore-duplicates");
}

// ---------- copy (English / Spanish) ----------
const fmtDate = (d, lang) => d ? new Date(d + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const LINE_ES = { Homeowners: "casa", Auto: "auto", Renters: "inquilino", "Landlord / Rental": "propiedad de renta", Flood: "inundación", Umbrella: "paraguas", "Private client / high-value": "cliente privado", "Commercial / business": "negocio", Life: "vida", Disability: "incapacidad" };
const lineName = (p, lang) => lang === "es" ? (LINE_ES[p.line] || p.line) : p.line;

// Coverage-gap ideas for the 30-day checkup, based on what the client holds.
function gapIdeas(lines, lang) {
  const has = (l) => lines.includes(l);
  const es = lang === "es";
  const ideas = [];
  if ((has("Homeowners") || has("Landlord / Rental")) && !has("Flood")) ideas.push(es ? ["Inundación", "El seguro de casa no cubre inundaciones, y en Texas el riesgo no es solo en la costa."] : ["Flood", "Your home policy excludes flood, and in Texas flood risk isn't limited to the coast."]);
  if ((has("Homeowners") || has("Auto")) && !has("Umbrella")) ideas.push(es ? ["Póliza paraguas", "Un millón de dólares o más de responsabilidad adicional sobre su casa y auto."] : ["Umbrella", "An extra $1M+ of liability protection over your home and auto."]);
  if (has("Homeowners") && !has("Auto")) ideas.push(es ? ["Auto", "Cotizamos su auto junto con su casa para ver si combinar le ahorra."] : ["Auto", "We'll quote your auto with your home to see if bundling saves you money."]);
  if (has("Auto") && !has("Homeowners") && !has("Renters")) ideas.push(es ? ["Casa o inquilino", "Combinar casa o inquilino con su auto puede reducir el costo."] : ["Home or renters", "Pairing home or renters with your auto can lower the cost of both."]);
  if (!has("Life")) ideas.push(es ? ["Vida", "Protección a término para quienes dependen de su ingreso."] : ["Life", "Term coverage for the people who depend on your income."]);
  if (has("Commercial / business") && !has("Disability")) ideas.push(es ? ["Incapacidad", "Protege su ingreso si una enfermedad o lesión le impide trabajar."] : ["Disability income", "Protects your income if illness or injury keeps you from working."]);
  return ideas.slice(0, 3);
}

function email(step, ctx) {
  const { client, policy, lines } = ctx;
  const es = client.lang === "es";
  const first = E.esc(client.first_name);
  const unsub = `${SITE.replace(/\/$/, "")}/.netlify/functions/client-unsubscribe?t=${encodeURIComponent(client.unsub_token)}`;
  const footer = MARKETING.has(step)
    ? `${es ? "¿No quiere recibir estos correos?" : "Prefer not to get these emails?"} <a href="${unsub}" style="color:#C09C48">${es ? "Darse de baja" : "Unsubscribe"}</a>`
    : (es ? "Recibe este correo porque tiene una póliza con Voss Risk Advisors." : "You're receiving this because you have a policy with Voss Risk Advisors.");
  const summary = E.detailsCard(es ? "Su póliza" : "Your policy", [
    [es ? "Cobertura" : "Coverage", E.esc(lineName(policy, client.lang))],
    [es ? "Aseguradora" : "Carrier", E.esc(policy.carrier || "")],
    [es ? "Número de póliza" : "Policy number", E.esc(policy.policy_number || "")],
    [es ? "Vigente desde" : "Effective", E.esc(fmtDate(policy.effective_date, client.lang))],
    [es ? "Renovación" : "Renews", E.esc(fmtDate(policy.renewal_date, client.lang))],
  ]);
  const callBtn = E.button(es ? "Llamar " + PHONE : "Call " + PHONE, "tel:" + PHONE_E164, false);
  const portalBtn = E.button(es ? "Abrir mi portal" : "Open my client portal", PORTAL, true);
  let subject, preheader, cards;

  if (step === "welcome") {
    subject = es ? `Bienvenido a Voss, ${client.first_name}: su póliza de ${lineName(policy, "es")} está emitida` : `Welcome to Voss, ${client.first_name}: your ${policy.line.toLowerCase()} policy is issued`;
    preheader = es ? "Los detalles de su póliza, su portal y qué sigue." : "Your policy details, your client portal, and what happens next.";
    cards = E.textCard({
      eyebrow: es ? "Bienvenido" : "Welcome aboard",
      heading: es ? `¡Gracias, ${first}! Está protegido.` : `Thank you, ${first}. You're covered.`,
      paragraphs: es ? [
        `Su póliza de <strong>${E.esc(lineName(policy, "es"))}</strong>${policy.carrier ? " con <strong>" + E.esc(policy.carrier) + "</strong>" : ""} está emitida. Gracias por confiar en nosotros.`,
        "En su portal de cliente puede ver sus pólizas, descargar documentos y pedir cambios o tarjetas de seguro cuando quiera.",
        `Guarde nuestro número: <strong>${PHONE}</strong>. Para cualquier pregunta, cambio o reclamo, llámenos o envíenos un texto.`,
      ] : [
        `Your <strong>${E.esc(policy.line.toLowerCase())}</strong> policy${policy.carrier ? " with <strong>" + E.esc(policy.carrier) + "</strong>" : ""} is issued. Thank you for trusting us with it.`,
        "Your client portal has your policies and documents, and you can request ID cards or changes there anytime.",
        `Save our number: <strong>${PHONE}</strong>. Questions, changes, or a claim, call or text and you'll reach your advisor, not a call center.`,
      ],
      buttons: portalBtn + callBtn,
    }) + summary + E.textCard({
      eyebrow: es ? "Qué sigue" : "What happens next",
      paragraphs: es ? [
        "1. La aseguradora le enviará sus documentos oficiales; también los subiremos a su portal.",
        "2. Revisaremos su cobertura antes de cada renovación y la volveremos a cotizar si conviene.",
        "3. ¿Tiene un siniestro? Llame primero a la aseguradora y luego a nosotros; le ayudamos en cada paso.",
      ] : [
        "1. Your carrier will send your official documents, and we'll add them to your portal too.",
        "2. Before every renewal we'll review your coverage and re-shop it if that helps you.",
        "3. Have a claim? Call your carrier's claims line first, then call us. We'll help at every step.",
      ],
    });
  } else if (step === "review") {
    subject = es ? `${client.first_name}, ¿cómo lo hicimos?` : `${client.first_name}, how did we do?`;
    preheader = es ? "Una reseña rápida ayuda a otros a encontrar un agente en quien confiar." : "A 30-second review helps other Texans find an agent they can trust.";
    cards = E.textCard({
      eyebrow: es ? "Su opinión importa" : "Your opinion matters",
      heading: `<span style="color:#C09C48;letter-spacing:4px">&#9733;&#9733;&#9733;&#9733;&#9733;</span><br>${es ? "¿Cómo fue su experiencia?" : "How was your experience?"}`,
      paragraphs: es ? [
        `Somos una agencia nueva e independiente, y cada reseña nos ayuda muchísimo. Si quedó contento con su póliza de ${E.esc(lineName(policy, "es"))}, ¿nos dejaría una reseña rápida en Google?`,
        "Si algo no salió bien, responda a este correo y lo arreglamos.",
      ] : [
        `We're a new independent agency, so every review means a lot. If you're happy with how we handled your ${E.esc(policy.line.toLowerCase())} policy, would you leave a quick Google review? It takes about 30 seconds.`,
        "If anything wasn't right, just reply to this email and we'll make it right.",
      ],
      buttons: E.button(es ? "Dejar una reseña" : "Leave a Google review", REVIEW, true),
    });
  } else if (step === "explainer") {
    subject = es ? "Su póliza, explicada (y qué hacer si tiene un reclamo)" : "Your policy, explained (and what to do if you have a claim)";
    preheader = es ? "Dónde están sus documentos y cómo presentar un reclamo." : "Where your documents are and how claims work.";
    cards = E.textCard({
      eyebrow: es ? "Conozca su póliza" : "Know your policy",
      heading: es ? `${first}, tres cosas que vale la pena saber` : `${first}, three things worth knowing`,
      paragraphs: es ? [
        "<strong>Sus documentos.</strong> Su página de declaraciones muestra sus límites y deducibles. La encontrará en su portal; guárdela en un lugar seguro.",
        "<strong>Tarjetas de seguro y cambios.</strong> ¿Compró un auto, se muda o necesita un certificado? Pídalo en su portal o en vossriskadvisors.com/service.",
        `<strong>Si tiene un reclamo.</strong> Póngase a salvo, tome fotos, llame a la línea de reclamos de su aseguradora y luego a nosotros al ${PHONE}. Le ayudamos en todo el proceso.`,
      ] : [
        "<strong>Your documents.</strong> Your declarations page lists your limits and deductibles. It's in your portal; keep a copy somewhere safe.",
        "<strong>ID cards and changes.</strong> New car, moving, or need a certificate of insurance? Request it in your portal or at vossriskadvisors.com/service.",
        `<strong>If you have a claim.</strong> Get safe, take photos, call your carrier's claims line, then call us at ${PHONE}. We'll help you through it.`,
      ],
      buttons: portalBtn + E.button(es ? "Reclamos y pagos" : "Claims & payments", SITE.replace(/\/$/, "") + "/support", false),
    }) + summary;
  } else if (step === "checkup") {
    const ideas = gapIdeas(lines, client.lang);
    subject = es ? `${client.first_name}, una revisión rápida de su cobertura` : `${client.first_name}, a quick coverage checkup`;
    preheader = es ? "Algunas coberturas que podrían faltarle." : "A few gaps worth a look, no pressure.";
    cards = E.textCard({
      eyebrow: es ? "Revisión de 30 días" : "30-day checkup",
      heading: es ? "¿Le falta algo?" : "Anything missing?",
      paragraphs: [
        es ? "Ya lleva un mes con nosotros. Según lo que tiene asegurado, estas coberturas podrían valer la pena. Sin presión: si le interesa alguna, responda y la cotizamos."
           : "It's been a month. Based on what you have with us, these might be worth a look. No pressure: reply to this email if you'd like us to quote any of them.",
        ...ideas.map((i) => `<strong>${E.esc(i[0])}.</strong> ${E.esc(i[1])}`),
      ],
      buttons: E.button(es ? "Pedir una cotización" : "Get a quote", SITE.replace(/\/$/, "") + (es ? "/es" : "/contact"), true),
    });
  } else if (step === "referral") {
    subject = es ? `${client.first_name}, ¿conoce a alguien que deba revisar su seguro?` : `${client.first_name}, know someone who should shop their insurance?`;
    preheader = es ? "Atenderemos a sus amigos y familia como le atendemos a usted." : "We'll take care of your friends and family the way we take care of you.";
    cards = E.textCard({
      eyebrow: es ? "Recomiéndenos" : "Refer a friend",
      heading: es ? "La mayoría de nuestros clientes nos llegan por recomendación" : "Most of our clients come from referrals",
      paragraphs: es ? [
        "Si un amigo, familiar o compañero de trabajo compra casa, auto o abre un negocio, con gusto le cotizamos con varias aseguradoras, sin costo ni compromiso.",
        "Solo responda a este correo con su nombre y teléfono, o compártale nuestro sitio.",
      ] : [
        "If a friend, family member, or coworker is buying a home, a car, or starting a business, we'd be glad to shop their coverage across our carriers. No cost and no pressure.",
        "Just reply with their name and number, or share our website with them.",
      ],
      buttons: E.button(es ? "Compartir vossriskadvisors.com" : "Share vossriskadvisors.com", SITE.replace(/\/$/, "") + (es ? "/es" : "/"), true),
    });
  } else if (step === "renewal") {
    subject = es ? `Su póliza de ${lineName(policy, "es")} se renueva el ${fmtDate(policy.renewal_date, "es")}` : `Your ${policy.line.toLowerCase()} policy renews ${fmtDate(policy.renewal_date, "en")}`;
    preheader = es ? "Revisaremos su renovación y la volveremos a cotizar si conviene." : "We'll review your renewal and re-shop it if that helps you.";
    cards = E.textCard({
      eyebrow: es ? "Renovación" : "Renewal coming up",
      heading: es ? `${first}, se acerca su renovación` : `${first}, your renewal is coming up`,
      paragraphs: es ? [
        `Su póliza de <strong>${E.esc(lineName(policy, "es"))}</strong>${policy.carrier ? " con " + E.esc(policy.carrier) : ""} se renueva el <strong>${E.esc(fmtDate(policy.renewal_date, "es"))}</strong>.`,
        "Revisaremos su renovación y, si conviene, la cotizaremos con otras aseguradoras. ¿Cambió algo este año (auto nuevo, remodelación, conductor nuevo, mudanza)? Responda y díganos.",
      ] : [
        `Your <strong>${E.esc(policy.line.toLowerCase())}</strong> policy${policy.carrier ? " with " + E.esc(policy.carrier) : ""} renews on <strong>${E.esc(fmtDate(policy.renewal_date, "en"))}</strong>.`,
        "We'll review your renewal and, if it helps, re-shop it with our other carriers. Did anything change this year (new car, remodel, new driver, a move)? Reply and let us know.",
      ],
      buttons: callBtn + portalBtn,
    }) + summary;
  } else throw new Error("unknown step " + step);

  return { subject, html: E.layout({ title: subject, preheader, eyebrow: es ? "Voss Risk Advisors" : "Voss Risk Advisors", eyebrowNote: es ? "su asesor: " + (client.advisor_name || "JoJo Garcia") : "your advisor: " + (client.advisor_name || "JoJo Garcia"), cards, footerNote: footer }) };
}

function smsText(step, ctx) {
  const { client, policy } = ctx;
  const es = client.lang === "es";
  const adv = (client.advisor_name || "JoJo Garcia").split(" ")[0];
  if (step === "welcome") return es
    ? `Hola ${client.first_name}, soy ${adv} de Voss Risk Advisors. ¡Su póliza de ${lineName(policy, "es")} está emitida! Le enviamos un correo con los detalles y su portal. Guarde este número para lo que necesite. Responda STOP para no recibir textos.`
    : `Hi ${client.first_name}, it's ${adv} at Voss Risk Advisors. Your ${policy.line.toLowerCase()} policy is issued! Your welcome email has the details and your client portal. Save this number for anything you need. Reply STOP to opt out.`;
  if (step === "review") return es
    ? `Hola ${client.first_name}, gracias otra vez por elegir Voss. Si quedó contento, ¿nos dejaría una reseña rápida? Nos ayuda muchísimo: ${REVIEW}`
    : `Hi ${client.first_name}, thanks again for choosing Voss. If you're happy with how we did, would you leave a quick review? It really helps a new agency: ${REVIEW}`;
  if (step === "renewal") return es
    ? `Hola ${client.first_name}, su póliza de ${lineName(policy, "es")} se renueva el ${fmtDate(policy.renewal_date, "es")}. La revisaremos y la cotizaremos de nuevo si conviene. ¿Cambió algo este año? Responda aquí. - ${adv}, Voss`
    : `Hi ${client.first_name}, your ${policy.line.toLowerCase()} policy renews ${fmtDate(policy.renewal_date, "en")}. We'll review it and re-shop if it helps. Anything change this year? Just reply. - ${adv}, Voss`;
  return "";
}

// ---------- senders ----------
async function sendEmail(to, subject, html) {
  const { RESEND_API_KEY, FROM_EMAIL, AGENCY_EMAIL } = process.env;
  if (!RESEND_API_KEY || !FROM_EMAIL) throw new Error("email not configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `Voss Risk Advisors <${FROM_EMAIL}>`, to: [to], subject, html, ...(AGENCY_EMAIL ? { reply_to: AGENCY_EMAIL } : {}) }),
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
}
const twilioReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
const e164 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : ""; };
async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from } = process.env;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(sid + ":" + tok).toString("base64") },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!r.ok) throw new Error("twilio " + r.status + " " + (await r.text()).slice(0, 200));
}

// Send one queued message. Returns the new status: sent | agent | skipped | failed.
// `agentTexts` collects texts handed to the agency (no Twilio, or no opt-in).
async function deliver(msg, client, policy, lines, agentTexts) {
  const ctx = { client, policy, lines };
  if (client.drip_paused) return { status: "pending" };
  if (MARKETING.has(msg.step) && client.unsubscribed) return { status: "skipped", error: "unsubscribed" };
  if (policy && policy.status === "cancelled") return { status: "skipped", error: "policy cancelled" };
  if (msg.channel === "email") {
    const m = email(msg.step, ctx);
    await sendEmail(client.email, m.subject, m.html);
    return { status: "sent" };
  }
  const body = smsText(msg.step, ctx), to = e164(client.phone);
  if (!body || !to) return { status: "skipped", error: "no phone" };
  if (twilioReady() && client.sms_opt_in) { await sendSms(to, body); return { status: "sent" }; }
  agentTexts.push({ name: `${client.first_name} ${client.last_name}`.trim(), phone: client.phone, to, body, step: msg.step });
  return { status: "agent" };
}

// Email the agency the texts to send by hand today (tap-to-send links).
async function sendAgentDigest(agentTexts) {
  if (!agentTexts.length || !process.env.AGENCY_EMAIL) return;
  const rows = agentTexts.map((t) => E.textCard({
    eyebrow: t.step + " text",
    heading: E.esc(t.name) + ` <span style="font-size:15px;color:#6B665B">${E.esc(E.prettyPhone(t.phone))}</span>`,
    paragraphs: [`<span style="display:block;background:#FBFAF7;border-left:3px solid #C09C48;padding:10px 12px">${E.esc(t.body)}</span>`],
    buttons: E.button("Tap to text from your phone", `sms:${t.to}?&body=${encodeURIComponent(t.body)}`, true),
  })).join("");
  const html = E.layout({
    title: `Texts to send today (${agentTexts.length})`,
    preheader: `${agentTexts.length} client text${agentTexts.length > 1 ? "s" : ""} ready to send.`,
    eyebrow: "Client texts to send",
    eyebrowNote: "tap each button on your phone",
    cards: rows,
    footerNote: "Automatic texting turns on once TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are set in Netlify and the client opted in to texts.",
  });
  await sendEmail(process.env.AGENCY_EMAIL, `📱 ${agentTexts.length} client text${agentTexts.length > 1 ? "s" : ""} to send today`, html);
}

// Send everything due (optionally only for one client). Returns counts.
async function runDue({ clientId, now = new Date() } = {}) {
  let q = `drip_messages?status=eq.pending&due_at=lte.${encodeURIComponent(now.toISOString())}&select=*&order=due_at.asc&limit=200`;
  if (clientId) q += `&client_id=eq.${encodeURIComponent(clientId)}`;
  const due = await sb("GET", q);
  if (!due.length) return { sent: 0, agent: 0, skipped: 0, failed: 0 };
  const ids = [...new Set(due.map((m) => m.client_id))];
  const clients = await sb("GET", `clients?id=in.(${ids.join(",")})&select=*`);
  const policies = await sb("GET", `policies?client_id=in.(${ids.join(",")})&select=*`);
  const sentOnce = await sb("GET", `drip_messages?client_id=in.(${ids.join(",")})&status=in.(sent,agent)&select=client_id,step,channel`);
  const done = new Set(sentOnce.map((m) => `${m.client_id}|${m.step}|${m.channel}`));
  const counts = { sent: 0, agent: 0, skipped: 0, failed: 0 };
  const agentTexts = [];
  for (const msg of due) {
    const client = clients.find((c) => c.id === msg.client_id);
    const policy = policies.find((p) => p.id === msg.policy_id);
    if (!client || !policy) continue;
    let res;
    const key = `${msg.client_id}|${msg.step}|${msg.channel}`;
    if (ONCE_PER_CLIENT.has(msg.step) && done.has(key)) res = { status: "skipped", error: "already sent for another policy" };
    else {
      const lines = policies.filter((p) => p.client_id === client.id && p.status !== "cancelled").map((p) => p.line);
      try { res = await deliver(msg, client, policy, lines, agentTexts); }
      catch (e) { res = { status: "failed", error: String(e.message || e).slice(0, 300) }; }
    }
    if (res.status === "pending") continue;
    if (res.status === "sent" || res.status === "agent") done.add(key);
    counts[res.status] = (counts[res.status] || 0) + 1;
    await sb("PATCH", `drip_messages?id=eq.${msg.id}`, { status: res.status, error: res.error || null, sent_at: res.status === "sent" || res.status === "agent" ? new Date().toISOString() : null }, "return=minimal");
  }
  try { await sendAgentDigest(agentTexts); } catch (e) { console.error("drip digest", e.message); }
  return counts;
}


// ---------- renewal re-shop tasks ----------
// One task per policy renewal, created ~50 days out and due 30 days before the
// renewal date, so there's time to re-quote before the client's 45-day email
// lands. Returns the tasks created on this call.
async function ensureRenewalTasks(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 50 * DAY).toISOString().slice(0, 10);
  const pols = await sb("GET", `policies?status=eq.active&renewal_date=gte.${today}&renewal_date=lte.${horizon}&select=id,client_id,line,carrier,renewal_date,clients(first_name,last_name)`);
  if (!pols.length) return [];
  const rows = pols.map((p) => {
    const due = new Date(new Date(p.renewal_date + "T12:00:00Z").getTime() - 30 * DAY).toISOString().slice(0, 10);
    const who = p.clients ? `${p.clients.first_name} ${p.clients.last_name}`.trim() : "Client";
    return { type: "renewal_reshop", client_id: p.client_id, policy_id: p.id, renewal_date: p.renewal_date, due_date: due < today ? today : due, title: `Re-shop ${who}'s ${p.line.toLowerCase()} renewal${p.carrier ? " (" + p.carrier + ")" : ""}` };
  });
  return sb("POST", "tasks?on_conflict=policy_id,type,renewal_date", rows, "return=representation,resolution=ignore-duplicates");
}

// Email the agency the renewal re-shops that just came up.
async function sendTaskDigest(tasks) {
  if (!tasks.length || !process.env.AGENCY_EMAIL) return;
  const fmt = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const html = E.layout({
    title: `${tasks.length} renewal${tasks.length > 1 ? "s" : ""} to re-shop`,
    preheader: tasks.map((t) => t.title).join("; "),
    eyebrow: "Renewal re-shops", eyebrowNote: "added to your task list",
    cards: E.detailsCard("Coming up", tasks.map((t) => [`Renews ${fmt(t.renewal_date)}`, `${E.esc(t.title)}<br><span style="color:#6B665B;font-size:13px">Re-shop by ${fmt(t.due_date)}</span>`]))
      + E.textCard({ paragraphs: ["Quote each one with your other carriers, then mark the task done in your admin with the outcome (renewed, moved to a new carrier, or lost). The client's renewal email goes out 45 days before renewal."], buttons: E.button("Open my tasks", SITE.replace(/\/$/, "") + "/admin/clients#tasks", true) }),
  });
  await sendEmail(process.env.AGENCY_EMAIL, `📋 ${tasks.length} renewal${tasks.length > 1 ? "s" : ""} to re-shop`, html);
}

module.exports = { ensureRenewalTasks, sendTaskDigest, scheduleDrip, runDue, email, smsText, gapIdeas, sb, sendEmail, SMS_STEPS };
