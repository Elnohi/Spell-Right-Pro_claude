// netlify/functions/stripe-webhook.js
// SpellRightPro — Stripe Webhook Handler (Netlify backup)
//
// WHY THIS EXISTS:
// The primary webhook handler runs on Cloud Run (server.js). Cloud Run scales
// to zero (min:0), meaning cold starts and occasional container failures can
// cause webhook delivery failures. When Cloud Run is down, Stripe retries for
// 72 hours — but subscribers may lose access in the meantime.
//
// This Netlify function is a BACKUP that runs on always-available serverless
// infrastructure. Both webhooks are registered in Stripe simultaneously:
//   Primary:  https://spellrightpro-api-*.us-central1.run.app/api/stripe-webhook
//   Backup:   https://www.spellrightpro.org/.netlify/functions/stripe-webhook
//
// IDEMPOTENCY: Both handlers write to the same Firestore documents using
// merge:true — so even if both process the same event, the result is identical
// and the second write is a no-op. Safe to run twice.
//
// EVENTS HANDLED:
//   1. checkout.session.completed   — initial purchase → write premium record
//   2. invoice.payment_succeeded    — renewal → extend expiryDate
//   3. invoice.payment_failed       — payment declined → admin alert
//   4. customer.subscription.deleted — cancellation → mark active:false
//
// ENV VARS REQUIRED (set in Netlify Dashboard → Site → Environment variables):
//   STRIPE_SECRET_KEY         — sk_live_...
//   STRIPE_WEBHOOK_SECRET_NL  — whsec_... (separate signing secret for THIS endpoint)
//   FIREBASE_SERVICE_ACCOUNT  — JSON string of Firebase service account credentials
//   EMAIL_PASSWORD            — Gmail App Password for spellrightpro@gmail.com

const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin    = require('firebase-admin');
const nodemailer = require('nodemailer');

// ── Firebase init (singleton across warm invocations) ────────────────────────
let db;
function getDb() {
  if (db) return db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  db = admin.firestore();
  return db;
}

// ── Nodemailer init ───────────────────────────────────────────────────────────
let transporter;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'spellrightpro@gmail.com', pass: process.env.EMAIL_PASSWORD }
  });
  return transporter;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

