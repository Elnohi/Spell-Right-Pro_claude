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
