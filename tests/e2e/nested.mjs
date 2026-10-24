// В разметке нет кнопок внутри кнопок.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
const bad = [];
const check = async (where) => {
  const r = await p.evaluate(() => ({
    nested: [...document.querySelectorAll('button button, button a, a button, a a')].map((e) => e.outerHTML.slice(0, 80)),
    orphanIdeas: [...document.querySelectorAll('.c-idea')].filter((e) => !e.closest('.cand')).length,
  }));
  if (r.nested.length || r.orphanIdeas) bad.push(`${where}: ${r.nested.length} вложенных, ${r.orphanIdeas} причин вне карточек ${r.nested.slice(0, 2).join(' ')}`);
};
await p.goto(BASE + '#/');
await p.evaluate(() => localStorage.setItem('install-hint', '1'));
// свободная игра: много позиций, ходы соперника и подсказки
const games = [['e4'], ['e4', 'e5'], ['e4', 'e5', 'Nf3'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], ['d4'], ['d4', 'd5', 'c4'], ['e4', 'c5'], ['e4', 'e6'], ['e4', 'c6', 'd4'], ['c4'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']];
for (const sans of games) {
  for (const side of ['w', 'b']) {
    await p.goto(BASE + '#/');
    await p.evaluate(([sans, side]) => localStorage.setItem('free-game', JSON.stringify({ side, sans, cursor: sans.length })), [sans, side]);
    await p.goto(BASE + '#/free'); await p.waitForTimeout(500);
    const hint = await p.$('#free-hint'); if (hint) { await hint.click(); await p.waitForTimeout(400); }
    await check(`free ${side} ${sans.join(' ')}`);
  }
}
// уроки: все шаги с «почему не по-другому» и статистикой
await p.evaluate(() => localStorage.setItem('why-open', '1'));
for (const id of ['italian-pianissimo', 'sicilian-najdorf', 'london-main', 'caro-classical', 'ruy-closed']) {
  await p.goto(BASE + '#/learn/' + id); await p.waitForTimeout(400);
  await (await p.$('#start'))?.click();
  for (let k = 0; k < 20; k++) {
    await check(`learn ${id} ${k}`);
    const t = await p.$('#explorer-toggle'); if (t && k === 3) { await t.click(); await p.waitForTimeout(400); await check(`learn ${id} explorer`); }
    const n = await p.$('#next:not([disabled])'); if (!n) break; await n.click(); await p.waitForTimeout(80);
  }
}
for (const r of ['#/', '#/o/italian', '#/theory', '#/profile', '#/review']) { await p.goto(BASE + r); await p.waitForTimeout(400); await check(r); }
if (bad.length) process.exitCode = 1;
console.log(bad.length ? 'ПРОБЛЕМЫ:\n' + bad.slice(0, 15).join('\n') : 'вложенных кнопок нет — разметка в порядке');
await browser.close();
