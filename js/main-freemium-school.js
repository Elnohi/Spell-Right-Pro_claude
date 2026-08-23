/* /js/main-freemium-school.js - COMPLETE WITH TIER MANAGEMENT */
(() => {
  const $ = s => document.querySelector(s);
  const ui = {
    area: $('#answer'),
    submit: $('#btnSubmit'),
    upload: $('#fileInput'),
    start: $('#btnStart'),
    say: $('#btnSayAgain'),
    flag: $('#btnFlag'),
    end: $('#btnEnd'),
    progress: $('#progress'),
    feedback: $('#feedback'),
    customBox: $('#customWords'),
    useCustom: $('#useCustomList'),
    fileName: $('#fileName'),
    summary: $('.summary-area')
  };

  const LIST = '/data/school.json';
  const FALLBACK = ['example', 'language', 'grammar', 'knowledge', 'science', 'mathematics', 'history', 'geography', 'literature', 'chemistry'];
  
  const state = { 
    words: [], 
    i: 0, 
    correct: [], 
    incorrect: [], 
    flags: new Set(), 
    active: false 
  };

  // ========================================================
  // TIER-AWARE FUNCTIONS
  // ========================================================
  
  function checkCustomAccess() {
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

  function trackUsage() {
    // Only track for free users
    if (window.tierManager?.currentTier === 'free') {
      const today = new Date().toDateString();
      localStorage.setItem('lastCustomWordDate', today);
      localStorage.setItem('customWordsUsedToday', 'true');
    }
  }

  function showTierUpgrade(trigger, context = '') {
    const messages = {
      daily_limit: '❌ Daily custom word limit reached. Free users can only use one custom list per day.',
      list_limit: `❌ Custom list limit reached. Free users can create up to ${window.tierManager?.getLimit('customLists') || 3} lists.`,
      history_limit: '🔒 Viewing limited to recent sessions. Upgrade for full history.',
      feature_locked: '🔒 This feature requires Premium access.',
      school_content: '🔒 Full school content requires Premium access.'
    };
    
    t(ui.feedback, messages[trigger] || messages.feature_locked);
    
    // Show tier manager upgrade prompt if available
    setTimeout(() => {
      if (window.tierManager) {
        const upgradeContext = {
          daily_limit: 'customLists',
          list_limit: 'customLists',
          history_limit: 'practiceHistory',
          feature_locked: 'premiumContent',
          school_content: 'premiumContent'
        };
        
        window.tierManager.showUpgradePrompt(
          upgradeContext[trigger] || 'premiumContent',
          context || `Try unlimited access with Premium.`
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
      <small>Get unlimited custom lists, all spelling modes, and no ads</small><br>
      <button onclick="window.location.href='/pricing.html'" 
              style="background: white; color: #7b2ff7; border: none; padding: 8px 16px; border-radius: 6px; margin-top: 8px; font-weight: bold; cursor: pointer;">
        View Plans
      </button>
    `;
    
    const existingUpgrade = document.querySelector('.upgrade-message');
    if (existingUpgrade) existingUpgrade.remove();
    
    upgradeMsg.className = 'upgrade-message';
    if (ui.feedback) {
      ui.feedback.parentNode.insertBefore(upgradeMsg, ui.feedback.nextSibling);
    }
  }

  // ========================================================
  // EXISTING FUNCTIONS (Mostly Unchanged)
  // ========================================================

  function t(el, s) { if (el) el.textContent = s; }
  function norm(s) { return (s || '').toLowerCase().trim(); }
  
  function showProgress() { 
    t(ui.progress, `Word ${Math.min(state.i + 1, state.words.length)} of ${state.words.length}`); 
  }

  // Text-to-speech implementation
  function speakWord(word) {
    if (!window.speechSynthesis) {
      t(ui.feedback, "Text-to-speech not supported in this browser");
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
        const englishVoice = voices.find(v => v.lang.includes('en-US')) || voices[0];
        utterance.voice = englishVoice;
      }
      
      utterance.onend = function() {
        console.log("Finished speaking:", word);
      };
      
      utterance.onerror = function(event) {
        console.error("Speech synthesis error:", event);
        t(ui.feedback, "Error speaking word");
      };
      
      speechSynthesis.speak(utterance);
      t(ui.feedback, "Speaking word...");
      
    } catch (error) {
      console.error("Speech error:", error);
      t(ui.feedback, "Could not speak word");
    }
  }

  async function loadDefault() {
    try { 
      const r = await fetch(`${LIST}?v=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to fetch');
      const j = await r.json();
      const arr = Array.isArray(j?.words) ? j.words : (Array.isArray(j) ? j : []);
      
      // Apply tier-based content limits
      if (window.tierManager?.currentTier === 'free') {
        // Free users get limited content
        return arr.length > 20 ? arr.slice(0, 20) : arr;
      }
      
      return arr.length ? arr : FALLBACK;
    } catch (_) { 
      return FALLBACK; 
    }
  }

  function loadCustomWords(text) {
    try {
      const j = JSON.parse(text);
      return Array.isArray(j?.words) ? j.words : (Array.isArray(j) ? j : []);
    } catch (_) {
      return text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }
  }

  // ========================================================
  // UPDATED START FUNCTION WITH TIER CHECKS
  // ========================================================

  async function start() {
    const customText = (ui.customBox?.value || '').trim();
    
    if (customText) {
      // CHECK TIER-BASED ACCESS
      const access = checkCustomAccess();
      if (!access.allowed) {
        showTierUpgrade('daily_limit');
        return;
      }
      
      state.words = loadCustomWords(customText);
      t(ui.feedback, `Custom list loaded: ${state.words.length} words`);
      
      // TRACK USAGE
      trackUsage();
      
      // TRACK FOR ANALYTICS
      if (window.trackEvent) {
        window.trackEvent('custom_list_used', {
          mode: 'school',
          word_count: state.words.length,
          tier: window.tierManager?.currentTier || 'free'
        });
      }
    } else {
      t(ui.feedback, 'Loading school words...');
      state.words = await loadDefault();
      
      // Show content limit message for free users
      if (window.tierManager?.currentTier === 'free' && state.words.length <= 20) {
        t(ui.feedback, `Free school content: ${state.words.length} words. Upgrade for full vocabulary.`);
      } else {
        t(ui.feedback, `School words loaded: ${state.words.length} words`);
      }
    }

    if (!state.words.length) {
      t(ui.feedback, 'No words available. Please provide a word list.');
      return;
    }

    state.i = 0;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    state.active = true;
    
    if (ui.summary) ui.summary.style.display = 'none';
    
    showProgress();
    
    setTimeout(() => {
      speakCurrentWord();
    }, 1000);
  }

  function speakCurrentWord() {
    if (!state.active || state.i >= state.words.length) return;
    const word = state.words[state.i];
    if (word) {
      speakWord(word);
    }
  }

  function checkAnswer() {
    if (!state.active || state.i >= state.words.length) return;
    
    const target = state.words[state.i];
    const answer = (ui.area?.value || '').trim();

    if (!answer) {
      t(ui.feedback, 'Please type your answer before submitting.');
      return;
    }

    const isCorrect = norm(answer) === norm(target);
    
    if (isCorrect) {
      state.correct.push(target);
      t(ui.feedback, '✅ Correct!');
    } else {
      state.incorrect.push({ word: target, answer: answer });
      t(ui.feedback, `❌ Incorrect. The correct spelling is: ${target}`);
    }

    if (ui.area) ui.area.value = '';

    state.i++;
    if (state.i < state.words.length) {
      showProgress();
      setTimeout(speakCurrentWord, 1500);
    } else {
      endSession();
    }
  }

  function toggleFlag() {
    if (!state.active || state.i >= state.words.length) return;
    const word = state.words[state.i];
    if (state.flags.has(word)) {
      state.flags.delete(word);
      t(ui.feedback, `🚩 Removed flag from "${word}"`);
    } else {
      state.flags.add(word);
      t(ui.feedback, `🚩 Flagged "${word}" for review`);
    }
  }

  // ========================================================
  // ENHANCED END SESSION WITH TIER SUPPORT
  // ========================================================

  function saveSessionHistory() {
    const sessionData = {
      mode: 'school',
      words: state.words,
      correct: state.correct.length,
      incorrect: state.incorrect.length,
      date: new Date().toISOString(),
      score: state.words.length > 0 ? (state.correct.length / state.words.length * 100) : 0
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
    }
    
    // Save back to localStorage
    localStorage.setItem('practiceHistory', JSON.stringify(limitedHistory));
    
    return limitedHistory;
  }

  function endSession() {
    state.active = false;
    speechSynthesis.cancel();

    // Save session history with tier limits
    const history = saveSessionHistory();

    const total = state.words.length;
    const correctCount = state.correct.length;
    const incorrectCount = state.incorrect.length;
    const flaggedWords = [...state.flags];

    let summaryHTML = `
      <div style="background: rgba(0,0,0,0.05); padding: 20px; border-radius: 10px;">
        <h3 style="margin-top: 0; color: #7b2ff7;">Session Complete! 🎉</h3>
        <p style="font-size: 1.2em; font-weight: bold; color: #7b2ff7;">Score: ${correctCount}/${total} correct</p>
    `;

    if (state.incorrect.length > 0) {
      summaryHTML += `
        <div style="margin: 20px 0;">
          <h4 style="color: #f72585; margin-bottom: 10px;">❌ Incorrect Words (${state.incorrect.length})</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px;">
      `;
      
      state.incorrect.forEach(item => {
        summaryHTML += `
          <div style="background: rgba(247, 37, 133, 0.1); padding: 10px 15px; border-radius: 8px; border-left: 4px solid #f72585;">
            <strong style="color: #f72585;">${item.word}</strong><br>
            <small style="color: #666;">You typed: "${item.answer}"</small>
          </div>
        `;
      });
      
      summaryHTML += `</div></div>`;
    }

    if (flaggedWords.length > 0) {
      summaryHTML += `
        <div style="margin: 20px 0;">
          <h4 style="color: #ffd166; margin-bottom: 10px;">🚩 Flagged Words (${flaggedWords.length})</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
      `;
      
      flaggedWords.forEach(word => {
        summaryHTML += `
          <div style="background: rgba(255, 209, 102, 0.1); padding: 10px 15px; border-radius: 8px; border-left: 4px solid #ffd166;">
            ${word}
          </div>
        `;
      });
      
      summaryHTML += `</div></div>`;
    }

    if (state.incorrect.length === 0 && correctCount > 0) {
      summaryHTML += `
        <div style="margin: 20px 0; padding: 15px; background: rgba(76, 175, 80, 0.1); border-radius: 8px;">
          <h4 style="color: #4CAF50; margin-bottom: 10px;">✅ Perfect! All ${correctCount} words correct!</h4>
        </div>
      `;
    }

    summaryHTML += `
      <div style="text-align: center; margin-top: 25px;">
        <button onclick="restartTraining()" style="background: #7b2ff7; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 1rem;">
          🔄 Start New Session
        </button>
      </div>
    `;

    summaryHTML += `</div>`;
    
    if (ui.summary) {
      ui.summary.innerHTML = summaryHTML;
      ui.summary.style.display = 'block';
    }
    
    t(ui.feedback, `Session completed! Check results below.`);
    
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
        <i class="fa fa-history"></i> Recent School Sessions (${Math.min(history.length, limit)} shown)
      </h4>
      <div style="max-height: 150px; overflow-y: auto;">
        ${history.slice(0, limit).map(session => `
          <div style="padding: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); font-size: 0.9em;">
            <span style="color: #666;">${new Date(session.date).toLocaleDateString()}</span>
            <span style="float: right; font-weight: 600; color: ${session.score > 70 ? '#4CAF50' : '#f72585'}">
              ${session.score.toFixed(0)}% (${session.correct}/${session.words.length})
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
    
    if (ui.summary) {
      ui.summary.appendChild(preview);
    }
  }

  function restartTraining() {
    state.i = 0;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    if (ui.summary) ui.summary.style.display = 'none';
    if (ui.area) ui.area.value = '';
    t(ui.feedback, 'Ready to start new session');
    showProgress();
  }

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
    
    // Insert before the button group
    const buttonGroup = document.querySelector('.button-group');
    if (buttonGroup) {
      buttonGroup.parentNode.insertBefore(listCounter, buttonGroup);
    } else if (ui.feedback) {
      ui.feedback.parentNode.insertBefore(listCounter, ui.feedback.nextSibling);
    }
  }

  // ========================================================
  // UPDATED EVENT LISTENERS
  // ========================================================

  function setupEventListeners() {
    if (ui.start) ui.start.addEventListener('click', start);
    if (ui.submit) ui.submit.addEventListener('click', checkAnswer);
    if (ui.say) ui.say.addEventListener('click', speakCurrentWord);
    if (ui.flag) ui.flag.addEventListener('click', toggleFlag);
    if (ui.end) ui.end.addEventListener('click', endSession);

    if (ui.area) {
      ui.area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          checkAnswer();
        }
      });
    }

    if (ui.upload) {
      ui.upload.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // CHECK TIER-BASED ACCESS
        const access = checkCustomAccess();
        if (!access.allowed) {
          showTierUpgrade('daily_limit');
          e.target.value = ''; // Clear the file input
          return;
        }

        if (ui.fileName) ui.fileName.textContent = file.name;

        try {
          const text = await file.text();
          const words = loadCustomWords(text);
          state.words = words;
          t(ui.feedback, `Loaded ${words.length} words from file. Ready to start!`);
          
          // TRACK USAGE
          trackUsage();
          
          // TRACK FILE UPLOAD
          if (window.trackEvent) {
            window.trackEvent('file_upload', {
              mode: 'school',
              word_count: words.length,
              tier: window.tierManager?.currentTier || 'free'
            });
          }
        } catch (error) {
          t(ui.feedback, 'Error reading file. Please try again.');
        }
      });
    }

    if (ui.useCustom) {
      ui.useCustom.addEventListener('click', () => {
        const customText = (ui.customBox?.value || '').trim();
        if (!customText) {
          t(ui.feedback, 'Please enter words in the custom words box first.');
          return;
        }
        
        // CHECK TIER-BASED ACCESS
        const access = checkCustomAccess();
        if (!access.allowed) {
          showTierUpgrade('daily_limit');
          return;
        }
        
        const words = loadCustomWords(customText);
        state.words = words;
        t(ui.feedback, `Custom list loaded: ${words.length} words. Ready to start!`);
        
        // TRACK USAGE
        trackUsage();
      });
    }
  }

  function initializeSpeechSynthesis() {
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = function() {
        console.log("Voices loaded:", speechSynthesis.getVoices().length);
      };
    }
  }

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

  // ========================================================
  // ENHANCED INITIALIZATION WITH TIER SUPPORT
  // ========================================================

  function initialize() {
    setupEventListeners();
    initializeSpeechSynthesis();
    
    // Wait for tier manager to be ready
    const checkTierManager = setInterval(() => {
      if (window.tierManager) {
        clearInterval(checkTierManager);
        console.log('🎯 Tier manager loaded for School:', window.tierManager.currentTier);
        
        // Add custom list UI for free users
        addCustomListUI();
        
        // Set up tier change listener
        document.addEventListener('tierChange', (e) => {
          console.log('School: Tier changed to:', e.detail.tier);
          // Refresh UI
          addCustomListUI();
        });
      }
    }, 100);
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeDarkModeToggle);
    } else {
      initializeDarkModeToggle();
    }

    console.log('School Spelling Trainer ready - with tier management');
  }

  window.restartTraining = restartTraining;
  initialize();
})();
