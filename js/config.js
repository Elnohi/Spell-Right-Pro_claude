// js/config.js - COMPLETE FIXED VERSION WITH ANALYTICS
// ------------------------------
// Frontend runtime configuration
// ------------------------------

// Firebase Configuration
window.firebaseConfig = {
  apiKey: "AIzaSyCZ-rAPnRgVjSRFOFvbiQlowE6A3RVvwWo",
  authDomain: "spellrightpro-firebase.firebaseapp.com",
  projectId: "spellrightpro-firebase",
  storageBucket: "spellrightpro-firebase.firebasestorage.app",
  messagingSenderId: "798456641137",
  appId: "1:798456641137:web:5c6d79db5bf49d04928dd0",
  measurementId: "G-H09MF13297"
};

// Global analytics instance
window.firebaseAnalytics = null;
window.firebaseInitialized = false;

// =============================================================================
// ATTRIBUTION CAPTURE — records which UTM/ad brought a visitor in,
// so it can be attached to signup and Stripe checkout later.
//
// PRIVACY: the site already gates Firebase Analytics + trackEvent() behind
// localStorage.cookieConsent === 'true' (see acceptCookies()/declineCookies()
// on index.html and the freemium-*.html pages). This capture follows the same
// rule for anything persisted to localStorage. sessionStorage is used for the
// same-session journey (ad click -> landing -> checkout) since it's cleared
// when the tab closes and isn't treated as persistent tracking; it's written
// unconditionally so attribution survives even if the person hasn't yet
// answered the consent banner (or is on a page that doesn't show one, like
// premium.html or trainer.html). It's promoted to localStorage only after
// consent is explicitly granted, matching the rest of the site's behaviour.
// =============================================================================
(function captureAttribution() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    const hasUtm = utmKeys.some(k => params.has(k));

    function buildAttribution() {
      if (hasUtm) {
        const attribution = {};
        utmKeys.forEach(k => { if (params.has(k)) attribution[k] = params.get(k); });
        attribution.landing_page = window.location.pathname;
        attribution.first_seen = new Date().toISOString();
        return attribution;
      }
      if (document.referrer) {
        let refHost = 'unknown';
        try { refHost = new URL(document.referrer).hostname; } catch (_) {}
        return {
          utm_source: 'referrer', utm_medium: refHost,
          landing_page: window.location.pathname, first_seen: new Date().toISOString()
        };
      }
      return {
        utm_source: 'direct', utm_medium: 'none',
        landing_page: window.location.pathname, first_seen: new Date().toISOString()
      };
    }

    // sessionStorage: always write on a fresh UTM hit, or fill in once per session otherwise.
    if (hasUtm || !sessionStorage.getItem('srp_attribution')) {
      sessionStorage.setItem('srp_attribution', JSON.stringify(buildAttribution()));
    }

    // localStorage: only if consent already granted (persists across sessions/return visits).
    if (localStorage.getItem('cookieConsent') === 'true') {
      if (hasUtm || !localStorage.getItem('srp_attribution')) {
        localStorage.setItem('srp_attribution', sessionStorage.getItem('srp_attribution'));
      }
    }

    // If consent is granted later in the same session, promote what we have immediately.
    document.addEventListener('cookieConsentGranted', function() {
      const current = sessionStorage.getItem('srp_attribution');
      if (current) localStorage.setItem('srp_attribution', current);
    });
  } catch (e) {
    console.warn('Attribution capture failed:', e);
  }
})();

// Reads attribution for the current session, preferring the freshest source.
// sessionStorage wins because it reflects *this* visit's journey; if it's
// empty (e.g. a brand-new tab after consent was granted earlier), fall back
// to whatever localStorage has from a previous consented session.
window.getAttribution = function() {
  try {
    const fromSession = sessionStorage.getItem('srp_attribution');
    if (fromSession) return JSON.parse(fromSession);
    const fromLocal = localStorage.getItem('srp_attribution');
    if (fromLocal) return JSON.parse(fromLocal);
    return {};
  } catch (_) {
    return {};
  }
};

