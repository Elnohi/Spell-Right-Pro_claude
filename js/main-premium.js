// Wait until Firestore is confirmed working (firebase-utils.js sets
// window.firebaseUtils.firestoreReady = true after persistence + test pass),
// then load lists. Falls back to polling if that flag isn't set.
function waitForFirestoreAndLoadLists() {
  // Use the firebaseUtils ready flag if available
  const utils = window.firebaseUtils;
  const fsDb  = (utils && utils.db) || db;

  if (!fsDb || !currentUser) {
    setTimeout(waitForFirestoreAndLoadLists, 400);
    return;
  }

  // Try a real Firestore call — if it throws no-app, Firestore isn't ready yet
  try {
    const promise = fsDb.collection('userLists').doc(currentUser.uid).get();
    // If we get here without throwing, Firestore accepted the call
    promise
      .then(snap => {
        if (!snap.exists) return;
        const remote = snap.data().lists || {};
        let changed = false;
        for (const [name, data] of Object.entries(remote)) {
          if (!customLists[name]) { customLists[name] = data; changed = true; }
        }
        if (changed) {
          try { localStorage.setItem('premiumCustomLists', JSON.stringify(customLists)); } catch(e) {}
          updateCustomListsDisplay();
          console.log('✅ Lists loaded from Firestore');
        }
      })
      .catch(e => {
        if (e.code === 'unavailable' || (e.message && e.message.includes('no-app'))) {
          // Expected during startup — retry silently
          setTimeout(waitForFirestoreAndLoadLists, 600);
        } else {
          console.warn('Firestore list load failed:', e.message);
        }
      });
  } catch(e) {
    // Synchronous no-app error — Firestore not initialised yet, retry silently
    setTimeout(waitForFirestoreAndLoadLists, 600);
  }
}

async function syncListsToFirestore() {
  try {
    const fsDb = (window.firebaseUtils && window.firebaseUtils.db) || db;
    if (!fsDb || !currentUser) return;
    // Quick readiness check before writing
    await fsDb.collection('_ping').doc('ping').get().catch(() => {});
    await fsDb.collection('userLists').doc(currentUser.uid).set({
      lists: customLists,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log('✅ Lists synced to Firestore');
  } catch (e) {
    console.warn('Firestore list sync failed:', e.message);
  }
}

function loadListsFromFirestore() {
  waitForFirestoreAndLoadLists();
}
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

// ── Premium Bee adaptive difficulty (Bee mode only) ────────────────────────
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
                // Load lists after Firestore is confirmed ready (3s delay)
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
    if (overlay) overlay.style.display = "flex";
    if (mainContent) mainContent.style.display = "none";
}

function hideOverlay() {
    const overlay = document.getElementById("loginOverlay");
    const mainContent = document.querySelector("main");
    if (overlay) overlay.style.display = "none";
    if (mainContent) mainContent.style.display = "block";
}

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
  var defaultArea = document.getElementById('school-area');
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
  var defaultBtn = document.querySelector('.mode-btn[data-mode="school"]') ||
                   document.querySelector('.mode-btn');
  if (defaultBtn) {
    document.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.remove('active'); });
    defaultBtn.classList.add('active');
    window.currentMode = defaultBtn.dataset.mode || 'school';
  }

  // Sync bottom tab bar (mobile)
  var defaultTabLink = document.querySelector('.trainer-tab-bar a[data-mode="school"]');
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
    showFeedback('Listening... Please spell the word', 'info');
  } catch (error) {
    console.error('Error starting recognition:', error);
    showFeedback('Error starting voice recognition', 'error');
  }
}

