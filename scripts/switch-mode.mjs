#!/usr/bin/env node
// Script to switch between preseason and season modes
// Usage: npm run switch-mode -- preseason|season

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function switchMode(mode, {
  vercelJsonPath = join(__dirname, '..', 'vercel.json'),
  vercelPreseasonPath = join(__dirname, '..', 'vercel.preseason.json'),
  vercelSeasonPath = join(__dirname, '..', 'vercel.season.json'),
  log = console.log,
  errorLog = console.error,
} = {}) {
  if (!mode || !['preseason', 'season'].includes(mode)) {
    errorLog('Usage: npm run switch-mode -- <preseason|season>');
    return { ok: false, error: 'Usage: npm run switch-mode -- <preseason|season>' };
  }

  let currentConfig = {};
  if (existsSync(vercelJsonPath)) {
    currentConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
  }

  if (mode === 'preseason') {
    if (!existsSync(vercelPreseasonPath)) {
      errorLog('Error: vercel.preseason.json not found');
      return { ok: false, error: 'Error: vercel.preseason.json not found' };
    }

    const preseasonTemplate = JSON.parse(readFileSync(vercelPreseasonPath, 'utf-8'));
    const mergedConfig = {
      ...currentConfig,
      redirects: preseasonTemplate.redirects,
    };

    writeFileSync(vercelJsonPath, JSON.stringify(mergedConfig, null, 2) + '\n');
    log('✅ Switched to preseason mode');
    log('   - Root (/) now redirects to /index.html (entry builder)');
    log('   - Dashboard and team pages redirect to /index.html');
    log('   - Calculator and entry builder are accessible');
    log('\n📝 Next steps:');
    log('   1. Set SITE_MODE environment variable in Vercel:');
    log('      vercel env add SITE_MODE');
    log('      (enter "preseason" when prompted)');
    log('   2. Test locally: SITE_MODE=preseason npm run dev');
    log('   3. Commit: git add vercel.json && git commit -m "Switch to preseason mode"');
    log('   4. Deploy: git push');
    return { ok: true, mode: 'preseason' };
  }

  if (!existsSync(vercelSeasonPath)) {
    errorLog('Error: vercel.season.json not found');
    return { ok: false, error: 'Error: vercel.season.json not found' };
  }

  const seasonTemplate = JSON.parse(readFileSync(vercelSeasonPath, 'utf-8'));
  const mergedConfig = {
    ...currentConfig,
    redirects: seasonTemplate.redirects,
  };

  writeFileSync(vercelJsonPath, JSON.stringify(mergedConfig, null, 2) + '\n');
  log('✅ Switched to season mode');
  log('   - Root (/) now redirects to /dashboard.html (standings)');
  log('   - Entry builder pages redirect to dashboard');
  log('   - Team details and race scoring are accessible');
  log('\n📝 Next steps:');
  log('   1. Set SITE_MODE environment variable in Vercel:');
  log('      vercel env add SITE_MODE');
  log('      (enter "season" when prompted, or leave unset for default)');
  log('   2. Test locally: npm run dev');
  log('   3. Commit: git add vercel.json && git commit -m "Switch to season mode"');
  log('   4. Deploy: git push');
  return { ok: true, mode: 'season' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = switchMode(process.argv[2]);
  if (!result.ok) {
    process.exit(1);
  }
}
