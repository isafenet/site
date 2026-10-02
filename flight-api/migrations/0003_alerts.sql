-- Emergency-aircraft alerts (src/alerts.js): who wants them, and which they've had.
-- A subscription: the push token, the location rounded to about a kilometre and its one-degree cell, the
-- distance, the services ("police,ambulance") and the units ("mi" or "km"). Deleted when alerts are turned
-- off, when Apple says the token is gone, or after 30 days without an update.
CREATE TABLE alert_subscribers (
  token TEXT PRIMARY KEY, environment TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
  cell TEXT NOT NULL, radius_km REAL NOT NULL, services TEXT NOT NULL, units TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX alert_subscribers_cell ON alert_subscribers (cell);
-- One aircraft is alerted to one phone at most once in 30 minutes; kept a day.
CREATE TABLE alert_sent (token TEXT NOT NULL, hex TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (token, hex));
-- The APNs provider token, reused for 40 minutes (Apple refuses refreshes more often than every 20).
CREATE TABLE apns_token (id INTEGER PRIMARY KEY CHECK (id = 1), jwt TEXT NOT NULL, issued_at INTEGER NOT NULL);
