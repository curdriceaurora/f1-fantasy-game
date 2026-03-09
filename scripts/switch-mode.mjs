#!/usr/bin/env node
// Script to switch between preseason and season modes
// Usage: npm run switch-mode -- preseason|season

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mode = process.argv[2];

if (!mode || !['preseason', 'season'].includes(mode)) {
  console.error('Usage: npm run switch-mode -- <preseason|season>');
  process.exit(1);
}

const vercelJsonPath = join(__dirname, '..', 'vercel.json');
const vercelPreseasonPath = join(__dirname, '..', 'vercel.preseason.json');
const vercelSeasonPath = join(__dirname, '..', 'vercel.season.json');

// Read current vercel.json to preserve non-redirect config
let currentConfig = {};
if (existsSync(vercelJsonPath)) {
  currentConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
}

if (mode === 'preseason') {
  // Read preseason template
  if (!existsSync(vercelPreseasonPath)) {
    console.error('Error: vercel.preseason.json not found');
    process.exit(1);
  }

  const preseasonTemplate = JSON.parse(readFileSync(vercelPreseasonPath, 'utf-8'));

  // Merge: use template redirects, preserve other current config
  const mergedConfig = {
    ...currentConfig,
    ...preseasonTemplate,
  };

  writeFileSync(vercelJsonPath, JSON.stringify(mergedConfig, null, 2) + '\n');

  console.log('✅ Switched to preseason mode');
  console.log('   - Root (/) now redirects to /index.html (entry builder)');
  console.log('   - Dashboard and team pages redirect to /index.html');
  console.log('   - Calculator and entry builder are accessible');
  console.log('\n📝 Next steps:');
  console.log('   1. Set SITE_MODE environment variable in Vercel:');
  console.log('      vercel env add SITE_MODE');
  console.log('      (enter "preseason" when prompted)');
  console.log('   2. Test locally: SITE_MODE=preseason npm run dev');
  console.log('   3. Commit: git add vercel.json && git commit -m "Switch to preseason mode"');
  console.log('   4. Deploy: git push');
} else {
  // Read season template
  if (!existsSync(vercelSeasonPath)) {
    console.error('Error: vercel.season.json not found');
    process.exit(1);
  }

  const seasonTemplate = JSON.parse(readFileSync(vercelSeasonPath, 'utf-8'));

  // Merge: use template redirects, preserve other current config
  const mergedConfig = {
    ...currentConfig,
    ...seasonTemplate,
  };

  writeFileSync(vercelJsonPath, JSON.stringify(mergedConfig, null, 2) + '\n');

  console.log('✅ Switched to season mode');
  console.log('   - Root (/) now redirects to /dashboard.html (standings)');
  console.log('   - Entry builder pages redirect to dashboard');
  console.log('   - Team details and race scoring are accessible');
  console.log('\n📝 Next steps:');
  console.log('   1. Set SITE_MODE environment variable in Vercel:');
  console.log('      vercel env add SITE_MODE');
  console.log('      (enter "season" when prompted, or leave unset for default)');
  console.log('   2. Test locally: npm run dev');
  console.log('   3. Commit: git add vercel.json && git commit -m "Switch to season mode"');
  console.log('   4. Deploy: git push');
}