function checkBeeAnswer(spokenText) {
  if (currentIndex >= currentList.length) return;
  
  const word = currentList[currentIndex];
  const normalizedSpoken = spokenText.toLowerCase().replace(/[^a-z]/g, '');
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
    setTimeout(nextWord, 1200);
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
        <div class="real-time-marking-toggle" style="margin: 15px 0; display: flex; align-items: center; justify-content: center; gap: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="realTimeMarkingToggle" checked>
                <span>Real-time Spelling Check</span>
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
            
            // Real-time visual feedback
            if (userInput === correctWord) {
                this.style.borderColor = '#4CAF50';
                this.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                this.style.color = '#4CAF50';
                this.style.fontWeight = 'bold';
                this.style.textDecoration = 'none';
            } else if (userInput && correctWord.startsWith(userInput)) {
                this.style.borderColor = '#FFC107';
                this.style.backgroundColor = 'rgba(255, 193, 7, 0.1)';
                this.style.color = '#FFC107';
                this.style.fontWeight = 'normal';
                this.style.textDecoration = 'none';
            } else if (userInput) {
                this.style.borderColor = '#f44336';
                this.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
                this.style.color = '#f44336';
                this.style.fontWeight = 'normal';
                this.style.textDecoration = 'line-through';
            } else {
                this.style.borderColor = '';
                this.style.backgroundColor = '';
                this.style.color = '';
                this.style.fontWeight = 'normal';
                this.style.textDecoration = 'none';
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
        inputElement.style.borderColor = '';
        inputElement.style.backgroundColor = '';
        inputElement.style.color = '';
        inputElement.style.fontWeight = 'normal';
        inputElement.style.textDecoration = 'none';
        inputElement.style.boxShadow = 'none';
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
      // Silently submit words for OET enrichment review
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
  // Silently submit words for OET enrichment review
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

function saveCustomLists() {
  try { localStorage.setItem('premiumCustomLists', JSON.stringify(customLists)); }
  catch(e) { console.warn('localStorage blocked — custom list saved in memory only'); }
}

// Silently submit words for OET list enrichment — runs in background, user sees nothing
async function submitWordsForReview(words, listName) {
  if (!currentUser || !words || words.length === 0) return;
  try {
    await fetch('/.netlify/functions/word-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: words,
        userId: currentUser.uid,
        listName: listName || 'unnamed'
      })
    });
    // Silent — no feedback to user regardless of result
  } catch (e) {
    // Silent failure — this is a background enrichment, not critical
  }
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
function selectOetMode(mode) {
  var practiceBtn = document.getElementById('oetModePractice');
  var testBtn     = document.getElementById('oetModeTest');
  var startBtn    = document.getElementById('oetStartBtn');
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
  // Reset Bee adaptive-difficulty tracking — fresh chance each session
  beeBeginnerEndIndex     = null;
  beeIntermediateEndIndex = null;
  beeCorrectAtBeginnerEnd = 0;
  beeLastBadgeLevel       = null;
  // Hide the badge until next Bee session shows it
  const _bbadge = document.getElementById('beeDifficultyBadge');
  if (_bbadge) _bbadge.classList.remove('visible');
  speechSynthesis.cancel();
  
  if (recognition && isListening) {
    recognition.stop();
  }
  
  clearRealTimeFeedback();
}

// Start button handlers
document.querySelectorAll(".start-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    speechSynthesis.cancel();
    startTraining(mode);
  });
});

