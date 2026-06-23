const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const stripeLib = require('stripe');

admin.initializeApp();
const db = admin.firestore();

const APP_ID = 'default-app-id';

// ─── Create Stripe Checkout Session ───────────────────────────────────────────
// Called from your React app when user clicks "Proceed to Payment"
exports.createStripeCheckout = onCall({
  region: 'europe-west1',
  secrets: ['STRIPE_SECRET_KEY'],
}, async (request) => {

  // Must be logged in
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in to checkout.');
  }

  const { priceId, mode, successUrl, cancelUrl, planId } = request.data;

  if (!priceId) {
    throw new HttpsError('invalid-argument', 'Missing Stripe Price ID.');
  }

  const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: mode || 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: request.auth.uid,
      customer_email: request.auth.token.email,
      metadata: {
        planId: planId || '',
        userId: request.auth.uid,
      },
    });

    return { url: session.url };

  } catch (err) {
    console.error('Stripe session creation failed:', err.message);
    throw new HttpsError('internal', err.message);
  }
});


// ─── Stripe Webhook ───────────────────────────────────────────────────────────
// Stripe calls this after payment succeeds to grant Pro access
exports.stripeWebhook = onRequest({
  region: 'europe-west1',
  secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
}, async (req, res) => {

  const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify the request actually came from Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe event received:', event.type);

  // ── Payment completed (one-time purchase) ──────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const uid = paymentIntent.metadata?.userId;
    const planId = paymentIntent.metadata?.planId || 'lifetime';

    if (uid) {
      await db.doc(`artifacts/${APP_ID}/public/data/profiles/${uid}`).update({
        'subscription.plan': planId,
        'subscription.status': 'active',
        'subscription.since': new Date().toISOString(),
        'subscription.stripeCustomerId': paymentIntent.customer,
      });
      console.log(`Granted ${planId} access to user ${uid}`);
    }
  }

  // ── Subscription checkout completed ───────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.client_reference_id;
    const planId = session.metadata?.planId || 'web_pro';

    if (uid) {
      await db.doc(`artifacts/${APP_ID}/public/data/profiles/${uid}`).update({
        'subscription.plan': planId,
        'subscription.status': 'active',
        'subscription.since': new Date().toISOString(),
        'subscription.stripeCustomerId': session.customer,
        'subscription.stripeSessionId': session.id,
      });
      console.log(`Checkout complete — granted ${planId} to user ${uid}`);
    }
  }

  // ── Subscription cancelled ─────────────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    const snapshot = await db
      .collection(`artifacts/${APP_ID}/public/data/profiles`)
      .where('subscription.stripeCustomerId', '==', customerId)
      .get();

    const updates = snapshot.docs.map(d =>
      d.ref.update({
        'subscription.plan': 'free',
        'subscription.status': 'cancelled',
      })
    );
    await Promise.all(updates);
    console.log(`Subscription cancelled for Stripe customer ${customerId}`);
  }

  res.json({ received: true });
});