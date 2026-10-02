// Landing notifications for AirReveal: a push when a plane someone follows on the sky map lands, even
// with the app closed.
//
//          PUT    /v1/follow    the app: following this plane now (one per phone; a new one replaces it)
//          DELETE /v1/follow    the app: stopped following
//
// Every minute (the cron), if anyone is following: one request to ADSB.lol for every followed plane at
// once. A plane on the ground, or slow and low, has landed; so has one that stopped being heard while it
// was low and coming down (most stop broadcasting soon after landing). Then a push and the row goes.
// A plane that's simply out of reach (over an ocean) is waited for, up to 24 hours from the follow.
//
// Privacy: a row holds the push token, the aircraft's address, its callsign or registration, where it's
// going if known, and its last height and climb rate. It's deleted at the landing, when following stops,
// or after 24 hours.

import { apnsKey, apnsToken } from "./alerts.js";

const ADSB = "https://api.adsb.lol/v2";
const LIFETIME_SECONDS = 24 * 3600;
// Lost while below this height and descending: it landed (transponders often go quiet after landing).
const LOW_FEET = 4000;
const LOST_AFTER_SECONDS = 8 * 60;
// Pushes per run: the free plan allows 50 outgoing requests, and the emergency alerts use up to ~46.
const MAX_PUSHES = 10;

const validToken = (t) => typeof t === "string" && /^[0-9a-f]{64,200}$/.test(t);
const validHex = (h) => typeof h === "string" && /^[0-9a-f]{6}$/i.test(h);
const clean = (s, max) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "");

/** Answers /v1/follow, or returns null for any other path. */
export async function handleFollow(req, env, path, fail) {
  if (path !== "/v1/follow") return null;
  if (req.method === "PUT") {
    const f = parseFollow(await req.json().catch(() => null));
    if (!f) fail(422, "invalid", "Send { token, environment, hex, label, destination? }.");
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO follows (token, environment, hex, label, destination, last_alt, last_rate, last_seen_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, " +
      "hex = excluded.hex, label = excluded.label, destination = excluded.destination, last_alt = NULL, last_rate = NULL, " +
      "last_seen_at = excluded.last_seen_at, created_at = excluded.created_at",
    ).bind(f.token, f.environment, f.hex, f.label, f.destination, now, now).run();
    return { following: true };
  }
  if (req.method === "DELETE") {
    const token = (await req.json().catch(() => null))?.token;
    if (!validToken(token)) fail(422, "invalid", "Send { token }.");
    await env.DB.prepare("DELETE FROM follows WHERE token = ?").bind(token).run();
    return { following: false };
  }
  fail(405, "method", "Use PUT or DELETE.");
}

export function parseFollow(b) {
  if (!b || !validToken(b.token) || !["sandbox", "production"].includes(b.environment) || !validHex(b.hex)) return null;
  const label = clean(b.label, 16);
  if (!label) return null;
  return { token: b.token, environment: b.environment, hex: b.hex.toLowerCase(), label, destination: clean(b.destination, 60) || null };
}

/**
 * What happened to a followed plane since the last check: "landed", "flying" (with what to remember),
 * "waiting" (not heard, but not low and descending either), or "expired".
 */
export function judge(follow, aircraft, now) {
  if (now - follow.created_at > LIFETIME_SECONDS) return { kind: "expired" };
  if (aircraft) {
    const alt = aircraft.alt_baro;
    if (alt === "ground") return { kind: "landed" };
    const feet = Number.isFinite(alt) ? Math.round(alt) : null;
    const knots = Number.isFinite(aircraft.gs) ? aircraft.gs : null;
    if (feet !== null && feet < 500 && knots !== null && knots < 80) return { kind: "landed" };
    const rate = Number.isFinite(aircraft.baro_rate) ? Math.round(aircraft.baro_rate) : null;
    return { kind: "flying", alt: feet, rate };
  }
  const quiet = now - (follow.last_seen_at ?? follow.created_at);
  const lowAndComingDown = follow.last_alt !== null && follow.last_alt < LOW_FEET && (follow.last_rate ?? 0) <= 0;
  if (lowAndComingDown && quiet >= LOST_AFTER_SECONDS) return { kind: "landed" };
  return { kind: "waiting" };
}

/** The push: worded by the app's own translations ("BAW117 has landed", "in New York"). */
export function payload(follow) {
  return {
    aps: {
      alert: {
        "title-loc-key": "sky.landed.title", "title-loc-args": [follow.label],
        "loc-key": follow.destination ? "sky.landed.body" : "sky.landed.bodyNoPlace",
        "loc-args": follow.destination ? [follow.destination] : [],
      },
      sound: "default", "thread-id": "sky-follow",
    },
    hex: follow.hex, landed: true,
  };
}

/** The every-minute job. */
export async function checkFollows(env, now = Date.now()) {
  const { results: follows } = await env.DB.prepare(
    "SELECT token, environment, hex, label, destination, last_alt, last_rate, last_seen_at, created_at FROM follows LIMIT 500",
  ).all();
  if (!follows.length) return { following: 0, landed: 0 };
  const seconds = Math.floor(now / 1000);
  const hexes = [...new Set(follows.map((f) => f.hex))];
  const res = await fetch(`${ADSB}/hex/${hexes.join(",")}`, {
    headers: { "User-Agent": "AirRevealFollow/1.0 (+https://airreveal.isafenet.app/support.html)" },
  });
  if (!res.ok) {
    console.error("ADSB.lol follow", res.status);
    return { following: follows.length, landed: 0 };
  }
  const byHex = new Map(((await res.json()).ac ?? []).map((a) => [String(a.hex).toLowerCase(), a]));

  const landed = [], done = [], updates = [];
  for (const f of follows) {
    const verdict = judge(f, byHex.get(f.hex), seconds);
    if (verdict.kind === "landed") landed.push(f);
    else if (verdict.kind === "expired") done.push(f.token);
    else if (verdict.kind === "flying") updates.push([f.token, verdict.alt, verdict.rate]);
  }

  const jwts = {};
  for (const f of landed.slice(0, MAX_PUSHES)) {
    const key = apnsKey(env, f.environment);
    if (!key) { console.error(`No APNs key for ${f.environment}`); continue; }
    jwts[f.environment] ??= await apnsToken(env, f.environment, key, seconds);
    const host = f.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const push = await fetch(`https://${host}/3/device/${f.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwts[f.environment]}`, "apns-topic": env.APNS_TOPIC, "apns-push-type": "alert",
        "apns-priority": "10", "apns-collapse-id": `sky-landed-${f.hex}`, "apns-expiration": String(seconds + 3600),
      },
      body: JSON.stringify(payload(f)),
    });
    if (!push.ok) console.error("APNs follow", push.status, (await push.json().catch(() => ({}))).reason);
    done.push(f.token);   // told (or Apple has no such phone): either way, finished
  }

  const statements = updates.map(([token, alt, rate]) => env.DB.prepare(
    "UPDATE follows SET last_alt = ?, last_rate = ?, last_seen_at = ? WHERE token = ?",
  ).bind(alt, rate, seconds, token));
  if (done.length) {
    statements.push(env.DB.prepare("DELETE FROM follows WHERE token IN (SELECT value FROM json_each(?))").bind(JSON.stringify(done)));
  }
  if (statements.length) await env.DB.batch(statements);
  return { following: follows.length, landed: Math.min(landed.length, MAX_PUSHES) };
}
