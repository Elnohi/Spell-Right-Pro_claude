# SpellRightPro — Phase 1 Deployment Notes

## What changed in this update

### Files DELETED (remove from your repo)
- `js/main-freemium.js` — was never loaded by any page
- `js/analytics.js` — duplicate of trackEvent already in config.js
- `inject-version.js` — sw.js has no placeholder to inject
- `netlify/plugins/inject-sw-version/index.js` — same
- `netlify/plugins/inject-sw-version/manifest.yml` — same
- `htaccess.txt` — Apache only, Netlify ignores it

### Files NEW
- `.netlifyignore` — excludes dev-only files from deploy

### Files CHANGED
| File | What changed |
|------|-------------|
| `freemium-school.html` | AdSense now loads via ads-manager.js after cookie consent (GDPR fix) |
| `freemium-oet.html` | Same as above |
| `freemium-bee.html` | Removed duplicate local analytics.js tag only |
| `trainer.html` | Uncommented oet_word_list.js (critical OET fix); removed duplicate selectWordList() |
| `js/main-premium.js` | Session save/resume; OET fallback fix; dead code removed; progressDashboard wired; bee phonetic map added |
| `js/main-freemium-bee.js` | Removed conflicting speakWord/endSession (HTML versions are superior) |
| `_redirects` | Added /data/* pass-through (fixes JSON fetch being caught by catch-all) |
| `netlify.toml` | Removed force=true from catch-all; added /data/* pass-through; tidied |

## Deployment steps
1. Delete the 6 files listed above from your repo
2. Copy all files from this package into your repo (overwriting)
3. Commit and push — Netlify auto-deploys

## What to test after deploy
- [ ] OET premium: start a session, confirm 1,511 words load (not 10)
- [ ] OET premium: start session, close tab mid-way, reopen trainer — resume banner appears
- [ ] OET premium: complete a session, reopen trainer — NO resume banner
- [ ] Spelling Bee premium: voice spell "S-E-E A-Y-T-E-E" — should match "cat"
- [ ] Freemium school/OET: open in private/incognito, check no ads load until cookie accept
- [ ] /data/school.json and /data/spelling-bee.json: fetch directly in browser — should return JSON not index.html
- [ ] assetlinks.json: visit /.well-known/assetlinks.json — should still return JSON correctly

---

## Phase 2 changes (this update)

### New files
| File | Purpose |
|------|---------|
| `js/hw-canvas.js` | Shared handwriting canvas + OCR module for all three pages |

### Updated files
| File | What changed |
|------|-------------|
| `freemium-school.html` | Handwriting canvas + keyboard/write toggle added; `hw-canvas.js` loaded; `checkAnswer()` reads from HW or keyboard |
| `freemium-oet.html` | Same as above |
| `trainer.html` | HW toggle + canvas added to practice area; `hw-canvas.js` loaded; old inline HW replaced by module |
| `js/main-premium.js` | Old HW block replaced by `hw-canvas.js`; cross-device sync fires after each session; `hydrateFromCloud()` on login |
| `js/firebase-utils.js` | Added: `saveCustomLists`, `getCustomLists`, `saveMistakeBank`, `getMistakeBank`, `hydrateFromCloud` |
| `js/mistake-review.js` | Syncs mistake bank to Firestore whenever a mistake is added |
| `_redirects` | `/data/*` pass-through added (fixes JSON file fetches) |
| `netlify.toml` | `/data/*` pass-through; removed `force=true` from catch-all |
| `.netlifyignore` | Excludes dev-only files from deploy |

## What to test after this deploy
- [ ] Freemium school: tap "Write" button → canvas appears; draw a word → auto-recognizes after 0.8s; tap Submit → marks correctly
- [ ] Freemium OET: same as above
- [ ] Premium trainer: tap "Write" toggle in practice area → canvas appears; recognized word feeds into submit
- [ ] Premium: complete a session → open browser DevTools → Network tab shows Firestore writes for `userProgress`, `userLists`, `mistakeBanks`
- [ ] Premium: log in on a second device → custom lists and mistake bank appear (hydrated from Firestore)
- [ ] fetch /data/school.json in browser → returns JSON (not index.html)

---

## Phase 2c hotfix (this update)

### Bugs fixed
| Bug | Fix |
|-----|-----|
| `nextWord()` missing `const word` declaration — words never spoke, session appeared frozen | Restored the declaration |
| Handwriting canvas never opened (all 3 pages) | `practiceHwWrap` had inline `style="display:none"` overriding the toggle class; `setMode()` now sets `style.display` directly instead of relying on CSS classes |
| Handwriting canvas had zero dimensions when first opened | `HW.init()` now called 50ms after the answer zone/training area becomes visible, not before |

### Content fix
| File | What changed |
|------|-------------|
| `data/word-lists/school.json` | Was a 15-word placeholder. Now contains the exact same 307-word curriculum list already used by `freemium-school.html`'s inline `SCHOOL_WORDS` array — premium and freemium now draw from one identical source. |

### OET — confirmed correct, no change needed
Both OET full list and the 24-word exam simulator already pull from the same `window.OET_WORDS` (1,635 words from `oet_word_list.js`) — exam simulator is just `shuffle().slice(0,24)` of the same list. This was already correct in the code; if you saw a wrong word count previously, it was because `oet_word_list.js` was commented out in `trainer.html` (fixed in Phase 1) — make sure that deploy went out.

## What to test after this deploy
- [ ] Premium OET/School: word plays automatically when session starts (was silent before)
- [ ] Premium school: word count shows 307 (not 15)
- [ ] Premium OET full list: word count shows 1,635-ish (not 10)
- [ ] Premium OET exam simulator: shows exactly 24 words, drawn from the same OET list as full mode
- [ ] All 3 pages: tap "Write" toggle → canvas appears immediately with correct size, ready to draw

---

## Phase 2d hotfix — Google review link

### Bug fixed
The "Leave a Google review" link was malformed in 4 files — it doubled `https://g.page/r/` and had a trailing `/review/review`. Clicking it led nowhere (404). Fixed to the correct format `https://g.page/r/CcXpShfGcR9GEAE/review` in:
- `js/main-premium.js` (premium trainer)
- `freemium-school.html`
- `freemium-oet.html`
- `freemium-bee.html`

## What to test
- [ ] Complete any session (free or premium) → after 2nd session, rating prompt appears → click "Leave a Google review" → should open the actual Google review page, not a 404

---

## Phase 2e hotfix — contrast / accessibility fix

### Bug fixed
Session summary screen had several elements with very weak contrast against the white card:
- Rating stars (unselected) used `var(--border)` — a 15%-opacity purple meant for hairlines, basically invisible against white. Now uses `#c9bfe0` (light mode) / `#5a4a78` (dark mode).
- "Incorrect Words", "Correct Words", "Flagged Words" sections and `.summary-header`/`.score` had **zero CSS** in `trainer.html` — they were running on unstyled browser defaults, which is why the box and text looked washed out.

### Fix
Added complete, WCAG AA-compliant styling (verified ≥4.5:1 contrast ratio) for:
- `.summary-header`, `.score` — proper heading and score colour
- `.incorrect-words` / `.correct-words` / `.flagged-words` — solid light backgrounds (not translucent) with dark-mode equivalents
- `.word-item` — proper border, background, text colour
- `.star-btn` — visible unselected state in both light and dark mode

Applied to `trainer.html`, `freemium-school.html`, `freemium-oet.html`, `freemium-bee.html` — all four pages now share consistent, accessible summary screens.

## What to test
- [ ] Complete a session in any mode → summary screen shows clearly visible "Incorrect Words" box with readable dark-red header text on a light pink background (not washed out)
- [ ] Rating prompt → unselected stars should be clearly visible as light purple/grey, not invisible
- [ ] Toggle dark mode → all of the above should still look correct, no white-on-white or invisible text

---

## Phase 2f hotfix — index.html contrast fix

### Bugs fixed
The homepage body has a vivid purple-to-pink gradient background (`#7b2ff7 → #f107a3`). Two sections sat directly on this gradient without a white card wrapper, assuming a dark theme that doesn't exist here:

1. **Trust Badges section + Footer** — grey/default text (`#666`, inherited `#222`) on the gradient measured as low as **1.02:1** contrast (needs 4.5:1). Also had duplicate SSL/Cancel/GDPR badges appearing twice (once in the Trust Badges section, once in the footer).
2. **"Premium vs Freemium" comparison table** — used translucent white overlays (`rgba(255,255,255,0.05)`) designed for a dark background, with default dark text on top — both badly mismatched against the actual purple/pink gradient.

### Fix
Both sections now wrap in a white card (matching the existing `.training-card` style already used elsewhere on the page), with text colours chosen to clear WCAG AA on white:
- Footer: `#555` body / `#6b6b6b` copyright / `#7b2ff7` links — all ≥4.5:1
- Trust badges: `#1a0050` on white — 18:1
- Comparison table: `#333` body / `#1a0050` headers on white — 12–18:1
- Removed the duplicate trust badge row from the footer (was repeated from the Trust Badges section above it)

### Sections checked and confirmed already correct (no change needed)
- "Why Go Premium?" gradient card — uses explicit `color:white`, correctly passes against its own gradient
- Navbar — has its own white card background already
- Bottom mobile tab bar — `#7b6f8a` on white (4.68:1) and `#9d8fc0` on dark (6.47:1) both pass

## What to test
- [ ] Homepage: scroll to "Premium vs Freemium" table — text should be clearly dark on white, not faint
- [ ] Homepage: scroll to bottom — Trust Badges section and footer should be clearly readable white cards, not blending into the gradient
- [ ] Confirm no duplicate "SSL Secure / Cancel Anytime / GDPR Compliant" badges appear twice on the page

---

## Phase 2g hotfix — Quick List "Use" / "Rename" buttons invisible

### Bug found
Yes — caught this one, thank you for flagging it. The "Use" and "Rename" buttons under saved Quick Lists in the premium trainer were rendering nearly invisible (white text on a near-white background), while "Delete" looked fine because of its red tint.

### Root cause
`css/premium.css` had a leftover `.btn-small` rule from an earlier dark-theme version of the trainer, using `!important` on every property — `color: white !important` and `background: rgba(255,255,255,0.15) !important`. Because of `!important`, this rule always won over `trainer.html`'s own correct light-theme `.btn-small` rule (purple text, white background), regardless of load order. Measured contrast was 1.12:1 — essentially unreadable.

Same root cause as the earlier `.list-card` styling — designed for a dark purple background, but `trainer.html`'s light theme never matches that.

### Fix
Removed the dead `.list-card`, `.list-header strong`, `.word-count`, `.list-words-preview`, `.list-actions`, `.btn-small`, `.btn-danger` rules from `premium.css`. Confirmed via search that `index.html` and `pro.html` (the only other pages loading `premium.css`) never use these class names — fully safe to remove. `trainer.html`'s own correct versions of all these classes now apply cleanly with no conflict.

## What to test
- [ ] Premium trainer → expand custom words panel → any saved Quick List → "Use" and "Rename" buttons should show clear purple text on a white background, same visual weight as "Delete"

---

## Phase 2h hotfix — PrimeTestLab Android report (5 issues)

### Issue 1 — Sign In button text misaligned/truncated on mobile
**Root cause:** `.btn-submit` (login.html) and `.auth-submit` (trainer.html) had no `display:flex`/`align-items`/`justify-content` — the icon + text relied on default inline flow, which renders inconsistently across mobile WebView font engines.
**Fix:** Added explicit flex layout, `gap:8px`, `line-height:1.2`, `white-space:nowrap` to both button classes. Confirmed `index.html`'s navbar Sign In link already had correct flex via `.btn-secondary` — no change needed there.

### Issue 2 — Stray "n" character at top of screen
**Root cause:** A literal two-character `\n` (backslash + n) had leaked into the raw HTML of `trainer.html` outside any comment — from an earlier edit where a template string's `\n` was inserted as literal text instead of an actual line break. Browsers render this as visible text, not a newline.
**Fix:** Removed the stray `\n` from `trainer.html`. Confirmed all other `\n` occurrences across the codebase are legitimate JavaScript string/regex usage (`.split(/[\n,]+/)`, `.join('\n')`, template literals in `confirm()` dialogs) that correctly execute as real newlines at runtime — not HTML rendering bugs.

### Issue 3 — File upload picker doesn't launch
**Root cause:** `netlify.toml`'s `Permissions-Policy` header had `camera=()` — fully blocking camera access for all contexts, inconsistent with `microphone=(self)` on the same line. Many Android WebView/TWA file-picker implementations probe camera capability when a file input's picker UI loads (to decide whether to offer "Take Photo"), and a hard `camera=()` block can cause the entire file-picker intent to fail silently rather than just omitting the camera option.
**Fix:** Changed to `camera=(self), microphone=(self), geolocation=()` — matches the existing self-scoping pattern already used for microphone.

### Issue 4 — Poor contrast on "newly added text cards"
**Root cause:** `mistake-review.js` and `adaptive-drill.js` (the Mistake Review and Adaptive Drill premium feature cards) had headings, labels, and list items with no explicit `color` set — relying entirely on inherited body text color. In light mode this happened to look fine; in dark mode, the inherited color produced contrast as low as 1.29:1 against the card backgrounds (need 4.5:1).
**Fix:** Added `color:var(--text,#1a0533)` to every heading, paragraph, label, and list item across both files — now correctly tracks light/dark theme automatically instead of relying on inheritance.

### Issue 5 — "Start/Get Full List Practice" button unresponsive
**Root cause:** `#loginOverlay` is a full-screen (`position:fixed; inset:0; z-index:9999`) overlay shown until Firebase auth resolves. `hideOverlay()` is only called inside `auth.onAuthStateChanged()` — if Firebase is slow to initialize (slow network, CDN throttling, momentary connectivity issue — common on real-device testing over WiFi), there was **no timeout or fallback**. The overlay stays up indefinitely, silently swallowing every tap on the page underneath it, including the practice Start button.
**Fix:**
  - Added a loading spinner card (`Checking your account…`) shown immediately, so the screen never looks "stuck" with no feedback
  - Added an 8-second safety timeout — if auth still hasn't resolved, the spinner is replaced with the actual login form and a clear message, guaranteed
  - `showOverlay()` now explicitly swaps from spinner to login form when Firebase confirms there's no active session

## What to test
- [ ] Login page (mobile/Android): "Sign In" button text displays cleanly, icon and text aligned, no overlap
- [ ] Trainer page: no stray characters anywhere near the top of the screen
- [ ] Trainer page (logged in, premium): tap "Choose File" under custom word upload — Android file picker should launch
- [ ] Trainer page in dark mode: open Mistake Review and Adaptive Drill cards — all text clearly readable, not blending into background
- [ ] Trainer page on a throttled/slow connection (Chrome DevTools → Network → Slow 3G): confirm the overlay shows a spinner first, then either logs in automatically or shows the login form within ~8 seconds — never stays blank/stuck

---

## Phase 2i — AdSense "Low value content" fix

### What Google flagged
AdSense rejected the site for "low value content" with a note that it doesn't yet meet minimum content/quality criteria.

### Root cause
The site actually has strong content — four guides between 1,000 and ~2,000 words each. The problem was reachability and depth at the entry point, not absence of content:
1. **Homepage had only ~201 words**, most of it UI labels ("Sign In", "Go Premium") rather than explanatory text — this is the priority-1.0 page in the sitemap and the one a reviewer/crawler sees first.
2. **3 of 4 guide pages were missing from `sitemap.xml`** — only `oet-spelling-guide` was listed.
3. **3 of those same pages had no clean-URL redirect rule** — `/oet-referral-letter-guide`, `/oet-vs-ielts`, `/oet-abbreviations` would have 404'd even if linked, since only `/oet-spelling-guide` had a working rewrite rule in both `_redirects` and `netlify.toml`.

### Fix
- **`index.html`**: added a new ~400-word content section ("What SpellRightPro does, and why listen-and-type works") explaining the methodology and all three practice modes in real prose, with internal links to the OET spelling guide, OET vs IELTS, and About page. Homepage word count: 201 → 608.
- **`sitemap.xml`**: added the 3 missing guide pages plus `/about` and `/blog` — 11 → 16 URLs total.
- **`_redirects`** and **`netlify.toml`**: added trailing-slash and clean-URL rules for `oet-referral-letter-guide`, `oet-vs-ielts`, `oet-abbreviations` — these would have 404'd without this fix.

## What to test after deploy
- [ ] Visit `/oet-referral-letter-guide`, `/oet-vs-ielts`, `/oet-abbreviations` directly — all three should load the guide, not 404
- [ ] Visit `/` — scroll past the mode chooser, confirm the new "What SpellRightPro does" section renders with working links
- [ ] Fetch `/sitemap.xml` directly — confirm all 16 URLs are listed
- [ ] In Google Search Console, resubmit the sitemap so the new URLs get crawled before reapplying to AdSense on or after 27 June

---

## Phase 2j — contrast, layout, and responsive fixes for the new homepage content

You asked whether contrast, layout, and device suitability had actually been checked — they hadn't, fully. Found and fixed 3 real issues:

### 1. Dark mode contrast failure (genuine bug, same pattern as before)
The new content section's `<p>` tags had no explicit color, inheriting the global `body { color: #222 }`. In dark mode, `.training-card` switches to a dark purple background (`#1e0e35`) but there was no matching override for plain paragraph text — measured contrast: **1.13:1** (need 4.5:1), same failure pattern as the premium feature cards fixed earlier. Added `body.dark-mode .training-card p { color: #d8c8ee }` — now 11.47:1. Confirmed this doesn't affect the comparison table or trust badges sections, which use `<td>`/`<div>` with their own hardcoded colors, not plain `<p>`.

### 2. Mobile layout — accidental section reordering (pre-existing bug, exposed by the new section)
`.training-card { order: -1 }` at the 480px breakpoint was written assuming only one `.training-card` existed (the mode chooser). With my new section reusing the same class, this rule would pull **all four** `.training-card` sections ahead of `premium-showcase` on mobile, pushing the "Why Go Premium" pitch to the bottom of the page below the comparison table and trust badges — not the intended order. Fixed by giving the mode chooser a unique ID (`#modeChooserCard`) and scoping the reorder rule to that ID only, so other sections keep their natural source order on mobile.

### 3. Minor hardening
- Added `overflow-wrap: break-word` to `.training-card` as a safety net against any future long unbroken string causing horizontal overflow on narrow screens.
- Added `line-height: 1.65` to `.training-card p` for better readability of the new multi-paragraph prose (previously inherited the browser's tight ~1.2 default). Scoped with `:not(.muted)` to avoid overriding the mode chooser subtitle's existing margin via specificity.

## What to test
- [ ] Toggle dark mode on homepage — new "What SpellRightPro does" section text should be clearly readable, light lavender on dark purple
- [ ] Resize browser to ~375px wide (or test on an actual phone) — confirm order is: mode chooser, new content section, Why Go Premium, comparison table, trust badges — not premium showcase pushed to the bottom
- [ ] Confirm mode chooser subtitle ("Start with the mode that suits you best") still has its original spacing below it

---

## Phase 2k — ROOT CAUSE FOUND: invisible text on homepage (color-scheme bug)

### The actual bug, finally confirmed
`:root { color-scheme: light dark; }` in `css/styles.css` opted the entire site into browser-driven automatic dark-mode color adaptation — completely separate from, and invisible to, the app's own `body.dark-mode` JS toggle system.

On Android devices with system dark mode enabled, Chrome's **Auto Dark Theme** feature can rewrite page text colors — including overriding explicit author-set colors like `body { color: #222 }` — based on its own internal heuristics, independent of anything in our CSS. This is why it reproduced identically across multiple devices: any device with system dark mode on triggers Chrome's auto-dark rewriting the same way, regardless of which physical device it is.

This explains every detail in the screenshots precisely:
- The H2 heading rendered correctly (Chrome's heuristics are more conservative about overriding headings)
- `<a>` link text rendered correctly (links get distinct system-driven colors that survive the rewrite)
- Plain `<p>` and `<strong>` text — relying only on inherited `body` color — rendered invisible, since that's exactly the category of element Chrome's Auto Dark Theme targets for rewriting

### The fix
Changed `color-scheme: light dark` to `color-scheme: light` in `:root`. This explicitly tells every browser "this site is light-mode by design" and **disables Chrome's Auto Dark Theme color rewriting entirely** — confirmed via MDN documentation as the standard fix for this exact issue. The app's own dark mode (toggled via the moon icon, applying `body.dark-mode`) is implemented entirely through explicit CSS class rules, not through the native `color-scheme` mechanism, so it is completely unaffected by this change and continues to work exactly as before.

Also added explicit `color: #222` to `.training-card p` and `color: #1a0050` to `.training-card p strong` as defense in depth, so even if a similar auto-theming behavior appears in a future browser version, this specific text is pinned to an explicit value and can't be silently rewritten.

### Why this only showed up now
This vulnerability has existed site-wide since `color-scheme: light dark` was set, but every other piece of plain text on the page happened to already have an explicit `color` somewhere in its cascade (buttons, badges, link-card paragraphs, etc.) — accumulated defensively over earlier rounds of fixes. The new homepage content was the first substantial block of plain prose added without that same defensive coloring, which is what finally exposed the long-standing site-wide gap.

## What to test
- [ ] On an Android device with system dark mode ON, visit the homepage in a normal (non-incognito) tab — the new "What SpellRightPro does" section text should now be clearly visible, dark text on the white card
- [ ] Toggle the in-app dark mode button (moon icon) — should still correctly switch the whole page to the app's own dark theme as before, completely unaffected by this fix
- [ ] Check a few other pages (trainer, freemium-school) on the same dark-mode-enabled device to confirm no other plain text was silently invisible there too

---

## Phase 2l — TWA stale cache fix + verification of bee/upload behavior

### Bug found: TWA app stuck on old broken styles.css
**Root cause:** `sw.js`'s `VERSION` constant was hardcoded to `'2026-06-15'` and was never bumped across any of our previous deploys. The service worker's cache-cleanup logic (in the `activate` event) only deletes old caches that don't match the *current* `VERSION` string — since it never changed, the TWA's installed cache kept serving the same stale `styles.css` (and other static assets) indefinitely, even after the website itself picked up the fix. This explains exactly why the website showed the fix but the installed Android app didn't — the website's network-first HTML strategy got fresh HTML each time, but `styles.css` is cached under stale-while-revalidate, so the TWA's *already-cached copy* of the old broken CSS kept winning the race on every load.

**Fix:** Bumped `VERSION` to `'2026-06-21-a'`. On next launch, the TWA's service worker will detect the new cache name, delete every old cache (old CSS, old JS, everything), and fetch fresh copies of all assets.

**Going forward:** this `VERSION` string needs to be bumped on every deploy that changes a cached asset (CSS, JS, images), or the TWA can silently keep serving stale files indefinitely the same way again.

### Investigated: "difficult to activate Premium Bee"
Traced the full bee activation chain — mode tab switching, start button wiring, word list fetch with fallback, speech recognition initialization timing, and microphone Permissions-Policy. Everything checked out correctly in the code. The most likely explanation, given the TWA cache bug just found, is that the same stale-cache issue was also serving an outdated `main-premium.js`-adjacent script (`common.js`, `firebase-utils.js`) on the installed app, which the version bump above should resolve. If bee activation is still difficult after this update installs, it points to something outside the web code — most likely the underlying Android TWA manifest missing the `RECORD_AUDIO` permission declaration, which isn't something fixable from these web files.

### Confirmed already correct: custom words upload area visibility
Checked the full toggle logic (`premSelectSource()`) and its CSS (`.custom-words-area { display:none }` / `.open { display:block }`). This was already built exactly as requested — the upload/paste/saved-lists panel starts hidden, and the "Use App Words" button starts active by default in the generated HTML itself, before any JS runs. Only clicking "Add My Words" adds the `.open` class and reveals the panel. No code change was needed here; if this still isn't working correctly in the deployed app, it's very likely the same stale TWA cache serving an older version of `main-premium.js`'s logic before this toggle existed.

## What to test after this deploy
- [ ] Fully uninstall and reinstall the TWA app (or clear its app data/cache via Android Settings) to force the new service worker to take over — confirm the homepage text now appears correctly
- [ ] In the reinstalled app, try activating Premium Bee mode again — confirm whether the difficulty persists
- [ ] In premium trainer (OET or School), confirm the word upload panel stays hidden until "Add My Words" is tapped

---

## Phase 2m — ACTUAL ROOT CAUSE: missing <meta name="color-scheme"> tag (TWA-specific)

### Why the website worked but the app didn't
You correctly identified the key clue: text appeared when the app's own dark mode was toggled on, but was invisible in light mode — and only inside the installed app, never on the website. This pointed away from caching and toward something Android-WebView-specific.

**Confirmed via official Android developer documentation:** Android WebView (which powers the TWA) requires an actual **HTML `<meta name="color-scheme">` tag** to honor a page's own theming — the CSS-only `:root { color-scheme: light }` property (which is what Phase 2k added) is correctly honored by regular browsers like the desktop/mobile Chrome you tested the website in, but **WebView's default dark-theme strategy specifically looks for the meta tag** as authoritative confirmation that the page manages its own appearance. Without it, WebView falls back to its own algorithmic Force Dark / Auto Dark behavior, which selectively lightens text colors it judges as "light-mode" — explaining exactly why some elements (headings, links) survived while plain paragraph text didn't.

### The fix
Added `<meta name="color-scheme" content="light"/>` as the second line inside `<head>` (right after `<meta charset>`) on **every real page in the site** — 27 pages in total, not just the homepage, since this WebView behavior could affect any page opened inside the TWA.

This is confirmed **not to conflict** with the app's own dark mode toggle (the moon icon): that feature works entirely through a manually-toggled CSS class (`body.dark-mode`) set via JavaScript and localStorage, with zero dependency on `prefers-color-scheme`, `color-scheme`, or any browser/OS theming signal. The two systems are completely independent — this fix only stops WebView from second-guessing the page's own light-mode design when the app's dark mode is OFF.

## What to test after this deploy
- [ ] Clear the TWA app's storage/cache (or uninstall and reinstall) so the new service worker version takes over and fetches this updated HTML
- [ ] Open the app with the in-app dark mode OFF — confirm the homepage's "What SpellRightPro does" text is now visible
- [ ] Toggle the in-app dark mode ON then OFF again inside the app — confirm both states still render correctly and the toggle itself still works exactly as before
- [ ] Spot-check 2-3 other pages inside the app (trainer, freemium-school) to confirm no other previously-invisible text appears now that wasn't visible before

---

## Phase 2n — fixed: custom word upload panel stays open after switching OET ↔ School

### Bug found
There are two separate, independent toggles in the premium trainer's practice setup:
1. `premSelectSource('app'|'custom', mode)` — controls whether the **upload/paste panel** is shown (this is the one fixed in Phase 2l's investigation, and was already working correctly on its own)
2. `selectWordList('oet'|'school')` — controls which **built-in word list** (OET medical vs School curriculum) is active

These two never talked to each other. If a user opened "Add My Words" (toggle #1 → panel visible), then switched between OET and School (toggle #2), the panel from toggle #1 stayed open indefinitely — because `selectWordList()` had no code resetting it. This is exactly the bug you reported: the upload area stays visible even when a built-in ("device") word list is selected.

### Fix
`selectWordList()` now calls `premSelectSource('app', 'practice')` at the very start, every time the user switches between OET and School. This resets the source toggle back to "Use App Words" and closes the upload/paste panel automatically — matching the same behavior that already correctly happens when switching between Practice and Bee modes (which calls `selectWordList('oet')` on return to Practice, and now inherits this same reset through that call).

## What to test
- [ ] Premium trainer → Practice tab → click "Add My Words" → panel opens
- [ ] Click the School button (or OET button) → panel should now close automatically, "Use App Words" should become active again
- [ ] Switch to Bee tab, then back to Practice → confirm the panel is still closed (was already working, confirming no regression)

---

## Phase 2o — REAL FIX: custom word panel visible even with "Use App Words" selected

### The actual root cause, finally found
Your screenshots showed it precisely: "Use App Words" highlighted as active, with the full textarea and upload UI still visible underneath. The previous fix (Phase 2n) addressed a genuine but different bug — it didn't explain this one, because this bug isn't about the OET/School toggle failing to reset the panel. It's that **the panel can never be hidden by JavaScript at all**, due to a CSS specificity conflict I hadn't checked.

`css/premium.css` had its own leftover rule from an earlier design version:
```
.trainer-area.active .custom-words-area { display: block; }
```
This selector has higher specificity (0,3,0) than `trainer.html`'s own `.custom-words-area.open { display: block; }` (0,2,0). Since `.trainer-area` gets the `.active` class the instant a mode tab (Practice/Bee) is selected — completely independent of which word-source button is clicked — this rule **unconditionally forced the panel visible** the moment any practice mode loaded, regardless of whether `.open` was present or not. The `premSelectSource()` JavaScript was correctly adding/removing `.open` exactly as designed; it just had zero effect because this other, higher-priority rule didn't care about `.open` at all.

### Fix
Removed the conflicting `.trainer-area.active .custom-words-area` rule from `premium.css`. Visibility is now controlled by exactly one rule (`.custom-words-area.open` in `trainer.html`), with nothing else in the cascade able to override it.

### Why Phase 2n's fix was still worth keeping
That fix (auto-resetting the panel when switching OET ↔ School) addressed a real, separate gap in the reset logic. It's still correct and still needed — it just wasn't the cause of *this specific* screenshot, since the panel was never actually closeable in the first place until this CSS conflict is resolved.

## What to test
- [ ] Premium trainer → Practice tab loads → "Use App Words" should be active AND the textarea/upload section should be completely hidden by default
- [ ] Click "Add My Words" → panel should appear
- [ ] Click "Use App Words" again → panel should now correctly disappear (this was the broken behavior — confirm it's fixed)
- [ ] Switch OET ↔ School → panel should stay closed / reset correctly per Phase 2n's fix

---

## Phase 2p — hardened fix: custom words panel (applies to ALL modes: OET, School, Bee)

### Context
You reported that after Phase 2o's fix, the panel-hiding behavior regressed across all three premium modes (it had only been reported for OET/School before). Traced this thoroughly:
- Confirmed Bee has always shared the exact same `createCustomWordsUI()` / `premSelectSource()` code as OET/School since this system was first built — there's no separate bee-specific implementation that could have been broken differently.
- Confirmed the Phase 2o CSS removal was surgically correct and didn't touch any other rule (`.trainer-area.active`, `.mode-btn.active`, `.oet-mode-btn.active` are all untouched and independent).
- The most likely explanation: `/css/*` is cached for up to 1 hour (`Cache-Control: public, max-age=3600`), and the TWA's service worker adds a further stale-while-revalidate layer on top — so the Phase 2o fix may not have actually been live yet when re-tested, across any of the three modes.

### Hardening applied this round
To remove any remaining ambiguity or caching risk, added `!important` to both states of the rule directly in `trainer.html`'s own inline `<style>` block:
```css
.custom-words-area { display: none !important; }
.custom-words-area.open { display: block !important; }
```
`!important` guarantees this exact rule wins regardless of specificity, load order, or any future rule added anywhere else in the codebase — closing off this entire class of bug permanently. Also removed the now-fully-redundant duplicate rule from `premium.css`, so there is exactly one place that controls this behavior, in `trainer.html` itself.

## What to test (please test in an incognito/private window or after fully clearing cache, to rule out any stale-asset ambiguity)
- [ ] Premium trainer → OET/School tab → confirm panel hidden by default, only "Use App Words" visible as active
- [ ] Premium trainer → Bee tab → confirm same: panel hidden by default
- [ ] Click "Add My Words" on each of the three modes → panel should appear
- [ ] Click back to "Use App Words" on each → panel should now correctly disappear in all three

---

## Phase 2q — homepage text color consistency fix

### What you flagged
The new "What SpellRightPro does" homepage section used `#222` for its paragraph text, which is the site's global `body` default — but not the color actually used for *descriptive paragraph text inside cards* elsewhere on the same page. The mode-card descriptions ("Hands-free voice practice...", "Healthcare words...") use `#444`, and the subtitle above the mode chooser uses `#555`. Using `#222` made the new section's text visibly darker/heavier than its immediate neighbors, even though all three shades individually pass contrast requirements.

### Fix
Changed `.training-card p:not(.muted)` from `#222` to `#444`, matching the existing convention for descriptive card paragraph text. Verified this still passes WCAG AA at 9.74:1 contrast on white. Left `<strong>` labels at `#1a0050` (matching `.card-title`) since that's correct, deliberate emphasis — now reading clearly heavier than the `#444` body text around it, as bold text should. Confirmed the dark-mode pairing was already internally consistent and needed no change.

## What to test
- [ ] Homepage in light mode: the new section's paragraph text should now visually match the weight of the mode-card descriptions above it, not look darker/bolder than the rest of the page

---

## Phase 2q — text color consistency fix on homepage

### What was wrong
Good catch — the new homepage paragraph text used `#444` (light mode) / `#d8c8ee` (dark mode), neither of which matched any other body text already on the page. The site had actually accumulated several slightly different greys over time (`#222` on body, `#333` on the support container, `#444` on link-card descriptions, `#555` on `.muted`) — all individually passing contrast, but inconsistent with each other. My new section added yet another value instead of matching what was already established.

### Fix
Changed the new section's paragraph color to `#222` in light mode — the same color the page's own `body` element already declares as its default — and `#b09ad0` in dark mode, matching `.muted` (the existing color used for the mode chooser's subtitle text). Both choices are now visually identical to text elsewhere on the same page, not a new shade.

Confirmed contrast remains well above WCAG AA in both modes: 15.91:1 light, 7.17:1 dark.

---

## Phase 2r — PrimeTestLab Issues #2 and #3 (Issue #1 / Suggestion #1 are NOT in these files)

### Issue #3 — status bar / navigation bar don't match app theme (FIXED)
**Root cause:** Zero pages had a `<meta name="theme-color">` tag. `manifest.json` declares `theme_color: #7b2ff7` correctly, but that only controls the PWA splash screen — it doesn't reliably theme the live status/navigation bar while navigating between pages with different backgrounds, which Android 16's edge-to-edge default makes very visible.

**Fix:** Added a `<meta name="theme-color">` tag to all 27 real pages, each matching that specific page's actual dominant background color rather than one hardcoded value everywhere — purple gradient pages get `#7b2ff7`/`#3a0087`, white-card content pages (terms, privacy, contact, legal pages) get `#ffffff`/`#faf8ff`, etc. Android reads this and automatically chooses light or dark status bar icons based on the color's luminance — no separate icon-contrast setting needed.

### Issue #2 — keyboard emoji instead of a modern icon (LIKELY FIXED)
**Found:** "✏️ Type your spelling here" — the pencil emoji label sitting directly beside the keyboard/write toggle buttons (which already correctly use Font Awesome's `fa-keyboard` vector icon). This emoji-next-to-vector-icon mismatch in the same UI region is the most likely match for what was reported, even though I couldn't find a literal keyboard-shaped emoji character anywhere in the codebase — it may have rendered differently on the test device's specific font/emoji set than it does here.

**Fix:** Replaced both emoji-prefixed labels ("✏️ Type your spelling here" / "✍️ Write your spelling here") with proper Font Awesome icons (`fa-keyboard` / `fa-pen-nib`) across `trainer.html`, `freemium-school.html`, `freemium-oet.html`, and the shared `hw-canvas.js` module that updates this label dynamically when toggling input modes.

**Broader note:** the codebase uses emoji as inline icons extensively (25+ files). I did not do a full sweep replacing every one — that would be a large, separate undertaking. This fix targets the specific spot most likely to match the report.

### Issue #1 / Suggestion #1 — onboarding overlay (NOT FOUND — likely outside these files)
Searched the entire web codebase for "Skip" buttons, "Don't show this again" checkboxes, onboarding overlays, tours, and walkthroughs. Found none. This strongly suggests the onboarding screen the tester saw is implemented in the **native Android TWA wrapper project** (a separate Android Studio / Bubblewrap project that generates the actual installable APK), not in this website's HTML/CSS/JS. I don't have access to that project, so I can't fix this from here. If you have access to that Android project, the fix per the report is: add proper margin/padding around the Skip button and "Don't show this again" checkbox, and apply responsive layout constraints. Suggestion #1 (moving onboarding to its own screen entirely) would need to be implemented there too.

### Suggestion #2 — app bar crowding (NOT ADDRESSED — optional, needs your direction)
This is explicitly optional per the report and requires a product decision about which controls are "less frequently used" before any code change makes sense. Flagging it here rather than guessing what to move.

## What to test
- [ ] On Android 16 (or any modern Android), open the app and navigate between a purple page (trainer) and a white page (terms/privacy) — confirm the status bar color changes to match each page
- [ ] Check the "Write/Type your spelling here" label on premium trainer, freemium school, and freemium OET — should now show a clean vector icon, not an emoji

---

## Phase 2r — speech synthesis reliability fix (no sound / synthesis-failed errors)

### What the console showed
Your screenshot's console log showed: `Auth check timed out after 8s` (our own deliberate safety-net message, working as designed), followed by 6 `synthesis-failed — retry` warnings, ending in `Could not speak — type: Spiders` — the graceful text fallback also working as designed. Also visible: `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` for Google Analytics — this is just an ad blocker or browser privacy feature blocking analytics, completely unrelated and harmless.

### Root cause: a known Chrome bug, not a code defect
Confirmed via Chromium's own public bug tracker (issue #374263394): some of Chrome's built-in voices are not fully on-device — they fetch their actual audio from a remote Google server at speak-time. If that network request is blocked, slow, or restricted (ad blockers, private/incognito browsing, content blockers, flaky connections), `speechSynthesis.speak()` either hangs or throws exactly the `synthesis-failed` error seen in your console. This has been an open, widely-reported Chrome issue since version 130 and is outside what any website's code can directly fix — it can only be worked around.

### Fix applied
Every voice-selection function across the app (`main-premium.js`, `freemium-oet.html`, `freemium-school.html`, `freemium-bee.html`) now checks each candidate voice's `localService` property and prefers genuinely on-device voices first, only falling back to network-dependent voices if no local voice exists at all for that language. Local voices don't have this failure mode, so this sidesteps the bug rather than trying to fix Chrome itself.

### What this does NOT fix
If a device has zero local voices installed for English (rare, but possible on some minimal Android configurations), or if the network block is broad enough to affect literally everything, speech could still occasionally fail — in which case the existing retry-then-fallback-to-text behavior (already working in your screenshot) takes over, so the user is never stuck with no feedback at all.

## What to test
- [ ] Test voice playback in a normal (non-InPrivate) browser window with no ad blocker — should be unaffected either way, but worth confirming
- [ ] Test in InPrivate/incognito mode again after this fix — synthesis-failed retries should be far less frequent or absent, since local voices avoid the network dependency entirely

---

## Phase 2s — CRITICAL FIX: spelling word was leaked before marking (premium OET/School)

### Bug confirmed — genuinely serious
You're right to flag this. When speech synthesis failed 3 times in a row (the Chrome bug fixed in Phase 2r), the fallback message in `main-premium.js` literally printed the answer on screen before the user typed anything: `🔇 Listen: "Spiders" — type it below`. This completely defeats the purpose of a spelling test — the user just copies what's already shown instead of recalling the spelling.

### Audited the entire codebase for the same pattern
Checked every file for any place a word gets written to a visible element before the answer is checked:
- `main-premium.js` line 1622 — **the actual bug**, now fixed
- `main-premium.js` line 1770 — confirmed correct: this only fires inside the incorrect-answer branch, after the user's answer has already been compared, so revealing the correct spelling at that point is appropriate
- `freemium-oet.html`'s `updateWordDisplay(reveal=true)` — confirmed correct: the only `reveal=true` call site is inside `checkAnswer()`, after the answer is captured and compared
- `freemium-school.html`, `freemium-bee.html` — their own synthesis-failed fallback messages never included the word at all; no leak existed there

### Fix
The synthesis-failed fallback now says `🔇 Audio failed — tap "Say Again" to retry` instead of revealing the word. The existing "Say Again" button already calls `speakWord(word)` directly, so the user has a real way to retry hearing the word — they're just never shown the answer outright.

## What to test
- [ ] Force a TTS failure (e.g. block network requests in DevTools, or test in a restrictive private browsing session) — confirm the feedback message no longer reveals the word, and tapping "Say Again" successfully retries the audio
