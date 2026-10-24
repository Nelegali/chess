// Синхронизация двух профилей через поддельный GitHub (гисты в памяти) и ссылка подключения.
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
const info = (p) => p.evaluate(() => ({ av: document.querySelector('.who-av')?.textContent, lvl: document.querySelector('.lvl b')?.textContent, title: document.querySelector('.hud')?.getAttribute('aria-label') }));
const laptop = await device('laptop', { viewport: { width: 1280, height: 860 } });
// у ноутбука уже есть прогресс (старый ключ) — он должен стать первым профилем
await laptop.evaluate(() => localStorage.setItem('chess-openings-progress-v1', JSON.stringify({ v: 1, updatedAt: 1, xp: 250, days: {}, cards: {}, learned: { 'italian-pianissimo': 1 }, quizBest: 7, achievements: {} })));
await laptop.goto(BASE + '#/profile'); await laptop.reload(); await laptop.waitForTimeout(600);
console.log('ноутбук, профиль 1 (старый прогресс):', JSON.stringify(await info(laptop)));
// переименовать первый профиль
await laptop.click('#who-rename'); await laptop.fill('#rn-name', 'Олег Т.'); await laptop.click('[data-emoji="🦁"]'); await laptop.click('#rn-save'); await laptop.waitForTimeout(300);
// подключить GitHub
await laptop.fill('#gh-token', TOKEN); await laptop.click('#gh-connect'); await laptop.waitForTimeout(1500);
console.log('гистов на GitHub:', gists.size, '| статус:', await laptop.evaluate(() => document.querySelector('#gh-body')?.innerText.replace(/\s+/g, ' ').slice(0, 80)));
const doc = JSON.parse([...gists.values()][0].files['chess-openings-progress.json'].content);
console.log('в гисте профили:', Object.entries(doc.profiles).map(([id, x]) => `${id}:${x.name}:${x.progress.xp}xp`).join(', '));
// окно «Подключить телефон»
await laptop.click('#gh-pair'); await laptop.waitForTimeout(400);
const qrs = await laptop.$$eval('.qr svg', (e) => e.length);
const link = await laptop.evaluate(() => { const b = document.querySelector('[data-copy="p2"]'); return location.origin + location.pathname + '#/link/' + encodeURIComponent(JSON.parse(localStorage.getItem('chess-openings-settings-v1')).githubToken) + '/p2'; });
console.log('QR-кодов:', qrs);
await laptop.screenshot({ path: dir + '/sync-pair.png' });
await laptop.keyboard.press('Escape'); await laptop.click('[data-close]').catch(() => {});

// телефон жены: открывает ссылку для p2
const phone = await device('phone', devices['iPhone 13']);
await phone.goto(link); await phone.waitForTimeout(2000);
console.log('телефон после ссылки:', JSON.stringify(await info(phone)), '| адрес:', await phone.evaluate(() => location.hash));
console.log('профили на телефоне:', await phone.evaluate(() => [...document.querySelectorAll('.who-btn')].map((b) => b.innerText.replace(/\s+/g, ' ')).join(' | ')));
// жена проходит урок → опыт → синхронизация
await phone.evaluate(() => {}); 
await phone.goto(BASE + '#/learn/london-main'); await phone.waitForTimeout(600);
await (await phone.$('#start'))?.click();
for (let k = 0; k < 40; k++) { const b = (await phone.$('#auto')) || (await phone.$('#opp')); if (!b) break; await b.click(); await phone.waitForTimeout(120); }
const fin = await phone.$('#finish'); if (fin) { await fin.click(); await phone.waitForTimeout(500); }
await phone.waitForTimeout(4500); // отложенная отправка
const doc2 = JSON.parse([...gists.values()][0].files['chess-openings-progress.json'].content);
console.log('в гисте после урока жены:', Object.entries(doc2.profiles).map(([id, x]) => `${id}:${x.name}:${x.progress.xp}xp:${Object.keys(x.progress.learned).join('+')}`).join(', '));
// ноутбук синхронизируется и переключается на профиль жены
await laptop.goto(BASE + '#/profile'); await laptop.waitForTimeout(400);
await laptop.click('#gh-now'); await laptop.waitForTimeout(1200);
await laptop.click('[data-profile="p2"]'); await laptop.waitForTimeout(500);
console.log('ноутбук, профиль жены:', JSON.stringify(await info(laptop)), await laptop.evaluate(() => document.querySelector('.stats')?.innerText.replace(/\s+/g, ' ')));
await laptop.screenshot({ path: dir + '/sync-profile.png' });
await phone.goto(BASE + '#/profile'); await phone.waitForTimeout(500);
await phone.screenshot({ path: dir + '/sync-phone.png' });
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
