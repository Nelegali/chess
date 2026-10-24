// Популярность сделанного хода в свободной игре и в уроке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(m.text()));
await p.goto(BASE + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'b', sans: [], cursor: 0 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(1500);
const cands = () => p.$$eval('.cand', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
console.log('старт (ход белых-соперника):', await cands());
console.log('подпись:', await p.$eval('.cands .muted.small', (e) => e.innerText).catch(() => '-'));
await p.screenshot({ path: dir + '/pop-free.png' });
await p.click('.cand >> nth=0'); await p.waitForTimeout(400);
await p.click('#free-hint'); await p.waitForTimeout(1200);
console.log('подсказка после 1.e4:', await cands());
// урок: статистика в блоке Lichess
await p.goto(BASE + '#/learn/italian-pianissimo'); await p.waitForTimeout(600);
await (await p.$('#start'))?.click(); await p.waitForTimeout(300);
for (let i = 0; i < 4; i++) { await p.click('#next'); await p.waitForTimeout(60); }
await p.click('#explorer-toggle'); await p.waitForTimeout(1500);
console.log('урок:', await p.$eval('#explorer-body', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 300)));
await p.$eval('#explorer-body', (e) => e.scrollIntoView());
await p.screenshot({ path: dir + '/pop-learn.png' });
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
