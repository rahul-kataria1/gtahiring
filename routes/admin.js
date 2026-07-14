const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireRole } = require('../middleware/auth');
const { notifyEmployerJobStatus, sendVerificationEmail } = require('../utils/emails');
const { sendPushNotification, isPushConfigured } = require('../utils/push');
const { notifyUser, notifyAdmins } = require('../utils/notifications');
const { issueVerificationToken } = require('../utils/emailVerification');

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../public/uploads/blog'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images are allowed'));
  },
});

const LOGO_PATH = path.join(__dirname, '../public/images/logo.png');
const FAVICON_PNG_PATH = path.join(__dirname, '../public/images/favicon.png');
const FAVICON_ICO_PATH = path.join(__dirname, '../public/images/favicon.ico');
const BLOG_UPLOAD_DIR = path.join(__dirname, '../public/uploads/blog');

const featuredImageUpload = multer({
  storage: multer.diskStorage({
    destination: BLOG_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `feat-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images are allowed'));
  },
});

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../public/images'),
    filename: (req, file, cb) => cb(null, 'logo.png'),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, WebP, or SVG images are allowed'));
  },
});

const faviconUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../public/images'),
    filename: (req, file, cb) => {
      const isIco = /^image\/(x-icon|vnd\.microsoft\.icon)$/.test(file.mimetype);
      // Remove the other format so a stale file never lingers
      const other = path.join(__dirname, '../public/images', isIco ? 'favicon.png' : 'favicon.ico');
      if (fs.existsSync(other)) fs.unlinkSync(other);
      cb(null, isIco ? 'favicon.ico' : 'favicon.png');
    },
  }),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|x-icon|vnd\.microsoft\.icon)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG or ICO images are allowed'));
  },
});

const router = express.Router();
router.use(requireRole('admin'));

router.use((req, res, next) => {
  res.locals.unreadMessageCount = db.prepare('SELECT COUNT(*) as c FROM contact_messages WHERE read = 0').get().c;
  res.locals.unreadReportsCount = db.prepare('SELECT COUNT(*) as c FROM reports WHERE admin_unread = 1').get().c;
  next();
});

router.get('/dashboard', (req, res) => {
  const stats = {
    jobSeekers:        db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'seeker'").get().c,
    employers:         db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'employer'").get().c,
    pendingJobs:       db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'").get().c,
    approvedJobs:      db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'approved'").get().c,
    rejectedJobs:      db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'rejected'").get().c,
    totalApplications: db.prepare('SELECT COUNT(*) as c FROM applications').get().c,
    blockedUsers:      db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'blocked'").get().c,
    publishedPosts:    db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE published = 1").get().c,
    draftPosts:        db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE published = 0").get().c,
    todaySignups:      db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) = date('now')").get().c,
    weekApplications:  db.prepare("SELECT COUNT(*) as c FROM applications WHERE created_at >= datetime('now', '-7 days')").get().c,
    acceptedApps:      db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'accepted'").get().c,
  };

  const recentJobs = db.prepare(`
    SELECT j.*, u.name as employer_name
    FROM jobs j JOIN users u ON u.id = j.employer_id
    ORDER BY j.created_at DESC LIMIT 6
  `).all();

  const recentApplications = db.prepare(`
    SELECT a.*, j.title as job_title, u.name as seeker_name
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    JOIN users u ON u.id = a.seeker_id
    ORDER BY a.created_at DESC LIMIT 6
  `).all();

  const recentUsers = db.prepare(`
    SELECT * FROM users WHERE role != 'admin' ORDER BY created_at DESC LIMIT 6
  `).all();

  const recentPosts = db.prepare(`
    SELECT bp.*, u.name as author_name FROM blog_posts bp
    JOIN users u ON u.id = bp.author_id
    ORDER BY bp.created_at DESC LIMIT 4
  `).all();

  res.render('admin/dashboard', { title: 'Admin overview', stats, recentJobs, recentApplications, recentUsers, recentPosts });
});

router.get('/jobs/:id', (req, res) => {
  const job = db.prepare(`SELECT j.*, u.name as employer_name, u.email as employer_email
    FROM jobs j JOIN users u ON u.id = j.employer_id WHERE j.id = ?`).get(req.params.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  const applicantCount = db.prepare('SELECT COUNT(*) as c FROM applications WHERE job_id = ?').get(job.id).c;
  res.render('admin/job-preview', { title: `Review: ${job.title}`, job, applicantCount });
});

router.get('/jobs', (req, res) => {
  const filter = req.query.status;
  let sql = `SELECT j.*, u.name as employer_name FROM jobs j JOIN users u ON u.id = j.employer_id`;
  const params = [];
  if (['pending', 'approved', 'rejected'].includes(filter)) {
    sql += ' WHERE j.status = ?';
    params.push(filter);
  }
  sql += ' ORDER BY j.created_at DESC';
  const jobs = db.prepare(sql).all(...params);
  res.render('admin/jobs', { title: 'Manage jobs', jobs, filter: filter || 'all' });
});

router.post('/jobs/:id/status', (req, res) => {
  const { status } = req.body;
  if (['pending', 'approved', 'rejected'].includes(status)) {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, req.params.id);

    // Notify employer when their job is approved or rejected
    if (status === 'approved' || status === 'rejected') {
      const job = db.prepare('SELECT j.*, u.name as employer_name, u.email as employer_email FROM jobs j JOIN users u ON u.id = j.employer_id WHERE j.id = ?').get(req.params.id);
      if (job) {
        notifyEmployerJobStatus({
          employerEmail: job.employer_email,
          employerName:  job.employer_name,
          jobTitle:      job.title,
          newStatus:     status,
          jobId:         job.id,
        });
        sendPushNotification(job.employer_id, {
          title: status === 'approved' ? 'Job posting approved' : 'Job posting rejected',
          body: `"${job.title}" was ${status} by the admin team.`,
        });
        notifyUser(job.employer_id, {
          title: status === 'approved' ? 'Job posting approved' : 'Job posting rejected',
          body: `"${job.title}" was ${status} by the admin team.`,
          url: `/jobs/${job.id}`,
        });
      }
    }
  }
  res.redirect('/admin/jobs');
});

router.post('/jobs/:id/toggle-active', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  db.prepare('UPDATE jobs SET active = ? WHERE id = ?').run(job.active ? 0 : 1, req.params.id);
  const filter = req.query.filter || '';
  res.redirect('/admin/jobs' + (filter ? '?status=' + filter : ''));
});

router.post('/jobs/:id/delete', (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.redirect('/admin/jobs');
});

router.get('/users', (req, res) => {
  const role = req.query.role;
  const q = (req.query.q || '').trim();

  let sql = "SELECT * FROM users WHERE role != 'admin'";
  const params = [];

  if (['seeker', 'employer'].includes(role)) {
    sql += ' AND role = ?';
    params.push(role);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  sql += ' ORDER BY created_at DESC';
  const users = db.prepare(sql).all(...params);
  res.render('admin/users', { title: 'Manage users', users, role: role || 'all', q });
});

function buildUsersRedirect(body) {
  if (body._redirect) return body._redirect;
  const parts = [];
  if (body._role && body._role !== 'all') parts.push(`role=${encodeURIComponent(body._role)}`);
  if (body._q) parts.push(`q=${encodeURIComponent(body._q)}`);
  return '/admin/users' + (parts.length ? '?' + parts.join('&') : '');
}

router.get('/users/:id', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(req.params.id);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

  let jobs = [], applications = [];
  if (user.role === 'employer') {
    jobs = db.prepare(`
      SELECT j.*, (SELECT COUNT(*) FROM applications WHERE job_id = j.id) AS app_count
      FROM jobs j WHERE j.employer_id = ? ORDER BY j.created_at DESC
    `).all(user.id);
  } else if (user.role === 'seeker') {
    applications = db.prepare(`
      SELECT a.*, j.title AS job_title, j.company, j.location
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.seeker_id = ? ORDER BY a.created_at DESC
    `).all(user.id);
  }

  res.render('admin/user-profile', {
    title: user.name,
    profileUser: user,
    jobs,
    applications,
    success: req.query.success === '1' ? req.query.msg || 'Done.' : null,
    error: req.query.error || null,
  });
});

router.post('/users/:id/profile', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(req.params.id);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

  const { name, email, role, company_name, phone, address, city, province, postal_code, new_password, confirm_password } = req.body;
  const redirectBase = `/admin/users/${user.id}`;

  if (!name || !name.trim() || !email || !email.trim()) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('Name and email are required.')}`);
  }

  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), user.id);
  if (taken) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('That email is already in use by another account.')}`);
  }

  const newRole = ['seeker', 'employer', 'admin'].includes(role) ? role : user.role;
  const newEmail = email.trim().toLowerCase();
  const emailChanged = newEmail !== user.email.toLowerCase();

  let passwordClause = '';
  const params = [
    name.trim(),
    email.trim().toLowerCase(),
    newRole,
    phone       ? phone.trim()       : null,
    address     ? address.trim()     : null,
    city        ? city.trim()        : null,
    province    ? province.trim()    : null,
    postal_code ? postal_code.trim().toUpperCase() : null,
  ];

  if (new_password) {
    if (new_password !== confirm_password) {
      return res.redirect(`${redirectBase}?error=${encodeURIComponent('Passwords do not match.')}`);
    }
    if (new_password.length < 6) {
      return res.redirect(`${redirectBase}?error=${encodeURIComponent('Password must be at least 6 characters.')}`);
    }
    passwordClause = ', password = ?';
    params.push(bcrypt.hashSync(new_password, 10));
  }

  try {
    if (newRole === 'employer') {
      params.push(company_name ? company_name.trim() : null, user.id);
      db.prepare(
        `UPDATE users SET name=?, email=?, role=?, phone=?, address=?, city=?, province=?, postal_code=?${passwordClause}, company_name=? WHERE id=?`
      ).run(...params);
    } else {
      params.push(user.id);
      db.prepare(
        `UPDATE users SET name=?, email=?, role=?, phone=?, address=?, city=?, province=?, postal_code=?${passwordClause} WHERE id=?`
      ).run(...params);
    }
  } catch (dbErr) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('Could not save profile.')}`);
  }

  let msg = 'Profile updated.';
  if (emailChanged) {
    db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(user.id);
    const token = issueVerificationToken(user.id);
    sendVerificationEmail({ to: newEmail, name: name.trim(), token });
    msg = 'Profile updated. The new email must be re-verified — a verification link was sent.';
  }

  res.redirect(`${redirectBase}?success=1&msg=${encodeURIComponent(msg)}`);
});

