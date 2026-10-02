-- The launch list: people who asked to be emailed when an app's next version is out (a sneak peek page's
-- form). Only the address, the app, when, and the wording they agreed to. Cleared for an app once its
-- launch email has gone out (POST /api/admin/launch-list/clear).
CREATE TABLE launch_list (
  app        TEXT NOT NULL,
  email      TEXT NOT NULL,
  consent    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app, email)
);
