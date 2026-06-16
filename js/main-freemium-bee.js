/* /js/main-freemium-bee.js - UPDATED WITH TIER MANAGEMENT */
(() => {
  const $ = s => document.querySelector(s);
  const els = {
    start:  $('#btnStart'),
    flag:   $('#btnFlag'),
    end:    $('#btnEnd'),
    say:    $('#btnSayAgain'),
    progress: $('#progress'),
    feedback: $('#feedback'),
    customBox: $('#customWords'),
    fileInput: $('#fileInput'),
    useCustom: $('#useCustomList'),
    fileName: $('#fileName'),
    summary: $('.summary-area')
  };

  const LIST = '/data/spelling-bee.json';
  const FALLBACK = ['accommodate','rhythm','occurrence','necessary','embarrass','challenge','definitely','separate','recommend','privilege'];

  // ========================================================
  // TIER-AWARE LIMIT FUNCTIONS
  // ========================================================
  
  function checkCustomWordAccess() {
    // Premium users have unlimited access
    if (window.tierManager?.currentTier === 'premium') {
      return { allowed: true, reason: 'premium' };
    }
    
    const today = new Date().toDateString();
    const lastUsedDate = localStorage.getItem('lastCustomWordDate');
    const customWordsUsed = localStorage.getItem('customWordsUsedToday') === 'true';
    
    // If it's a new day, reset the counter
    if (lastUsedDate !== today) {
      localStorage.setItem('lastCustomWordDate', today);
      localStorage.setItem('customWordsUsedToday', 'false');
      return { allowed: true, reason: 'new_day' };
    }
    
    // If already used today, deny
    if (customWordsUsed) {
      return { allowed: false, reason: 'daily_limit_reached' };
    }
    
    return { allowed: true, reason: 'available' };
  }

  function markCustomWordsUsed() {
    // Only track for free users
    if (window.tierManager?.currentTier === 'free') {
      const today = new Date().toDateString();
      localStorage.setItem('lastCustomWordDate', today);
      localStorage.setItem('customWordsUsedToday', 'true');
    }
  }

  function showUpgradePrompt(trigger) {
    const messages = {
      daily_limit: '❌ Daily custom word limit reached. Free users can only use one custom list per day.',
      list_limit: `❌ Custom list limit reached. Free users can create up to ${window.tierManager?.getLimit('customLists') || 3} lists.`,
      history_limit: '🔒 Viewing limited to last 5 sessions. Upgrade for full history.',
      feature_locked: '🔒 This feature requires Premium access.'
    };
    
    t(els.feedback, messages[trigger] || messages.feature_locked);
    
    // Show tier manager upgrade prompt if available
    setTimeout(() => {
      if (window.tierManager) {
        const upgradeContext = {
          daily_limit: 'customLists',
          list_limit: 'customLists',
          history_limit: 'practiceHistory',
          feature_locked: 'premiumContent'
        };
        
        window.tierManager.showUpgradePrompt(
          upgradeContext[trigger] || 'premiumContent',
          `Try unlimited access with Premium.`
        );
      } else {
        // Fallback upgrade message
        showFallbackUpgradeMessage();
      }
    }, 1000);
  }

  function showFallbackUpgradeMessage() {
    const upgradeMsg = document.createElement('div');
    upgradeMsg.style.cssText = `
      background: linear-gradient(135deg, #7b2ff7, #9d4edd);
      color: white;
      padding: 15px;
      border-radius: 8px;
      margin: 10px 0;
      text-align: center;
    `;
    upgradeMsg.innerHTML = `
      <strong>💎 Upgrade to Premium!</strong><br>
      <small>Get unlimited custom lists, voice recognition, and all spelling modes</small><br>
      <button onclick="window.location.href='/pricing.html'" 
              style="background: white; color: #7b2ff7; border: none; padding: 8px 16px; border-radius: 6px; margin-top: 8px; font-weight: bold; cursor: pointer;">
        View Plans
      </button>
    `;
    
    const existingUpgrade = document.querySelector('.upgrade-message');
    if (existingUpgrade) existingUpgrade.remove();
    
    upgradeMsg.className = 'upgrade-message';
    if (els.feedback) {
      els.feedback.parentNode.insertBefore(upgradeMsg, els.feedback.nextSibling);
    }
  }

  // ========================================================
  // EXISTING FUNCTIONS (Mostly Unchanged)
  // ========================================================
  
  const state = { 
    words: [], 
    i: 0, 
    flags: new Set(), 
    correct: [], 
    incorrect: [], 
    active: false, 
    recognizing: false 
  };

  function t(el, s) { if (el) el.textContent = s; }
  const norm = s => (s || '').toLowerCase().replace(/[^\p{L}]+/gu, '');

  function speakWord(word) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        t(els.feedback, '🎤 Text-to-speech not supported in this browser');
        resolve();
        return;
      }

      try {
        speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;
        
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
          const ukVoice = voices.find(v => v.lang.includes('en-GB')) || 
                         voices.find(v => v.lang.includes('en-US')) || 
                         voices[0];
          utterance.voice = ukVoice;
        }
        
        utterance.onend = () => {
          console.log('Finished speaking:', word);
          resolve();
        };
        
        utterance.onerror = (event) => {
          // 'interrupted' fires normally after speechSynthesis.cancel() — not a real error
          if (event.error === 'interrupted' || event.error === 'canceled') { resolve(); return; }
          // Edge sometimes denies audio as 'not-allowed' — guide the user
          if (event.error === 'not-allowed') {
            t(els.feedback, '⚠️ Audio blocked. Click "Allow" in browser and try again.');
            resolve();
            return;
          }
          console.error('Speech error:', event);
          t(els.feedback, '⚠️ Speech error. Continuing...');
          resolve();
        };
        
        speechSynthesis.speak(utterance);
        t(els.feedback, '🎧 Listening...');
        
      } catch (error) {
        console.error('Speech synthesis failed:', error);
        t(els.feedback, '⚠️ Could not speak word');
        resolve();
      }
    });
  }

  // ... [KEEP ALL EXISTING FUNCTIONS UNCHANGED UNTIL Event Listeners] ...

  // ========================================================
  // UPDATED EVENT LISTENERS WITH TIER CHECKS
  // ========================================================

  els.start?.addEventListener('click', async () => {
    initializeSpeech();
    
    const customText = (els.customBox?.value || '').trim();
    if (customText) {
      // CHECK TIER-BASED ACCESS
      const access = checkCustomWordAccess();
      if (!access.allowed) {
        showUpgradePrompt('daily_limit');
        return;
      }
      
      state.words = loadCustomWords(customText);
      t(els.feedback, `Custom list loaded: ${state.words.length} words`);
      
      // MARK AS USED (only for free users)
      markCustomWordsUsed();
      
      // TRACK USAGE FOR ANALYTICS
      if (window.trackEvent) {
        window.trackEvent('custom_list_used', {
          mode: 'bee',
          word_count: state.words.length,
          tier: window.tierManager?.currentTier || 'free'
        });
      }
    } else {
      state.words = await loadWords();
      t(els.feedback, `Bee words loaded: ${state.words.length} words`);
    }
    
    if (!state.words.length) { 
      t(els.feedback, 'No words loaded.'); 
      return; 
    }
    
    state.i = 0; 
    state.flags.clear(); 
    state.correct = []; 
    state.incorrect = []; 
    state.active = true;
    
    if (els.summary) els.summary.style.display = 'none';
    
    play();
  });
  
  els.flag?.addEventListener('click', toggleFlag);
  
  els.say?.addEventListener('click', () => { 
    if (!state.active) return; 
    const w = state.words[state.i];
    if (w) speakWord(w);
  });
  
  els.end?.addEventListener('click', endSession);

  els.fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // CHECK TIER-BASED ACCESS
    const access = checkCustomWordAccess();
    if (!access.allowed) {
      showUpgradePrompt('daily_limit');
      e.target.value = ''; // Clear the file input
      return;
    }

    if (els.fileName) els.fileName.textContent = file.name;

    try {
      const text = await file.text();
      const words = loadCustomWords(text);
      state.words = words;
      t(els.feedback, `Loaded ${words.length} words from file. Ready to start!`);
      
      // MARK AS USED
      markCustomWordsUsed();
      
      // TRACK FILE UPLOAD
      if (window.trackEvent) {
        window.trackEvent('file_upload', {
          mode: 'bee',
          word_count: words.length,
          tier: window.tierManager?.currentTier || 'free'
        });
      }
    } catch (error) {
      t(els.feedback, 'Error reading file. Please try again.');
    }
  });

  els.useCustom?.addEventListener('click', () => {
    const customText = (els.customBox?.value || '').trim();
    if (!customText) {
      t(els.feedback, 'Please enter words in the custom words box first.');
      return;
    }
    
    // CHECK TIER-BASED ACCESS
    const access = checkCustomWordAccess();
    if (!access.allowed) {
      showUpgradePrompt('daily_limit');
      return;
    }
    
    const words = loadCustomWords(customText);
    state.words = words;
    t(els.feedback, `Custom list loaded: ${words.length} words. Ready to start!`);
    
    // MARK AS USED
    markCustomWordsUsed();
  });

  // ========================================================
  // ADD CUSTOM LIST MANAGEMENT UI
  // ========================================================
  
  function addCustomListUI() {
    // Only show for free users
    if (window.tierManager?.currentTier === 'premium') return;
    
    const container = document.querySelector('.main-card');
    if (!container) return;
    
    // Check if UI already exists
    if (document.querySelector('.custom-list-counter')) return;
    
    const listCounter = document.createElement('div');
    listCounter.className = 'custom-list-counter';
    listCounter.style.cssText = `
      margin: 15px 0;
      padding: 12px;
      background: rgba(123, 47, 247, 0.05);
      border-radius: 8px;
      border: 1px solid rgba(123, 47, 247, 0.1);
    `;
    
    // Get current list count
    const savedLists = JSON.parse(localStorage.getItem('userCustomLists') || '{}');
    const listCount = Object.keys(savedLists).length;
    const limit = window.tierManager?.getLimit('customLists') || 3;
    const percent = Math.min((listCount / limit) * 100, 100);
    
    listCounter.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 600; color: #7b2ff7;">Custom Lists</span>
        <span class="counter-text" style="font-weight: 600; color: ${listCount >= limit ? '#f72585' : '#7b2ff7'};">${listCount}/${limit}</span>
      </div>
      <div class="progress-bar" style="height: 6px; background: rgba(0,0,0,0.1); border-radius: 3px; overflow: hidden;">
        <div class="progress-fill" style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, #7b2ff7, #f72585); border-radius: 3px; transition: width 0.3s ease;"></div>
      </div>
      ${listCount >= limit ? 
        `<div style="margin-top: 8px; font-size: 0.9em; color: #f72585;">
          <i class="fa fa-lock"></i> Limit reached. <a href="#" onclick="window.tierManager?.showUpgradePrompt('customLists')" style="color: #7b2ff7; font-weight: 600;">Upgrade</a> for unlimited lists.
        </div>` : 
        `<div style="margin-top: 8px; font-size: 0.9em; color: #666;">
          Free users can create up to ${limit} custom lists.
        </div>`
      }
    `;
    
    // Insert after the feedback element or before the button group
    const buttonGroup = document.querySelector('.button-group');
    if (buttonGroup) {
      buttonGroup.parentNode.insertBefore(listCounter, buttonGroup);
    } else if (els.feedback) {
      els.feedback.parentNode.insertBefore(listCounter, els.feedback.nextSibling);
    }
  }

  // ========================================================
  // ENHANCED SESSION SAVING WITH TIER LIMITS
  // ========================================================
  
  function saveSessionHistory() {
    // Premium users: save unlimited history
    // Free users: only save last 5 sessions
    
    const sessionData = {
      mode: 'bee',
      words: state.words,
      correct: state.correct.length,
      incorrect: state.incorrect.length,
      date: new Date().toISOString(),
      score: state.correct.length / state.words.length * 100
    };
    
    // Get existing history
    const history = JSON.parse(localStorage.getItem('practiceHistory') || '[]');
    
    // Add new session
    history.unshift(sessionData);
    
    // Apply tier-based limit
    let limitedHistory = history;
    if (window.tierManager?.currentTier === 'free') {
      const limit = window.tierManager.getLimit('practiceHistory') || 5;
      limitedHistory = history.slice(0, limit);
      
      // Show preview message if at limit
      if (history.length > limit) {
        setTimeout(() => {
          showUpgradePrompt('history_limit');
        }, 2000);
      }
    }
    
    // Save back to localStorage
    localStorage.setItem('practiceHistory', JSON.stringify(limitedHistory));
    
    return limitedHistory;
  }

  // ========================================================
  // MODIFIED END SESSION FUNCTION
  // ========================================================
  
  function endSession() {
    state.active = false; 
    speechSynthesis.cancel();
    
    // Save session history with tier limits
    const history = saveSessionHistory();
    
    const flagged = [...state.flags];
    const total = state.words.length;
    const correctCount = state.correct.length;
    const incorrectCount = state.incorrect.length;

    let summaryHTML = `
      <div style="background: rgba(0,0,0,0.05); padding: 20px; border-radius: 10px;">
        <h3 style="margin-top: 0; color: #7b2ff7;">Bee Session Complete! 🎉</h3>
        <p style="font-size: 1.2em; font-weight: bold; color: #7b2ff7;">Score: ${correctCount}/${total} correct</p>
    `;

    // ... [KEEP EXISTING SUMMARY HTML CODE] ...

    summaryHTML += `</div>`;
    
    if (els.summary) {
      els.summary.innerHTML = summaryHTML;
      els.summary.style.display = 'block';
    }
    
    // Add history preview for free users
    if (window.tierManager?.currentTier === 'free' && history.length > 0) {
      setTimeout(() => {
        addHistoryPreview(history);
      }, 500);
    }
  }

  function addHistoryPreview(history) {
    const preview = document.createElement('div');
    preview.className = 'history-preview';
    preview.style.cssText = `
      margin-top: 20px;
      padding: 15px;
      background: rgba(123, 47, 247, 0.05);
      border-radius: 8px;
      border: 1px solid rgba(123, 47, 247, 0.1);
    `;
    
    const limit = window.tierManager?.getLimit('practiceHistory') || 5;
    
    preview.innerHTML = `
      <h4 style="margin-top: 0; color: #7b2ff7; font-size: 1rem;">
        <i class="fa fa-history"></i> Recent Sessions (${Math.min(history.length, limit)} shown)
      </h4>
      <div style="max-height: 150px; overflow-y: auto;">
        ${history.slice(0, limit).map(session => `
          <div style="padding: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); font-size: 0.9em;">
            <span style="color: #666;">${new Date(session.date).toLocaleDateString()}</span>
            <span style="float: right; font-weight: 600; color: ${session.score > 70 ? '#4CAF50' : '#f72585'}">
              ${session.score.toFixed(0)}%
            </span>
          </div>
        `).join('')}
      </div>
      ${history.length >= limit ? 
        `<div style="margin-top: 10px; padding: 8px; background: rgba(123, 47, 247, 0.1); border-radius: 4px; font-size: 0.85em; text-align: center;">
          <i class="fa fa-lock"></i> Free users see last ${limit} sessions. 
          <a href="#" onclick="window.tierManager?.showUpgradePrompt('practiceHistory')" style="color: #7b2ff7; font-weight: 600;">Upgrade</a> for unlimited history.
        </div>` : ''
      }
    `;
    
    if (els.summary) {
      els.summary.appendChild(preview);
    }
  }

  // ========================================================
  // INITIALIZATION WITH TIER SUPPORT
  // ========================================================
  
  function initializeDarkModeToggle() {
    const darkModeToggle = document.getElementById('toggleDark');
    if (!darkModeToggle) return;

    const icon = darkModeToggle.querySelector('i');
    const isDark = document.body.classList.contains('dark-mode');
    if (icon) icon.className = isDark ? 'fa fa-sun' : 'fa fa-moon';

    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const icon = darkModeToggle.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-moon');
        icon.classList.toggle('fa-sun');
      }
      localStorage.setItem('dark', document.body.classList.contains('dark-mode'));
    });

    const savedDarkMode = localStorage.getItem('dark') === 'true';
    if (savedDarkMode && !document.body.classList.contains('dark-mode')) {
      document.body.classList.add('dark-mode');
      const icon = darkModeToggle.querySelector('i');
      if (icon) icon.className = 'fa fa-sun';
    }
  }

  // Enhanced initialization
  function initializeApp() {
    // Wait for tier manager to be ready
    const checkTierManager = setInterval(() => {
      if (window.tierManager) {
        clearInterval(checkTierManager);
        console.log('🎯 Tier manager loaded:', window.tierManager.currentTier);
        
        // Add custom list UI for free users
        addCustomListUI();
        
        // Initialize other components
        initializeDarkModeToggle();
        
        // Set up tier change listener
        document.addEventListener('tierChange', (e) => {
          console.log('Tier changed to:', e.detail.tier);
          // Refresh UI
          addCustomListUI();
        });
      }
    }, 100);
    
    // Fallback initialization after 3 seconds
    setTimeout(() => {
      if (!window.tierManager) {
        console.warn('Tier manager not available, using fallback mode');
        initializeDarkModeToggle();
      }
    }, 3000);
  }

  window.restartBeeTraining = restartBeeTraining;

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }

  console.log('Bee ready - Integrated with tier management');
})();
