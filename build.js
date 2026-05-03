// build.js — injects env vars into index.html at build time
const fs   = require('fs');
const path = require('path');

const supabaseUrl  = process.env.SUPABASE_URL      || '';
const supabaseAnon = process.env.SUPABASE_ANON_KEY || '';
const vapidPublic  = process.env.VAPID_PUBLIC_KEY  || '';

if (!supabaseUrl || !supabaseAnon) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_ANON_KEY not set');
}
if (!vapidPublic) {
  console.warn('Warning: VAPID_PUBLIC_KEY not set - push subscriptions will not work');
}

const src  = path.join(__dirname, 'index.html');
const dist = path.join(__dirname, 'dist');

let html = fs.readFileSync(src, 'utf8');
html = html.replace(/"__SUPABASE_URL__"/g,  `"${supabaseUrl}"`);
html = html.replace(/"__SUPABASE_ANON_KEY__"/g, `"${supabaseAnon}"`);
html = html.replace(/"__VAPID_PUBLIC_KEY__"/g,  `"${vapidPublic}"`);

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);

// Copy static files
for (const file of ['manifest.json', 'sw.js']) {
  if (fs.existsSync(path.join(__dirname, file))) {
    fs.copyFileSync(path.join(__dirname, file), path.join(dist, file));
  }
}

// Copy icons directory if present
const iconsDir = path.join(__dirname, 'icons');
if (fs.existsSync(iconsDir)) {
  fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
  fs.readdirSync(iconsDir).forEach(f => {
    fs.copyFileSync(path.join(iconsDir, f), path.join(dist, 'icons', f));
  });
}

console.log('✅  Build complete → dist/');