// Initialize Firebase safely with Analytics
window.initFirebase = function() {
  // Prevent multiple initializations
  if (window.firebaseInitialized) {
    console.log('🔁 Firebase already initialized, skipping...');
    return firebase.apps[0];
  }
  
  try {
    if (typeof firebase === 'undefined') {
      console.error('Firebase SDK not loaded');
      return null;
    }

    let app;
    if (!firebase.apps.length) {
      app = firebase.initializeApp(window.firebaseConfig);
      console.log('✅ Firebase app initialized');
    } else {
      app = firebase.apps[0];
      console.log('✅ Using existing Firebase app');
    }

    // Initialize Analytics only with user consent
    if (localStorage.getItem('cookieConsent') === 'true') {
      try {
        if (firebase.analytics) {
          window.firebaseAnalytics = firebase.analytics(app);
          console.log('✅ Firebase Analytics initialized');
          
          // Set user properties if user is logged in
          if (firebase.auth().currentUser) {
            window.firebaseAnalytics.setUserId(firebase.auth().currentUser.uid);
          }
          
          // Log app open event
          window.firebaseAnalytics.logEvent('app_open');
        }
      } catch (analyticsError) {
        console.warn('Analytics initialization warning:', analyticsError);
      }
    } else {
      console.log('🔕 Analytics disabled - no cookie consent');
    }

    window.firebaseInitialized = true;
    return app;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return null;
  }
};

