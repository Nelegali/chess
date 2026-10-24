// «🏆 Лучшие» ходы от Stockfish и оценка сделанного хода.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const dir = OUT;
const browser = await chromium.launch();
const errs = [];
for (const [name, dev] of [['phone', devices['iPhone 13']], ['laptop', { viewport: { width: 1440, height: 900 } }]]) {
  const p = await (await browser.newContext({ ...dev })).newPage();
  p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_/.test(m.text()) && errs.push(name + ' ' + m.text()));
  await p.goto(BASE + '#/');
  await p.evaluate(() => { localStorage.setItem('install-hint', '1'); localStorage.setItem('free-game', JSON.stringify({ side: 'w', sans: ['e4', 'e5', 'Nf3'], cursor: 3 })); });
  await p.goto(BASE + '#/free'); await p.waitForTimeout(900);
  const rows = () => p.$$eval('.cand', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 120)));
  console.log(name, 'популярные:', JSON.stringify((await rows()).slice(0, 3)));
  if (name === 'phone') { await p.click('.pager-tab[data-go="1"]'); await p.waitForTimeout(400); }
  const t0 = Date.now();
  await p.click('.list-mode [data-mode="best"]');
  await p.waitForSelector('.c-chip.e-best', { timeout: 30000 });
  console.log(name, 'движок за', Date.now() - t0, 'мс; лучшие:', JSON.stringify((await rows()).slice(0, 4)));
  await p.screenshot({ path: `${dir}/best-${name}.png` });
  // сыграть ответ соперника ♘c6 и сделать свой ход — разбор покажет оценку движка
  await p.click('.cand >> nth=0'); await p.waitForTimeout(600);
  // ждём, пока движок посчитает позицию перед своим ходом
  await p.waitForFunction(() => !document.querySelector('.engine-busy') && document.querySelector('.c-chip.e-best'), null, { timeout: 30000 }).catch(() => {});
  const b = await (await p.$('#board cg-board')).boundingBox(); const s = b.width / 8;
  const at = (sq) => [b.x + s * (sq.charCodeAt(0) - 97 + 0.5), b.y + s * (8 - +sq[1] + 0.5)];
  await p.mouse.click(...at('h2')); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.mouse.click(...at('h3')); await p.waitForTimeout(800);
  if (name === 'phone') { await p.click('.pager-tab[data-go="0"]'); await p.waitForTimeout(400); }
  console.log(name, 'разбор h3:', await p.$eval('.eng-note', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => 'нет строки движка'));
  await p.screenshot({ path: `${dir}/best-${name}-2.png` });
}
console.log(errs.length ? errs.join('\n') : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
