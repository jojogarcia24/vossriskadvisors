// netlify/functions/blog-review.js
// Agency-only approval page for an AI-drafted blog post (reached via the token
// link in the review email).
//   GET  ?token=...             -> HTML preview + "Publish" / "Discard" buttons
//   POST ?token=... action=publish  -> set status=published, published_at=now
//   POST ?token=... action=discard  -> set status=discarded
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE

const html = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/html; charset=utf-8" },
  body,
});

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Minimal markdown -> HTML for the preview (## headings, ---, bullets, paragraphs)
const mdToHtml = (md) => {
  const lines = String(md || "").split(/\n/);
  let out = "", ul = false;
  const closeUl = () => { if (ul) { out += "</ul>"; ul = false; } };
  for (let raw of lines) {
    const ln = raw.trim();
    if (ln.startsWith("## ")) { closeUl(); out += `<h2 style="font-family:Georgia,serif;color:#0C2340;margin-top:26px">${esc(ln.slice(3))}</h2>`; }
    else if (ln.startsWith("- ")) { if (!ul) { out += "<ul>"; ul = true; } out += `<li>${esc(ln.slice(2))}</li>`; }
    else if (ln === "---") { closeUl(); out += "<hr style='border:none;border-top:1px solid #eee;margin:20px 0'>"; }
    else if (ln) { closeUl(); const t = esc(ln).replace(/^\*(.+)\*$/, "<em>$1</em>"); out += `<p style="line-height:1.7;color:#1C2433">${t}</p>`; }
  }
  closeUl();
  return out;
};

const page = (title, inner) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#F5F0E6;color:#1C2433;margin:0;padding:30px 16px}
.card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e7e2d6;padding:30px}
h1{font-family:Georgia,serif;color:#0C2340}
.btn{display:inline-block;border:none;cursor:pointer;padding:13px 26px;font-size:14px;text-decoration:none;color:#fff;background:#0C2340}
.btn.gold{background:#C09C48;color:#001830}.btn.ghost{background:#8A8578}
.tag{color:#C09C48;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.prev{border:1px solid #eee;padding:22px;margin-top:20px}</style></head><body><div class="card">${inner}</div></body></html>`;

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (!token) return html(400, page("Not found", "<h1>Invalid link</h1><p>This review link is missing its token.</p>"));

  const sbHeaders = { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };

  let post;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?token=eq.${encodeURIComponent(token)}&select=*`, { headers: sbHeaders });
    const rows = await r.json();
    post = rows && rows[0];
  } catch (e) { return html(500, page("Error", "<h1>Something went wrong</h1>")); }
  if (!post) return html(404, page("Not found", "<h1>Not found</h1><p>This draft no longer exists.</p>"));

  // ----- GET: preview + actions -----
  if (event.httpMethod !== "POST") {
    if (post.status !== "draft") {
      return html(200, page("Already handled", `<h1>Already ${esc(post.status)}</h1><p>"${esc(post.title)}" is already <strong>${esc(post.status)}</strong>.</p>`));
    }
    return html(200, page("Review post", `
      <h1>Review this week's blog post</h1>
      <form method="POST" style="margin:18px 0">
        <button class="btn gold" name="action" value="publish" type="submit">Publish to the site</button>
        <button class="btn ghost" name="action" value="discard" type="submit" style="margin-left:8px">Discard</button>
      </form>
      <div class="prev">
        <div class="tag">${esc(post.category || "Guide")} &middot; ${esc(post.read || "")}</div>
        <h1 style="margin:6px 0 4px">${esc(post.title)}</h1>
        <p style="color:#8A8578;font-style:italic">${esc(post.excerpt || "")}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        ${mdToHtml(post.body_md)}
      </div>`));
  }

  // ----- POST: perform -----
  if (post.status !== "draft") return html(200, page("Already handled", `<h1>Already ${esc(post.status)}</h1><p>No action taken.</p>`));

  const params = new URLSearchParams(event.body || "");
  const action = params.get("action");

  if (action === "discard") {
    await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH", headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "discarded" }),
    });
    return html(200, page("Discarded", "<h1>Discarded</h1><p>This draft won't be published.</p>"));
  }

  if (action !== "publish") return html(400, page("Error", "<h1>Unknown action</h1>"));

  const r = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH", headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "published", published_at: new Date().toISOString() }),
  });
  if (!r.ok) return html(500, page("Error", "<h1>Publish failed</h1><p>Please try again.</p>"));

  return html(200, page("Published", `<h1>Published ✓</h1><p>"${esc(post.title)}" is now live in your Resources section.</p><p><a href="https://www.vossriskadvisors.com">View the site</a></p>`));
};