// Analytics Event Tracking Function
window.trackEvent = function(eventName, eventParams = {}) {
  // Check cookie consent first
  if (localStorage.getItem('cookieConsent') !== 'true') {
    return false;
  }
  
  try {
    if (window.firebaseAnalytics) {
      window.firebaseAnalytics.logEvent(eventName, eventParams);
      console.log(`📊 Analytics Event: ${eventName}`, eventParams);
      return true;
    } else if (typeof firebase !== 'undefined' && firebase.analytics) {
      // Fallback: initialize analytics if not already done
      const app = firebase.apps[0];
      if (app) {
        window.firebaseAnalytics = firebase.analytics(app);
        window.firebaseAnalytics.logEvent(eventName, eventParams);
        console.log(`📊 Analytics Event (late init): ${eventName}`, eventParams);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.warn('Analytics event failed:', error);
    return false;
  }
};

// Track page views
window.trackPageView = function(pageName = null) {
  const pageTitle = pageName || document.title || 'Unknown Page';
  window.trackEvent('page_view', {
    page_title: pageTitle,
    page_location: window.location.pathname,
    page_referrer: document.referrer || 'direct'
  });
};

// =============================================================================
// ANALYTICS HELPER FUNCTIONS
// =============================================================================

// Analytics tracking for user actions
window.trackUserAction = function(action, details = {}) {
  const commonParams = {
    page: window.location.pathname,
    timestamp: new Date().toISOString(),
    user_agent: navigator.userAgent
  };
  
  window.trackEvent(action, { ...commonParams, ...details });
};

// Track training sessions
window.trackTrainingStart = function(mode, wordCount) {
  window.trackUserAction('training_started', {
    training_mode: mode,
    word_count: wordCount
  });
};

window.trackTrainingComplete = function(mode, score, totalWords) {
  window.trackUserAction('training_completed', {
    training_mode: mode,
    score: score,
    total_words: totalWords,
    accuracy: totalWords > 0 ? (score / totalWords * 100).toFixed(1) : 0
  });
};

window.trackWordAttempt = function(mode, word, isCorrect) {
  window.trackUserAction('word_attempt', {
    training_mode: mode,
    word: word,
    correct: isCorrect
  });
};

// Track custom list usage
window.trackCustomListUpload = function(listName, wordCount) {
  window.trackUserAction('custom_list_upload', {
    list_name: listName,
    word_count: wordCount
  });
};

// Track UI interactions
window.trackUIInteraction = function(element, action) {
  window.trackUserAction('ui_interaction', {
    element: element,
    action: action,
    page: window.location.pathname
  });
};

// Track user authentication events
window.trackAuthEvent = function(action, method = 'email') {
  window.trackEvent('auth_' + action, {
    method: method,
    timestamp: new Date().toISOString()
  });
};

// Track training events
window.trackTrainingEvent = function(action, mode, details = {}) {
  window.trackEvent('training_' + action, {
    training_mode: mode,
    ...details,
    timestamp: new Date().toISOString()
  });
};

// =============================================================================
// END OF ANALYTICS HELPER FUNCTIONS
// =============================================================================

// App Configuration
window.appConfig = {
  apiBaseUrl: "https://spellrightpro-api-798456641137.us-central1.run.app",
  adClient: "ca-pub-7632930282249669",
  trialDays: 0,
  successUrl: window.location.origin + "/premium.html?payment_success=1",
  cancelUrl: window.location.origin + "/premium.html"
};

// Stripe Configuration
// ── Stripe Key Configuration ───────────────────────────────────────────────
// The correct key is chosen automatically:
//   • Opening from a local file (file://) or localhost  → TEST key
//   • Live domain spellrightpro.org                     → LIVE key
//
// HOW TO GET YOUR TEST KEY:
//   1. Go to dashboard.stripe.com
//   2. Toggle "Test mode" ON (top-right switch)
//   3. Go to Developers → API keys
//   4. Copy the Publishable key (starts with pk_test_...)
//   5. Paste it below replacing the placeholder
//
// ⚠️  Never use your LIVE key for local/test — Stripe rejects it for security.

(function() {
  const isLocal = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.protocol === 'file:';

  window.stripeConfig = {
    // Paste your pk_test_... key here (from Stripe Dashboard → Test mode → API keys)
    testKey: 'pk_test_51RuKs1El99zwdEZrhrRFzKg7B0Y73rtLGHkZL20V7LHwE3jCJpnTXofp09GYg2reRdirJTXsGyvqRPixdCxraFhF00ZkCTNE4Z',

    // Your live key — already correct, do not change
    liveKey: 'pk_live_51RuKs1El99zwdEZr9wjVF3EhADOk4c9x8JjvjPLH8Y16cCPwykZRFVtC1Fr0hSJesStbqcvfvvNOy4NHRa0GPvg004IIcPfC8',

    // publicKey is what the checkout page reads — chosen automatically
    publicKey: isLocal
      ? 'pk_test_51RuKs1El99zwdEZrhrRFzKg7B0Y73rtLGHkZL20V7LHwE3jCJpnTXofp09GYg2reRdirJTXsGyvqRPixdCxraFhF00ZkCTNE4Z'
      : 'pk_live_51RuKs1El99zwdEZr9wjVF3EhADOk4c9x8JjvjPLH8Y16cCPwykZRFVtC1Fr0hSJesStbqcvfvvNOy4NHRa0GPvg004IIcPfC8',

    isTestMode: isLocal
  };

  if (isLocal) {
    console.log('🧪 Stripe: TEST mode active (local environment)');
    console.warn('⚠️  Replace pk_test_REPLACE_WITH_YOUR_TEST_KEY in config.js with your real test key from dashboard.stripe.com');
  } else {
    console.log('💳 Stripe: LIVE mode active');
  }
})();

// In config.js, update the adsenseConfig:
window.adsenseConfig = {
  enabled: true, // CHANGED FROM false TO true
  client: "ca-pub-7632930282249669",
  // Only show ads to free users
  showAds: function() {
    // If tierManager isn't ready yet, default to showing ads (free user)
    const tier = window.tierManager?.currentTier ?? 'free';
    return tier !== 'premium';
  }
};

// Add ad loading function
window.loadAds = function() {
  if (window.adsenseConfig.enabled && window.adsenseConfig.showAds()) {
    console.log('Loading ads for free user...');
    
    // Load AdSense script if not already loaded
    if (!document.querySelector('script[src*="adsbygoogle"]')) {
      const script = document.createElement('script');
      script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
    
    // Initialize ads (guard against adsbygoogle not yet defined)
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch(e) { console.warn('Ad push failed:', e); }
    
    // Track ad view
    window.trackEvent('ad_view', {
      page: window.location.pathname,
      tier: 'free'
    });
  }
};

// Initialize Firebase when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Initializing Firebase...');
  
  // Wait a bit for Firebase SDK to load
  setTimeout(() => {
    const app = window.initFirebase();
    if (app) {
      // Track initial page view
      window.trackPageView();
      
      // Set up history tracking for SPA navigation
      if (window.history && window.history.pushState) {
        const originalPushState = history.pushState;
        history.pushState = function() {
          originalPushState.apply(this, arguments);
          setTimeout(() => {
            window.trackPageView();
          }, 100);
        };
        
        window.addEventListener('popstate', function() {
          setTimeout(() => {
            window.trackPageView();
          }, 100);
        });
      }
    }
  }, 500);
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { firebaseConfig: window.firebaseConfig };
}
