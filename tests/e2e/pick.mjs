// Телефон: касание хода соперника сначала показывает его на доске, второе — делает ход.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('chess-openings-settings-v1', JSON.stringify({ freeList: 'popular' })); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3'], cursor: 3 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
await p.tap('.pager-tab[data-go="1"]'); await p.waitForTimeout(500);
const st = () => p.evaluate(() => ({
  moves: document.querySelector('.ml')?.innerText.replace(/\s+/g, ' '),
  main: document.querySelector('.actionbar .btn:not(.nav)')?.innerText,
  picked: document.querySelector('.cand.picked .c-san')?.innerText,
  note: document.querySelector('.cand-pick')?.innerText.replace(/\s+/g, ' ').slice(0, 60),
  pieceOnD6: !!document.querySelector('#board piece.black.pawn[style*="translate"]'),
}));
await p.tap('.cand >> nth=1'); await p.waitForTimeout(500);
console.log('после 1-го касания:', JSON.stringify(await st()));
await p.screenshot({ path: dir + '/pick-1.png' });
await p.tap('.cand >> nth=0'); await p.waitForTimeout(500);
console.log('касание другого хода:', JSON.stringify(await st()));
await p.tap('#pick-cancel'); await p.waitForTimeout(400);
console.log('отмена:', JSON.stringify(await st()));
await p.tap('.cand >> nth=0'); await p.waitForTimeout(400);
await p.tap('.cand.picked'); await p.waitForTimeout(700);
console.log('2-е касание (сыграть):', JSON.stringify(await st()));
// через кнопку внизу
await p.tap('.pager-tab[data-go="1"]').catch(() => {}); await p.waitForTimeout(400);
const hint = await p.$('#free-hint'); if (hint) { await hint.tap(); await p.waitForTimeout(500); }
await p.tap('.cand >> nth=0'); await p.waitForTimeout(400);
await p.tap('#free-play-picked'); await p.waitForTimeout(700);
console.log('кнопка «Сыграть»:', JSON.stringify(await st()));
// мышь на ноутбуке — сразу ход
const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await d.goto(BASE + '#/');
await d.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4'], cursor: 1 })); });
await d.goto(BASE + '#/free'); await d.waitForTimeout(900);
await d.click('.cand >> nth=0'); await d.waitForTimeout(500);
console.log('ноутбук, клик мышью:', await d.$eval('.ml', (e) => e.innerText.replace(/\s+/g, ' ')));
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
