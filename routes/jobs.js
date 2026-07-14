const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/db');
const { requireRole, requireAuth } = require('../middleware/auth');
const { notifyEmployerNewApplication } = require('../utils/emails');
const { notifyUser } = require('../utils/notifications');

const router = express.Router();

const RESUME_DIR = path.join(__dirname, '../uploads/resumes');
if (!fs.existsSync(RESUME_DIR)) fs.mkdirSync(RESUME_DIR, { recursive: true });

const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: RESUME_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `resume-${req.session.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.doc', '.docx'].includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, DOC, or DOCX files are allowed.'));
  },
});

// Public list of approved jobs
router.get('/', (req, res) => {
  const { q, location } = req.query;
  let sql = `SELECT j.*, u.avatar AS employer_avatar
             FROM jobs j
             LEFT JOIN users u ON u.id = j.employer_id
             WHERE j.status = 'approved'`;
  const params = [];

  if (q) {
    sql += ' AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (location) {
    sql += ' AND j.location LIKE ?';
    params.push(`%${location}%`);
  }
  sql += " ORDER BY (j.featured = 1 AND (j.featured_until IS NULL OR j.featured_until > datetime('now'))) DESC, j.created_at DESC";

  const jobs = db.prepare(sql).all(...params);
  res.render('jobs/index', { title: 'Find a job', jobs, q: q || '', location: location || '' });
});

// Job detail page
router.get('/jobs/:id', (req, res) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'approved'").get(req.params.id);
  if (!job) {
    return res.status(404).render('error', { title: 'Not found', message: 'This job does not exist or is no longer available.' });
  }

  let alreadyApplied = false;
  if (req.session.user && req.session.user.role === 'seeker') {
    alreadyApplied = !!db
      .prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?')
      .get(job.id, req.session.user.id);
  }

  const uploadError  = req.query.error  || null;
  const justApplied  = req.query.applied === '1';
  res.render('jobs/show', { title: job.title, job, alreadyApplied, uploadError, justApplied });
});

// Application form page
router.get('/jobs/:id/apply', requireRole('seeker'), (req, res) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'approved'").get(req.params.id);
  if (!job) return res.status(404).render('error', { title: 'Not found', message: 'This job does not exist or is no longer available.' });
  if (!job.active) return res.redirect(`/jobs/${job.id}`);

  const already = db.prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?').get(job.id, req.session.user.id);
  if (already) return res.redirect(`/jobs/${job.id}`);

  const seeker = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('jobs/apply', { title: `Apply — ${job.title}`, job, seeker, error: null, form: {} });
});

// Submit application
router.post('/jobs/:id/apply', requireRole('seeker'), (req, res) => {
  resumeUpload.single('resume')(req, res, (err) => {
    const jobId = req.params.id;
    const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'approved'").get(jobId);
    if (!job) return res.status(404).render('error', { title: 'Not found', message: 'This job does not exist or is no longer available.' });
    if (!job.active) return res.redirect(`/jobs/${jobId}`);

    const seeker = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

    const renderError = (msg) => {
      if (req.file) { try { require('fs').unlinkSync(require('path').join(RESUME_DIR, req.file.filename)); } catch (e) {} }
      res.render('jobs/apply', { title: `Apply — ${job.title}`, job, seeker, error: msg, form: req.body });
    };

    if (err) return renderError(err.message);

    const { applicant_name, applicant_email, applicant_phone, work_eligible } = req.body;
    if (!applicant_name || !applicant_email || !applicant_phone || !work_eligible) {
      return renderError('Please fill in all required fields.');
    }
    if (!req.file) return renderError('Please upload your resume to continue.');

    const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?').get(job.id, req.session.user.id);
    if (!existing) {
      db.prepare(
        'INSERT INTO applications (job_id, seeker_id, resume_file, applicant_name, applicant_email, applicant_phone, work_eligible) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(job.id, req.session.user.id, req.file.filename, applicant_name.trim(), applicant_email.trim(), applicant_phone.trim(), work_eligible === 'yes' ? 1 : 0);

      // Notify employer
      const employer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(job.employer_id);
      if (employer) {
        notifyEmployerNewApplication({
          employerEmail: employer.email,
          employerName:  employer.name,
          jobTitle:      job.title,
          applicantName: applicant_name.trim(),
          applicantEmail: applicant_email.trim(),
          jobId: job.id,
        });
        notifyUser(job.employer_id, {
          title: 'New applicant',
          body: `${applicant_name.trim()} applied for "${job.title}".`,
          url: `/employer/jobs/${job.id}/applicants`,
        });
      }
    }

    res.redirect(`/jobs/${job.id}?applied=1`);
  });
});

// Protected resume download — accessible to: the seeker who uploaded, the employer of the job, admin
router.get('/resume/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);

  const application = db.prepare(`
    SELECT a.seeker_id, a.resume_file, j.employer_id, u.name as seeker_name
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    JOIN users u ON u.id = a.seeker_id
    WHERE a.resume_file = ?
  `).get(filename);

  if (!application) {
    return res.status(404).render('error', { title: 'Not found', message: 'Resume not found.' });
  }

  const user = req.session.user;
  const canAccess = user.role === 'admin'
    || user.id === application.seeker_id
    || user.id === application.employer_id;

  if (!canAccess) {
    return res.status(403).render('error', { title: 'Access denied', message: "You don't have permission to view this resume." });
  }

  const ext = path.extname(filename);
  const displayName = `${application.seeker_name.replace(/\s+/g, '_')}_Resume${ext}`;
  const filePath = path.join(RESUME_DIR, filename);

  res.download(filePath, displayName, (dlErr) => {
    if (dlErr) res.status(404).render('error', { title: 'Not found', message: 'Resume file could not be retrieved.' });
  });
});

module.exports = router;
