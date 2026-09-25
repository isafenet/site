// iSafeNet feedback board API: a Cloudflare Worker with a D1 database.
//
// Public:  GET  /api/ideas                 published ideas (the board, roadmap and shipped list)
//          POST /api/ideas                 suggest an idea (Turnstile; waits for review)
//          GET  /api/ideas/:id             one idea with its comments and status history
//          POST /api/ideas/:id/vote        {voter, on} vote or take a vote back
//          POST /api/ideas/:id/comments    comment (Turnstile; waits for review)
//          POST /api/votes/mine            {voter} which ideas this browser has voted for
//          GET  /feed.xml[?app=]           Atom feed of new ideas and status changes
// Admin:   GET  /admin                     the moderation page; /api/admin/* needs the admin key
//
// Privacy: no accounts, emails or IP addresses are stored. Votes are keyed by an HMAC of a random ID
// the browser makes; rate limits by an HMAC of IP + date that can't be reversed or linked across days.

import { personalDetails } from "../../assets/feedback-personal.js";
import ADMIN_HTML from "./admin.html";

const APPS = ["airreveal", "glpmgr", "udapt", "general"];
const APP_NAMES = { airreveal: "AirReveal", glpmgr: "GLPMGR", udapt: "Udapt", general: "iSafeNet" };
const STATUSES = ["open", "considering", "planned", "started", "shipped", "declined"];
const STATUS_NAMES = {
  open: "Open", considering: "Under consideration", planned: "Planned",
  started: "In progress", shipped: "Shipped", declined: "Not planned",
};
const LIMITS = { idea: 5, comment: 20, vote: 300, admin_fail: 10 }; // per IP, per day
const BOARD = "https://isafenet.app/feedback.html";

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const notFound = () => fail(404, "We couldn't find that idea.");

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, req, env);
      console.error(e);
      return json({ error: "Something went wrong on our side. Please try again." }, 500, req, env);
    }
  },
  // Daily cron: rate-limit rows are only useful for the day they were made.
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM rate WHERE day < ?").bind(today()).run();
  },
};

// ---------------------------------------------------------------- routing

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method;
  const ok = (data, status = 200) => json(data, status, req, env);
  let m;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      ...cors(req, env), "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400" } });
  }
  if (path === "/admin" && method === "GET") {
    return new Response(ADMIN_HTML, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
  }
  if (path === "/feed.xml" && method === "GET") return feed(url, env);
  if (path.startsWith("/api/admin/")) {
    await requireAdmin(req, env);
    return ok(await admin(req, env, path.slice("/api/admin".length), method, url));
  }

  if (path === "/api/ideas" && method === "GET") return ok(await listIdeas(env));
  if (path === "/api/ideas" && method === "POST") return ok(await createIdea(req, env), 201);
  if ((m = path.match(/^\/api\/ideas\/(\d+)$/)) && method === "GET") return ok(await getIdea(env, +m[1]));
  if ((m = path.match(/^\/api\/ideas\/(\d+)\/vote$/)) && method === "POST") return ok(await vote(req, env, +m[1]));
  if ((m = path.match(/^\/api\/ideas\/(\d+)\/comments$/)) && method === "POST") return ok(await createComment(req, env, +m[1]), 201);
  if (path === "/api/votes/mine" && method === "POST") return ok(await myVotes(req, env));
  if (path === "/" && method === "GET") {
    return new Response(`iSafeNet feedback API. The board is at ${BOARD}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  fail(404, "Not found.");
}

function cors(req, env) {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function json(data, status, req, env) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req, env) } });
}

// ---------------------------------------------------------------- input

async function readBody(req, max = 12000) {
  const text = await req.text();
  if (text.length > max) fail(413, "That's too long to send.");
  try {
    const value = JSON.parse(text || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* fall through */ }
  fail(400, "We couldn't read that request.");
}

/** Trims, strips control characters and checks length. Multiline keeps single blank lines. */
function clean(value, max, { min = 0, name = "This", multiline = false } = {}) {
  let s = typeof value === "string" ? value.normalize("NFC") : "";
  s = multiline
    ? s.replace(/\r\n?/g, "\n").replace(/[^\P{C}\n]/gu, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    : s.replace(/\p{C}/gu, " ").replace(/\s+/g, " ");
  s = s.trim();
  if (s.length < min) fail(400, `${name} is too short.`);
  if (s.length > max) fail(400, `${name} is too long (${max} characters at most).`);
  return s;
}

const pick = (value, allowed, message) => (allowed.includes(value) ? value : fail(400, message));

// ---------------------------------------------------------------- privacy-preserving hashes and checks

async function hmac(env, value) {
  if (!env.HASH_SECRET || env.HASH_SECRET.length < 32) throw new Error("HASH_SECRET is not set");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function limit(req, env, action) {
  const day = today();
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  const key = `${action}:${await hmac(env, `ip|${ip}|${day}`)}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate (key, day, count) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, day).first();
  if (row.count > LIMITS[action]) fail(429, "That's a lot for one day. Please try again tomorrow.");
}

async function voterId(env, raw) {
  if (typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    fail(400, "We couldn't read that request.");
  }
  return hmac(env, `voter|${raw.toLowerCase()}`);
}

async function human(req, env, token) {
  if (typeof token !== "string" || !token || token.length > 4096) fail(400, "Please complete the quick check that you're a person.");
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET || "");
  form.append("response", token);
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.success) fail(400, "The check that you're a person didn't go through. Please try again.");
}

