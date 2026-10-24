// Свободная игра: определение дебюта, популярные ответы соперника, мат.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
async function page(dev, withLichess) {
  const p = await (await browser.newContext({ ...dev })).newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(m.text()));
  if (withLichess) {
    await p.route('https://explorer.lichess.ovh/**', (r) => {
      const play = new URL(r.request().url()).searchParams.get('play') || '';
      const n = play ? play.split(',').length : 0;
      // простая «статистика»: после 1.e4 — ответы чёрных, после 1.e4 e5 — ходы белых и т.д.
      const table = {
        0: [['e2e4', 'e4', 500], ['d2d4', 'd4', 350], ['g1f3', 'Nf3', 90], ['c2c4', 'c4', 60]],
        1: [['e7e5', 'e5', 400], ['c7c5', 'c5', 300], ['e7e6', 'e6', 120], ['c7c6', 'c6', 100], ['d7d5', 'd5', 80]],
        2: [['g1f3', 'Nf3', 600], ['f1c4', 'Bc4', 120], ['d1h5', 'Qh5', 60], ['b1c3', 'Nc3', 50]],
        3: [['b8c6', 'Nc6', 700], ['g8f6', 'Nf6', 150], ['d7d6', 'd6', 90]],
        4: [['f1c4', 'Bc4', 400], ['f1b5', 'Bb5', 350], ['d2d4', 'd4', 150]],
        5: [['f8c5', 'Bc5', 300], ['g8f6', 'Nf6', 280], ['f8e7', 'Be7', 40]],
      };
      const mv = (table[n] || []).map(([uci, san, k]) => ({ uci, san, white: Math.round(k * 0.4), draws: Math.round(k * 0.2), black: Math.round(k * 0.4) }));
      const sum = mv.reduce((a, m) => a + m.white + m.draws + m.black, 0);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ white: Math.round(sum * 0.4), draws: Math.round(sum * 0.2), black: sum - Math.round(sum * 0.4) - Math.round(sum * 0.2), opening: n >= 5 ? { eco: 'C50', name: 'Italian Game' } : null, moves: mv }) });
    });
  }
  await p.goto(BASE + '#/');
  await p.evaluate((t) => { localStorage.setItem('install-hint', '1'); localStorage.removeItem('free-game'); if (t) localStorage.setItem('chess-openings-settings-v1', JSON.stringify({ lichessToken: 'lip_test' })); }, withLichess);
  return p;
}
const box = async (p) => (await p.$('#board cg-board')).boundingBox();
async function move(p, from, to, black) {
  const b = await box(p); const s = b.width / 8;
  const at = (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return black ? [b.x + s * (7 - f + 0.5), b.y + s * (r + 0.5)] : [b.x + s * (f + 0.5), b.y + s * (7 - r + 0.5)]; };
  await p.mouse.click(...at(from)); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.mouse.click(...at(to)); await p.waitForTimeout(400);
}
const info = (p) => p.evaluate(() => ({
  head: document.querySelector('.move-head')?.innerText.replace(/\s+/g, ' '),
  opening: document.querySelector('.free-opening')?.innerText.replace(/\s+/g, ' ').slice(0, 160),
  cands: [...document.querySelectorAll('.cand')].map((c) => c.innerText.replace(/\s+/g, ' ')).slice(0, 6),
  chip: document.querySelector('.turn-chip')?.innerText,
  main: document.querySelector('.actionbar .btn:not(.nav)')?.innerText,
  arrows: document.querySelectorAll('#board svg.cg-shapes line').length,
}));

// 1) телефон, Lichess «подключён»
let p = await page(devices['iPhone 13'], true);
await p.goto(BASE + '#/free'); await p.waitForTimeout(800);
console.log('старт', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-0.png' });
await move(p, 'e2', 'e4');
await p.waitForTimeout(500);
console.log('после 1.e4', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-1.png' });
await p.click('.cand >> nth=0'); await p.waitForTimeout(500);   // соперник: e5
console.log('после 1…e5', JSON.stringify(await info(p)));
await move(p, 'g1', 'f3'); await p.waitForTimeout(500);
await p.click('#free-random'); await p.waitForTimeout(500);
console.log('после случайного ответа', JSON.stringify(await info(p)));
await move(p, 'f1', 'c4'); await p.waitForTimeout(500);
console.log('после 3.♗c4', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-2.png' });
// подсказка на своём ходу
await p.click('.cand >> nth=0'); await p.waitForTimeout(400);
await p.click('#free-hint'); await p.waitForTimeout(500);
console.log('подсказка', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-3.png' });
// назад/вперёд и сохранение
await p.click('#prev'); await p.click('#prev'); await p.waitForTimeout(300);
console.log('назад x2', JSON.stringify((await info(p)).head));
await p.reload(); await p.waitForTimeout(800);
console.log('после перезагрузки', JSON.stringify((await info(p)).head), await p.evaluate(() => localStorage.getItem('free-game')));
// плохой ход вне теории
await p.click('#next'); await p.click('#next'); await p.waitForTimeout(300);
await move(p, 'h2', 'h4'); await p.waitForTimeout(400);
console.log('ход вне теории', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-4.png' });

// 2) ноутбук, без Lichess, играем чёрными
p = await page({ viewport: { width: 1280, height: 860 } }, false);
await p.goto(BASE + '#/free'); await p.waitForTimeout(800);
await p.click('#side-btn'); await p.waitForTimeout(400);
console.log('чёрными, старт', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-5.png' });
await p.click('.cand >> nth=0'); await p.waitForTimeout(500);
console.log('соперник сходил', JSON.stringify(await info(p)));
await move(p, 'e7', 'e5', true); await p.waitForTimeout(500);
await p.click('#free-random'); await p.waitForTimeout(500);
console.log('дальше', JSON.stringify(await info(p)));
await p.screenshot({ path: dir + '/free-6.png' });
// мат дурака: f3 e5 g4 Qh4#
await p.goto(BASE + '#/'); await p.evaluate(() => localStorage.setItem('free-game', JSON.stringify({ side: 'b', sans: ['f3', 'e5', 'g4', 'Qh4#'], cursor: 4 })));
await p.goto(BASE + '#/free'); await p.waitForTimeout(800);
console.log('мат', JSON.stringify(await info(p)), await p.evaluate(() => document.querySelector('.prompt.done')?.innerText));
console.log(errs.length ? 'ОШИБКИ:\n' + [...new Set(errs)].join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
