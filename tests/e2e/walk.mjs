// Проходит все варианты всех дебютов в режиме изучения, потом викторину: на страницах нет ошибок.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const { allLines } = await import(ROOT_URL + 'public/js/openings.js');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(page.url() + ' PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(page.url() + ' ' + m.text()); });
let alts = 0;
for (const { opening, line } of allLines()) {
  await page.goto(base + '#/o/' + opening.id);
  await page.goto(base + '#/learn/' + line.id);
  await page.waitForSelector('#board cg-board');
  for (let i = 0; i < 60; i++) {
    const altBtns = await page.$$('[data-alt]');
    for (let k = 0; k < altBtns.length; k++) {
      await page.click('[data-alt="' + k + '"]');
      alts++;
      for (let j = 0; j < 20; j++) { const n = await page.$('#next:not([disabled])'); if (!n) break; await n.click(); }
      await page.click('#back-main');
    }
    const n = await page.$('#next:not([disabled])');
    if (!n) break;
    await n.click();
  }
  const fin = await page.$('#finish');
  if (!fin) errors.push(line.id + ': нет кнопки Завершить');
  else { await fin.click(); await page.waitForSelector('.modal'); }
  // тренировка: отвечаем через «Показать ход» + клик по стрелке невозможен, поэтому проверяем, что старт без ошибок
  await page.goto(base + '#/drill/' + line.id);
  await page.waitForTimeout(900);
}
await page.goto(base + '#/review'); await page.waitForTimeout(300);
await page.goto(base + '#/quiz'); await page.click('#start');
for (let q = 0; q < 10; q++) {
  const opt = await page.$('.opt');
  if (opt) await opt.click();
  else {
    // ход на доске: ищем любую свою фигуру с доступными ходами
    const box = await page.locator('#board cg-board').boundingBox();
    const sz = box.width / 8;
    let moved = false;
    for (let r = 0; r < 8 && !moved; r++) for (let f = 0; f < 8 && !moved; f++) {
      await page.mouse.click(box.x + sz * (f + 0.5), box.y + sz * (r + 0.5));
      // доска перерисовывается в следующем кадре — ждём его, иначе увидим подсветку прошлой фигуры
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const d = await page.$('square.move-dest');
      if (d) { const b = await d.boundingBox(); await page.mouse.click(b.x + b.width/2, b.y + b.height/2); moved = true; }
    }
    if (!moved) errors.push('quiz: нет ходов на вопросе ' + (q+1));
  }
  await page.waitForSelector('#nextq', { timeout: 3000 }).catch(() => errors.push('quiz: нет кнопки дальше на вопросе ' + (q+1)));
  await page.click('#nextq').catch(() => {});
}
await page.waitForTimeout(400);
await page.screenshot({path: OUT + '/quizend.png'}); console.log('Результат викторины:', await page.locator('h1').first().innerText({timeout: 3000}).catch(e => 'нет h1: ' + errors.join(' | ')));
await page.goto(base + '#/profile'); await page.waitForTimeout(300);
console.log('Изучено:', await page.locator('.stat').nth(1).innerText());
console.log('alts:', alts);
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
