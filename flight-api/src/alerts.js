// Emergency-aircraft alerts for AirReveal: a push when a police, air ambulance, coastguard or rescue, or
// firefighting aircraft comes near someone who asked for them (Settings › Sky & Aircraft).
//
//          PUT    /v1/alerts    the app: subscribe, or update the location or settings
//          DELETE /v1/alerts    the app: alerts turned off, forget this phone
//
// Every minute (the cron), if anyone is subscribed: one request to ADSB.lol per 1,000 known emergency
// aircraft (plane-alert-db's list, src/emergency-aircraft.json, built by AirReveal's
// Scripts/generate_special_aircraft.py) and one per squawk the UK and Germany set aside for air ambulances
// and police, then a push to each subscriber within their distance, at most once per aircraft in 30 minutes.
// Military aircraft are alerted by the app itself while it's open: ADSB.lol's worldwide military list is
// too big to read every minute on the free plan.
//
// Privacy: a subscription holds the push token, the location rounded to two decimal places (about a
// kilometre), the distance, the services and the units, and is deleted when alerts are turned off or after
// 30 days without an update. Sent alerts are kept for a day, to avoid repeats.

import EMERGENCY from "./emergency-aircraft.json" with { type: "json" };

const ADSB = "https://api.adsb.lol/v2";
export const PUSHED_SERVICES = ["police", "ambulance", "rescue", "fire"];
const ALL_SERVICES = [...PUSHED_SERVICES, "military"];
const QUIET_SECONDS = 30 * 60;
// Each push is an outgoing request; the free plan allows 50 a run, and ADSB.lol takes about six.
const MAX_PUSHES = 40;
const MAX_RADIUS_KM = 81;   // 50 miles
const SQUAWKS = [
  { squawk: "0020", countries: ["GB", "DE"], service: "ambulance" },
  { squawk: "0032", countries: ["GB"], service: "police" },
];
const COMPASS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Answers /v1/alerts, or returns null for any other path. */
export async function handleAlerts(req, env, path, fail) {
  if (path !== "/v1/alerts") return null;
  if (req.method === "PUT") {
    const sub = parseSubscription(await req.json().catch(() => null));
    if (!sub) fail(422, "invalid", "Send { token, environment, latitude, longitude, radiusKm, services, units }.");
    await env.DB.prepare(
      "INSERT INTO alert_subscribers (token, environment, latitude, longitude, cell, radius_km, services, units, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, " +
      "latitude = excluded.latitude, longitude = excluded.longitude, cell = excluded.cell, radius_km = excluded.radius_km, " +
      "services = excluded.services, units = excluded.units, updated_at = excluded.updated_at",
    ).bind(sub.token, sub.environment, sub.latitude, sub.longitude, cellOf(sub.latitude, sub.longitude), sub.radiusKm,
      sub.services.join(","), sub.units, Math.floor(Date.now() / 1000)).run();
    return { subscribed: true };
  }
  if (req.method === "DELETE") {
    const token = (await req.json().catch(() => null))?.token;
    if (!validToken(token)) fail(422, "invalid", "Send { token }.");
    await forget(env, [token]);
    return { unsubscribed: true };
  }
  fail(405, "method", "Use PUT or DELETE.");
}

const validToken = (t) => typeof t === "string" && /^[0-9a-f]{64,200}$/.test(t);

/** A subscription from the app, checked and rounded; null if anything is wrong. */
export function parseSubscription(b) {
  if (!b || !validToken(b.token) || !["sandbox", "production"].includes(b.environment)) return null;
  const { latitude, longitude, radiusKm } = b;
  if (![latitude, longitude, radiusKm].every(Number.isFinite)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) return null;
  if (!Array.isArray(b.services) || !b.services.every((s) => ALL_SERVICES.includes(s))) return null;
  if (!["mi", "km"].includes(b.units)) return null;
  const round = (x) => Math.round(x * 100) / 100;
  return { token: b.token, environment: b.environment, latitude: round(latitude), longitude: round(longitude),
           radiusKm, services: [...new Set(b.services)], units: b.units };
}

/** One-degree grid cell: subscribers are found by the cells around each aircraft. */
export const cellOf = (lat, lon) => `${Math.floor(lat)}:${Math.floor(lon)}`;

/** The cells within MAX_RADIUS_KM of a point (more of them east and west nearer the poles). */
export function cellsAround(lat, lon) {
  const lonSpan = Math.min(4, Math.ceil(MAX_RADIUS_KM / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2))));
  const cells = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -lonSpan; dLon <= lonSpan; dLon++) {
      const cellLon = ((Math.floor(lon) + dLon + 540) % 360) - 180;
      cells.push(`${Math.floor(lat) + dLat}:${cellLon}`);
    }
  }
  return cells;
}

