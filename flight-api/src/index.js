// AirReveal flight lookup: a Cloudflare Worker between the app and SkyLink API, with a D1 database.
//
//          GET /v1/route/:callsign     departure and arrival airports for an ICAO callsign (BAW117);
//                                      ?flight=LS1827 also tries the flight number if the callsign isn't known
//          GET /v1/status/:flight      today's status of a flight (BA117): gates, terminals, times, delays
//          GET /v1/sky-routes/changes  aircraft routes changed since the app's copy (see sky-routes.js)
//          GET /v1/usage               SkyLink calls left this month (also sent as X-SkyLink-Remaining and
//                                      X-SkyLink-Limit on every route and status answer)
//
// SkyLink's terms don't allow its key in an app binary, so the key lives here as a Worker secret.
// While AirReveal is on SkyLink's free trial (1,000 requests a month), this is for TestFlight builds only,
// and three things keep it inside the trial:
//   - answers are cached (a flight number's airports rarely change), so a repeat lookup costs nothing;
//   - a hard monthly cap on calls to SkyLink (MONTHLY_CAP), below the trial's 1,000, so there's never overage;
//   - a daily limit per person (DAILY_LIMIT), keyed by an HMAC of IP + date that can't be reversed.
// Privacy: no IP addresses or accounts are stored; the cache holds only callsigns and airports.

import AIRPORT_CODES from "./airport-codes.json" with { type: "json" };
import { handleSkyRoutes } from "./sky-routes.js";

const SKYLINK = "https://data.skylinkapi.com/v3.1";
const CACHE_DAYS = { found: 14, notFound: 1 };
// A flight's status changes through the day; one answer serves everyone on that flight for 5 minutes.
const STATUS_CACHE_MINUTES = { found: 5, notFound: 30 };

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
  const sky = await handleSkyRoutes(req, env, path, url, fail);
  if (sky) return json(sky);
  if (req.method !== "GET") fail(405, "method", "Only GET is supported.");
  let m = path.match(/^\/v1\/route\/([^/]+)$/);
  if (m) {
    const callsign = normalizeCallsign(decodeURIComponent(m[1]));
    if (!callsign) fail(422, "invalid", "Send an ICAO callsign such as BAW117.");
    const raw = url.searchParams.get("flight");
    const flight = raw ? normalizeFlightNumber(raw) : null;
    if (raw && !flight) fail(422, "invalid", "Send a flight number such as BA117.");
    const result = await lookUpRoute(callsign, flight, req, env);
    return json(result, 200, allowanceHeaders(await allowance(env)));
  }
  m = path.match(/^\/v1\/status\/([^/]+)$/);
  if (m) {
    const flight = normalizeFlightNumber(decodeURIComponent(m[1]));
    if (!flight) fail(422, "invalid", "Send a flight number such as BA117.");
    const result = await lookUpStatus(flight, req, env);
    return json(result, 200, allowanceHeaders(await allowance(env)));
  }
  if (path === "/v1/usage") return json(await allowance(env));
  fail(404, "not_found", "No such endpoint.");
}

/** BA117, ba 117, U28001, BAW117 → the same without spaces; anything else → null. */
export function normalizeFlightNumber(raw) {
  const s = String(raw).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(s) && /[A-Z]/.test(s.slice(0, 3)) ? s : null;
}

/** SkyLink's flight status, reshaped for the app: IATA airports, and "" (not yet published) as null. */
export function shapeStatus(flight, body) {
  if (!body || !body.departure || !body.arrival) return { flight, found: false };
  // Unpublished fields come as "" or "--".
  const text = (v) => (typeof v === "string" && v.trim() && !/^-+$/.test(v.trim()) ? v.trim() : null);
  // Airports come as "LHR • London" (the docs show a bare "EGLL").
  const code = (v) => { const c = text(v)?.split("•")[0].trim(); return c ? (airport(c)?.iata ?? c) : null; };
  const side = (s, extra) => ({
    airport: code(s.airport),
    terminal: text(s.terminal), gate: text(s.gate),
    scheduled: text(s.scheduled_time), ...extra,
  });
  return {
    // "Departed 08:41" → the word(s) and the time, so the app can translate the word.
    flight, found: true, status: text(body.status), ...statusParts(text(body.status)),
    departure: side(body.departure, { actual: text(body.departure.actual_time) }),
    arrival: side(body.arrival, { estimated: text(body.arrival.estimated_time), actual: text(body.arrival.actual_time), baggage: text(body.arrival.baggage) }),
  };
}

