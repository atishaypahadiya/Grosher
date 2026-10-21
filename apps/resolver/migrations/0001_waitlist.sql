-- The project page's "Get notified" list (src/waitlist.ts): an address, which list, when. Nothing else is kept.
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  list TEXT NOT NULL DEFAULT 'updates',
  created_at TEXT NOT NULL
);
