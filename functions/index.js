const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const stripeLib = require('stripe');
const axios = require('axios'); 

admin.initializeApp();
const db = admin.firestore();

const APP_ID = 'default-app-id';

// ─── Create Stripe Checkout Session ───────────────────────────────────────────
exports.createStripeCheckout = onCall({
  region: 'europe-west1',
  secrets: ['STRIPE_SECRET_KEY'],
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be logged in to checkout.');
  const { priceId, mode, successUrl, cancelUrl, planId } = request.data;
  if (!priceId) throw new HttpsError('invalid-argument', 'Missing Stripe Price ID.');

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
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const uid = paymentIntent.metadata?.userId;
    const planId = paymentIntent.metadata?.planId || 'lifetime';
    if (uid) {
      await db.doc(`artifacts/${APP_ID}/public/data/profiles/${uid}`).update({
        'subscription.plan': planId, 'subscription.status': 'active', 'subscription.since': new Date().toISOString(), 'subscription.stripeCustomerId': paymentIntent.customer,
      });
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.client_reference_id;
    const planId = session.metadata?.planId || 'web_pro';
    if (uid) {
      await db.doc(`artifacts/${APP_ID}/public/data/profiles/${uid}`).update({
        'subscription.plan': planId, 'subscription.status': 'active', 'subscription.since': new Date().toISOString(), 'subscription.stripeCustomerId': session.customer, 'subscription.stripeSessionId': session.id,
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    const snapshot = await db.collection(`artifacts/${APP_ID}/public/data/profiles`).where('subscription.stripeCustomerId', '==', customerId).get();
    const updates = snapshot.docs.map(d => d.ref.update({ 'subscription.plan': 'free', 'subscription.status': 'cancelled' }));
    await Promise.all(updates);
  }
  res.json({ received: true });
});

// ─── CORE AI EXECUTION LOGIC ─────────────────────────────────────────────────
async function executeAIAnalysis(aiConfig) {
    const OPENROUTER_API_KEY = aiConfig.openRouterKey;
    const AI_MODEL = aiConfig.aiModel || "anthropic/claude-3.5-sonnet";
    const STOCK_COUNT = aiConfig.stockCount ?? 3;
    const FOREX_COUNT = aiConfig.forexCount ?? 2;
    const CRYPTO_COUNT = aiConfig.cryptoCount ?? 1;
    const COMMODITY_COUNT = aiConfig.commodityCount ?? 1;
    const TARGET_TICKERS = aiConfig.targetTickers || "";
    const CUSTOM_INSTRUCTIONS = aiConfig.customInstructions || "";
    
    if (!OPENROUTER_API_KEY) throw new Error('OpenRouter API Key not configured.');

    let prompt = "";
    if (TARGET_TICKERS.trim().length > 0) {
        prompt = `Act as an elite institutional quantitative analyst. Provide a highly accurate, intraday trading analysis for the following specific tickers for today: ${TARGET_TICKERS}.`;
    } else {
        prompt = `Act as an elite institutional quantitative analyst. Find exactly ${STOCK_COUNT} Stocks, ${FOREX_COUNT} Forex pairs, ${CRYPTO_COUNT} Cryptocurrencies, and ${COMMODITY_COUNT} Commodities with high-probability intraday setups for today.`;
    }

    prompt += `\nFocus on immediate catalysts, technical levels, and likelihood of hitting the target before the close of the day.
    Admin Instructions: ${CUSTOM_INSTRUCTIONS}
    Return the result STRICTLY as a raw JSON array containing objects with exact keys: "ticker", "assetName", "category" (MUST be exactly one of: "Stocks", "Forex", "Crypto", "Commodities"), "bias" (BULLISH/BEARISH), "analysis" (2-3 sentences), "currentPrice" (number), "targetPrice" (number). Do not output any other text or markdown.`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        plugins: [{ id: "web" }] // Live Web Search
    }, {
        headers: { 
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://alphastructure.io',
            'X-Title': 'AlphaStructure Terminal'
        }
    });

    const textResponse = response.data.choices[0].message.content;
    const jsonMatch = textResponse.match(/\[[\s\S]*\]/); 
    const ideas = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);
    
    const stockIdeasRef = db.collection('artifacts').document(APP_ID).collection('public').document('data').collection('stock_ideas');

    // CLEANUP: Delete old ideas to prevent duplicates
    const oldIdeasSnap = await stockIdeasRef.get();
    const deleteBatch = db.batch();
    oldIdeasSnap.docs.forEach(doc => { deleteBatch.delete(doc.ref); });
    await deleteBatch.commit();

    // WRITE: Save new ideas
    const writeBatch = db.batch();
    ideas.forEach(idea => {
        const docRef = stockIdeasRef.doc(idea.ticker.toUpperCase().replace(/[^a-zA-Z0-9]/g, ''));
        writeBatch.set(docRef, { ...idea, timestamp: Date.now() });
    });

    await writeBatch.commit();
    return ideas.length;
}

// ─── Manual Trigger (Button Click) ──────────────────────────────────────────
exports.triggerClaudeStockAnalysis = onCall({
    region: 'europe-west1',
    timeoutSeconds: 120
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'You must be logged in.');
    
    const profile = await db.collection('artifacts').document(APP_ID).collection('public').document('data').collection('profiles').document(request.auth.uid).get();
    if (!profile.exists || profile.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can trigger AI.');

    const aiConfigSnap = await db.collection('artifacts').document(APP_ID).collection('users').document(request.auth.uid).collection('config').document('ai').get();
    const aiConfig = aiConfigSnap.data() || {};

    try {
        const count = await executeAIAnalysis(aiConfig);
        return { success: true, count };
    } catch (e) {
        console.error("AI Error:", e);
        throw new HttpsError('internal', 'Failed to execute AI analysis.', e.message);
    }
});

// ─── Automated Daily Trigger (CRON Job at 05:00 AM UTC) ─────────────────────
exports.scheduledAIAnalysis = onSchedule({
    schedule: '0 5 * * *', // Runs every day at 05:00 AM UTC
    timeZone: 'UTC',
    timeoutSeconds: 120,
    region: 'europe-west1'
}, async (event) => {
    try {
        // Find the first admin profile to fetch the config
        const adminsSnap = await db.collection('artifacts').document(APP_ID).collection('public').document('data').collection('profiles').where('role', '==', 'admin').limit(1).get();
        if (adminsSnap.empty) {
            console.log("No admin found. Skipping scheduled execution.");
            return;
        }
        
        const adminUid = adminsSnap.docs[0].id;
        const aiConfigSnap = await db.collection('artifacts').document(APP_ID).collection('users').document(adminUid).collection('config').document('ai').get();
        const aiConfig = aiConfigSnap.data() || {};

        // Only run if the Admin has toggled Auto-Scan ON
        if (!aiConfig.autoScanEnabled) {
            console.log("Auto-scan is disabled by Admin. Skipping.");
            return;
        }

        console.log("Executing Scheduled Daily AI Scan...");
        const count = await executeAIAnalysis(aiConfig);
        console.log(`Successfully completed daily scan. Wrote ${count} ideas.`);
    } catch (e) {
        console.error("Scheduled AI Error:", e);
    }
});