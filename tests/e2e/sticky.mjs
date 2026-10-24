// Телефон: доска закреплена под шапкой при прокрутке (урок и викторина).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
for (const [name, dev] of [['i13', devices['iPhone 13']], ['se', devices['iPhone SE']]]) {
  const p = await (await browser.newContext({ ...dev })).newPage();
  p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(name + ' ' + m.text()));
  await p.addInitScript(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('why-open', '1'); });
  await p.goto(BASE + '#/learn/italian-pianissimo'); await p.waitForTimeout(600);
  await (await p.$('#start'))?.click(); await p.waitForTimeout(300);
  await p.click('#auto'); await p.waitForTimeout(500); await p.click('#opp'); await p.waitForTimeout(500);
  const top0 = await p.evaluate(() => [document.querySelector('#topbar').offsetHeight, document.querySelector('#board').getBoundingClientRect().top]);
  await p.mouse.wheel(0, 400); await p.waitForTimeout(400);
  const after = await p.evaluate(() => [scrollY, document.querySelector('#board').getBoundingClientRect().top, document.querySelector('.move-card').getBoundingClientRect().top]);
  console.log(name, 'шапка', top0[0], 'доска до', Math.round(top0[1]), '| прокрутка', Math.round(after[0]), 'доска после', Math.round(after[1]), 'карточка', Math.round(after[2]));
  await p.screenshot({ path: `${dir}/sticky-${name}.png` });
  // сделать ход нажатиями на закреплённую доску после прокрутки: g1 → f3
  const box = await (await p.$('#board cg-board')).boundingBox();
  const sz = box.width / 8;
  const at = (sq) => [box.x + sz * (sq.charCodeAt(0) - 97 + 0.5), box.y + sz * (8 - +sq[1] + 0.5)];
  await p.mouse.click(...at('g1')); await p.waitForTimeout(150); await p.mouse.click(...at('f3')); await p.waitForTimeout(700);
  const head = await p.evaluate(() => document.querySelector('.move-head .san')?.textContent);
  console.log(name, 'после хода по закреплённой доске:', head);
  // викторина
  await p.goto(BASE + '#/quiz'); await p.waitForTimeout(700); await (await p.$('#start'))?.click(); await p.waitForTimeout(700);
  await p.mouse.wheel(0, 400); await p.waitForTimeout(400);
  const q = await p.evaluate(() => [scrollY, document.querySelector('#board').getBoundingClientRect().top]);
  console.log(name, 'викторина: прокрутка', Math.round(q[0]), 'доска', Math.round(q[1]));
  await p.screenshot({ path: `${dir}/sticky-quiz-${name}.png` });
}
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