// ---------------------------------------------------------------- public

async function listIdeas(env) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { results } = await env.DB.prepare(`
    SELECT i.id, i.app, i.title, substr(i.body, 1, 280) AS body, i.author, i.by_team, i.status, i.note,
           i.version, i.votes, i.pinned, i.published_at, i.updated_at,
           (SELECT COUNT(*) FROM comments c WHERE c.idea_id = i.id AND c.state = 'published') AS comments,
           (SELECT COUNT(*) FROM votes v WHERE v.idea_id = i.id AND v.created_at > ?) AS recent
      FROM ideas i
     WHERE i.state = 'published'
     ORDER BY i.pinned DESC, i.votes DESC, i.id DESC
     LIMIT 1000`).bind(since).all();
  return { ideas: results };
}

async function getIdea(env, id) {
  const idea = await env.DB.prepare(`
    SELECT id, app, title, body, why, author, by_team, status, note, version, votes, pinned, state,
           merged_into, published_at, updated_at
      FROM ideas WHERE id = ?`).bind(id).first();
  if (!idea) notFound();
  if (idea.state === "merged") return { merged_into: idea.merged_into };
  if (idea.state !== "published") notFound();
  const [comments, events] = await env.DB.batch([
    env.DB.prepare("SELECT id, body, author, by_team, created_at FROM comments WHERE idea_id = ? AND state = 'published' ORDER BY id").bind(id),
    env.DB.prepare("SELECT status, note, version, created_at FROM events WHERE idea_id = ? ORDER BY id").bind(id),
  ]);
  delete idea.state;
  delete idea.merged_into;
  return { idea, comments: comments.results, events: events.results };
}

