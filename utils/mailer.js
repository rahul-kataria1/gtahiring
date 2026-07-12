// Sends transactional email via Zoho's ZeptoMail HTTPS API instead of raw
// SMTP — SMTP from cloud hosts (Railway, etc.) gets blocked/timed out by
// mail providers as an anti-abuse measure, but a plain HTTPS API call isn't.
const ZEPTOMAIL_API_URL = process.env.ZEPTOMAIL_API_URL || 'https://api.zeptomail.com/v1.1/email';

function parseFromAddress() {
  const raw = process.env.MAIL_FROM || '"GTA Hiring" <info@gtahiring.com>';
  const match = raw.match(/^"?([^"<]*)"?\s*<(.+)>$/);
  if (match) return { address: match[2].trim(), name: match[1].trim() || 'GTA Hiring' };
  return { address: raw.trim(), name: 'GTA Hiring' };
}

async function sendMail({ to, subject, html }) {
  if (!process.env.ZEPTOMAIL_TOKEN) return; // skip silently if not configured yet
  try {
    const res = await fetch(ZEPTOMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Zoho-enczapikey ${process.env.ZEPTOMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        from: parseFromAddress(),
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: html,
      }),
    });
    if (!res.ok) {
      console.error('[mailer] ZeptoMail error', res.status, await res.text());
    }
  } catch (err) {
    console.error('[mailer]', err.message);
  }
}

module.exports = { sendMail };
