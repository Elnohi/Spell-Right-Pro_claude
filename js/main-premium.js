/* =======================================================
   SpellRightPro Premium Logic - UPDATED FIREBASE HANDLING
   ======================================================= */

// Wait for Firebase utils to be ready
let auth = null;
let db = null;
let currentUser = null;
let userIsPremium = false;

// --- Voice Recognition ---
let recognition = null;
let isListening = false;

// --- Real-time Marking Variables ---
let realTimeMarkingEnabled = true;

// --- Training Variables ---
let currentMode = null;
let currentIndex = 0;
let currentList = [];
let score = 0;
let correctWords = [];
let incorrectWords = [];
let flaggedWords = new Set();

// --- Custom Words Management ---
let customLists = (() => {
  try { return JSON.parse(localStorage.getItem('premiumCustomLists') || '{}'); }
  catch(e) { return {}; }
})();
let currentCustomList = null;
// selectedWordList is declared in trainer.html stub — do not re-declare here

// ── Session save / resume ──────────────────────────────────────────────────
const SESSION_SAVE_KEY = 'srp_session_state';
// No time-based expiry — session state persists until the user explicitly
// cancels via the ✕ button on the resume prompt, or until they start a
// fresh session (startTraining clears it). A 24-hour limit meant progress
// was silently lost overnight, defeating the purpose of session saving.

function saveSessionState(forceIndex0 = false) {
  // Guard: don't save if there's nothing meaningful to save.
  // forceIndex0 = true is passed by showSummary(earlyExit) so that tapping
  // "End Session" at word 1 (index 0) still persists the position.
  // Without it the user would lose their place if they quit immediately.
  if (!currentMode || !currentList.length) return;
  if (currentIndex === 0 && !forceIndex0) return;
  try {
    const state = {
      mode:             currentMode,
      list:             currentList,
      index:            currentIndex,
      score:            score,
      correctWords:     correctWords,
      incorrectWords:   incorrectWords,
      flaggedWords:     [...flaggedWords],
      selectedWordList: typeof selectedWordList !== 'undefined' ? selectedWordList : 'oet',
      examType:         document.querySelector('input[name="examType"]:checked')?.value || 'practice',
      savedAt:          Date.now()
    };
    localStorage.setItem(SESSION_SAVE_KEY, JSON.stringify(state));
  } catch(e) { console.warn('Session save failed:', e); }
}

function clearSessionState() {
  localStorage.removeItem(SESSION_SAVE_KEY);
}

