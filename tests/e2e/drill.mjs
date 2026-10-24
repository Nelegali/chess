// Тренировка и повторение на ноутбуке и телефоне: оценка, подсказки, интервалы.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const { Chess } = await import(ROOT_URL + 'public/vendor/chess.js');
const { findLine, lineSide } = await import(ROOT_URL + 'public/js/openings.js');
const base = BASE;
const browser = await chromium.launch();
const errors = [];
async function newDevice(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR ' + e.message));
  return page;
}
async function clickSq(page, sq, orient) {
  const box = await page.locator('#board cg-board').boundingBox();
  const s = box.width / 8, f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
  const x = orient === 'white' ? box.x + s * (f + 0.5) : box.x + s * (7 - f + 0.5);
  const y = orient === 'white' ? box.y + s * (7 - r + 0.5) : box.y + s * (r + 0.5);
  await page.mouse.click(x, y); await page.waitForTimeout(80);
}
async function playDrill(page, lineId, wrongAt = -1) {
  const { opening, line } = findLine(lineId);
  const side = lineSide(opening, line);
  const orient = side === 'w' ? 'white' : 'black';
  await page.goto(base + '#/drill/' + lineId);
  const c = new Chess();
  let mine = 0;
  for (const s of line.steps) {
    const m = c.move(s.m.replace(/[!?]+$/, ''));
    if (m.color !== side) continue;
    await page.waitForFunction(() => document.querySelector('.prompt.mine'), null, { timeout: 5000 });
    if (mine === wrongAt) {
      // нарочно ошибаемся: ход любой пешкой a/h
      const alt = new Chess(c.fen()); alt.undo();
      const before = new Chess(); for (const x of c.history().slice(0, -1)) before.move(x);
      const wrong = before.moves({ verbose: true }).find((x) => !(x.from === m.from && x.to === m.to));
      await clickSq(page, wrong.from, orient); await clickSq(page, wrong.to, orient);
      await page.waitForTimeout(200);
    }
    await clickSq(page, m.from, orient); await clickSq(page, m.to, orient);
    mine++;
  }
  await page.waitForSelector('.modal .result', { timeout: 8000 });
  return (await page.locator('.modal .result').innerText()).replace(/\s+/g, ' ');
}
const phone = await newDevice('phone');
await phone.goto(base);
console.log('W perfect :', await playDrill(phone, 'london-main'));
console.log('B 1 error :', await playDrill(phone, 'caro-classical', 2));
console.log('castle O-O-O:', await playDrill(phone, 'scholars-defense'));
await phone.goto(base + '#/');
// синхронизация: телефон
await phone.goto(base + '#/profile');
await phone.waitForSelector('#sync-key');
await phone.fill('#sync-key', 'моя-секретная-фраза');
await phone.click('#sync-save');
await phone.waitForTimeout(1500);
console.log('phone sync:', await phone.locator('#sync-status').innerText());
// ноутбук
const laptop = await newDevice('laptop');
await laptop.goto(base + '#/profile');
await laptop.waitForSelector('#sync-key');
await laptop.fill('#sync-key', 'моя-секретная-фраза');
await laptop.click('#sync-save');
await laptop.waitForTimeout(1500);
console.log('laptop stats after sync:', (await laptop.locator('.stats').innerText()).replace(/\s+/g, ' '));
await laptop.goto(base + '#/review');
await laptop.waitForTimeout(400);
console.log('laptop review:', (await laptop.locator('.review-hero').innerText()).replace(/\s+/g, ' ').slice(0, 120));
await phone.goto(base + '#/drill/italian-pianissimo');
await phone.waitForTimeout(700);
await phone.screenshot({ path: OUT + '/shots/30-drill-mobile.png' });
await phone.goto(base + '#/learn/sicilian-najdorf');
await phone.waitForTimeout(500);
for (let i = 0; i < 9; i++) { await phone.click('#next'); await phone.waitForTimeout(50); }
await phone.waitForTimeout(400);
await phone.screenshot({ path: OUT + '/shots/31-learn-mobile.png' });
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
