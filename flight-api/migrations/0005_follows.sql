-- Landing notifications for a plane followed in AirReveal (src/follows.js): one followed plane per phone.
-- The push token, the aircraft's ICAO address, its callsign or registration for the message, where it's
-- going when the app knows, and what it was last doing (to tell a landing from flying out of coverage).
-- Deleted when it lands (after the push), when the person stops following, when Apple says the token is
-- gone, or 24 hours after it was followed.
CREATE TABLE follows (
  token TEXT PRIMARY KEY, environment TEXT NOT NULL, hex TEXT NOT NULL, label TEXT NOT NULL, destination TEXT,
  last_alt INTEGER, last_rate INTEGER, last_seen_at INTEGER, created_at INTEGER NOT NULL
);