function startTraining(mode) {
  currentMode = mode; // ensure currentMode is always set when training starts
  resetTraining();

  // Activate training phase — hide setup, show training
  const area = document.getElementById(mode + '-area');
  if (area) area.classList.add('training-active');

  if (currentCustomList && customLists[currentCustomList]) {
    currentList = customLists[currentCustomList].words;
    showFeedback(`Using "${currentCustomList}" — ${currentList.length} words`, 'info');
    nextWord();
  } else if (mode === 'oet') {
    loadOETWords(); // handles nextWord() internally
    return;
  } else if (mode === 'bee') {
    // Use full OET_WORDS if available, otherwise built-in bee list
    if (typeof window.OET_WORDS !== 'undefined') {
      currentList = [...window.OET_WORDS];
    } else {
      currentList = ['accommodate','rhythm','occurrence','necessary','embarrass',
                     'guarantee','privilege','immediately','separate','conscience',
                     'manoeuvre','bureaucracy','liaison','supersede','threshold',
                     'committee','conscientious','millennium','perseverance','questionnaire'];
    }
    showFeedback('Spelling Bee started — ' + currentList.length + ' words', 'info');
    // Initialize the adaptive-difficulty badge — starts at Beginner pace
    updateBeeBadge();
    nextWord();
  } else {
    // school — use built-in school word list
    const SCHOOL_WORDS = [
      'about', 'above', 'across', 'after', 'again', 'against', 'almost', 'alone',
      'along', 'already', 'also', 'although', 'always', 'among', 'another', 'answer',
      'appear', 'around', 'arrive', 'article', 'because', 'become', 'before', 'begin',
      'behind', 'believe', 'below', 'between', 'beyond', 'brother', 'building', 'business',
      'capital', 'century', 'certain', 'children', 'circle', 'city', 'class', 'clear',
      'color', 'common', 'complete', 'consider', 'contain', 'country', 'course', 'cover',
      'create', 'current', 'decide', 'describe', 'develop', 'different', 'difficult',
      'direct', 'discover', 'distance', 'divide', 'during', 'early', 'earth', 'east',
      'effect', 'eight', 'either', 'element', 'energy', 'enough', 'enter', 'entire',
      'equal', 'especially', 'evening', 'event', 'every', 'example', 'except', 'exercise',
      'expect', 'experience', 'experiment', 'explain', 'express', 'family', 'father',
      'figure', 'final', 'follow', 'forest', 'forget', 'form', 'forward', 'friend',
      'garden', 'general', 'government', 'great', 'ground', 'group', 'grow', 'happen',
      'heavy', 'height', 'history', 'however', 'hundred', 'idea', 'important', 'improve',
      'include', 'increase', 'inside', 'instead', 'interest', 'invent', 'island', 'just',
      'knowledge', 'language', 'large', 'later', 'learn', 'length', 'letter', 'level',
      'light', 'listen', 'little', 'machine', 'material', 'matter', 'maybe', 'measure',
      'member', 'method', 'middle', 'minute', 'moment', 'mother', 'mountain', 'music',
      'nation', 'natural', 'necessary', 'never', 'notice', 'number', 'object', 'observe',
      'ocean', 'often', 'order', 'original', 'other', 'outside', 'paper', 'paragraph',
      'parent', 'particular', 'pattern', 'people', 'perhaps', 'period', 'person',
      'picture', 'piece', 'place', 'planet', 'plant', 'point', 'possible', 'pound',
      'power', 'practice', 'prepare', 'present', 'president', 'problem', 'process',
      'produce', 'product', 'program', 'project', 'property', 'protect', 'prove',
      'provide', 'question', 'quick', 'quiet', 'quite', 'radio', 'raise', 'reach',
      'ready', 'reason', 'receive', 'record', 'region', 'remember', 'repeat', 'report',
      'represent', 'require', 'result', 'return', 'right', 'river', 'round', 'science',
      'second', 'section', 'segment', 'separate', 'serve', 'several', 'shape', 'should',
      'similar', 'simple', 'since', 'single', 'sister', 'situation', 'social', 'society',
      'solve', 'sound', 'source', 'south', 'space', 'special', 'specific', 'speech',
      'spell', 'spring', 'square', 'standard', 'station', 'still', 'stone', 'story',
      'straight', 'strange', 'street', 'strong', 'structure', 'student', 'study',
      'subject', 'success', 'sudden', 'suggest', 'summer', 'supply', 'support', 'sure',
      'surface', 'surprise', 'system', 'table', 'teacher', 'technology', 'television',
      'temperature', 'therefore', 'thing', 'thought', 'through', 'together', 'tonight',
      'total', 'toward', 'travel', 'trouble', 'true', 'under', 'understand', 'unit',
      'until', 'usually', 'value', 'various', 'village', 'visit', 'voice', 'wait',
      'watch', 'water', 'weather', 'weight', 'welcome', 'west', 'whether', 'while',
      'whole', 'window', 'winter', 'within', 'without', 'woman', 'wonder', 'world',
      'write', 'wrong', 'young'
    ];
    currentList = [...SCHOOL_WORDS].sort(() => Math.random() - 0.5);
    showFeedback('School practice started — ' + currentList.length + ' words', 'info');
    nextWord();
  }
}

