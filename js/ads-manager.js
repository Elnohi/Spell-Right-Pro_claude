// /js/ads-manager.js - New file
(() => {
  'use strict';
  
  const adManager = {
    // Ad placements
    placements: [
      {
        id: 'header-ad',
        selector: 'header',
        position: 'afterend',
        format: 'horizontal',
        maxWidth: 728,
        maxHeight: 90
      },
      {
        id: 'post-practice-ad',
        selector: '.summary-area',
        position: 'beforebegin',
        format: 'rectangle',
        maxWidth: 300,
        maxHeight: 250,
        condition: () => {
          // Only show after completing a practice session
          return document.querySelector('.summary-area') && 
                 document.querySelector('.summary-area').style.display !== 'none';
        }
      },
      {
        id: 'footer-ad',
        selector: 'footer',
        position: 'beforebegin',
        format: 'horizontal',
        maxWidth: 728,
        maxHeight: 90
      }
    ],
    
    // AdSense policy: show ads only on pages with substantial publisher content.
    // Interactive practice screens, policy/contact pages and hub pages are excluded.
    contentPages: [
      '/', '/index', '/index.html',
      '/oet-spelling-guide', '/school-spelling-guide', '/spelling-bee-guide',
      '/oet-abbreviations', '/oet-referral-letter-guide', '/oet-vs-ielts',
      '/british-american-spelling-oet',
      '/commonly-confused-medical-words', '/oet-spelling-study-plan', '/spelling-bee-word-roots'
    ],
    isContentPage: function() {
      const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
      return this.contentPages.includes(path);
    },

    // Initialize ads
    init: function() {
      if (!this.isContentPage()) return;
      // Check if ads should be shown
      if (!this.shouldShowAds()) {
        console.log('🔕 Ads disabled for premium user');
        return;
      }
      
      console.log('🤑 Loading ads for freemium user...');
      
      // Load AdSense script
      this.loadAdSenseScript();
      
      // Wait for page to load
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.placeAds());
      } else {
        this.placeAds();
      }
    },
    
    // Check if ads should be shown
    shouldShowAds: function() {
      // Check tier
      if (window.tierManager?.currentTier === 'premium') {
        return false;
      }
      
      // Check cookie consent
      if (localStorage.getItem('cookieConsent') === 'false') {
        return false;
      }
      
      return true;
    },
    
    // Load AdSense script
    loadAdSenseScript: function() {
      if (document.querySelector('script[src*="adsbygoogle"]')) {
        return;
      }
      
      const script = document.createElement('script');
      script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7632930282249669";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        console.log('✅ AdSense script loaded');
        this.initializeAdSlots();
      };
      
      document.head.appendChild(script);
    },
    
    // Place ad containers
    placeAds: function() {
      this.placements.forEach(placement => {
        // Check condition if exists
        if (placement.condition && !placement.condition()) {
          return;
        }
        
        const target = document.querySelector(placement.selector);
        if (!target) return;
        
        // Create ad container
        const adContainer = document.createElement('div');
        adContainer.id = `ad-${placement.id}`;
        adContainer.className = 'ad-container';
        adContainer.style.cssText = `
          margin: 20px 0;
          text-align: center;
          min-height: ${placement.maxHeight}px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.02);
          border-radius: 8px;
          border: 1px dashed rgba(0,0,0,0.1);
        `;
        
        // Insert ad
        target.insertAdjacentElement(placement.position, adContainer);
        
        // Add ad label
        const adLabel = document.createElement('div');
        adLabel.className = 'ad-label';
        adLabel.textContent = 'Advertisement';
        adLabel.style.cssText = `
          font-size: 0.8em;
          color: #666;
          margin-bottom: 5px;
          text-align: center;
        `;
        adContainer.appendChild(adLabel);
        
        // Create ad slot
        const adSlot = document.createElement('ins');
        adSlot.className = 'adsbygoogle';
        adSlot.style.display = 'block';
        adSlot.setAttribute('data-ad-client', 'ca-pub-7632930282249669');
        adSlot.setAttribute('data-ad-slot', this.generateAdSlotId(placement.format));
        adSlot.setAttribute('data-ad-format', placement.format);
        adSlot.setAttribute('data-full-width-responsive', 'true');
        
        adContainer.appendChild(adSlot);
        
        console.log(`📢 Ad placed: ${placement.id}`);
      });
    },
    
    // Initialize ad slots
    initializeAdSlots: function() {
      if (window.adsbygoogle && window.adsbygoogle.push) {
        try {
          (adsbygoogle = window.adsbygoogle || []).push({});
          console.log('✅ Ad slots initialized');
          
          // Track ad load
          window.trackEvent('ads_loaded', {
            ad_count: document.querySelectorAll('.adsbygoogle').length,
            page: window.location.pathname
          });
        } catch (error) {
          console.warn('Ad initialization error:', error);
        }
      }
    },
    
    // Generate ad slot ID based on format
    // ⚠️  BEFORE GOING LIVE: Replace these with real AdSense slot IDs
    // from your AdSense account → Ads → By ad unit → Get code
    generateAdSlotId: function(format) {
      const slotIds = {
        'horizontal': '2805570461',
        'rectangle':  '9214337192'   
      };
      return slotIds[format] || slotIds['horizontal'];
    },
    
    // Remove all ads (for premium users)
    removeAds: function() {
      document.querySelectorAll('.ad-container').forEach(ad => ad.remove());
      console.log('🧹 Ads removed for premium user');
    }
  };
  
  // ── GDPR-SAFE INITIALISATION ───────────────────────────────────────────────
  // Ads only load AFTER the user explicitly accepts cookies.
  // If they've already accepted in a previous visit, load immediately.

  function tryInitAds() {
    if (localStorage.getItem('cookieConsent') === 'true') {
      adManager.init();
    }
    // Otherwise wait for the dispatch from acceptCookies()
  }

  document.addEventListener('cookieConsentGranted', () => adManager.init());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInitAds);
  } else {
    tryInitAds();
  }
  
  // Make adManager available globally
  window.adManager = adManager;
})();
