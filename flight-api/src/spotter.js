// Spotter alerts for AirReveal 2.1: a push when an aircraft type someone watches for (an A380, a 747, the
// Beluga, any ICAO type code) comes near them (Settings › Sky & Aircraft › Spotter Alerts).
//
//          PUT    /v1/spotter    the app: subscribe, or update the location, distance or types
//          DELETE /v1/spotter    the app: spotter alerts turned off, forget this phone
//
// Every 2 minutes (its own cron, so its requests don't count against the emergency alerts' run), if anyone
// is subscribed: one request to ADSB.lol per watched type (at most MAX_TYPES a run, taking turns when more
// are watched), a second apart, then a push to each subscriber within their distance, at most once per
// aircraft in 3 hours. ADSB.lol is free and needs no key.
//
// Privacy: as emergency alerts, a subscription holds the push token, the location rounded to two decimal
// places (about a kilometre), the distance, the type codes and the units; deleted when turned off or after 30
// days without an update. Sent alerts are kept for a day, to avoid repeats.

import { apnsKey, apnsToken, bearing, cellOf, cellsAround, distanceKm } from "./alerts.js";

const ADSB = "https://api.adsb.lol/v2";
const QUIET_SECONDS = 3 * 60 * 60;
const MAX_TYPES = 8;
const MAX_TYPES_PER_PHONE = 12;
const MAX_PUSHES = 35;
const MAX_RADIUS_KM = 161;   // 100 miles: big aircraft are seen from far off
const COMPASS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Answers /v1/spotter, or returns null for any other path. */
export async function handleSpotter(req, env, path, fail) {
  if (path !== "/v1/spotter") return null;
  if (req.method === "PUT") {
    const sub = parseSpotter(await req.json().catch(() => null));
    if (!sub) fail(422, "invalid", "Send { token, environment, latitude, longitude, radiusKm, types, units }.");
    await env.DB.prepare(
      "INSERT INTO spotter_subscribers (token, environment, latitude, longitude, cell, radius_km, types, units, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, " +
      "latitude = excluded.latitude, longitude = excluded.longitude, cell = excluded.cell, radius_km = excluded.radius_km, " +
      "types = excluded.types, units = excluded.units, updated_at = excluded.updated_at",
    ).bind(sub.token, sub.environment, sub.latitude, sub.longitude, cellOf(sub.latitude, sub.longitude), sub.radiusKm,
      sub.types.join(","), sub.units, Math.floor(Date.now() / 1000)).run();
    return { subscribed: true };
  }
  if (req.method === "DELETE") {
    const token = (await req.json().catch(() => null))?.token;
    if (typeof token !== "string" || !/^[0-9a-f]{64,200}$/.test(token)) fail(422, "invalid", "Send { token }.");
    await forget(env, [token]);
    return { unsubscribed: true };
  }
  fail(405, "method", "Use PUT or DELETE.");
}

/** A subscription from the app, checked and rounded; null if anything is wrong. */
export function parseSpotter(b) {
  if (!b || typeof b.token !== "string" || !/^[0-9a-f]{64,200}$/.test(b.token)) return null;
  if (!["sandbox", "production"].includes(b.environment)) return null;
  const { latitude, longitude, radiusKm } = b;
  if (![latitude, longitude, radiusKm].every(Number.isFinite)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) return null;
  if (!Array.isArray(b.types) || !b.types.length || b.types.length > MAX_TYPES_PER_PHONE) return null;
  const types = [...new Set(b.types.map((t) => String(t).toUpperCase()))];
  if (!types.every((t) => /^[A-Z0-9]{2,4}$/.test(t))) return null;
  if (!["mi", "km"].includes(b.units)) return null;
  const round = (x) => Math.round(x * 100) / 100;
  return { token: b.token, environment: b.environment, latitude: round(latitude), longitude: round(longitude), radiusKm, types, units: b.units };
}

/** Which types this run asks about: all of them when there are few, otherwise MAX_TYPES taking turns by `run`. */
export function typesForRun(allTypes, run) {
  const sorted = [...new Set(allTypes)].sort();
  if (sorted.length <= MAX_TYPES) return sorted;
  const start = (run * MAX_TYPES) % sorted.length;
  return Array.from({ length: MAX_TYPES }, (_, i) => sorted[(start + i) % sorted.length]);
}

/** Airborne aircraft from ADSB.lol, as { hex, type, name, lat, lon }. */
export function sighting(a) {
  if (!a || typeof a.hex !== "string" || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || a.alt_baro === "ground") return null;
  if (typeof a.t !== "string") return null;
  const label = (a.flight || "").trim() || a.r || a.hex.toUpperCase();
  return { hex: a.hex.toLowerCase(), type: a.t.toUpperCase(), name: `${label} (${a.t})`, lat: a.lat, lon: a.lon };
}

