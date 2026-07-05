const express = require('express');
const db = require('../db/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('seeker'));

router.get('/dashboard', (req, res) => {
  const applications = db
    .prepare(
      `SELECT a.*, j.title, j.company, j.location, j.status as job_status
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.seeker_id = ? ORDER BY a.created_at DESC`
    )
    .all(req.session.user.id);

  res.render('seeker/dashboard', { title: 'My applications', applications });
});

module.exports = router;
