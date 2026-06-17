// js/firebase-utils.js - COMPLETE FIXED VERSION WITH ANALYTICS
class FirebaseUtils {
  constructor() {
    this.auth = null;
    this.db = null;
    this.initialized = false;
    this.initializationAttempts = 0;
    this.maxInitializationAttempts = 10;
    this.init();
  }

  init() {
    try {
      // Safety check - don't initialize too many times
      this.initializationAttempts++;
      if (this.initializationAttempts > this.maxInitializationAttempts) {
        console.error('❌ Too many initialization attempts, giving up');
        return;
      }

      // Wait for Firebase to load
      if (typeof firebase === 'undefined') {
        console.log('⏳ Waiting for Firebase SDK...');
        setTimeout(() => this.init(), 1000);
        return;
      }

      // Initialize Firebase app if not already done
      let app;
      if (!firebase.apps.length) {
        if (window.firebaseConfig) {
          app = firebase.initializeApp(window.firebaseConfig);
          console.log('✅ Firebase app initialized in utils');
        } else {
          console.error('❌ Firebase config not found');
          setTimeout(() => this.init(), 1000);
          return;
        }
      } else {
        app = firebase.apps[0];
        console.log('✅ Using existing Firebase app');
      }

      // Get auth and firestore
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      
      // Set up auth state listener for analytics
      this.setupAuthStateListener();
      
      // Enable offline persistence
      this.enablePersistence();
      
      this.initialized = true;
      console.log('✅ Firebase utils initialized successfully');

      // Test connection
      this.testConnection();

    } catch (error) {
      console.error('❌ Firebase utils init error:', error);
      // Retry after delay
      setTimeout(() => this.init(), 2000);
    }
  }

  setupAuthStateListener() {
    if (!this.auth) return;

    this.auth.onAuthStateChanged(async (user) => {
      console.log('🔐 Auth state changed:', user ? user.email : 'No user');
      
      if (user) {
        // Set user ID for analytics
        if (window.firebaseAnalytics) {
          window.firebaseAnalytics.setUserId(user.uid);
          window.trackAuthEvent('login', 'email');
        }
        
        // Check premium status
        const isPremium = await this.checkPremiumStatus(user);
        
        // Track premium status in analytics
        if (window.firebaseAnalytics) {
          window.firebaseAnalytics.setUserProperties({
            premium_user: isPremium ? 'true' : 'false'
          });
          
          if (isPremium) {
            window.trackEvent('premium_access_granted');
          }
        }
      } else {
        // User signed out
        if (window.firebaseAnalytics) {
          window.firebaseAnalytics.setUserId(null);
          window.trackAuthEvent('logout');
        }
      }
    });
  }

  enablePersistence() {
    if (this.db) {
      this.db.enablePersistence()
        .then(() => {
          console.log('✅ Firestore persistence enabled');
        })
        .catch((err) => {
          console.warn('⚠️ Firestore persistence failed:', err);
        });
    }
  }

  // Test Firestore connection
  async testConnection() {
    if (!this.initialized || !this.db) {
      console.log('⏳ Cannot test connection - not initialized');
      return false;
    }

    try {
      // Simple test query
      const testQuery = await this.db.collection('premiumUsers').limit(1).get();
      console.log('✅ Firestore connection test successful');
      return true;
    } catch (error) {
      console.warn('⚠️ Firestore connection test failed:', error);
      return false;
    }
  }