router.post('/users/:id/toggle-review', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employer'").get(req.params.id);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'Employer not found.' });
  db.prepare('UPDATE users SET require_review = ? WHERE id = ?').run(user.require_review === 0 ? 1 : 0, user.id);
  res.redirect(buildUsersRedirect(req.body) || `/admin/users?role=employer`);
});

router.post('/users/:id/status', (req, res) => {
  const { status } = req.body;
  if (['active', 'blocked'].includes(status)) {
    db.prepare("UPDATE users SET status = ? WHERE id = ? AND role != 'admin'").run(status, req.params.id);
  }
  res.redirect(buildUsersRedirect(req.body));
});

router.post('/users/:id/delete', (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role != 'admin'").run(req.params.id);
  res.redirect(buildUsersRedirect(req.body));
});

// Blog image upload (called by Quill editor)
router.post('/blog/upload-image', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/blog/${req.file.filename}` });
});

// Blog management
router.get('/blog', (req, res) => {
  const posts = db.prepare('SELECT * FROM blog_posts ORDER BY created_at DESC').all();
  res.render('admin/blog/index', { title: 'Manage blog', posts });
});

router.get('/blog/new', (req, res) => {
  res.render('admin/blog/form', { title: 'New post', post: null, error: null });
});

router.post('/blog/new', featuredImageUpload.single('featured_image'), (req, res) => {
  const { title, body, published } = req.body;
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const featured_image = req.file ? req.file.filename : null;
  try {
    db.prepare(
      'INSERT INTO blog_posts (author_id, title, slug, body, published, featured_image) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.session.user.id, title.trim(), slug, body.trim(), published === '1' ? 1 : 0, featured_image);
    res.redirect('/admin/blog');
  } catch (err) {
    if (req.file) fs.unlinkSync(path.join(BLOG_UPLOAD_DIR, req.file.filename));
    const msg = err.message.includes('UNIQUE') ? 'A post with that title already exists.' : 'Could not save post.';
    res.render('admin/blog/form', { title: 'New post', post: { title, body, published, featured_image: null }, error: msg });
  }
});

router.get('/blog/:id/edit', (req, res) => {
  const post = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).render('error', { title: 'Not found', message: 'Post not found.' });
  res.render('admin/blog/form', { title: 'Edit post', post, error: null });
});

router.post('/blog/:id/edit', featuredImageUpload.single('featured_image'), (req, res) => {
  const { title, body, published, remove_featured_image } = req.body;
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(req.params.id);

  let featured_image = existing ? existing.featured_image : null;
  if (req.file) {
    if (featured_image) { try { fs.unlinkSync(path.join(BLOG_UPLOAD_DIR, featured_image)); } catch (e) {} }
    featured_image = req.file.filename;
  } else if (remove_featured_image === '1') {
    if (featured_image) { try { fs.unlinkSync(path.join(BLOG_UPLOAD_DIR, featured_image)); } catch (e) {} }
    featured_image = null;
  }

  try {
    db.prepare(
      "UPDATE blog_posts SET title = ?, slug = ?, body = ?, published = ?, featured_image = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title.trim(), slug, body.trim(), published === '1' ? 1 : 0, featured_image, req.params.id);
    res.redirect('/admin/blog');
  } catch (err) {
    const msg = err.message.includes('UNIQUE') ? 'A post with that title already exists.' : 'Could not save post.';
    res.render('admin/blog/form', { title: 'Edit post', post: { ...existing, title, body, published, featured_image }, error: msg });
  }
});

router.post('/blog/:id/delete', (req, res) => {
  db.prepare('DELETE FROM blog_posts WHERE id = ?').run(req.params.id);
  res.redirect('/admin/blog');
});

// Site settings
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function settingsState(overrides) {
  const faviconIsIco = fs.existsSync(FAVICON_ICO_PATH);
  const faviconIsPng = fs.existsSync(FAVICON_PNG_PATH);
  return Object.assign({
    title: 'Site settings',
    logoExists: fs.existsSync(LOGO_PATH),
    faviconExists: faviconIsIco || faviconIsPng,
    faviconUrl: faviconIsIco ? '/images/favicon.ico' : '/images/favicon.png',
    blogPerPage: parseInt(getSetting('blog_per_page') || '10', 10),
    adsEnabled: getSetting('ads_enabled') !== '0',
    error: null,
    success: null,
  }, overrides);
}

router.get('/settings', (req, res) => {
  res.render('admin/settings', settingsState());
});

router.post('/settings/ads', (req, res) => {
  const enabled = req.body.ads_enabled === '1';
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ads_enabled', ?)").run(enabled ? '1' : '0');
  res.render('admin/settings', settingsState({ adsEnabled: enabled, success: `Ads turned ${enabled ? 'on' : 'off'} site-wide.` }));
});

router.post('/settings/general', (req, res) => {
  const perPage = parseInt(req.body.blog_per_page, 10);
  if (!perPage || perPage < 1 || perPage > 100) {
    return res.render('admin/settings', settingsState({ error: 'Posts per page must be between 1 and 100.' }));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('blog_per_page', ?)").run(String(perPage));
  res.render('admin/settings', settingsState({ success: 'Settings saved.' }));
});

router.post('/settings/logo', (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.render('admin/settings', settingsState({ error: err.message }));
    if (!req.file) return res.render('admin/settings', settingsState({ error: 'No file selected.' }));
    res.render('admin/settings', settingsState({ logoExists: true, success: 'Logo updated successfully.' }));
  });
});

router.post('/settings/logo/delete', (req, res) => {
  if (fs.existsSync(LOGO_PATH)) fs.unlinkSync(LOGO_PATH);
  res.render('admin/settings', settingsState({ logoExists: false, success: 'Logo removed.' }));
});

router.post('/settings/favicon', (req, res, next) => {
  faviconUpload.single('favicon')(req, res, (err) => {
    if (err) return res.render('admin/settings', settingsState({ error: err.message }));
    if (!req.file) return res.render('admin/settings', settingsState({ error: 'No file selected.' }));
    res.render('admin/settings', settingsState({ faviconExists: true, success: 'Site icon updated successfully.' }));
  });
});

router.post('/settings/favicon/delete', (req, res) => {
  if (fs.existsSync(FAVICON_PNG_PATH)) fs.unlinkSync(FAVICON_PNG_PATH);
  if (fs.existsSync(FAVICON_ICO_PATH)) fs.unlinkSync(FAVICON_ICO_PATH);
  res.render('admin/settings', settingsState({ success: 'Site icon removed.' }));
});

// Contact messages
const MESSAGE_SUBJECTS = ['General inquiry', 'Job posting issue', 'Account problem', 'Report a listing', 'Partnership or advertising', 'Other'];

router.get('/messages', (req, res) => {
  const q = (req.query.q || '').trim();
  const status = ['unread', 'read'].includes(req.query.status) ? req.query.status : 'all';
  const subject = MESSAGE_SUBJECTS.includes(req.query.subject) ? req.query.subject : '';

  let sql = 'SELECT * FROM contact_messages WHERE 1=1';
  const params = [];
  if (q) {
    sql += ' AND (name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === 'unread') sql += ' AND read = 0';
  if (status === 'read') sql += ' AND read = 1';
  if (subject) {
    sql += ' AND subject = ?';
    params.push(subject);
  }
  sql += ' ORDER BY created_at DESC';

  const messages = db.prepare(sql).all(...params);
  const unreadCount = db.prepare('SELECT COUNT(*) as c FROM contact_messages WHERE read = 0').get().c;
  res.render('admin/messages', { title: 'Contact messages', messages, unreadCount, q, status, subject, subjects: MESSAGE_SUBJECTS });
});

function buildMessagesRedirect(body) {
  const parts = [];
  if (body._q) parts.push(`q=${encodeURIComponent(body._q)}`);
  if (body._status && body._status !== 'all') parts.push(`status=${encodeURIComponent(body._status)}`);
  if (body._subject) parts.push(`subject=${encodeURIComponent(body._subject)}`);
  return '/admin/messages' + (parts.length ? '?' + parts.join('&') : '');
}

router.post('/messages/:id/read', (req, res) => {
  db.prepare('UPDATE contact_messages SET read = 1 WHERE id = ?').run(req.params.id);
  res.redirect(buildMessagesRedirect(req.body));
});

router.post('/messages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  res.redirect(buildMessagesRedirect(req.body));
});

// Push notifications (admin broadcast)
function pushRecipientCounts() {
  return {
    all: db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM push_tokens').get().c,
    seeker: db.prepare("SELECT COUNT(DISTINCT pt.user_id) as c FROM push_tokens pt JOIN users u ON u.id = pt.user_id WHERE u.role = 'seeker'").get().c,
    employer: db.prepare("SELECT COUNT(DISTINCT pt.user_id) as c FROM push_tokens pt JOIN users u ON u.id = pt.user_id WHERE u.role = 'employer'").get().c,
  };
}

router.get('/push', (req, res) => {
  res.render('admin/push', { title: 'Push notifications', counts: pushRecipientCounts(), configured: isPushConfigured(), error: null, success: null });
});

router.post('/push/send', (req, res) => {
  const { title: pushTitle, body, audience } = req.body;
  if (!pushTitle || !pushTitle.trim() || !body || !body.trim()) {
    return res.render('admin/push', { title: 'Push notifications', counts: pushRecipientCounts(), configured: isPushConfigured(), error: 'Title and message are required.', success: null });
  }

  let sql = 'SELECT DISTINCT pt.user_id as user_id FROM push_tokens pt';
  const params = [];
  if (audience === 'seeker' || audience === 'employer') {
    sql += ' JOIN users u ON u.id = pt.user_id WHERE u.role = ?';
    params.push(audience);
  }
  const recipients = db.prepare(sql).all(...params);
  recipients.forEach(r => sendPushNotification(r.user_id, { title: pushTitle.trim(), body: body.trim() }));

  const count = recipients.length;
  const success = isPushConfigured()
    ? `Notification sent to ${count} recipient${count === 1 ? '' : 's'}.`
    : `${count} recipient${count === 1 ? '' : 's'} matched, but Apple Push credentials aren't configured yet (APN_TEAM_ID / APN_KEY_ID / APN_AUTH_KEY / APN_BUNDLE_ID) — nothing was actually delivered.`;

  res.render('admin/push', { title: 'Push notifications', counts: pushRecipientCounts(), configured: isPushConfigured(), error: null, success });
});

