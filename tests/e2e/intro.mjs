// Экран «Идея дебюта» перед уроком и возврат к нему кнопкой ◀.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const out = OUT + '/shots';
const browser = await chromium.launch();
const errors = [];
for (const [name, dev] of [['phone', devices['iPhone 13']], ['laptop', { viewport: { width: 1280, height: 820 } }]]) {
  const page = await (await browser.newContext({ ...dev, colorScheme: 'light' })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '#/');
  await page.evaluate(() => localStorage.setItem('install-hint', '1'));
  await page.goto(base + '#/learn/scholars-attack');
  await page.waitForSelector('.intro-card');
  await page.waitForTimeout(500);
  const before = await page.locator('#board .cg-shapes g').count();
  await page.click('.idea-box .sq >> nth=0');
  await page.waitForTimeout(200);
  const during = await page.locator('#board .cg-shapes g').count();
  console.log(name, 'intro arrows:', before, '→ после нажатия на клетку:', during);
  await page.screenshot({ path: out + '/70-intro-' + name + '.png' });
  await page.click('#start');
  await page.waitForTimeout(300);
  console.log(name, 'после «Начать»:', (await page.locator('.move-head .san').first().innerText()), '| pieces on e2:', await page.evaluate(() => !!document.querySelector('cg-board piece')));
  await page.click('#prev');
  await page.waitForTimeout(200);
  console.log(name, 'назад → intro:', await page.locator('.intro-card').count());
}
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
