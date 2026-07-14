const db = require('../db/db');
const { getStripe } = require('./stripe');
const { notifyUser } = require('./notifications');

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getPricing() {
  return {
    jobPostPriceCents: parseInt(getSetting('job_post_price_cents', '999'), 10),
    featuredPriceCents: parseInt(getSetting('featured_price_cents', '499'), 10),
    featuredDurationDays: parseInt(getSetting('featured_duration_days', '7'), 10),
    freePostsLimit: parseInt(getSetting('free_posts_limit', '50'), 10),
  };
}

function freePostsRemaining(employerId) {
  const user = db.prepare('SELECT free_posts_used FROM users WHERE id = ?').get(employerId);
  const { freePostsLimit } = getPricing();
  return Math.max(0, freePostsLimit - (user ? user.free_posts_used : 0));
}

// Creates a Stripe Checkout Session for a job post fee, stashing the
// submitted job form data so the job can be created once payment clears.
async function createJobPostCheckout(employer, jobData) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const { jobPostPriceCents } = getPricing();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: employer.email,
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: { name: `Job post: ${jobData.title}` },
        unit_amount: jobPostPriceCents,
      },
      quantity: 1,
    }],
    success_url: `${APP_URL()}/employer/jobs/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL()}/employer/jobs/payment/cancel`,
    metadata: { employer_id: String(employer.id), type: 'job_post' },
  });

  db.prepare(`
    INSERT INTO payments (employer_id, type, amount_cents, currency, stripe_checkout_session_id, status, job_data)
    VALUES (?, 'job_post', ?, 'cad', ?, 'pending', ?)
  `).run(employer.id, jobPostPriceCents, session.id, JSON.stringify(jobData));

  return session;
}

// Creates a Stripe Checkout Session for the featured-listing upsell on an
// existing job.
async function createFeaturedCheckout(employer, job) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const { featuredPriceCents, featuredDurationDays } = getPricing();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: employer.email,
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: { name: `Feature listing for ${featuredDurationDays} days: ${job.title}` },
        unit_amount: featuredPriceCents,
      },
      quantity: 1,
    }],
    success_url: `${APP_URL()}/employer/jobs/feature/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL()}/employer/dashboard`,
    metadata: { employer_id: String(employer.id), type: 'featured', job_id: String(job.id) },
  });

  db.prepare(`
    INSERT INTO payments (employer_id, job_id, type, amount_cents, currency, stripe_checkout_session_id, status)
    VALUES (?, ?, 'featured', ?, 'cad', ?, 'pending')
  `).run(employer.id, job.id, featuredPriceCents, session.id);

  return session;
}

// Idempotent — safe to call from both the success-redirect handler and the
// webhook. Only acts once per payment row (checked via status).
function fulfillCheckoutSession(session) {
  const payment = db.prepare('SELECT * FROM payments WHERE stripe_checkout_session_id = ?').get(session.id);
  if (!payment || payment.status === 'paid' || session.payment_status !== 'paid') return payment || null;

  db.prepare("UPDATE payments SET status = 'paid', stripe_payment_intent_id = ? WHERE id = ?")
    .run(session.payment_intent || null, payment.id);

  if (payment.type === 'job_post') {
    const jobData = JSON.parse(payment.job_data);
    const employer = db.prepare('SELECT require_review FROM users WHERE id = ?').get(payment.employer_id);
    const jobStatus = (employer && employer.require_review === 0) ? 'approved' : 'pending';
    const info = db.prepare(`
      INSERT INTO jobs (employer_id, title, company, location, job_type, salary, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.employer_id, jobData.title, jobData.company, jobData.location,
      jobData.job_type || 'Full-time', jobData.salary || null, jobData.description, jobStatus
    );
    db.prepare('UPDATE payments SET job_id = ? WHERE id = ?').run(info.lastInsertRowid, payment.id);
    notifyUser(payment.employer_id, {
      title: 'Job post payment received',
      body: `Your payment for "${jobData.title}" was successful and it's now awaiting review.`,
      url: '/employer/dashboard',
    });
  } else if (payment.type === 'featured') {
    const { featuredDurationDays } = getPricing();
    const until = new Date(Date.now() + featuredDurationDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE jobs SET featured = 1, featured_until = ? WHERE id = ?').run(until, payment.job_id);
    notifyUser(payment.employer_id, {
      title: 'Listing featured!',
      body: `Your job posting is now featured for ${featuredDurationDays} days.`,
      url: `/jobs/${payment.job_id}`,
    });
  }

  return db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
}

module.exports = {
  getPricing,
  freePostsRemaining,
  createJobPostCheckout,
  createFeaturedCheckout,
  fulfillCheckoutSession,
};
