const http2 = require('http2');
const jwt = require('jsonwebtoken');
const db = require('../db/db');

let cachedToken = null;
let cachedTokenIssuedAt = 0;

function getApnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedTokenIssuedAt < 55 * 60) return cachedToken;
  cachedToken = jwt.sign(
    { iss: process.env.APN_TEAM_ID, iat: now },
    (process.env.APN_AUTH_KEY || '').replace(/\\n/g, '\n'),
    { algorithm: 'ES256', header: { kid: process.env.APN_KEY_ID } }
  );
  cachedTokenIssuedAt = now;
  return cachedToken;
}

// Sends a push notification to every device registered for a user.
// No-op until APN_TEAM_ID / APN_KEY_ID / APN_AUTH_KEY / APN_BUNDLE_ID are set
// (these come from a paid Apple Developer account's APNs auth key).
function sendPushNotification(userId, { title, body, data }) {
  if (!process.env.APN_TEAM_ID || !process.env.APN_KEY_ID || !process.env.APN_AUTH_KEY || !process.env.APN_BUNDLE_ID) {
    return;
  }
  const tokens = db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId);
  if (!tokens.length) return;

  const host = process.env.APN_ENV === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, data: data || {} });

  tokens.forEach(({ token }) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', () => {});
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${getApnsJwt()}`,
      'apns-topic': process.env.APN_BUNDLE_ID,
      'apns-push-type': 'alert',
    });
    req.on('response', (headers) => {
      const status = headers[':status'];
      if (status === 400 || status === 410) {
        db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
      }
    });
    req.on('error', () => {});
    req.on('close', () => client.close());
    req.end(payload);
  });
}

module.exports = { sendPushNotification };
