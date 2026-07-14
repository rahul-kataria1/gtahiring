const express = require('express');
const db = require('../db/db');
const { requireRole } = require('../middleware/auth');
const { notifySeekerStatusChange } = require('../utils/emails');
const { sendPushNotification } = require('../utils/push');
const { notifyUser, notifyAdmins } = require('../utils/notifications');
const { getStripe } = require('../utils/stripe');
const {
  getPricing,
  freePostsRemaining,
  createJobPostCheckout,
  createFeaturedCheckout,
  fulfillCheckoutSession,
} = require('../utils/billing');

const router = express.Router();
router.use(requireRole('employer'));

router.use((req, res, next) => {
  res.locals.unreadReportsCount = db.prepare('SELECT COUNT(*) as c FROM reports WHERE employer_id = ? AND employer_unread = 1')
    .get(req.session.user.id).c;
  next();
});

router.get('/dashboard', (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = 'SELECT * FROM jobs WHERE employer_id = ?';
  const params = [req.session.user.id];
  if (q) {
    sql += ' AND (title LIKE ? OR company LIKE ? OR location LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC';
  const jobs = db.prepare(sql).all(...params);

  const counts = db
    .prepare(
      `SELECT j.id as job_id,
              COUNT(a.id) as applicant_count,
              SUM(CASE WHEN a.seen_by_employer = 0 THEN 1 ELSE 0 END) as new_count
       FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.employer_id = ? GROUP BY j.id`
    )
    .all(req.session.user.id);
  const countMap = Object.fromEntries(counts.map((c) => [c.job_id, c.applicant_count]));
  const newMap   = Object.fromEntries(counts.map((c) => [c.job_id, c.new_count || 0]));
  const totalNew = counts.reduce((sum, c) => sum + (c.new_count || 0), 0);

  res.render('employer/dashboard', {
    title: 'My job postings',
    jobs, countMap, newMap, totalNew, q,
    pricing: getPricing(),
    paid: req.query.paid === '1',
    featuredJustPurchased: req.query.featured === '1',
    error: req.query.error || null,
  });
});

router.get('/jobs/new', (req, res) => {
  const pricing = getPricing();
  res.render('employer/new-job', {
    title: 'Post a job',
    error: null,
    form: {},
    freeRemaining: freePostsRemaining(req.session.user.id),
    pricing,
    cancelled: req.query.cancelled === '1',
  });
});

router.post('/jobs/new', async (req, res) => {
  const { title, company, location, job_type, salary, description } = req.body;
  const pricing = getPricing();

  if (!title || !company || !location || !description) {
    return res.render('employer/new-job', {
      title: 'Post a job',
      error: 'Please fill in all required fields.',
      form: req.body,
      freeRemaining: freePostsRemaining(req.session.user.id),
      pricing,
      cancelled: false,
    });
  }

  const jobData = { title, company, location, job_type: job_type || 'Full-time', salary: salary || null, description };

  // Free quota still has room — post immediately, no payment needed.
  if (freePostsRemaining(req.session.user.id) > 0) {
    const employer = db.prepare('SELECT require_review FROM users WHERE id = ?').get(req.session.user.id);
    const jobStatus = (employer && employer.require_review === 0) ? 'approved' : 'pending';

    db.prepare(
      `INSERT INTO jobs (employer_id, title, company, location, job_type, salary, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.session.user.id, title, company, location, jobData.job_type, jobData.salary, description, jobStatus);
    db.prepare('UPDATE users SET free_posts_used = free_posts_used + 1 WHERE id = ?').run(req.session.user.id);

    return res.redirect('/employer/dashboard');
  }

  // Free posts used up — pay per post.
  if (!getStripe()) {
    return res.render('employer/new-job', {
      title: 'Post a job',
      error: "You've used all your free job posts, and payments aren't configured yet. Contact the site admin.",
      form: req.body,
      freeRemaining: 0,
      pricing,
      cancelled: false,
    });
  }

  try {
    const session = await createJobPostCheckout(req.session.user, jobData);
    res.redirect(session.url);
  } catch (err) {
    console.error('[stripe] job post checkout failed:', err.message);
    res.render('employer/new-job', {
      title: 'Post a job',
      error: 'Could not start checkout. Please try again.',
      form: req.body,
      freeRemaining: 0,
      pricing,
      cancelled: false,
    });
  }
});

router.get('/jobs/payment/success', async (req, res) => {
  const stripe = getStripe();
  const sessionId = req.query.session_id;
  if (!stripe || !sessionId) return res.redirect('/employer/dashboard');

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    fulfillCheckoutSession(session);
  } catch (err) {
    console.error('[stripe] could not verify session:', err.message);
  }

  res.redirect('/employer/dashboard?paid=1');
});

router.get('/jobs/payment/cancel', (req, res) => {
  res.redirect('/employer/jobs/new?cancelled=1');
});

router.get('/jobs/:id/edit', (req, res) => {
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!job) {
    return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  }
  res.render('employer/edit-job', { title: 'Edit job', job, error: null });
});

router.post('/jobs/:id/edit', (req, res) => {
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!job) {
    return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  }

  const { title, company, location, job_type, salary, description } = req.body;
  if (!title || !company || !location || !description) {
    return res.render('employer/edit-job', {
      title: 'Edit job',
      job: { ...job, ...req.body },
      error: 'Please fill in all required fields.',
    });
  }

  db.prepare(
    `UPDATE jobs SET title = ?, company = ?, location = ?, job_type = ?, salary = ?,
     description = ?, status = 'pending' WHERE id = ? AND employer_id = ?`
  ).run(title, company, location, job_type || 'Full-time', salary || null, description, req.params.id, req.session.user.id);

  res.redirect('/employer/dashboard');
});

router.get('/jobs/:id/applicants', (req, res) => {
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!job) {
    return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  }

  const applicants = db
    .prepare(
      `SELECT a.*, u.name as seeker_name, u.email as seeker_email
       FROM applications a JOIN users u ON u.id = a.seeker_id
       WHERE a.job_id = ? ORDER BY a.created_at DESC`
    )
    .all(job.id);

  const newCount = applicants.filter(a => !a.seen_by_employer).length;

  res.render('employer/applicants', { title: `Applicants for ${job.title}`, job, applicants, newCount });
});

router.post('/jobs/:id/applicants/:appId/mark-read', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  db.prepare('UPDATE applications SET seen_by_employer = 1 WHERE id = ? AND job_id = ?').run(req.params.appId, job.id);
  res.redirect(`/employer/jobs/${job.id}/applicants`);
});

router.post('/jobs/:id/applicants/mark-all-read', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  db.prepare('UPDATE applications SET seen_by_employer = 1 WHERE job_id = ?').run(job.id);
  res.redirect(`/employer/jobs/${job.id}/applicants`);
});

router.post('/jobs/:id/applicants/:appId/status', (req, res) => {
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!job) {
    return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  }
  const { status } = req.body;
  if (['applied', 'reviewed', 'accepted', 'rejected'].includes(status)) {
    db.prepare('UPDATE applications SET status = ? WHERE id = ? AND job_id = ?').run(
      status,
      req.params.appId,
      job.id
    );

    // Notify seeker of status change
    const app = db.prepare('SELECT a.*, u.name as seeker_name, u.email as seeker_email FROM applications a JOIN users u ON u.id = a.seeker_id WHERE a.id = ?').get(req.params.appId);
    if (app) {
      notifySeekerStatusChange({
        seekerEmail: app.seeker_email,
        seekerName:  app.seeker_name,
        jobTitle:    job.title,
        company:     job.company,
        newStatus:   status,
      });
      sendPushNotification(app.seeker_id, {
        title: 'Application update',
        body: `Your application for "${job.title}" is now ${status}.`,
      });
      notifyUser(app.seeker_id, {
        title: 'Application update',
        body: `Your application for "${job.title}" at ${job.company} is now ${status}.`,
        url: '/seeker/dashboard',
      });
    }
  }
  res.redirect(`/employer/jobs/${job.id}/applicants`);
});

router.post('/jobs/:id/toggle-active', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });
  db.prepare('UPDATE jobs SET active = ? WHERE id = ? AND employer_id = ?').run(job.active ? 0 : 1, req.params.id, req.session.user.id);
  res.redirect('/employer/dashboard');
});

router.post('/jobs/:id/delete', (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ? AND employer_id = ?').run(req.params.id, req.session.user.id);
  res.redirect('/employer/dashboard');
});

// Featured listing upsell
router.post('/jobs/:id/feature', async (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND employer_id = ?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'Job not found.' });

  if (!getStripe()) {
    return res.redirect('/employer/dashboard?error=' + encodeURIComponent('Payments are not configured yet. Contact the site admin.'));
  }

  try {
    const session = await createFeaturedCheckout(req.session.user, job);
    res.redirect(session.url);
  } catch (err) {
    console.error('[stripe] featured checkout failed:', err.message);
    res.redirect('/employer/dashboard?error=' + encodeURIComponent('Could not start checkout. Please try again.'));
  }
});

router.get('/jobs/feature/success', async (req, res) => {
  const stripe = getStripe();
  const sessionId = req.query.session_id;
  if (!stripe || !sessionId) return res.redirect('/employer/dashboard');

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    fulfillCheckoutSession(session);
  } catch (err) {
    console.error('[stripe] could not verify session:', err.message);
  }

  res.redirect('/employer/dashboard?featured=1');
});

// Billing — free post quota and payment history
router.get('/billing', (req, res) => {
  const payments = db.prepare('SELECT * FROM payments WHERE employer_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  res.render('employer/billing', {
    title: 'Billing',
    payments,
    pricing: getPricing(),
    freeRemaining: freePostsRemaining(req.session.user.id),
  });
});

// Reports & suggestions — threaded conversation with admin
router.get('/reports', (req, res) => {
  db.prepare('UPDATE reports SET employer_unread = 0 WHERE employer_id = ?').run(req.session.user.id);
  const reports = db.prepare('SELECT * FROM reports WHERE employer_id = ? ORDER BY updated_at DESC').all(req.session.user.id);
  reports.forEach(r => {
    r.messages = db.prepare('SELECT * FROM report_messages WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  });
  res.render('employer/reports', { title: 'Reports & suggestions', reports, error: null });
});

router.post('/reports', (req, res) => {
  const { type, subject, message } = req.body;
  if (!subject || !subject.trim() || !message || !message.trim()) {
    const reports = db.prepare('SELECT * FROM reports WHERE employer_id = ? ORDER BY updated_at DESC').all(req.session.user.id);
    reports.forEach(r => {
      r.messages = db.prepare('SELECT * FROM report_messages WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
    });
    return res.render('employer/reports', { title: 'Reports & suggestions', reports, error: 'Subject and message are required.' });
  }
  const info = db.prepare("INSERT INTO reports (employer_id, type, subject) VALUES (?, ?, ?)")
    .run(req.session.user.id, ['report', 'suggestion'].includes(type) ? type : 'suggestion', subject.trim());
  db.prepare("INSERT INTO report_messages (report_id, sender_role, message) VALUES (?, 'employer', ?)")
    .run(info.lastInsertRowid, message.trim());
  notifyAdmins({
    title: `New ${type === 'report' ? 'report' : 'suggestion'}: ${subject.trim()}`,
    body: `${req.session.user.name} — ${message.trim()}`,
    url: '/admin/reports',
  });
  res.redirect('/employer/reports');
});

router.post('/reports/:id/reply', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ? AND employer_id = ?').get(req.params.id, req.session.user.id);
  if (!report) return res.status(404).render('error', { title: 'Not found', message: 'Report not found.' });
  const { message } = req.body;
  if (message && message.trim()) {
    db.prepare("INSERT INTO report_messages (report_id, sender_role, message) VALUES (?, 'employer', ?)").run(report.id, message.trim());
    db.prepare("UPDATE reports SET admin_unread = 1, employer_unread = 0, status = 'open', updated_at = datetime('now') WHERE id = ?").run(report.id);
    notifyAdmins({
      title: `New reply: ${report.subject}`,
      body: `${req.session.user.name} — ${message.trim()}`,
      url: '/admin/reports',
    });
  }
  res.redirect('/employer/reports');
});

module.exports = router;