async function createIdea(req, env) {
  const b = await readBody(req);
  const app = pick(b.app, APPS, "Please choose which app this is for.");
  const title = clean(b.title, 120, { min: 5, name: "The title" });
  const body = clean(b.body, 2000, { name: "The description", multiline: true });
  const why = clean(b.why, 1000, { name: "What it would help you do", multiline: true });
  const author = clean(b.author, 40, { name: "Your name" });
  await limit(req, env, "idea");
  await human(req, env, b.turnstile);
  const t = now();
  const row = await env.DB.prepare(
    "INSERT INTO ideas (app, title, body, why, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  ).bind(app, title, body, why, author, t, t).first();
  return { id: row.id, state: "pending" };
}

async function vote(req, env, id) {
  const b = await readBody(req, 500);
  const voter = await voterId(env, b.voter);
  const on = b.on !== false;
  const idea = await env.DB.prepare("SELECT state FROM ideas WHERE id = ?").bind(id).first();
  if (!idea || idea.state !== "published") notFound();
  await limit(req, env, "vote");
  const change = on
    ? env.DB.prepare("INSERT OR IGNORE INTO votes (idea_id, voter, created_at) VALUES (?, ?, ?)").bind(id, voter, now())
    : env.DB.prepare("DELETE FROM votes WHERE idea_id = ? AND voter = ?").bind(id, voter);
  const [, count] = await env.DB.batch([
    change,
    env.DB.prepare("UPDATE ideas SET votes = (SELECT COUNT(*) FROM votes WHERE idea_id = ?1) WHERE id = ?1 RETURNING votes").bind(id),
  ]);
  return { votes: count.results[0].votes, voted: on };
}

async function myVotes(req, env) {
  const b = await readBody(req, 500);
  const voter = await voterId(env, b.voter);
  const { results } = await env.DB.prepare("SELECT idea_id FROM votes WHERE voter = ?").bind(voter).all();
  return { ideas: results.map((r) => r.idea_id) };
}

async function createComment(req, env, id) {
  const b = await readBody(req);
  const body = clean(b.body, 1000, { min: 2, name: "Your comment", multiline: true });
  const author = clean(b.author, 40, { name: "Your name" });
  const idea = await env.DB.prepare("SELECT state FROM ideas WHERE id = ?").bind(id).first();
  if (!idea || idea.state !== "published") notFound();
  await limit(req, env, "comment");
  await human(req, env, b.turnstile);
  const row = await env.DB.prepare(
    "INSERT INTO comments (idea_id, body, author, created_at) VALUES (?, ?, ?, ?) RETURNING id",
  ).bind(id, body, author, now()).first();
  return { id: row.id, state: "pending" };
}

// ---------------------------------------------------------------- Atom feed

const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

async function feed(url, env) {
  const app = APPS.includes(url.searchParams.get("app")) ? url.searchParams.get("app") : null;
  const where = app ? "AND i.app = ?" : "";
  const bind = (stmt) => (app ? stmt.bind(app) : stmt);
  const [events, posted] = await env.DB.batch([
    bind(env.DB.prepare(`SELECT i.id, i.app, i.title, e.status, e.note, e.version, e.created_at AS at
      FROM events e JOIN ideas i ON i.id = e.idea_id WHERE i.state = 'published' ${where} ORDER BY e.id DESC LIMIT 50`)),
    bind(env.DB.prepare(`SELECT i.id, i.app, i.title, i.body AS note, NULL AS status, '' AS version, i.published_at AS at
      FROM ideas i WHERE i.state = 'published' ${where} ORDER BY i.published_at DESC LIMIT 50`)),
  ]);
  const items = [...events.results, ...posted.results].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
  const scope = app ? APP_NAMES[app] : "iSafeNet apps";
  const self = `${url.origin}/feed.xml${app ? `?app=${app}` : ""}`;
  const entries = items.map((i) => {
    const what = i.status
      ? `${STATUS_NAMES[i.status]}${i.version ? ` in ${i.version}` : ""}`
      : "New idea";
    return `<entry>
  <id>tag:isafenet.app,2026:idea-${i.id}-${xml(i.at)}</id>
  <title>${xml(`${what}: ${i.title}`)}</title>
  <link href="${BOARD}#idea-${i.id}"/>
  <updated>${xml(i.at)}</updated>
  <category term="${i.app}" label="${APP_NAMES[i.app]}"/>
  <content type="text">${xml(i.note || "")}</content>
</entry>`;
  }).join("\n");
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(`Feedback and ideas: ${scope}`)}</title>
<subtitle>New ideas and roadmap updates from the iSafeNet feedback board.</subtitle>
<id>${xml(self)}</id>
<link rel="self" href="${xml(self)}"/>
<link href="${BOARD}"/>
<updated>${xml(items[0]?.at || "2026-09-25T00:00:00.000Z")}</updated>
<author><name>iSafeNet</name></author>
${entries}
</feed>
`;
  return new Response(body, { headers: {
    "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*" } });
}

// ---------------------------------------------------------------- admin

async function requireAdmin(req, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) fail(503, "The admin key isn't set up yet.");
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_TOKEN)),
  ]);
  if (!crypto.subtle.timingSafeEqual(a, b)) {
    await limit(req, env, "admin_fail");
    fail(401, "That admin key isn't right.");
  }
}

async function admin(req, env, path, method, url) {
  let m;
  if (path === "/ideas" && method === "GET") return adminIdeas(env);
  if (path === "/ideas" && method === "POST") return teamIdea(req, env);
  if ((m = path.match(/^\/ideas\/(\d+)$/)) && method === "POST") return updateIdea(req, env, +m[1]);
  if ((m = path.match(/^\/ideas\/(\d+)\/merge$/)) && method === "POST") return mergeIdea(req, env, +m[1]);
  if ((m = path.match(/^\/ideas\/(\d+)\/delete$/)) && method === "POST") return deleteIdea(env, +m[1]);
  if ((m = path.match(/^\/ideas\/(\d+)\/comments$/)) && method === "POST") return teamComment(req, env, +m[1]);
  if (path === "/comments" && method === "GET") return adminComments(env, url.searchParams.get("state") || "pending");
  if ((m = path.match(/^\/comments\/(\d+)$/)) && method === "POST") return updateComment(req, env, +m[1]);
  if ((m = path.match(/^\/comments\/(\d+)\/delete$/)) && method === "POST") return deleteComment(env, +m[1]);
  fail(404, "Not found.");
}

async function adminIdeas(env) {
  const { results } = await env.DB.prepare(`
    SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.idea_id = i.id AND c.state = 'pending') AS pending_comments
      FROM ideas i ORDER BY (i.state = 'pending') DESC, i.id DESC LIMIT 2000`).all();
  for (const i of results) i.flags = personalDetails([i.title, i.body, i.why, i.author].join("\n"));
  return { ideas: results };
}

async function adminComments(env, state) {
  pick(state, ["pending", "published", "rejected"], "Unknown state.");
  const { results } = await env.DB.prepare(`
    SELECT c.*, i.title AS idea_title FROM comments c JOIN ideas i ON i.id = c.idea_id
     WHERE c.state = ? ORDER BY c.id DESC LIMIT 500`).bind(state).all();
  for (const c of results) c.flags = personalDetails(`${c.body}\n${c.author}`);
  return { comments: results };
}

function ideaFields(b, cur) {
  const keep = (key, fn) => (b[key] === undefined ? cur[key] : fn(b[key]));
  return {
    app: keep("app", (v) => pick(v, APPS, "Unknown app.")),
    title: keep("title", (v) => clean(v, 120, { min: 5, name: "The title" })),
    body: keep("body", (v) => clean(v, 2000, { name: "The description", multiline: true })),
    why: keep("why", (v) => clean(v, 1000, { name: "Why", multiline: true })),
    author: keep("author", (v) => clean(v, 40, { name: "Name" })),
    state: keep("state", (v) => pick(v, ["pending", "published", "rejected"], "Unknown state.")),
    status: keep("status", (v) => pick(v, STATUSES, "Unknown status.")),
    note: keep("note", (v) => clean(v, 1500, { name: "The note", multiline: true })),
    version: keep("version", (v) => clean(v, 24, { name: "The version" })),
    pinned: keep("pinned", (v) => (v ? 1 : 0)),
  };
}

async function teamIdea(req, env) {
  const b = await readBody(req);
  const f = ideaFields({ state: "published", ...b }, {
    app: undefined, title: undefined, body: "", why: "", author: "", state: "published",
    status: "open", note: "", version: "", pinned: 0,
  });
  if (!f.app) fail(400, "Please choose an app.");
  if (!f.title) fail(400, "The title is too short.");
  const t = now();
  const row = await env.DB.prepare(`
    INSERT INTO ideas (app, title, body, why, author, by_team, state, status, note, version, pinned, created_at, published_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(f.app, f.title, f.body, f.why, f.author, f.state, f.status, f.note, f.version, f.pinned, t,
      f.state === "published" ? t : null, t).first();
  if (f.status !== "open" || f.note) {
    await env.DB.prepare("INSERT INTO events (idea_id, status, note, version, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(row.id, f.status, f.note, f.version, t).run();
  }
  return { id: row.id };
}

async function updateIdea(req, env, id) {
  const b = await readBody(req);
  const cur = await env.DB.prepare("SELECT * FROM ideas WHERE id = ?").bind(id).first();
  if (!cur) notFound();
  if (cur.state === "merged") fail(409, "This idea was merged into another one.");
  const f = ideaFields(b, cur);
  const t = now();
  const roadmapChange = f.status !== cur.status || f.note !== cur.note || f.version !== cur.version;
  const firstPublish = f.state === "published" && !cur.published_at;
  const stmts = [env.DB.prepare(`
    UPDATE ideas SET app = ?, title = ?, body = ?, why = ?, author = ?, state = ?, status = ?, note = ?, version = ?,
           pinned = ?, published_at = COALESCE(published_at, ?), updated_at = ?
     WHERE id = ?`).bind(f.app, f.title, f.body, f.why, f.author, f.state, f.status, f.note, f.version, f.pinned,
    f.state === "published" ? t : null, roadmapChange || firstPublish ? t : cur.updated_at, id)];
  if (roadmapChange) {
    stmts.push(env.DB.prepare("INSERT INTO events (idea_id, status, note, version, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, f.status, f.note, f.version, t));
  }
  await env.DB.batch(stmts);
  return { ok: true };
}

async function mergeIdea(req, env, id) {
  const b = await readBody(req, 500);
  const into = Number(b.into);
  if (!Number.isInteger(into) || into === id) fail(400, "Choose a different idea to merge into.");
  const [src, dst] = await Promise.all([
    env.DB.prepare("SELECT state FROM ideas WHERE id = ?").bind(id).first(),
    env.DB.prepare("SELECT state FROM ideas WHERE id = ?").bind(into).first(),
  ]);
  if (!src || src.state === "merged") notFound();
  if (!dst || dst.state !== "published") fail(400, "You can only merge into a published idea.");
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO votes (idea_id, voter, created_at) SELECT ?, voter, created_at FROM votes WHERE idea_id = ?").bind(into, id),
    env.DB.prepare("DELETE FROM votes WHERE idea_id = ?").bind(id),
    env.DB.prepare("UPDATE comments SET idea_id = ? WHERE idea_id = ?").bind(into, id),
    env.DB.prepare("UPDATE ideas SET votes = (SELECT COUNT(*) FROM votes WHERE idea_id = ?1), updated_at = ?2 WHERE id = ?1").bind(into, t),
    env.DB.prepare("UPDATE ideas SET merged_into = ? WHERE merged_into = ?").bind(into, id),
    env.DB.prepare("UPDATE ideas SET state = 'merged', merged_into = ?, votes = 0, pinned = 0, updated_at = ? WHERE id = ?").bind(into, t, id),
  ]);
  return { ok: true };
}

// Permanent: for removal requests. Ideas merged into this one are hidden with it.
async function deleteIdea(env, id) {
  await env.DB.batch([
    env.DB.prepare("UPDATE ideas SET state = 'rejected', merged_into = NULL WHERE merged_into = ?").bind(id),
    env.DB.prepare("DELETE FROM votes WHERE idea_id = ?").bind(id),
    env.DB.prepare("DELETE FROM comments WHERE idea_id = ?").bind(id),
    env.DB.prepare("DELETE FROM events WHERE idea_id = ?").bind(id),
    env.DB.prepare("DELETE FROM ideas WHERE id = ?").bind(id),
  ]);
  return { ok: true };
}

async function teamComment(req, env, id) {
  const b = await readBody(req);
  const body = clean(b.body, 1500, { min: 2, name: "The comment", multiline: true });
  const author = clean(b.author, 40, { name: "Name" });
  const idea = await env.DB.prepare("SELECT id FROM ideas WHERE id = ?").bind(id).first();
  if (!idea) notFound();
  const row = await env.DB.prepare(
    "INSERT INTO comments (idea_id, body, author, by_team, state, created_at) VALUES (?, ?, ?, 1, 'published', ?) RETURNING id",
  ).bind(id, body, author, now()).first();
  return { id: row.id };
}

async function updateComment(req, env, id) {
  const b = await readBody(req);
  const cur = await env.DB.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
  if (!cur) fail(404, "We couldn't find that comment.");
  const body = b.body === undefined ? cur.body : clean(b.body, 1500, { min: 2, name: "The comment", multiline: true });
  const author = b.author === undefined ? cur.author : clean(b.author, 40, { name: "Name" });
  const state = b.state === undefined ? cur.state : pick(b.state, ["pending", "published", "rejected"], "Unknown state.");
  await env.DB.prepare("UPDATE comments SET body = ?, author = ?, state = ? WHERE id = ?").bind(body, author, state, id).run();
  return { ok: true };
}

async function deleteComment(env, id) {
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return { ok: true };
}