/** The country an ICAO address is registered in, for the national squawks. */
export function countryOf(hex) {
  const n = parseInt(hex, 16);
  if (n >= 0x400000 && n <= 0x43ffff) return "GB";
  if (n >= 0x3c0000 && n <= 0x3fffff) return "DE";
  return null;
}

/** An aircraft from ADSB.lol as an emergency aircraft ({ hex, service, name, lat, lon }), or null. */
export function classify(a) {
  if (!a || typeof a.hex !== "string" || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || a.alt_baro === "ground") return null;
  const hex = a.hex.toLowerCase();
  let service = EMERGENCY[hex] ?? null;
  if (!service) {
    const rule = SQUAWKS.find((s) => s.squawk === a.squawk && s.countries.includes(countryOf(hex)));
    service = rule?.service ?? null;
  }
  if (!service) return null;
  const callsign = (a.flight || "").trim();
  const label = callsign || a.r || hex.toUpperCase();
  return { hex, service, name: a.t ? `${label} (${a.t})` : label, lat: a.lat, lon: a.lon };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371.0088 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const y = Math.sin(r(lon2 - lon1)) * Math.cos(r(lat2));
  const x = Math.cos(r(lat1)) * Math.sin(r(lat2)) - Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(r(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Who gets which alert: each subscriber, each emergency aircraft of a service they chose within their
 * distance, unless they had one for it in the last half hour. Distances in their units; the direction as
 * the app's per-compass-point text ("sky.alert.body.ne").
 */
export function matchAlerts(subscribers, aircraft, recent) {
  const alerts = [];
  for (const s of subscribers) {
    const services = new Set(String(s.services).split(","));
    for (const a of aircraft) {
      if (!services.has(a.service) || recent.has(`${s.token}|${a.hex}`)) continue;
      const km = distanceKm(s.latitude, s.longitude, a.lat, a.lon);
      if (km > s.radius_km) continue;
      const distance = s.units === "mi" ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
      const point = COMPASS[Math.floor((bearing(s.latitude, s.longitude, a.lat, a.lon) + 22.5) / 45) % 8];
      alerts.push({ token: s.token, environment: s.environment, hex: a.hex, service: a.service,
                    bodyKey: `sky.alert.body.${point}`, args: [a.name, distance] });
    }
  }
  return alerts;
}

/** The push Apple delivers: titled and worded by the app's own translations. */
export function payload(alert) {
  return {
    aps: {
      alert: { "title-loc-key": `sky.alert.title.${alert.service}`, "loc-key": alert.bodyKey, "loc-args": alert.args },
      sound: "default", "thread-id": "sky-services",
    },
    hex: alert.hex,
  };
}

/** The every-minute job. */
export async function sendAlerts(env, now = Date.now()) {
  const anyone = await env.DB.prepare("SELECT 1 AS one FROM alert_subscribers LIMIT 1").first();
  if (!anyone) return { aircraft: 0, alerts: 0 };

  const aircraft = await emergencyAircraft();
  if (!aircraft.length) return { aircraft: 0, alerts: 0 };

  const cells = [...new Set(aircraft.flatMap((a) => cellsAround(a.lat, a.lon)))];
  const { results: subscribers } = await env.DB.prepare(
    "SELECT token, environment, latitude, longitude, radius_km, services, units FROM alert_subscribers " +
    "WHERE cell IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(cells)).all();
  if (!subscribers.length) return { aircraft: aircraft.length, alerts: 0 };

  const seconds = Math.floor(now / 1000);
  const { results: sent } = await env.DB.prepare(
    "SELECT token, hex FROM alert_sent WHERE sent_at > ? AND token IN (SELECT value FROM json_each(?))",
  ).bind(seconds - QUIET_SECONDS, JSON.stringify(subscribers.map((s) => s.token))).all();
  const alerts = matchAlerts(subscribers, aircraft, new Set(sent.map((r) => `${r.token}|${r.hex}`))).slice(0, MAX_PUSHES);
  if (!alerts.length) return { aircraft: aircraft.length, alerts: 0 };
  const jwts = {};
  const delivered = [], gone = [];
  for (const alert of alerts) {
    const key = apnsKey(env, alert.environment);
    if (!key) {
      console.error(`No APNs key for ${alert.environment}: alert not sent`);
      continue;
    }
    jwts[alert.environment] ??= await apnsToken(env, alert.environment, key, seconds);
    const jwt = jwts[alert.environment];
    const host = alert.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const res = await fetch(`https://${host}/3/device/${alert.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`, "apns-topic": env.APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10",
        "apns-collapse-id": `sky-service-${alert.hex}`, "apns-expiration": String(seconds + 600),
      },
      body: JSON.stringify(payload(alert)),
    });
    if (res.ok) {
      delivered.push([alert.token, alert.hex]);
    } else {
      const reason = (await res.json().catch(() => ({}))).reason;
      if (res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") gone.push(alert.token);
      else console.error("APNs", res.status, reason);
    }
  }
  const statements = [];
  if (delivered.length) {
    statements.push(env.DB.prepare(
      "INSERT INTO alert_sent (token, hex, sent_at) SELECT value ->> 0, value ->> 1, ? FROM json_each(?) WHERE true " +
      "ON CONFLICT(token, hex) DO UPDATE SET sent_at = excluded.sent_at",
    ).bind(seconds, JSON.stringify(delivered)));
  }
  if (statements.length) await env.DB.batch(statements);
  if (gone.length) await forget(env, [...new Set(gone)]);
  return { aircraft: aircraft.length, alerts: delivered.length };
}

/** The known emergency aircraft in the air now, and anything on the national squawks. */
async function emergencyAircraft() {
  const hexes = Object.keys(EMERGENCY);
  const urls = [];
  for (let i = 0; i < hexes.length; i += 1000) urls.push(`${ADSB}/hex/${hexes.slice(i, i + 1000).join(",")}`);
  for (const { squawk } of SQUAWKS) urls.push(`${ADSB}/sqk/${squawk}`);
  // One at a time, a second apart: ADSB.lol's rate limits are dynamic, and a burst gets 420s and 429s.
  // A refused request is skipped; the next minute tries again.
  const answers = [];
  for (const [i, url] of urls.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 1000));
    const res = await fetch(url, { headers: { "User-Agent": "AirRevealAlerts/1.0 (+https://airreveal.isafenet.app/support.html)" } });
    if (res.ok) answers.push(...((await res.json()).ac ?? []));
    else console.error("ADSB.lol", res.status, url.slice(0, 60));
  }
  const byHex = new Map();
  for (const a of answers) {
    const found = classify(a);
    if (found) byHex.set(found.hex, found);
  }
  return [...byHex.values()];
}

async function forget(env, tokens) {
  const list = JSON.stringify(tokens);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM alert_subscribers WHERE token IN (SELECT value FROM json_each(?))").bind(list),
    env.DB.prepare("DELETE FROM alert_sent WHERE token IN (SELECT value FROM json_each(?))").bind(list),
  ]);
}

