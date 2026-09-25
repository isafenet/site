-- iSafeNet feedback board. No accounts, no emails, no IP addresses stored.
-- "state" is moderation (only 'published' is ever public); "status" is the roadmap stage.

CREATE TABLE ideas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  app          TEXT    NOT NULL CHECK (app IN ('airreveal', 'glpmgr', 'udapt', 'general')),
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
  merged_into  INTEGER REFERENCES ideas(id),
  votes        INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  published_at TEXT,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX ideas_state ON ideas (state, votes DESC);

-- voter = HMAC of a random ID kept in the voter's browser; never linkable to a person.
CREATE TABLE votes (
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  voter      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (idea_id, voter)
);
CREATE INDEX votes_voter ON votes (voter);
CREATE INDEX votes_recent ON votes (idea_id, created_at);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL DEFAULT '',
  by_team    INTEGER NOT NULL DEFAULT 0,
  state      TEXT    NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'rejected')),
  created_at TEXT    NOT NULL
);
CREATE INDEX comments_idea ON comments (idea_id, state);

-- Public history of each idea's status: the timeline on its page and the Atom feed.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  version    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX events_idea ON events (idea_id, created_at);

-- Daily rate limits. key = action + HMAC(ip + date), so it can't be traced back or across days.
CREATE TABLE rate (
  key   TEXT    PRIMARY KEY,
  day   TEXT    NOT NULL,
  count INTEGER NOT NULL
);
