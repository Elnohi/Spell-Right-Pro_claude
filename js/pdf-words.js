/* ============================================================
   pdf-words.js — PDF word-list support for SpellRightPro
   ------------------------------------------------------------
   Lets users upload a .pdf word list alongside .txt / .csv.
   pdf.js is loaded lazily from the CDN the first time a PDF is
   chosen, so pages that never see a PDF stay light.

   Public API (window.PDFWords):
     isPDF(file)            -> boolean
     readAsText(file)       -> Promise<string>   any supported type
     extractFromPDF(file)   -> Promise<string>   PDF only
   ============================================================ */
(function () {
  'use strict';

  var PDFJS_VERSION = '3.11.174';
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
  var MAX_PAGES = 50;          // guard against someone uploading a textbook
  var loaderPromise = null;

  function isPDF(file) {
    if (!file) return false;
    var name = (file.name || '').toLowerCase();
    return file.type === 'application/pdf' || name.slice(-4) === '.pdf';
  }

  /* Load pdf.js once, on demand. */
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_BASE + 'pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) {
          reject(new Error('PDF reader failed to initialise'));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        loaderPromise = null;
        reject(new Error('Could not load the PDF reader. Check your connection and try again.'));
      };
      document.head.appendChild(s);
    });

    return loaderPromise;
  }

  /* Turn raw PDF text items into one word (or phrase) per line. */
  function tidy(rawLines) {
    var out = [];
    var seen = Object.create(null);

    rawLines.forEach(function (line) {
      line = String(line)
        .replace(/\u00a0/g, ' ')          // non-breaking spaces
        .replace(/[\u2018\u2019]/g, "'")  // smart quotes
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      if (!line) return;

      // Drop bare page numbers and "Page 3 of 12" style furniture.
      if (/^\d+$/.test(line)) return;
      if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) return;

      // Strip list markers: "1." / "1)" / "-" / bullets.
      line = line.replace(/^(\d+[.)]\s*|[-\u2022\u00b7*]\s*)/, '').trim();
      if (!line) return;

      // A line of comma- or tab-separated words becomes several entries.
      var parts = line.indexOf(',') > -1 || line.indexOf('\t') > -1
        ? line.split(/[,\t]+/)
        : [line];

      parts.forEach(function (part) {
        part = part.trim();
        if (!part) return;
        if (part.length > 60) return;            // not a word list entry
        var key = part.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(part);
      });
    });

    return out;
  }

  /* Extract text from a PDF file, newline-separated. */
  function extractFromPDF(file) {
    return loadPdfJs()
      .then(function (pdfjsLib) {
        return file.arrayBuffer();
      })
      .then(function (buffer) {
        return window.pdfjsLib.getDocument({ data: buffer }).promise;
      })
      .then(function (pdf) {
        var pageCount = Math.min(pdf.numPages, MAX_PAGES);
        var jobs = [];

        for (var i = 1; i <= pageCount; i++) {
          jobs.push(
            pdf.getPage(i).then(function (page) {
              return page.getTextContent();
            })
          );
        }

        return Promise.all(jobs);
      })
      .then(function (pages) {
        var lines = [];

        pages.forEach(function (content) {
          var current = '';
          var lastY = null;

          content.items.forEach(function (item) {
            var y = item.transform ? Math.round(item.transform[5]) : null;

            // A change in vertical position means a new visual line.
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
              if (current.trim()) lines.push(current);
              current = '';
            }

            current += item.str;
            if (item.hasEOL) {
              if (current.trim()) lines.push(current);
              current = '';
            }
            lastY = y;
          });

          if (current.trim()) lines.push(current);
        });

        var words = tidy(lines);

        if (!words.length) {
          throw new Error(
            'No readable text found. If this PDF is a scan or photo, the words are images rather than text — save it as a .txt file instead.'
          );
        }

        return words.join('\n');
      });
  }

  /* Read any supported file as plain text. */
  function readAsText(file) {
    if (isPDF(file)) return extractFromPDF(file);

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsText(file);
    });
  }

  window.PDFWords = {
    isPDF: isPDF,
    readAsText: readAsText,
    extractFromPDF: extractFromPDF
  };
})();
