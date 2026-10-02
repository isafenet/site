# AirReveal flight lookup

A Cloudflare Worker (with a D1 database) between AirReveal and [SkyLink API](https://skylinkapi.com/docs/).
SkyLink's terms don't allow its key in an app binary ("a mobile app binary, browser JavaScript, or a public
repository"), so the key is a Worker secret and the app only ever talks to this Worker.

**TestFlight only for now.** AirReveal is on SkyLink's free trial (1,000 requests a month), so the app shows
Look Up Flight only in TestFlight and Xcode builds, and only when adding a Live trip (not a planned one). Before it goes into an App Store release, move to a paid
SkyLink plan and raise `MONTHLY_CAP`.

Live at `https://airreveal-flights.isafenet-feedback.workers.dev`.

## Endpoint

`GET /v1/route/:callsign`, where the callsign is the ICAO airline code plus the flight number (`BAW117`; the
app converts `BA117` itself). It calls SkyLink's
[Callsign → Route](https://skylinkapi.com/docs/v31/routes-callsign/) and answers with IATA airport codes:

```json
{ "callsign": "BAW117", "found": true, "confidence": "high",
  "departure": { "icao": "EGLL", "iata": "LHR" }, "arrival": { "icao": "KJFK", "iata": "JFK" },
  "suggestions": [], "cached": false }
```

`confidence: "low"` means SkyLink had no record for that exact flight and suggested the airline's likeliest
routes instead (up to three in `suggestions`, the first also in `departure`/`arrival`); the app says it's a best
match to check. `found: false` means nothing usable.

`?flight=LS1827` (the IATA flight number) adds a fallback: if SkyLink has no route for the callsign, the
Worker asks its flight status (`/flight_status`) for that flight number and
answers with today's airports as `confidence: "low"`. Airlines such as Jet2 and easyJet fly under callsigns
that aren't their flight numbers (`EXS47KM`, say, for a Jet2 flight sold as LS1827), so the callsign alone often finds nothing. The
fallback is a second SkyLink call, only when the first finds nothing; its answer is cached like a route.

Errors are `{ "error": code, "message": text }`: `invalid` (422), `limit` (429, the per-person daily limit),
`paused` (503, the monthly cap is reached), `upstream` (502).

## Aircraft route updates

AirReveal bundles Virtual Radar Server's [standing-data](https://github.com/vradarserver/standing-data) routes
(CC0) for the aircraft overhead. Between releases it asks this Worker for the routes that changed since its
copy (`src/sky-routes.js`); this never reaches SkyLink.

`GET /v1/sky-routes/changes?since=<unix seconds>` answers
`{ "version": 1790912973, "routes": [["BAW117", "EGLL-KJFK"], ["XYZ1", ""]], "airports": [...], "next": null }`:
each changed callsign's airports in ICAO codes (`""` when the route was removed), the airports those routes use,
and the `version` to send as `since` next time. Up to 5,000 routes a page; when `next` is a callsign, ask again with
`&after=<next>` (airports come with the first page). The app sends only that date.

A daily GitHub Action (`.github/workflows/sky-routes.yml`) runs `tools/sync_sky_routes.py`: it diffs the
standing-data commit the Worker last synced against the latest one and posts the changes to the admin endpoints
(`/v1/admin/sky-routes…`, which need `Authorization: Bearer <SKY_ROUTES_SECRET>`). The comparing is done there
because a free-plan Worker has far too little CPU to read the 620,000 routes. Each run sends a few hundred to a
few thousand changes.

**Setting it up (once):**

1. `npm run db:remote` (adds the `sky_routes`, `sky_airports` and `sky_sync` tables), then `npm run deploy`.
2. Make a secret (`openssl rand -hex 32`) and store it twice: `npx wrangler secret put SKY_ROUTES_SECRET`, and
   as the repository's Actions secret `SKY_ROUTES_SECRET` (GitHub › Settings › Secrets and variables › Actions).
3. Run the Action once by hand (Actions › Sky routes › Run workflow) with `base` set to the `commit` in
   AirReveal's `AirReveal/Resources/sky-routes-version.json`. After that it runs daily on its own.

GitHub pauses scheduled workflows in a public repository after 60 days without a commit; re-enable it under
Actions if that happens (the next run catches up on everything since).

Check the sync: `npx wrangler d1 execute airreveal-flights --remote --command "SELECT * FROM sky_sync"`

## Emergency-aircraft alerts

AirReveal can notify people when a police, air ambulance, coastguard or rescue, or firefighting aircraft comes
near them, even with the app closed (`src/alerts.js`). The app subscribes with `PUT /v1/alerts`
(`{ token, environment, latitude, longitude, radiusKm, services, units }`, the location rounded to about a
kilometre) and unsubscribes with `DELETE /v1/alerts` (`{ token }`).

Every minute, while anyone is subscribed, the cron asks ADSB.lol for the ~2,800 known emergency aircraft
(`src/emergency-aircraft.json`, from plane-alert-db, built by AirReveal's `Scripts/generate_special_aircraft.py
--worker …`) and for the squawks the UK and Germany use for air ambulances and police, one request a second, and
pushes to each subscriber within their distance, at most once per aircraft in 30 minutes. Military aircraft are
alerted by the app itself while it's open: ADSB.lol's worldwide military list is too big to read every minute on
the free plan. Subscriptions are deleted when alerts are turned off, when Apple says a token is gone, or after 30
days without an update.

**Setting it up (once):** in the Apple Developer account, Certificates, Identifiers & Profiles › Keys, create a key
with Apple Push Notifications service (APNs), download the `.p8` and note its Key ID. Then:
`npx wrangler secret put APNS_KEY` (paste the whole `.p8`, BEGIN and END lines included) and
`npx wrangler secret put APNS_KEY_ID`. `APNS_TEAM_ID` and `APNS_TOPIC` (the app's bundle ID) are in
`wrangler.toml`. Run `npm run db:remote` for the tables, then `npm run deploy`. Until the key is set the cron finds
the aircraft but sends nothing.

ADSB.lol's rate limits are dynamic, and it asks to be told about production use; a refused request is skipped and
tried again the next minute.

## Staying inside the trial

- **Cache:** found routes are kept for 14 days, not-found for 1 day, so a repeat lookup never reaches SkyLink.
- **Monthly cap:** `MONTHLY_CAP` (1,000, the whole trial) calls to SkyLink per calendar month (UTC), counted in
  the `usage` table before each call is made; after that it answers `paused` until the 1st. SkyLink charges $0.007
  a request over the trial's 1,000, so lower the cap if anything else uses the same key.
- **What's left:** `GET /v1/usage` answers `{ "month": "2026-10", "used": 258, "limit": 1000, "remaining": 742,
  "resetsAt": "2026-11-01T00:00:00.000Z" }` without spending anything, and every route and status answer carries
  `X-SkyLink-Remaining` and `X-SkyLink-Limit`. The app shows the count in Profile's tester section and switches
  Look Up Flight and status off when none are left, until the 1st.
- **Per person:** `DAILY_LIMIT` (40) lookups that reach SkyLink per day, keyed by an HMAC of IP + date; no IP
  address is stored. A daily cron clears old rate rows and expired cache entries.

Check this month's usage:
`npx wrangler d1 execute airreveal-flights --remote --command "SELECT * FROM usage"`

## Secrets (set with `npx wrangler secret put <NAME>`)

| Name | What |
| --- | --- |
| `SKYLINK_API_KEY` | The SkyLink licence key (sent as `x-api-key`). Paste it at the prompt; never commit it. |
| `HASH_SECRET` | 32+ random characters for the rate-limit hash. Already set. |
| `APNS_KEY` | The APNs `.p8` key, for emergency-aircraft alerts. |
| `APNS_KEY_ID` | That key's Key ID. |
| `SKY_ROUTES_SECRET` | Lets the GitHub Action post route changes; the same value is the repository's Actions secret. |

## Develop and deploy

```
npm install
npm test                                  # unit tests for callsign, response and route-update handling
npm run db:local && npm run dev           # local Worker on http://127.0.0.1:8788 (needs .dev.vars with the secrets)
npm run deploy
```

`src/airport-codes.json` (ICAO → IATA, from OurAirports) is made by `python3 tools/make_airport_codes.py`.
