const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../utils/emails');

const router = express.Router();

// ── Avatar upload setup ───────────────────────────────────────────────────────
const AVATAR_DIR = path.join(__dirname, '../public/uploads/avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `avatar-${req.session.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const ext  = path.extname(file.originalname).toLowerCase();
    const okMime = /^image\/(jpeg|png|gif|webp|heic|heif)$/.test(mime);
    const okExt  = ['.jpg','.jpeg','.png','.gif','.webp','.heic','.heif'].includes(ext);
    if (okMime || okExt) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, WebP or HEIC images are allowed.'));
  },
});

// ── Register ──────────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  res.render('register', { title: 'Create account', error: null, form: {} });
});

router.post('/register', (req, res) => {
  const { name, email, password, role, company_name } = req.body;

  if (!name || !email || !password || !['seeker', 'employer'].includes(role)) {
    return res.render('register', {
      title: 'Create account',
      error: 'Please fill in all required fields.',
      form: req.body,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.render('register', {
      title: 'Create account',
      error: 'An account with that email already exists.',
      form: req.body,
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      'INSERT INTO users (name, email, password, role, company_name) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, email, hash, role, role === 'employer' ? company_name || name : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.user = { id: user.id, name: user.name, role: user.role, avatar: user.avatar || null };

  sendWelcomeEmail({ to: user.email, name: user.name, role: user.role });

  res.redirect('/dashboard');
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('login', { title: 'Log in', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { title: 'Log in', error: 'Incorrect email or password.' });
  }
  if (user.status === 'blocked') {
    return res.render('login', {
      title: 'Log in',
      error: 'This account has been blocked. Contact the site admin.',
    });
  }

  req.session.user = { id: user.id, name: user.name, role: user.role, avatar: user.avatar || null };
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── Push notification device token registration (iOS app) ────────────────────
router.post('/push/register-token', requireAuth, (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  db.prepare('INSERT OR IGNORE INTO push_tokens (user_id, token, platform) VALUES (?, ?, ?)')
    .run(req.session.user.id, token, platform || 'ios');
  res.json({ ok: true });
});

// ── Dashboard redirect ────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'seeker') return res.redirect('/seeker/dashboard');
  if (user.role === 'employer') return res.redirect('/employer/dashboard');
  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  res.redirect('/');
});

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/profile', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('profile', {
    title: 'My profile',
    user,
    success: req.query.success === '1',
    error: req.query.error ? decodeURIComponent(req.query.error) : null,
  });
});

router.post('/profile', requireAuth, (req, res) => {
  const { name, email, company_name, phone, address, city, province, postal_code, new_password, confirm_password } = req.body;
  const userId = req.session.user.id;

  if (!name || !email) {
    return res.redirect('/profile?error=' + encodeURIComponent('Name and email are required.'));
  }

  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
  if (taken) {
    return res.redirect('/profile?error=' + encodeURIComponent('That email is already in use by another account.'));
  }

  let passwordClause = '';
  const params = [
    name.trim(),
    email.trim().toLowerCase(),
    phone       ? phone.trim()       : null,
    address     ? address.trim()     : null,
    city        ? city.trim()        : null,
    province    ? province.trim()    : null,
    postal_code ? postal_code.trim().toUpperCase() : null,
  ];

  if (new_password) {
    if (new_password !== confirm_password) {
      return res.redirect('/profile?error=' + encodeURIComponent('Passwords do not match.'));
    }
    if (new_password.length < 6) {
      return res.redirect('/profile?error=' + encodeURIComponent('Password must be at least 6 characters.'));
    }
    passwordClause = ', password = ?';
    params.push(bcrypt.hashSync(new_password, 10));
  }

  try {
    const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (currentUser.role === 'employer') {
      params.push(company_name ? company_name.trim() : null);
      params.push(userId);
      db.prepare(
        `UPDATE users SET name=?, email=?, phone=?, address=?, city=?, province=?, postal_code=?${passwordClause}, company_name=? WHERE id=?`
      ).run(...params);
    } else {
      params.push(userId);
      db.prepare(
        `UPDATE users SET name=?, email=?, phone=?, address=?, city=?, province=?, postal_code=?${passwordClause} WHERE id=?`
      ).run(...params);
    }
  } catch (dbErr) {
    return res.redirect('/profile?error=' + encodeURIComponent('Could not save profile. Please restart the server and try again.'));
  }

  req.session.user = { ...req.session.user, name: name.trim() };
  res.redirect('/profile?success=1');
});

// ── Avatar upload ─────────────────────────────────────────────────────────────
router.post('/profile/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.redirect('/profile?error=' + encodeURIComponent(err.message));
    }
    if (!req.file) {
      return res.redirect('/profile?error=' + encodeURIComponent('Please select an image file.'));
    }

    const userId = req.session.user.id;

    // Delete old avatar file if present
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
    if (old && old.avatar) {
      const oldPath = path.join(AVATAR_DIR, old.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, userId);
    req.session.user = { ...req.session.user, avatar: req.file.filename };

    res.redirect('/profile?success=1');
  });
});

module.exports = router;
