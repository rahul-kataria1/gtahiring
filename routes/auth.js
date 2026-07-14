const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { sendWelcomeEmail, sendVerificationEmail } = require('../utils/emails');
const { issueVerificationToken } = require('../utils/emailVerification');

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
  res.render('register', { title: 'Create account', error: null, form: {}, sent: false });
});

router.post('/register', (req, res) => {
  const { name, email, password, role, company_name, phone } = req.body;

  if (!name || !email || !password || !['seeker', 'employer'].includes(role)) {
    return res.render('register', {
      title: 'Create account',
      error: 'Please fill in all required fields.',
      form: req.body,
      sent: false,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.render('register', {
      title: 'Create account',
      error: 'An account with that email already exists.',
      form: req.body,
      sent: false,
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      'INSERT INTO users (name, email, password, role, company_name, phone, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)'
    )
    .run(name, email, hash, role, role === 'employer' ? company_name || name : null, phone ? phone.trim() : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = issueVerificationToken(user.id);

  sendVerificationEmail({ to: user.email, name: user.name, token });

  res.render('register', { title: 'Check your email', error: null, form: {}, sent: true, sentEmail: user.email });
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('login', { title: 'Log in', error: null, unverified: false, email: '' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { title: 'Log in', error: 'Incorrect email or password.', unverified: false, email: '' });
  }
  if (user.status === 'blocked') {
    return res.render('login', {
      title: 'Log in',
      error: 'This account has been blocked. Contact the site admin.',
      unverified: false,
      email: '',
    });
  }
  if (!user.email_verified) {
    return res.render('login', {
      title: 'Log in',
      error: 'Please verify your email before logging in.',
      unverified: true,
      email: user.email,
    });
  }

  req.session.user = { id: user.id, name: user.name, role: user.role, avatar: user.avatar || null };
  res.redirect('/dashboard');
});

// ── Email verification ──────────────────────────────────────────────────────
router.get('/verify-email', (req, res) => {
  const token = req.query.token || '';
  const user = token ? db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token) : null;

  if (!user) {
    return res.render('verify-email', { title: 'Verify email', status: 'invalid', email: '' });
  }
  if (new Date(user.verification_token_expires) < new Date()) {
    return res.render('verify-email', { title: 'Verify email', status: 'expired', email: user.email });
  }

  db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?')
    .run(user.id);
  sendWelcomeEmail({ to: user.email, name: user.name, role: user.role });

  req.session.user = { id: user.id, name: user.name, role: user.role, avatar: user.avatar || null };
  res.render('verify-email', { title: 'Email verified', status: 'success', email: user.email });
});

router.post('/resend-verification', (req, res) => {
  const email = (req.body.email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Always show the same message whether or not the account exists, so this
  // can't be used to probe which emails are registered.
  if (user && !user.email_verified) {
    const token = issueVerificationToken(user.id);
    sendVerificationEmail({ to: user.email, name: user.name, token });
  }

  res.render('register', { title: 'Check your email', error: null, form: {}, sent: true, sentEmail: email });
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

// ── Notification bell ──────────────────────────────────────────────────────
router.get('/notifications/:id/open', requireAuth, (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!n) return res.redirect('/dashboard');
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(n.id);
  res.redirect(n.url || '/dashboard');
});

router.post('/notifications/mark-all-read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.redirect(req.get('Referer') || '/dashboard');
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

  const currentUser = db.prepare('SELECT role, email FROM users WHERE id = ?').get(userId);
  const newEmail = email.trim().toLowerCase();
  const emailChanged = newEmail !== currentUser.email.toLowerCase();

  try {
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

  if (emailChanged) {
    db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(userId);
    const token = issueVerificationToken(userId);
    sendVerificationEmail({ to: newEmail, name: name.trim(), token });
    return req.session.destroy(() => {
      res.locals.currentUser = null;
      res.render('register', {
        title: 'Check your email',
        error: null,
        form: {},
        sent: true,
        sentEmail: newEmail,
      });
    });
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
