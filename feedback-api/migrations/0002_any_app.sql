-- Apps now come from apps/*.json (via assets/feedback-apps.js) and the API checks them, so the database no
-- longer hard-codes the list: adding an app needs no migration.
--
-- SQLite can't drop a CHECK, so the ideas table is rebuilt. Dropping it directly would run an implicit
-- DELETE that cascades to votes, comments and events, so all four tables are rebuilt: the new child tables
-- point at ideas_new, the old ones are dropped leaves-first (nothing left to cascade to), and the renames
-- carry the references across.
PRAGMA defer_foreign_keys = true;

CREATE TABLE ideas_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  app          TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL DEFAULT '',
  why          TEXT    NOT NULL DEFAULT '',
  author       TEXT    NOT NULL DEFAULT '',
  by_team      INTEGER NOT NULL DEFAULT 0,
  state        TEXT    NOT NULL DEFAULT 'pending'
               CHECK (state IN ('pending', 'published', 'rejected', 'merged')),
  status       TEXT    NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'considering', 'planned', 'started', 'shipped', 'declined')),
  note         TEXT    NOT NULL DEFAULT '',
  version      TEXT    NOT NULL DEFAULT '',
  merged_into  INTEGER REFERENCES ideas_new(id),
  votes        INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  published_at TEXT,
  updated_at   TEXT    NOT NULL
);
CREATE TABLE votes_new (
  idea_id    INTEGER NOT NULL REFERENCES ideas_new(id) ON DELETE CASCADE,
  voter      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (idea_id, voter)
);
CREATE TABLE comments_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas_new(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL DEFAULT '',
  by_team    INTEGER NOT NULL DEFAULT 0,
  state      TEXT    NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'rejected')),
  created_at TEXT    NOT NULL
);
CREATE TABLE events_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas_new(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  version    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

INSERT INTO ideas_new SELECT * FROM ideas;
INSERT INTO votes_new SELECT * FROM votes;
INSERT INTO comments_new SELECT * FROM comments;
INSERT INTO events_new SELECT * FROM events;

DROP TABLE votes;
DROP TABLE comments;
DROP TABLE events;
DROP TABLE ideas;

ALTER TABLE ideas_new RENAME TO ideas;
ALTER TABLE votes_new RENAME TO votes;
ALTER TABLE comments_new RENAME TO comments;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX ideas_state ON ideas (state, votes DESC);
CREATE INDEX votes_voter ON votes (voter);
CREATE INDEX votes_recent ON votes (idea_id, created_at);
CREATE INDEX comments_idea ON comments (idea_id, state);
CREATE INDEX events_idea ON events (idea_id, created_at);