// Back to setup — hide training phase, show setup phase
function backToSetup(mode) {
  const area = document.getElementById(mode + '-area');
  if (area) area.classList.remove('training-active');
  resetTraining();
  // Reset summary
  const summary = document.getElementById(mode + 'Summary');
  if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }
}

// OET words loading
async function loadOETWords() {
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
    currentList = ["abdomen", "anemia", "antibiotic", "artery", "asthma", "biopsy", "catheter", "diagnosis", "embolism", "fracture"];
    showFeedback("Using fallback OET words", "info");
    nextWord();
  }
}

// Text-to-speech with proper error handling
// NOTE: Must remain synchronous (no async/await) so Edge keeps the user-gesture
// trust chain intact — async gaps cause synthesis-failed errors.
function speakWord(word) {
  if (!window.speechSynthesis) {
    showFeedback("Text-to-speech not supported in this browser", "error");
    return;
  }

  try {
    const voices = speechSynthesis.getVoices();
    const accentSelect = document.getElementById(`${currentMode}Accent`);
    const accent = accentSelect?.value || 'en-GB';

    // Pick best available voice
    const langPrefix = accent.split('-')[0];
    const match = voices.length > 0 ? (
      voices.find(v => v.lang === accent) ||
      voices.find(v => v.lang.startsWith(langPrefix)) ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0]
    ) : null;

    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = match ? match.lang : accent;
    if (match) utter.voice = match;
    utter.rate = (currentMode === 'bee') ? getBeeDifficulty().rate : 0.85;
    utter.pitch = 1;

    utter.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      if (event.error === 'synthesis-failed') {
        // Voices reloaded mid-speak — wait for stable then retry once
        const retries = (speakWord._retries || 0);
        if (retries < 3) {
          speakWord._retries = retries + 1;
          console.warn(`synthesis-failed (attempt ${retries+1}) — retrying in 2s`);
          setTimeout(() => speakWord(word), 2000);
        } else {
          speakWord._retries = 0;
          console.warn('synthesis-failed after 3 retries — giving up');
        }
        return;
      }
      console.error('Speech synthesis error:', event);
    };

    utter.onstart = () => { speakWord._retries = 0; };
    utter.onend = () => {
      // Auto-activate mic for Bee mode after word is spoken
      if (currentMode === 'bee') {
        setTimeout(() => {
          if (typeof startVoiceRecognition === 'function') {
            startVoiceRecognition();
          }
        }, 500);
      }
    };

    speechSynthesis.speak(utter);
    showFeedback("Listen carefully...", "info");
  } catch (error) {
    console.error("Speech error:", error);
  }
}

// ENHANCED NEXTWORD FUNCTION WITH REAL-TIME MARKING
function nextWord() {
    // Sync currentMode from window.currentMode if local is null
    if (!currentMode && window.currentMode) currentMode = window.currentMode;
    if (currentIndex >= currentList.length) {
        showSummary();
        return;
    }
    
    const word = currentList[currentIndex];
    const progressElement = document.getElementById(`${currentMode}Progress`);
    const feedbackElement = document.getElementById(`${currentMode}Feedback`);
    const inputElement = document.getElementById(`${currentMode}Input`);
    
    if (progressElement) {
        progressElement.textContent = `Word ${currentIndex + 1} of ${currentList.length}`;
    }
    
    if (feedbackElement) {
        feedbackElement.textContent = "Listen carefully...";
        feedbackElement.style.color = '';
        feedbackElement.style.fontWeight = '';
    }
    
    // Reset input styling
    if (inputElement) {
        inputElement.value = "";
        inputElement.style.borderColor = '';
        inputElement.style.backgroundColor = '';
        inputElement.style.color = '';
        inputElement.style.fontWeight = 'normal';
        inputElement.style.textDecoration = 'none';
        inputElement.style.boxShadow = 'none';
    }
    
    // Reset handwriting canvas between words
    if ((currentMode === "school" || currentMode === "oet") && typeof hwReset === "function") {
        hwReset(currentMode);
    }

    // Clear any previous voice recognition UI (only if bee elements exist)
    if (typeof updateBeeVoiceUI === 'function') updateBeeVoiceUI(false);
    const beeRT = document.getElementById('beeRecognizedText');
    if (beeRT) beeRT.style.display = 'none';
    
    // Speak immediately — delay breaks Edge's user-gesture trust chain
    speakWord(word);
}

