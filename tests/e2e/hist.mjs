// Профиль: история «когда и что пройдено» и список пройденных вариантов.
import { chromium, devices, BASE, OUT, ROOT_URL } from './lib.mjs';
const { allLines } = await import(ROOT_URL + 'public/js/openings.js');
const ids = allLines().map((x) => x.line.id);
const browser = await chromium.launch();
const errs = [];
const DAY = 86400000;
const now = Date.now();
const day = (off) => { const d = new Date(now - off * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sic = ids.find((x) => x.startsWith('sicilian'));
const progress = {
  v: 1, updatedAt: now, xp: 420, quizBest: 7,
  days: { [day(0)]: 85, [day(1)]: 40, [day(3)]: 30, [day(9)]: 30 },
  learned: { 'italian-pianissimo': now - 3 * DAY, [sic]: now - DAY, 'london-main': now - 9 * DAY },
  cards: {
    'italian-pianissimo': { box: 2, due: day(-3), reps: 2, lapses: 0, last: now - 2 * 3600e3, best: 0 },
    [sic]: { box: 0, due: day(0), reps: 0, lapses: 0, last: now - DAY, best: null },
    'london-main': { box: 1, due: day(1), reps: 1, lapses: 0, last: now - 9 * DAY + 3600e3, best: 2 },
  },
  achievements: { 'first-line': now - 9 * DAY + 1000 },
  log: [
    { t: now - 3 * DAY, k: 'learn', id: 'italian-pianissimo', first: true, xp: 30 },
    { t: now - DAY, k: 'learn', id: sic, first: true, xp: 30 },
    { t: now - DAY + 600e3, k: 'quiz', c: 2, n: 10, xp: 10 },
    { t: now - 3 * 3600e3, k: 'drill', id: 'italian-pianissimo', e: 1, b: 1, xp: 15 },
    { t: now - 2 * 3600e3, k: 'drill', id: 'italian-pianissimo', e: 0, b: 2, xp: 35 },
    { t: now - 3600e3, k: 'quiz', c: 7, n: 10, xp: 35 },
  ],
};
for (const [name, dev] of [['phone', devices['iPhone 13']], ['desk', { viewport: { width: 1280, height: 860 } }]]) {
  const p = await (await browser.newContext(dev)).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate((pr) => { localStorage.setItem('install-hint', '1'); localStorage.setItem('chess-openings-progress-v1', JSON.stringify(pr)); }, progress);
  await p.goto(BASE + '#/profile');
  await p.reload();
  await p.waitForTimeout(900);
  const info = await p.evaluate(() => ({
    days: [...document.querySelectorAll('.hist-day h3')].map((h) => h.innerText.replace(/\s+/g, ' ')),
    items: [...document.querySelectorAll('.hist-item')].map((h) => h.innerText.replace(/\s+/g, ' ')),
    done: [...document.querySelectorAll('.done-row')].map((h) => h.innerText.replace(/\s+/g, ' ')),
    more: !!document.querySelector('#hist-more'),
  }));
  if (name === 'phone') console.log(JSON.stringify(info, null, 1));
  await p.evaluate(() => document.querySelector('#history').scrollIntoView());
  await p.waitForTimeout(300);
  await p.screenshot({ path: `hist-${name}.png` });
  await p.evaluate(() => document.querySelector('#done-lines').scrollIntoView());
  await p.waitForTimeout(300);
  await p.screenshot({ path: `hist-${name}-done.png` });
  // нажатие на день в календаре
  await p.evaluate(() => document.querySelector('.heat').scrollIntoView());
  await p.click(`.heat i[data-day="${day(9)}"]`);
  await p.waitForTimeout(900);
  console.log(name, 'клик по дню 9 дней назад → видно:', await p.evaluate((k) => { const el = document.querySelector(`[data-hday="${k}"]`); if (!el) return 'нет'; const r = el.getBoundingClientRect(); return `${el.querySelector('h3').innerText.replace(/\s+/g, ' ')} top=${Math.round(r.top)} flash=${el.classList.contains('flash')}`; }, day(9)));
}
console.log(errs.length ? errs : 'no errors');
if (errs.length) process.exitCode = 1;
await browser.close();
