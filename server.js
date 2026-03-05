// Local dev server — mimics Vercel's static + API setup
// Usage: node server.js

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the API handler
const apiModule = await import('./api/selection.js');
const apiHandler = apiModule.default;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API route
  if (url.pathname.startsWith('/api/')) {
    const query = Object.fromEntries(url.searchParams);
    const fakeReq = { query, method: req.method };
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
    return;
  }

  // Static files from public/
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(__dirname, 'public', filePath);

  if (!existsSync(fullPath)) {
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

const PORT = 3456;
server.listen(PORT, () => {
  console.log(`\n  🏎️  F1 Fantasy Team Selector`);
  console.log(`  Local: http://localhost:${PORT}\n`);
});
