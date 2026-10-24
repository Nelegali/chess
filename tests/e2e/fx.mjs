// Значки и вспышки оценки хода (грубая ошибка, хороший ход), популярность в уроке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(m.text()));
await p.goto(BASE + '#/');
const setGame = async (g) => { await p.goto(BASE + '#/'); await p.waitForTimeout(200); return p.evaluate((g) => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify(g)); }, g); };
const box = async () => (await p.$('#board cg-board')).boundingBox();
async function move(from, to) {
  const b = await box(); const s = b.width / 8;
  const at = (sq) => [b.x + s * (sq.charCodeAt(0) - 97 + 0.5), b.y + s * (8 - +sq[1] + 0.5)];
  await p.mouse.click(...at(from)); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.mouse.click(...at(to)); await p.waitForTimeout(250);
}
const state = () => p.evaluate(() => ({
  banner: document.querySelector('.verdict-banner')?.innerText.replace(/\s+/g, ' '),
  pop: document.querySelector('.pop-line')?.innerText.replace(/\s+/g, ' '),
  mat: document.querySelector('.mat-chip, .material')?.innerText.replace(/\s+/g, ' '),
  glyphs: document.querySelectorAll('#board .cg-custom-svgs svg').length,
  marks: [...document.querySelectorAll('#board square.mark-bad, #board square.mark-good, #board square.mark-warn, #board square.mark-lost')].map((e) => e.className).join(','),
  fx: document.querySelector('#board').className,
}));
// 1) грубая ошибка: 1.e4 e5 2.♘f3 ♘c6 3.♗c4 ♘f6 — и белые ставят ферзя под удар 4.♕e2? нет — 4.♘g5 по теории; сделаем 4.♗xf7+? ♔xf7
await setGame({ side: 'w', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], cursor: 6 });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
await move('d1', 'e2'); await p.waitForTimeout(100);
console.log('ход ♕e2:', JSON.stringify(await state()));
await setGame({ side: 'w', sans: ['e4', 'e5', 'Nf3', 'd6'], cursor: 4 });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
await move('f3', 'g5'); await p.waitForTimeout(150);
console.log('ход ♘g5 (ферзь d8 бьёт):', JSON.stringify(await state()));
await p.screenshot({ path: dir + '/fx-blunder.png' });
await p.waitForTimeout(1200);
// 2) хороший ход по теории
await setGame({ side: 'w', sans: ['e4', 'e5'], cursor: 2 });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
await move('g1', 'f3'); await p.waitForTimeout(150);
console.log('ход ♘f3:', JSON.stringify(await state()));
await p.screenshot({ path: dir + '/fx-good.png' });
// 3) после размена — очки
await setGame({ side: 'w', sans: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'Bg4', 'h3', 'Bxf3', 'Qxf3'], cursor: 13 });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
console.log('очки после разменов:', JSON.stringify((await state()).mat));
await setGame({ side: 'b', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5'], cursor: 7 });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
console.log('очки (чёрные, пешка e5 съедена):', JSON.stringify((await state()).mat));
// 4) урок: неправильный ход
await p.goto(BASE + '#/learn/italian-pianissimo'); await p.waitForTimeout(700);
await (await p.$('#start'))?.click(); await p.waitForTimeout(300);
await p.click('#auto'); await p.waitForTimeout(500); await p.click('#opp'); await p.waitForTimeout(500);
await move('d1', 'h5'); await p.waitForTimeout(200);
console.log('урок ♕h5:', await p.evaluate(() => ({ msg: document.querySelector('.wrong-msg')?.className + ' | ' + document.querySelector('.wrong-msg .verdict-banner')?.innerText.replace(/\s+/g, ' '), glyphs: document.querySelectorAll('#board .cg-custom-svgs svg').length })));
await p.screenshot({ path: dir + '/fx-lesson-wrong.png' });
await p.waitForTimeout(5000);
console.log('через 5 с значков:', await p.evaluate(() => document.querySelectorAll('#board .cg-custom-svgs svg').length));
// популярность хода в уроке
await p.click('#auto'); await p.waitForTimeout(800);
console.log('урок, популярность ♘f3:', await p.evaluate(() => document.querySelector('.pop-line')?.innerText.replace(/\s+/g, ' ')), '| значок ★:', await p.evaluate(() => document.querySelectorAll('#board .cg-custom-svgs svg').length));
await p.screenshot({ path: dir + '/fx-lesson-pop.png' });
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
