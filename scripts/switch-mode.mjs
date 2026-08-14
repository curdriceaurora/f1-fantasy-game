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
  return { ok: true, mode: 'season' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = switchMode(process.argv[2]);
  if (!result.ok) {
    process.exit(1);
  }
}

