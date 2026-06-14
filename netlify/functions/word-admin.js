// netlify/functions/word-admin.js
// SpellRightPro — Admin Word Approval Function
//
// Contract:
//   GET  /.netlify/functions/word-admin?action=list&token=ADMIN_TOKEN
//        → returns all pending word submissions
//   POST /.netlify/functions/word-admin
//        Body: { action: "approve"|"reject", docId: "...", words: [...], token: "..." }
//        → approve: adds words to oetConfig/wordList, marks submission approved
//        → reject: marks submission rejected

const FIREBASE_URL = 'https://firestore.googleapis.com/v1/projects/';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function authError() {
  return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const firebaseProject = process.env.FIREBASE_PROJECT_ID;
  const firebaseKey     = process.env.FIREBASE_API_KEY;
  const adminToken      = process.env.ADMIN_TOKEN;

  if (!firebaseProject || !firebaseKey || !adminToken) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const BASE = `${FIREBASE_URL}${firebaseProject}/databases/(default)/documents`;

  // ── GET: list pending submissions ──
  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters?.token;
    if (token !== adminToken) return authError();

    try {
      const res = await fetch(
        `${BASE}/wordSubmissions?key=${firebaseKey}&pageSize=50`
      );
      if (!res.ok) throw new Error('Firestore read failed');
      const data = await res.json();
      const docs = (data.documents || []).map(doc => {
        const f = doc.fields || {};
        return {
          id: doc.name.split('/').pop(),
          userId:      f.userId?.stringValue,
          listName:    f.listName?.stringValue,
          words:       (f.words?.arrayValue?.values || []).map(v => v.stringValue),
          originals:   (f.originals?.arrayValue?.values || []).map(v => v.stringValue),
          status:      f.status?.stringValue,
          submittedAt: f.submittedAt?.stringValue,
          count:       f.count?.integerValue
        };
      }).filter(d => d.status === 'pending');

      return { statusCode: 200, headers: cors, body: JSON.stringify({ submissions: docs }) };

    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── POST: approve or reject ──
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    if (body.token !== adminToken) return authError();

    const { action, docId, words } = body;
    if (!docId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing docId' }) };

    // ── Approve: add words to OET list ──
    if (action === 'approve' && Array.isArray(words) && words.length > 0) {
      try {
        // 1. Get existing OET word list
        const listRes = await fetch(`${BASE}/oetConfig/wordList?key=${firebaseKey}`);
        let existingWords = [];
        if (listRes.ok) {
          const listData = await listRes.json();
          existingWords = (listData.fields?.words?.arrayValue?.values || []).map(v => v.stringValue);
        }

        // 2. Merge — deduplicate
        const merged = [...new Set([...existingWords, ...words.map(w => w.toLowerCase().trim())])];

        // 3. Update Firestore OET word list
        const updateRes = await fetch(
          `${BASE}/oetConfig/wordList?key=${firebaseKey}&updateMask.fieldPaths=words&updateMask.fieldPaths=lastUpdated`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                words: { arrayValue: { values: merged.map(w => ({ stringValue: w })) } },
                lastUpdated: { stringValue: new Date().toISOString() },
                count: { integerValue: merged.length.toString() }
              }
            })
          }
        );
        if (!updateRes.ok) throw new Error('Failed to update OET word list');

        // 4. Mark submission as approved
        await fetch(
          `${BASE}/wordSubmissions/${docId}?key=${firebaseKey}&updateMask.fieldPaths=status&updateMask.fieldPaths=approvedAt`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                status: { stringValue: 'approved' },
                approvedAt: { stringValue: new Date().toISOString() }
              }
            })
          }
        );

        return {
          statusCode: 200,
          headers: cors,
          body: JSON.stringify({ success: true, added: words.length, total: merged.length })
        };

      } catch (e) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
      }
    }

    // ── Reject ──
    if (action === 'reject') {
      try {
        await fetch(
          `${BASE}/wordSubmissions/${docId}?key=${firebaseKey}&updateMask.fieldPaths=status&updateMask.fieldPaths=rejectedAt`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                status: { stringValue: 'rejected' },
                rejectedAt: { stringValue: new Date().toISOString() }
              }
            })
          }
        );
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
      } catch (e) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
      }
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid action' }) };
  }

  return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
};
