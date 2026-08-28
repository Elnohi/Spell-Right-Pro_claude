// /netlify/functions/google-reviews.js
// Fetches real reviews from SpellRightPro's Google Business Profile so the
// premium page can show genuine testimonials instead of fabricated ones.
//
// GET /.netlify/functions/google-reviews
// Response: { ok: true, rating, userRatingsTotal, reviews: [{author, rating, text, relativeTime, authorPhoto}] }
//        or { ok: false, reason: "not_configured" | "fetch_failed" } — front-end
//        hides the testimonials section entirely in either case, no fallback content.
//
// Requires env vars:
//   GOOGLE_PLACES_API_KEY — a Places API key restricted to this API/referrer
//   GOOGLE_PLACE_ID       — SpellRightPro's Place ID (starts with "ChIJ"),
//                           found via https://developers.google.com/maps/documentation/places/web-service/place-id

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
  // Reviews change slowly — cache at the CDN edge to keep Places API usage (and cost) low.
  'Cache-Control':                'public, max-age=21600'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const apiKey  = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'not_configured' }) };
  }

  const url = 'https://maps.googleapis.com/maps/api/place/details/json'
    + '?place_id=' + encodeURIComponent(placeId)
    + '&fields=rating,user_ratings_total,reviews'
    + '&reviews_sort=newest'
    + '&key=' + encodeURIComponent(apiKey);

  try {
    const res  = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' || !data.result) {
      console.error('[google-reviews] Places API error:', data.status, data.error_message);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'fetch_failed' }) };
    }

    const result = data.result;
    const reviews = (result.reviews || [])
      .filter(r => r.rating >= 4 && r.text && r.text.trim().length > 0)
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 5)
      .map(r => ({
        author:       (r.author_name || 'Google user').trim(),
        rating:       r.rating,
        text:         r.text.trim().length > 240 ? r.text.trim().slice(0, 237) + '…' : r.text.trim(),
        relativeTime: r.relative_time_description || '',
        authorPhoto:  r.profile_photo_url || null
      }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        rating:           result.rating || null,
        userRatingsTotal: result.user_ratings_total || 0,
        reviews
      })
    };
  } catch (err) {
    console.error('[google-reviews] Fetch failed:', err.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'fetch_failed' }) };
  }
};
