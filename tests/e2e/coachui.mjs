// Объяснения тренера при неправильном ходе в уроке и тренировке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const out = OUT + '/shots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(base + '#/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('install-hint', '1'); });
async function clickSq(sq, orient = 'white') {
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(50);
  const box = await page.locator('#board cg-board').boundingBox();
  const s = box.width / 8, f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
  const x = orient === 'white' ? box.x + s * (f + 0.5) : box.x + s * (7 - f + 0.5);
  const y = orient === 'white' ? box.y + s * (7 - r + 0.5) : box.y + s * (r + 0.5);
  await page.mouse.click(x, y); await page.waitForTimeout(120);
}
await page.goto(base + '#/learn/italian-pianissimo');
await page.waitForSelector('#board cg-board');
for (let i = 0; i < 7; i++) { await page.click('#next'); await page.waitForTimeout(40); }
// позиция после 3...Bc5, ход белых c3
await page.waitForTimeout(400);
const t0 = Date.now();
console.log('whynot items:', await page.locator('.wn-item').count(), 'render ms ~', Date.now() - t0);
await page.locator('.alts').scrollIntoViewIfNeeded();
await page.screenshot({ path: out + '/50-alt-card.png' });
await page.locator('.whynot').scrollIntoViewIfNeeded();
await page.screenshot({ path: out + '/51-whynot.png' });
console.log((await page.locator('.wn-list').innerText()).replace(/\n+/g, ' | ').slice(0, 600));
// показать на доске
await page.click('[data-wn="1"]');
await page.waitForTimeout(300);
await page.click('#next'); await page.waitForTimeout(150); await page.click('#next'); await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: out + '/52-demo.png' });
console.log('demo:', (await page.locator('.alt-card, .move-card.alt-card').first().innerText()).replace(/\n+/g, ' | ').slice(0, 300));
await page.click('#back-main');
// неверный ход: 4.Ng5?? (f3-g5)
await clickSq('f3'); await clickSq('g5');
await page.waitForTimeout(300);
console.log('wrong:', (await page.locator('.wrong-msg').innerText()).replace(/\n+/g, ' | '));
await page.locator('.wrong-msg').scrollIntoViewIfNeeded();
await page.screenshot({ path: out + '/53-wrong.png' });
// режим угроз
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('#insight-btn');
await page.waitForTimeout(300);
console.log('insight squares:', await page.locator('cg-board square.opp-move').count(), 'attacked:', await page.locator('cg-board square.attacked, cg-board square.guarded').count());
await page.screenshot({ path: out + '/54-insight.png' });
await clickSq('c5'); // чёрный слон
await page.waitForTimeout(300);
console.log('focus squares:', await page.locator('cg-board square.opp-move.strong').count(), 'focus:', await page.locator('cg-board square.opp-focus').count());
await page.screenshot({ path: out + '/55-focus.png' });
// тренировка: ошибка
await page.goto(base + '#/drill/london-main');
await page.waitForTimeout(1200);
await clickSq('e2'); await clickSq('e3'); // ошибка: e3 до Bf4
await page.waitForTimeout(300);
console.log('drill wrong:', (await page.locator('.wrong-msg').innerText()).replace(/\n+/g, ' | '));
await page.locator('.wrong-msg').scrollIntoViewIfNeeded();
await page.screenshot({ path: out + '/56-drill-wrong.png' });
const p2 = await (await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' })).newPage();
await p2.goto(base + '#/learn/italian-pianissimo');
await p2.evaluate(() => localStorage.setItem('install-hint', '1'));
for (let i = 0; i < 17; i++) { await p2.click('#next'); await p2.waitForTimeout(30); }
await p2.waitForTimeout(500);
await p2.screenshot({ path: out + '/57-italian-final.png' });
console.log('final:', (await p2.locator('.move-card').innerText()).replace(/\n+/g, ' | '));
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
