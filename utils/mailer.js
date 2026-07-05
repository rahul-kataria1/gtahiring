const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_HOST,
  port:   parseInt(process.env.MAIL_PORT || '465'),
  secure: process.env.MAIL_SECURE !== 'false',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendMail({ to, subject, html }) {
  if (!process.env.MAIL_PASS) return; // skip silently if not configured yet
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || '"GTA Hiring" <info@gtahiring.com>',
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[mailer]', err.message);
  }
}

module.exports = { sendMail };
