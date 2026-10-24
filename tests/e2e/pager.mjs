// Свободная игра: страницы-свайпы на телефоне и раскладка без свайпов на ноутбуке.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(m.text()));
await p.goto(BASE + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5'], cursor: 2 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
const st = () => p.evaluate(() => {
  const pager = document.querySelector('#pager');
  return { tab: document.querySelector('.pager-tab.on')?.innerText, scrollLeft: Math.round(pager.scrollLeft), w: pager.clientWidth, h: pager.style.height, arrows: document.querySelectorAll('#board svg.cg-shapes line').length, top: document.querySelector('.pager-tabs').getBoundingClientRect().top|0 };
});
console.log('мой ход, разбор:', JSON.stringify(await st()));
await p.screenshot({ path: dir + '/pg-0.png' });
// свайп на «Что играть»
await p.evaluate(() => { const pg = document.querySelector('#pager'); pg.scrollLeft = pg.clientWidth; });
await p.waitForTimeout(400);
console.log('после свайпа:', JSON.stringify(await st()));
await p.screenshot({ path: dir + '/pg-1.png' });
// сделать ход ♘f3 по доске
const b = await (await p.$('#board cg-board')).boundingBox(); const s = b.width / 8;
const at = (sq) => [b.x + s * (sq.charCodeAt(0) - 97 + 0.5), b.y + s * (8 - +sq[1] + 0.5)];
await p.mouse.click(...at('g1')); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await p.mouse.click(...at('f3')); await p.waitForTimeout(800);
console.log('после ♘f3 (ответ соперника):', JSON.stringify(await st()), await p.evaluate(() => document.querySelector('.last-sum')?.innerText.replace(/\s+/g, ' ')));
await p.screenshot({ path: dir + '/pg-2.png' });
// вкладка «Партия»
await p.click('.pager-tab[data-go="2"]'); await p.waitForTimeout(700);
console.log('вкладка партия:', JSON.stringify(await st()));
await p.screenshot({ path: dir + '/pg-3.png' });
// нажать на строку оценки → разбор
await p.click('.pager-tab[data-go="1"]'); await p.waitForTimeout(700);
await p.click('.last-sum'); await p.waitForTimeout(700);
console.log('разбор по нажатию на оценку:', JSON.stringify(await st()));
// выбрать ответ соперника из списка
await p.click('.pager-tab[data-go="1"]'); await p.waitForTimeout(700);
await p.click('.cand >> nth=0'); await p.waitForTimeout(700);
console.log('после ответа соперника:', JSON.stringify(await st()));
// ошибка → сразу разбор
await p.goto(BASE + '#/'); await p.evaluate(() => localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3', 'd6'], cursor: 4 })));
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
const b2 = await (await p.$('#board cg-board')).boundingBox();
const at2 = (sq) => [b2.x + s * (sq.charCodeAt(0) - 97 + 0.5), b2.y + s * (8 - +sq[1] + 0.5)];
await p.mouse.click(...at2('f3')); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await p.mouse.click(...at2('g5')); await p.waitForTimeout(800);
console.log('после ошибки ♘g5:', JSON.stringify(await st()));
await p.screenshot({ path: dir + '/pg-4.png' });
// ноутбук: вкладок нет, всё одной страницей
const d = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
d.on('pageerror', (e) => errs.push('desk ' + e.message));
await d.goto(BASE + '#/'); await d.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3'], cursor: 3 })); });
await d.goto(BASE + '#/free'); await d.waitForTimeout(900);
console.log('ноутбук:', await d.evaluate(() => ({ tabs: getComputedStyle(document.querySelector('.pager-tabs')).display, pages: [...document.querySelectorAll('.page')].map((x) => getComputedStyle(x).display).join(','), height: document.querySelector('#pager').style.height, cands: document.querySelectorAll('.cand').length })));
await d.screenshot({ path: dir + '/pg-desk.png' });
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
