const express    = require("express");
const cors       = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "https://www.spellrightpro.org",
    "https://spellrightpro.org"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "stripe-signature"]
}));
app.options("*", cors());

// ── Stripe webhook MUST get raw body before express.json() parses it ─────────
app.use("/api/stripe-webhook", express.raw({ type: "application/json" }));

// ── General middleware ────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Stripe ────────────────────────────────────────────────────────────────────
let stripe;
try {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  console.log("✅ Stripe initialized");
} catch (err) {
  console.error("❌ Stripe init error:", err.message);
}

// ── Firebase Admin ────────────────────────────────────────────────────────────
let admin, db;
try {
  admin = require("firebase-admin");
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "spellrightpro-firebase" });
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "spellrightpro-firebase" });
    }
  }
  db = admin.firestore();
  console.log("✅ Firebase Admin initialized");
} catch (err) {
  console.error("❌ Firebase Admin error:", err.message);
}

// ── Email ─────────────────────────────────────────────────────────────────────
let transporter;
try {
  if (!process.env.EMAIL_PASSWORD) throw new Error("EMAIL_PASSWORD not set");
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: "spellrightpro@gmail.com", pass: process.env.EMAIL_PASSWORD }
  });
  console.log("✅ Email configured");
} catch (err) {
  console.error("❌ Email config error:", err.message);
}

// ── Plan config ───────────────────────────────────────────────────────────────
const PLANS = {
  monthly:  { name: "SpellRightPro Premium — Monthly",    amount: 500,  interval: "month", intervalCount: 1, priceId: process.env.STRIPE_PRICE_MONTHLY  || null },
  examprep: { name: "SpellRightPro Premium — Exam Prep",  amount: 1200, interval: "month", intervalCount: 3, priceId: process.env.STRIPE_PRICE_EXAMPREP || null },
  annual:   { name: "SpellRightPro Premium — Annual",     amount: 4500, interval: "year",  intervalCount: 1, priceId: process.env.STRIPE_PRICE_ANNUAL   || null },
  // Legacy aliases — all resolve to monthly
  sixmonth: { name: "SpellRightPro Premium — Monthly", amount: 500, interval: "month", intervalCount: 1, priceId: process.env.STRIPE_PRICE_MONTHLY || null },
  school:   { name: "SpellRightPro Premium — Monthly", amount: 500, interval: "month", intervalCount: 1, priceId: process.env.STRIPE_PRICE_MONTHLY || null },
  complete: { name: "SpellRightPro Premium — Monthly", amount: 500, interval: "month", intervalCount: 1, priceId: process.env.STRIPE_PRICE_MONTHLY || null },
  family:   { name: "SpellRightPro Premium — Monthly", amount: 500, interval: "month", intervalCount: 1, priceId: process.env.STRIPE_PRICE_MONTHLY || null },
};
const SITE = process.env.SITE_URL || "https://spellrightpro.org";

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL HELPERS — Customer receipt & Admin notification
// ═══════════════════════════════════════════════════════════════════════════════

async function sendCustomerReceipt({ email, customerName, plan, planLabel, amount, paymentDate, expiryStr, billingNote, txnId }) {
  if (!transporter) return;
  const SITE_URL = process.env.SITE_URL || 'https://spellrightpro.org';
  const safeName = customerName || email.split('@')[0];
  const safeAmount = parseFloat(amount || 0).toFixed(2);

  const html = `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#f4f0fc;">
    <div style="background:#fff;padding:30px 28px;">
      <div style="text-align:center;margin-bottom:24px;">
        <img src="${SITE_URL}/assets/logo.png" alt="SpellRightPro" style="height:48px;border-radius:10px;" />
      </div>
      <h1 style="font-size:1.5rem;color:#7b2ff7;margin:0 0 8px;text-align:center;">🎉 Welcome to Premium!</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 24px;text-align:center;font-size:0.95rem;">
        Hi ${safeName}, your payment was successful and your premium access is now active.
      </p>
      <div style="border:1px solid #e8e0f8;border-radius:12px;overflow:hidden;margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,#7b2ff7,#f72585);padding:14px 20px;color:#fff;font-weight:700;font-size:0.95rem;">📄 PAYMENT RECEIPT</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <tr><td style="padding:12px 20px;color:#888;border-bottom:1px solid #f0eaff;">Plan</td><td style="padding:12px 20px;color:#1a0533;font-weight:600;text-align:right;border-bottom:1px solid #f0eaff;">${planLabel}</td></tr>
          <tr><td style="padding:12px 20px;color:#888;border-bottom:1px solid #f0eaff;">Amount</td><td style="padding:12px 20px;color:#1a0533;font-weight:600;text-align:right;border-bottom:1px solid #f0eaff;">CAD $${safeAmount}</td></tr>
          <tr><td style="padding:12px 20px;color:#888;border-bottom:1px solid #f0eaff;">Payment date</td><td style="padding:12px 20px;color:#1a0533;font-weight:600;text-align:right;border-bottom:1px solid #f0eaff;">${paymentDate}</td></tr>
          <tr><td style="padding:12px 20px;color:#888;border-bottom:1px solid #f0eaff;">Active until</td><td style="padding:12px 20px;color:#1a0533;font-weight:600;text-align:right;border-bottom:1px solid #f0eaff;">${expiryStr}</td></tr>
          <tr><td style="padding:12px 20px;color:#888;border-bottom:1px solid #f0eaff;">Billing</td><td style="padding:12px 20px;color:#1a0533;font-weight:600;text-align:right;border-bottom:1px solid #f0eaff;font-size:0.82rem;">${billingNote}</td></tr>
          <tr><td style="padding:12px 20px;color:#888;">Transaction ID</td><td style="padding:12px 20px;color:#1a0533;font-family:monospace;font-size:0.78rem;text-align:right;">…${txnId}</td></tr>
        </table>
      </div>
      <h2 style="font-size:1rem;color:#1a0533;margin:0 0 12px;">Your premium access includes:</h2>
      <ul style="padding-left:20px;color:#444;line-height:1.9;font-size:0.9rem;margin:0 0 24px;">
        <li><strong>School Practice</strong> — unlimited words &amp; custom lists</li>
        <li><strong>OET Medical</strong> — full 2,257-word vocabulary</li>
        <li><strong>Spelling Bee</strong> — voice-recognition mode</li>
        <li><strong>Progress Dashboard</strong> — streak, accuracy, mastered words</li>
        <li><strong>Mistake Review</strong> — spaced repetition for missed words</li>
        <li><strong>No ads</strong> — distraction-free practice</li>
      </ul>
      <div style="text-align:center;margin:24px 0;">
        <a href="${SITE_URL}/trainer" style="display:inline-block;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:0.95rem;box-shadow:0 4px 16px rgba(123,47,247,0.3);">Start Practising Now →</a>
      </div>
      <hr style="border:none;border-top:1px solid #e8e0f8;margin:24px 0;" />
      <p style="color:#888;font-size:0.78rem;line-height:1.5;margin:0;text-align:center;">
        Need help or want to cancel? Reply to this email or visit <a href="${SITE_URL}/contact" style="color:#7b2ff7;">spellrightpro.org/contact</a>.<br/>
        Cancellations are processed within 24 hours. Access continues until your billing period ends.
      </p>
      <p style="color:#aaa;font-size:0.72rem;text-align:center;margin-top:18px;">SpellRightPro · ${SITE_URL}<br/>This is an automated receipt for your records.</p>
    </div>
  </div>`;

  const text = `Welcome to SpellRightPro Premium!\n\nHi ${safeName},\n\nYour payment was successful. Receipt:\n\nPlan: ${planLabel}\nAmount: CAD $${safeAmount}\nPayment date: ${paymentDate}\nActive until: ${expiryStr}\nBilling: ${billingNote}\nTransaction ID: ...${txnId}\n\nStart practising: ${SITE_URL}/trainer\n\nQuestions? Reply to this email or visit ${SITE_URL}/contact`;

  await transporter.sendMail({
    from:    'SpellRightPro <spellrightpro@gmail.com>',
    to:      email,
    subject: `✅ SpellRightPro Premium — Payment receipt (CAD $${safeAmount})`,
    html, text
  });
  console.log(`📧 Receipt sent to ${email}`);
}

