// netlify/functions/lib/report.js
// Monthly business report for the agency: leads by source and coverage, the
// month vs. the month before, policies issued, campaign touches sent, upcoming
// renewals, and content published. Built from data the site already stores.
const E = require("./lead-email.js");
const { sb } = require("./drip.js");

const iso = (d) => d.toISOString();
const monthName = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" });

function sourceOf(q) {
  const s = (q.source || "website").toLowerCase();
  if (s === "chat") return "Website chat";
  if (s === "service") return "Service requests";
  if (s === "waitlist") return "Waitlist signups";
  if (s === "referral") return "Realtor referrals";
  if (/Idioma preferido: Español/.test(q.message || "")) return "Spanish quote form";
  return "Quote form";
}
const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
const sortDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

function bars(entries, total) {
  if (!entries.length) return `<p style="font-family:Arial,sans-serif;font-size:14px;color:#6B665B;margin:0">Nothing this month.</p>`;
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${entries.map(([k, v]) => `
    <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#1C2433;padding:6px 10px 6px 0;width:42%">${E.esc(k)}</td>
    <td style="padding:6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="${Math.max(4, Math.round((v / max) * 100))}%" style="background:#0C2340;height:12px;border-radius:2px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table></td>
    <td style="font-family:Arial,sans-serif;font-size:13px;color:#1C2433;padding:6px 0 6px 10px;width:56px;text-align:right"><b>${v}</b>${total ? `<span style="color:#6B665B"> ${Math.round((v / total) * 100)}%</span>` : ""}</td></tr>`).join("")}</table>`;
}
function tiles(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>${items.map(([label, value, note]) => `
    <td width="${Math.floor(100 / items.length)}%" style="padding:0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E7E1D6;border-radius:8px"><tr><td style="padding:16px 12px;text-align:center">
      <div style="font-family:Georgia,serif;font-size:30px;color:#0C2340;line-height:1">${value}</div>
      <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6B665B;margin-top:6px">${E.esc(label)}</div>
      <div style="font-family:Arial,sans-serif;font-size:11px;color:${/^\+/.test(note || "") ? "#3E7B27" : /^-/.test(note || "") ? "#A3412E" : "#6B665B"};margin-top:4px;min-height:14px">${note ? E.esc(note) : "&nbsp;"}</div>
    </td></tr></table></td>`).join("")}</tr></table>`;
}
const delta = (a, b) => (b ? (a >= b ? "+" : "") + Math.round(((a - b) / b) * 100) + "% vs last month" : a ? "new this month" : "");