function loadSessionState() {
  try {
    const raw = localStorage.getItem(SESSION_SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    // No time-based expiry — state persists until explicitly cancelled.
    // Validate the minimum fields needed to resume safely.
    if (!state.mode || !Array.isArray(state.list) || !state.list.length || state.index == null) {
      clearSessionState();
      return null;
    }
    return state;
  } catch(e) { return null; }
}

function showResumePrompt(state) {
  const existing = document.getElementById('srpResumePrompt');
  if (existing) existing.remove();

  const modeLabel = state.selectedWordList === 'school' ? 'School' :
                    state.mode === 'bee' ? 'Spelling Bee' :
                    state.examType === 'test' ? 'OET Exam (24 words)' : 'OET Full List';
  const pct = Math.round((state.index / state.list.length) * 100);

  // Human-readable "saved X ago" so the user knows how old their progress is
  let savedAgo = '';
  if (state.savedAt) {
    const ms = Date.now() - state.savedAt;
    const mins = Math.floor(ms / 60000);
    const hrs  = Math.floor(ms / 3600000);
    const days = Math.floor(ms / 86400000);
    if (days >= 1)       savedAgo = ` · saved ${days} day${days > 1 ? 's' : ''} ago`;
    else if (hrs >= 1)   savedAgo = ` · saved ${hrs}h ago`;
    else if (mins >= 1)  savedAgo = ` · saved ${mins}m ago`;
    else                 savedAgo = ` · just saved`;
  }

  const banner = document.createElement('div');
  banner.id = 'srpResumePrompt';
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#7b2ff7;color:#fff;border-radius:14px;padding:14px 20px;
    box-shadow:0 8px 32px rgba(0,0,0,0.25);z-index:10001;
    display:flex;align-items:center;gap:14px;font-size:0.9rem;
    max-width:480px;width:90%;
  `;
  banner.innerHTML = `
    <div style="flex:1">
      <strong>Resume last session?</strong><br>
      <span style="opacity:0.85">${modeLabel} — ${state.index}/${state.list.length} words (${pct}% done)${savedAgo}</span>
    </div>
    <button onclick="resumeSession()" style="background:#fff;color:#7b2ff7;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;white-space:nowrap">Resume</button>
    <button onclick="this.closest('#srpResumePrompt').remove();clearSessionState();" style="background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:8px;padding:8px 10px;cursor:pointer">✕</button>
  `;
  document.body.appendChild(banner);

  // No auto-dismiss: the banner persists until the user explicitly acts —
  // taps Resume, taps ✕ to discard, or starts a new session (which clears it).
  // A timed auto-dismiss was hiding the prompt before the user could see it,
  // because on reopen the 20s window was consumed by the auth/login overlay
  // and page settling, so the banner vanished before it was ever visible.
}

function resumeSession() {
  const state = loadSessionState();
  if (!state) return;
  document.getElementById('srpResumePrompt')?.remove();

  currentMode         = state.mode;
  currentList         = state.list;
  currentIndex        = state.index;
  score               = state.score;
  correctWords        = state.correctWords || [];
  incorrectWords      = state.incorrectWords || [];
  flaggedWords        = new Set(state.flaggedWords || []);

  // Switch to the correct mode tab WITHOUT calling modeBtn.click() —
  // clicking the button triggers startTraining() → resetTraining() which
  // wipes currentIndex back to 0 immediately after we restored it from state.
  // Instead we do exactly what the click handler does, minus the reset.
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const modeBtn = document.querySelector(`.mode-btn[data-mode="${currentMode}"]`);
  if (modeBtn) modeBtn.classList.add('active');

  document.querySelectorAll('.trainer-area').forEach(a => {
    a.style.display = 'none';
    a.classList.remove('active');
  });
  const area = document.getElementById(currentMode + '-area');
  if (area) {
    area.style.display = 'block';
    area.classList.add('active');
    area.classList.add('training-active'); // show training phase, not setup
  }

  // Restore word list selection label for practice mode (visual only — no reset)
  if (currentMode === 'practice' && state.selectedWordList &&
      typeof selectWordList === 'function') {
    // selectWordList resets currentList so we call it first, then re-restore
    selectWordList(state.selectedWordList);
    currentList  = state.list;
    currentIndex = state.index;
    score        = state.score;
    correctWords        = state.correctWords || [];
    incorrectWords      = state.incorrectWords || [];
    flaggedWords        = new Set(state.flaggedWords || []);
  }

  // Sync the tab bar if present
  document.querySelectorAll('.trainer-tab-bar a').forEach(a => a.classList.remove('active'));
  const tabLink = document.getElementById(`tab-${currentMode}`);
  if (tabLink) tabLink.classList.add('active');

  showFeedback(`Resumed — word ${currentIndex + 1} of ${currentList.length}`, 'info');
  if (typeof updateNavButtons === 'function') updateNavButtons(currentMode);
  nextWord();
}
// Mirrors the freemium Bee progression: starts gentle, speeds up only after
// the user demonstrates ≥80% accuracy. School and OET are unaffected.
let beeBeginnerEndIndex     = null;   // null = still at Beginner
let beeIntermediateEndIndex = null;   // null = not yet at Standard
let beeCorrectAtBeginnerEnd = 0;      // snapshot for per-level accuracy
let beeLastBadgeLevel       = null;   // for pulse animation on level change
const BEE_BEGINNER_MIN     = 5;       // need 5+ attempts before Beginner promotion
const BEE_INTERMEDIATE_MIN = 10;      // need 10+ more attempts at Intermediate
const BEE_PROMOTION_PCT    = 0.80;    // 80% accuracy required to advance

// Returns {rate, level, icon} for the CURRENT Bee level based on tracking vars.
// Used by speakWord (rate) and updateBeeBadge (display).
function getBeeDifficulty() {
  if (beeBeginnerEndIndex !== null) {
    if (beeIntermediateEndIndex !== null) {
      return { rate: 0.85, level: 'Standard',     icon: '\ud83c\udfc6' };
    }
    return   { rate: 0.75, level: 'Intermediate', icon: '\ud83c\udf3f' };
  }
  return     { rate: 0.6,  level: 'Beginner',     icon: '\ud83c\udf31' };
}

// Called in checkBeeAnswer AFTER correctWords/incorrectWords are updated.
// Sets beeBeginnerEndIndex / beeIntermediateEndIndex when criteria met.
function checkBeePromotion() {
  if (beeIntermediateEndIndex !== null) return;  // already at Standard
  const totalAttempts = correctWords.length + incorrectWords.length;

  if (beeBeginnerEndIndex === null) {
    if (totalAttempts < BEE_BEGINNER_MIN) return;
    const accuracy = correctWords.length / totalAttempts;
    if (accuracy >= BEE_PROMOTION_PCT) {
      beeBeginnerEndIndex = totalAttempts;
      beeCorrectAtBeginnerEnd = correctWords.length;
      console.log('🌿 Bee promoted to Intermediate at attempt ' + totalAttempts +
                  ' (' + correctWords.length + '/' + totalAttempts +
                  ' = ' + Math.round(accuracy * 100) + '%)');
    }
    return;
  }

  // Already at Intermediate — check for promotion to Standard
  const attemptsAtInter = totalAttempts - beeBeginnerEndIndex;
  const correctAtInter  = correctWords.length - beeCorrectAtBeginnerEnd;
  if (attemptsAtInter < BEE_INTERMEDIATE_MIN) return;
  const interAccuracy = correctAtInter / attemptsAtInter;
  if (interAccuracy >= BEE_PROMOTION_PCT) {
    beeIntermediateEndIndex = totalAttempts;
    console.log('🏆 Bee promoted to Standard at attempt ' + totalAttempts +
                ' (' + correctAtInter + '/' + attemptsAtInter +
                ' = ' + Math.round(interAccuracy * 100) + '%)');
  }
}

// Update the on-screen badge inside the bee-area. Pulses on level change.
function updateBeeBadge() {
  const badge = document.getElementById('beeDifficultyBadge');
  if (!badge) return;
  const diff = getBeeDifficulty();
  const iconEl  = badge.querySelector('.icon');
  const labelEl = badge.querySelector('.label');
  const metaEl  = badge.querySelector('.meta');
  if (iconEl) iconEl.textContent = diff.icon;
  if (labelEl) labelEl.textContent = diff.level + ' pace';

  // Build progress hint
  const totalAttempts = correctWords.length + incorrectWords.length;
  let hint = '';
  if (diff.level === 'Beginner') {
    if (totalAttempts < BEE_BEGINNER_MIN) {
      const remaining = BEE_BEGINNER_MIN - totalAttempts;
      hint = '\u2014 ' + correctWords.length + '/' + totalAttempts +
             ' so far \u00b7 ' + remaining + ' more then 80% to advance';
    } else {
      const pct = Math.round((correctWords.length / totalAttempts) * 100);
      hint = '\u2014 ' + correctWords.length + '/' + totalAttempts +
             ' (' + pct + '%) \u00b7 need 80% to advance';
    }
  } else if (diff.level === 'Intermediate') {
    const interAttempts = totalAttempts - beeBeginnerEndIndex;
    const interCorrect  = correctWords.length - beeCorrectAtBeginnerEnd;
    if (interAttempts < BEE_INTERMEDIATE_MIN) {
      const remaining = BEE_INTERMEDIATE_MIN - interAttempts;
      hint = '\u2014 ' + interCorrect + '/' + interAttempts +
             ' so far \u00b7 ' + remaining + ' more then 80% to advance';
    } else {
      const pct = interAttempts > 0 ? Math.round((interCorrect / interAttempts) * 100) : 0;
      hint = '\u2014 ' + interCorrect + '/' + interAttempts +
             ' (' + pct + '%) \u00b7 need 80% to advance';
    }
  } else {
    hint = '\u2014 Bee competition pace';
  }
  if (metaEl) metaEl.textContent = hint;

  badge.classList.add('visible');
  if (beeLastBadgeLevel !== null && beeLastBadgeLevel !== diff.level) {
    badge.classList.remove('level-up');
    void badge.offsetWidth;
    badge.classList.add('level-up');
  }
  beeLastBadgeLevel = diff.level;
}

// Initialize Firebase components when ready
function initializeFirebase() {
    // ── localStorage hint (NOT a gate) ──────────────────────────────────────
    // trainer.html pre-sets window._srpLocalPremium if localStorage is valid.
    // We use this only to SKIP the Firestore round-trip if Firebase auth
    // confirms the user is signed in — we still require auth.onAuthStateChanged.
    // DO NOT call hideOverlay() here — Firebase auth must confirm first.

    if (window.firebaseUtils && window.firebaseUtils.initialized) {
        auth = window.firebaseUtils.auth;
        db = window.firebaseUtils.db;
        console.log('✅ Firebase components initialized');
        
        // Test connection
        window.firebaseUtils.testConnection();
        
        // Start auth state listener (will further validate + sync if needed)
        setupAuthListener();
    } else {
        console.log('⏳ Waiting for Firebase utils...');
        setTimeout(initializeFirebase, 500);
    }
}

// Enhanced auth state handler
function setupAuthListener() {
    if (!auth) {
        console.error('❌ Auth not available');
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        console.log('🔐 Auth state changed:', user ? user.email : 'No user');
        
        if (user) {
            currentUser = user;
            console.log('✅ User authenticated:', user.email);
            
            // Check premium status
            // Check premium — localStorage hint first, then Firestore
            // This runs ONLY after Firebase confirms the user is signed in
            try {
                var stored = JSON.parse(localStorage.getItem('srpPremium') || 'null');
                if (stored && stored.active && new Date(stored.expiry) > new Date()) {
                    userIsPremium = true;
                    console.log('💎 Premium confirmed: localStorage (user authenticated)');
                }
            } catch(e) {}

            // Always verify with Firestore if not confirmed locally
            // (catches expired localStorage, new devices, cleared browser data)
            if (!userIsPremium && window.firebaseUtils) {
                userIsPremium = await window.firebaseUtils.checkPremiumStatus(user);
                console.log('💎 Premium status (Firestore):', userIsPremium);
            }
            
            if (userIsPremium) {
                hideOverlay();
                showFeedback('Welcome back to Premium!', 'success');
                // Only call initializePremiumFeatures if not already called
                if (!window._premiumFeaturesInitialized) {
                    initializePremiumFeatures();
                }
                // Hydrate localStorage from Firestore for cross-device sync
                if (window.firebaseUtils && typeof window.firebaseUtils.hydrateFromCloud === 'function') {
                    window.firebaseUtils.hydrateFromCloud(user.uid).then(() => {
                        // Reload custom lists UI after cloud data arrives
                        if (typeof refreshCustomListsUI === 'function') refreshCustomListsUI();
                    });
                }
                setTimeout(waitForFirestoreAndLoadLists, 3000);
            } else {
                showOverlay();
                showNonPremiumMessage();
            }
        } else {
            console.log('❌ No user, showing login');
            currentUser = null;
            userIsPremium = false;
            showOverlay();
        }
    });
}

// Show message for non-premium users
function showNonPremiumMessage() {
    const glassCard = document.querySelector('.glass-card');
    if (!glassCard) return;
    
    // Remove existing premium redirect messages
    const existingMessages = glassCard.querySelectorAll('.premium-redirect');
    existingMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'premium-redirect';
    messageDiv.innerHTML = `
        <div style="text-align: center; margin: 15px 0; padding: 15px; background: rgba(123, 47, 247, 0.1); border-radius: 8px;">
            <p style="margin: 0 0 10px 0;">Premium access required for full features.</p>
            <button onclick="window.location.href='/premium'" 
                    style="background: #7b2ff7; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 5px 0;">
                <i class="fa fa-crown"></i> Upgrade to Premium
            </button>
            <br>

        </div>
    `;
    
    glassCard.appendChild(messageDiv);
}

// UI Functions
function showOverlay() {
    const overlay = document.getElementById("loginOverlay");
    const mainContent = document.querySelector("main");
    const loadingCard = document.getElementById("authLoadingCard");
    const formCard = document.getElementById("authCardContent");
    if (overlay) overlay.style.display = "flex";
    if (mainContent) mainContent.style.display = "none";
    // Auth state is now known (no user / not premium) — swap spinner for the real form
    if (loadingCard) loadingCard.style.display = "none";
    if (formCard) formCard.style.display = "block";
}

function hideOverlay() {
    const overlay = document.getElementById("loginOverlay");
    const mainContent = document.querySelector("main");
    if (overlay) overlay.style.display = "none";
    if (mainContent) mainContent.style.display = "block";

    // Show resume prompt now that auth is confirmed and the main UI is visible.
    // Doing this here (instead of the blind 1500ms DOMContentLoaded timer) means
    // the prompt always appears AFTER the overlay has cleared, so it's never
    // hidden behind the login screen. The DOMContentLoaded timer is kept as a
    // fallback for rare cases where auth resolves before DOMContentLoaded fires.
    setTimeout(() => {
      const saved = loadSessionState();
      if (saved) showResumePrompt(saved);
    }, 400);
}

// Safety net: if Firebase auth hasn't resolved within 8 seconds (slow network,
// CDN blocked, etc.), stop showing the spinner and unblock the user.
// Without this, a slow connection leaves the user staring at a full-screen
// overlay with no way to interact with the page and no indication anything
// is wrong — taps on what looks like the practice screen are silently
// swallowed by this overlay sitting at z-index 9999.
//
// Three cases handled at the 8s mark:
// 1. Auth + premium check both resolved → hideOverlay() already called; spinner
//    is gone; this timeout is a no-op (loadingCard already hidden).
// 2. Auth resolved (currentUser set, userIsPremium true) but this timeout fires
//    before hideOverlay() ran (e.g. slow async Firestore check) → call hideOverlay()
//    now so the user isn't stuck waiting any longer.
// 3. Auth hasn't resolved at all (Firebase SDK slow on Android/TWA cold start) →
//    use the localStorage srpPremium hint. If a valid, non-expired record exists
//    the user is almost certainly still premium; dismiss the overlay optimistically.
//    If no localStorage hint, fall back to showing the login form.
setTimeout(() => {
    const loadingCard = document.getElementById("authLoadingCard");
    const formCard = document.getElementById("authCardContent");
    if (!loadingCard || loadingCard.style.display === "none") return; // case 1 — already resolved

    console.warn('⏱️ Auth check timed out after 8s');

    // Case 2: onAuthStateChanged already confirmed user + premium — just unblock
    if (currentUser && userIsPremium) {
        console.warn('⏱️ Auth resolved but overlay still up — calling hideOverlay()');
        hideOverlay();
        return;
    }

    // Case 3: Auth never fired — check localStorage hint
    if (window._srpLocalPremium) {
        console.warn('⏱️ Firebase slow — dismissing overlay via localStorage hint');
        hideOverlay();
        showFeedback('Signed in (offline cache) — syncing in background…', 'info');
        // Keep trying to complete Firebase auth in the background so Firestore
        // sync and real premium verification still happen once the SDK is ready.
        return;
    }

    // No hint and no auth — show the login form so the user isn't stuck
    console.warn('⏱️ No auth, no hint — showing login form');
    loadingCard.style.display = "none";
    if (formCard) formCard.style.display = "block";
    showFeedback('Taking longer than usual — please sign in or check your connection', 'info');
}, 8000);

function showFeedback(message, type = "info") {
    const existing = document.querySelector(".feedback-message");
    if (existing) existing.remove();

    const feedback = document.createElement("div");
    feedback.className = `feedback-message ${type}`;
    feedback.textContent = message;
    feedback.style.cssText = `
        margin-top: 10px; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : type === 'warning' ? '#fff3cd' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : type === 'warning' ? '#856404' : '#0c5460'};
        border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : type === 'warning' ? '#ffeaa7' : '#bee5eb'};
    `;

    document.querySelector('.glass-card')?.appendChild(feedback);
    setTimeout(() => feedback.remove(), 4000);
}

// Enhanced login form
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        showFeedback('Logging in...', 'info');
        
        if (!auth) {
            throw new Error('Authentication service not available');
        }
        
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        
        // Check premium status
        if (window.firebaseUtils) {
            userIsPremium = await window.firebaseUtils.checkPremiumStatus(userCredential.user);
        }
        
        if (userIsPremium) {
            hideOverlay();
            showFeedback('Welcome back to Premium!', 'success');
            initializePremiumFeatures();
        } else {
            showFeedback('Premium access required. Redirecting to pricing...', 'info');
            setTimeout(() => {
                window.location.href = '/premium';
            }, 2000);
        }
    } catch (error) {
        console.error('Login error:', error);
        showFeedback(`Login failed: ${error.message}`, 'error');
    }
});

// Enhanced register form
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    if (password !== confirmPassword) {
        showFeedback('Passwords do not match', 'error');
        return;
    }

    try {
        showFeedback('Creating account...', 'info');
        
        if (!auth) {
            throw new Error('Authentication service not available');
        }
        
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        // NEW FIX: Redirect to pricing page after successful registration
        showFeedback('Account created! Redirecting to pricing...', 'success');
        
        // Redirect to pricing page after a short delay
        setTimeout(() => {
            window.location.href = '/premium';
        }, 2000);
        
    } catch (error) {
        console.error('Registration error:', error);
        showFeedback(`Registration failed: ${error.message}`, 'error');
    }
});

// Form toggle
document.getElementById('showRegister')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('showRegister').style.display = 'none';
    document.getElementById('showLogin').style.display = 'inline';
});

document.getElementById('showLogin')?.addEventListener('click', () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('showLogin').style.display = 'none';
    document.getElementById('showRegister').style.display = 'inline';
});

// Logout
document.getElementById('btnLogout')?.addEventListener('click', () => {
    if (auth) {
        auth.signOut();
        showOverlay();
        showFeedback('Logged out successfully', 'info');
    }
});

// Quick Test function
// quickTest() removed for production security

// Dark Mode Toggle
document.getElementById('toggleDark')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('toggleDark').querySelector('i');
    if (icon) {
        icon.classList.toggle('fa-moon');
        icon.classList.toggle('fa-sun');
    }
});

// Initialize premium features only for paid users

// Activate the default trainer area (School) after login.
// Without this, all .trainer-area elements remain display:none and the
// page appears blank after authentication. The mode-tab buttons then
// allow switching between school / oet / bee.
function activateDefaultMode() {
  // Pick the first trainer-area (school) by default
  var defaultArea = document.getElementById('practice-area');
  if (!defaultArea) {
    // Fallback: first trainer area in the DOM
    defaultArea = document.querySelector('.trainer-area');
  }
  if (defaultArea) {
    defaultArea.style.display = 'block';
    defaultArea.classList.add('active');
    defaultArea.classList.remove('training-active'); // Show setup phase
    console.log('✅ Default trainer area activated:', defaultArea.id);
  }

  // Mark the corresponding mode button as active in tab bar
  var defaultBtn = document.querySelector('.mode-btn[data-mode="practice"]') ||
                   document.querySelector('.mode-btn');
  if (defaultBtn) {
    document.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.remove('active'); });
    defaultBtn.classList.add('active');
    window.currentMode = defaultBtn.dataset.mode || 'practice';
  }

  // Sync bottom tab bar (mobile)
  var defaultTabLink = document.getElementById('tab-practice');
  if (defaultTabLink) {
    document.querySelectorAll('.trainer-tab-bar a').forEach(function(a){ a.classList.remove('active'); });
    defaultTabLink.classList.add('active');
  }
}

function initializePremiumFeatures() {
  if (window._premiumFeaturesInitialized) {
    console.log('⚠️ initializePremiumFeatures already ran — skipping duplicate');
    return;
  }
  window._premiumFeaturesInitialized = true;
  var userEmail = (currentUser && currentUser.email) ? currentUser.email : 'localStorage-verified';
  console.log('Initializing premium features for:', userEmail);
  
  // REMOVE ADS for premium users
  if (window.adManager) {
    window.adManager.removeAds();
  }
  
  // Initialize speech
  initializeSpeechSynthesis();
  
  // Initialize core features
  createCustomWordsUI();
  initializeCustomWords();
  initializeRealTimeValidation();
  
  // ===== NEW: INITIALIZE PREMIUM PILLARS =====
  
  // 1. Progress Dashboard
  if (typeof ProgressDashboard !== 'undefined') {
    window.progressDashboard = new ProgressDashboard();
    console.log('✅ Progress Dashboard initialized');
  }
  
  // 2. Mistake Review
  if (typeof MistakeReview !== 'undefined') {
    window.mistakeReview = new MistakeReview();
    console.log('✅ Mistake Review initialized');
  }
  
  // 3. Adaptive Drill
  if (typeof AdaptiveDrill !== 'undefined') {
    window.adaptiveDrill = new AdaptiveDrill();
    console.log('✅ Adaptive Drill initialized');
  }
  
  // 4. Premium Content Packs
  // loadPremiumContentPacks() — removed

  // 5. Activate default trainer area (School) so the page isn't blank after login
  activateDefaultMode();

  // Set user as premium
  if (window.tierManager) {
    window.tierManager.setTier('premium', {
      plan: 'premium',
      activatedAt: new Date().toISOString(),
      active: true
    });
  }
}

// loadPremiumContentPacks() removed — content pack UI was showing
// placeholder cards with incorrect word counts. Words are still
// accessible by uploading a custom list.

// Add premium pack loading function
function loadPremiumPack(packName) {
  const packs = {
    'oet_medicine': {
      name: 'OET Medicine: Specialist Terms',
      words: [
        'anesthesiology', 'cardiovascular', 'dermatology', 'endocrinology', 'gastroenterology',
        'hematology', 'immunology', 'nephrology', 'neurology', 'obstetrics', 'oncology',
        'ophthalmology', 'orthopedics', 'otolaryngology', 'pediatrics', 'psychiatry',
        'pulmonology', 'radiology', 'rheumatology', 'urology', 'anaphylaxis', 'arrhythmia',
        'asymptomatic', 'benign', 'carcinoma', 'congenital', 'contraindication', 'edema',
        'embolism', 'etiology', 'exacerbation', 'hematoma', 'hypertension', 'hypotension',
        'idiopathic', 'ischemia', 'malignant', 'metastasis', 'morbidity', 'mortality',
        'neoplasm', 'nosocomial', 'occlusion', 'pathology', 'prognosis', 'remission',
        'septicemia', 'thrombosis', 'vasodilation'
      ],
      description: 'Specialist medical terminology for healthcare professionals'
    },
    'spelling_champion': {
      name: 'Spelling Champion\'s Drill',
      words: [
        'accommodate', 'conscience', 'dilemma', 'embarrass', 'guarantee', 'harass', 
        'immediately', 'liaison', 'manoeuvre', 'necessary', 'occurrence', 'parallel',
        'privilege', 'queue', 'receive', 'separate', 'supersede', 'threshold', 
        'unnecessary', 'weird', 'bureaucracy', 'conscientious', 'dachshund', 'ecstasy',
        'fluorescent', 'gauge', 'hygiene', 'jewelry', 'liaison', 'mnemonic',
        'nauseous', 'ophthalmology', 'phlegm', 'quinoa', 'rhythm', 'schedule',
        'syringe', 'thorough', 'vacuum', 'yacht', 'zucchini', 'asthma',
        'colonel', 'debt', 'gnaw', 'honest', 'island', 'knight', 'psalm', 'sword'
      ],
      description: 'The ultimate challenge for spelling perfectionists'
    }
  };
  
  const pack = packs[packName];
  if (!pack) return;
  
  // Add to custom lists
  if (!window.customLists) window.customLists = {};
  window.customLists[pack.name] = {
    words: pack.words,
    createdAt: new Date().toISOString(),
    wordCount: pack.words.length,
    type: 'premium_pack',
    description: pack.description
  };
  
  localStorage.setItem('premiumCustomLists', JSON.stringify(window.customLists));
  
  // Load the pack
  if (typeof window.loadCustomList === 'function') {
    window.loadCustomList(pack.name);
  }
  
  // Show success message
  showFeedback(`Loaded "${pack.name}" premium pack!`, 'success');
  
  // Track usage
  window.trackEvent('premium_pack_loaded', {
    pack_name: packName,
    word_count: pack.words.length
  });
}

// checkAnswer() defined below (ENHANCED version)

// =======================================================
// VOICE RECOGNITION (Existing code remains the same)
// =======================================================

function initializeSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onstart = function() {
      isListening = true;
      updateBeeVoiceUI(true);
    };
    
    recognition.onresult = function(event) {
      const spokenText = event.results[0][0].transcript.trim();
      processSpokenSpelling(spokenText);
    };
    
    recognition.onerror = function(event) {
      console.error('Speech recognition error:', event.error);
      showFeedback(`Voice recognition error: ${event.error}`, 'error');
      updateBeeVoiceUI(false);
      isListening = false;
    };
    
    recognition.onend = function() {
      isListening = false;
      updateBeeVoiceUI(false);
    };
  } else {
    console.warn('Speech recognition not supported in this browser');
    showFeedback('Voice recognition not supported. Please use Chrome or Edge.', 'warning');
  }
}

function updateBeeVoiceUI(listening) {
  const voiceStatus = document.getElementById('beeVoiceStatus');
  const voiceText = document.getElementById('beeVoiceText');
  const recognizedText = document.getElementById('beeRecognizedText');
  
  if (listening) {
    voiceStatus.style.display = 'block';
    voiceText.textContent = 'Listening... Speak now!';
    recognizedText.style.display = 'none';
    animateVoiceVisualizer(true);
  } else {
    voiceStatus.style.display = 'none';
    animateVoiceVisualizer(false);
  }
}

function animateVoiceVisualizer(active) {
  const bars = document.querySelectorAll('.voice-bar');
  bars.forEach(bar => {
    if (active) {
      bar.style.animation = 'voicePulse 0.8s infinite alternate';
    } else {
      bar.style.animation = 'none';
      bar.style.height = '8px';
    }
  });
}

// ── Bee: phonetic letter-name map (shared with freemium bee) ─────────────────
// Handles "see ay tee" → "cat", "double you" → "w", etc.
// Ported from freemium-bee.html for parity.
const BEE_PHONETIC = {
  'ay':'a','bee':'b','see':'c','cee':'c','dee':'d','ee':'e',
  'ef':'f','eff':'f','gee':'g','aitch':'h','haitch':'h','eye':'i',
  'jay':'j','kay':'k','el':'l','ell':'l','em':'m','en':'n',
  'oh':'o','oe':'o','pee':'p','cue':'q','que':'q','ar':'r',
  'arr':'r','ess':'s','tee':'t','you':'u','yew':'u','vee':'v',
  'double you':'w','doubleyou':'w','double u':'w',
  'ex':'x','why':'y','wye':'y','zed':'z','zee':'z',
  'sea':'c','be':'b','we':'w','tea':'t','are':'r','use':'u'
};

function transcriptToSpelling(transcript) {
  const t = transcript.toLowerCase().trim();
  // Single token with no spaces → whole word spoken (e.g. competition mode)
  if (!/[\s\-,]/.test(t)) return t;
  const tokens = t.split(/[\s\-,\.]+/).filter(Boolean);
  // All single letters: "c a t" → "cat"
  if (tokens.every(tok => tok.length === 1)) return tokens.join('');
  // Phonetic letter names: greedy two-token first ("double you"), then single
  const mapped = [];
  let i = 0;
  while (i < tokens.length) {
    const two = tokens.slice(i, i + 2).join(' ');
    if (BEE_PHONETIC[two]) { mapped.push(BEE_PHONETIC[two]); i += 2; continue; }
    const one = tokens[i];
    if (BEE_PHONETIC[one]) { mapped.push(BEE_PHONETIC[one]); i++; continue; }
    return t; // unmappable — fall back to raw transcript
  }
  if (mapped.every(ch => ch.length === 1)) return mapped.join('');
  return t;
}

function processSpokenSpelling(spokenText) {
  const recognizedText = document.getElementById('beeRecognizedText');
  const spokenTextElement = document.getElementById('beeSpokenText');
  
  spokenTextElement.textContent = spokenText;
  recognizedText.style.display = 'block';
  
  setTimeout(() => {
    checkBeeAnswer(spokenText);
  }, 1000);
}

function startVoiceRecognition() {
  if (!recognition) {
    showFeedback('Voice recognition not available', 'error');
    return;
  }
  
  if (isListening) {
    recognition.stop();
    return;
  }
  
  try {
    recognition.start();
    showFeedback('Listening... Spell the word letter by letter', 'info');
  } catch (error) {
    console.error('Error starting recognition:', error);
    showFeedback('Error starting voice recognition', 'error');
  }
}

function checkBeeAnswer(spokenText) {
  if (currentIndex >= currentList.length) return;
  
  const word = currentList[currentIndex];
  // Use phonetic-aware transcription instead of simple strip
  const normalizedSpoken = transcriptToSpelling(spokenText.toLowerCase().trim());
  const normalizedWord = word.toLowerCase().trim();
  
  document.getElementById('beeRecognizedText').style.display = 'none';
  
  if (normalizedSpoken === normalizedWord) {
    score++;
    correctWords.push(word);
    showFeedback("✅ Correct! Well done!", "success");
    const feedbackElement = document.getElementById('beeFeedback');
    feedbackElement.style.color = '#28a745';
    feedbackElement.style.fontWeight = 'bold';
  } else {
    incorrectWords.push({ word: word, answer: spokenText });
    showFeedback(`❌ Incorrect. The word was: ${word}`, "error");
    const feedbackElement = document.getElementById('beeFeedback');
    feedbackElement.style.color = '#dc3545';
    feedbackElement.style.fontWeight = 'bold';
  }

  // Adaptive difficulty: check whether user has earned promotion
  checkBeePromotion();
  updateBeeBadge();

  currentIndex++;
  
  if (currentIndex < currentList.length) {
    setTimeout(nextWord, 2000);
  } else {
    setTimeout(showSummary, 1500);
  }
}

// =======================================================
// REAL-TIME MARKING (Existing code remains the same)
// =======================================================

function initializeRealTimeValidation() {
    // Add real-time marking toggle
    const realTimeToggleHTML = `
        <div class="real-time-marking-toggle" style="margin: 12px 0 4px; display: flex; align-items: center; justify-content: center; gap: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; background:var(--surface2); border:1.5px solid rgba(123,47,247,0.3); border-radius:8px; padding:7px 14px;">
                <input type="checkbox" id="realTimeMarkingToggle" checked style="width:16px;height:16px;accent-color:var(--brand);cursor:pointer;">
                <span style="font-size:0.85rem;font-weight:600;color:var(--brand);">Real-time Spelling Check</span>
            </label>
        </div>
    `;
    
    // Add to each trainer area except bee mode
    document.querySelectorAll('.trainer-area').forEach(area => {
        if (!area.id.includes('bee')) {
            const inputGroup = area.querySelector('.input-group');
            if (inputGroup) {
                inputGroup.insertAdjacentHTML('beforebegin', realTimeToggleHTML);
            }
        }
    });
    
    // Add event listener for toggle
    document.addEventListener('change', function(e) {
        if (e.target.id === 'realTimeMarkingToggle') {
            realTimeMarkingEnabled = e.target.checked;
            showFeedback(`Real-time marking ${realTimeMarkingEnabled ? 'enabled' : 'disabled'}`, 'info');
            clearRealTimeFeedback();
        }
    });
    
    document.querySelectorAll('.answer-input').forEach(input => {
        input.addEventListener('input', function() {
            if (!realTimeMarkingEnabled || currentIndex >= currentList.length) return;
            
            const currentWord = currentList[currentIndex];
            const userInput = this.value.trim().toLowerCase();
            const correctWord = currentWord.toLowerCase();

            // Detect dark mode — trainer.html uses body.dark-mode class
            const dark = document.body.classList.contains('dark-mode');

            // Text colours: darker shades pass WCAG AA in light mode (#f5f0fe bg);
            // bright shades pass WCAG AA in dark mode (#1d0a37 bg).
            // Borders/backgrounds use the bright CSS vars in both modes.
            const c = {
                ok:   dark ? '#00c57a' : '#007048',
                warn: dark ? '#ffb800' : '#7a5200',
                fail: dark ? '#ff4560' : '#c8002a',
            };

            if (userInput === '') {
                // Empty — remove all inline overrides so CSS defaults restore
                this.style.removeProperty('border-color');
                this.style.removeProperty('background-color');
                this.style.removeProperty('color');
                this.style.removeProperty('font-weight');
                this.style.removeProperty('text-decoration');
            } else if (userInput === correctWord) {
                this.style.borderColor = 'var(--ok)';
                this.style.backgroundColor = 'rgba(0,197,122,0.12)';
                this.style.color = c.ok;
                this.style.fontWeight = 'bold';
                this.style.textDecoration = 'none';
            } else if (correctWord.startsWith(userInput)) {
                this.style.borderColor = 'var(--warn)';
                this.style.backgroundColor = 'rgba(255,184,0,0.12)';
                this.style.color = c.warn;
                this.style.fontWeight = 'normal';
                this.style.textDecoration = 'none';
            } else {
                this.style.borderColor = 'var(--fail)';
                this.style.backgroundColor = 'rgba(255,69,96,0.10)';
                this.style.color = c.fail;
                this.style.fontWeight = 'normal';
                this.style.textDecoration = 'line-through';
            }
        });
        
        // Add focus styling
        input.addEventListener('focus', function() {
            this.style.borderColor = '#7b2ff7';
            this.style.boxShadow = '0 0 0 2px rgba(123, 47, 247, 0.3)';
        });
        
        input.addEventListener('blur', function() {
            this.style.boxShadow = 'none';
        });
    });
}

function clearRealTimeFeedback() {
    const inputElement = document.getElementById(`${currentMode}Input`);
    if (inputElement) {
        // Remove inline style overrides entirely so the stylesheet's
        // color:var(--text) and background:transparent take back over.
        // Previously this hardcoded color:'white', making typed text
        // invisible in light mode.
        inputElement.style.removeProperty('border-color');
        inputElement.style.removeProperty('background-color');
        inputElement.style.removeProperty('color');
        inputElement.style.removeProperty('font-weight');
        inputElement.style.removeProperty('text-decoration');
        inputElement.style.removeProperty('box-shadow');
    }
}

// =======================================================
// CUSTOM WORDS MANAGEMENT (Existing code remains the same)
// =======================================================

function createCustomWordsUI() {
  const modeConfigs = {
    school: { count: '1,200+ school words',   hint: 'Built-in school word list is ready' },
    oet:    { count: '1,511 OET medical words', hint: 'Full OET medical word list is ready' },
    bee:    { count: '500+ bee words',          hint: 'Built-in Spelling Bee word list is ready' }
  };

  document.querySelectorAll('.trainer-area').forEach(area => {
    // Don't inject twice
    if (area.querySelector('.word-source-row')) return;

    const mode = area.id.replace('-area', '');
    const cfg  = modeConfigs[mode] || { count: 'built-in words', hint: 'Word list is ready' };

    const customHTML = `
      <!-- ── Word source selector ─────────────────────────────────────── -->
      <div class="word-source-row" style="margin-bottom:14px;">
        <button class="source-btn active" id="btnUseApp-${mode}"
                onclick="premSelectSource('app','${mode}')">
          <i class="fa fa-book-open"></i>
          <strong>Use App Words</strong>
          <small>${cfg.count}</small>
        </button>
        <button class="source-btn" id="btnUseCustom-${mode}"
                onclick="premSelectSource('custom','${mode}')">
          <i class="fa fa-pen"></i>
          <strong>Add My Words</strong>
          <small>Paste, type or upload</small>
        </button>
      </div>

      <!-- App words hint -->
      <div class="app-word-hint" id="appHint-${mode}">
        <i class="fa fa-check-circle"></i>
        <span>${cfg.hint} — press <strong>Start</strong> below.</span>
      </div>

      <!-- Custom words panel (collapsed by default) -->
      <div class="custom-words-area" id="customPanel-${mode}">

        <!-- Quick paste / type -->
        <div style="margin-bottom:12px;">
          <label class="upload-label">
            <i class="fa fa-keyboard"></i> Type or paste words
          </label>
          <textarea id="quickWordsInput"
            placeholder="One word per line, or comma-separated&#10;&#10;e.g.&#10;necessary&#10;accommodate&#10;rhythm"
          ></textarea>
          <button onclick="createQuickList()" class="nav-btn" style="margin-top:4px;">
            <i class="fa fa-plus"></i> Save as quick list &amp; start
          </button>
        </div>

        <!-- Divider -->
        <div style="border-top:1px solid var(--border);margin:12px 0;"></div>

        <!-- Upload a file -->
        <div style="margin-bottom:12px;">
          <label class="upload-label">
            <i class="fa fa-upload"></i> Upload a word list file (.txt or .csv)
          </label>
          <div class="upload-row">
            <input type="text" id="newListName" placeholder="Give your list a name"
                   style="flex:1;min-width:120px;padding:8px 10px;border-radius:8px;
                          border:1.5px solid var(--border);background:var(--surface2);
                          color:var(--text);font-family:inherit;font-size:0.85rem;">
            <input type="file" id="wordListFile" accept=".txt,.csv"
                   style="flex:2;min-width:0;font-size:0.8rem;">
            <button onclick="uploadWordList()" class="nav-btn">
              <i class="fa fa-upload"></i> Upload
            </button>
          </div>
        </div>

        <!-- Saved lists -->
        <div>
          <label class="upload-label">
            <i class="fa fa-list"></i> Your saved lists
          </label>
          <div id="customListsContainer" class="lists-container"></div>
        </div>

      </div>
    `;

    const title = area.querySelector('h3');
    if (title) {
      title.insertAdjacentHTML('afterend', customHTML);
    }
  });

  // Initialise: load saved lists and update display
  initializeCustomWords();
}

// ── Source selector controller ────────────────────────────────────────────────
function premSelectSource(source, mode) {
  const appBtn    = document.getElementById('btnUseApp-'    + mode);
  const custBtn   = document.getElementById('btnUseCustom-' + mode);
  const appHint   = document.getElementById('appHint-'      + mode);
  const custPanel = document.getElementById('customPanel-'  + mode);

  if (source === 'app') {
    if (appBtn)    appBtn.classList.add('active');
    if (custBtn)   custBtn.classList.remove('active');
    if (appHint)   appHint.style.display   = 'flex';
    if (custPanel) custPanel.classList.remove('open');
    // Clear any typed/pasted words so the built-in list is used
    const qw = document.getElementById('quickWordsInput');
    if (qw) qw.value = '';
    // Clear any custom list selection so next Start uses built-in words
    if (typeof currentCustomList !== 'undefined') currentCustomList = null;
  } else {
    if (custBtn)   custBtn.classList.add('active');
    if (appBtn)    appBtn.classList.remove('active');
    if (appHint)   appHint.style.display   = 'none';
    if (custPanel) custPanel.classList.add('open');
  }
}


function initializeCustomWords() {
  loadCustomLists();
  updateCustomListsDisplay();
}

function uploadWordList() {
  const listName = document.getElementById('newListName').value.trim();
  const fileInput = document.getElementById('wordListFile');
  
  if (!listName) {
    showFeedback('Please enter a list name', 'error');
    return;
  }
  
  if (!fileInput.files.length) {
    showFeedback('Please select a file', 'error');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const content = e.target.result;
      const words = parseWordList(content, file.name);
      
      if (words.length === 0) {
        showFeedback('No valid words found in file', 'error');
        return;
      }
      
      customLists[listName] = {
        words: words,
        createdAt: new Date().toISOString(),
        wordCount: words.length
      };
      
      saveCustomLists();
      updateCustomListsDisplay();
      document.getElementById('newListName').value = '';
      fileInput.value = '';
      showFeedback(`List "${listName}" created with ${words.length} words`, 'success');
      submitWordsForReview(words, listName);
    } catch (error) {
      showFeedback('Error reading file: ' + error.message, 'error');
    }
  };
  
  reader.readAsText(file);
}

function parseWordList(content, filename) {
  let words = [];
  
  if (filename.toLowerCase().endsWith('.csv')) {
    words = content.split(',')
      .map(word => word.trim())
      .filter(word => word.length > 0);
  } else {
    words = content.split('\n')
      .map(word => word.trim())
      .filter(word => word.length > 0);
  }
  
  return [...new Set(words)].filter(word => word.length > 0);
}

function createQuickList() {
  const input = document.getElementById('quickWordsInput').value.trim();
  const listName = `Quick List ${new Date().toLocaleDateString()}`;
  
  if (!input) {
    showFeedback('Please enter some words', 'error');
    return;
  }
  
  const words = input.split(/[\n,]/)
    .map(word => word.trim())
    .filter(word => word.length > 0);
  
  if (words.length === 0) {
    showFeedback('No valid words found', 'error');
    return;
  }
  
  customLists[listName] = {
    words: words,
    createdAt: new Date().toISOString(),
    wordCount: words.length
  };
  
  saveCustomLists();
  updateCustomListsDisplay();
  document.getElementById('quickWordsInput').value = '';
  showFeedback(`Quick list created with ${words.length} words`, 'success');
  submitWordsForReview(words, listName);
}

function updateCustomListsDisplay() {
  const container = document.getElementById('customListsContainer');
  if (!container) return;
  
  if (Object.keys(customLists).length === 0) {
    container.innerHTML = '<p style="opacity: 0.7; text-align: center;">No custom lists yet. Upload your first list!</p>';
    return;
  }
  
  let html = '<div class="lists-grid">';
  
  Object.entries(customLists).forEach(([listName, listData]) => {
    html += `
      <div class="list-card">
        <div class="list-header">
          <strong>${listName}</strong>
          <span class="word-count">${listData.wordCount} words</span>
        </div>
        <div class="list-words-preview">
          ${listData.words.slice(0, 3).join(', ')}${listData.words.length > 3 ? '...' : ''}
        </div>
        <div class="list-actions">
          <button onclick="loadCustomList('${listName}')" class="btn-small">
            <i class="fa fa-play"></i> Use
          </button>
          <button onclick="renameCustomList('${listName}')" class="btn-small">
            <i class="fa fa-edit"></i> Rename
          </button>
          <button onclick="deleteCustomList('${listName}')" class="btn-small btn-danger">
            <i class="fa fa-trash"></i> Delete
          </button>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

