// js/mistake-review.js - Premium Mistake Review with Spaced Repetition
class MistakeReview {
  constructor() {
    this.mistakes = JSON.parse(localStorage.getItem('mistakeBank') || '[]');
    this.schedule = this.loadSchedule();
    this.init();
  }
  
  init() {
    // Only initialize for premium users
    if (window.tierManager?.currentTier !== 'premium') return;
    
    this.createUI();
    this.loadDueReviews();
  }
  
  createUI() {
    // Check if UI already exists
    if (document.querySelector('.mistake-review-section')) return;
    
    const mistakeHTML = `
      <div class="mistake-review-section premium-feature" style="
        background: rgba(244, 67, 54, 0.1);
        border: 2px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--radius);
        padding: 25px;
        margin: 25px 0;
        position: relative;
      ">
        <div class="premium-badge" style="
          position: absolute;
          top: -10px;
          right: 20px;
          background: #7b2ff7;
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 0.8rem;
          font-weight: bold;
        ">PREMIUM</div>
        
        <h3 style="color:var(--text,#1a0533);"><i class="fa fa-exclamation-circle"></i> Review Your Mistakes</h3>
        <p style="opacity: 0.9; margin-bottom: 20px; color:var(--text,#1a0533);">
          AI-powered review of words you've misspelled. Uses spaced repetition to help you remember.
        </p>
        
        <!-- Stats -->
        <div class="mistake-stats" style="
          display: flex;
          gap: 20px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        ">
          <div style="
            background: rgba(255,255,255,0.1);
            padding: 10px 15px;
            border-radius: 8px;
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: bold; color: #f44336;" id="dueCount">0</div>
            <div style="font-size: 0.9rem; opacity: 0.8; color:var(--text,#1a0533);">Due Now</div>
          </div>
          
          <div style="
            background: rgba(255,255,255,0.1);
            padding: 10px 15px;
            border-radius: 8px;
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: bold; color: #FFC107;" id="totalMistakes">0</div>
            <div style="font-size: 0.9rem; opacity: 0.8; color:var(--text,#1a0533);">Total Mistakes</div>
          </div>
          
          <div style="
            background: rgba(255,255,255,0.1);
            padding: 10px 15px;
            border-radius: 8px;
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: bold; color: #4CAF50;" id="masteredCount">0</div>
            <div style="font-size: 0.9rem; opacity: 0.8; color:var(--text,#1a0533);">Mastered</div>
          </div>
        </div>
        
        <!-- Review Interface -->
        <div id="reviewInterface" style="display: none;">
          <div style="
            background: rgba(255,255,255,0.05);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 15px;
          ">
            <div style="
              font-size: 1.2rem;
              font-weight: bold;
              margin-bottom: 10px;
              color: var(--text,#1a0533);
            " id="reviewWord"></div>
            <div style="
              font-size: 0.9rem;
              opacity: 0.8;
              margin-bottom: 15px;
              color: var(--text,#1a0533);
            ">
              Missed on: <span id="missedDate"></span>
            </div>
            
            <input type="text" 
                   id="reviewInput" 
                   placeholder="Spell the word correctly..."
                   style="
                     width: 100%;
                     padding: 12px;
                     border-radius: 8px;
                     border: 2px solid rgba(255,255,255,0.2);
                     background: rgba(255,255,255,0.1);
                     color: white;
                     font-size: 1rem;
                     margin-bottom: 15px;
                   ">
            
            <div class="review-buttons" style="display: flex; gap: 10px;">
              <button id="submitReview" style="
                flex: 1;
                background: #4CAF50;
                color: white;
                border: none;
                padding: 12px;
                border-radius: 8px;
                font-weight: bold;
                cursor: pointer;
              ">
                <i class="fa fa-check"></i> Submit
              </button>
              <button id="skipReview" style="
                background: rgba(255,255,255,0.1);
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 8px;
                cursor: pointer;
              ">
                <i class="fa fa-forward"></i> Skip
              </button>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 10px;">
            <span id="reviewProgress" style="color:var(--text,#1a0533);">0/0</span>
          </div>
        </div>
        
        <!-- Start Review Button -->
        <div id="startReviewSection">
          <button id="startReview" style="
            width: 100%;
            background: linear-gradient(135deg, #7b2ff7, #f107a3);
            color: white;
            border: none;
            padding: 15px;
            border-radius: 8px;
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s ease;
          ">
            <i class="fa fa-play-circle"></i> Start Mistake Review Session
          </button>
          
          <div style="text-align: center; margin-top: 15px; opacity: 0.7; color:var(--text,#1a0533);">
            <small>Session length: 10 words • Estimated time: 5 minutes</small>
          </div>
        </div>
        
        <!-- Mistake List -->
        <div style="margin-top: 25px;">
          <h4 style="margin-bottom: 15px; color:var(--text,#1a0533);">
            <i class="fa fa-history"></i> Recent Mistakes
          </h4>
          <div id="recentMistakes" style="
            max-height: 200px;
            overflow-y: auto;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            padding: 10px;
          ">
            <!-- Mistakes will be listed here -->
          </div>
        </div>
      </div>
    `;
    
    // Insert after the custom words section or before the first trainer area
    const target = document.querySelector('.custom-words-area') || 
                   document.querySelector('.trainer-area');
    if (target) {
      target.insertAdjacentHTML('afterend', mistakeHTML);
      this.bindEvents();
      this.updateStats();
      this.loadRecentMistakes();
    }
  }
  
