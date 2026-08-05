// Local dev server — mimics Vercel's static + API setup
// Usage: node server.js

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { getSiteMode, SITE_MODES } from './lib/site-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

export function resolveApiRoute(pathname) {
  const parts = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const params = {};

  function walk(baseDir, segmentIndex) {
    if (segmentIndex === parts.length) {
      const indexFile = join(baseDir, 'index.js');
      return existsSync(indexFile) ? indexFile : null;
    }

    const segment = parts[segmentIndex];
    const directFile = join(baseDir, `${segment}.js`);
    if (segmentIndex === parts.length - 1 && existsSync(directFile)) {
      return directFile;
    }

    const directDir = join(baseDir, segment);
    if (existsSync(directDir)) {
      const resolved = walk(directDir, segmentIndex + 1);
      if (resolved) return resolved;
    }

    const files = existsSync(baseDir) ? readdirSync(baseDir) : [];
    for (const file of files) {
      const match = file.match(/^\[(.+)\]\.js$/);
      if (match && segmentIndex === parts.length - 1) {
        params[match[1]] = segment;
        return join(baseDir, file);
      }
    }

    const childDirs = files.filter((file) => file.startsWith('[') && file.endsWith(']'));
    for (const childDir of childDirs) {
      params[childDir.slice(1, -1)] = segment;
      const resolved = walk(join(baseDir, childDir), segmentIndex + 1);
      if (resolved) return resolved;
      delete params[childDir.slice(1, -1)];
    }

    return null;
  }

  const filePath = walk(join(__dirname, 'api'), 0);
  return filePath ? { filePath, params } : null;
}

export function resolveStaticPath(publicDir, pathname) {
  const publicRoot = resolve(publicDir);
  const requestPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const candidate = resolve(publicRoot, `.${requestPath}`);
  const relativePath = relative(publicRoot, candidate);
  const escapesPublicRoot = relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath);
  return escapesPublicRoot ? null : candidate;
}

export function createAppServer(options = {}) {
  const resolveRoute = options.resolveApiRoute || resolveApiRoute;
  const importApiModule = options.importApiModule || ((filePath) => import(filePath));
  const siteMode = options.getSiteMode || getSiteMode;
  const publicDir = options.publicDir || join(__dirname, 'public');

  return createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = siteMode();
  const isPreseason = mode === SITE_MODES.PRESEASON;

  // Redirect root and mode-specific entry points based on site mode
  if (url.pathname === '/') {
    const destination = isPreseason ? '/index.html' : '/dashboard.html';
    res.writeHead(302, { Location: destination });
    res.end();
    return;
  }

  // In season mode, redirect preseason pages to dashboard
  if (!isPreseason && (url.pathname === '/index.html' || url.pathname === '/calculator.html')) {
    res.writeHead(302, { Location: '/dashboard.html' });
    res.end();
    return;
  }

  // In preseason mode, redirect dashboard and team pages to entry builder
  if (isPreseason && (url.pathname === '/dashboard.html' || url.pathname === '/team.html')) {
    res.writeHead(302, { Location: '/index.html' });
    res.end();
    return;
  }

  // API route
  if (url.pathname.startsWith('/api/')) {
    const resolved = resolveRoute(url.pathname);
    if (!resolved) {
      res.writeHead(404);
      res.end('API route not found');
      return;
    }

    importApiModule(resolved.filePath).then((apiModule) => {
      const apiHandler = apiModule.default;
      const query = {
        ...Object.fromEntries(url.searchParams),
        ...resolved.params,
      };
      const fakeReq = { query, method: req.method, url: req.url };
      const fakeRes = {
        _status: 200,
        _headers: {},
        status(code) { this._status = code; return this; },
        setHeader(k, v) { this._headers[k] = v; },
        json(data) {
          res.writeHead(this._status, {
            'Content-Type': 'application/json',
            ...this._headers,
          });
          res.end(JSON.stringify(data));
        },
      };
      apiHandler(fakeReq, fakeRes);
    }).catch((error) => {
      console.error('API route load error:', error);
      res.writeHead(500);
      res.end('API route error');
    });
    return;
  }

  // Static files from public/
  const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = resolveStaticPath(publicDir, filePath);

  if (!fullPath || !existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(fullPath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = readFileSync(fullPath);

  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
  });
}

export function startServer(port = Number.parseInt(process.env.PORT || '3456', 10), options = {}) {
  const server = createAppServer(options);
  server.listen(port, () => {
    const mode = (options.getSiteMode || getSiteMode)();
    const modeName = mode === SITE_MODES.PRESEASON ? 'Preseason Entry Builder' : 'Season Dashboard';
    const actualPort = server.address().port;
    console.log(`\n  🏎️  F1 Fantasy Team Selector`);
    console.log(`  Local: http://localhost:${actualPort}`);
    console.log(`  Mode:  ${mode} (${modeName})\n`);
  });
  return server;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('server.js');
if (isDirectRun) {
  startServer();
}
