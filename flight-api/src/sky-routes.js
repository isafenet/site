// Route updates for AirReveal's aircraft overhead: changes to Virtual Radar Server's standing-data routes
// (CC0) since the copy bundled in the app, so the app stays current between releases.
//
//          GET  /v1/sky-routes/changes?since=<unix>[&after=<callsign>]   the app: routes changed after `since`
//          GET  /v1/admin/sky-routes/state                              the Action: the commit we're up to date with
//          POST /v1/admin/sky-routes                                    the Action: a batch of changed routes
//          POST /v1/admin/sky-routes/commit                             the Action: the batches for a commit are in
//
// The work of comparing standing-data commits is done by a daily GitHub Action (tools/sync_sky_routes.py):
// a Worker on the free plan has far too little CPU to read the 620,000 routes itself. The admin endpoints
// need `Authorization: Bearer <SKY_ROUTES_SECRET>`.
// Privacy: the app sends only the date of the routes it has.

// A page of changes: small enough to stay well inside the free plan's CPU time per request.
export const PAGE_SIZE = 5000;
const CALLSIGN = /^[A-Z0-9]{2,8}$/;
const AIRPORT = /^[A-Z0-9]{3,4}$/;

/** Answers a sky-routes request, or returns null when the path isn't one of these endpoints. */
export async function handleSkyRoutes(req, env, path, url, fail) {
  if (path === "/v1/sky-routes/changes") {
    if (req.method !== "GET") fail(405, "method", "Only GET is supported.");
    const since = Number(url.searchParams.get("since"));
    if (!Number.isInteger(since) || since < 0) fail(422, "invalid", "Send since as Unix seconds.");
    const after = url.searchParams.get("after") ?? "";
    if (after && !CALLSIGN.test(after)) fail(422, "invalid", "Send after as a callsign.");
    return changes(env, since, after);
  }
  if (!path.startsWith("/v1/admin/sky-routes")) return null;

  await authorize(req, env, fail);
  if (path === "/v1/admin/sky-routes/state" && req.method === "GET") {
    const row = await env.DB.prepare("SELECT commit_sha, committed_at FROM sky_sync WHERE id = 1").first();
    return { commit: row?.commit_sha ?? null, committedAt: row?.committed_at ?? null };
  }
  if (path === "/v1/admin/sky-routes" && req.method === "POST") {
    const batch = parseBatch(await req.json().catch(() => null));
    if (!batch) fail(422, "invalid", "Send { changedAt, routes: [[callsign, airports]], airports: [...] }.");
    await store(env, batch);
    return { stored: { routes: batch.routes.length, airports: batch.airports.length } };
  }
  if (path === "/v1/admin/sky-routes/commit" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!/^[0-9a-f]{40}$/.test(body?.commit ?? "") || !Number.isInteger(body?.committedAt)) {
      fail(422, "invalid", "Send { commit, committedAt }.");
    }
    await env.DB.prepare(
      "INSERT INTO sky_sync (id, commit_sha, committed_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET commit_sha = excluded.commit_sha, committed_at = excluded.committed_at",
    ).bind(body.commit, body.committedAt).run();
    return { commit: body.commit, committedAt: body.committedAt };
  }
  fail(404, "not_found", "No such endpoint.");
}

/**
 * Routes changed after `since`, a page at a time in callsign order (`after` is the last callsign of the
 * previous page). `version` is what to send as `since` next time; airports come with the first page.
 */
async function changes(env, since, after) {
  const sync = await env.DB.prepare("SELECT committed_at FROM sky_sync WHERE id = 1").first();
  const { results: rows } = await env.DB.prepare(
    "SELECT callsign, airports FROM sky_routes WHERE changed_at > ? AND callsign > ? ORDER BY callsign LIMIT ?",
  ).bind(since, after, PAGE_SIZE).all();
  let airports = [];
  if (!after) {
    ({ results: airports } = await env.DB.prepare(
      "SELECT icao, iata, city, latitude, longitude FROM sky_airports WHERE changed_at > ?",
    ).bind(since).all());
  }
  return shapeChanges(Math.max(since, sync?.committed_at ?? 0), rows, airports);
}

/** The app's answer: [callsign, airports] pairs ("" for a removed route), and the next page's cursor. */
export function shapeChanges(version, rows, airports) {
  return {
    version,
    routes: rows.map((r) => [r.callsign, r.airports]),
    airports: airports.map((a) => ({ icao: a.icao, iata: a.iata ?? null, city: a.city, latitude: a.latitude, longitude: a.longitude })),
    next: rows.length === PAGE_SIZE ? rows[rows.length - 1].callsign : null,
  };
}

/** A batch from the Action, checked: null if anything in it is malformed. */
export function parseBatch(body) {
  if (!body || !Number.isInteger(body.changedAt) || !Array.isArray(body.routes) || !Array.isArray(body.airports)) return null;
  if (body.routes.length > 2000 || body.airports.length > 2000) return null;
  const routes = [];
  for (const r of body.routes) {
    if (!Array.isArray(r) || r.length !== 2 || !CALLSIGN.test(r[0]) || typeof r[1] !== "string") return null;
    const codes = r[1] === "" ? [] : r[1].split("-");
    if (codes.length === 1 || !codes.every((c) => AIRPORT.test(c))) return null;
    routes.push([r[0], r[1]]);
  }
  const airports = [];
  for (const a of body.airports) {
    if (!AIRPORT.test(a?.icao ?? "") || typeof a.city !== "string" || !Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) return null;
    if (a.iata != null && !/^[A-Z0-9]{3}$/.test(a.iata)) return null;
    airports.push({ icao: a.icao, iata: a.iata ?? null, city: a.city, latitude: a.latitude, longitude: a.longitude });
  }
  return { changedAt: body.changedAt, routes, airports };
}

// One statement per table, the rows passed as one JSON parameter: D1's free plan allows 50 queries a
// request and 100 parameters a query, far fewer than a batch's rows.
async function store(env, { changedAt, routes, airports }) {
  const statements = [];
  if (routes.length) {
    statements.push(env.DB.prepare(
      "INSERT INTO sky_routes (callsign, airports, changed_at) " +
      "SELECT value ->> 0, value ->> 1, ? FROM json_each(?) WHERE true " +
      "ON CONFLICT(callsign) DO UPDATE SET airports = excluded.airports, changed_at = excluded.changed_at",
    ).bind(changedAt, JSON.stringify(routes)));
  }
  if (airports.length) {
    statements.push(env.DB.prepare(
      "INSERT INTO sky_airports (icao, iata, city, latitude, longitude, changed_at) " +
      "SELECT value ->> 'icao', value ->> 'iata', value ->> 'city', value ->> 'latitude', value ->> 'longitude', ? " +
      "FROM json_each(?) WHERE true " +
      "ON CONFLICT(icao) DO UPDATE SET iata = excluded.iata, city = excluded.city, latitude = excluded.latitude, " +
      "longitude = excluded.longitude, changed_at = excluded.changed_at",
    ).bind(changedAt, JSON.stringify(airports)));
  }
  if (statements.length) await env.DB.batch(statements);
}

async function authorize(req, env, fail) {
  const expected = env.SKY_ROUTES_SECRET;
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !(await sameText(given, expected))) fail(401, "unauthorized", "Not allowed.");
}

/** Compares two secrets in constant time (by their SHA-256 digests, so their lengths don't leak either). */
async function sameText(a, b) {
  const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
