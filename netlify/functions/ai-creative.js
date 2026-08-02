// netlify/functions/ai-creative.js
// SpellRightPro — AI Ad Creative Generator (Phase 1 of internal growth tool)
//
// Generates ad copy variants (headline / primary text / description) for a
// given audience segment, grounded in the doctor/OET-authority angle and
// the site's no-fake-urgency, no-fabricated-stats copy standards.
//
// Contract:
//   POST /.netlify/functions/ai-creative
//   Body: {
//     token: ADMIN_TOKEN,
//     segment: "oet" | "school" | "bee",
//     angle: free text, e.g. "exam anxiety" or "band score improvement",
//     count: number of variants to generate (default 3, max 5)
//   }
//   → { variants: [ { headline, primary_text, description } ] }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function authError() {
  return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
}

const SEGMENT_CONTEXT = {
  oet: {
    audience: 'OET (Occupational English Test) candidates — healthcare professionals (nurses, doctors, dentists, physiotherapists, etc.) preparing to work in English-speaking healthcare systems',
    pain_points: 'losing marks on spelling in the OET writing sub-test, generic spelling apps that don\'t cover medical terminology, exam anxiety, limited study time around work shifts',
    landing_url: 'https://www.spellrightpro.org/freemium-oet.html'
  },
  school: {
    audience: 'school students and parents looking for spelling practice tools',
    pain_points: 'kids losing interest in rote spelling drills, parents wanting to track progress, spelling tests at school',
    landing_url: 'https://www.spellrightpro.org/freemium-school.html'
  },
  bee: {
    audience: 'Spelling Bee competitors and their parents/coaches',
    pain_points: 'needing large, well-curated word lists beyond what\'s freely available, wanting structured practice with immediate feedback, competition prep timelines',
    landing_url: 'https://www.spellrightpro.org/freemium-bee.html'
  }
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!adminToken || !apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (body.token !== adminToken) return authError();

  const segment = SEGMENT_CONTEXT[body.segment];
  if (!segment) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'segment must be one of: oet, school, bee' }) };
  }

  const angle = (body.angle || '').toString().slice(0, 300) || 'general awareness';
  const count = Math.min(Math.max(parseInt(body.count, 10) || 3, 1), 5);

  const systemPrompt = `You write ad copy for SpellRightPro, a spelling practice web/Android app built by a doctor from personal OET exam experience. Founder identity stays anonymous in all public copy — refer to "a doctor" or "the SpellRightPro founder," never a name.

Hard rules, no exceptions:
- Never invent statistics, testimonials, user counts, or success rates. If a number isn't provided to you, don't include one.
- Never use manufactured urgency ("only 3 spots left", "offer ends tonight") — SpellRightPro doesn't run scarcity tactics.
- Be accurate about the product: free tier exists, premium is a paid subscription (CAD $5/month or $45/year), no free trial that auto-charges.
- Match Meta ad copy conventions: primary text under ~125 characters ideally (hard cap 250), headline under 40 characters, description under 30 characters.

Output ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"variants":[{"headline":"...","primary_text":"...","description":"..."}]}`;

  const userPrompt = `Segment audience: ${segment.audience}
Common pain points for this audience: ${segment.pain_points}
Angle/focus for this batch: ${angle}
Generate ${count} distinct ad copy variants (different hooks/phrasing, same accurate product facts).`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'AI API error', detail: errText.slice(0, 500) }) };
    }

    const data = await resp.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'No text in AI response' }) };
    }

    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'AI response was not valid JSON', raw: textBlock.text.slice(0, 500) }) };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        variants: parsed.variants || [],
        landing_url: segment.landing_url,
        segment: body.segment
      })
    };

  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
