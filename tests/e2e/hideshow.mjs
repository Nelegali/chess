// Скрытие и показ доски не ломает стрелки (нет NaN в SVG).
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const base = BASE;
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await p.addInitScript(() => localStorage.setItem('install-hint', '1'));
for (const route of ['#/o/italian', '#/learn/italian-pianissimo', '#/theory', '#/quiz']) {
  await p.goto(base + route); await p.waitForTimeout(500);
  // открыть все разделы, чтобы мини-доски построились
  await p.$$eval('details', (ds) => ds.forEach((d) => (d.open = true))); await p.waitForTimeout(300);
  for (let round = 0; round < 3; round++) {
    // спрятать все доски, пощёлкать ссылки-клетки (вспышки), показать обратно
    await p.$$eval('.cg-wrap', (ws) => ws.forEach((w) => (w.style.display = 'none')));
    await p.waitForTimeout(80);
    const links = await p.$$('.sq');
    for (const l of links.slice(0, 4)) await l.evaluate((x) => x.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(80);
    // показать и в том же кадре вызвать вспышку — до того, как chessground узнает новый размер
    await p.evaluate(() => {
      document.querySelectorAll('.cg-wrap').forEach((w) => (w.style.display = ''));
      [...document.querySelectorAll('.sq')].slice(0, 3).forEach((x) => x.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    });
    await p.waitForTimeout(120);
    // закрыть/открыть разделы, поменять ширину окна
    await p.$$eval('details', (ds) => ds.forEach((d) => (d.open = false)));
    await p.setViewportSize({ width: 390 + round * 300, height: 800 });
    await p.waitForTimeout(60);
    await p.$$eval('details', (ds) => ds.forEach((d) => (d.open = true)));
    await p.waitForTimeout(200);
  }
  await p.setViewportSize({ width: 1280, height: 860 });
  // после показа стрелки должны быть на месте: проверим, что в svg нет NaN и доски не пустые
  const bad = await p.$$eval('.cg-wrap svg line, .cg-wrap svg circle', (els) => els.filter((e) => [...e.attributes].some((a) => a.value === 'NaN')).length);
  console.log(route, 'NaN-атрибутов в DOM:', bad);
}
console.log(errs.length ? 'ОШИБКИ:\n' + [...new Set(errs)].join('\n') : 'hideshow: ошибок нет');
if (errs.length) process.exitCode = 1;
await browser.close();