async function sendAdminNotification({ email, customerName, plan, planLabel, amount, paymentDate, expiryStr, txnId, sessionId }) {
  if (!transporter) return;
  const ADMIN = 'spellrightpro@gmail.com';
  const safeAmount = parseFloat(amount || 0).toFixed(2);
  const safeName = customerName || '(not provided)';

  const html = `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#00c57a,#0097db);color:#fff;padding:20px;border-radius:12px;margin-bottom:20px;">
      <h2 style="margin:0;font-size:1.3rem;">🎉 New Premium Subscriber!</h2>
      <p style="margin:6px 0 0;opacity:0.9;font-size:0.9rem;">SpellRightPro just received a new subscription</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#f8f5ff;border-radius:12px;overflow:hidden;font-size:0.9rem;">
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Customer email</td><td style="padding:12px 16px;font-weight:600;text-align:right;border-bottom:1px solid #e8e0f8;">${email}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Customer name</td><td style="padding:12px 16px;font-weight:600;text-align:right;border-bottom:1px solid #e8e0f8;">${safeName}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Plan</td><td style="padding:12px 16px;font-weight:600;text-align:right;border-bottom:1px solid #e8e0f8;color:#7b2ff7;">${planLabel}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Amount</td><td style="padding:12px 16px;font-weight:700;text-align:right;border-bottom:1px solid #e8e0f8;color:#00c57a;">CAD $${safeAmount}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Payment date</td><td style="padding:12px 16px;font-weight:600;text-align:right;border-bottom:1px solid #e8e0f8;">${paymentDate}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;border-bottom:1px solid #e8e0f8;">Expires</td><td style="padding:12px 16px;font-weight:600;text-align:right;border-bottom:1px solid #e8e0f8;">${expiryStr}</td></tr>
      <tr><td style="padding:12px 16px;color:#888;">Stripe session</td><td style="padding:12px 16px;font-family:monospace;font-size:0.78rem;text-align:right;color:#666;">${(sessionId||'').slice(0,30)}…</td></tr>
    </table>
    <div style="background:#fff8e1;border-left:3px solid #ffb800;padding:12px 16px;margin:20px 0;border-radius:6px;font-size:0.85rem;color:#1a0533;">
      💡 <strong>Action:</strong> Send a personal welcome email to ${email} within 24 hours.
    </div>
    <div style="text-align:center;margin-top:20px;">
      <a href="https://dashboard.stripe.com/customers" style="display:inline-block;background:#7b2ff7;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:0.85rem;margin:0 4px;">View in Stripe</a>
      <a href="https://spellrightpro.org/admin" style="display:inline-block;background:transparent;color:#7b2ff7;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:0.85rem;border:1px solid #7b2ff7;margin:0 4px;">Admin Dashboard</a>
    </div>
  </div>`;

  await transporter.sendMail({
    from:    'SpellRightPro Bot <spellrightpro@gmail.com>',
    to:      ADMIN,
    subject: `🛒 New ${planLabel} subscriber: ${email} — CAD $${safeAmount}`,
    html,
    text: `New SpellRightPro Premium subscriber!\n\nCustomer: ${email} (${safeName})\nPlan: ${planLabel}\nAmount: CAD $${safeAmount}\nPayment date: ${paymentDate}\nExpires: ${expiryStr}\nSession: ${sessionId}\n\nView in Stripe: https://dashboard.stripe.com/customers`
  });
  console.log(`📧 Admin notification sent for ${email}`);
}

