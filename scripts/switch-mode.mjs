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

if (mode === 'preseason') {
  // Copy preseason config to vercel.json
  if (!existsSync(vercelPreseasonPath)) {
    console.error('Error: vercel.preseason.json not found');
    process.exit(1);
  }

  const preseasonConfig = readFileSync(vercelPreseasonPath, 'utf-8');
  writeFileSync(vercelJsonPath, preseasonConfig);

  console.log('✅ Switched to preseason mode');
  console.log('   - Root (/) now redirects to /index.html (entry builder)');
  console.log('   - Dashboard redirects to /index.html');
  console.log('   - Calculator and entry builder are accessible');
  console.log('\n📝 Next steps:');
  console.log('   1. Test locally: SITE_MODE=preseason npm run dev');
  console.log('   2. Commit: git add vercel.json && git commit -m "Switch to preseason mode"');
  console.log('   3. Deploy: git push');
} else {
  // Use default season config
  const seasonConfig = {
    redirects: [
      {
        source: '/',
        destination: '/dashboard.html',
        permanent: false,
      },
      {
        source: '/index.html',
        destination: '/dashboard.html',
        permanent: false,
      },
      {
        source: '/calculator.html',
        destination: '/dashboard.html',
        permanent: false,
      },
    ],
    functions: {
      'api/**/*.js': {
        memory: 256,
        maxDuration: 10,
        includeFiles: '{data/**,season/**}',
      },
    },
    headers: [
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ],
  };

  writeFileSync(vercelJsonPath, JSON.stringify(seasonConfig, null, 2) + '\n');

  console.log('✅ Switched to season mode');
  console.log('   - Root (/) now redirects to /dashboard.html (standings)');
  console.log('   - Entry builder pages redirect to dashboard');
  console.log('   - Team details and race scoring are accessible');
  console.log('\n📝 Next steps:');
  console.log('   1. Test locally: npm run dev');
  console.log('   2. Commit: git add vercel.json && git commit -m "Switch to season mode"');
  console.log('   3. Deploy: git push');
}