function loadCustomList(listName) {
  if (!customLists[listName]) {
    showFeedback('List not found', 'error');
    return;
  }
  
  currentCustomList = listName;
  currentList = customLists[listName].words;
  showFeedback(`Loaded "${listName}" with ${currentList.length} words`, 'success');
  
  if (currentMode) {
    setTimeout(() => {
      startTraining(currentMode);
    }, 1000);
  }
}

function renameCustomList(oldName) {
  const newName = prompt('Enter new name for the list:', oldName);
  if (newName && newName.trim() && newName !== oldName) {
    if (customLists[newName]) {
      showFeedback('A list with this name already exists', 'error');
      return;
    }
    
    customLists[newName] = customLists[oldName];
    delete customLists[oldName];
    saveCustomLists();
    updateCustomListsDisplay();
    showFeedback(`List renamed to "${newName}"`, 'success');
  }
}

function deleteCustomList(listName) {
  if (confirm(`Are you sure you want to delete "${listName}"?`)) {
    delete customLists[listName];
    saveCustomLists();
    updateCustomListsDisplay();
    showFeedback(`List "${listName}" deleted`, 'success');
  }
}

async function submitWordsForReview(words, listName) {
  if (!currentUser || !words || words.length === 0) return;
  try {
    await fetch('/.netlify/functions/word-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words, userId: currentUser.uid, listName: listName || 'unnamed' })
    });
  } catch(e) {}
}

