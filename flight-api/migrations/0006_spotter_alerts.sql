-- Spotter alerts (src/spotter.js, AirReveal 2.1): a push when an aircraft type someone watches for (an A380,
-- a 747, the Beluga) comes near. A subscription: the push token, the location rounded to about a kilometre and
-- its one-degree cell, the distance, the type codes ("A388,B748") and the units. Deleted when spotter alerts
-- are turned off, when Apple says the token is gone, or after 30 days without an update.
CREATE TABLE spotter_subscribers (
  token TEXT PRIMARY KEY, environment TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
  cell TEXT NOT NULL, radius_km REAL NOT NULL, types TEXT NOT NULL, units TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX spotter_subscribers_cell ON spotter_subscribers (cell);
-- One aircraft is alerted to one phone at most once in 3 hours; kept a day.
CREATE TABLE spotter_sent (token TEXT NOT NULL, hex TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (token, hex));
