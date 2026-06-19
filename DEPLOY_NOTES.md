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
