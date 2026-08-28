// /netlify/functions/session-limit.js
// Server-side backstop for the free daily session limit.
//
// The primary gate (srpLimit in each freemium-*.html page) lives entirely in
// localStorage, which anyone can clear or bypass with a private/incognito
// window — that's an accepted trade-off of the "no sign-up required" free
// tier, not a bug. This function adds a second, server-side counter keyed by
// a hash of the visitor's IP + today's date + module, so a visitor who
// clears localStorage to get more free sessions still shows up as "already
// used today" here.
//
// This is a backstop, not a hard wall: shared IPs (schools, offices, mobile
// carrier NAT) will share one counter, so it can throttle multiple real
// people early. That trade-off is accepted deliberately — see the PR
// description for the reasoning — rather than adding fingerprinting or
// requiring an account.
//
// Fails open: any error (Firestore down, bad config, etc.) returns
// { ok:false }, and callers on the client are written to treat that as
// "no backstop available" and fall back to exactly today's behavior
// (the localStorage gate only). A legitimate free user should never be
// blocked by an infrastructure hiccup here.
//
// POST /.netlify/functions/session-limit
// Body: { action: 'check' | 'record', module: 'oet' | 'school' | 'bee' }
// Response: { ok:true, allowed, remaining, count } for 'check'
//           { ok:true, count } for 'record'
//           { ok:false } on any error — treat as "don't block"

const admin  = require('firebase-admin');
const crypto = require('crypto');

// Mirrors FREE_SESSIONS_PER_DAY in each freemium page's srpLimit.
const FREE_SESSIONS_PER_DAY = { oet: 1, school: 3, bee: 3 };

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

function getClientIp(event) {
  return event.headers['x-nf-client-connection-ip']
    || (event.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || 'unknown';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // server clock, UTC
}

// Hash the IP rather than storing it raw — we only need it as a stable key,
// not as retrievable PII.
function docId(ip, module, date) {
  const hash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
  return hash + '_' + module + '_' + date;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false }) };
  }

  const moduleName = body.module;
  const limit = FREE_SESSIONS_PER_DAY[moduleName];
  if (!limit) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false }) };
  }

  try {
    const ip   = getClientIp(event);
    const date = todayStr();
    const id   = docId(ip, moduleName, date);
    const ref  = getDb().collection('sessionLimits').doc(id);

    if (body.action === 'record') {
      const snap  = await ref.get();
      const count = (snap.exists ? snap.data().count : 0) + 1;
      await ref.set({
        count,
        module:    moduleName,
        date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Configure a Firestore TTL policy on this field (Firebase console >
        // Firestore Database > TTL) to auto-delete old counters. Not set up
        // automatically — Netlify functions can't configure TTL policies.
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3 * 24 * 60 * 60 * 1000)
      }, { merge: true });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, count }) };
    }

    // action === 'check' (default)
    const snap  = await ref.get();
    const count = snap.exists ? snap.data().count : 0;
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok:        true,
        allowed:   count < limit,
        remaining: Math.max(0, limit - count),
        count
      })
    };
  } catch (err) {
    console.error('[session-limit] error:', err.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false }) };
  }
};
