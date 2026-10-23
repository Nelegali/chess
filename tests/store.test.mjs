// Юнит-тесты логики прогресса: интервальные повторения, уровни, серия дней, объединение копий.
// Запуск: node tests/store.test.mjs
import * as store from '../public/js/store.js';

let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '✓ ' : '✗ ') + name);
  if (!cond) failed++;
};

store.resetProgress();
const id = 'italian-pianissimo';

// Изучение создаёт карточку на сегодня
store.markLearned(id);
check('после изучения вариант «изучаю» и стоит в повторении на сегодня', store.lineStatus(id) === 'learning' && store.isDue(id));

// Без ошибок: 0 → 1, повторение завтра
let r = store.recordDrill(id, 0, 0);
check('без ошибок: ступень 0 → 1, следующее завтра', r.before === 0 && r.after === 1 && r.due === store.today(1));
check('после тренировки карточка сегодня уже не к повторению', !store.isDue(id));

// Повтор раньше срока без ошибок не двигает карточку
r = store.recordDrill(id, 0, 0);
check('повтор раньше срока не повышает ступень', r.after === 1 && r.due === store.today(1));

// Наступил срок: имитируем, что карточка просрочена
store.progress.cards[id].due = store.today(-1);
r = store.recordDrill(id, 0, 0);
check('в срок без ошибок: 1 → 2, следующее через 3 дня', r.after === 2 && r.due === store.today(3));

// Одна ошибка: ступень та же, срок — половина интервала
store.progress.cards[id].due = store.today(0);
r = store.recordDrill(id, 1, 0);
check('одна ошибка: ступень та же (2), повтор через 1 день', r.after === 2 && r.due === store.today(1));

// Две ошибки: назад на первую ступень
store.progress.cards[id].box = 5;
store.progress.cards[id].due = store.today(0);
r = store.recordDrill(id, 1, 1);
check('ошибка + подсказка: назад на ступень 1, повтор завтра', r.after === 1 && r.due === store.today(1));
check('счётчик забываний вырос', store.progress.cards[id].lapses === 1);

// Выучено с 4-й ступени
store.progress.cards[id].box = 4;
check('ступень 4 — «выучено»', store.lineStatus(id) === 'mastered');

// Звёзды
check('звёзды: 0 ошибок → 3, 1 → 2, 3 → 1, 5 → 0', store.starsFor(0) === 3 && store.starsFor(1) === 2 && store.starsFor(3) === 1 && store.starsFor(5) === 0);

// Уровни
const lv = (xp) => store.levelInfo(xp).level;
check('уровни: 0→1, 99→1, 100→2, 299→2, 300→3, 1000→5', lv(0) === 1 && lv(99) === 1 && lv(100) === 2 && lv(299) === 2 && lv(300) === 3 && lv(1000) === 5);

// Серия дней
store.progress.days = { [store.today()]: 10, [store.today(-1)]: 5, [store.today(-2)]: 5, [store.today(-4)]: 5 };
check('серия: сегодня + 2 дня подряд = 3', store.streak() === 3);
store.progress.days = { [store.today(-1)]: 5, [store.today(-2)]: 5 };
check('серия не прерывается, если сегодня ещё не занимался', store.streak() === 2);
store.progress.days = { [store.today(-2)]: 5 };
check('пропущенный вчера день обнуляет серию', store.streak() === 0);

// Объединение копий с двух устройств
const a = { xp: 100, days: { '2026-10-01': 30 }, learned: { x: 5 }, achievements: {}, cards: { x: { box: 2, last: 10 }, y: { box: 1, last: 50 } }, updatedAt: 1 };
const b = { xp: 80, days: { '2026-10-01': 50, '2026-10-02': 10 }, learned: { x: 3, z: 9 }, achievements: { 'first-line': 7 }, cards: { x: { box: 4, last: 20 }, y: { box: 0, last: 40 } }, updatedAt: 2 };
const m = store.merge(a, b);
check('объединение: опыт — максимум', m.xp === 100);
check('объединение: по каждой карточке берётся более свежая', m.cards.x.box === 4 && m.cards.y.box === 1);
check('объединение: дни и изученные — объединяются', m.days['2026-10-01'] === 50 && m.days['2026-10-02'] === 10 && m.learned.x === 3 && m.learned.z === 9);
check('объединение: достижения не теряются', m.achievements['first-line'] === 7);

// Список к повторению отсортирован по сроку
store.resetProgress();
store.markLearned('london-main');
store.markLearned('scotch-mieses');
store.progress.cards['london-main'].due = store.today(-1);
store.progress.cards['scotch-mieses'].due = store.today(-3);
const due = store.dueLines().map((x) => x.line.id);
check('к повторению: сначала самые просроченные', due[0] === 'scotch-mieses' && due[1] === 'london-main');

store.resetProgress();
if (failed) {
  console.error(`\n✗ не прошло: ${failed}`);
  process.exit(1);
}
console.log('\n✓ логика прогресса в порядке');
