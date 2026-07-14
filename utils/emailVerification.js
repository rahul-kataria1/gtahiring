const crypto = require('crypto');
const db = require('../db/db');

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function issueVerificationToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?')
    .run(token, expires, userId);
  return token;
}

module.exports = { issueVerificationToken };
