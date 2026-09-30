-- Cached SkyLink answers, keyed by "route:<callsign>".
CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, expires TEXT NOT NULL);
-- Calls made to SkyLink per calendar month (UTC), for the hard monthly cap.
CREATE TABLE usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL);
-- Lookups per person per day: `who` is an HMAC of IP + date, never the IP itself.
CREATE TABLE rate (who TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (who, day));