// ── Helper: write premium record to Firestore ────────────────────────────────
async function writePremiumRecord(uid, email, plan, sessionId, source, acquisition = {}) {
  if (!db || !email) return;
  const expiry = new Date();
  if (plan === 'annual')        expiry.setFullYear(expiry.getFullYear() + 1);
  else if (plan === 'sixmonth') expiry.setMonth(expiry.getMonth() + 6);
  else if (plan === 'examprep') expiry.setMonth(expiry.getMonth() + 3);
  else expiry.setMonth(expiry.getMonth() + 1);
  const record = {
    email, plan, active: true,
    activatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    expiryDate:      admin.firestore.Timestamp.fromDate(expiry),
    stripeSessionId: sessionId || "",
    source
  };
  // Only attach acquisition data if we actually have it — avoids overwriting
  // a real signup-time acquisition record with "unknown" on later writes.
  if (acquisition.utm_source) {
    record.acquisition = {
      utm_source:   acquisition.utm_source,
      utm_medium:   acquisition.utm_medium   || "none",
      utm_campaign: acquisition.utm_campaign || "none"
    };
  }
  if (uid) {
    await db.collection("premiumUsers").doc(uid).set(record, { merge: true });
    console.log(`✅ Firestore premiumUsers/${uid} [${source}]`);
  }
  const safeEmail = email.replace(/[.#$[\]/]/g, "_");
  await db.collection("premiumByEmail").doc(safeEmail)
    .set({ ...record, firebaseUid: uid || null }, { merge: true });
  console.log(`✅ Firestore premiumByEmail/${safeEmail} [${source}]`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: Renewal / Cancellation helpers (Stripe subscription lifecycle)
// ═══════════════════════════════════════════════════════════════════════════════

// Extends premium expiry on successful renewal — called by invoice.payment_succeeded.
// CRITICAL: without this, monthly subscribers lose access on day 31 even though
// Stripe successfully charged them.
async function extendPremiumExpiry(email, plan, invoiceId, amount) {
  if (!db || !email) return null;
  const safeEmail = email.replace(/[.#$[\]/]/g, "_");
  const ref = db.collection("premiumByEmail").doc(safeEmail);
  const snap = await ref.get();

  // Extend FROM current expiry (if in the future) or FROM now (if past or missing)
  let baseDate = new Date();
  if (snap.exists) {
    const data = snap.data();
    const currentExpiry = data.expiryDate && data.expiryDate.toDate ? data.expiryDate.toDate() : null;
    if (currentExpiry && currentExpiry > baseDate) baseDate = currentExpiry;
  }
  const newExpiry = new Date(baseDate);
  if (plan === 'annual')        newExpiry.setFullYear(newExpiry.getFullYear() + 1);
  else if (plan === 'sixmonth') newExpiry.setMonth(newExpiry.getMonth() + 6);
  else if (plan === 'examprep') newExpiry.setMonth(newExpiry.getMonth() + 3);
  else                          newExpiry.setDate(newExpiry.getDate() + 30);

  const update = {
    active:        true,
    expiryDate:    admin.firestore.Timestamp.fromDate(newExpiry),
    lastRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastInvoiceId: invoiceId || "",
    plan
  };
  await ref.set(update, { merge: true });
  console.log(`🔄 Extended expiry for ${email} to ${newExpiry.toISOString().slice(0,10)}`);

  // Also update the uid record if we can resolve it
  if (snap.exists) {
    const uid = snap.data().firebaseUid;
    if (uid) {
      await db.collection("premiumUsers").doc(uid).set(update, { merge: true });
    }
  }
  return newExpiry;
}

// Marks a user inactive when subscription is fully cancelled.
// We do NOT touch expiryDate — user keeps access until period ends.
async function deactivatePremium(email, reason) {
  if (!db || !email) return;
  const safeEmail = email.replace(/[.#$[\]/]/g, "_");
  const ref = db.collection("premiumByEmail").doc(safeEmail);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`⚠️  deactivatePremium: no record for ${email}`);
    return;
  }
  const update = {
    active:       false,
    cancelledAt:  admin.firestore.FieldValue.serverTimestamp(),
    cancelReason: reason || 'subscription_deleted'
  };
  await ref.set(update, { merge: true });
  console.log(`🛑 Deactivated premium for ${email} (${reason})`);

  const uid = snap.data().firebaseUid;
  if (uid) {
    await db.collection("premiumUsers").doc(uid).set(update, { merge: true });
  }
}

// Send admin alert email
async function sendAdminAlert(subject, bodyHtml, bodyText) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from:    'SpellRightPro Bot <spellrightpro@gmail.com>',
      to:      'spellrightpro@gmail.com',
      subject,
      html:    bodyHtml,
      text:    bodyText
    });
  } catch (e) {
    console.error('Admin alert failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/",          (_, res) => res.json({ status: "ok", service: "SpellRightPro API" }));
app.get("/test",      (_, res) => res.json({ status: "ok" }));
app.get("/api/health",(_, res) => res.json({
  status: "healthy", stripe: !!stripe, firebase: !!db, email: !!transporter,
  plans: {
    monthly:  { amount: 500,  priceId: PLANS.monthly.priceId  },
    examprep: { amount: 1200, priceId: PLANS.examprep.priceId },
    annual:   { amount: 4500, priceId: PLANS.annual.priceId   }
  },
  timestamp: new Date().toISOString()
}));

// ── CREATE CHECKOUT SESSION ──────────────────────────────────────────────────
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured on server" });
    const { plan = "complete", email, firebaseUid = "", attribution = {} } = req.body;
    const planInfo = PLANS[plan] || PLANS.complete;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    // Attribution fields — Stripe metadata values must be strings, max 500 chars each
    const utmSource   = String(attribution.utm_source   || "direct").slice(0, 500);
    const utmMedium   = String(attribution.utm_medium   || "none").slice(0, 500);
    const utmCampaign = String(attribution.utm_campaign || "none").slice(0, 500);
    const lineItems = planInfo.priceId
      ? [{ price: planInfo.priceId, quantity: 1 }]
      : [{
          price_data: {
            currency: "cad", unit_amount: planInfo.amount,
            recurring: { interval: planInfo.interval || "month" },
            product_data: {
              name: planInfo.name,
              description: planInfo.interval === "year"
                ? "Annual subscription — CAD $45/yr (save 25%) — cancel anytime"
                : "Monthly subscription — CAD $5/mo — cancel anytime"
            }
          },
          quantity: 1
        }];
    const session = await stripe.checkout.sessions.create({
      mode:                 "subscription",
      payment_method_types: ["card"],
      customer_email:       email,
      line_items:           lineItems,
      metadata:             { plan, email, firebaseUid, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign },
      subscription_data:    { metadata: { plan, email, firebaseUid, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign } },
      success_url: `${SITE}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&plan=${encodeURIComponent(planInfo.name)}`,
      cancel_url:  `${SITE}/premium.html?cancelled=1`,
      allow_promotion_codes: true
    });
    console.log(`✅ Checkout session: ${session.id} | ${email} | ${plan}`);
    res.json({ url: session.url, sessionUrl: session.url, sessionId: session.id, success: true });
  } catch (err) {
    console.error("❌ create-checkout-session:", err.message);
    res.status(500).json({ error: err.message, success: false });
  }
});

// ── VERIFY SESSION ────────────────────────────────────────────────────────────
app.get("/api/verify-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ paid: false, error: "Stripe not configured" });
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ paid: false, error: "session_id required" });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paid    = session.payment_status === "paid";
    const email   = session.customer_email || (session.customer_details && session.customer_details.email) || "";
    const plan    = (session.metadata && session.metadata.plan) || "complete";
    const uid     = (session.metadata && session.metadata.firebaseUid) || "";
    const acquisition = {
      utm_source:   session.metadata && session.metadata.utm_source,
      utm_medium:   session.metadata && session.metadata.utm_medium,
      utm_campaign: session.metadata && session.metadata.utm_campaign
    };
    console.log(`🔍 verify-session: ${session_id} paid=${paid} ${email}`);
    if (paid) {
      await writePremiumRecord(uid, email, plan, session_id, "verify_session", acquisition).catch(e =>
        console.error("Firestore write failed (non-critical):", e.message)
      );
    }
    res.json({ paid, email, plan, sessionId: session_id });
  } catch (err) {
    console.error("❌ verify-session:", err.message);
    res.status(500).json({ paid: false, error: err.message });
  }
});