/** Daily: sent alerts older than a day, and subscriptions not updated for 30 days. */
export async function cleanUpAlerts(env, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM alert_sent WHERE sent_at < ?").bind(seconds - 86400),
    env.DB.prepare("DELETE FROM alert_subscribers WHERE updated_at < ?").bind(seconds - 30 * 86400),
  ]);
}

// MARK: APNs provider token

/**
 * The .p8 key and its Key ID for an environment: sandbox (Xcode builds) and production (TestFlight and the
 * App Store) have keys of their own (APNS_KEY_SANDBOX / APNS_KEY_ID_SANDBOX, APNS_KEY_PRODUCTION /
 * APNS_KEY_ID_PRODUCTION); APNS_KEY / APNS_KEY_ID, a key for both, is used where one is missing.
 */
export function apnsKey(env, environment) {
  const suffix = environment === "sandbox" ? "SANDBOX" : "PRODUCTION";
  const pem = env[`APNS_KEY_${suffix}`] ?? env.APNS_KEY;
  const id = env[`APNS_KEY_ID_${suffix}`] ?? env.APNS_KEY_ID;
  return pem && id ? { pem, id } : null;
}

/**
 * The ES256 token Apple's push service wants, signed with the environment's .p8 key. Apple refuses tokens
 * refreshed more than every 20 minutes, so one per environment is kept in D1 and reused for 40.
 */
export async function apnsToken(env, environment, key, seconds) {
  const kept = await env.DB.prepare("SELECT jwt, issued_at FROM apns_token WHERE environment = ?").bind(environment).first();
  if (kept && seconds - kept.issued_at < 40 * 60) return kept.jwt;
  const jwt = await signJWT(key.pem, key.id, env.APNS_TEAM_ID, seconds);
  await env.DB.prepare(
    "INSERT INTO apns_token (environment, jwt, issued_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(environment) DO UPDATE SET jwt = excluded.jwt, issued_at = excluded.issued_at",
  ).bind(environment, jwt, seconds).run();
  return jwt;
}

export async function signJWT(pem, keyID, teamID, seconds) {
  const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const text = (s) => base64url(new TextEncoder().encode(s));
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const unsigned = `${text(JSON.stringify({ alg: "ES256", kid: keyID }))}.${text(JSON.stringify({ iss: teamID, iat: seconds }))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}
