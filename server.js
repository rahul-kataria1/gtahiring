require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// Write any startup crash to a readable log file
const CRASH_LOG = path.join(__dirname, 'startup-error.log');
process.on('uncaughtException', (err) => {
  fs.appendFileSync(CRASH_LOG, `\n[${new Date().toISOString()}]\n${err.stack}\ncwd: ${process.cwd()}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  fs.appendFileSync(CRASH_LOG, `\n[${new Date().toISOString()}] unhandledRejection\n${err}\ncwd: ${process.cwd()}\n`);
});

const db = require('./db/db');
const { attachUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const employerRoutes = require('./routes/employer');
const seekerRoutes = require('./routes/seeker');
const adminRoutes = require('./routes/admin');
const blogRoutes = require('./routes/blog');
const pagesRoutes = require('./routes/pages');
const stripeWebhookRoutes = require('./routes/stripeWebhook');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Stripe webhook needs the raw, unparsed body to verify its signature, so it
// must be mounted before the general urlencoded body parser below.
app.use('/stripe', stripeWebhookRoutes);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);

app.use(attachUser);

// Cache-busting query param for /css and /js assets — changes on every deploy
// (this process boots fresh each time) so browsers can't serve a stale style.css
// after a CSS-only change, without needing per-file hashing.
const ASSET_VERSION = Date.now();
app.use((req, res, next) => {
  res.locals.assetVersion = ASSET_VERSION;
  next();
});

// Make logo availability visible to every view
const LOGO_PATH = path.join(__dirname, 'public/images/logo.png');
app.use((req, res, next) => {
  res.locals.siteLogoExists = fs.existsSync(LOGO_PATH);
  next();
});

// Make the AdSense on/off setting visible to every view
app.use((req, res, next) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ads_enabled'").get();
  res.locals.adsEnabled = row ? row.value === '1' : true;
  next();
});

// Make the logged-in user's notification bell contents visible to every view
app.use((req, res, next) => {
  if (req.session.user) {
    res.locals.notifications = db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(req.session.user.id);
    res.locals.unreadNotificationsCount = db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0'
    ).get(req.session.user.id).c;
  } else {
    res.locals.notifications = [];
    res.locals.unreadNotificationsCount = 0;
  }
  next();
});

app.use('/', authRoutes);
app.use('/', jobRoutes);
app.use('/employer', employerRoutes);
app.use('/seeker', seekerRoutes);
app.use('/admin', adminRoutes);
app.use('/', blogRoutes);
app.use('/', pagesRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: "That page doesn't exist." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Job board running at http://localhost:${PORT}`);
});
