// Подпись «Очки» (материал) на телефоне и ноутбуке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const errs = [];
for (const [name, dev] of [['phone', devices['iPhone 13']], ['laptop', { viewport: { width: 1280, height: 860 } }]]) {
  const p = await (await browser.newContext({ ...dev })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '#/');
  await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'Nxe5'], cursor: 9 })); });
  await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
  console.log(name, 'чип:', await p.$eval('.mat-chip', (e) => e.innerText.replace(/\s+/g, ' ')), '| ширина', await p.$eval('.mat-chip', (e) => Math.round(e.getBoundingClientRect().width)), '| строка влезает:', await p.evaluate(() => { const r = document.querySelector('.board-tools').getBoundingClientRect(); return r.right <= innerWidth; }));
  await p.click('.mat-chip'); await p.waitForTimeout(500);
  console.log(name, 'пояснение:', (await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' '))).slice(0, 80));
  await p.screenshot({ path: OUT + '/chip-' + name + '.png' });
}
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
