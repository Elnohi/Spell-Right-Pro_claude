// /netlify/functions/save-lead.js
// Saves a free-tier lead (email + audience) to Firestore and sends a welcome email.
//
// POST /.netlify/functions/save-lead
// Body: { email: "...", audience: "oet"|"school"|"bee" }
// Response: { ok: true } on success, { error: "..." } on failure

const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');

// ── Firebase init (singleton) ─────────────────────────────────────────────────
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

// ── Nodemailer init (same pattern as stripe-webhook.js) ──────────────────────
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

// ── Audience labels ───────────────────────────────────────────────────────────
const AUDIENCE_META = {
  oet:    { label: 'OET',        url: 'https://www.spellrightpro.org/freemium-oet',    subject: 'Your free OET spelling practice is saved' },
  school: { label: 'School',     url: 'https://www.spellrightpro.org/freemium-school', subject: 'Your free spelling practice is saved' },
  bee:    { label: 'Spelling Bee', url: 'https://www.spellrightpro.org/freemium-bee',  subject: 'Your free Spelling Bee practice is saved' }
};

// ── CORS headers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email    = (body.email    || '').trim().toLowerCase();
  const audience = (body.audience || 'oet').trim().toLowerCase();

  // Basic email validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid email address' }) };
  }
  if (!AUDIENCE_META[audience]) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid audience' }) };
  }

  const meta = AUDIENCE_META[audience];

  // ── 1. Save to Firestore ──────────────────────────────────────────────────
  try {
    const firestore = getDb();
    // Use email as doc ID (sanitised) so duplicate submissions are idempotent
    const docId = email.replace(/[.#$[\]/]/g, '_');
    await firestore.collection('freeLeads').doc(docId).set({
      email,
      audience,
      signedUpAt:  admin.firestore.FieldValue.serverTimestamp(),
      source:      'freemium_session_complete',
      emailSent:   false   // updated to true after successful send below
    }, { merge: true });
    console.log(`[save-lead] Saved lead: ${email} (${audience})`);
  } catch (err) {
    console.error('[save-lead] Firestore write failed:', err.message);
    // Don't block the response — still try to send the email
  }

  // ── 2. Send welcome email ─────────────────────────────────────────────────
  const mailer = getTransporter();
  if (mailer) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr>
          <td style="background:linear-gradient(135deg,#7b2ff7,#f72585);padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">SpellRightPro</p>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.8);">Built by a doctor who passed the OET</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111;">Your free ${meta.label} practice session is saved.</p>
            <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6;">
              Thanks for practicing with SpellRightPro. You get <strong>24 free exam-style words every day</strong>, no signup required each time.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
              Come back tomorrow and your next free session will be waiting.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#7b2ff7,#f72585);border-radius:8px;padding:14px 28px;text-align:center;">
                  <a href="${meta.url}" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Practice again tomorrow →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#666;line-height:1.6;">
              Want unlimited sessions, mistake review, and adaptive drills? Premium is <strong>CAD $5/month</strong> — less than a coffee.
            </p>
            <p style="margin:0;font-size:14px;">
              <a href="https://www.spellrightpro.org/premium" style="color:#7b2ff7;font-weight:600;text-decoration:none;">See what premium includes →</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #eeeeee;text-align:center;">
            <p style="margin:0;font-size:12px;color:#999;">
              You're receiving this because you entered your email on SpellRightPro.<br>
              <a href="https://www.spellrightpro.org" style="color:#999;">spellrightpro.org</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      await mailer.sendMail({
        from:    'SpellRightPro <spellrightpro@gmail.com>',
        to:      email,
        subject: meta.subject,
        html
      });
      console.log(`[save-lead] Welcome email sent to ${email}`);

      // Mark emailSent in Firestore
      try {
        const firestore = getDb();
        const docId = email.replace(/[.#$[\]/]/g, '_');
        await firestore.collection('freeLeads').doc(docId).update({ emailSent: true });
      } catch (_) {}

    } catch (err) {
      console.error('[save-lead] Email send failed:', err.message);
      // Don't fail the request — lead is already saved in Firestore
    }
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
