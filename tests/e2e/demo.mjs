// Показ варианта «а что если» на доске (анимация ходов) на ноутбуке и телефоне.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const out = OUT + '/shots';
const browser = await chromium.launch();
const errors = [];
for (const [name, dev] of [['laptop', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
  const p = await (await browser.newContext({ ...dev, colorScheme: 'light' })).newPage();
  p.on('pageerror', (e) => errors.push(name + ' ' + e.message));
  await p.goto(base + '#/learn/italian-vs-two-knights');
  await p.evaluate(() => localStorage.setItem('install-hint', '1'));
  await p.waitForSelector('#board cg-board');
  for (let i = 0; i < 5; i++) { await p.click('#next'); await p.waitForTimeout(40); }
  const items = await p.locator('.wn-item .wn-san').allInnerTexts();
  console.log(name, 'варианты:', items.join(', '));
  const idx = items.findIndex((t) => t.includes('xe5'));
  const pieces = () => p.evaluate(() => document.querySelectorAll('#board cg-board piece').length);
  console.log(name, 'фигур до:', await pieces());
  await p.click('[data-wn="' + idx + '"]');
  await p.waitForTimeout(700);
  console.log(name, 'через 0.7с:', (await p.locator('.alt-card .move-head').innerText()).replace(/\n/g, ' '), '| фигур:', await pieces());
  await p.waitForTimeout(1600);
  console.log(name, 'через 2.3с:', (await p.locator('.alt-card .move-head').innerText()).replace(/\n/g, ' '), '| фигур:', await pieces(), '| scrollY:', await p.evaluate(() => Math.round(scrollY)));
  await p.screenshot({ path: out + '/95-demo-' + name + '.png' });
  // вернуться и открыть «а если бы соперник сыграл иначе» после 3...Bc5
  await p.click('#back-main');
  await p.click('#auto'); await p.waitForTimeout(200); await p.click('#opp'); await p.waitForTimeout(200);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
