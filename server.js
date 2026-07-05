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

const { attachUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const employerRoutes = require('./routes/employer');
const seekerRoutes = require('./routes/seeker');
const adminRoutes = require('./routes/admin');
const blogRoutes = require('./routes/blog');
const pagesRoutes = require('./routes/pages');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

// Make logo availability visible to every view
const LOGO_PATH = path.join(__dirname, 'public/images/logo.png');
app.use((req, res, next) => {
  res.locals.siteLogoExists = fs.existsSync(LOGO_PATH);
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
