// js/sw-register.js — shared service worker registration + update handling
//
// Registers /sw.js and actively checks for a new version on every page
// load via registration.update(). Without this, the browser only checks
// for updates on its own schedule (at most once per 24h, and only on a
// fresh navigator.serviceWorker.register() call). Apps that stay open
// in the background for days — common for installed Android TWAs, which
// Android suspends rather than fully closes — can otherwise run a stale
// cached version for far longer than expected.
//
// Used by every page instead of each one duplicating its own copy of
// this logic with inconsistent levels of completeness.

(function () {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').then(function (reg) {
    reg.update(); // force an immediate check, don't wait for the browser's own throttled cycle

    reg.addEventListener('updatefound', function () {
      var newWorker = reg.installing;
      newWorker.addEventListener('statechange', function () {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    // Only reload when an EXISTING worker is replaced by a newer one. On a visitor's very first
    // visit there is no previous controller: sw.js calls clients.claim(), which fires
    // 'controllerchange' even though nothing was updated, and the old code reloaded the page.
    // That made every first-time visit load twice (double page_view/view_item in GA4, and any
    // state typed during the first load was lost).
    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) return;
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }).catch(function () {});
})();
