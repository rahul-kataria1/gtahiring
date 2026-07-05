# JobBoard

A simple job posting website with three roles:

- **Job seeker** — browses approved jobs and applies
- **Employer** — posts jobs (held for admin approval) and reviews applicants
- **Super admin** — approves/rejects/deletes jobs, manages (blocks/deletes) seeker and employer accounts

## Stack

Node.js + Express, server-rendered EJS views, SQLite (via `better-sqlite3`) — one file database, no separate database server to install. Sessions via `express-session`, passwords hashed with `bcryptjs`.

## Project structure

```
job-board/
  server.js          entry point
  db/
    schema.sql       table definitions
    db.js            opens jobboard.db and applies schema.sql on every start
    seed.js          one-time script to create the first admin account
  middleware/auth.js  login/role-check middleware
  routes/             auth.js, jobs.js (public), employer.js, seeker.js, admin.js
  views/              EJS templates
  public/css/style.css
```

## Setup

```bash
cd job-board
npm install
cp .env.example .env     # then edit .env (set a real SESSION_SECRET, admin credentials)
npm run seed              # creates the super admin account from .env
npm start                  # starts the server
```

Visit `http://localhost:3000`. Log in as admin with the email/password you set in `.env`.

The database is a single file at `db/jobboard.db`, created automatically the first time you run the app.

## How the roles work

- **Sign up** at `/register` as either a job seeker or an employer. There's no public sign-up for admin — the only admin account is the one created by `npm run seed`.
- **Employers** post jobs from "Post a job". New jobs start as `pending` and are invisible to job seekers until the admin approves them.
- **Admin** reviews pending jobs at `/admin/jobs` and can approve, reject, or delete any job. The admin can also block or delete seeker/employer accounts at `/admin/users`. Blocked users can't log in.
- **Job seekers** browse approved jobs at `/` and apply with an optional cover note. Their applications and statuses are listed at `/seeker/dashboard`.
- **Employers** track applicants per job and can mark each as Applied / Reviewed / Accepted / Rejected.

## Deploying

This app is a normal Node process — any host that runs Node.js works (a VPS, Render, Railway, etc.):

1. Copy the project to the server (or push to a Git repo and deploy from there).
2. `npm install --production`
3. Set environment variables (`PORT`, `SESSION_SECRET`, and the `ADMIN_*` vars for seeding) — most hosts let you set these in a dashboard instead of a `.env` file.
4. `npm run seed` once, to create the admin account.
5. Run with `npm start`, ideally behind a process manager such as `pm2` so it restarts automatically, e.g. `pm2 start server.js --name jobboard`.
6. Put it behind a reverse proxy (Nginx/Caddy) for HTTPS and to serve on port 80/443.

### Notes for production use

- This uses Express's default in-memory session store, which is fine for one server process but resets on restart and won't share sessions across multiple instances. For real multi-instance deployments, swap in a store like `connect-sqlite3` or Redis — the app code doesn't need to change beyond the `session()` config in `server.js`.
- SQLite stores everything in `db/jobboard.db`. Back that file up regularly. If you outgrow SQLite, the SQL in `db/schema.sql` translates directly to MySQL/Postgres with minor type tweaks.
- Change the default admin password (set in `.env` before seeding) immediately on a real deployment.
