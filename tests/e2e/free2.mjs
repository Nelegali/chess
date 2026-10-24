// Свободная игра без статистики: тренер предлагает разумные ходы, случайные ответы.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '#/');
// без Lichess, позиция вне теории: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.h4 — ход чёрных
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'h4'], cursor: 7 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(1500);
const rows = await p.$$eval('.cand', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
console.log('кандидаты:', rows);
console.log('карточка:', await p.$eval('.move-card', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 200)));
const t0 = Date.now();
for (let k = 0; k < 6; k++) { await p.waitForSelector('#free-random:not([disabled]), #free-hint, .prompt.done'); const b = await p.$('#free-random:not([disabled])'); if (!b) { await p.click('#free-hint'); await p.waitForTimeout(400); const c = await p.$('.cand'); if (c) await c.click(); else break; } else await b.click(); await p.waitForTimeout(500); }
console.log('после 6 полуходов:', await p.$eval('.ml', (e) => e.innerText.replace(/\s+/g, ' ')), Date.now() - t0, 'ms');
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