function saveCustomLists() {
  try { localStorage.setItem('premiumCustomLists', JSON.stringify(customLists)); }
  catch(e) { console.warn('localStorage blocked — custom list saved in memory only'); }
}

function waitForFirestoreAndLoadLists() {
  const fsDb = (window.firebaseUtils && window.firebaseUtils.db) || db;
  if (!fsDb || !currentUser) { setTimeout(waitForFirestoreAndLoadLists, 400); return; }
  try {
    const promise = fsDb.collection('userLists').doc(currentUser.uid).get();
    promise.then(snap => {
      if (!snap.exists) return;
      const remote = snap.data().lists || {};
      let changed = false;
      for (const [name, data] of Object.entries(remote)) {
        if (!customLists[name]) { customLists[name] = data; changed = true; }
      }
      if (changed) {
        try { localStorage.setItem('premiumCustomLists', JSON.stringify(customLists)); } catch(e) {}
        updateCustomListsDisplay();
      }
    }).catch(e => {
      if (e.code === 'unavailable' || (e.message && e.message.includes('no-app')))
        setTimeout(waitForFirestoreAndLoadLists, 600);
    });
  } catch(e) { setTimeout(waitForFirestoreAndLoadLists, 600); }
}

async function syncListsToFirestore() {
  try {
    const fsDb = (window.firebaseUtils && window.firebaseUtils.db) || db;
    if (!fsDb || !currentUser) return;
    await fsDb.collection('userLists').doc(currentUser.uid).set({
      lists: customLists, updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch(e) { console.warn('Firestore sync failed:', e.message); }
}

function loadCustomLists() {
  try {
    const saved = localStorage.getItem('premiumCustomLists');
    if (saved) customLists = JSON.parse(saved);
  } catch(e) {
    console.warn('localStorage blocked — using in-memory custom lists');
  }
}

// =======================================================
// TRAINING LOGIC (Existing code remains the same)
// =======================================================


// OET mode selector — updates radio inputs and Start button label
function selectWordList(list) {
  selectedWordList = list;
  const oetBtn    = document.getElementById('btnListOET');
  const schoolBtn = document.getElementById('btnListSchool');
  const oetPanel  = document.getElementById('oetModePanel');
  const startBtn  = document.getElementById('practiceStartBtn');

  // Switching the built-in word source should return to "Use App Words" —
  // otherwise the upload/paste panel from a previous "Add My Words" click
  // stays visible indefinitely, even though the user is now using a
  // built-in list, not a custom one.
  premSelectSource('app', 'practice');

  if (list === 'oet') {
    if (oetBtn)    oetBtn.classList.add('active');
    if (schoolBtn) schoolBtn.classList.remove('active');
    if (oetPanel)  oetPanel.style.display = '';
    const isTest = document.getElementById('oetModeTest')?.classList.contains('active');
    if (startBtn)  startBtn.innerHTML = isTest
      ? '<i class="fa fa-clock"></i> Start Exam Simulation (24 words)'
      : '<i class="fa fa-play"></i> Start OET Full List Practice';
  } else {
    if (schoolBtn) schoolBtn.classList.add('active');
    if (oetBtn)    oetBtn.classList.remove('active');
    if (oetPanel)  oetPanel.style.display = 'none';
    if (startBtn)  startBtn.innerHTML = '<i class="fa fa-play"></i> Start School Practice';
  }
}

function selectOetMode(mode) {
  var practiceBtn = document.getElementById('oetModePractice');
  var testBtn     = document.getElementById('oetModeTest');
  var startBtn    = document.getElementById('practiceStartBtn');
  var practiceRadio = document.getElementById('examTypePractice');
  var testRadio     = document.getElementById('examTypeTest');

  if (mode === 'test') {
    if (testBtn)     testBtn.classList.add('active');
    if (practiceBtn) practiceBtn.classList.remove('active');
    if (testRadio)   testRadio.checked   = true;
    if (startBtn)    startBtn.innerHTML  = '<i class="fa fa-clock"></i> Start Exam Simulation (24 words)';
  } else {
    if (practiceBtn) practiceBtn.classList.add('active');
    if (testBtn)     testBtn.classList.remove('active');
    if (practiceRadio) practiceRadio.checked = true;
    if (startBtn)    startBtn.innerHTML  = '<i class="fa fa-play"></i> Start Full List Practice';
  }
}

// Mode selection
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentMode = btn.dataset.mode;

    // Update active state on tab buttons
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".trainer-area").forEach(a => {
      a.style.display = "none";
      a.classList.remove("active");
    });
    
    const selectedArea = document.getElementById(`${currentMode}-area`);
    if (selectedArea) {
      selectedArea.style.display = 'block';
      selectedArea.classList.add('active');
      // Always show setup phase when switching modes
      selectedArea.classList.remove('training-active');
    }

    resetTraining();
    // Reset summary on mode switch
    const summary = document.getElementById(currentMode + 'Summary');
    if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }
    if (currentMode === 'practice') selectWordList('oet');
  });
});

