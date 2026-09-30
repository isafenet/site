// AirReveal flight lookup: a Cloudflare Worker between the app and SkyLink API, with a D1 database.
//
//          GET /v1/route/:callsign     departure and arrival airports for an ICAO callsign (BAW117)
//
// SkyLink's terms don't allow its key in an app binary, so the key lives here as a Worker secret.
// While AirReveal is on SkyLink's free trial (1,000 requests a month), this is for TestFlight builds only,
// and three things keep it inside the trial:
//   - answers are cached (a flight number's airports rarely change), so a repeat lookup costs nothing;
//   - a hard monthly cap on calls to SkyLink (MONTHLY_CAP), below the trial's 1,000, so there's never overage;
//   - a daily limit per person (DAILY_LIMIT), keyed by an HMAC of IP + date that can't be reversed.
// Privacy: no IP addresses or accounts are stored; the cache holds only callsigns and airports.

import AIRPORT_CODES from "./airport-codes.json" with { type: "json" };

const SKYLINK = "https://data.skylinkapi.com/v3.1";
const CACHE_DAYS = { found: 14, notFound: 1 };

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

const now = () => new Date();
const today = () => now().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: "server", message: "Something went wrong on our side." }, 500);
    }
  },
  // Daily cron: rate-limit rows only matter for the day they were made; expired cache rows can go too.
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate WHERE day < ?").bind(today()),
      env.DB.prepare("DELETE FROM cache WHERE expires < ?").bind(now().toISOString()),
    ]);
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (req.method !== "GET") fail(405, "method", "Only GET is supported.");
  const m = path.match(/^\/v1\/route\/([^/]+)$/);
  if (!m) fail(404, "not_found", "No such endpoint.");
  const callsign = normalizeCallsign(decodeURIComponent(m[1]));
  if (!callsign) fail(422, "invalid", "Send an ICAO callsign such as BAW117.");
  return json(await lookUpRoute(callsign, req, env));
}

/** BAW117, BAW 117, baw117a → BAW117 / BAW117A; anything else → null. */
export function normalizeCallsign(raw) {
  const s = String(raw).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{3}\d{1,4}[A-Z]?$/.test(s) ? s : null;
}

/** An airport code from SkyLink (ICAO, or occasionally IATA) as {icao, iata}; iata is null if unknown. */
export function airport(code) {
  const c = String(code || "").toUpperCase().trim();
  if (c.length === 4) return { icao: c, iata: AIRPORT_CODES[c] ?? null };
  if (c.length === 3) return { icao: null, iata: c };
  return null;
}

/** SkyLink's callsign answer, reshaped for the app: IATA codes, and at most three low-confidence suggestions. */
export function shape(callsign, body) {
  const high = body?.confidence === "high" && body.departure_icao && body.arrival_icao;
  if (high) {
    const departure = airport(body.departure_icao), arrival = airport(body.arrival_icao);
    if (departure?.iata && arrival?.iata) return { callsign, found: true, confidence: "high", departure, arrival, suggestions: [] };
  }
  const suggestions = (Array.isArray(body?.routes) ? body.routes : [])
    .map((r) => ({ departure: airport(r.departure), arrival: airport(r.arrival),
                   durationMinutes: Number.isFinite(r.duration_min) ? r.duration_min : null }))
    .filter((r) => r.departure?.iata && r.arrival?.iata)
    .slice(0, 3);
  if (suggestions.length) {
    return { callsign, found: true, confidence: "low", departure: suggestions[0].departure, arrival: suggestions[0].arrival, suggestions };
  }
  return { callsign, found: false, confidence: null, departure: null, arrival: null, suggestions: [] };
}

async function lookUpRoute(callsign, req, env) {
  const key = `route:${callsign}`;
  const cached = await env.DB.prepare("SELECT body FROM cache WHERE key = ? AND expires > ?")
    .bind(key, now().toISOString()).first();
  if (cached) return { ...JSON.parse(cached.body), cached: true };

  await limitPerPerson(req, env);
  await spendFromMonthlyBudget(env);

  const res = await fetch(`${SKYLINK}/routes/callsign/${encodeURIComponent(callsign)}`, {
    headers: { "x-api-key": env.SKYLINK_API_KEY, Accept: "application/json" },
  });
  let result;
  if (res.status === 404 || res.status === 422) {
    result = shape(callsign, null);
  } else if (res.status === 429) {
    fail(503, "paused", "Flight lookup is paused until next month.");
  } else if (!res.ok) {
    console.error("SkyLink", res.status, await res.text().catch(() => ""));
    fail(502, "upstream", "The flight data service didn't answer.");
  } else {
    result = shape(callsign, await res.json());
  }

  const days = result.found ? CACHE_DAYS.found : CACHE_DAYS.notFound;
  const expires = new Date(now().getTime() + days * 86400e3).toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO cache (key, body, expires) VALUES (?, ?, ?)")
    .bind(key, JSON.stringify(result), expires).run();
  return { ...result, cached: false };
}

/** Counts this call against the month and refuses once MONTHLY_CAP is reached, so the trial never runs over. */
async function spendFromMonthlyBudget(env) {
  const cap = Number(env.MONTHLY_CAP || 900);
  const row = await env.DB.prepare(
    "INSERT INTO usage (month, calls) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET calls = calls + 1 RETURNING calls",
  ).bind(thisMonth()).first();
  if (row.calls > cap) fail(503, "paused", "Flight lookup is paused until next month.");
}

async function limitPerPerson(req, env) {
  const limit = Number(env.DAILY_LIMIT || 40);
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const who = await hmac(env.HASH_SECRET, `${ip}|${today()}`);
  const row = await env.DB.prepare(
    "INSERT INTO rate (who, day, n) VALUES (?, ?, 1) ON CONFLICT(who, day) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(who, today()).first();
  if (row.n > limit) fail(429, "limit", "That's a lot of lookups for one day. Try again tomorrow.");
}

async function hmac(secret, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