// ── STRIPE WEBHOOK (handles 4 events) ─────────────────────────────────────────
// 1. checkout.session.completed   — initial purchase (welcome + receipt)
// 2. invoice.payment_succeeded    — renewal (extends expiryDate, sends receipt)
// 3. invoice.payment_failed       — card declined (admin alert, Stripe auto-retries)
// 4. customer.subscription.deleted — cancellation (marks active:false)
app.post("/api/stripe-webhook", async (req, res) => {
  const sig    = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  if (secret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).json({ error: "Signature verification failed" });
    }
  } else {
    try { event = JSON.parse(req.body.toString()); } catch { event = {}; }
    console.warn("⚠️  Webhook running without signature verification — set STRIPE_WEBHOOK_SECRET");
  }

  // ─── EVENT 1: Initial purchase ──────────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email   = session.customer_email || (session.customer_details && session.customer_details.email) || "";
    const uid     = (session.metadata && session.metadata.firebaseUid) || "";
    const plan    = (session.metadata && session.metadata.plan) || "complete";
    const amount  = (session.amount_total || 0) / 100;
    const acquisition = {
      utm_source:   session.metadata && session.metadata.utm_source,
      utm_medium:   session.metadata && session.metadata.utm_medium,
      utm_campaign: session.metadata && session.metadata.utm_campaign
    };

    console.log(`💳 Webhook: ${event.type} | ${email} | ${plan} | $${amount} | ${acquisition.utm_source || 'direct'}`);

    await writePremiumRecord(uid, email, plan, session.id, "webhook", acquisition).catch(e =>
      console.error("Webhook Firestore write failed:", e.message)
    );

    if (transporter && email) {
      const expiry = new Date();
      if (plan === 'annual')        expiry.setFullYear(expiry.getFullYear() + 1);
      else if (plan === 'sixmonth') expiry.setMonth(expiry.getMonth() + 6);
  else if (plan === 'examprep') expiry.setMonth(expiry.getMonth() + 3);
      else                          expiry.setDate(expiry.getDate() + 30);
      const expiryStr = expiry.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      const paymentDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      const planLabel = plan === 'annual'   ? 'Annual (12 months)'
                      : plan === 'sixmonth' ? '6 months'
                      : 'Monthly (1 month)';
      const billingNote = plan === 'annual'   ? 'Renews yearly until cancelled'
                        : plan === 'sixmonth' ? 'Renews every 6 months until cancelled'
                        : 'Renews monthly until cancelled';
      const txnId = (session.id || '').slice(-12);
      const customerName = (session.customer_details && session.customer_details.name) || email.split('@')[0];

      sendCustomerReceipt({
        email, customerName, plan, planLabel, amount,
        paymentDate, expiryStr, billingNote, txnId
      }).catch(e => console.error('Customer email failed:', e.message));

      sendAdminNotification({
        email, customerName, plan, planLabel, amount,
        paymentDate, expiryStr, txnId, sessionId: session.id
      }).catch(e => console.error('Admin email failed:', e.message));
    }
  }

  // ─── EVENT 2: Renewal (subscription cycle) ──────────────────────────────────
  else if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;

    // Skip the first invoice — already handled by checkout.session.completed
    if (invoice.billing_reason === 'subscription_create') {
      console.log(`💳 Webhook: ${event.type} | initial invoice — already handled`);
    } else if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update') {
      const email  = invoice.customer_email || "";
      const amount = (invoice.amount_paid || 0) / 100;

      // Resolve plan key — try invoice metadata first, fall back to subscription lookup
      let plan = (invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].metadata && invoice.lines.data[0].metadata.plan) || "";
      if (!plan && invoice.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          plan = (sub.metadata && sub.metadata.plan) || "";
          if (!plan) {
            // Infer from price interval
            const item = sub.items && sub.items.data && sub.items.data[0];
            const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
            const count    = item && item.price && item.price.recurring && item.price.recurring.interval_count;
            if (interval === 'year') plan = 'annual';
            else if (interval === 'month' && count === 6) plan = 'sixmonth';
            else plan = 'monthly';
          }
        } catch (e) {
          console.error('Could not fetch subscription:', e.message);
          plan = 'monthly';
        }
      }

      console.log(`🔄 Webhook: ${event.type} | ${email} | ${plan} | $${amount} | renewal`);

      const newExpiry = await extendPremiumExpiry(email, plan, invoice.id, amount).catch(e => {
        console.error('Renewal Firestore update failed:', e.message);
        return null;
      });

      // Send a brief renewal receipt to the customer
      if (transporter && email && newExpiry) {
        const planLabel = plan === 'annual' ? 'Annual' : plan === 'sixmonth' ? '6 months' : 'Monthly';
        const expiryStr = newExpiry.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
        const safeAmount = parseFloat(amount || 0).toFixed(2);
        transporter.sendMail({
          from:    'SpellRightPro <spellrightpro@gmail.com>',
          to:      email,
          subject: `✅ SpellRightPro Premium renewed (CAD $${safeAmount})`,
          html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <h2 style="color:#7b2ff7;">🔄 Subscription renewed</h2>
            <p>Hi, your <strong>${planLabel}</strong> subscription was successfully renewed for CAD $${safeAmount}.</p>
            <p>Premium access continues until <strong>${expiryStr}</strong>.</p>
            <p style="margin-top:24px;">
              <a href="https://spellrightpro.org/trainer" style="background:#7b2ff7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Continue practising →</a>
            </p>
            <p style="color:#888;font-size:0.82rem;margin-top:24px;">To cancel future renewals, reply to this email or visit spellrightpro.org/contact. Access continues until the end of the period you've paid for.</p>
          </div>`,
          text: `Your SpellRightPro ${planLabel} subscription was renewed for CAD $${safeAmount}.\nPremium access continues until ${expiryStr}.\nContinue: https://spellrightpro.org/trainer`
        }).catch(e => console.error('Renewal email failed:', e.message));
      }
    }
  }

  // ─── EVENT 3: Payment failed (card declined / expired) ──────────────────────
  else if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const email   = invoice.customer_email || "";
    const amount  = (invoice.amount_due || 0) / 100;
    const attempt = invoice.attempt_count || 1;
    console.log(`⚠️  Webhook: ${event.type} | ${email} | $${amount} | attempt ${attempt}`);

    sendAdminAlert(
      `⚠️ Payment failed: ${email} (attempt ${attempt})`,
      `<div style="font-family:Arial,sans-serif;max-width:520px;">
        <h2 style="color:#c0005a;">Payment retry needed</h2>
        <p><strong>Customer:</strong> ${email}</p>
        <p><strong>Amount:</strong> CAD $${parseFloat(amount).toFixed(2)}</p>
        <p><strong>Attempt:</strong> ${attempt} of 4</p>
        <p>Stripe will retry automatically. If all retries fail, the subscription will be cancelled and you'll get a separate notification. No action needed right now.</p>
      </div>`,
      `Payment failed: ${email} ($${amount}, attempt ${attempt}). Stripe will retry automatically.`
    );
  }

  // ─── EVENT 4: Subscription cancelled (user-initiated or retries exhausted) ──
  else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    let email = sub.customer_email || "";
    if (!email && sub.customer) {
      try {
        const customer = await stripe.customers.retrieve(sub.customer);
        email = customer.email || "";
      } catch (e) { console.error('Could not fetch customer email:', e.message); }
    }
    const reason = (sub.cancellation_details && sub.cancellation_details.reason) || 'cancelled';
    console.log(`🛑 Webhook: ${event.type} | ${email} | reason: ${reason}`);

    await deactivatePremium(email, reason).catch(e =>
      console.error('Deactivation failed:', e.message)
    );

    sendAdminAlert(
      `🛑 Subscription cancelled: ${email}`,
      `<div style="font-family:Arial,sans-serif;max-width:520px;">
        <h2 style="color:#7b6f8a;">Subscription cancelled</h2>
        <p><strong>Customer:</strong> ${email}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>The user retains access until their current billing period ends, then access reverts to free. Their record has been marked active:false in Firestore.</p>
        <p style="font-size:0.85rem;color:#888;">If you'd like to reach out to ask why they cancelled, this is a great opportunity to learn what could be improved.</p>
      </div>`,
      `Subscription cancelled: ${email} (${reason}). Access continues until current period ends.`
    );
  }

  res.json({ received: true });
});