// Employer reports & suggestions
function loadReportsForAdmin() {
  const reports = db.prepare(`
    SELECT r.*, u.name as employer_name, u.email as employer_email, u.company_name
    FROM reports r JOIN users u ON u.id = r.employer_id
    ORDER BY r.updated_at DESC
  `).all();
  reports.forEach(r => {
    r.messages = db.prepare('SELECT * FROM report_messages WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  });
  return reports;
}

router.get('/reports', (req, res) => {
  db.prepare('UPDATE reports SET admin_unread = 0').run();
  res.render('admin/reports', { title: 'Reports & suggestions', reports: loadReportsForAdmin() });
});

router.post('/reports/:id/reply', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).render('error', { title: 'Not found', message: 'Report not found.' });
  const { message } = req.body;
  if (message && message.trim()) {
    db.prepare("INSERT INTO report_messages (report_id, sender_role, message) VALUES (?, 'admin', ?)").run(report.id, message.trim());
    db.prepare("UPDATE reports SET employer_unread = 1, admin_unread = 0, updated_at = datetime('now') WHERE id = ?").run(report.id);
    notifyUser(report.employer_id, {
      title: `New reply: ${report.subject}`,
      body: message.trim(),
      url: '/employer/reports',
    });
  }
  res.redirect('/admin/reports');
});

router.post('/reports/:id/status', (req, res) => {
  const status = req.body.status === 'closed' ? 'closed' : 'open';
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.redirect('/admin/reports');
});

// Pages CMS
const PAGE_SLUGS = ['privacy', 'terms', 'contact'];

router.get('/pages', (req, res) => {
  const pages = db.prepare('SELECT * FROM pages ORDER BY slug').all();
  res.render('admin/pages/index', { title: 'Pages', pages });
});

router.get('/pages/:slug/edit', (req, res) => {
  if (!PAGE_SLUGS.includes(req.params.slug)) return res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  const meta = JSON.parse(page.meta || '{}');
  res.render('admin/pages/edit', { title: `Edit — ${page.title}`, page, meta, error: null, success: null });
});

router.post('/pages/:slug/edit', (req, res) => {
  if (!PAGE_SLUGS.includes(req.params.slug)) return res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  const { title, content, email, location, response_time } = req.body;
  if (!title || !title.trim()) {
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
    const meta = JSON.parse(page.meta || '{}');
    return res.render('admin/pages/edit', { title: `Edit — ${page.title}`, page, meta, error: 'Title is required.', success: null });
  }
  const meta = req.params.slug === 'contact'
    ? JSON.stringify({ email: email || '', location: location || '', response_time: response_time || '' })
    : '{}';
  db.prepare("UPDATE pages SET title = ?, content = ?, meta = ?, updated_at = datetime('now') WHERE slug = ?")
    .run(title.trim(), content || '', meta, req.params.slug);
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  res.render('admin/pages/edit', { title: `Edit — ${page.title}`, page, meta: JSON.parse(meta), error: null, success: 'Page saved successfully.' });
});

module.exports = router;
