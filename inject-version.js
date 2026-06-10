const fs = require('fs');
const v = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const f = 'sw.js';
const c = fs.readFileSync(f, 'utf8');
if (c.includes('__SW_VERSION__')) {
  fs.writeFileSync(f, c.replace(/__SW_VERSION__/g, v));
  console.log('SW version injected:', v);
} else {
  console.log('SW version placeholder not found — skipping');
}