  bindEvents() {
    document.getElementById('startReview')?.addEventListener('click', () => {
      this.startReviewSession();
    });
    
    document.getElementById('submitReview')?.addEventListener('click', () => {
      this.checkReviewAnswer();
    });
    
    document.getElementById('skipReview')?.addEventListener('click', () => {
      this.nextReview();
    });
    
    document.getElementById('reviewInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.checkReviewAnswer();
      }
    });
  }
  
  loadSchedule() {
    return JSON.parse(localStorage.getItem('mistakeSchedule') || '{}');
  }
  
  loadDueReviews() {
    const now = Date.now();
    return this.mistakes.filter(mistake => {
      const nextReview = this.schedule[mistake.word] || 0;
      return nextReview <= now;
    });
  }
  
  updateStats() {
    const due = this.loadDueReviews().length;
    const total = this.mistakes.length;
    const mastered = this.mistakes.filter(m => this.schedule[m.word] > Date.now() + 30 * 24 * 60 * 60 * 1000).length;
    
    document.getElementById('dueCount').textContent = due;
    document.getElementById('totalMistakes').textContent = total;
    document.getElementById('masteredCount').textContent = mastered;
  }
  
  loadRecentMistakes() {
    const container = document.getElementById('recentMistakes');
    if (!container) return;
    
    const recent = [...this.mistakes]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);
    
    if (recent.length === 0) {
      container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 20px; color:var(--text,#1a0533);">No mistakes yet. Keep practicing!</p>';
      return;
    }
    
    container.innerHTML = recent.map(mistake => `
      <div style="
        padding: 8px 12px;
        margin-bottom: 5px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span style="font-weight: bold; color:var(--text,#1a0533);">${mistake.word}</span>
        <span style="font-size: 0.8rem; opacity: 0.7; color:var(--text,#1a0533);">
          ${new Date(mistake.timestamp).toLocaleDateString()}
        </span>
      </div>
    `).join('');
  }
  
  startReviewSession() {
    const due = this.loadDueReviews();
    if (due.length === 0) {
      alert('No mistakes to review right now. Great job!');
      return;
    }
    
    // Hide start button, show review interface
    document.getElementById('startReviewSection').style.display = 'none';
    document.getElementById('reviewInterface').style.display = 'block';
    
    // Start with first word
    this.currentReviewIndex = 0;
    this.reviewWords = due.slice(0, 10); // Limit to 10 words per session
    this.showReviewWord();
  }
  
  showReviewWord() {
    if (this.currentReviewIndex >= this.reviewWords.length) {
      this.endReviewSession();
      return;
    }
    
    const mistake = this.reviewWords[this.currentReviewIndex];
    const progress = `${this.currentReviewIndex + 1}/${this.reviewWords.length}`;
    
    document.getElementById('reviewWord').textContent = mistake.word;
    document.getElementById('missedDate').textContent = 
      new Date(mistake.timestamp).toLocaleDateString();
    document.getElementById('reviewProgress').textContent = progress;
    document.getElementById('reviewInput').value = '';
    document.getElementById('reviewInput').focus();
  }
  
  checkReviewAnswer() {
    const input = document.getElementById('reviewInput').value.trim().toLowerCase();
    const currentWord = this.reviewWords[this.currentReviewIndex].word.toLowerCase();
    
    if (input === currentWord) {
      // Correct - move to next interval
      this.recordCorrect(this.reviewWords[this.currentReviewIndex].word);
      this.showFeedback('✅ Correct! Well done!', 'success');
    } else {
      // Incorrect - repeat sooner
      this.recordIncorrect(this.reviewWords[this.currentReviewIndex].word);
      this.showFeedback(`❌ Incorrect. The word is: ${currentWord}`, 'error');
    }
    
    setTimeout(() => {
      this.currentReviewIndex++;
      this.showReviewWord();
    }, 1500);
  }
  
  recordCorrect(word) {
    // Spaced repetition algorithm (simplified Leitner system)
    const currentInterval = this.schedule[word] || 0;
    const now = Date.now();
    
    if (currentInterval === 0) {
      // First correct - review in 1 day
      this.schedule[word] = now + 24 * 60 * 60 * 1000;
    } else if (currentInterval < now + 7 * 24 * 60 * 60 * 1000) {
      // Move to next interval (1 day -> 3 days -> 1 week -> 1 month)
      const intervals = [1, 3, 7, 30]; // days
      const currentLevel = intervals.findIndex(d => 
        currentInterval <= now + d * 24 * 60 * 60 * 1000
      );
      const nextLevel = Math.min(currentLevel + 1, intervals.length - 1);
      this.schedule[word] = now + intervals[nextLevel] * 24 * 60 * 60 * 1000;
    } else {
      // Already at max interval (1 month)
      this.schedule[word] = now + 30 * 24 * 60 * 60 * 1000;
    }
    
    localStorage.setItem('mistakeSchedule', JSON.stringify(this.schedule));
  }
  
  recordIncorrect(word) {
    // Reset to review in 1 hour
    this.schedule[word] = Date.now() + 60 * 60 * 1000;
    localStorage.setItem('mistakeSchedule', JSON.stringify(this.schedule));
  }
  
  nextReview() {
    this.currentReviewIndex++;
    this.showReviewWord();
  }
  
  endReviewSession() {
    document.getElementById('startReviewSection').style.display = 'block';
    document.getElementById('reviewInterface').style.display = 'none';
    this.updateStats();
    this.loadRecentMistakes();
    
    this.showFeedback('Review session complete!', 'success');
  }
  
  showFeedback(message, type) {
    // Use existing feedback system or create new one
    const feedback = document.createElement('div');
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      background: ${type === 'success' ? '#4CAF50' : '#f44336'};
      color: white;
      font-weight: bold;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    feedback.textContent = message;
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.remove();
    }, 3000);
  }
  
  // Call this from main-premium.js when a word is missed
  addMistake(word, mode) {
    const existing = this.mistakes.find(m => m.word === word);
    
    if (!existing) {
      this.mistakes.push({
        word: word,
        mode: mode,
        timestamp: new Date().toISOString(),
        count: 1
      });
    } else {
      existing.timestamp = new Date().toISOString();
      existing.count++;
    }
    
    localStorage.setItem('mistakeBank', JSON.stringify(this.mistakes));
    this.updateStats();
    this.loadRecentMistakes();

    // Sync to Firestore for cross-device access (fire-and-forget)
    if (window.firebaseUtils && window.firebaseUtils.initialized && window.currentUser) {
      window.firebaseUtils.saveMistakeBank(
        window.currentUser.uid,
        this.mistakes,
        this.schedule
      );
    }
  }
}

window.MistakeReview = MistakeReview;
