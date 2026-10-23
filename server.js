// Небольшой сервер без зависимостей:
//  • раздаёт приложение из папки public/
//  • GET/PUT /api/progress — синхронизация прогресса между устройствами
//    (ключ — секретная фраза в заголовке X-Sync-Key; на диске хранится только её хэш)
//  • GET /api/explorer — прокси к Lichess Opening Explorer (с токеном из LICHESS_TOKEN, если задан)
//
// Запуск: node server.js   (переменные: PORT, HOST, DATA_DIR, LICHESS_TOKEN)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const LICHESS_TOKEN = process.env.LICHESS_TOKEN || '';
const MAX_BODY = 512 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function syncFile(req) {
  // Фраза приходит закодированной через encodeURIComponent: заголовки не допускают кириллицу.
  let key = '';
  try {
    key = decodeURIComponent(String(req.headers['x-sync-key'] || ''));
  } catch {
    return null;
  }
  if (key.length < 8 || key.length > 200) return null;
  const hash = crypto.createHash('sha256').update(`chess-openings:${key}`).digest('hex');
  return path.join(DATA_DIR, `${hash}.json`);
}

async function handleProgress(req, res) {
  const file = syncFile(req);
  if (!file) return send(res, 400, { error: 'Нужна секретная фраза от 8 символов' });
  if (req.method === 'GET') {
    try {
      return send(res, 200, await fs.readFile(file, 'utf8'), { 'Cache-Control': 'no-store' });
    } catch {
      return send(res, 200, 'null', { 'Cache-Control': 'no-store' });
    }
  }
  if (req.method === 'PUT') {
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: 'Неверные данные' });
    }
    if (!data || typeof data !== 'object' || typeof data.cards !== 'object') {
      return send(res, 400, { error: 'Неверный формат' });
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

const explorerCache = new Map();
const EXPLORER_TTL = 24 * 60 * 60 * 1000;

async function handleExplorer(req, res, url) {
  const key = url.searchParams.toString();
  const hit = explorerCache.get(key);
  if (hit && Date.now() - hit.t < EXPLORER_TTL) return send(res, 200, hit.body);
  try {
    const r = await fetch(`https://explorer.lichess.ovh/lichess?${key}`, {
      headers: LICHESS_TOKEN ? { Authorization: `Bearer ${LICHESS_TOKEN}` } : {},
    });
    const body = await r.text();
    if (r.ok) {
      if (explorerCache.size > 5000) explorerCache.delete(explorerCache.keys().next().value);
      explorerCache.set(key, { t: Date.now(), body });
    }
    return send(res, r.status, body);
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file);
    // index.html и sw.js всегда проверяем на свежесть, остальное можно кэшировать недолго
    const noCache = ext === '.html' || file.endsWith('sw.js') || ext === '.webmanifest';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, sync: true });
    if (url.pathname === '/api/progress') return await handleProgress(req, res);
    if (url.pathname === '/api/explorer') return await handleExplorer(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`♞ Шахматные дебюты: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
