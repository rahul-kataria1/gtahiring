const db = require('../db/db');

function notifyUser(userId, { title, body, url }) {
  db.prepare('INSERT INTO notifications (user_id, title, body, url) VALUES (?, ?, ?, ?)')
    .run(userId, title, body, url || null);
}

function notifyAdmins({ title, body, url }) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  admins.forEach(a => notifyUser(a.id, { title, body, url }));
}

module.exports = { notifyUser, notifyAdmins };
