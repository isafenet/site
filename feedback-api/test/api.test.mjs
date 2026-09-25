// End-to-end test against a running local Worker: `npm run db:local && npm run dev`, then `npm test`.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE = process.env.FEEDBACK_API || "http://127.0.0.1:8787";
const ADMIN = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_TOKEN=(.+)$/m)[1];
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // Turnstile test token, accepted by the test secret
const ORIGIN = "http://localhost:8000";

async function call(path, body, { admin = false, origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json", Origin: origin };
  if (admin) headers.Authorization = `Bearer ${admin === true ? ADMIN : admin}`;
  const res = await fetch(BASE + path, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

let up = false;
before(async () => { up = await fetch(BASE).then(() => true, () => false); });
const live = (name, fn) => test(name, async (t) => { if (!up) return t.skip(`no Worker at ${BASE}`); await fn(); });

let ideaId;
const unique = `Offline map packs ${Date.now()}`;

live("a new idea waits for review and isn't public", async () => {
  const r = await call("/api/ideas", { app: "airreveal", title: unique, body: "Download regions ahead of a flight.",
    why: "Plan long-haul trips", author: "Sam", turnstile: TOKEN });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.state, "pending");
  ideaId = r.data.id;
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  const list = await call("/api/ideas");
  assert.ok(!list.data.ideas.some((i) => i.id === ideaId));
  assert.equal((await call(`/api/ideas/${ideaId}`)).status, 404);
});

live("input is validated", async () => {
  assert.equal((await call("/api/ideas", { app: "nope", title: "Something useful", turnstile: TOKEN })).status, 400);
  assert.equal((await call("/api/ideas", { app: "udapt", title: "Hi", turnstile: TOKEN })).status, 400);
  assert.equal((await call("/api/ideas", { app: "udapt", title: "Long enough title" })).status, 400);
  assert.equal((await call("/api/ideas", { app: "udapt", title: "x".repeat(121), turnstile: TOKEN })).status, 400);
});

live("unknown origins get no CORS header", async () => {
  const r = await call("/api/ideas", null, { origin: "https://evil.example" });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});

live("admin API needs the right key", async () => {
  assert.equal((await call("/api/admin/ideas")).status, 401);
  assert.equal((await call("/api/admin/ideas", null, { admin: "wrong" })).status, 401);
  const r = await call("/api/admin/ideas", null, { admin: true });
  assert.equal(r.status, 200);
  assert.ok(r.data.ideas.some((i) => i.id === ideaId && i.state === "pending"));
});

live("publishing makes it public; status changes build a timeline", async () => {
  assert.equal((await call(`/api/admin/ideas/${ideaId}`, { state: "published" }, { admin: true })).status, 200);
  let r = await call(`/api/ideas/${ideaId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.idea.title, unique);
  assert.deepEqual(r.data.events, []);
  await call(`/api/admin/ideas/${ideaId}`, { status: "planned", note: "Coming after 2.0." }, { admin: true });
  r = await call(`/api/ideas/${ideaId}`);
  assert.equal(r.data.idea.status, "planned");
  assert.equal(r.data.events.length, 1);
  assert.equal(r.data.events[0].note, "Coming after 2.0.");
});

live("votes count once per browser and can be taken back", async () => {
  const a = randomUUID(), b = randomUUID();
  assert.equal((await call(`/api/ideas/${ideaId}/vote`, { voter: a })).data.votes, 1);
  assert.equal((await call(`/api/ideas/${ideaId}/vote`, { voter: a })).data.votes, 1);
  assert.equal((await call(`/api/ideas/${ideaId}/vote`, { voter: b })).data.votes, 2);
  assert.deepEqual((await call("/api/votes/mine", { voter: a })).data.ideas, [ideaId]);
  assert.equal((await call(`/api/ideas/${ideaId}/vote`, { voter: a, on: false })).data.votes, 1);
  assert.equal((await call(`/api/ideas/${ideaId}/vote`, { voter: "not-a-uuid" })).status, 400);
});

live("comments are moderated", async () => {
  const c = await call(`/api/ideas/${ideaId}/comments`, { body: "Yes please, for Asia routes", turnstile: TOKEN });
  assert.equal(c.status, 201);
  assert.equal((await call(`/api/ideas/${ideaId}`)).data.comments.length, 0);
  const q = await call("/api/admin/comments", null, { admin: true });
  assert.ok(q.data.comments.some((x) => x.id === c.data.id));
  await call(`/api/admin/comments/${c.data.id}`, { state: "published" }, { admin: true });
  assert.equal((await call(`/api/ideas/${ideaId}`)).data.comments.length, 1);
});

live("personal details are flagged for review", async () => {
  const r = await call("/api/ideas", { app: "glpmgr", title: "Reminders for my 7.5mg dose", turnstile: TOKEN });
  const all = await call("/api/admin/ideas", null, { admin: true });
  assert.ok(all.data.ideas.find((i) => i.id === r.data.id).flags.includes("dose"));
  await call(`/api/admin/ideas/${r.data.id}/delete`, {}, { admin: true });
});

live("merging moves votes and comments to the other idea", async () => {
  const dupe = (await call("/api/admin/ideas", { app: "airreveal", title: `Duplicate ${unique}` }, { admin: true })).data.id;
  const v = randomUUID();
  await call(`/api/ideas/${dupe}/vote`, { voter: v });
  await call(`/api/admin/ideas/${dupe}/merge`, { into: ideaId }, { admin: true });
  assert.deepEqual((await call(`/api/ideas/${dupe}`)).data, { merged_into: ideaId });
  assert.equal((await call(`/api/ideas/${ideaId}`)).data.idea.votes, 2);
});

live("the Atom feed lists status changes", async () => {
  const r = await call("/feed.xml?app=airreveal");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /atom/);
  assert.match(r.data, new RegExp(`Planned: ${unique}`));
});

live("deleting removes everything", async () => {
  await call(`/api/admin/ideas/${ideaId}/delete`, {}, { admin: true });
  assert.equal((await call(`/api/ideas/${ideaId}`)).status, 404);
});