// ── SEND CONFIRMATION (fallback) ──────────────────────────────────────────────
app.post("/api/send-confirmation", async (req, res) => {
  try {
    const { email, customerName, plan = 'monthly', planName, amount, sessionId } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "email required" });

    if (transporter) {
      const expiry = new Date();
      if (plan === 'annual')        expiry.setFullYear(expiry.getFullYear() + 1);
      else if (plan === 'sixmonth') expiry.setMonth(expiry.getMonth() + 6);
  else if (plan === 'examprep') expiry.setMonth(expiry.getMonth() + 3);
      else                          expiry.setDate(expiry.getDate() + 30);
      const expiryStr   = expiry.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      const paymentDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      const planLabel = plan === 'annual'   ? 'Annual (12 months)'
                      : plan === 'sixmonth' ? '6 months'
                      : 'Monthly (1 month)';
      const billingNote = plan === 'annual'   ? 'Renews yearly until cancelled'
                        : plan === 'sixmonth' ? 'Renews every 6 months until cancelled'
                        : 'Renews monthly until cancelled';
      const txnId = (sessionId || '').slice(-12) || 'pending';
      const name = customerName || email.split('@')[0];

      sendCustomerReceipt({
        email, customerName: name, plan, planLabel, amount,
        paymentDate, expiryStr, billingNote, txnId
      }).catch(e => console.error('Customer email failed:', e.message));

      sendAdminNotification({
        email, customerName: name, plan, planLabel, amount,
        paymentDate, expiryStr, txnId, sessionId: sessionId || ''
      }).catch(e => console.error('Admin email failed:', e.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ send-confirmation:", err.message);
    res.json({ success: true, note: "order noted" });
  }
});

// ─── Welcome email endpoint ───────────────────────────────────────────────────
app.post('/api/email/welcome', async (req, res) => {
  try {
    const { email, plan = 'premium' } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'email required' });
    if (!transporter) return res.json({ success: false, message: 'email not configured' });

    const planLabel = plan === 'annual'   ? 'Complete Premium — Annual (CAD $45/yr)'
                    : plan === 'sixmonth' ? 'Complete Premium — 6 months (CAD $26)'
                    : 'Complete Premium — Monthly (CAD $5/mo)';

    await transporter.sendMail({
      from:    'SpellRightPro <spellrightpro@gmail.com>',
      to:      email,
      subject: "🎉 Welcome to SpellRightPro Premium — you're all set!",
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;">
        <img src="https://spellrightpro.org/assets/logo.png" alt="SpellRightPro" style="height:48px;border-radius:12px;margin-bottom:20px;" />
        <h1 style="font-size:1.5rem;color:#7b2ff7;margin:0 0 8px;">Welcome to Premium! 🎉</h1>
        <p style="color:#444;line-height:1.6;margin:0 0 20px;">Your subscription is active and all three practice modules are now unlocked.</p>
        <div style="background:#f4f0fc;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;"><strong>Plan:</strong> ${planLabel}</p>
          <p style="margin:0;">Your premium features are active immediately.</p>
        </div>
        <a href="https://spellrightpro.org/trainer" style="display:inline-block;margin-top:8px;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:1rem;">Start Practising Now →</a>
        <p style="color:#888;font-size:0.82rem;margin-top:32px;line-height:1.5;">Questions? Reply to this email or visit <a href="https://spellrightpro.org/contact" style="color:#7b2ff7;">spellrightpro.org/contact</a>.<br/>To cancel your subscription at any time, email us and we will handle it within 24 hours.</p>
      </div>`,
      text: `Welcome to SpellRightPro Premium!\nPlan: ${planLabel}\n\nStart practising: https://spellrightpro.org/trainer\n\nQuestions? spellrightpro@gmail.com`
    });
    console.log(`📧 Welcome email sent to ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Welcome email error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Admin dashboard data endpoint ────────────────────────────────────────────
// Returns premium subscriber and free-user data for the admin dashboard.
// Uses the Admin SDK (bypasses Firestore security rules) so the client-side
// admin page doesn't need direct Firestore read permissions.
// Protected by ADMIN_TOKEN — same token used by word-admin and ai-creative.
app.post('/api/admin/dashboard', async (req, res) => {
  const token = req.body && req.body.token;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || token !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db) return res.json({ error: 'Firestore not available' });

  try {
    // Premium users — read from premiumByEmail (the complete, authoritative source)
    let premSnap;
    try {
      premSnap = await db.collection('premiumByEmail')
        .orderBy('activatedAt', 'desc')
        .limit(50)
        .get();
    } catch (e) {
      premSnap = await db.collection('premiumByEmail').limit(50).get();
    }

    const premiumUsers = premSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        email: d.email || null,
        plan: d.plan || 'monthly',
        active: d.active !== false,
        activatedAt: d.activatedAt ? d.activatedAt.toDate().toISOString() : null,
        expiryDate: d.expiryDate ? d.expiryDate.toDate().toISOString() : null,
        source: d.source || 'stripe',
        acquisition: d.acquisition || null
      };
    });

    // Free users — read from users collection
    let freeSnap;
    try {
      freeSnap = await db.collection('users')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get();
    } catch (e) {
      try { freeSnap = await db.collection('users').limit(30).get(); }
      catch (e2) { freeSnap = { docs: [] }; }
    }

    const freeUsers = freeSnap.docs.map(doc => {
      const d = doc.data();
      return {
        uid: doc.id,
        email: d.email || null,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        reengageSent: !!d.reengageSent,
        acquisition: d.acquisition || null
      };
    });

    res.json({ premiumUsers, freeUsers });
  } catch (err) {
    console.error('❌ Admin dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Re-engagement endpoint ───────────────────────────────────────────────────
app.post('/api/email/reengage', async (req, res) => {
  const secret = req.headers['x-scheduler-secret'];
  if (process.env.SCHEDULER_SECRET && secret !== process.env.SCHEDULER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.body && req.body.email) {
    const { email, name } = req.body;
    try {
      await sendReengageEmail(email, name || email.split('@')[0]);
      return res.json({ success: true, sent: 1 });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
  if (!db) return res.json({ success: false, message: 'Firestore not available', sent: 0 });
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStart = new Date(threeDaysAgo); threeDaysAgoStart.setHours(0,0,0,0);
    const threeDaysAgoEnd   = new Date(threeDaysAgo); threeDaysAgoEnd.setHours(23,59,59,999);

    const usersSnap = await db.collection('users')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(threeDaysAgoStart))
      .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(threeDaysAgoEnd))
      .get();

    let sent = 0;
    for (const doc of usersSnap.docs) {
      const user = doc.data();
      if (!user.email) continue;
      // Check premiumByEmail (by email), not premiumUsers (by uid) — premiumUsers
      // is only written when a Firebase UID was captured at checkout, so relying
      // on it here risked sending "try premium" emails to existing subscribers.
      const safeEmail = user.email.replace(/[.#$[\]/]/g, "_");
      const premSnap = await db.collection('premiumByEmail').doc(safeEmail).get();
      if (premSnap.exists && premSnap.data().active) continue;
      if (user.reengageSent) continue;

      // Skip users who also exist in freeLeads — the nurture sequence
      // (day 3/7/14) handles them with segment-aware copy. Without this
      // check, a user in both collections would get the generic re-engage
      // email AND the nurture day-3 email on the same day.
      try {
        const leadDoc = await db.collection('freeLeads').doc(safeEmail).get();
        if (leadDoc.exists) continue;
      } catch (_) {}

      await sendReengageEmail(user.email, user.displayName || user.email.split('@')[0]);
      await db.collection('users').doc(doc.id).update({ reengageSent: true });
      sent++;
    }
    console.log(`📧 Re-engage: sent to ${sent} users`);
    res.json({ success: true, sent });
  } catch (err) {
    console.error('❌ Re-engage batch error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function sendReengageEmail(email, name) {
  if (!transporter) throw new Error('Email not configured');
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  await transporter.sendMail({
    from:    'SpellRightPro <spellrightpro@gmail.com>',
    to:      email,
    subject: `${displayName}, your spelling practice is waiting 📚`,
    html: `<div style="font-family:'DM Sans',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
      <img src="https://spellrightpro.org/assets/logo.png" alt="SpellRightPro" style="height:48px;border-radius:12px;margin-bottom:20px;" />
      <h1 style="font-size:1.4rem;color:#7b2ff7;margin:0 0 8px;">Ready to keep improving, ${displayName}?</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">You tried SpellRightPro a few days ago. Even 5 minutes a day makes a difference.</p>
      <a href="https://spellrightpro.org" style="display:inline-block;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:1rem;">Continue Practising — Free →</a>
      <div style="margin-top:28px;padding:16px;background:#fef9ee;border-radius:10px;border-left:3px solid #ffb800;">
        <p style="margin:0;font-size:0.9rem;color:#444;"><strong>Want to go further?</strong> Premium from <strong>CAD $5/month</strong>. Cancel anytime.</p>
        <a href="https://spellrightpro.org/premium" style="display:inline-block;margin-top:10px;color:#7b2ff7;font-weight:700;font-size:0.9rem;text-decoration:none;">See Premium Plans →</a>
      </div>
    </div>`,
    text: `Hi ${displayName},\n\nYour SpellRightPro practice sessions are still waiting.\n\nStart free: https://spellrightpro.org`
  });
  console.log(`📧 Re-engage email sent to ${email}`);
}

