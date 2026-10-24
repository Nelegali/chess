// Ошибка соперника — «твой шанс», ход без спасения — не «грубая ошибка», лучшие ходы соперника.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const errs = [];
const URL = BASE;
async function open(game, dev = { viewport: { width: 1280, height: 860 } }, settings = { freeList: 'popular' }) {
  const p = await (await browser.newContext(dev)).newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(m.text()));
  await p.route('https://explorer.lichess.ovh/**', (r) => r.abort());
  await p.goto(URL);
  await p.evaluate(([g, s]) => { localStorage.setItem('install-hint', '1'); localStorage.setItem('chess-openings-settings-v1', JSON.stringify(s)); localStorage.setItem('free-game', JSON.stringify(g)); }, [game, settings]);
  await p.goto(URL + '#/free');
  await p.waitForSelector('.move-card');
  await p.waitForTimeout(600);
  return p;
}
const info = (p) => p.evaluate(() => ({
  card: document.querySelector('.move-card').className,
  banner: document.querySelector('.move-card .verdict-banner')?.innerText.replace(/\s+/g, ' '),
  text: document.querySelector('.move-card .explain')?.innerText,
  arrows: [...document.querySelectorAll('cg-container svg.cg-shapes g line, cg-container svg.cg-shapes line')].map((l) => l.getAttribute('stroke')),
  sum: document.querySelector('.last-sum')?.innerText.replace(/\s+/g, ' '),
}));
let p = await open({ side: 'b', sans: ['f3', 'e5', 'g4'], cursor: 3 });
console.log('соперник ошибся (g4??):', await info(p));
await p.screenshot({ path: 'chance-1.png' });
p = await open({ side: 'b', sans: ['h3', 'a6', 'c3', 'e6', 'f3', 'Qh4+', 'g3'], cursor: 7 });
console.log('соперник без спасения (g3):', await info(p));
await p.screenshot({ path: 'chance-2.png' });
p = await open({ side: 'w', sans: ['h3', 'a6', 'c3', 'e6', 'f3', 'Qh4+', 'g3'], cursor: 7 });
console.log('мой ход без спасения (g3):', await info(p));
p = await open({ side: 'w', sans: ['f3', 'e5', 'g4'], cursor: 3 });
console.log('моя грубая ошибка (g4??):', await info(p));
p = await open({ side: 'b', sans: ['f3', 'e5', 'g4'], cursor: 3 }, { ...devices['iPhone 13'] });
console.log('телефон, соперник ошибся:', await info(p));
await p.screenshot({ path: 'chance-phone.png' });
p = await open({ side: 'b', sans: ['e4', 'e5', 'Nf3', 'Nc6'], cursor: 4 });
await p.click('.list-mode [data-mode="best"]');
await p.waitForFunction(() => document.querySelector('.cand .c-chip.e-best'), null, { timeout: 60000 });
console.log('лучшие ходы соперника:', await p.evaluate(() => ({
  hint: [...document.querySelectorAll('.cands p.muted')].map((x) => x.innerText)[0],
  rows: [...document.querySelectorAll('.cand')].slice(0, 3).map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 110)),
})));
await p.screenshot({ path: 'chance-best.png' });
console.log(errs.length ? errs : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
