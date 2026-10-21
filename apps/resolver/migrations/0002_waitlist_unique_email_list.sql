-- One sign-up per address per list: UNIQUE (email, list). The same address may be on "updates" and on "pilot",
-- never on one of them twice. SQLite cannot change a constraint in place, so the table is rebuilt (rows kept).
CREATE TABLE waitlist_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  list TEXT NOT NULL DEFAULT 'updates',
  created_at TEXT NOT NULL,
  UNIQUE (email, list)
);
INSERT INTO waitlist_new (email, list, created_at) SELECT email, list, created_at FROM waitlist;
DROP TABLE waitlist;
ALTER TABLE waitlist_new RENAME TO waitlist;
