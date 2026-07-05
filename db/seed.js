// Creates the first super admin account from .env values.
// Run once with: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const name = process.env.ADMIN_NAME || 'Super Admin';
const email = process.env.ADMIN_EMAIL || 'admin@jobboard.com';
const password = process.env.ADMIN_PASSWORD || 'admin123';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

if (existing) {
  console.log(`Admin account already exists for ${email}. Nothing to do.`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, hash, 'admin', 'active');
  console.log(`Super admin created.\n  Email: ${email}\n  Password: ${password}`);
  console.log('Please log in and change this password by creating a new admin and removing this one, or rotate ADMIN_PASSWORD before re-seeding.');
}
