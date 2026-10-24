// Строка популярности для редкого хода в светлой и тёмной теме.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark']]) {
  const p = await (await browser.newContext({ ...dev, colorScheme: scheme })).newPage();
  await p.goto(BASE + '#/');
  await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3'], cursor: 3 })); });
  await p.goto(BASE + '#/free'); await p.waitForTimeout(1200);
  await p.click('.pager-tab[data-go="0"]'); await p.waitForTimeout(500);
  const el = await p.$('.move-card');
  await el.screenshot({ path: OUT + '/popline-' + name + '.png' });
  console.log(name, await p.$eval('.pop-line', (e) => e.innerText.replace(/\s+/g, ' ')));
}
// редкий ход
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
await p.goto(BASE + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'a3'], cursor: 3 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(1200);
await p.click('.pager-tab[data-go="0"]'); await p.waitForTimeout(500);
await (await p.$('.move-card')).screenshot({ path: OUT + '/popline-rare.png' });
console.log('rare', await p.$eval('.pop-line', (e) => e.innerText.replace(/\s+/g, ' ')));
await browser.close();
