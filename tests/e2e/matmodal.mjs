// Окно «Очки»: стоимость фигур и у кого перевес.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const errs = [];
const p = await (await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '#/');
await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'Bc4', 'Nf6', 'd3', 'Bg4', 'f3', 'Bxf3', 'Nxf3'], cursor: 13 })); });
await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
await p.click('.mat-chip'); await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/mat-modal.png' });
console.log(await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ')));
await p.click('[data-close]'); await p.waitForTimeout(300);
// уведомление со смешанным текстом
await p.goto(BASE + '#/profile'); await p.waitForTimeout(500);
await p.click('[data-profile="p2"]'); await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/toast.png' });
console.log('toast:', await p.$eval('.toast', (e) => getComputedStyle(e.firstElementChild).display + ' | ' + e.innerText));
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
