const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const stripeLib = require('stripe');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();
const APP_ID = 'default-app-id';

// ─── Create Stripe Checkout Session ──────────────────────────────────────────
exports.createStripeCheckout = onCall({
  region: 'europe-west1',
  secrets: ['STRIPE_SECRET_KEY'],
}, async (request) => {
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
      metadata: { planId: planId || '', userId: request.auth.uid },
    });
    return { url: session.url };
  } catch (err) {
    console.error('Stripe session creation failed:', err.message);
    throw new HttpsError('internal', err.message);
  }
});

// ─── Stripe Webhook ───────────────────────────────────────────────────────────
exports.stripeWebhook = onRequest({
  region: 'europe-west1',
  secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
}, async (req, res) => {
  const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe event received:', event.type);

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
      console.log(`Granted ${planId} to user ${uid}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    const snapshot = await db
      .collection(`artifacts/${APP_ID}/public/data/profiles`)
      .where('subscription.stripeCustomerId', '==', customerId)
      .get();
    await Promise.all(
      snapshot.docs.map(d =>
        d.ref.update({
          'subscription.plan': 'free',
          'subscription.status': 'cancelled',
        })
      )
    );
    console.log(`Subscription cancelled for customer ${customerId}`);
  }

  res.json({ received: true });
});

// ─── AI Stock Analysis ────────────────────────────────────────────────────────
exports.triggerClaudeStockAnalysis = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120 // Critical for slower AI responses
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in.');
  }

  const profile = await db
    .doc(`artifacts/${APP_ID}/public/data/profiles/${request.auth.uid}`)
    .get();

  if (!profile.exists || profile.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can trigger AI analysis.');
  }

  const aiConfig = await db
    .doc(`artifacts/${APP_ID}/users/${request.auth.uid}/config/ai`)
    .get();

  const OPENROUTER_API_KEY = aiConfig.data()?.openRouterKey;
  const AI_MODEL = aiConfig.data()?.aiModel || 'anthropic/claude-3.5-sonnet';
  const TARGET_TICKERS = aiConfig.data()?.targetTickers || "";
  const STOCK_COUNT = aiConfig.data()?.stockCount || 3;
  const CUSTOM_INSTRUCTIONS = aiConfig.data()?.customInstructions || "";

  if (!OPENROUTER_API_KEY) {
    throw new HttpsError(
      'failed-precondition',
      'OpenRouter API Key not configured. Add it in Admin → AI Research.'
    );
  }

  // DYNAMIC PROMPT: Adjusts based on whether specific tickers are requested
  let prompt = "";
  if (TARGET_TICKERS.trim().length > 0) {
      prompt = `Act as an elite institutional quantitative analyst. Provide a highly accurate, intraday trading analysis for the following specific stock tickers for today: ${TARGET_TICKERS}. 
      Focus on immediate catalysts, technical levels, and likelihood of hitting the target before the close of the day.
      Admin Instructions: ${CUSTOM_INSTRUCTIONS}
      Return the result STRICTLY as a raw JSON array containing objects with exact keys: "ticker", "companyName", "bias" (BULLISH/BEARISH), "analysis" (2-3 sentences), "currentPrice" (number), "targetPrice" (number). Do not output any other text, markdown, or greetings.`;
  } else {
      prompt = `Act as an elite institutional quantitative analyst. Find exactly ${STOCK_COUNT} high-probability intraday stock trading ideas for today. 
      Focus on stocks with immediate catalysts or technical breakouts likely to hit targets before the close of the day.
      Admin Instructions: ${CUSTOM_INSTRUCTIONS}
      Return the result STRICTLY as a raw JSON array containing objects with exact keys: "ticker", "companyName", "bias" (BULLISH/BEARISH), "analysis" (2-3 sentences), "currentPrice" (number), "targetPrice" (number). Do not output any other text, markdown, or greetings.`;
  }

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7 
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://alphastructure.io',
          'X-Title': 'AlphaStructure Terminal',
          'Content-Type': 'application/json',
        },
      }
    );

    const textResponse = response.data.choices[0].message.content;
    const jsonMatch = textResponse.match(/\[[\s\S]*\]/);
    const ideas = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);

    const stockIdeasRef = db.collection(`artifacts/${APP_ID}/public/data/stock_ideas`);

    // CLEANUP: Delete old ideas so you don't end up with duplicates
    const oldIdeasSnap = await stockIdeasRef.get();
    const deleteBatch = db.batch();
    oldIdeasSnap.docs.forEach(doc => {
      deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();

    // WRITE: Save new ideas using the Ticker as the Document ID to guarantee uniqueness
    const writeBatch = db.batch();
    ideas.forEach(idea => {
      const docRef = stockIdeasRef.doc(idea.ticker.toUpperCase());
      writeBatch.set(docRef, { ...idea, timestamp: Date.now() });
    });
    await writeBatch.commit();

    console.log(`Wrote ${ideas.length} stock ideas to Firestore`);
    return { success: true, count: ideas.length };

  } catch (err) {
    console.error('AI error:', err.response?.data || err.message);
    throw new HttpsError('internal', `AI analysis failed: ${err.message}`);
  }
});