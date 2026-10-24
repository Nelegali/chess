// Викторина: правильный ход на доске засчитывается (20 вопросов).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
let ok = 0, fail = 0;
for (let round = 0; round < 4; round++) {
  await page.goto(BASE + '#/'); await page.goto(BASE + '#/quiz'); await page.click('#start');
  for (let q = 0; q < 10; q++) {
    const opt = await page.$('.opt');
    if (opt) { await opt.click(); }
    else {
      await page.waitForTimeout(100);
      const box = await page.locator('#board cg-board').boundingBox();
      const sz = box.width / 8; let moved = null;
      for (let r = 0; r < 8 && !moved; r++) for (let f = 0; f < 8 && !moved; f++) {
        await page.mouse.click(box.x + sz * (f + 0.5), box.y + sz * (r + 0.5)); await page.waitForTimeout(60);
        const d = await page.$('square.move-dest');
        if (d) { const b = await d.boundingBox(); moved = [r,f,b.x,b.y]; await page.mouse.click(b.x + b.width/2, b.y + b.height/2); }
      }
      const has = await page.waitForSelector('#nextq', { timeout: 1500 }).then(() => true).catch(() => false);
      if (has) ok++; else { fail++; console.log('FAIL q', q+1, JSON.stringify(moved), await page.locator('#q').innerText()); await page.screenshot({path: OUT + '/qfail.png'}); }
      if (!has) break;
    }
    await page.click('#nextq');
  }
}
console.log('move questions ok', ok, 'fail', fail);
if (fail) process.exitCode = 1;
await browser.close();
