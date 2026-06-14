// netlify/functions/word-submit.js
// SpellRightPro — Word Submission Pipeline
//
// Flow:
//   1. Receive words from user's saved custom list
//   2. Call Claude API to validate + correct British spelling
//   3. Compare against existing OET list — remove duplicates
//   4. Store new unique words in Firestore `wordSubmissions` as pending
//
// Contract:
//   POST /.netlify/functions/word-submit
//   Body: { words: ["word1", "word2", ...], userId: "uid", listName: "My List" }
//   Response: { submitted: 5, duplicates: 3, invalid: 2 }

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const FIREBASE_URL   = 'https://firestore.googleapis.com/v1/projects/';
const BATCH_SIZE     = 20;   // words per Claude call
const MAX_WORDS      = 200;  // cap per submission
const TIMEOUT_MS     = 25000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Parse request ──
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { words, userId, listName } = body;
  if (!Array.isArray(words) || words.length === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No words provided' }) };
  }
  if (!userId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing userId' }) };
  }

  // ── Check env vars ──
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const firebaseProject = process.env.FIREBASE_PROJECT_ID;
  const firebaseKey = process.env.FIREBASE_API_KEY;
  if (!anthropicKey || !firebaseProject || !firebaseKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  // ── Cap input ──
  const inputWords = [...new Set(words.map(w => w.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_WORDS);

  // ── Fetch existing OET words from Firestore ──
  let existingWords = new Set();
  try {
    const res = await fetch(
      `${FIREBASE_URL}${firebaseProject}/databases/(default)/documents/oetConfig/wordList?key=${firebaseKey}`
    );
    if (res.ok) {
      const data = await res.json();
      const words = data.fields?.words?.arrayValue?.values || [];
      words.forEach(v => existingWords.add(v.stringValue?.toLowerCase()));
    }
  } catch (e) {
    console.warn('Could not fetch existing OET words:', e.message);
    // Continue — worst case we get some duplicates that admin can reject
  }

  // ── Validate words with Claude in batches ──
  const validated = [];
  const batches = [];
  for (let i = 0; i < inputWords.length; i += BATCH_SIZE) {
    batches.push(inputWords.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    try {
      const prompt = `You are a British English medical spelling validator.

For each word in this list, determine:
1. Is it a real English word used in healthcare, medicine, or general clinical contexts?
2. What is the correct British English spelling?

Words to validate:
${batch.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Respond with a JSON array only, no other text. Each item:
{"original": "word", "valid": true/false, "british": "corrected spelling or null if invalid"}

Rules:
- Mark valid=true for medical terms, anatomy, conditions, symptoms, medications, procedures, and general clinical vocabulary
- Mark valid=false for non-words, abbreviations only (like "BP", "ECG"), numbers, names
- British spelling: haemorrhage not hemorrhage, oedema not edema, anaesthetic not anesthetic
- If already correct British spelling, return it unchanged
- If invalid, set british to null`;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (!resp.ok) {
        console.warn('Claude API error:', resp.status);
        continue;
      }

      const data = await resp.json();
      const text = data.content?.[0]?.text || '';

      // Parse JSON — strip any markdown fences
      const clean = text.replace(/```json|```/g, '').trim();
      const results = JSON.parse(clean);

      results.forEach(item => {
        if (item.valid && item.british) {
          validated.push({
            original: item.original,
            british: item.british.toLowerCase().trim()
          });
        }
      });

    } catch (e) {
      console.warn('Batch validation error:', e.message);
    }
  }

  // ── Filter out duplicates against existing OET list ──
  const newWords = validated.filter(v => !existingWords.has(v.british));
  const duplicateCount = validated.length - newWords.length;
  const invalidCount = inputWords.length - validated.length;

  if (newWords.length === 0) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        submitted: 0,
        duplicates: duplicateCount,
        invalid: invalidCount,
        message: 'No new words to add — all were duplicates or invalid'
      })
    };
  }

  // ── Store in Firestore wordSubmissions ──
  const timestamp = new Date().toISOString();
  const docId = `${userId}_${Date.now()}`;

  try {
    const firestoreBody = {
      fields: {
        userId:    { stringValue: userId },
        listName:  { stringValue: listName || 'unnamed' },
        words:     { arrayValue: { values: newWords.map(w => ({ stringValue: w.british })) } },
        originals: { arrayValue: { values: newWords.map(w => ({ stringValue: w.original })) } },
        status:    { stringValue: 'pending' },
        submittedAt: { stringValue: timestamp },
        count:     { integerValue: newWords.length.toString() }
      }
    };

    const res = await fetch(
      `${FIREBASE_URL}${firebaseProject}/databases/(default)/documents/wordSubmissions/${docId}?key=${firebaseKey}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestoreBody)
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Firestore write error:', err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to save submissions' }) };
    }

  } catch (e) {
    console.error('Firestore error:', e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Database error' }) };
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      submitted: newWords.length,
      duplicates: duplicateCount,
      invalid: invalidCount,
      message: `${newWords.length} new word${newWords.length !== 1 ? 's' : ''} submitted for review`
    })
  };
};
