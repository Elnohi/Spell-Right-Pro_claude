/* /js/main-freemium-oet.js - COMPLETE WITH TIER MANAGEMENT */
(() => {
  const $ = s => document.querySelector(s);
  const ui = {
    area: $('#answer'),
    submit: $('#btnSubmit'),
    upload: $('#fileInput'),
    start: $('#btnStart'),
    say: $('#btnSayAgain'),
    previous: $('#btnPrevious'),
    flag: $('#btnFlag'),
    end: $('#btnEnd'),
    progress: $('#progress'),
    feedback: $('#feedback'),
    customBox: $('#customWords'),
    useCustom: $('#useCustomList'),
    fileName: $('#fileName'),
    summary: $('.summary-area'),
    tabExam: $('#tabExam'),
    tabPractice: $('#tabPractice'),
    accentSelect: $('#oetAccent'),
    resumeIncorrect: $('#btnResumeIncorrect'),
    resumeFlagged: $('#btnResumeFlagged'),
    resumeFrom: $('#btnResumeFrom')
  };

  const state = { 
    words: [], 
    i: 0, 
    correct: [], 
    incorrect: [], 
    flags: new Set(), 
    active: false,
    isExam: false,
    history: [],
    sessionKey: 'spellrightpro_oet_session'
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
      oet_content: '🔒 Full OET content requires Premium access.'
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
          oet_content: 'premiumContent'
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
      <small>Get unlimited custom lists, all OET content, and advanced features</small><br>
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

  function t(el, s) { if(el) el.textContent = s; }
  function norm(s) { return (s||'').toLowerCase().trim().replace(/[^\p{L}]+/gu, ''); }
  
  function showProgress() { 
    t(ui.progress, `Word ${Math.min(state.i + 1, state.words.length)} of ${state.words.length}`); 
  }

  function randomPick(arr, n) {
    if (arr.length <= n) return [...arr];
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  // Save session state to localStorage
  function saveSessionState() {
    const sessionData = {
      words: state.words,
      currentIndex: state.i,
      correct: state.correct,
      incorrect: state.incorrect,
      flags: Array.from(state.flags),
      isExam: state.isExam,
      timestamp: Date.now()
    };
    localStorage.setItem(state.sessionKey, JSON.stringify(sessionData));
  }

  // Load session state from localStorage
  function loadSessionState() {
    try {
      const saved = localStorage.getItem(state.sessionKey);
      if (!saved) return null;
      
      const sessionData = JSON.parse(saved);
      
      // Check if session is less than 24 hours old
      const hoursOld = (Date.now() - sessionData.timestamp) / (1000 * 60 * 60);
      
      // Apply tier-based limits
      if (window.tierManager?.currentTier === 'free' && hoursOld > 24) {
        localStorage.removeItem(state.sessionKey);
        return null;
      }
      
      // Premium users have unlimited session history
      return sessionData;
    } catch (error) {
      console.error('Error loading session:', error);
      return null;
    }
  }

  // Clear saved session
  function clearSessionState() {
    localStorage.removeItem(state.sessionKey);
  }

  async function loadOETWords() {
    try {
      console.log("Loading OET words from external file...");
      
      if (typeof window.OET_WORDS !== 'undefined' && Array.isArray(window.OET_WORDS)) {
        console.log("Found OET_WORDS in global scope:", window.OET_WORDS.length, "words");
        
        // Apply tier-based content limits
        if (window.tierManager?.currentTier === 'free') {
          // Free users get limited OET content
          const freeCategories = ['Medicine', 'Surgery']; // Example limited categories
          const limitedWords = window.OET_WORDS.filter(word => 
            freeCategories.some(category => word.category === category)
          ).slice(0, 50); // Limit to 50 words
          
          console.log("Free tier: Limited to", limitedWords.length, "words");
          return limitedWords;
        }
        
        return window.OET_WORDS;
      }
      
      const script = document.createElement('script');
      script.src = '/js/oet_word_list.js?v=' + Date.now();
      
      return new Promise((resolve, reject) => {
        script.onload = () => {
          console.log("OET words script loaded successfully");
          if (typeof window.OET_WORDS !== 'undefined' && Array.isArray(window.OET_WORDS)) {
            console.log("OET words loaded:", window.OET_WORDS.length, "words");
            
            // Apply tier-based content limits
            if (window.tierManager?.currentTier === 'free') {
              const freeCategories = ['Medicine', 'Surgery'];
              const limitedWords = window.OET_WORDS.filter(word => 
                freeCategories.some(category => word.category === category)
              ).slice(0, 50);
              
              console.log("Free tier: Limited to", limitedWords.length, "words");
              resolve(limitedWords);
            } else {
              resolve(window.OET_WORDS);
            }
          } else {
            reject(new Error('OET_WORDS not found in loaded file'));
          }
        };
        
        script.onerror = () => {
          reject(new Error('Failed to load OET words script'));
        };
        
        document.head.appendChild(script);
      });
      
    } catch (error) {
      console.error("Failed to load OET words:", error);
      const fallbackWords = [
        'abdomen', 'anemia', 'antibiotic', 'artery', 'asthma', 'biopsy', 'catheter', 
        'diagnosis', 'embolism', 'fracture', 'gastroenterology', 'hemorrhage', 'intravenous', 
        'jaundice', 'kidney', 'laceration', 'membrane', 'neurology', 'obstetrics', 'pulmonary'
      ];
      console.log("Using fallback OET words:", fallbackWords.length, "words");
      return fallbackWords;
    }
  }

  function loadCustomWords(text) {
    try {
      const j = JSON.parse(text);
      return Array.isArray(j?.words) ? j.words : (Array.isArray(j) ? j : []);
    } catch(_) {
      return text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }
  }

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
      
      const selectedAccent = ui.accentSelect ? ui.accentSelect.value : 'en-US';
      utterance.lang = selectedAccent;
      
      const voices = speechSynthesis.getVoices();
      let preferredVoice = null;
      
      if (voices.length > 0) {
        preferredVoice = voices.find(voice => voice.lang === selectedAccent);
        
        if (!preferredVoice) {
          const baseLang = selectedAccent.split('-')[0];
          preferredVoice = voices.find(voice => voice.lang.startsWith(baseLang));
        }
        
        if (!preferredVoice) {
          preferredVoice = voices.find(voice => voice.lang.includes('en')) || voices[0];
        }
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }
      
      utterance.onend = function() {
        console.log("Finished speaking:", word, "with accent:", selectedAccent);
      };
      
      utterance.onerror = function(event) {
        // 'interrupted' fires after speechSynthesis.cancel() — not a real error
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        if (event.error === 'not-allowed') {
          t(ui.feedback, '⚠️ Audio blocked. Click "Allow" in browser and try again.');
          return;
        }
        console.error("Speech synthesis error:", event);
        t(ui.feedback, "Error speaking word");
      };
      
      speechSynthesis.speak(utterance);
      t(ui.feedback, `Speaking with ${getAccentName(selectedAccent)} accent...`);
      
    } catch (error) {
      console.error("Speech error:", error);
      t(ui.feedback, "Could not speak word");
    }
  }

  function getAccentName(accentCode) {
    const accentMap = {
      'en-US': 'American',
      'en-GB': 'British', 
      'en-AU': 'Australian',
      'en-CA': 'Canadian'
    };
    return accentMap[accentCode] || accentCode;
  }

  // Go to previous word
  function goToPreviousWord() {
    if (!state.active || state.i <= 0) {
      t(ui.feedback, "No previous word available");
      return;
    }
    
    // Store current position in history
    if (state.history.length < 10) {
      state.history.push(state.i);
    }
    
    // Go to previous word
    state.i--;
    
    // If we were at the end of the list and had submitted all words
    // we need to remove the last correct/incorrect entry
    if (state.i < state.words.length - 1) {
      const lastWord = state.words[state.i + 1];
      
      // Remove from correct array if it was there
      const correctIndex = state.correct.indexOf(lastWord);
      if (correctIndex > -1) {
        state.correct.splice(correctIndex, 1);
      }
      
      // Remove from incorrect array if it was there
      const incorrectIndex = state.incorrect.findIndex(item => item.word === lastWord);
      if (incorrectIndex > -1) {
        state.incorrect.splice(incorrectIndex, 1);
      }
    }
    
    showProgress();
    speakCurrentWord();
    if (ui.area) ui.area.value = '';
    t(ui.feedback, `← Went back to word ${state.i + 1}`);
    
    saveSessionState();
  }

  // Resume session from saved state
  function resumeSession() {
    const sessionData = loadSessionState();
    if (!sessionData) {
      t(ui.feedback, "No saved session found. Starting fresh.");
      return false;
    }
    
    const resume = confirm(`You have a saved session with ${sessionData.words.length} words.\nResume from word ${sessionData.currentIndex + 1}?`);
    
    if (resume) {
      state.words = sessionData.words;
      state.i = sessionData.currentIndex;
      state.correct = sessionData.correct;
      state.incorrect = sessionData.incorrect;
      state.flags = new Set(sessionData.flags);
      state.isExam = sessionData.isExam;
      state.active = true;
      
      // Update UI
      if (state.isExam) {
        if (ui.tabExam) ui.tabExam.classList.add('active');
        if (ui.tabPractice) ui.tabPractice.classList.remove('active');
      } else {
        if (ui.tabPractice) ui.tabPractice.classList.add('active');
        if (ui.tabExam) ui.tabExam.classList.remove('active');
      }
      
      showProgress();
      speakCurrentWord();
      t(ui.feedback, `✅ Resumed session from word ${state.i + 1}`);
      
      return true;
    }
    
    return false;
  }

  // Start specific type of practice
  function startSpecificPractice(words, type) {
    if (!words || words.length === 0) {
      t(ui.feedback, `No ${type} words to practice`);
      return;
    }
    
    state.words = words;
    state.i = 0;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    state.active = true;
    
    if (ui.summary) ui.summary.style.display = 'none';
    if (ui.area) ui.area.value = '';
    
    showProgress();
    t(ui.feedback, `Practicing ${words.length} ${type} words`);
    
    setTimeout(() => {
      speakCurrentWord();
    }, 1000);
  }

  // ========================================================
  // UPDATED START SESSION WITH TIER CHECKS
  // ========================================================

  async function startSession() {
    // Check for existing session
    if (resumeSession()) {
      return;
    }
    
    const customText = (ui.customBox?.value || '').trim();
    let wordList = [];
    
    if (customText) {
      // CHECK TIER-BASED ACCESS
      const access = checkCustomAccess();
      if (!access.allowed) {
        showTierUpgrade('daily_limit');
        return;
      }
      
      wordList = loadCustomWords(customText);
      t(ui.feedback, `Using custom list: ${wordList.length} words`);
      
      // TRACK USAGE
      trackUsage();
      
      // TRACK FOR ANALYTICS
      if (window.trackEvent) {
        window.trackEvent('custom_list_used', {
          mode: 'oet',
          word_count: wordList.length,
          tier: window.tierManager?.currentTier || 'free'
        });
      }
    } else {
      t(ui.feedback, 'Loading OET words...');
      wordList = await loadOETWords();
      
      // Show content limit message for free users
      if (window.tierManager?.currentTier === 'free' && wordList.length < 100) {
        t(ui.feedback, `Free OET content loaded: ${wordList.length} words. Upgrade for full medical vocabulary.`);
      } else {
        t(ui.feedback, `Loaded OET words: ${wordList.length} words`);
      }
    }

    if (!wordList.length) {
      t(ui.feedback, 'No words available. Please provide a word list.');
      return;
    }

    if (state.isExam) {
      state.words = randomPick(wordList, 24);
      t(ui.feedback, `Exam mode: ${state.words.length} random words selected`);
    } else {
      state.words = [...wordList];
      t(ui.feedback, `Practice mode: All ${state.words.length} words loaded`);
    }

    state.i = 0;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    state.history = [];
    state.active = true;

    if (ui.summary) ui.summary.style.display = 'none';
    if (ui.area) ui.area.value = '';

    showProgress();
    
    // Save initial state
    saveSessionState();
    
    setTimeout(() => {
      speakCurrentWord();
    }, 1000);
  }

  function speakCurrentWord() {
    if (!state.active || state.i >= state.words.length) return;
    const word = state.words[state.i];
    if (word) speakWord(word);
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
    
    // Save progress after each answer
    saveSessionState();
    
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
    saveSessionState();
  }

  // ========================================================
  // ENHANCED END SESSION WITH TIER SUPPORT
  // ========================================================

  function saveSessionHistory() {
    const sessionData = {
      mode: 'oet',
      words: state.words,
      correct: state.correct.length,
      incorrect: state.incorrect.length,
      date: new Date().toISOString(),
      score: state.words.length > 0 ? (state.correct.length / state.words.length * 100) : 0,
      isExam: state.isExam
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
    
    // Clear saved session when completed
    clearSessionState();

    const total = state.words.length;
    const correctCount = state.correct.length;
    const incorrectCount = state.incorrect.length;
    const flaggedWords = [...state.flags];

    let summaryHTML = `
      <div style="background: rgba(0,0,0,0.05); padding: 20px; border-radius: 10px;">
        <h3 style="margin-top: 0; color: #7b2ff7;">OET Session Complete! 🎉</h3>
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

    // Add resume options if there are incorrect or flagged words
    if (state.incorrect.length > 0 || flaggedWords.length > 0) {
      summaryHTML += `
        <div id="resumeOptions" style="margin: 30px 0; padding: 20px; background: rgba(123, 47, 247, 0.05); border-radius: 10px; border: 1px dashed rgba(123, 47, 247, 0.3);">
          <h4 style="color: #7b2ff7; margin-bottom: 15px;">📚 Continue Practicing</h4>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
      `;
      
      if (state.incorrect.length > 0) {
        summaryHTML += `
          <button onclick="practiceIncorrectWords()" class="nav-btn" style="background: #f72585; color: white; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer;">
            <i class="fa fa-redo"></i> Practice Incorrect (${state.incorrect.length})
          </button>
        `;
      }
      
      if (flaggedWords.length > 0) {
        summaryHTML += `
          <button onclick="practiceFlaggedWords()" class="nav-btn" style="background: #ffd166; color: #333; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer;">
            <i class="fa fa-flag"></i> Practice Flagged (${flaggedWords.length})
          </button>
        `;
      }
      
      summaryHTML += `
            <button onclick="restartOETTraining()" class="nav-btn" style="background: #7b2ff7; color: white; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer;">
              <i class="fa fa-play-circle"></i> New Full Session
            </button>
          </div>
          <p style="margin-top: 10px; font-size: 0.9em; color: #666;">Or specify word number: <input type="number" id="resumeFromNumber" min="1" max="${state.words.length}" value="1" style="width: 60px; padding: 5px;"> <button onclick="resumeFromSpecificWord()" style="background: #7b2ff7; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Go</button></p>
        </div>
      `;
    }

    summaryHTML += `
      <div style="text-align: center; margin-top: 25px;">
        <button onclick="restartOETTraining()" style="background: #7b2ff7; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 1rem;">
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
        <i class="fa fa-history"></i> Recent OET Sessions (${Math.min(history.length, limit)} shown)
      </h4>
      <div style="max-height: 150px; overflow-y: auto;">
        ${history.slice(0, limit).map(session => `
          <div style="padding: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); font-size: 0.9em;">
            <span style="color: #666;">${new Date(session.date).toLocaleDateString()} - ${session.isExam ? 'Exam' : 'Practice'}</span>
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

  // Practice only incorrect words
  function practiceIncorrectWords() {
    const incorrectWords = state.incorrect.map(item => item.word);
    startSpecificPractice(incorrectWords, 'incorrect');
  }

  // Practice only flagged words
  function practiceFlaggedWords() {
    const flaggedWords = Array.from(state.flags);
    startSpecificPractice(flaggedWords, 'flagged');
  }

  // Resume from specific word number
  function resumeFromSpecificWord() {
    const input = document.getElementById('resumeFromNumber');
    if (!input) return;
    
    const wordNumber = parseInt(input.value);
    if (isNaN(wordNumber) || wordNumber < 1 || wordNumber > state.words.length) {
      t(ui.feedback, `Please enter a number between 1 and ${state.words.length}`);
      return;
    }
    
    // Start from the specified word (subtract 1 for zero-based index)
    state.i = wordNumber - 1;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    state.active = true;
    
    if (ui.summary) ui.summary.style.display = 'none';
    if (ui.area) ui.area.value = '';
    
    showProgress();
    speakCurrentWord();
    t(ui.feedback, `Resumed from word ${wordNumber}`);
  }

  function restartOETTraining() {
    clearSessionState();
    state.i = 0;
    state.correct = [];
    state.incorrect = [];
    state.flags.clear();
    state.history = [];
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
    if (ui.start) ui.start.addEventListener('click', startSession);
    if (ui.submit) ui.submit.addEventListener('click', checkAnswer);
    if (ui.say) ui.say.addEventListener('click', speakCurrentWord);
    if (ui.previous) ui.previous.addEventListener('click', goToPreviousWord);
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
              mode: 'oet',
              word_count: words.length,
              tier: window.tierManager?.currentTier || 'free'
            });
          }
        } catch (error) {
          t(ui.feedback, 'Error reading file. Please try again.');
        }
      });
    }

    if (ui.tabExam) {
      ui.tabExam.addEventListener('click', () => {
        state.isExam = true;
        ui.tabExam.classList.add('active');
        if (ui.tabPractice) ui.tabPractice.classList.remove('active');
        t(ui.feedback, 'Exam mode selected (24 random words)');
      });
    }

    if (ui.tabPractice) {
      ui.tabPractice.addEventListener('click', () => {
        state.isExam = false;
        ui.tabPractice.classList.add('active');
        if (ui.tabExam) ui.tabExam.classList.remove('active');
        t(ui.feedback, 'Practice mode selected (full word list)');
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

    if (ui.accentSelect) {
      ui.accentSelect.addEventListener('change', function() {
        const accentName = getAccentName(this.value);
        t(ui.feedback, `Accent changed to ${accentName}. Next word will use this accent.`);
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
        console.log('🎯 Tier manager loaded for OET:', window.tierManager.currentTier);
        
        // Add custom list UI for free users
        addCustomListUI();
        
        // Check for saved session
        const savedSession = loadSessionState();
        if (savedSession) {
          console.log('Saved session found, ready to resume');
          // Show resume option with tier context
          const tier = window.tierManager.currentTier;
          const limitMsg = tier === 'free' ? ' (24-hour limit for free users)' : '';
          t(ui.feedback, `You have a saved session${limitMsg}. Click "Start" to resume from word ${savedSession.currentIndex + 1}.`);
        }
        
        // Set up tier change listener
        document.addEventListener('tierChange', (e) => {
          console.log('OET: Tier changed to:', e.detail.tier);
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

    if (ui.tabPractice) {
      ui.tabPractice.classList.add('active');
      state.isExam = false;
    }

    // Expose functions to global scope
    window.restartOETTraining = restartOETTraining;
    window.practiceIncorrectWords = practiceIncorrectWords;
    window.practiceFlaggedWords = practiceFlaggedWords;
    window.resumeFromSpecificWord = resumeFromSpecificWord;

    console.log('OET Spelling Trainer ready - with tier management');
  }

  initialize();
})();
