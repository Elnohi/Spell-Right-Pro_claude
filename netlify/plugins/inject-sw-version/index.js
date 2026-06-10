// netlify/plugins/inject-sw-version/index.js
// Replaces __SW_VERSION__ in sw.js with a timestamp at build time.
// This forces the service worker to update on every Netlify deploy,
// which clears all old caches automatically.

const fs = require('fs');
const path = require('path');

module.exports = {
  onBuild: ({ utils }) => {
    const swPath = path.join(process.cwd(), 'sw.js');

    if (!fs.existsSync(swPath)) {
      utils.build.failBuild('sw.js not found in project root');
      return;
    }

    const version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const original = fs.readFileSync(swPath, 'utf8');

    if (!original.includes('__SW_VERSION__')) {
      console.log('⚠️  __SW_VERSION__ placeholder not found in sw.js — skipping');
      return;
    }

    const updated = original.replace(/__SW_VERSION__/g, version);
    fs.writeFileSync(swPath, updated, 'utf8');

    console.log(`✅ SW version injected: ${version}`);
  }
};
