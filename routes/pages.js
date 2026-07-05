const express = require('express');
const db = require('../db/db');
const router = express.Router();

router.get('/privacy', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = 'privacy'").get();
  res.render('pages/privacy', { title: page.title, page });
});

router.get('/terms', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = 'terms'").get();
  res.render('pages/terms', { title: page.title, page });
});

router.get('/contact', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = 'contact'").get();
  const meta = JSON.parse(page.meta || '{}');
  res.render('pages/contact', { title: page.title, page, meta, sent: false, error: null });
});

router.post('/contact', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = 'contact'").get();
  const meta = JSON.parse(page.meta || '{}');
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.render('pages/contact', { title: page.title, page, meta, sent: false, error: 'Please fill in all fields.' });
  }
  res.render('pages/contact', { title: page.title, page, meta, sent: true, error: null });
});

module.exports = router;
