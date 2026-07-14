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

// HTML-only email (no plain-text part) is a well-known spam signal — mail
// clients and filters expect a text/plain alternative alongside text/html.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
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
        textbody: htmlToText(html),
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