// ─── Renewal reminder endpoint ────────────────────────────────────────────────
app.post('/api/email/renewal', async (req, res) => {
  const secret = req.headers['x-scheduler-secret'];
  if (process.env.SCHEDULER_SECRET && secret !== process.env.SCHEDULER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.body && req.body.email) {
    const { email, plan, expiryDate } = req.body;
    try {
      await sendRenewalEmail(email, plan || 'premium', expiryDate || 'soon');
      return res.json({ success: true, sent: 1 });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
  if (!db) return res.json({ success: false, message: 'Firestore not available', sent: 0 });
  try {
    const sevenDaysFromNow = new Date(); sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const windowStart = new Date(sevenDaysFromNow); windowStart.setHours(0,0,0,0);
    const windowEnd   = new Date(sevenDaysFromNow); windowEnd.setHours(23,59,59,999);

    // premiumByEmail is queried here, not premiumUsers — premiumUsers is only
    // written when a Firebase UID was captured at checkout. Using premiumUsers
    // would silently skip renewal reminders for subscribers who checked out
    // without being logged in first.
    const snap = await db.collection('premiumByEmail')
      .where('active', '==', true)
      .where('expiryDate', '>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('expiryDate', '<=', admin.firestore.Timestamp.fromDate(windowEnd))
      .get();

    let sent = 0;
    for (const doc of snap.docs) {
      const user = doc.data();
      if (!user.email) continue;
      if (user.renewalReminderSent) continue;
      const expiryStr = user.expiryDate.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      await sendRenewalEmail(user.email, user.plan || 'premium', expiryStr);
      await db.collection('premiumByEmail').doc(doc.id).update({ renewalReminderSent: true });
      sent++;
    }
    console.log(`📧 Renewal reminders sent to ${sent} users`);
    res.json({ success: true, sent });
  } catch (err) {
    console.error('❌ Renewal reminder error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function sendRenewalEmail(email, plan, expiryStr) {
  if (!transporter) throw new Error('Email not configured');
  const planLabel = plan === 'annual' ? 'Annual' : plan === 'sixmonth' ? '6 months' : 'Monthly';
  const siteUrl   = process.env.SITE_URL || 'https://spellrightpro.org';
  await transporter.sendMail({
    from:    'SpellRightPro <spellrightpro@gmail.com>',
    to:      email,
    subject: '⏰ Your SpellRightPro Premium expires in 7 days',
    html: `<div style="font-family:'DM Sans',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
      <img src="${siteUrl}/assets/logo.png" alt="SpellRightPro" style="height:48px;border-radius:12px;margin-bottom:20px;" />
      <h1 style="font-size:1.4rem;color:#7b2ff7;margin:0 0 8px;">Your Premium access expires on ${expiryStr}</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">Your SpellRightPro ${planLabel} subscription expires in 7 days. If your subscription renews automatically, no action is needed.</p>
      <div style="background:#f4f0fc;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;"><strong>Current plan:</strong> ${planLabel} Premium</p>
        <p style="margin:0;"><strong>Expires:</strong> ${expiryStr}</p>
      </div>
      <a href="${siteUrl}/premium" style="display:inline-block;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:1rem;">Renew Premium →</a>
    </div>`,
    text: `Your SpellRightPro ${planLabel} Premium expires on ${expiryStr}.\nRenew: ${siteUrl}/premium`
  });
  console.log(`📧 Renewal reminder sent to ${email}`);
}

// ── Daily email checks ────────────────────────────────────────────────────────
// ── Nurture email sequence ───────────────────────────────────────────────────
// Sends Day 3, Day 7, and Day 14 follow-up emails to free-tier users who signed
// up via the word-6 auth wall (stored in the freeLeads collection by save-lead.js).
// Each email is segment-aware (OET / School / Bee) and sends once per stage.
app.post('/api/email/nurture', async (req, res) => {
  const secret = req.headers['x-scheduler-secret'];
  if (process.env.SCHEDULER_SECRET && secret !== process.env.SCHEDULER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db) return res.json({ success: false, message: 'Firestore not available', sent: 0 });

  const siteUrl = 'https://www.spellrightpro.org';
  const now = new Date();
  let sent = 0;

  try {
    const leadsSnap = await db.collection('freeLeads').limit(200).get();

    for (const doc of leadsSnap.docs) {
      const lead = doc.data();
      if (!lead.email || !lead.signedUpAt) continue;

      const signedUp = lead.signedUpAt.toDate();
      const daysSince = Math.floor((now - signedUp) / 86400000);
      const audience = lead.audience || 'oet';
      const name = lead.email.split('@')[0];
      const displayName = name.charAt(0).toUpperCase() + name.slice(1);

      // Determine which email to send (if any)
      let stage = null;
      if (daysSince >= 3 && daysSince < 7 && !lead.nurture_day3) stage = 'day3';
      else if (daysSince >= 7 && daysSince < 14 && !lead.nurture_day7) stage = 'day7';
      else if (daysSince >= 14 && !lead.nurture_day14) stage = 'day14';

      if (!stage) continue;

      // Check if they already converted to premium — skip if so
      const safeEmail = lead.email.replace(/[.#$[\]/]/g, '_');
      try {
        const premSnap = await db.collection('premiumByEmail').doc(safeEmail).get();
        if (premSnap.exists && premSnap.data().active) continue;
      } catch (_) {}

      const landingUrl = audience === 'bee' ? siteUrl + '/freemium-bee'
                       : audience === 'school' ? siteUrl + '/freemium-school'
                       : siteUrl + '/freemium-oet';

      try {
        await sendNurtureEmail(lead.email, displayName, audience, stage, landingUrl, siteUrl);
        await db.collection('freeLeads').doc(doc.id).update({ [`nurture_${stage}`]: true });
        sent++;
      } catch (e) {
        console.error(`Nurture ${stage} failed for ${lead.email}:`, e.message);
      }
    }

    res.json({ success: true, sent });
  } catch (err) {
    console.error('❌ Nurture endpoint error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function sendNurtureEmail(email, displayName, audience, stage, landingUrl, siteUrl) {
  if (!transporter) throw new Error('Email not configured');

  const segmentLabel = audience === 'bee' ? 'Spelling Bee' : audience === 'school' ? 'School' : 'OET';

  const templates = {
    day3: {
      subject: `${displayName}, quick spelling tip for your ${segmentLabel} practice`,
      heading: `A quick tip for your ${segmentLabel} practice`,
      body: audience === 'oet'
        ? `Many OET candidates lose easy marks on commonly misspelled medical terms — words like <em>haemorrhage</em>, <em>ophthalmology</em>, and <em>diarrhoea</em>. Even 5 minutes of daily practice makes a measurable difference on test day.`
        : audience === 'school'
        ? `The best spellers aren't born — they practise little and often. Even 5 minutes a day builds the kind of automatic recall that makes spelling tests feel easy.`
        : `Competition-level spelling comes down to pattern recognition. The more unusual words you practise hearing and writing, the more your brain starts to recognise roots and letter patterns automatically.`,
      cta: 'Practice now — free →',
      ctaUrl: landingUrl
    },
    day7: {
      subject: `Your ${segmentLabel} spelling is improving, ${displayName}`,
      heading: `One week in — here's what consistent practice looks like`,
      body: audience === 'oet'
        ? `SpellRightPro was built by a doctor who went through OET prep. The 2,257-word medical list isn't random — it's curated from real OET exam patterns. Consistency beats cramming: short daily sessions build the muscle memory that holds up under exam pressure.`
        : audience === 'school'
        ? `Teachers consistently say that students who practise spelling regularly — even briefly — outperform those who cram before a test. SpellRightPro's built-in word lists are matched to how schools actually test spelling.`
        : `A week of consistent practice builds real pattern recognition. SpellRightPro's curated competition word lists are designed to stretch your range systematically, not just test what you already know.`,
      cta: 'Keep your streak going →',
      ctaUrl: landingUrl
    },
    day14: {
      subject: `Ready to go further, ${displayName}?`,
      heading: `You've been practising for two weeks`,
      body: audience === 'oet'
        ? `Two weeks of practice puts you ahead of most OET candidates on spelling. Premium unlocks unlimited daily sessions, mistake review drills, adaptive difficulty, and all three accents (British, American, Australian) — the tools that turn good spelling into exam-day confidence.`
        : audience === 'school'
        ? `Two weeks in, and your spelling muscles are warmed up. Premium unlocks unlimited sessions, mistake review (so you drill the words you actually got wrong), and progress tracking that shows real improvement over time.`
        : `Two weeks of competition prep is a strong foundation. Premium gives you unlimited sessions, adaptive drills that focus on your weak spots, and mistake review — the tools serious competitors use to push past plateaus.`,
      cta: 'See what Premium includes →',
      ctaUrl: siteUrl + '/premium'
    }
  };

  const t = templates[stage];
  const premiumNote = stage === 'day14' ? '' : `
      <div style="margin-top:28px;padding:16px;background:#fef9ee;border-radius:10px;border-left:3px solid #ffb800;">
        <p style="margin:0;font-size:0.9rem;color:#444;"><strong>Want unlimited sessions?</strong> Premium from <strong>CAD $5/month</strong>. Cancel anytime.</p>
        <a href="${siteUrl}/premium" style="display:inline-block;margin-top:10px;color:#7b2ff7;font-weight:700;font-size:0.9rem;text-decoration:none;">See Premium Plans →</a>
      </div>`;

  await transporter.sendMail({
    from: 'SpellRightPro <spellrightpro@gmail.com>',
    to: email,
    subject: t.subject,
    html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
      <img src="https://spellrightpro.org/assets/logo.png" alt="SpellRightPro" style="height:48px;border-radius:12px;margin-bottom:20px;" />
      <h1 style="font-size:1.3rem;color:#7b2ff7;margin:0 0 12px;">${t.heading}</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">${t.body}</p>
      <a href="${t.ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:1rem;">${t.cta}</a>${premiumNote}
      <p style="margin:28px 0 0;font-size:0.75rem;color:#999;">You're receiving this because you created a free account on SpellRightPro. <a href="${siteUrl}" style="color:#999;">spellrightpro.org</a></p>
    </div>`,
    text: `${t.heading}\n\n${t.body.replace(/<[^>]+>/g, '')}\n\n${t.cta}: ${t.ctaUrl}`
  });
  console.log(`📧 Nurture ${stage} (${audience}) sent to ${email}`);
}

function runDailyEmailChecks() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Scheduler-Secret': process.env.SCHEDULER_SECRET || 'internal'
  };
  const base = `http://localhost:${process.env.PORT || 8080}`;

  setTimeout(() => {
    fetch(base + '/api/email/reengage', { method: 'POST', headers })
      .then(r => r.json())
      .then(d => console.log('✅ Re-engage check:', d.sent || 0, 'emails sent'))
      .catch(e => console.error('Re-engage check error:', e.message));
  }, 2000);

  setTimeout(() => {
    fetch(base + '/api/email/renewal', { method: 'POST', headers })
      .then(r => r.json())
      .then(d => console.log('✅ Renewal reminder check:', d.sent || 0, 'emails sent'))
      .catch(e => console.error('Renewal check error:', e.message));
  }, 5000);

  setTimeout(() => {
    fetch(base + '/api/email/nurture', { method: 'POST', headers })
      .then(r => r.json())
      .then(d => console.log('✅ Nurture sequence check:', d.sent || 0, 'emails sent'))
      .catch(e => console.error('Nurture check error:', e.message));
  }, 8000);
}

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  setTimeout(runDailyEmailChecks, 10000);
  setInterval(runDailyEmailChecks, 24 * 60 * 60 * 1000);
  console.log(`
╔═══════════════════════════════════════════════════════╗
║        SpellRightPro API — Port ${PORT}                ║
╠═══════════════════════════════════════════════════════╣
║  GET  /                           health              ║
║  GET  /api/health                 detailed health     ║
║  POST /api/create-checkout-session Stripe checkout    ║
║  POST /api/stripe-webhook         4 events handled    ║
║  POST /api/send-confirmation      email fallback      ║
║  Env: STRIPE_PRICE_MONTHLY, _SIXMONTH, _ANNUAL        ║
╚═══════════════════════════════════════════════════════╝`);
});