// start: first day of the month to report (local CT). Defaults to last month.
async function buildReport(start) {
  const now = new Date();
  if (!start) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 6));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 6));
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, 6));
  const range = (col, a, b) => `${col}=gte.${encodeURIComponent(iso(a))}&${col}=lt.${encodeURIComponent(iso(b))}`;
  const in60 = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const safe = (p) => p.catch(() => []);

  const [leads, prevLeads, clients, policies, drips, renewals, posts, subs, openTasks] = await Promise.all([
    safe(sb("GET", `quote_requests?${range("created_at", start, end)}&select=created_at,source,coverage_type,status,message`)),
    safe(sb("GET", `quote_requests?${range("created_at", prevStart, start)}&select=source`)),
    safe(sb("GET", `clients?${range("created_at", start, end)}&select=id`)),
    safe(sb("GET", `policies?${range("created_at", start, end)}&select=line,carrier,annual_premium`)),
    safe(sb("GET", `drip_messages?${range("sent_at", start, end)}&status=in.(sent,agent)&select=step,channel,status`)),
    safe(sb("GET", `policies?status=eq.active&renewal_date=gte.${now.toISOString().slice(0, 10)}&renewal_date=lte.${in60}&select=line,carrier,renewal_date,clients(first_name,last_name,phone)&order=renewal_date.asc`)),
    safe(sb("GET", `blog_posts?status=eq.published&${range("published_at", start, end)}&select=title`)),
    safe(sb("GET", `newsletter_subscribers?${range("created_at", start, end)}&select=id`)),
    safe(sb("GET", "tasks?status=eq.open&select=id")),
  ]);

  const sales = leads.filter((q) => !["service", "waitlist"].includes((q.source || "").toLowerCase()));
  const prevSales = prevLeads.filter((q) => !["service", "waitlist"].includes((q.source || "").toLowerCase()));
  const bySource = sortDesc(countBy(leads, sourceOf));
  const byCoverage = sortDesc(countBy(sales, (q) => q.coverage_type || "Not specified")).slice(0, 8);
  const byLine = sortDesc(countBy(policies, (p) => p.line));
  const premium = policies.reduce((s, p) => s + (Number(p.annual_premium) || 0), 0);
  const service = leads.length - sales.length;
  const reviewsAsked = drips.filter((d) => d.step === "review").length;
  const emails = drips.filter((d) => d.channel === "email").length, texts = drips.filter((d) => d.channel === "sms").length;
  const label = monthName(start);

  const card = (eyebrow, inner) => E.card(`<div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#C09C48;margin-bottom:12px">${E.esc(eyebrow)}</div>${inner}`);
  const renewalRows = renewals.slice(0, 15).map((r) => [
    new Date(r.renewal_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    `${E.esc(r.clients ? `${r.clients.first_name} ${r.clients.last_name}` : "")} &middot; ${E.esc(r.line)}${r.carrier ? " &middot; " + E.esc(r.carrier) : ""}`,
  ]);

  const cards =
    `<div style="padding:0 0 4px">` + tiles([
      ["New leads", sales.length, delta(sales.length, prevSales.length)],
      ["Policies issued", policies.length, ""],
      ["New clients", clients.length, ""],
      ["Reviews asked", reviewsAsked, ""],
    ]) + `</div>` +
    card("Where leads came from", bars(bySource, leads.length)) +
    card("What people asked about", bars(byCoverage, sales.length)) +
    card("Policies issued by line", bars(byLine, policies.length) + (premium ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#1C2433;margin:12px 0 0">Annual premium entered: <b>$${Math.round(premium).toLocaleString("en-US")}</b></p>` : "")) +
    E.detailsCard("Client follow-up", [
      ["Campaign emails", String(emails)],
      ["Campaign texts", String(texts)],
      ["Service requests", String(service)],
      ["Open renewal re-shops", String(openTasks.length)],
      ["Newsletter signups", String(subs.length)],
      ["Blog posts published", String(posts.length)],
    ]) +
    (renewalRows.length ? E.detailsCard(`Renewals in the next 60 days (${renewals.length})`, renewalRows) : "") +
    E.textCard({
      eyebrow: "Website traffic",
      paragraphs: ["Visitor counts, top pages, and where traffic comes from are in Google Analytics: Reports → Engagement → Pages and screens, and Acquisition → Traffic acquisition. Mark <b>generate_lead</b>, <b>service_request</b> and <b>review_click</b> as key events to see which pages bring leads."],
      buttons: E.button("Open Google Analytics", "https://analytics.google.com/", false),
    });

  return {
    subject: `Voss monthly report: ${label} — ${sales.length} lead${sales.length === 1 ? "" : "s"}, ${policies.length} polic${policies.length === 1 ? "y" : "ies"} issued`,
    html: E.layout({ title: `Monthly report: ${label}`, preheader: `${sales.length} leads, ${policies.length} policies issued, ${renewals.length} renewals coming up.`, eyebrow: "Monthly report", eyebrowNote: label, cards, footerNote: "Sent automatically on the 1st of each month. Numbers come from your website's Supabase database." }),
    stats: { leads: sales.length, prevLeads: prevSales.length, policies: policies.length, clients: clients.length, reviewsAsked, renewals: renewals.length },
  };
}

module.exports = { buildReport };
