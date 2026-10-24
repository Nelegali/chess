// Ссылку подключения можно вставить в поле токена (приложение на экране «Домой» iPhone).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
// поддельный GitHub: гисты в памяти, общий для обоих «устройств»
const gists = new Map();
let nextId = 1;
const TOKEN = 'ghp_TESTTOKEN1234567890';
async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.headers()['authorization'] !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: cors, body: '{}' });
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const view = (g) => ({ id: g.id, description: g.description, files: Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, { filename: n, content: f.content, truncated: false }])) });
  if (url.pathname === '/gists' && req.method() === 'GET') return json(200, [...gists.values()].map(view));
  if (url.pathname === '/gists' && req.method() === 'POST') { const b = JSON.parse(req.postData()); const g = { id: 'g' + nextId++, description: b.description, files: b.files }; gists.set(g.id, g); return json(201, view(g)); }
  const m = url.pathname.match(/^\/gists\/(\w+)$/);
  if (m && gists.has(m[1])) {
    const g = gists.get(m[1]);
    if (req.method() === 'PATCH') { const b = JSON.parse(req.postData()); Object.assign(g.files, b.files); }
    return json(200, view(g));
  }
  return json(404, {});
}
async function device(name, dev) {
  const p = await (await browser.newContext({ ...dev })).newPage();
  p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(name + ' ' + m.text()));
  await p.route('https://api.github.com/**', github);
  await p.goto(BASE + '#/');
  await p.evaluate(() => localStorage.setItem('install-hint', '1'));
  return p;
}

// Установленное приложение на iPhone: ссылку подключения вставляют в поле токена
const laptop = await device('laptop', { viewport: { width: 1280, height: 860 } });
await laptop.goto(BASE + '#/profile');
await laptop.waitForTimeout(600);
console.log('кнопка токена:', await laptop.evaluate(() => { const a = document.querySelector('.gh-token-btn'); return a && `${a.innerText} → ${a.href.slice(0, 60)}`; }));
await laptop.fill('#gh-token', TOKEN);
await laptop.click('#gh-connect');
await laptop.waitForTimeout(1200);
await laptop.click('#gh-pair');
await laptop.waitForTimeout(400);
const link = await laptop.evaluate(() => `${location.origin}${location.pathname}#/link/` + encodeURIComponent(JSON.parse(localStorage.getItem('chess-openings-settings-v1')).githubToken) + '/p2');
await laptop.screenshot({ path: OUT + '/pair-modal.png' });
const phone = await device('phone', devices['iPhone 13']);
await phone.goto(BASE + '#/profile');
await phone.waitForTimeout(600);
await phone.screenshot({ path: OUT + '/gh-steps-phone.png', fullPage: true });
await phone.fill('#gh-token', 'Открой: ' + link);
await phone.click('#gh-connect');
await phone.waitForTimeout(1500);
console.log('телефон после вставки ссылки:', await phone.evaluate(() => ({ token: !!JSON.parse(localStorage.getItem('chess-openings-settings-v1')).githubToken, av: document.querySelector('.who-av')?.textContent, connected: document.querySelector('#gh-body')?.innerText.slice(0, 40) })));
console.log(errs.length ? errs : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
