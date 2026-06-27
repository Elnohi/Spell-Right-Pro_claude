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

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }).catch(function () {});
})();
