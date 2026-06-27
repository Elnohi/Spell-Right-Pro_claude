/* =============================================================
   hw-canvas.js — Shared handwriting canvas + OCR module
   Used by: freemium-school.html, freemium-oet.html, trainer.html
   
   Provides:
     window.HW.init(moduleId)      — attach to a moduleId's elements
     window.HW.getAnswer(moduleId) — returns recognised text or ''
     window.HW.reset(moduleId)     — clear canvas between words
     window.HW.setMode(moduleId, 'keyboard'|'handwriting')
   
   Expected DOM IDs (all prefixed with moduleId):
     {id}KeyboardWrap   — wraps the textarea input
     {id}HwWrap         — wraps the canvas zone (hidden by default)
     {id}HwCanvas       — the drawing canvas
     {id}HwStatus       — status text ("Recognizing…" etc)
     {id}HwText         — the recognised word
     {id}ModeKeyboard   — toggle button for keyboard mode
     {id}ModeHandwriting— toggle button for handwriting mode
     {id}ZoneLabel      — "Type/Write your spelling here" label
     {id}HwClearBtn     — clear canvas button
============================================================= */
window.HW = (function () {
  'use strict';

  // Per-module state
  const _state = {};

  function _getState(id) {
    if (!_state[id]) {
      _state[id] = {
        mode: 'keyboard',
        drawing: false,
        strokes: [],
        recognizeTimer: null
      };
    }
    return _state[id];
  }

  // ── Canvas geometry ────────────────────────────────────────
  function _getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function _resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  // ── Pointer handlers ───────────────────────────────────────
  function _pointerDown(e, id) {
    e.preventDefault();
    const s      = _getState(id);
    const canvas = document.getElementById(id + 'HwCanvas');
    if (!canvas) return;
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    s.drawing = true;
    const pos = _getPos(e, canvas);
    s.strokes.push([pos]);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function _pointerMove(e, id) {
    e.preventDefault();
    const s = _getState(id);
    if (!s.drawing) return;
    const canvas = document.getElementById(id + 'HwCanvas');
    if (!canvas) return;
    const pos = _getPos(e, canvas);
    s.strokes[s.strokes.length - 1].push(pos);
    const ctx       = canvas.getContext('2d');
    ctx.lineWidth   = (e.pointerType === 'pen')
      ? Math.max(1.5, (e.pressure || 0.5) * 4) : 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--text').trim() || '#1a0533';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function _pointerUp(e, id) {
    const s = _getState(id);
    if (!s.drawing) return;
    s.drawing = false;
    clearTimeout(s.recognizeTimer);
    s.recognizeTimer = setTimeout(() => _recognize(id), 800);
  }

  // ── OCR / recognition ──────────────────────────────────────
  async function _recognize(id) {
    const s        = _getState(id);
    const canvas   = document.getElementById(id + 'HwCanvas');
    const statusEl = document.getElementById(id + 'HwStatus');
    const textEl   = document.getElementById(id + 'HwText');
    if (!s.strokes.length || !canvas) return;
    if (statusEl) statusEl.textContent = 'Recognizing…';

    // Path 1: Chrome experimental Handwriting API
    if ('createHandwritingRecognizer' in navigator) {
      try {
        const recognizer = await navigator.createHandwritingRecognizer({ languages: ['en'] });
        const prediction  = recognizer.startDrawing({});
        for (const stroke of s.strokes) {
          const hw = prediction.addStroke(new HandwritingStroke());
          for (const pt of stroke) hw.addPoint({ x: pt.x, y: pt.y, t: Date.now() });
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
        console.warn('HW API failed, falling back to OCR:', err);
      }
    }

    // Path 2: Google Vision OCR via Netlify function
    try {
      const base64   = canvas.toDataURL('image/png').split(',')[1];
      const response = await fetch('/.netlify/functions/ocr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: base64, type: 'handwriting' })
      });
      if (!response.ok) throw new Error('OCR HTTP ' + response.status);
      const data = await response.json();
      const raw  = (data.text || '').replace(/\s+/g, ' ').trim().split('\n')[0].trim();
      if (raw) {
        if (textEl)   textEl.textContent   = raw;
        if (statusEl) statusEl.textContent = '✅ Recognized — tap Submit to check';
      } else {
        if (statusEl) statusEl.textContent = '⚠️ Could not read — write more clearly or switch to keyboard';
      }
    } catch (err) {
      console.error('OCR failed:', err);
      if (statusEl) statusEl.textContent = '⚠️ Recognition failed — try keyboard mode';
    }
  }

  // ── Public API ─────────────────────────────────────────────
  function init(id) {
    const canvas = document.getElementById(id + 'HwCanvas');
    if (!canvas || canvas.dataset.hwInit) return;
    canvas.dataset.hwInit = '1';
    _resizeCanvas(canvas);
    window.addEventListener('resize', () => _resizeCanvas(canvas));
    canvas.addEventListener('pointerdown', e => _pointerDown(e, id));
    canvas.addEventListener('pointermove', e => _pointerMove(e, id));
    canvas.addEventListener('pointerup',   e => _pointerUp(e, id));
    canvas.addEventListener('pointerout',  e => _pointerUp(e, id));
    canvas.style.touchAction = 'none';

    const clearBtn = document.getElementById(id + 'HwClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => clear(id));
  }

  function setMode(id, mode) {
    const s      = _getState(id);
    s.mode       = mode;
    const kbWrap = document.getElementById(id + 'KeyboardWrap');
    const hwWrap = document.getElementById(id + 'HwWrap');
    const kbBtn  = document.getElementById(id + 'ModeKeyboard');
    const hwBtn  = document.getElementById(id + 'ModeHandwriting');
    const label  = document.getElementById(id + 'ZoneLabel');

    if (mode === 'handwriting') {
      if (kbWrap) kbWrap.style.display = 'none';
      if (hwWrap) { hwWrap.style.display = 'block'; hwWrap.classList.add('visible'); }
      if (kbBtn)  kbBtn.classList.remove('active');
      if (hwBtn)  hwBtn.classList.add('active');
      if (label)  label.innerHTML = '<i class="fa fa-pen-nib"></i> Write your spelling here';
      init(id);
    } else {
      if (kbWrap) kbWrap.style.display = '';
      if (hwWrap) { hwWrap.style.display = 'none'; hwWrap.classList.remove('visible'); }
      if (kbBtn)  kbBtn.classList.add('active');
      if (hwBtn)  hwBtn.classList.remove('active');
      if (label)  label.innerHTML = '<i class="fa fa-keyboard"></i> Type your spelling here';
    }
  }

  function getAnswer(id) {
    const s      = _getState(id);
    if (s.mode !== 'handwriting') return null; // null = use keyboard input
    const textEl = document.getElementById(id + 'HwText');
    const val    = textEl ? textEl.textContent.trim() : '';
    return (val === '—' || val === '') ? '' : val;
  }

  function reset(id) {
    clear(id);
  }

  function clear(id) {
    const s      = _getState(id);
    s.strokes    = [];
    clearTimeout(s.recognizeTimer);
    const canvas = document.getElementById(id + 'HwCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const textEl   = document.getElementById(id + 'HwText');
    const statusEl = document.getElementById(id + 'HwStatus');
    if (textEl)   textEl.textContent   = '—';
    if (statusEl) statusEl.textContent = 'Write your word on the canvas above';
  }

  return { init, setMode, getAnswer, reset, clear };
})();
