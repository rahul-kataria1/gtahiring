const express = require('express');
const { getStripe } = require('../utils/stripe');
const { fulfillCheckoutSession } = require('../utils/billing');

const router = express.Router();

// Mounted with express.raw() before the global urlencoded parser (see
// server.js) — Stripe's signature check needs the exact raw request body.
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = getStripe();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Stripe is not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    fulfillCheckoutSession(event.data.object);
  }

  res.json({ received: true });
});

module.exports = router;
