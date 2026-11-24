#!/usr/bin/env node
/* scripts/build-pages.js
   The site is one HTML file (public/index.html) with a <section class="page">
   per page. Search engines rank URLs, not sections, so at deploy time (Netlify
   build command) this writes a real, crawlable file for every page:

     /renters                     -> public/renters.html
     /resources/<article-slug>    -> public/resources/<slug>.html

   (Flat .html files: Netlify serves /renters from renters.html with no
   trailing-slash redirect, so the canonical URL is the one that loads.)

   Each copy has that page visible on load and its own <title>, description,
   canonical URL, social tags and breadcrumb data (taken from the section's
   data-title / data-desc attributes). It also writes public/404.html and
   regenerates public/sitemap.xml. Generated files are git-ignored; edit
   public/index.html only.

   Run locally: node scripts/build-pages.js */
const fs = require("fs");
const path = require("path");

const SITE = "https://www.vossriskadvisors.com";
const PUB = path.join(__dirname, "..", "public");
const src = fs.readFileSync(path.join(PUB, "index.html"), "utf8");

const pathFor = (id) => (id === "home" ? "/" : id.startsWith("article-") ? "/resources/" + id.slice(8) : "/" + id);
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const unattr = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");

const COVERAGE = new Set(["homeowners", "auto", "renters", "landlord", "flood", "umbrella", "private-client", "commercial", "life", "disability", "health"]);
const NOINDEX = new Set(["thanks"]);
const SKIP = new Set(["article-dynamic"]);

// Every page section with its metadata.
const pages = [];
const re = /<section class="page( on)?" data-page="([\w-]+)"(?: data-title="([^"]*)" data-desc="([^"]*)")?/g;
let m;
while ((m = re.exec(src))) pages.push({ id: m[2], title: m[3] ? unattr(m[3]) : null, desc: m[4] ? unattr(m[4]) : null });
if (!pages.find((p) => p.id === "home")) throw new Error("home page section not found");

function setTag(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error("build-pages: could not find " + label);
  return html.replace(pattern, replacement);
}

function render(page, opts = {}) {
  const url = SITE + pathFor(page.id);
  let h = src;
  // Show this page instead of home on first paint.
  h = h.replace('<section class="page on" data-page="home"', '<section class="page" data-page="home"');
  h = h.replace(`<section class="page" data-page="${page.id}"`, `<section class="page on" data-page="${page.id}"`);
  const title = opts.title || page.title, desc = opts.desc || page.desc;
  h = setTag(h, /<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`, "title");
  h = setTag(h, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(desc)}">`, "description");
  h = setTag(h, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, "canonical");
  h = setTag(h, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, "og:url");
  h = setTag(h, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(title)}">`, "og:title");
  h = setTag(h, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(desc)}">`, "og:description");
  h = setTag(h, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(title)}">`, "twitter:title");
  h = setTag(h, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(desc)}">`, "twitter:description");
  // Spanish page: language and locale for search engines.
  if (page.id === "es") {
    h = h.replace('<html lang="en">', '<html lang="es">');
    h = h.replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="es_US">');
  }
  if (opts.noindex || NOINDEX.has(page.id)) h = h.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,follow">');

  // Breadcrumbs for search results.
  const crumbs = [{ name: "Home", url: SITE + "/" }];
  if (COVERAGE.has(page.id)) crumbs.push({ name: "Coverage", url: SITE + "/coverage" });
  if (page.id.startsWith("article-")) crumbs.push({ name: "Resources", url: SITE + "/resources" });
  if (page.id !== "home" && !opts.noindex) crumbs.push({ name: title.replace(/ \| Voss Risk Advisors$/, ""), url });
  if (crumbs.length > 1) {
    const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) };
    h = h.replace("</head>", `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n</head>`);
  }
  return h;
}

let written = 0;
for (const page of pages) {
  if (page.id === "home" || SKIP.has(page.id)) continue;
  if (!page.title || !page.desc) throw new Error("build-pages: page '" + page.id + "' needs data-title and data-desc");
  const out = path.join(PUB, pathFor(page.id).slice(1) + ".html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(page));
  written++;
}

// 404: the home page, not indexed.
const home = pages.find((p) => p.id === "home");
fs.writeFileSync(path.join(PUB, "404.html"), render(home, { noindex: true, title: "Page not found | Voss Risk Advisors", desc: home.desc }));

// Sitemap.
const today = new Date().toISOString().slice(0, 10);
const prio = (id) => (id === "home" ? "1.0" : id === "coverage" || id === "contact" ? "0.9" : COVERAGE.has(id) ? "0.8" : id.startsWith("article-") ? "0.6" : "0.5");
const urls = pages.filter((p) => !SKIP.has(p.id) && !NOINDEX.has(p.id))
  .map((p) => `  <url><loc>${SITE}${pathFor(p.id)}</loc><lastmod>${today}</lastmod><priority>${prio(p.id)}</priority></url>`);
fs.writeFileSync(path.join(PUB, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

console.log(`build-pages: wrote ${written} pages, 404.html and sitemap.xml (${urls.length} URLs)`);