/** "Departed 08:41" → { statusWord: "Departed", statusTime: "08:41" }; no time → statusTime null. */
export function statusParts(status) {
  if (!status) return { statusWord: null, statusTime: null };
  const m = status.match(/^(.*?)\s*(\d{1,2}:\d{2})$/);
  return m ? { statusWord: m[1] || null, statusTime: m[2] } : { statusWord: status, statusTime: null };
}

async function lookUpStatus(flight, req, env) {
  const key = `status:${flight}`;
  const cached = await env.DB.prepare("SELECT body FROM cache WHERE key = ? AND expires > ?")
    .bind(key, now().toISOString()).first();
  if (cached) return { ...JSON.parse(cached.body), cached: true };
  return { ...(await fetchStatus(flight, req, env)), cached: false };
}

/** Asks SkyLink for a flight's status (spending from the budgets) and caches the answer. */
async function fetchStatus(flight, req, env) {
  const key = `status:${flight}`;
  await limitPerPerson(req, env);
  await spendFromMonthlyBudget(env);

  const res = await fetch(`${SKYLINK}/flight_status/${encodeURIComponent(flight)}`, {
    headers: { "x-api-key": env.SKYLINK_API_KEY, Accept: "application/json" },
  });
  let result;
  if (res.status === 404 || res.status === 422) {
    result = shapeStatus(flight, null);
  } else if (res.status === 429) {
    fail(503, "paused", "Flight lookup is paused until next month.");
  } else if (!res.ok) {
    console.error("SkyLink status", res.status, await res.text().catch(() => ""));
    fail(502, "upstream", "The flight data service didn't answer.");
  } else {
    result = shapeStatus(flight, await res.json());
  }
  const minutes = result.found ? STATUS_CACHE_MINUTES.found : STATUS_CACHE_MINUTES.notFound;
  await env.DB.prepare("INSERT OR REPLACE INTO cache (key, body, expires) VALUES (?, ?, ?)")
    .bind(key, JSON.stringify(result), new Date(now().getTime() + minutes * 60e3).toISOString()).run();
  return result;
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

/**
 * The airports of today's flight, from its status, as a low-confidence route: a flight number usually keeps
 * its route, but this is one day's flight rather than SkyLink's route data.
 */
export function routeFromStatus(callsign, status) {
  const departure = airport(status?.departure?.airport), arrival = airport(status?.arrival?.airport);
  if (status?.found && departure?.iata && arrival?.iata) {
    return { callsign, found: true, confidence: "low", departure, arrival, suggestions: [] };
  }
  return shape(callsign, null);
}

async function lookUpRoute(callsign, flight, req, env) {
  const byCallsign = await lookUpRouteByCallsign(callsign, req, env);
  if (byCallsign.found || !flight) return byCallsign;
  // Some airlines (Jet2, easyJet) fly under callsigns that aren't their flight numbers (e.g. EXS47KM, not EXS1827),
  // so SkyLink's callsign routes miss them; its flight status is keyed by the flight number instead.
  const key = `route-flight:${flight}`;
  const cached = await env.DB.prepare("SELECT body FROM cache WHERE key = ? AND expires > ?")
    .bind(key, now().toISOString()).first();
  if (cached) return { ...JSON.parse(cached.body), cached: true };
  const result = routeFromStatus(callsign, await fetchStatus(flight, req, env));
  const days = result.found ? CACHE_DAYS.found : CACHE_DAYS.notFound;
  await env.DB.prepare("INSERT OR REPLACE INTO cache (key, body, expires) VALUES (?, ?, ?)")
    .bind(key, JSON.stringify(result), new Date(now().getTime() + days * 86400e3).toISOString()).run();
  return { ...result, cached: false };
}

async function lookUpRouteByCallsign(callsign, req, env) {
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

/** This month's SkyLink allowance: calls made, the cap, what's left, and when it starts again (UTC). */
export async function allowance(env, month = thisMonth()) {
  const limit = Number(env.MONTHLY_CAP || 1000);
  const row = await env.DB.prepare("SELECT calls FROM usage WHERE month = ?").bind(month).first();
  return shapeAllowance(month, row?.calls ?? 0, limit);
}

export function shapeAllowance(month, calls, limit) {
  const [year, m] = month.split("-").map(Number);
  const resetsAt = new Date(Date.UTC(year, m, 1)).toISOString();   // m is 1-based, so this is next month
  const used = Math.min(calls, limit);
  return { month, used, limit, remaining: limit - used, resetsAt };
}

const allowanceHeaders = (a) => ({ "X-SkyLink-Remaining": String(a.remaining), "X-SkyLink-Limit": String(a.limit) });

/** Counts this call against the month and refuses once MONTHLY_CAP is reached, so the trial never runs over. */
async function spendFromMonthlyBudget(env) {
  const cap = Number(env.MONTHLY_CAP || 1000);
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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
