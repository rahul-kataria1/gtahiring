-- Users: job seekers, employers and the super admin all live in one table,
-- distinguished by `role`.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password      TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('seeker', 'employer', 'admin')),
  company_name  TEXT,                 -- only used for employers
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jobs are posted by employers and must be approved by the admin before
-- they show up in public listings.
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  company       TEXT NOT NULL,
  location      TEXT NOT NULL,
  job_type      TEXT NOT NULL DEFAULT 'Full-time',
  salary        TEXT,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Blog posts written by admin and published to the public.
CREATE TABLE IF NOT EXISTS blog_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL,
  published   INTEGER NOT NULL DEFAULT 0,  -- 0 = draft, 1 = published
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Applications link a job seeker to a job they applied for.
CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seeker_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_note    TEXT,
  status        TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reviewed', 'accepted', 'rejected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, seeker_id)
);
