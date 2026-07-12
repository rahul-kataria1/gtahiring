const express = require('express');
const db = require('../db/db');
const { requireRole } = require('../middleware/auth');
const { notifySeekerStatusChange } = require('../utils/emails');
const { sendPushNotification } = require('../utils/push');

const router = express.Router();
router.use(requireRole('employer'));

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

  res.render('employer/dashboard', { title: 'My job postings', jobs, countMap, newMap, totalNew, q });
});

router.get('/jobs/new', (req, res) => {
  res.render('employer/new-job', { title: 'Post a job', error: null, form: {} });
});

router.post('/jobs/new', (req, res) => {
  const { title, company, location, job_type, salary, description } = req.body;
  if (!title || !company || !location || !description) {
    return res.render('employer/new-job', {
      title: 'Post a job',
      error: 'Please fill in all required fields.',
      form: req.body,
    });
  }

  const employer = db.prepare('SELECT require_review FROM users WHERE id = ?').get(req.session.user.id);
  const jobStatus = (employer && employer.require_review === 0) ? 'approved' : 'pending';

  db.prepare(
    `INSERT INTO jobs (employer_id, title, company, location, job_type, salary, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.session.user.id, title, company, location, job_type || 'Full-time', salary || null, description, jobStatus);

  res.redirect('/employer/dashboard');
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

module.exports = router;