// Initialize - hide all trainer areas on load
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll(".trainer-area").forEach(a => {
    a.style.display = "none";
  });
});

function resetTraining() {
  currentIndex = 0;
  score = 0;
  correctWords = [];
  incorrectWords = [];
  flaggedWords = new Set();
  // Reset flag button colour so it doesn't carry over amber from previous session
  ['practiceFlag','beeFlag'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.color = ''; btn.title = 'Flag this word'; }
  });
  // Reset Bee adaptive-difficulty tracking — fresh chance each session
  beeBeginnerEndIndex     = null;
  beeIntermediateEndIndex = null;
  beeCorrectAtBeginnerEnd = 0;
  beeLastBadgeLevel       = null;
  // Hide the badge until next Bee session shows it
  const _bbadge = document.getElementById('beeDifficultyBadge');
  if (_bbadge) _bbadge.classList.remove('visible');
  // Stop any in-progress speech on whichever path is active. Guarded with
  // window.speechSynthesis && — calling .cancel() on undefined is exactly
  // what threw "Cannot read properties of undefined (reading 'cancel')"
  // inside the Android app, where speechSynthesis doesn't exist at all.
  if (window.AndroidTTS && typeof window.AndroidTTS.stop === 'function') {
    window.AndroidTTS.stop();
  } else if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  if (recognition && isListening) {
    recognition.stop();
  }
  
  clearRealTimeFeedback();
}

// Start button handlers
document.querySelectorAll(".start-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    startTraining(mode);
  });
});

function startTraining(mode) {
  // Starting fresh — clear any saved state so the resume prompt doesn't
  // reappear after the user has chosen to begin a new session.
  clearSessionState();
  document.getElementById('srpResumePrompt')?.remove();

  currentMode = mode;
  resetTraining();

  // Clear any lingering summary from a previous session so it doesn't
  // remain visible behind the new training phase.
  const prevSummary = document.getElementById(mode + 'Summary');
  if (prevSummary) { prevSummary.style.display = 'none'; prevSummary.innerHTML = ''; }

  // Activate training phase — hide setup, show training area
  const area = document.getElementById(mode + '-area');
  if (area) area.classList.add('training-active');

  // Init HW canvas now that the training area has real dimensions
  if (mode === 'practice' && window.HW) {
    setTimeout(() => HW.init('practice'), 50);
  }

  if (currentCustomList && customLists[currentCustomList]) {
    currentList = customLists[currentCustomList].words;
    showFeedback(`Using "${currentCustomList}" — ${currentList.length} words`, 'info');
    nextWord();
  } else if (mode === 'practice') {
    var activeList = (typeof selectedWordList !== 'undefined' ? selectedWordList : 'oet');
    console.log('🎯 practice startTraining — activeList:', activeList, '| selectedWordList:', selectedWordList);
    if (activeList === 'school') {
      fetch('/data/school.json')
        .then(r => r.json())
        .then(data => {
          currentList = shuffle(data.words || []);
          showFeedback('School practice — ' + currentList.length + ' words', 'info');
          nextWord();
        })
        .catch(() => {
          console.warn('Could not load school.json — using fallback');
          currentList = shuffle(['apple','banana','school','teacher','student',
            'notebook','homework','classroom','library','pencil',
            'eraser','backpack','chalkboard','science','history']);
          showFeedback('School practice — ' + currentList.length + ' words', 'info');
          nextWord();
        });
      return;
    } else {
      // OET — full list or 24-word test based on examType radio
      loadOETWords();
      return;
    }
  } else if (mode === 'bee') {
    fetch('/data/spelling-bee.json')
      .then(r => r.json())
      .then(data => {
        currentList = shuffle(data.words || []);
        showFeedback('Spelling Bee started — ' + currentList.length + ' words', 'info');
        updateBeeBadge();
        nextWord();
      })
      .catch(() => {
        console.warn('Could not load spelling-bee.json — using fallback');
        currentList = shuffle(['accommodate','bellwether','consensus','diaphragm',
          'embarrass','flabbergasted','gauge','handkerchief','indict','jeopardize',
          'liaison','maneuver','nebulous','occasionally','playwright',
          'questionnaire','rendezvous','silhouette','yacht','knapsack']);
        showFeedback('Spelling Bee started — ' + currentList.length + ' words', 'info');
        updateBeeBadge();
        nextWord();
      });
    return;
  }
  // Note: mode is always 'practice' or 'bee' — no other branches possible
}

