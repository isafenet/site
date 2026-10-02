-- Changes to Virtual Radar Server's standing-data routes (CC0) since the copy AirReveal bundles, so the app
-- can stay current between releases. Filled by the daily GitHub Action (tools/sync_sky_routes.py).
-- One row per callsign, holding its latest airports ("EGLL-KJFK"; "" when the route was removed) and the
-- standing-data commit time (Unix seconds) of that change.
CREATE TABLE sky_routes (callsign TEXT PRIMARY KEY, airports TEXT NOT NULL, changed_at INTEGER NOT NULL);
CREATE INDEX sky_routes_changed ON sky_routes (changed_at);
-- Airports the changed routes use, so the app can place an airport its bundled copy doesn't have.
CREATE TABLE sky_airports (
  icao TEXT PRIMARY KEY, iata TEXT, city TEXT NOT NULL,
  latitude REAL NOT NULL, longitude REAL NOT NULL, changed_at INTEGER NOT NULL
);
-- The standing-data commit the table is up to date with (a single row).
CREATE TABLE sky_sync (id INTEGER PRIMARY KEY CHECK (id = 1), commit_sha TEXT NOT NULL, committed_at INTEGER NOT NULL);
