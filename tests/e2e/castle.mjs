// Рокировка перетаскиванием короля в уроке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE + '#/learn/italian-pianissimo'); await p.waitForSelector('#board cg-board');
for (let i = 0; i < 11; i++) { await p.click('#next'); await p.waitForTimeout(40); } // интро + 10 полуходов → ход 6. O-O
console.log('подсказка:', (await p.locator('.prompt.mine > div').first().innerText()).slice(0, 80));
const box = await p.locator('#board cg-board').boundingBox(); const s = box.width / 8;
const at = (f, r) => [box.x + s * (f + 0.5), box.y + s * (7 - r + 0.5)];
await p.mouse.move(...at(4, 0)); await p.mouse.down(); await p.mouse.move(...at(6, 0), { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(400);
console.log('после перетаскивания короля e1→g1:', await p.locator('.move-head .san').first().innerText(), '| ладья на f1:', await p.evaluate(() => [...document.querySelectorAll('cg-board piece.rook.white')].length));
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
