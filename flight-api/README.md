# AirReveal flight lookup

A Cloudflare Worker (with a D1 database) between AirReveal and [SkyLink API](https://skylinkapi.com/docs/).
SkyLink's terms don't allow its key in an app binary ("a mobile app binary, browser JavaScript, or a public
repository"), so the key is a Worker secret and the app only ever talks to this Worker.

**TestFlight only for now.** AirReveal is on SkyLink's free trial (1,000 requests a month), so the app shows
Look Up Flight only in TestFlight and Xcode builds. Before it goes into an App Store release, move to a paid
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

Errors are `{ "error": code, "message": text }`: `invalid` (422), `limit` (429, the per-person daily limit),
`paused` (503, the monthly cap is reached), `upstream` (502).

## Staying inside the trial

- **Cache:** found routes are kept for 14 days, not-found for 1 day, so a repeat lookup never reaches SkyLink.
- **Monthly cap:** `MONTHLY_CAP` (900) calls to SkyLink per calendar month (UTC), counted in the `usage` table;
  after that it answers `paused` until the 1st. SkyLink charges $0.007 a request over the trial's 1,000.
- **Per person:** `DAILY_LIMIT` (40) lookups that reach SkyLink per day, keyed by an HMAC of IP + date; no IP
  address is stored. A daily cron clears old rate rows and expired cache entries.

Check this month's usage:
`npx wrangler d1 execute airreveal-flights --remote --command "SELECT * FROM usage"`

## Secrets (set with `npx wrangler secret put <NAME>`)

| Name | What |
| --- | --- |
| `SKYLINK_API_KEY` | The SkyLink licence key (sent as `x-api-key`). Paste it at the prompt; never commit it. |
| `HASH_SECRET` | 32+ random characters for the rate-limit hash. Already set. |

## Develop and deploy

```
npm install
npm test                                  # unit tests for callsign and response handling
npm run db:local && npm run dev           # local Worker on http://127.0.0.1:8788 (needs .dev.vars with the secrets)
npm run deploy
```

`src/airport-codes.json` (ICAO → IATA, from OurAirports) is made by `python3 tools/make_airport_codes.py`.