// Back to setup — hide training phase, show setup phase
/**
 * navigateWord(mode, direction)
 * Handles the Previous / Next / Jump navigation controls in the training phase.
 *
 * direction = 'prev'  → go back one word (re-hear it, not counted in score)
 * direction = 'next'  → skip forward one word (not counted in score)
 * direction = 'jump'  → jump to the number typed in the jump input
 *
 * Navigation does NOT alter correctWords / incorrectWords — it simply
 * repositions the cursor and re-speaks the target word.  The score only
 * changes when the user actually submits an answer via checkAnswer().
 *
 * The Previous button is disabled at word 1; Next is disabled at the last word.
 */
function navigateWord(mode, direction) {
  if (!currentList || !currentList.length) return;

  // Stop any in-progress speech before moving
  if (window.AndroidTTS && typeof window.AndroidTTS.stop === 'function') {
    window.AndroidTTS.stop();
  } else if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  // Clear stale real-time colour from previous word
  clearRealTimeFeedback();
  const jumpInput = document.getElementById(mode + 'Input');
  if (jumpInput) jumpInput.value = '';

  const total = currentList.length;

  if (direction === 'prev') {
    if (currentIndex <= 0) return;            // already at first word
    currentIndex = Math.max(0, currentIndex - 1);

  } else if (direction === 'next') {
    if (currentIndex >= total - 1) return;   // already at last word
    currentIndex = Math.min(total - 1, currentIndex + 1);

  } else if (direction === 'jump') {
    const input = document.getElementById(mode + 'JumpInput');
    if (!input) return;
    const n = parseInt(input.value, 10);
    if (isNaN(n) || n < 1 || n > total) {
      showFeedback(`Enter a number between 1 and ${total}`, 'warning');
      input.focus();
      return;
    }
    currentIndex = n - 1;          // UI is 1-based, array is 0-based
    input.value = '';              // clear after jump
  }

  // Update nav button disabled states
  updateNavButtons(mode);

  // Re-use nextWord() which updates progress text, clears input,
  // resets canvas, and speaks the word — all the right side-effects.
  nextWord();
}

/** Keep Previous / Next buttons visually disabled at the list boundaries. */
function updateNavButtons(mode) {
  const prevBtn = document.getElementById(mode + 'Prev');
  const nextBtn = document.getElementById(mode + 'Next');
  if (!currentList) return;
  if (prevBtn) prevBtn.disabled = currentIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentIndex >= currentList.length - 1;
}

function backToSetup(mode) {
  // Save progress BEFORE resetting, so the resume prompt can offer to continue.
  // forceIndex0=true ensures we save even if the user is still at word 1
  // (currentIndex===0) — without it, quitting immediately would lose position.
  saveSessionState(true);

  const area = document.getElementById(mode + '-area');
  if (area) area.classList.remove('training-active');
  resetTraining();
  // Reset summary
  const summary = document.getElementById(mode + 'Summary');
  if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }

  // Show resume prompt immediately on the setup panel so the user can pick up
  // where they left off without waiting for a page reload. Only show for the
  // mode they just left — ignore saved state for a different mode.
  setTimeout(() => {
    const saved = loadSessionState();
    if (saved && saved.mode === mode) showResumePrompt(saved);
  }, 300); // brief delay so the UI transition completes first
}

// OET words loading
async function loadOETWords() {
  console.log('📚 loadOETWords called — examType:', document.querySelector('input[name="examType"]:checked')?.value);
  try {
    if (typeof window.OET_WORDS !== 'undefined') {
      const isTest = document.querySelector('input[name="examType"]:checked')?.value === "test";
      currentList = isTest ? shuffle(window.OET_WORDS).slice(0, 24) : window.OET_WORDS;
      showFeedback(`OET ${isTest ? 'Test' : 'Practice'} mode: ${currentList.length} words loaded`, "success");
      nextWord();
      return;
    }
    
    // Load via script tag (no eval — avoids CSP violations)
    await new Promise((resolve, reject) => {
      if (typeof window.OET_WORDS !== 'undefined') return resolve();
      const s = document.createElement('script');
      s.src = '/js/oet_word_list.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load OET words file'));
      document.head.appendChild(s);
    });
    if (typeof window.OET_WORDS !== 'undefined') {
      const isTest = document.querySelector('input[name="examType"]:checked')?.value === 'test';
      currentList = isTest ? shuffle(window.OET_WORDS).slice(0, 24) : [...window.OET_WORDS];
      showFeedback(`OET ${isTest ? 'Test' : 'Practice'} mode: ${currentList.length} words loaded`, 'success');
      nextWord();
    } else {
      throw new Error('OET_WORDS not defined after script load');
    }
  } catch (err) {
    console.error("OET list load error:", err);
    // If OET_WORDS partially loaded, use a real subset rather than a tiny hardcoded list
    if (typeof window.OET_WORDS !== 'undefined' && window.OET_WORDS.length > 0) {
      const isTest = document.querySelector('input[name="examType"]:checked')?.value === 'test';
      currentList = isTest ? shuffle(window.OET_WORDS).slice(0, 24) : [...window.OET_WORDS];
      showFeedback(`OET words loaded (${currentList.length} words)`, 'success');
      nextWord();
    } else {
      // Complete failure — show clear error, don't silently serve 10 words
      showFeedback('⚠️ Could not load OET word list. Please refresh the page and try again.', 'error');
      console.error('OET word list failed to load:', err);
    }
  }
}

// Text-to-speech with proper error handling
// NOTE: Must remain synchronous (no async/await) so Edge keeps the user-gesture
// trust chain intact — async gaps cause synthesis-failed errors.
function speakWord(word) {

  // Native Android TTS bridge — present only inside the SpellRightPro Android
  // app (added via a WebView JavascriptInterface in MainActivity.java).
  // Android's WebView does not implement window.speechSynthesis at all (a
  // long-standing, unresolved Chromium limitation — see
  // https://issues.chromium.org/issues/40339640), confirmed on-device via
  // debug logging showing window.speechSynthesis as undefined inside the
  // installed app while the exact same page works fine in regular mobile
  // Chrome. AndroidTTS routes speech through Android's native TextToSpeech
  // engine instead, restoring real audio inside the app. This path is
  // checked first and, when present, used exclusively — desktop and regular
  // browser tabs never have window.AndroidTTS defined, so they fall through
  // unchanged to the speechSynthesis logic below.
  if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {
    try {
      window.AndroidTTS.speak(word);
      showFeedback("Listen carefully...", "info");

      // The native bridge has no "speech finished" callback, so estimate
      // completion instead: average reading pace plus a small buffer. This
      // only drives the Bee mode's auto-mic-activation convenience feature —
      // worst case the mic starts a little early or late, never breaking
      // anything.
      if (currentMode === 'bee') {
        const estimatedMs = Math.max(900, word.length * 90);
        setTimeout(() => {
          if (typeof startVoiceRecognition === 'function') startVoiceRecognition();
        }, estimatedMs);
      }
    } catch (error) {
      console.error('AndroidTTS error:', error);
      showFeedback("Audio error — tap \"Say Again\" to retry, or continue typing from memory", "warning");
    }
    return;
  }

  if (!window.speechSynthesis) {
    showFeedback("Text-to-speech not supported in this browser", "error");
    return;
  }
  // Retry counter — resets on success
  if (!speakWord._retries) speakWord._retries = 0;

  try {
    const voices = window.speechSynthesis.getVoices();
    const accentSelect = document.getElementById(`${currentMode}Accent`);
    const accent = accentSelect ? accentSelect.value : 'en-GB';

    // Pick best available voice — prefer LOCAL (on-device) voices first.
    // Chrome routes some voices through a remote network call to fetch the
    // audio; if that network call is blocked or slow (ad blockers, private
    // browsing, flaky connections), speech synthesis silently fails with a
    // 'synthesis-failed' error — a known, longstanding Chrome bug
    // (chromium issue #374263394), not something fixable from page code.
    // Preferring localService voices avoids depending on that network call
    // at all, so speech works reliably even when the network is restricted.
    let match = null;
    if (voices.length > 0) {
      const langPrefix = accent.split('-')[0];
      const exactLang   = voices.filter(v => v.lang === accent);
      const prefixLang  = voices.filter(v => v.lang.startsWith(langPrefix));
      const anyEnglish  = voices.filter(v => v.lang.startsWith('en'));

      match = exactLang.find(v => v.localService) ||
              prefixLang.find(v => v.localService) ||
              anyEnglish.find(v => v.localService) ||
              exactLang[0] ||
              prefixLang[0] ||
              anyEnglish[0] ||
              voices[0];
    }

    const utter = new window.SpeechSynthesisUtterance(word);
    utter.lang  = match ? match.lang : accent;
    if (match) utter.voice = match;
    utter.rate  = (currentMode === 'bee') ? getBeeDifficulty().rate : 0.85;
    utter.pitch = 1;

    utter.onstart = () => { speakWord._retries = 0; };

    utter.onend = () => {
      // Auto-activate mic for Bee after word spoken
      if (currentMode === 'bee') {
        setTimeout(() => {
          if (typeof startVoiceRecognition === 'function') startVoiceRecognition();
        }, 500);
      }
    };

    utter.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      if (event.error === 'synthesis-failed') {
        const retries = speakWord._retries || 0;
        if (retries < 3) {
          speakWord._retries = retries + 1;
          console.warn('synthesis-failed — retry', retries + 1, 'in 1s');
          setTimeout(() => speakWord(word), 1000);
        } else {
          speakWord._retries = 0;
          // Audio genuinely failed — tell the user, but NEVER reveal the
          // word itself. Printing the answer on a spelling app defeats the
          // entire exercise. Point them at "Say Again" to retry instead.
          const feedbackElement = document.getElementById(`${currentMode}Feedback`);
          if (feedbackElement) {
            feedbackElement.textContent = `🔇 Audio failed — tap "Say Again" to retry`;
            feedbackElement.style.color = 'var(--warn, #ffb800)';
          }
          showFeedback('Audio playback failed. Tap "Say Again" to retry.', 'warning');
        }
        return;
      }
      console.warn('Speech error:', event.error);
    };

    // Cancel then wait 50ms before speaking — Edge needs this gap
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        window.speechSynthesis.speak(utter);
      }, 50);
    } else {
      window.speechSynthesis.speak(utter);
    }
    showFeedback("Listen carefully...", "info");

  } catch (error) {
    // Previously this only logged to console — on devices where speech APIs
    // throw unexpectedly (see SpeechSynthesisUtterance / speechSynthesis bare
    // global ReferenceError bug), the user saw a button that looked active
    // but nothing happened, with zero on-screen indication anything failed.
    console.error("Speech error:", error);
    showFeedback("Audio error — tap \"Say Again\" to retry, or continue typing from memory", "warning");
  }
}