// ENHANCED CHECKANSWER FUNCTION WITH REAL-TIME MARKING
function checkAnswer() {
    // Sync currentMode from window.currentMode if local is null
    if (!currentMode && window.currentMode) currentMode = window.currentMode;

    if (currentIndex >= currentList.length) return;
    
    const word = currentList[currentIndex];
    let userAnswer = "";
    
    if (currentMode === "bee") {
        startVoiceRecognition();
        return;
    } else if ((currentMode === "school" || currentMode === "oet") &&
               hwState[currentMode] && hwState[currentMode].mode === "handwriting") {
        userAnswer = hwGetAnswer(currentMode);
    } else {
        const inputElement = document.getElementById(`${currentMode}Input`);
        userAnswer = inputElement ? inputElement.value.trim() : "";
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
    
    // Auto-advance with delay (1.2s)
    setTimeout(() => {
        // Reset input styling for next word
        if (inputElement) {
            inputElement.style.borderColor = '';
            inputElement.style.backgroundColor = '';
            inputElement.style.color = '';
            inputElement.style.fontWeight = 'normal';
            inputElement.style.textDecoration = 'none';
            inputElement.value = "";
        }
        
        if (feedbackElement) {
            feedbackElement.style.color = '';
            feedbackElement.style.fontWeight = '';
        }
        
        if (currentIndex < currentList.length) {
            nextWord();
        } else {
            showSummary();
        }
    }, 1200);
}

// Summary function
function showSummary() {
  const summaryElement = document.getElementById(`${currentMode}Summary`);
  if (!summaryElement) return;
  
  let summaryHTML = `
    <div class="summary-header">
      <h3>Session Complete</h3>
      <div class="score">Score: ${score}/${currentList.length}</div>
    </div>
  `;
  
  if (incorrectWords.length > 0) {
    summaryHTML += `
      <div class="incorrect-words">
        <h4>❌ Incorrect Words (${incorrectWords.length})</h4>
        <div class="word-list">
    `;
    
    incorrectWords.forEach(item => {
      summaryHTML += `
        <div class="word-item">
          <strong>${item.word}</strong> - You said: "${item.answer}"
        </div>
      `;
    });
    
    summaryHTML += `</div></div>`;
  }
  
  if (flaggedWords.size > 0) {
    summaryHTML += `
      <div class="flagged-words">
        <h4>🚩 Flagged Words (${flaggedWords.size})</h4>
        <div class="word-list">
    `;
    
    flaggedWords.forEach(word => {
      summaryHTML += `<div class="word-item">${word}</div>`;
    });
    
    summaryHTML += `</div></div>`;
  }
  
  if (correctWords.length > 0 && incorrectWords.length === 0) {
    summaryHTML += `
      <div class="correct-words">
        <h4>✅ Correct Words (${correctWords.length})</h4>
        <div class="word-list">
    `;
    
    correctWords.forEach(word => {
      summaryHTML += `<div class="word-item">${word}</div>`;
    });
    
    summaryHTML += `</div></div>`;
  }
  
  summaryElement.innerHTML = summaryHTML;
  summaryElement.style.display = "block";
  // Rating prompt
  if (window.srpRating) {
    srpRating.recordSession();
    var ratingHTML = srpRating.getPromptHTML();
    if (ratingHTML) summaryElement.insertAdjacentHTML("beforeend", ratingHTML);
  }
}

function flagCurrentWord() {
  if (currentIndex >= currentList.length) return;
  
  const word = currentList[currentIndex];
  if (flaggedWords.has(word)) {
    flaggedWords.delete(word);
    showFeedback(`🚩 Removed flag from "${word}"`, "info");
  } else {
    flaggedWords.add(word);
    showFeedback(`🚩 Flagged "${word}" for review`, "success");
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
    btn.addEventListener('click', showSummary);
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
    speechSynthesis.getVoices();
    // Voices reload multiple times on Edge — track when they're stable
    window._voicesReady = false;
    let voiceStableTimer = null;
    window.speechSynthesis.onvoiceschanged = function() {
      const v = speechSynthesis.getVoices();
      console.log("Voices loaded:", v.length);
      // Mark voices as ready 2000ms after the last reload
      // Edge reloads voices multiple times — 2s ensures they're truly done
      clearTimeout(voiceStableTimer);
      window._voicesReady = false;
      voiceStableTimer = setTimeout(() => {
        window._voicesReady = true;
        console.log("✅ Voices stable:", v.length);
      }, 2000);
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
  var GOOGLE_URL   = 'https://g.page/r/https://g.page/r/CcXpShfGcR9GEAE/review/review';

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
            '<p style="font-size:0.82rem;color:var(--muted);margin:8px 0 12px;">Would you take 30 seconds to leave a Google review?</p>' +
            '<div class="rating-actions">' +
            '<a href="' + GOOGLE_URL + '" target="_blank" rel="noopener" class="rating-action-btn primary" style="text-decoration:none;">&#11088; Leave a Google review</a>' +
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
// Supports: Web Handwriting Recognition API (Chrome/Android)
//           Cloud Vision OCR fallback (all other devices)
// Modes: school, oet
// =======================================================

const hwState = {
  school: { mode: 'keyboard', drawing: false, strokes: [], lastStrokeTime: null, recognizeTimer: null },
  oet:    { mode: 'keyboard', drawing: false, strokes: [], lastStrokeTime: null, recognizeTimer: null }
};

function setInputMode(moduleMode, inputMode) {
  const s = hwState[moduleMode];
  s.mode = inputMode;
  const keyboardWrap = document.getElementById(`${moduleMode}KeyboardWrap`);
  const keyboardHint = document.getElementById(`${moduleMode}KeyboardHint`);
  const hwWrap       = document.getElementById(`${moduleMode}HwWrap`);
  const kbBtn        = document.getElementById(`${moduleMode}ModeKeyboard`);
  const hwBtn        = document.getElementById(`${moduleMode}ModeHandwriting`);
  const label        = document.getElementById(`${moduleMode}ZoneLabel`);
  if (inputMode === 'handwriting') {
    if (keyboardWrap) keyboardWrap.style.display = 'none';
    if (keyboardHint) keyboardHint.style.display = 'none';
    if (hwWrap) hwWrap.classList.add('visible');
    if (kbBtn) kbBtn.classList.remove('active');
    if (hwBtn) hwBtn.classList.add('active');
    if (label) label.textContent = '✍️ Write your spelling here';
    hwInitCanvas(moduleMode);
  } else {
    if (keyboardWrap) keyboardWrap.style.display = '';
    if (keyboardHint) keyboardHint.style.display = '';
    if (hwWrap) hwWrap.classList.remove('visible');
    if (kbBtn) kbBtn.classList.add('active');
    if (hwBtn) hwBtn.classList.remove('active');
    if (label) label.textContent = '✏️ Type your spelling here';
  }
}

function hwInitCanvas(moduleMode) {
  const canvas = document.getElementById(`${moduleMode}HwCanvas`);
  if (!canvas || canvas.dataset.hwInit) return;
  canvas.dataset.hwInit = '1';
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  };
  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', e => hwPointerDown(e, moduleMode));
  canvas.addEventListener('pointermove', e => hwPointerMove(e, moduleMode));
  canvas.addEventListener('pointerup',   e => hwPointerUp(e, moduleMode));
  canvas.addEventListener('pointerout',  e => hwPointerUp(e, moduleMode));
  canvas.style.touchAction = 'none';
}

function hwGetPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function hwPointerDown(e, moduleMode) {
  e.preventDefault();
  const s = hwState[moduleMode];
  if (e.pointerType === 'mouse' && e.buttons !== 1) return;
  s.drawing = true;
  const canvas = document.getElementById(`${moduleMode}HwCanvas`);
  const pos = hwGetPos(e, canvas);
  s.strokes.push([pos]);
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function hwPointerMove(e, moduleMode) {
  e.preventDefault();
  const s = hwState[moduleMode];
  if (!s.drawing) return;
  const canvas = document.getElementById(`${moduleMode}HwCanvas`);
  const pos = hwGetPos(e, canvas);
  s.strokes[s.strokes.length - 1].push(pos);
  const ctx = canvas.getContext('2d');
  ctx.lineWidth   = e.pointerType === 'pen' ? Math.max(1.5, e.pressure * 4) : 2.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1a0533';
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function hwPointerUp(e, moduleMode) {
  const s = hwState[moduleMode];
  if (!s.drawing) return;
  s.drawing = false;
  s.lastStrokeTime = Date.now();
  clearTimeout(s.recognizeTimer);
  s.recognizeTimer = setTimeout(() => hwRecognize(moduleMode), 800);
}

function hwClear(moduleMode) {
  const s = hwState[moduleMode];
  s.strokes = [];
  clearTimeout(s.recognizeTimer);
  const canvas = document.getElementById(`${moduleMode}HwCanvas`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const textEl   = document.getElementById(`${moduleMode}HwText`);
  const statusEl = document.getElementById(`${moduleMode}HwStatus`);
  if (textEl)   textEl.textContent   = '—';
  if (statusEl) statusEl.textContent = 'Write your word on the canvas above';
}

async function hwRecognize(moduleMode) {
  const s = hwState[moduleMode];
  if (!s.strokes.length) return;
  const statusEl = document.getElementById(`${moduleMode}HwStatus`);
  const textEl   = document.getElementById(`${moduleMode}HwText`);
  if (statusEl) statusEl.textContent = 'Recognizing…';

  // Path 1: Web Handwriting Recognition API (Chrome/Android)
  if ('createHandwritingRecognizer' in navigator) {
    try {
      const recognizer = await navigator.createHandwritingRecognizer({ languages: ['en'] });
      const prediction  = recognizer.startDrawing({});
      for (const stroke of s.strokes) {
        const hwStroke = prediction.addStroke(new HandwritingStroke());
        for (const pt of stroke) hwStroke.addPoint({ x: pt.x, y: pt.y, t: Date.now() });
      }
      const results = await prediction.getPrediction();
      recognizer.finish();
      if (results && results.length > 0) {
        const word = results[0].text.trim();
        if (textEl)   textEl.textContent   = word;
        if (statusEl) statusEl.textContent = '✅ Recognized — tap Submit to check';
        return;
      }
    } catch (err) {
      console.warn('Web Handwriting API failed, falling back to OCR:', err);
    }
  }

  // Path 2: Cloud Vision OCR via /api/ocr Netlify function
  try {
    const canvas  = document.getElementById(`${moduleMode}HwCanvas`);
    const base64  = canvas.toDataURL('image/png').split(',')[1];
    const response = await fetch('/.netlify/functions/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, type: 'handwriting' })
    });
    if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
    const data = await response.json();
    const raw  = data.text || data.fullTextAnnotation?.text || data.textAnnotations?.[0]?.description || '';
    const word = raw.replace(/\s+/g, ' ').trim().split('\n')[0].trim();
    if (word) {
      if (textEl)   textEl.textContent   = word;
      if (statusEl) statusEl.textContent = '✅ Recognized — tap Submit to check';
    } else {
      if (statusEl) statusEl.textContent = '⚠️ Could not read — write more clearly or use keyboard';
    }
  } catch (err) {
    console.error('OCR fallback failed:', err);
    if (statusEl) statusEl.textContent = '⚠️ Recognition failed — try keyboard mode';
  }
}

function hwGetAnswer(moduleMode) {
  const textEl = document.getElementById(`${moduleMode}HwText`);
  const val = textEl ? textEl.textContent.trim() : '';
  return val === '—' ? '' : val;
}

function hwReset(moduleMode) {
  if (hwState[moduleMode] && hwState[moduleMode].mode === 'handwriting') {
    hwClear(moduleMode);
  }
}
