// Широкая раскладка свободной игры на ноутбуке (без вертикальной прокрутки).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const errs = [];
for (const [name, vp] of [['wide', { width: 1440, height: 900 }], ['mid', { width: 1024, height: 768 }]]) {
  const p = await (await browser.newContext({ viewport: vp })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '#/');
  await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4'], cursor: 1 })); });
  await p.goto(BASE + '#/free'); await p.waitForTimeout(1200);
  const m = () => p.evaluate(() => {
    const bar = document.querySelector('.actionbar').getBoundingClientRect();
    const pages = [...document.querySelectorAll('.page')].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
    // перекрытие: панель кнопок поверх страниц?
    const overlap = pages.some(([l, t, w, h]) => !(bar.bottom <= t || bar.top >= t + h || bar.right <= l || bar.left >= l + w));
    return { scrollH: document.documentElement.scrollHeight, vh: innerHeight, bar: [Math.round(bar.top), Math.round(bar.bottom)], pages: JSON.stringify(pages), overlap, pagerH: document.querySelector('#pager').style.height };
  });
  console.log(name, 'до:', JSON.stringify(await m()));
  await p.click('.why-more summary'); await p.waitForTimeout(400);
  console.log(name, 'после «Почему?»:', JSON.stringify(await m()));
  await p.screenshot({ path: OUT + '/desk-' + name + '.png' });
}
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