// ENHANCED NEXTWORD FUNCTION WITH REAL-TIME MARKING
function nextWord() {
    if (currentIndex >= currentList.length) {
        showSummary();
        return;
    }

    // Save position so user can resume if they close the tab
    saveSessionState();

    const word = currentList[currentIndex];   // ← was accidentally removed

    const progressElement = document.getElementById(`${currentMode}Progress`);
    const feedbackElement = document.getElementById(`${currentMode}Feedback`);
    const inputElement    = document.getElementById(`${currentMode}Input`);
    
    if (progressElement) {
        progressElement.textContent = `Word ${currentIndex + 1} of ${currentList.length}`;
    }
    
    if (feedbackElement) {
        feedbackElement.textContent = "Listen carefully...";
        feedbackElement.style.color = '';
        feedbackElement.style.fontWeight = '';
    }
    
    // Reset input for next word — clears real-time colour and value
    if (inputElement) {
        inputElement.value = '';
        clearRealTimeFeedback();
    }
    
    // Reset handwriting canvas between words
    if (currentMode === 'practice' && window.HW) {
        HW.reset('practice');
    }

    // Clear any previous voice recognition UI (only if bee elements exist)
    if (typeof updateBeeVoiceUI === 'function') updateBeeVoiceUI(false);
    const beeRT = document.getElementById('beeRecognizedText');
    if (beeRT) beeRT.style.display = 'none';
    
    // Keep nav buttons (Previous/Next) in sync with current position
    if (typeof updateNavButtons === 'function') updateNavButtons(currentMode);

    // Update flag button to reflect whether the current word is already flagged
    const flagBtn = document.getElementById(currentMode + 'Flag');
    if (flagBtn) {
      const isFlagged = flaggedWords.has(currentList[currentIndex]);
      flagBtn.style.color = isFlagged ? '#f59e0b' : '';
      flagBtn.title = isFlagged ? 'Unflag this word' : 'Flag this word';
    }

    // Speak immediately — delay breaks Edge's user-gesture trust chain
    speakWord(word);
}

// ENHANCED CHECKANSWER FUNCTION WITH REAL-TIME MARKING
function checkAnswer() {
    if (currentIndex >= currentList.length) return;
    
    const word = currentList[currentIndex];
    let userAnswer = '';
    
    if (currentMode === 'bee') {
        startVoiceRecognition();
        return;
    } else if (currentMode === 'practice' && window.HW) {
        const hwAnswer = HW.getAnswer('practice');
        if (hwAnswer !== null) {
            // null means keyboard mode; empty string means HW mode but nothing written
            userAnswer = hwAnswer;
        } else {
            const inputElement = document.getElementById('practiceInput');
            userAnswer = inputElement ? inputElement.value.trim() : '';
        }
    } else {
        const inputElement = document.getElementById(`${currentMode}Input`);
        userAnswer = inputElement ? inputElement.value.trim() : '';
    }
    
    if (!userAnswer) {
        showFeedback("Please provide an answer", "error");
        return;
    }
    
    const normalizedAnswer = userAnswer.toLowerCase().trim();
    const normalizedWord = word.toLowerCase().trim();
    
    // Enhanced real-time visual feedback
    const inputElement = document.getElementById(`${currentMode}Input`);
    const feedbackElement = document.getElementById(`${currentMode}Feedback`);
    
    if (normalizedAnswer === normalizedWord) {
        score++;
        correctWords.push(word);
        showFeedback("✅ Correct! Well done!", "success");
        
        // Visual confirmation
        if (inputElement) {
            inputElement.style.borderColor = '#4CAF50';
            inputElement.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
            inputElement.style.color = '#4CAF50';
            inputElement.style.fontWeight = 'bold';
            inputElement.style.textDecoration = 'none';
        }
        if (feedbackElement) {
            feedbackElement.style.color = '#4CAF50';
            feedbackElement.style.fontWeight = 'bold';
            feedbackElement.textContent = "✅ Correct!";
        }
    } else {
        incorrectWords.push({ word: word, answer: userAnswer });
        showFeedback(`❌ Incorrect. The word was: ${word}`, "error");
        
        // Visual feedback for incorrect
        if (inputElement) {
            inputElement.style.borderColor = '#f44336';
            inputElement.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
            inputElement.style.color = '#f44336';
            inputElement.style.fontWeight = 'bold';
            inputElement.style.textDecoration = 'line-through';
        }
        if (feedbackElement) {
            feedbackElement.style.color = '#f44336';
            feedbackElement.style.fontWeight = 'bold';
            feedbackElement.textContent = `❌ Incorrect. Correct: ${word}`;
        }
    }
    
    currentIndex++;
    
    // Auto-advance with delay
    setTimeout(() => {
        // nextWord() clears the input and resets styling via clearRealTimeFeedback()
        if (inputElement) inputElement.value = '';
        clearRealTimeFeedback();
        
        if (feedbackElement) {
            feedbackElement.style.color = '';
            feedbackElement.style.fontWeight = '';
        }
        
        if (currentIndex < currentList.length) {
            nextWord();
        } else {
            showSummary();
        }
    }, 2000);
}

// Summary function
function showSummary(earlyExit = false) {
  if (earlyExit) {
    // User ended manually mid-session — save progress so the resume prompt
    // can offer to continue when they return to this mode.
    // forceIndex0=true ensures we save even if they quit at the very first word.
    saveSessionState(true);
  } else {
    // Session completed naturally (all words done) — clear saved state so
    // the resume prompt doesn't appear for a finished session.
    clearSessionState();
  }

  // Hide the training UI (Submit, Say Again, Flag, End buttons) so they don't
  // sit above the summary panel. training-active is what makes .training-phase
  // visible — removing it collapses it, leaving only the summary below.
  const area = document.getElementById(currentMode + '-area');
  if (area) area.classList.remove('training-active');

  const summaryElement = document.getElementById(`${currentMode}Summary`);
  if (!summaryElement) return;
  
  const total     = currentList.length;
  const pct       = total > 0 ? Math.round((score / total) * 100) : 0;
  const barColour = pct >= 80 ? '#00c57a' : pct >= 50 ? '#ffb800' : '#ff4560';

  let summaryHTML = `
    <div class="summary-header">
      <h3>Session Complete</h3>
      <div class="score">Score: ${score}/${total}</div>
    </div>

    <!-- Progress chart: horizontal bar showing accuracy -->
    <div style="margin:16px 0 20px;">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;
                  color:var(--muted);margin-bottom:6px;">
        <span>Accuracy</span><span style="font-weight:700;color:${barColour};">${pct}%</span>
      </div>
      <div style="background:var(--border);border-radius:99px;height:12px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${barColour};
                    border-radius:99px;transition:width .8s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;
                  color:var(--muted);margin-top:5px;">
        <span>✅ ${score} correct</span>
        <span>❌ ${incorrectWords.length} incorrect</span>
        ${flaggedWords.size > 0 ? `<span>🚩 ${flaggedWords.size} flagged</span>` : ''}
      </div>
    </div>
  `;

  // Incorrect words with corrections
  if (incorrectWords.length > 0) {
    summaryHTML += `
      <div class="incorrect-words" style="margin-bottom:14px;">
        <h4 style="margin:0 0 8px;font-size:0.9rem;color:var(--fail);">
          ❌ Incorrect Words (${incorrectWords.length})
        </h4>
        <div class="word-list">
    `;
    incorrectWords.forEach(item => {
      summaryHTML += `
        <div class="word-item" style="display:flex;justify-content:space-between;
             align-items:center;padding:5px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--fail);text-decoration:line-through;font-size:0.88rem;">
            ${item.answer || '—'}
          </span>
          <span style="font-size:0.75rem;color:var(--muted);">→</span>
          <span style="color:var(--ok);font-weight:700;font-size:0.92rem;">${item.word}</span>
        </div>
      `;
    });
    summaryHTML += `</div>`;

    // Retry incorrect words button
    summaryHTML += `
      <button onclick="retryIncorrectWords()" style="
        margin-top:12px;width:100%;padding:10px;border-radius:10px;
        background:rgba(255,69,96,0.08);color:var(--fail);
        border:1.5px solid rgba(255,69,96,0.3);font-size:0.88rem;
        font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;">
        🔁 Practice Incorrect Words (${incorrectWords.length})
      </button>
    </div>`;
  }

  // Flagged words section
  if (flaggedWords.size > 0) {
    summaryHTML += `
      <div class="flagged-words" style="margin-bottom:14px;">
        <h4 style="margin:0 0 8px;font-size:0.9rem;color:#f59e0b;">
          🚩 Flagged Words (${flaggedWords.size})
        </h4>
        <div class="word-list" style="display:flex;flex-wrap:wrap;gap:6px;">
    `;
    const dark = document.body.classList.contains('dark-mode');
    const flagTextColour = dark ? '#f59e0b' : '#7a5200';
    flaggedWords.forEach(word => {
      summaryHTML += `
        <span style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);
              border-radius:6px;padding:3px 10px;font-size:0.85rem;font-weight:600;
              color:${flagTextColour};">${word}</span>
      `;
    });
    summaryHTML += `</div></div>`;
  }

  // Perfect score — only show if at least one word was actually answered
  if (incorrectWords.length === 0 && flaggedWords.size === 0 && score > 0) {
    summaryHTML += `
      <div style="text-align:center;padding:12px;background:rgba(0,197,122,0.08);
           border-radius:10px;border:1.5px solid rgba(0,197,122,0.25);margin-top:4px;">
        <div style="font-size:1.5rem;margin-bottom:4px;">🎉</div>
        <div style="font-weight:700;color:#007048;font-size:0.95rem;">
          Perfect score! Every word correct.
        </div>
      </div>
    `;
  }

  summaryElement.innerHTML = summaryHTML;
  summaryElement.style.display = "block";

  // Record session in progress dashboard (premium feature)
  if (window.progressDashboard && typeof window.progressDashboard.recordSession === 'function') {
    window.progressDashboard.recordSession(currentMode, correctWords, incorrectWords);
  }

  // ── Cross-device sync — fire-and-forget ───────────────────────────────────
  if (currentUser && window.firebaseUtils && window.firebaseUtils.initialized) {
    const uid = currentUser.uid;

    // 1. Save session progress
    window.firebaseUtils.saveUserProgress(uid, {
      mode:           currentMode,
      score:          score,
      totalWords:     currentList.length,
      correctWords:   correctWords,
      incorrectWords: incorrectWords.map(i => i.word || i),
      wordsLearned:   correctWords.length,
      sessionDate:    new Date().toISOString(),
      sessionHistory: JSON.parse(localStorage.getItem('premiumSessionHistory') || '[]').slice(0, 100)
    });

    // 2. Sync custom lists
    const lists = JSON.parse(localStorage.getItem('premiumCustomLists') || '{}');
    if (Object.keys(lists).length) {
      window.firebaseUtils.saveCustomLists(uid, lists);
    }

    // 3. Sync mistake bank
    const mistakes  = JSON.parse(localStorage.getItem('mistakeBank')     || '[]');
    const schedule  = JSON.parse(localStorage.getItem('mistakeSchedule') || '{}');
    if (mistakes.length) {
      window.firebaseUtils.saveMistakeBank(uid, mistakes, schedule);
    }
  }

  // Rating prompt
  if (window.srpRating) {
    srpRating.recordSession();
    var ratingHTML = srpRating.getPromptHTML();
    if (ratingHTML) summaryElement.insertAdjacentHTML("beforeend", ratingHTML);
  }
}

