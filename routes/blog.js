const express = require('express');
const db = require('../db/db');

const router = express.Router();

router.get('/blog', (req, res) => {
  const q = (req.query.q || '').trim();
  const perPageRow = db.prepare("SELECT value FROM settings WHERE key = 'blog_per_page'").get();
  const perPage = Math.max(1, parseInt((perPageRow && perPageRow.value) || '10', 10));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));

  let base = 'FROM blog_posts bp JOIN users u ON u.id = bp.author_id WHERE bp.published = 1';
  const params = [];
  if (q) {
    base += ' AND (bp.title LIKE ? OR bp.body LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as c ${base}`).get(...params).c;
  const totalPages = Math.ceil(total / perPage) || 1;
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * perPage;

  const posts = db.prepare(
    `SELECT bp.*, u.name as author_name ${base} ORDER BY bp.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset);

  res.render('blog/index', { title: 'Blog', posts, q, currentPage, totalPages, total });
});

router.get('/blog/:slug', (req, res) => {
  const post = db.prepare(
    'SELECT bp.*, u.name as author_name FROM blog_posts bp JOIN users u ON u.id = bp.author_id WHERE bp.slug = ? AND bp.published = 1'
  ).get(req.params.slug);
  if (!post) {
    return res.status(404).render('error', { title: 'Post not found', message: 'That blog post does not exist.' });
  }
  res.render('blog/show', { title: post.title, post });
});

module.exports = router;
