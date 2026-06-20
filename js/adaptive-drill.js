// js/adaptive-drill.js - Premium Adaptive Drill Generator
class AdaptiveDrill {
  constructor() {
    this.weakCategories = {};
    this.init();
  }
  
  init() {
    // Only for premium users
    if (window.tierManager?.currentTier !== 'premium') return;
    
    this.analyzeWeaknesses();
    this.createUI();
  }
  
  analyzeWeaknesses() {
    const attempts = JSON.parse(localStorage.getItem('attempts') || '[]');
    
    // Group by category and calculate accuracy
    const categories = {};
    
    attempts.forEach(attempt => {
      const category = attempt.category || 'general';
      if (!categories[category]) {
        categories[category] = { correct: 0, total: 0 };
      }
      categories[category].total++;
      if (attempt.correct) {
        categories[category].correct++;
      }
    });
    
    // Calculate accuracy and sort
    this.weakCategories = Object.entries(categories)
      .map(([category, stats]) => ({
        category,
        accuracy: Math.round((stats.correct / stats.total) * 100),
        total: stats.total
      }))
      .sort((a, b) => a.accuracy - b.accuracy) // Sort by worst accuracy first
      .slice(0, 3); // Top 3 weakest
  }
  
  createUI() {
    // Check if UI already exists
    if (document.querySelector('.adaptive-drill-section')) return;
    
    const drillHTML = `
      <div class="adaptive-drill-section premium-feature" style="
        background: rgba(33, 150, 243, 0.1);
        border: 2px solid rgba(33, 150, 243, 0.3);
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
        
        <h3 style="color:var(--text,#1a0533);"><i class="fa fa-brain"></i> Adaptive Focus Drill</h3>
        <p style="opacity: 0.9; margin-bottom: 20px; color:var(--text,#1a0533);">
          AI-generated drill targeting your weakest spelling areas.
        </p>
        
        <!-- Weakness Analysis -->
        <div class="weakness-analysis" style="margin-bottom: 25px;">
          <h4 style="margin-bottom: 15px; color:var(--text,#1a0533);">
            <i class="fa fa-chart-pie"></i> Your Weakest Areas
          </h4>
          <div id="weaknessBars">
            <!-- Will be filled by analyzeWeaknesses -->
          </div>
        </div>
        
        <!-- Generate Drill Button -->
        <button id="generateDrill" style="
          width: 100%;
          background: linear-gradient(135deg, #2196F3, #21CBF3);
          color: white;
          border: none;
          padding: 15px;
          border-radius: 8px;
          font-size: 1.1rem;
          font-weight: bold;
          cursor: pointer;
          margin-bottom: 15px;
        ">
          <i class="fa fa-magic"></i> Generate Smart Drill
        </button>
        
        <!-- Drill Preview -->
        <div id="drillPreview" style="
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
          padding: 20px;
          margin-top: 20px;
          display: none;
        ">
          <h4 style="margin-bottom: 15px; color:var(--text,#1a0533);">
            <i class="fa fa-list-check"></i> Your Personalized Drill
          </h4>
          <div style="margin-bottom: 15px;">
            <div id="drillDescription" style="
              background: rgba(123, 47, 247, 0.2);
              padding: 10px 15px;
              border-radius: 8px;
              font-weight: bold;
              margin-bottom: 15px;
            "></div>
            
            <div style="margin-bottom: 15px;">
              <strong style="color:var(--text,#1a0533);">Focus Areas:</strong>
              <div id="focusAreas" style="
                display: flex;
                gap: 8px;
                margin-top: 5px;
                flex-wrap: wrap;
              "></div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <strong style="color:var(--text,#1a0533);">Words in this drill:</strong>
              <div id="drillWords" style="
                margin-top: 10px;
                max-height: 150px;
                overflow-y: auto;
                background: rgba(0,0,0,0.2);
                border-radius: 8px;
                padding: 10px;
              "></div>
            </div>
          </div>
          
          <div style="display: flex; gap: 10px;">
            <button id="startDrill" style="
              flex: 1;
              background: #4CAF50;
              color: white;
              border: none;
              padding: 12px;
              border-radius: 8px;
              font-weight: bold;
              cursor: pointer;
            ">
              <i class="fa fa-play"></i> Start Drill
            </button>
            <button id="regenerateDrill" style="
              background: rgba(255,255,255,0.1);
              color: white;
              border: none;
              padding: 12px 20px;
              border-radius: 8px;
              cursor: pointer;
            ">
              <i class="fa fa-redo"></i> Regenerate
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Insert after mistake review or custom words
    const target = document.querySelector('.mistake-review-section') || 
                   document.querySelector('.custom-words-area') ||
                   document.querySelector('.trainer-area');
    if (target) {
      target.insertAdjacentHTML('afterend', drillHTML);
      this.bindEvents();
      this.updateWeaknessDisplay();
    }
  }
  
  bindEvents() {
    document.getElementById('generateDrill')?.addEventListener('click', () => {
      this.generateDrill();
    });
    
    document.getElementById('startDrill')?.addEventListener('click', () => {
      this.startDrill();
    });
    
    document.getElementById('regenerateDrill')?.addEventListener('click', () => {
      this.generateDrill();
    });
  }
  
  updateWeaknessDisplay() {
    const container = document.getElementById('weaknessBars');
    if (!container) return;
    
    if (this.weakCategories.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; opacity: 0.7; color:var(--text,#1a0533);">
          <i class="fa fa-chart-line" style="font-size: 2rem; margin-bottom: 10px;"></i>
          <p>Complete a few practice sessions to see your weak areas.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = this.weakCategories.map(cat => `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span style="color:var(--text,#1a0533);">${this.formatCategoryName(cat.category)}</span>
          <span style="font-weight: bold; color: ${this.getAccuracyColor(cat.accuracy)}">
            ${cat.accuracy}%
          </span>
        </div>
        <div style="
          height: 10px;
          background: rgba(255,255,255,0.1);
          border-radius: 5px;
          overflow: hidden;
        ">
          <div style="
            width: ${cat.accuracy}%;
            height: 100%;
            background: ${this.getAccuracyColor(cat.accuracy)};
            transition: width 1s ease;
          "></div>
        </div>
        <div style="font-size: 0.8rem; opacity: 0.7; margin-top: 3px; color:var(--text,#1a0533);">
          ${cat.total} attempts
        </div>
      </div>
    `).join('');
  }
  
  formatCategoryName(category) {
    const names = {
      'oet': 'Medical Terms',
      'school': 'Academic Vocabulary',
      'bee': 'Spelling Bee',
      'custom': 'Custom Lists'
    };
    return names[category] || category;
  }
  
  getAccuracyColor(accuracy) {
    if (accuracy >= 80) return '#4CAF50';
    if (accuracy >= 60) return '#FFC107';
    return '#f44336';
  }
  
  generateDrill() {
    // Analyze weaknesses again
    this.analyzeWeaknesses();
    
    if (this.weakCategories.length === 0) {
      alert('Complete some practice sessions first to generate a personalized drill.');
      return;
    }
    
    // Generate drill based on weaknesses
    const drill = this.createDrill();
    
    // Update preview
    document.getElementById('drillDescription').textContent = 
      `20-word drill focusing on your ${this.weakCategories.length} weakest areas`;
    
    // Show focus areas
    const focusContainer = document.getElementById('focusAreas');
    focusContainer.innerHTML = this.weakCategories.map(cat => `
      <span style="
        background: ${this.getAccuracyColor(cat.accuracy)}20;
        color: ${this.getAccuracyColor(cat.accuracy)};
        padding: 4px 10px;
        border-radius: 15px;
        font-size: 0.9rem;
        border: 1px solid ${this.getAccuracyColor(cat.accuracy)}40;
      ">
        ${this.formatCategoryName(cat.category)}
      </span>
    `).join('');
    
    // Show words
    const wordsContainer = document.getElementById('drillWords');
    wordsContainer.innerHTML = drill.words.map((word, i) => `
      <div style="
        padding: 6px 10px;
        margin-bottom: 4px;
        background: rgba(255,255,255,0.05);
        border-radius: 5px;
        font-size: 0.9rem;
        display: flex;
        justify-content: space-between;
      ">
        <span style="color:var(--text,#1a0533);">${i + 1}. ${word}</span>
        <span style="opacity: 0.6; font-size: 0.8rem; color:var(--text,#1a0533);">
          ${this.getWordCategory(word)}
        </span>
      </div>
    `).join('');
    
    // Show preview
    document.getElementById('drillPreview').style.display = 'block';
    document.getElementById('generateDrill').style.display = 'none';
    
    // Store drill for starting
    this.currentDrill = drill;
  }
  
  getWordCategory(word) {
    // Simple categorization based on word patterns
    if (word.length > 12) return 'Long Words';
    if (word.includes('ph') || word.includes('psy')) return 'Medical';
    if (word.includes('ie') || word.includes('ei')) return 'Spelling Rules';
    if (word.includes('ough')) return 'Tricky Sounds';
    return 'General';
  }
  
  createDrill() {
    const drill = {
      name: `Focus Drill - ${new Date().toLocaleDateString()}`,
      categories: this.weakCategories.map(c => c.category),
      words: [],
      difficulty: 'adaptive'
    };
    
    // Get words from different sources based on weak categories
    this.weakCategories.forEach(category => {
      // Get words user has missed in this category
      const attempts = JSON.parse(localStorage.getItem('attempts') || '[]');
      const missedWords = attempts
        .filter(a => a.category === category.category && !a.correct)
        .map(a => a.word)
        .slice(0, 5); // Take up to 5 missed words
      
      drill.words.push(...missedWords);
    });
    
    // Fill remaining slots with challenging words
    const remaining = 20 - drill.words.length;
    if (remaining > 0) {
      const challengingWords = this.getChallengingWords(remaining);
      drill.words.push(...challengingWords);
    }
    
    // Shuffle and limit to 20
    drill.words = this.shuffleArray(drill.words).slice(0, 20);
    
    return drill;
  }
  
  getChallengingWords(count) {
    // Sample challenging words for each category
    const wordBanks = {
      'oet': ['anesthesiologist', 'cardiovascular', 'hematology', 'ophthalmology', 'gastroenterology'],
      'school': ['accommodate', 'conscience', 'embarrass', 'parallel', 'rhythm'],
      'bee': ['pneumonoultramicroscopicsilicovolcanoconiosis', 'antidisestablishmentarianism', 'floccinaucinihilipilification', 'supercalifragilisticexpialidocious'],
      'general': ['necessary', 'occurrence', 'privilege', 'recommend', 'separate']
    };
    
    const allWords = [];
    this.weakCategories.forEach(cat => {
      if (wordBanks[cat.category]) {
        allWords.push(...wordBanks[cat.category]);
      }
    });
    
    return this.shuffleArray(allWords).slice(0, count);
  }
  
  shuffleArray(array) {
    return [...array].sort(() => Math.random() - 0.5);
  }
  
  startDrill() {
    if (!this.currentDrill) return;
    
    // Set as current custom list
    const listName = this.currentDrill.name;
    if (!window.customLists) window.customLists = {};
    
    window.customLists[listName] = {
      words: this.currentDrill.words,
      createdAt: new Date().toISOString(),
      wordCount: this.currentDrill.words.length,
      type: 'adaptive_drill'
    };
    
    localStorage.setItem('premiumCustomLists', JSON.stringify(window.customLists));
    
    // Load the drill
    if (typeof window.loadCustomList === 'function') {
      window.loadCustomList(listName);
    }
    
    // Switch to appropriate mode (use first category or general)
    const primaryCategory = this.weakCategories[0]?.category || 'school';
    const modeBtn = document.querySelector(`.mode-btn[data-mode="${primaryCategory}"]`);
    if (modeBtn) {
      modeBtn.click();
      
      // Start training after a delay
      setTimeout(() => {
        const startBtn = document.getElementById(`${primaryCategory}Start`);
        if (startBtn) {
          startBtn.click();
        }
      }, 1000);
    }
    
    // Track drill started
    window.trackEvent('adaptive_drill_started', {
      categories: this.weakCategories.map(c => c.category),
      word_count: this.currentDrill.words.length
    });
  }
}

window.AdaptiveDrill = AdaptiveDrill;
