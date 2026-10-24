// Сравнение ходов «почему хуже» со схемой на доске (Lichess подменён).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const out = OUT + '/shots';
const browser = await chromium.launch();
const errors = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' })).newPage();
p.on('pageerror', (e) => errors.push(e.message));
// Lichess недоступен из песочницы — подставляем ответ Opening Explorer
await p.route('https://explorer.lichess.ovh/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ white: 400, draws: 50, black: 380, opening: { name: "King's Pawn Game" }, moves: [
    { uci: 'g1f3', san: 'Nf3', white: 300, draws: 30, black: 250 }, { uci: 'f1c4', san: 'Bc4', white: 50, draws: 10, black: 60 },
    { uci: 'd1h5', san: 'Qh5', white: 30, draws: 5, black: 40 }, { uci: 'f2f4', san: 'f4', white: 20, draws: 5, black: 30 } ] }) }));
await p.goto(base + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('chess-openings-settings-v1', JSON.stringify({ lichessToken: 'lip_test' })); });
await p.goto(base + '#/learn/italian-pianissimo');
await p.waitForSelector('#board cg-board');
for (let i = 0; i < 3; i++) { await p.click('#next'); await p.waitForTimeout(40); }
// сравнение для ♘a3 (если есть) или первого варианта
const sans = await p.locator('.wn-item .wn-san').allInnerTexts();
console.log('варианты:', sans.join(', '));
await p.click('[data-peek="0"]');
await p.waitForTimeout(600);
console.log('сравнение досок:', await p.locator('.wn-compare .wn-preview-board').count(), '| подписи:', (await p.locator('.wn-compare').first().innerText()).replace(/\n+/g, ' | ').slice(0, 300));
// стрелки на мини-доске: координаты не нулевые
console.log('стрелки мини-доски:', await p.evaluate(() => [...document.querySelectorAll('.wn-compare .cg-shapes line')].map((l) => l.getAttribute('x1') + ',' + l.getAttribute('y1') + '→' + l.getAttribute('x2') + ',' + l.getAttribute('y2')).slice(0, 3).join(' ')));
await p.locator('.wn-compare').first().scrollIntoViewIfNeeded();
await p.screenshot({ path: out + '/a0-compare.png' });
// статистика Lichess
await p.click('#explorer-toggle');
await p.waitForSelector('.ex-row');
await p.click('.ex-row >> nth=2');
await p.waitForTimeout(300);
console.log('разбор Qh5:', (await p.locator('.ex-detail').innerText()).replace(/\n+/g, ' | '));
await p.click('.ex-detail [data-peek]');
await p.waitForTimeout(500);
await p.locator('.ex-detail').scrollIntoViewIfNeeded();
await p.screenshot({ path: out + '/a1-explorer.png' });
// теория: схема в закрытом разделе рисуется при раскрытии
await p.goto(base + '#/o/london');
await p.waitForTimeout(300);
await p.click('summary:has-text("В чём суть")');
await p.waitForTimeout(500);
console.log('схема после раскрытия, стрелки:', await p.evaluate(() => [...document.querySelectorAll('.diagram .cg-shapes line')].map((l) => l.getAttribute('x1')).join(',')));
console.log(errors.length ? errors.join('\n') : 'no errors');
if (errors.length) process.exitCode = 1;
await browser.close();