/** Who gets which alert: each subscriber, each aircraft of a type they watch within their distance, not in the last 3 hours. */
export function matchSpotter(subscribers, aircraft, recent) {
  const alerts = [];
  for (const s of subscribers) {
    const types = new Set(String(s.types).split(","));
    for (const a of aircraft) {
      if (!types.has(a.type) || recent.has(`${s.token}|${a.hex}`)) continue;
      const km = distanceKm(s.latitude, s.longitude, a.lat, a.lon);
      if (km > s.radius_km) continue;
      const distance = s.units === "mi" ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
      const point = COMPASS[Math.floor((bearing(s.latitude, s.longitude, a.lat, a.lon) + 22.5) / 45) % 8];
      alerts.push({ token: s.token, environment: s.environment, hex: a.hex, bodyKey: `sky.alert.body.${point}`, args: [a.name, distance] });
    }
  }
  return alerts;
}

/** The push: titled and worded by the app's own translations (the body reuses emergency alerts' compass texts). */
export function spotterPayload(alert) {
  return {
    aps: { alert: { "title-loc-key": "sky.spotter.title", "loc-key": alert.bodyKey, "loc-args": alert.args }, sound: "default", "thread-id": "sky-spotter" },
    hex: alert.hex,
  };
}

/** The every-2-minutes job. `run` decides whose types are asked about when more are watched than one run asks. */
export async function sendSpotterAlerts(env, now = Date.now()) {
  const { results: watched } = await env.DB.prepare("SELECT DISTINCT types FROM spotter_subscribers").all();
  if (!watched.length) return { aircraft: 0, alerts: 0 };
  const allTypes = watched.flatMap((r) => String(r.types).split(","));
  const types = typesForRun(allTypes, Math.floor(now / 120000));

  const aircraft = [];
  for (const [i, type] of types.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 1000));
    const res = await fetch(`${ADSB}/type/${type}`, { headers: { "User-Agent": "AirRevealSpotter/1.0 (+https://airreveal.isafenet.app/support.html)" } });
    if (!res.ok) { console.error("ADSB.lol", res.status, type); continue; }
    for (const a of (await res.json()).ac ?? []) {
      const found = sighting(a);
      if (found) aircraft.push(found);
    }
  }
  if (!aircraft.length) return { aircraft: 0, alerts: 0 };

  const cells = [...new Set(aircraft.flatMap((a) => cellsAround(a.lat, a.lon, MAX_RADIUS_KM)))];
  const { results: subscribers } = await env.DB.prepare(
    "SELECT token, environment, latitude, longitude, radius_km, types, units FROM spotter_subscribers WHERE cell IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(cells)).all();
  if (!subscribers.length) return { aircraft: aircraft.length, alerts: 0 };

  const seconds = Math.floor(now / 1000);
  const { results: sent } = await env.DB.prepare(
    "SELECT token, hex FROM spotter_sent WHERE sent_at > ? AND token IN (SELECT value FROM json_each(?))",
  ).bind(seconds - QUIET_SECONDS, JSON.stringify(subscribers.map((s) => s.token))).all();
  const alerts = matchSpotter(subscribers, aircraft, new Set(sent.map((r) => `${r.token}|${r.hex}`))).slice(0, MAX_PUSHES);

  const jwts = {};
  const delivered = [], gone = [];
  for (const alert of alerts) {
    const key = apnsKey(env, alert.environment);
    if (!key) continue;
    jwts[alert.environment] ??= await apnsToken(env, alert.environment, key, seconds);
    const host = alert.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const res = await fetch(`https://${host}/3/device/${alert.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwts[alert.environment]}`, "apns-topic": env.APNS_TOPIC, "apns-push-type": "alert",
        "apns-priority": "10", "apns-collapse-id": `sky-spotter-${alert.hex}`, "apns-expiration": String(seconds + 900),
      },
      body: JSON.stringify(spotterPayload(alert)),
    });
    if (res.ok) delivered.push([alert.token, alert.hex]);
    else {
      const reason = (await res.json().catch(() => ({}))).reason;
      if (res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") gone.push(alert.token);
      else console.error("APNs", res.status, reason);
    }
  }
  if (delivered.length) {
    await env.DB.prepare(
      "INSERT INTO spotter_sent (token, hex, sent_at) SELECT value ->> 0, value ->> 1, ? FROM json_each(?) WHERE true " +
      "ON CONFLICT(token, hex) DO UPDATE SET sent_at = excluded.sent_at",
    ).bind(seconds, JSON.stringify(delivered)).run();
  }
  if (gone.length) await forget(env, [...new Set(gone)]);
  return { aircraft: aircraft.length, alerts: delivered.length };
}

async function forget(env, tokens) {
  const list = JSON.stringify(tokens);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM spotter_subscribers WHERE token IN (SELECT value FROM json_each(?))").bind(list),
    env.DB.prepare("DELETE FROM spotter_sent WHERE token IN (SELECT value FROM json_each(?))").bind(list),
  ]);
}

/** Daily: sent alerts older than a day, and subscriptions not updated for 30 days. */
export async function cleanUpSpotter(env, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM spotter_sent WHERE sent_at < ?").bind(seconds - 86400),
    env.DB.prepare("DELETE FROM spotter_subscribers WHERE updated_at < ?").bind(seconds - 30 * 86400),
  ]);
}