  // Check if user is premium
  // Checks THREE sources in order — fastest first:
  //   1. localStorage srpPremium (set by thank-you.html immediately after payment)
  //   2. Firestore premiumUsers/{uid} (written by webhook or verify-session)
  //   3. Firestore premiumByEmail/{email} (fallback when UID was not available at checkout)
  async checkPremiumStatus(user) {
    if (!user) {
      console.warn('checkPremiumStatus: no user');
      return false;
    }

    // ── Source 1: localStorage (instant, set by thank-you.html) ─────────────
    try {
      const stored = JSON.parse(localStorage.getItem('srpPremium') || 'null');
      if (stored && stored.active && new Date(stored.expiry) > new Date()) {
        console.log('✅ Premium confirmed via localStorage');
        return true;
      }
    } catch (_) {}

    // Also check the old key format
    if (localStorage.getItem('premium_' + user.uid) === 'true') {
      console.log('✅ Premium confirmed via legacy localStorage key');
      return true;
    }

    if (!this.initialized) {
      console.warn('Firebase not initialized — cannot check Firestore');
      return false;
    }

    // ── Source 2: Firestore premiumUsers/{uid} ───────────────────────────────
    try {
      const userDoc = await this.db.collection('premiumUsers').doc(user.uid).get();
      if (userDoc.exists) {
        const data       = userDoc.data();
        const expiryDate = data.expiryDate?.toDate();
        if (data.active !== false && (!expiryDate || expiryDate > new Date())) {
          console.log('✅ Premium confirmed via Firestore premiumUsers');
          // Cache in localStorage for next load
          localStorage.setItem('srpPremium', JSON.stringify({
            active: true, email: user.email || '',
            plan:   data.plan || 'premium',
            expiry: expiryDate ? expiryDate.toISOString()
                               : new Date(Date.now() + 30*86400000).toISOString(),
            source: 'firestore_uid'
          }));
          return true;
        } else {
          console.warn('⚠️ Firestore premiumUsers: subscription expired or inactive');
return false;
        }
      }
    } catch (err) {
      console.warn('Firestore premiumUsers check failed:', err.message);
    }

    // ── Source 3: Firestore premiumByEmail/{email} ───────────────────────────
    // Catches users who paid before logging in (firebaseUid was empty at checkout)
    if (user.email) {
      try {
        const safeEmail = user.email.replace(/[.#$[\]\/]/g, '_');
        const emailDoc  = await this.db.collection('premiumByEmail').doc(safeEmail).get();
        if (emailDoc.exists) {
          const data       = emailDoc.data();
          const expiryDate = data.expiryDate?.toDate();
          if (data.active !== false && (!expiryDate || expiryDate > new Date())) {
            console.log('✅ Premium confirmed via Firestore premiumByEmail');

            // Now that we have the UID, upgrade the record to premiumUsers/{uid}
            // so future logins use the faster Source 2 path
            try {
              await this.db.collection('premiumUsers').doc(user.uid).set({
                ...data,
                firebaseUid:  user.uid,
                migratedFrom: 'premiumByEmail',
                migratedAt:   firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              console.log('✅ Migrated premiumByEmail → premiumUsers/' + user.uid);
            } catch (_) {}

            // Cache in localStorage
            localStorage.setItem('srpPremium', JSON.stringify({
              active: true, email: user.email,
              plan:   data.plan || 'premium',
              expiry: expiryDate ? expiryDate.toISOString()
                                 : new Date(Date.now() + 30*86400000).toISOString(),
              source: 'firestore_email'
            }));
            return true;
          }
        }
      } catch (err) {
        console.warn('Firestore premiumByEmail check failed:', err.message);
      }
    }

    console.log('❌ No premium record found in any source');
    return false;
  }

  // Save user progress with analytics
  async saveUserProgress(userId, progressData) {
    if (!this.initialized) {
      console.warn('Firebase not initialized');
      return false;
    }

    try {
      await this.db.collection('userProgress').doc(userId).set({
        ...progressData,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      console.log('✅ Progress saved successfully');
      
      // Track progress saved event
      window.trackEvent('progress_saved', {
        user_id: userId,
        mode: progressData.mode || 'unknown',
        words_learned: progressData.wordsLearned || 0
      });
      
      return true;
    } catch (error) {
      console.error('❌ Error saving progress:', error);
      return false;
    }
  }

  // Get user progress
  async getUserProgress(userId) {
    if (!this.initialized) {
      console.warn('Firebase not initialized');
      return null;
    }

    try {
      const doc = await this.db.collection('userProgress').doc(userId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('❌ Error getting progress:', error);
      return null;
    }
  }

  // Track custom training events
  trackTrainingSession(mode, action, details = {}) {
    window.trackTrainingEvent(action, mode, details);
  }

  // Get current user
  getCurrentUser() {
    return this.auth ? this.auth.currentUser : null;
  }

  // Check if user is logged in
  isUserLoggedIn() {
    return !!this.getCurrentUser();
  }

  // Sign out user
  async signOut() {
    if (this.auth) {
      try {
        await this.auth.signOut();
        console.log('✅ User signed out successfully');
        return true;
      } catch (error) {
        console.error('❌ Sign out error:', error);
        return false;
      }
    }
    return false;
  }

  // ── Cross-device sync ──────────────────────────────────────────────────────
  // Saves custom word lists to Firestore so they persist across devices.
  async saveCustomLists(userId, lists) {
    if (!this.initialized || !userId) return false;
    try {
      await this.db.collection('userLists').doc(userId).set({
        lists,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('✅ Custom lists synced to Firestore');
      return true;
    } catch (err) {
      console.warn('⚠️ Custom list sync failed:', err.message);
      return false;
    }
  }

  async getCustomLists(userId) {
    if (!this.initialized || !userId) return null;
    try {
      const doc = await this.db.collection('userLists').doc(userId).get();
      return doc.exists ? doc.data().lists : null;
    } catch (err) {
      console.warn('⚠️ Custom list fetch failed:', err.message);
      return null;
    }
  }

  // Saves mistake bank (spaced repetition data) to Firestore.
  async saveMistakeBank(userId, mistakes, schedule) {
    if (!this.initialized || !userId) return false;
    try {
      await this.db.collection('mistakeBanks').doc(userId).set({
        mistakes,
        schedule,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('✅ Mistake bank synced to Firestore');
      return true;
    } catch (err) {
      console.warn('⚠️ Mistake bank sync failed:', err.message);
      return false;
    }
  }

  async getMistakeBank(userId) {
    if (!this.initialized || !userId) return null;
    try {
      const doc = await this.db.collection('mistakeBanks').doc(userId).get();
      return doc.exists ? { mistakes: doc.data().mistakes || [], schedule: doc.data().schedule || {} } : null;
    } catch (err) {
      console.warn('⚠️ Mistake bank fetch failed:', err.message);
      return null;
    }
  }

  // Pull all user data from Firestore and hydrate localStorage.
  // Called once on login so the session feels continuous on any device.
  async hydrateFromCloud(userId) {
    if (!this.initialized || !userId) return;
    try {
      const [lists, mistakeData, progress] = await Promise.all([
        this.getCustomLists(userId),
        this.getMistakeBank(userId),
        this.getUserProgress(userId)
      ]);

      if (lists) {
        localStorage.setItem('premiumCustomLists', JSON.stringify(lists));
        console.log('✅ Custom lists hydrated from Firestore');
      }

      if (mistakeData) {
        localStorage.setItem('mistakeBank',     JSON.stringify(mistakeData.mistakes));
        localStorage.setItem('mistakeSchedule', JSON.stringify(mistakeData.schedule));
        console.log('✅ Mistake bank hydrated from Firestore');
      }

      if (progress && progress.sessionHistory) {
        // Merge cloud history with local — cloud wins on conflict
        const local = JSON.parse(localStorage.getItem('premiumSessionHistory') || '[]');
        const merged = [...progress.sessionHistory, ...local]
          .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 100); // keep last 100 sessions
        localStorage.setItem('premiumSessionHistory', JSON.stringify(merged));
        console.log('✅ Session history hydrated from Firestore');
      }

      document.dispatchEvent(new CustomEvent('srpCloudSynced', { detail: { userId } }));
    } catch (err) {
      console.warn('⚠️ Cloud hydration failed (offline?):', err.message);
    }
  }
}

// Create global instance with error handling
try {
  window.firebaseUtils = new FirebaseUtils();
} catch (error) {
  console.error('❌ Failed to create FirebaseUtils instance:', error);
  // Create a fallback object with basic functionality
  window.firebaseUtils = {
    initialized: false,
    init: function() { console.log('FirebaseUtils not available'); },
    checkPremiumStatus: async function() { return false; },
    isUserLoggedIn: function() { return false; }
  };
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FirebaseUtils;
}
