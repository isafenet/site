-- The APNs provider token per environment: sandbox and production use separate keys.
DROP TABLE apns_token;
CREATE TABLE apns_token (environment TEXT PRIMARY KEY, jwt TEXT NOT NULL, issued_at INTEGER NOT NULL);