function retryIncorrectWords() {
  if (!incorrectWords.length) return;

  // Build a word list from just the incorrect words, then start a fresh session
  const wordsToRetry = incorrectWords.map(item => item.word);
  const summaryElement = document.getElementById(currentMode + 'Summary');
  if (summaryElement) { summaryElement.style.display = 'none'; summaryElement.innerHTML = ''; }

  // Reset state with the subset list
  currentIndex   = 0;
  score          = 0;
  correctWords   = [];
  incorrectWords = [];
  flaggedWords   = new Set();
  currentList    = wordsToRetry;
  clearSessionState();

  // Reactivate the training phase
  const area = document.getElementById(currentMode + '-area');
  if (area) area.classList.add('training-active');

  showFeedback(`Retrying ${wordsToRetry.length} incorrect word${wordsToRetry.length > 1 ? 's' : ''}`, 'info');
  updateNavButtons(currentMode);
  nextWord();
}

function flagCurrentWord() {
  if (!currentList || currentIndex >= currentList.length) return;
  
  const word = currentList[currentIndex];
  const btn  = document.getElementById(currentMode + 'Flag');

  // Use the inline feedback pill (visible in the training area) rather than
  // the toast (which appends below the fold on the glass-card).
  const pill = document.getElementById(currentMode + 'Feedback');
  const showInlineFeedback = (msg, isError) => {
    if (pill) {
      const originalText = pill.textContent;
      pill.textContent = msg;
      pill.style.color = isError ? 'var(--fail)' : 'var(--ok)';
      pill.style.fontWeight = '600';
      setTimeout(() => {
        pill.textContent = originalText;
        pill.style.color = '';
        pill.style.fontWeight = '';
      }, 2500);
    } else {
      showFeedback(msg, isError ? 'warning' : 'success');
    }
  };

  if (flaggedWords.has(word)) {
    flaggedWords.delete(word);
    if (btn) { btn.style.color = ''; btn.title = 'Flag this word'; }
    showInlineFeedback(`🚩 Removed flag from "${word}"`, false);
  } else {
    flaggedWords.add(word);
    if (btn) { btn.style.color = '#f59e0b'; btn.title = 'Unflag this word'; }
    showInlineFeedback(`🚩 "${word}" flagged for review`, false);
  }
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// =======================================================
// EVENT LISTENERS
// =======================================================

document.addEventListener('DOMContentLoaded', function() {
  // Say Again buttons
  document.querySelectorAll('[id$="SayAgain"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentIndex < currentList.length) {
        const word = currentList[currentIndex];
        speakWord(word);
      }
    });
  });
  
  // Bee Listen button
  document.getElementById('beeListen')?.addEventListener('click', startVoiceRecognition);
  
  // Flag buttons
  document.querySelectorAll('[id$="Flag"]').forEach(btn => {
    btn.addEventListener('click', flagCurrentWord);
  });
  
  // Submit buttons
  document.querySelectorAll('[id$="Submit"]').forEach(btn => {
    btn.addEventListener('click', checkAnswer);
  });
  
  // End buttons
  document.querySelectorAll('[id$="End"]').forEach(btn => {
    btn.addEventListener('click', () => {
      // earlyExit=true → showSummary saves state instead of clearing it,
      // so the resume prompt appears when user returns to the same mode.
      showSummary(true);
    });
  });
  
  // Input field enter key support
  document.querySelectorAll('.answer-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        checkAnswer();
      }
    });
  });
});

// Initialize speech synthesis and recognition
function initializeSpeechSynthesis() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function() {
      console.log("Voices loaded:", window.speechSynthesis.getVoices().length);
    };
  }
  
  initializeSpeechRecognition();
}

// =======================================================
// FINAL INITIALIZATION
// =======================================================

// Start Firebase initialization when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Starting Firebase initialization...');
    initializeFirebase();
    initializeSpeechSynthesis(); // pre-load voices before first speakWord() call
    // NOTE: createCustomWordsUI, initializeCustomWords, initializeRealTimeValidation
    // are called from initializePremiumFeatures() only — NOT here — to avoid duplicates.
    console.log('SpellRightPro Premium initialized');

    // Fallback resume prompt — fires only if hideOverlay() hasn't already shown it
    // (e.g. when auth resolves very fast, before this timer). showResumePrompt()
    // removes any existing prompt before creating a new one, so it's safe to call
    // twice — but we skip if the prompt is already visible to avoid a flicker.
    setTimeout(() => {
      if (document.getElementById('srpResumePrompt')) return; // already shown by hideOverlay
      const saved = loadSessionState();
      if (saved) showResumePrompt(saved);
    }, 1500);
});

// Enhanced function to handle premium access simulation for testing
function simulatePremiumAccess() {
  // This function can be called from browser console for testing
  if (auth && auth.currentUser) {
    const userId = auth.currentUser.uid;
    localStorage.setItem(`premium_${userId}`, 'true');
    console.log('✅ Premium access simulated for user:', userId);
    location.reload();
  } else {
    console.log('❌ No user logged in');
  }
}

// Make simulatePremiumAccess available globally for testing
// simulatePremiumAccess kept for internal testing only (not exported publicly)

// ── Rating prompt (premium trainer) ─────────────────────────────────────────
(function() {
  var SESSIONS_KEY = 'srp_sessions_count';
  var DONE_KEY     = 'srp_rating_done';
  var GOOGLE_URL   = 'https://g.page/r/CcXpShfGcR9GEAE/review';
  var PLAY_URL     = 'https://play.google.com/store/apps/details?id=org.spellrightpro.www.twa&reviewId=0';
  // Detect whether we're running inside the installed Android app.
  // window.AndroidTTS is only defined when the native TTS JavascriptInterface
  // bridge is present — i.e. exclusively inside MainActivity's WebView.
  // Web users (desktop, mobile browser) never have this defined.
  var IS_ANDROID_APP = !!(window.AndroidTTS && typeof window.AndroidTTS.speak === 'function');
  var REVIEW_URL = IS_ANDROID_APP ? PLAY_URL : GOOGLE_URL;
  var REVIEW_LABEL = IS_ANDROID_APP ? '⭐ Rate on Google Play' : '⭐ Leave a Google review';

  if (!window.srpRating || !window.srpRating.selectStar) {
    window.srpRating = {
      _selected: 0,

      recordSession: function() {
        if (localStorage.getItem(DONE_KEY)) return;
        localStorage.setItem(SESSIONS_KEY,
          parseInt(localStorage.getItem(SESSIONS_KEY) || '0') + 1);
      },

      getPromptHTML: function() {
        if (localStorage.getItem(DONE_KEY)) return '';
        if (parseInt(localStorage.getItem(SESSIONS_KEY) || '0') < 2) return '';
        var stars = [1,2,3,4,5].map(function(v){
          return '<button class="star-btn" data-val="'+v+'" onclick="srpRating.selectStar('+v+')">&#9733;</button>';
        }).join('');
        return '<div class="rating-prompt" id="srpRatingPrompt">' +
          '<h4>Enjoying SpellRightPro? &#11088;</h4>' +
          '<p>Tap a star to rate &#8212; it helps other learners find us.</p>' +
          '<div class="star-row">' + stars + '</div>' +
          '<div class="rating-actions" id="srpRatingActions" style="display:none;">' +
          '<button class="rating-action-btn primary" id="srpRatingSubmit" onclick="srpRating.submit()">Submit rating</button>' +
          '<button class="rating-action-btn secondary" onclick="srpRating.dismiss()">Maybe later</button>' +
          '</div></div>';
      },

      selectStar: function(val) {
        this._selected = val;
        document.querySelectorAll('.star-btn').forEach(function(s) {
          s.classList.toggle('selected', parseInt(s.getAttribute('data-val')) <= val);
        });
        var a = document.getElementById('srpRatingActions');
        if (a) a.style.display = 'flex';
        var b = document.getElementById('srpRatingSubmit');
        if (b) b.textContent = val >= 4 ? 'Submit & leave a Google review' : 'Submit feedback';
      },

      submit: function() {
        var val = this._selected;
        if (!val) return;
        localStorage.setItem(DONE_KEY, '1');
        try {
          if (typeof firebase !== 'undefined' && typeof firebase.firestore === 'function') {
            var user = firebase.auth ? firebase.auth().currentUser : null;
            firebase.firestore().collection('ratings').add({
              uid: user ? user.uid : 'anon', rating: val,
              page: window.location.pathname,
              timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function(){});
          }
        } catch(e) {}
        var prompt = document.getElementById('srpRatingPrompt');
        if (!prompt) return;
        if (val >= 4) {
          prompt.innerHTML =
            '<div class="rating-thanks">Thank you! &#127881;</div>' +
            '<p style="font-size:0.82rem;color:var(--muted);margin:8px 0 12px;">Would you take 30 seconds to leave a review?</p>' +
            '<div class="rating-actions">' +
            '<a href="' + REVIEW_URL + '" target="_blank" rel="noopener" class="rating-action-btn primary" style="text-decoration:none;">' + REVIEW_LABEL + '</a>' +
            '<button class="rating-action-btn secondary" onclick="document.getElementById(\'srpRatingPrompt\').style.display=\'none\'">No thanks</button>' +
            '</div>';
        } else {
          prompt.innerHTML =
            '<div class="rating-thanks" style="color:#7b2ff7;">Thank you &#128591;</div>' +
            '<p style="font-size:0.82rem;color:var(--muted);margin:8px 0 12px;">We\'d love to hear what we can improve.</p>' +
            '<a href="/contact" class="rating-action-btn primary" style="display:inline-block;text-decoration:none;">Send us feedback</a>';
        }
      },

      dismiss: function() {
        var n = parseInt(localStorage.getItem(SESSIONS_KEY) || '0');
        localStorage.setItem(SESSIONS_KEY, Math.max(0, n - 1));
        var p = document.getElementById('srpRatingPrompt');
        if (p) p.style.display = 'none';
      }
    };
  }
})();


// =======================================================
// HANDWRITING INPUT ENGINE
// Moved to /js/hw-canvas.js — shared module used by
// freemium-school, freemium-oet, and premium trainer.
// Access via: window.HW.setMode(), HW.getAnswer(), HW.reset()
// The old inline hwState/hwInitCanvas/hwRecognize etc. are
// superseded by hw-canvas.js which is loaded in trainer.html.
// =======================================================

// setInputMode() kept as alias for any legacy onclick handlers
function setInputMode(moduleMode, inputMode) {
  if (window.HW) HW.setMode(moduleMode, inputMode);
}