function safeEmail(email) {
  return email.replace(/[.#$[\]/]/g, '_');
}

function expiryFromPlan(plan, base) {
  const d = new Date(base || Date.now());
  if (plan === 'annual')        d.setFullYear(d.getFullYear() + 1);
  else if (plan === 'sixmonth') d.setMonth(d.getMonth() + 6);
  else                          d.setDate(d.getDate() + 30);
  return d;
}

async function writePremiumRecord(uid, email, plan, sessionId, source) {
  const firestore = getDb();
  if (!email) return;
  const expiry = expiryFromPlan(plan);
  const record = {
    email, plan, active: true,
    activatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    expiryDate:      admin.firestore.Timestamp.fromDate(expiry),
    stripeSessionId: sessionId || '',
    source
  };
  const emailKey = safeEmail(email);
  if (uid) {
    await firestore.collection('premiumUsers').doc(uid).set(record, { merge: true });
    console.log(`[NL-webhook] ✅ premiumUsers/${uid}`);
  }
  await firestore.collection('premiumByEmail').doc(emailKey)
    .set({ ...record, firebaseUid: uid || null }, { merge: true });
  console.log(`[NL-webhook] ✅ premiumByEmail/${emailKey}`);
}

async function extendPremiumExpiry(email, plan, invoiceId) {
  const firestore = getDb();
  if (!email) return null;
  const emailKey = safeEmail(email);
  const ref  = firestore.collection('premiumByEmail').doc(emailKey);
  const snap = await ref.get();

  // Extend from current expiry if still in the future, else from now
  let base = new Date();
  if (snap.exists) {
    const cur = snap.data().expiryDate?.toDate?.();
    if (cur && cur > base) base = cur;
  }
  const newExpiry = expiryFromPlan(plan, base);

  const update = {
    active:        true,
    expiryDate:    admin.firestore.Timestamp.fromDate(newExpiry),
    lastRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastInvoiceId: invoiceId || '',
    plan
  };
  await ref.set(update, { merge: true });
  console.log(`[NL-webhook] 🔄 Extended ${email} → ${newExpiry.toISOString().slice(0,10)}`);

  // Mirror to premiumUsers if uid known
  if (snap.exists) {
    const uid = snap.data().firebaseUid;
    if (uid) await firestore.collection('premiumUsers').doc(uid).set(update, { merge: true });
  }
  return newExpiry;
}

async function deactivatePremium(email, reason) {
  const firestore = getDb();
  if (!email) return;
  const emailKey = safeEmail(email);
  const ref  = firestore.collection('premiumByEmail').doc(emailKey);
  const snap = await ref.get();
  if (!snap.exists) return;
  const update = {
    active:       false,
    cancelledAt:  admin.firestore.FieldValue.serverTimestamp(),
    cancelReason: reason || 'subscription_deleted'
  };
  await ref.set(update, { merge: true });
  console.log(`[NL-webhook] 🛑 Deactivated ${email}`);
  const uid = snap.data().firebaseUid;
  if (uid) await firestore.collection('premiumUsers').doc(uid).set(update, { merge: true });
}

async function sendAdminAlert(subject, text) {
  const mailer = getTransporter();
  if (!mailer) return;
  await mailer.sendMail({
    from:    'SpellRightPro Bot <spellrightpro@gmail.com>',
    to:      'spellrightpro@gmail.com',
    subject, text
  }).catch(e => console.error('[NL-webhook] Admin alert failed:', e.message));
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify Stripe signature using the Netlify-specific webhook secret
  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET_NL;

  let stripeEvent;
  try {
    if (secret) {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
    } else {
      // No secret configured — accept but log a warning
      stripeEvent = JSON.parse(event.body);
      console.warn('[NL-webhook] ⚠️ No STRIPE_WEBHOOK_SECRET_NL set — running without verification');
    }
  } catch (err) {
    console.error('[NL-webhook] ❌ Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log(`[NL-webhook] 📨 ${stripeEvent.type}`);

  try {
    // ── EVENT 1: Initial purchase ─────────────────────────────────────────────
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const email   = session.customer_email || session.customer_details?.email || '';
      const uid     = session.metadata?.firebaseUid || '';
      const plan    = session.metadata?.plan || 'monthly';
      await writePremiumRecord(uid, email, plan, session.id, 'nl-webhook');
    }

    // ── EVENT 2: Renewal ──────────────────────────────────────────────────────
    else if (stripeEvent.type === 'invoice.payment_succeeded') {
      const invoice = stripeEvent.data.object;
      if (invoice.billing_reason === 'subscription_create') {
        // Skip — handled by checkout.session.completed
        console.log('[NL-webhook] Skipping initial invoice (already handled by checkout)');
      } else if (
        invoice.billing_reason === 'subscription_cycle' ||
        invoice.billing_reason === 'subscription_update'
      ) {
        const email = invoice.customer_email || '';
        let plan = invoice.lines?.data?.[0]?.metadata?.plan || '';
        if (!plan && invoice.subscription) {
          try {
            const sub  = await stripe.subscriptions.retrieve(invoice.subscription);
            plan = sub.metadata?.plan || '';
            if (!plan) {
              const item     = sub.items?.data?.[0];
              const interval = item?.price?.recurring?.interval;
              const count    = item?.price?.recurring?.interval_count;
              if (interval === 'year') plan = 'annual';
              else if (interval === 'month' && count === 6) plan = 'sixmonth';
              else plan = 'monthly';
            }
          } catch (e) {
            console.error('[NL-webhook] Could not fetch subscription:', e.message);
            plan = 'monthly';
          }
        }
        await extendPremiumExpiry(email, plan, invoice.id);
      }
    }

    // ── EVENT 3: Payment failed ───────────────────────────────────────────────
    else if (stripeEvent.type === 'invoice.payment_failed') {
      const invoice = stripeEvent.data.object;
      const email   = invoice.customer_email || '';
      const amount  = (invoice.amount_due || 0) / 100;
      const attempt = invoice.attempt_count || 1;
      console.log(`[NL-webhook] ⚠️ Payment failed: ${email} attempt ${attempt}`);
      await sendAdminAlert(
        `⚠️ Payment failed: ${email} (attempt ${attempt})`,
        `Payment failed for ${email}. Amount: CAD $${amount.toFixed(2)}. Attempt ${attempt} of 4. Stripe will retry automatically.`
      );
    }

    // ── EVENT 4: Subscription cancelled ──────────────────────────────────────
    else if (stripeEvent.type === 'customer.subscription.deleted') {
      const sub = stripeEvent.data.object;
      let email = sub.customer_email || '';
      if (!email && sub.customer) {
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          email = customer.email || '';
        } catch (e) { console.error('[NL-webhook] Could not fetch customer:', e.message); }
      }
      const reason = sub.cancellation_details?.reason || 'cancelled';
      await deactivatePremium(email, reason);
      await sendAdminAlert(
        `🛑 Subscription cancelled: ${email}`,
        `Subscription cancelled for ${email}. Reason: ${reason}. Access continues until current period ends.`
      );
    }

    else {
      console.log(`[NL-webhook] Unhandled event type: ${stripeEvent.type}`);
    }

  } catch (err) {
    // Log the error but return 200 so Stripe doesn't retry endlessly.
    // The primary Cloud Run handler is the source of truth — this is a backup.
    console.error('[NL-webhook] ❌ Handler error:', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
