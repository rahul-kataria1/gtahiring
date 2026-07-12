const { sendMail } = require('./mailer');

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

// Shared wrapper — ← YOU CAN EDIT the colours, logo URL, footer text here
function wrap(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

        <!-- Header -->
        <tr>
          <td style="background:#1a2540;padding:24px 32px;">
            <!-- ← REPLACE with your hosted logo if you want an image: <img src="${APP_URL()}/images/logo.png" height="36" alt="GTA Hiring"> -->
            <span style="color:#fff;font-size:1.3rem;font-weight:800;letter-spacing:-0.5px;">GTA Hiring</span>
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:32px;">${body}</td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              &copy; ${new Date().getFullYear()} GTA Hiring &mdash; Greater Toronto Area
              &nbsp;·&nbsp; <a href="${APP_URL()}/privacy" style="color:#94a3b8;">Privacy</a>
              &nbsp;·&nbsp; <a href="${APP_URL()}/contact" style="color:#94a3b8;">Contact</a>
            </p>
            <!-- ← You can add your physical address here if required by CAN-SPAM -->
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function btn(text, url) {
  return `<a href="${url}" style="display:inline-block;background:#0057d8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:0.95rem;margin-top:20px;">${text}</a>`;
}

// ─────────────────────────────────────────────────────────────
// 1. New application → notify employer
// ─────────────────────────────────────────────────────────────
async function notifyEmployerNewApplication({ employerEmail, employerName, jobTitle, applicantName, applicantEmail, jobId }) {
  await sendMail({
    to: employerEmail,
    subject: `New application for "${jobTitle}"`,
    html: wrap(`
      <h2 style="margin:0 0 8px;font-size:1.3rem;color:#1a2540;">You have a new applicant!</h2>
      <p style="margin:0 0 20px;color:#475569;">Hi ${employerName}, someone just applied to one of your job postings.</p>

      <table style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;border-spacing:0;margin-bottom:8px;">
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Job</td><td style="padding:6px 0;font-weight:600;color:#1a2540;">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Applicant</td><td style="padding:6px 0;font-weight:600;color:#1a2540;">${applicantName}</td></tr>
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Email</td><td style="padding:6px 0;color:#1a2540;">${applicantEmail}</td></tr>
      </table>

      ${btn('View application', `${APP_URL()}/employer/jobs/${jobId}/applicants`)}
    `),
  });
}

// ─────────────────────────────────────────────────────────────
// 2. Application status changed → notify seeker
// ─────────────────────────────────────────────────────────────
async function notifySeekerStatusChange({ seekerEmail, seekerName, jobTitle, company, newStatus }) {
  const statusMessages = {
    reviewed:  { label: 'Under Review',  colour: '#0057d8', msg: 'Great news — the employer has reviewed your application and it\'s being considered.' },
    accepted:  { label: 'Accepted 🎉',   colour: '#059669', msg: 'Congratulations! The employer has accepted your application. Expect to hear from them soon.' },
    rejected:  { label: 'Not Selected',  colour: '#dc2626', msg: 'Thank you for applying. Unfortunately you were not selected for this role, but keep applying!' },
    applied:   { label: 'Applied',       colour: '#64748b', msg: 'Your application has been received.' },
  };
  const s = statusMessages[newStatus] || statusMessages.applied;

  await sendMail({
    to: seekerEmail,
    subject: `Application update: ${jobTitle} at ${company}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;font-size:1.3rem;color:#1a2540;">Application update</h2>
      <p style="margin:0 0 20px;color:#475569;">Hi ${seekerName}, there's an update on your application.</p>

      <table style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;border-spacing:0;margin-bottom:8px;">
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Job</td><td style="padding:6px 0;font-weight:600;color:#1a2540;">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Company</td><td style="padding:6px 0;font-weight:600;color:#1a2540;">${company}</td></tr>
        <tr><td style="padding:6px 0;font-size:0.85rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Status</td>
          <td style="padding:6px 0;"><span style="background:${s.colour};color:#fff;padding:3px 12px;border-radius:20px;font-size:0.8rem;font-weight:700;">${s.label}</span></td>
        </tr>
      </table>

      <p style="color:#475569;margin:16px 0 0;">${s.msg}</p>
      ${btn('View my applications', `${APP_URL()}/seeker/dashboard`)}
    `),
  });
}

// ─────────────────────────────────────────────────────────────
// 3. Job approved or rejected → notify employer
// ─────────────────────────────────────────────────────────────
async function notifyEmployerJobStatus({ employerEmail, employerName, jobTitle, newStatus, jobId }) {
  const approved = newStatus === 'approved';
  await sendMail({
    to: employerEmail,
    subject: approved ? `Your job is live: "${jobTitle}"` : `Job posting update: "${jobTitle}"`,
    html: wrap(`
      <h2 style="margin:0 0 8px;font-size:1.3rem;color:#1a2540;">
        ${approved ? '✅ Your job is now live!' : '❌ Job posting not approved'}
      </h2>
      <p style="margin:0 0 20px;color:#475569;">Hi ${employerName},</p>
      <p style="color:#475569;margin:0 0 20px;">
        ${approved
          ? `Your job posting <strong>${jobTitle}</strong> has been reviewed and approved. It is now live on GTA Hiring and visible to job seekers.`
          : `Your job posting <strong>${jobTitle}</strong> was not approved at this time. Please review our posting guidelines or contact us for more information.`
        }
      </p>
      ${approved
        ? btn('View your listing', `${APP_URL()}/jobs/${jobId}`)
        : btn('Contact us', `${APP_URL()}/contact`)
      }
    `),
  });
}

// ─────────────────────────────────────────────────────────────
// 4. Welcome email on registration
// ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ to, name, role }) {
  const isEmployer = role === 'employer';
  await sendMail({
    to,
    subject: 'Welcome to GTA Hiring!',
    html: wrap(`
      <h2 style="margin:0 0 8px;font-size:1.3rem;color:#1a2540;">Welcome to GTA Hiring, ${name}!</h2>
      <p style="color:#475569;margin:0 0 20px;">
        ${isEmployer
          ? 'Your employer account is ready. Start posting jobs and finding great candidates across the Greater Toronto Area.'
          : 'Your account is ready. Start exploring hundreds of open roles across the Greater Toronto Area.'
        }
      </p>
      <!-- ← You can add onboarding tips or feature highlights here -->
      ${btn(isEmployer ? 'Post your first job' : 'Browse jobs', isEmployer ? `${APP_URL()}/employer/jobs/new` : `${APP_URL()}/`)}
    `),
  });
}

// ─────────────────────────────────────────────────────────────
// 5. Verify email address on registration
// ─────────────────────────────────────────────────────────────
async function sendVerificationEmail({ to, name, token }) {
  await sendMail({
    to,
    subject: 'Verify your email — GTA Hiring',
    html: wrap(`
      <h2 style="margin:0 0 8px;font-size:1.3rem;color:#1a2540;">Confirm your email, ${name}</h2>
      <p style="color:#475569;margin:0 0 8px;">
        Thanks for signing up! Click below to verify your email address and activate your GTA Hiring account.
      </p>
      <p style="color:#94a3b8;font-size:0.85rem;margin:0;">This link expires in 24 hours.</p>
      ${btn('Verify my email', `${APP_URL()}/verify-email?token=${token}`)}
    `),
  });
}

module.exports = {
  notifyEmployerNewApplication,
  notifySeekerStatusChange,
  notifyEmployerJobStatus,
  sendWelcomeEmail,
  sendVerificationEmail,
};
