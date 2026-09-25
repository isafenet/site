# iSafeNet feedback board API

The backend for https://isafenet.app/feedback.html: a Cloudflare Worker with a D1 (SQLite) database, both on
Cloudflare's free plan. The board page itself is static (`feedback.html`, `assets/feedback.js`,
`assets/feedback.css`) and served by GitHub Pages with the rest of the site.

- **No accounts, no emails, no IP addresses stored.** Votes are keyed by an HMAC of a random ID the browser
  keeps; daily rate limits by an HMAC of IP + date, deleted by a daily cron.
- **Everything is reviewed before it's public.** New ideas and comments wait in the admin queue, which
  flags text that looks like someone's own health or contact details (`assets/feedback-personal.js`,
  shared by the page and the API).
- **Spam:** Cloudflare Turnstile on posting; it loads only when someone opens a form.
- **Admin:** `https://<worker>/admin`, signed in with the admin key (a Worker secret).

## Secrets (set with `npx wrangler secret put <NAME>`)

| Name | What |
| --- | --- |
| `ADMIN_TOKEN` | The admin key: 32+ random characters. Keep it in your password manager. |
| `HASH_SECRET` | 32+ random characters for the voter and rate-limit hashes. Never change it: votes would stop matching. |
| `TURNSTILE_SECRET` | The Turnstile widget's secret key (Cloudflare dashboard → Turnstile). |

## Local development

```
npm install
npm run db:local          # create the local database
npm run dev               # API on http://127.0.0.1:8787, admin at /admin
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root: http://localhost:8000/feedback.html
npm test                  # unit tests + end-to-end API tests against the running dev server
```

`.dev.vars` (git-ignored) holds local secrets and Cloudflare's always-pass Turnstile test secret; the page uses
the matching test site key on localhost.

## Deploy

```
npx wrangler login
npx wrangler d1 create isafenet-feedback   # once; put the database_id in wrangler.toml
npm run db:remote                          # apply migrations/ to the live database
npm run deploy
```

Then set `data-api` and `data-sitekey` on `#board` in `feedback.html` (and the feed link in its `<head>`).

## Changing the schema

Add a new numbered file to `migrations/`, never edit an applied one, then `npm run db:local` / `npm run db:remote`.
