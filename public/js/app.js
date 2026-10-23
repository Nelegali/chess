import { OPENINGS, CATEGORIES, SIGNATURE, findLine, lineSide, allLines } from './openings.js';
import * as store from './store.js';
import { Board, Chess, parseArrows, threatArrows, sanToMove, moveLabel, figurine, PIECE_NAME, FLASH_MS, PATH_MS, circleShapes, pathArrows, destroyBoard, guardRedraw, hasSize, glyphShape } from './board.js';
import { Chessground } from '../vendor/chessground.js';
import qrcode from '../vendor/qrcode.js';
import { play as sound } from './sound.js';
import * as lichess from './lichess.js';
import { moveStats } from './popularity.js';
import { BASICS, GLOSSARY, GLOSSARY_BY_ID, OPENING_THEORY, DIAGRAMS, linkTerms } from './theory.js';
import * as coach from './coach.js';
import { APP_VERSION, APP_DATE } from './version.js';

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
// Высота шапки — для доски, которая на телефоне закрепляется прямо под ней.
if ('ResizeObserver' in window) {
  new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);
}
const tabbar = document.getElementById('tabbar');

let cleanup = [];
const onCleanup = (fn) => cleanup.push(fn);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const clean = (san) => san.replace(/[!?]+$/, '');
// Ходы в тексте вида «Nf3», «...Qxg5», «Bxc6» показываем значками фигур: ♘f3, …♕xg5, ♗xc6.
const FIG_TEXT = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const figText = (s) =>
  s
    .replace(/\.\.\./g, '…')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])([KQRBN])([a-h]?[1-8]?x?[a-h][1-8])/g, (m, pre, p, rest) => pre + FIG_TEXT[p] + rest);

// Названия клеток (f7, e4…) — нажимаемые: подсвечивают клетку на доске.
// Путь вида «e1–h4» или «b1–d2–f1–g3» рисуется стрелками.
// Клетка во взятии («♘xe5», «dxc6») тоже нажимается.
const squaresText = (s) =>
  s.replace(/(^|[^A-Za-z0-9_]|[♔♕♖♗♘a-h]x)([a-h][1-8](?:–[a-h][1-8])*)(?![A-Za-z0-9])/g, (m, pre, text) =>
    text.includes('–')
      ? `${pre}<span class="sq path" data-path="${text.split('–').join(',')}">${text}</span>`
      : `${pre}<span class="sq" data-sq="${text}">${text}</span>`,
  );

// Экранированный текст, где термины из словаря — нажимаемые кнопки, а клетки подсвечиваются.
const rich = (s) => linkTerms(squaresText(figText(esc(s))));
// Для текста внутри кнопок: без кнопок-терминов (кнопка в кнопке ломает разметку), клетки остаются.
const richInButton = (s) => squaresText(figText(esc(s)));

// Доска текущего экрана — на ней подсвечиваются клетки из текста.
let activeBoard = null;

// Пометки к ходам (!, ?, ?!) словами — новичку значки ничего не говорят.
const ANN = { '??': 'грубая ошибка', '?': 'ошибка', '?!': 'сомнительный ход', '!?': 'интересный ход', '!': 'сильный ход', '!!': 'блестящий ход' };
const annOf = (san) => (san.match(/[!?]+$/) || [''])[0];
function annBadge(san) {
  const a = annOf(san);
  return a ? `<span class="ann ${a.includes('?') ? 'bad' : 'good'}">${ANN[a]}</span>` : '';
}
// Оценка хода: значок, заголовок плашки и подпись бейджа. book — ход по теории.
const VERDICT_UI = {
  blunder: { icon: '💥', title: 'Грубая ошибка!' },
  mistake: { icon: '⚠️', title: 'Ошибка' },
  dubious: { icon: '🤔', title: 'Сомнительный ход' },
  ok: { icon: '👌', title: 'Нормальный ход' },
  good: { icon: '👍', title: 'Хороший ход' },
  book: { icon: '📖', title: 'Ход по теории — так и надо!' },
};
const verdictBadge = (v) => `<span class="wn-badge v-${v}">${VERDICT_UI[v].icon} ${v === 'book' ? 'по теории' : coach.VERDICTS[v]}</span>`;
const verdictBanner = (v, note = '') =>
  `<div class="verdict-banner v-${v}"><span class="vb-icon">${VERDICT_UI[v].icon}</span><span><b>${VERDICT_UI[v].title}</b>${note ? `<span class="vb-note">${note}</span>` : ''}</span></div>`;

// Очки — стоимость фигур на доске: пешка 1, конь и слон по 3, ладья 5, ферзь 9 (король не считается).
const PIECE_POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const TAKEN_FIG = { w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
function material(fen) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if (t in PIECE_POINTS) count[ch === t ? 'b' : 'w'][t]++;
  }
  const points = (c) => Object.entries(count[c]).reduce((a, [t, n]) => a + PIECE_POINTS[t] * n, 0);
  // какие фигуры соперника взяты: чего не хватает до начального набора
  const taken = (c) =>
    Object.entries(START_COUNT)
      .map(([t, n]) => TAKEN_FIG[c][t].repeat(Math.max(0, n - count[c][t])))
      .join('');
  return { w: points('w'), b: points('b'), takenFrom: { w: taken('w'), b: taken('b') } };
}

// Строка «очки»: у кого больше и на сколько. side — за кого играет ученик.
function materialHtml(fen, side, { onlyIfUnequal = false } = {}) {
  const m = material(fen);
  if (onlyIfUnequal && m.w === m.b) return '';
  const opp = side === 'w' ? 'b' : 'w';
  const diff = m[side] - m[opp];
  const label = diff > 0 ? `+${diff} у тебя` : diff < 0 ? `+${-diff} у соперника` : 'поровну';
  return `<button type="button" class="material" data-material aria-label="Очки: стоимость фигур">
      <span class="mat-side">⚖️ Очки: <b>ты ${m[side]}</b> <span class="mat-took">${m.takenFrom[opp]}</span> · соперник ${m[opp]} <span class="mat-took">${m.takenFrom[side]}</span></span>
      <span class="mat-diff ${diff > 0 ? 'me' : diff < 0 ? 'opp' : ''}">${label}</span>
    </button>`;
}

// Очки для строки под доской. На телефоне коротко: «⚖️ +3 у тебя», на компьютере — с числами.
function materialChip(fen, side) {
  const m = material(fen);
  const opp = side === 'w' ? 'b' : 'w';
  const diff = m[side] - m[opp];
  const who = diff > 0 ? `+${diff} у тебя` : diff < 0 ? `+${-diff} у соперника` : 'поровну';
  return `<button type="button" class="mat-chip ${diff > 0 ? 'me' : diff < 0 ? 'opp' : ''}" data-material aria-label="Очки (стоимость фигур): ты ${m[side]}, соперник ${m[opp]}">⚖️ <span class="mat-long">Очки: ты ${m[side]} · соперник ${m[opp]} — </span><b>${who}</b></button>`;
}

// Окно «что такое очки»: стоимость фигур и счёт в текущей позиции.
function showMaterial() {
  const fen = activeBoard && activeBoard.chess ? activeBoard.chess.fen() : null;
  const side = (activeBoard && activeBoard.myColor) || 'w';
  const opp = side === 'w' ? 'b' : 'w';
  const m = fen ? material(fen) : null;
  const diff = m ? m[side] - m[opp] : 0;
  const verdict = !m
    ? ''
    : diff > 0
      ? `<p class="mat-verdict me">У тебя перевес: <b>+${diff}</b> — твои фигуры вместе стоят на ${diff} ${plural(diff, 'очко', 'очка', 'очков')} больше.</p>`
      : diff < 0
        ? `<p class="mat-verdict opp">У соперника перевес: <b>+${-diff}</b> — его фигуры вместе стоят на ${-diff} ${plural(-diff, 'очко', 'очка', 'очков')} больше.</p>`
        : '<p class="mat-verdict">Сейчас <b>поровну</b> — ни у кого нет лишнего материала.</p>';
  const score = m
    ? `<div class="mat-score">
        <div><span class="muted small">Ты</span><b>${m[side]}</b><span class="mat-took">${m.takenFrom[opp] ? `взял: ${m.takenFrom[opp]}` : 'пока никого не взял'}</span></div>
        <div><span class="muted small">Соперник</span><b>${m[opp]}</b><span class="mat-took">${m.takenFrom[side] ? `взял: ${m.takenFrom[side]}` : 'пока никого не взял'}</span></div>
      </div>`
    : '';
  modal(`
    <h2>⚖️ Очки</h2>
    <p>Очки — это стоимость фигур на доске. Так удобно понять, кто «богаче»: выгоден ли размен и не отдал ли кто-то фигуру зря.</p>
    <div class="mat-values">
      <span>♙ пешка <b>1</b></span><span>♘ конь <b>3</b></span><span>♗ слон <b>3</b></span><span>♖ ладья <b>5</b></span><span>♕ ферзь <b>9</b></span><span>♔ король — не считается</span>
    </div>
    ${score}
    ${verdict}
    <button type="button" class="btn primary" data-close>Понятно</button>`);
}

// Насколько популярен ход san в позиции со статистикой data (Lichess или встроенной):
// крупно — процент партий, рядом — место среди ходов и полоска.
function popularityHtml(data, san) {
  if (!data || !data.total) return '';
  const k = data.moves.findIndex((m) => m.san === san);
  if (k < 0) {
    return `<div class="pop-line rare"><span class="pop-pct">&lt;1%</span><span class="pop-text">редкий ход<span class="pop-sub">почти все играют иначе</span></span></div>`;
  }
  const m = data.moves[k];
  const pct = Math.max(1, Math.round(((m.white + m.draws + m.black) / data.total) * 100));
  const place = k === 0 ? '🥇 самый популярный ход' : k === 1 ? '🥈 второй по популярности' : k === 2 ? '🥉 третий по популярности' : `${k + 1}-й по популярности`;
  return `<div class="pop-line"><span class="pop-pct">${pct}%</span><span class="pop-text">так играют в партиях<span class="pop-sub">${place}</span><span class="pop-bar"><i style="width:${pct}%"></i></span></span></div>`;
}

// Раскрыт ли блок «Почему не по-другому?» — запоминаем выбор.
let whyOpen = true;
try {
  whyOpen = localStorage.getItem('why-open') !== '0';
} catch {}
const sideName = (c) => (c === 'w' ? 'белыми' : 'чёрными');
const colorName = (c) => (c === 'w' ? 'white' : 'black');
const DIFF = { 1: 'Легко', 2: 'Средне', 3: 'Сложно' };

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function inDays(n) {
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

function stars(n, max = 5) {
  return `<span class="stars" aria-label="${n} из ${max}">${'★'.repeat(n)}<span class="dim">${'★'.repeat(max - n)}</span></span>`;
}

function diffDots(n) {
  return `<span class="diff d${n}" title="Сложность">${'●'.repeat(n)}<span class="dim">${'●'.repeat(3 - n)}</span> ${DIFF[n]}</span>`;
}

function memoryBar(value, label) {
  return `<div class="memory"><div class="bar"><i style="width:${Math.round(value * 100)}%"></i></div>${label ? `<span>${label}</span>` : ''}</div>`;
}

const STATUS = {
  none: { text: 'Не начат', cls: 'st-none' },
  new: { text: 'Новый', cls: 'st-new' },
  learning: { text: 'Изучаю', cls: 'st-learning' },
  mastered: { text: 'Выучено', cls: 'st-mastered' },
};

// Подготовить линию: позиции и ходы chess.js.
function buildLine(steps, startFen) {
  const chess = new Chess(startFen);
  const fens = [chess.fen()];
  const moves = [];
  for (const s of steps) {
    const m = chess.move(clean(s.m));
    moves.push(m);
    fens.push(chess.fen());
  }
  return { fens, moves };
}

const turnAt = (fen) => fen.split(' ')[1];

// Мини-доски тоже умеют подсвечивать клетки и пути, когда в тексте рядом нажали «f7» или «h4–e1».
const boardAdapters = new WeakMap();
const boardRedraw = new WeakMap();

function miniBoard(el, fen, orientation, lastMove, shapes = [], coordinates = false) {
  const cg = Chessground(el, {
    fen,
    orientation,
    viewOnly: true,
    coordinates,
    lastMove,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true, autoShapes: shapes },
  });
  // Если доску создали в ещё скрытом блоке, после показа пересчитываем размеры (иначе стрелки кривые).
  // Если пользователь уже ушёл со страницы — ничего не рисуем.
  // Пока доска скрыта (свёрнутый раздел), не перерисовываем: стрелки посчитались бы для нулевого размера.
  const shown = () => hasSize(el);
  guardRedraw(cg, el);
  const redrawAll = () => {
    if (!shown()) return;
    cg.redrawAll();
    guardRedraw(cg, el);
  };
  requestAnimationFrame(redrawAll);
  let timer;
  const show = (extra, ms) => {
    if (!shown()) return;
    clearTimeout(timer);
    cg.setAutoShapes([...shapes, ...extra]);
    timer = setTimeout(() => shown() && cg.setAutoShapes(shapes), ms);
  };
  boardRedraw.set(el, () => requestAnimationFrame(redrawAll));
  boardAdapters.set(el, {
    el,
    flash: (squares) => show(circleShapes(squares), FLASH_MS),
    flashPath: (path) => show(pathArrows(path), PATH_MS),
  });
  onCleanup(() => {
    clearTimeout(timer);
    destroyBoard(cg);
  });
  return cg;
}

function signaturePosition(opening) {
  const line = opening.lines[0];
  const n = Math.min(SIGNATURE[opening.id] || 4, line.steps.length);
  const { fens, moves } = buildLine(line.steps.slice(0, n));
  const last = moves[moves.length - 1];
  return { fen: fens[fens.length - 1], lastMove: last ? [last.from, last.to] : undefined };
}

// ─────────────────────────── общие элементы ───────────────────────────

function renderTopbar(opts = {}) {
  const lv = store.levelInfo();
  const s = store.streak();
  const back = opts.back
    ? `<a class="icon-btn" href="${opts.back}" aria-label="Назад">‹</a>${opts.back !== '#/' ? '<a class="icon-btn home" href="#/" aria-label="На главную" title="На главную">⌂</a>' : ''}`
    : `<a class="brand" href="#/"><span class="logo">♞</span>${opts.title ? '' : '<span>Дебюты</span>'}</a>`;
  topbar.innerHTML = `
    ${back}
    <div class="title">${esc(opts.title || '')}</div>
    <a class="hud" href="#/profile" aria-label="Профиль: ${esc(store.activeProfile().name)}">
      <span class="who-av" title="${esc(store.activeProfile().name)}">${store.activeProfile().emoji}</span>
      <span class="streak ${s ? '' : 'off'}" title="Серия дней">🔥 ${s}</span>
      <span class="lvl" title="${esc(lv.rank)}">
        <b>${lv.level}</b>
        <span class="xpbar"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></span>
      </span>
    </a>`;
}

function renderTabbar(active) {
  const due = store.dueLines().length;
  const tabs = [
    ['home', '#/', '♞', 'Дебюты'],
    ['review', '#/review', '🔁', 'Повторение', due],
    ['theory', '#/theory', '📚', 'Теория'],
    ['quiz', '#/quiz', '❓', 'Викторина'],
    ['profile', '#/profile', '🏆', 'Профиль'],
  ];
  tabbar.hidden = !active;
  tabbar.innerHTML = tabs
    .map(
      ([id, href, icon, label, badge]) =>
        `<a href="${href}" class="${id === active ? 'active' : ''}"><span class="ti">${icon}${badge ? `<b class="badge">${badge}</b>` : ''}</span><span>${label}</span></a>`,
    )
    .join('');
}

function modal(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.remove();
    onClose && onClose();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
    const a = e.target.closest('[data-close]');
    if (a) close();
  });
  onCleanup(() => wrap.remove());
  return { el: wrap, close };
}

function toast(html, cls = '', ms = 3200) {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  // значок + текст (достижения) раскладываем в строку, обычный текст — одним блоком
  t.innerHTML = html.includes('ach-icon') ? html : `<div class="toast-text">${html}</div>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

function announceAchievements(list) {
  list.forEach((a, i) =>
    setTimeout(() => {
      sound('achievement');
      toast(`<span class="ach-icon">${a.icon}</span><div><b>Достижение!</b><br>${esc(a.name)}</div>`, 'ach');
    }, 600 + i * 1200),
  );
}

function confetti() {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = (c.width = innerWidth * devicePixelRatio);
  const H = (c.height = innerHeight * devicePixelRatio);
  const colors = ['#f6c343', '#7fb446', '#3d9be9', '#e8584f', '#c77dff'];
  const parts = Array.from({ length: 120 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * devicePixelRatio,
    vy: (-Math.random() * 16 - 6) * devicePixelRatio,
    s: (4 + Math.random() * 6) * devicePixelRatio,
    r: Math.random() * Math.PI,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.5 * devicePixelRatio;
      p.x += p.vx;
      p.y += p.vy;
      p.r += 0.2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
      ctx.restore();
    }
    if (++frame < 110) requestAnimationFrame(tick);
    else c.remove();
  })();
}

// ─────────────────────────── главная ───────────────────────────

// Подсказка «Установить на iPhone» — только в Safari на iOS, пока приложение не установлено.
function installCard() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('install-hint') === '1';
  } catch {}
  if (standalone || !ios || dismissed) return '';
  return `<div class="install"><span>📲 Установи как приложение: нажми <b>Поделиться</b> → <b>На экран «Домой»</b></span><button id="install-close" aria-label="Закрыть">✕</button></div>`;
}

let homeFilter = 'all';
let homeSort = 'popularity';

function homeView() {
  renderTopbar();
  renderTabbar('home');
  const due = store.dueLines();
  const next = store.suggestNext();
  const goal = store.DAILY_GOAL;
  const tx = store.todayXp();
  const s = store.streak();

  const mainAction = due.length
    ? `<a class="btn primary big" href="#/review">🔁 Повторить ${due.length} ${plural(due.length, 'вариант', 'варианта', 'вариантов')}</a>`
    : next
      ? `<a class="btn primary big" href="#/learn/${next.line.id}">📖 Учить: ${esc(next.opening.name)}</a>`
      : `<a class="btn primary big" href="#/quiz">❓ Викторина</a>`;

  app.innerHTML = `
    ${installCard()}
    <section class="today card">
      <div class="today-row">
        <div class="ring" style="--p:${Math.min(1, tx / goal)}">
          <span>${Math.min(tx, goal)}<small>/${goal} XP</small></span>
        </div>
        <div class="today-text">
          <h2>${tx >= goal ? 'Цель дня выполнена! 🎉' : 'Цель дня'}</h2>
          <p>${s ? `🔥 Серия: <b>${s} ${plural(s, 'день', 'дня', 'дней')}</b> — не прерывай!` : 'Позанимайся сегодня, чтобы начать серию 🔥'}</p>
          <p class="muted">${due.length ? `Пора повторить: ${due.length}. Повторения лучше всего укрепляют память.` : 'Повторений на сегодня нет. Самое время выучить что-то новое.'}</p>
        </div>
      </div>
      <div class="actions">
        ${mainAction}
        <div class="row">
          ${due.length && next ? `<a class="btn" href="#/learn/${next.line.id}">📖 Новое</a>` : ''}
          <a class="btn" href="#/quiz">❓ Викторина</a>
          <a class="btn" href="#/free">♟ Свободная игра</a>
        </div>
        <a class="basics-link" href="#/theory">📚 Новичок? Как ходят фигуры, как читать ходы и что значат названия дебютов →</a>
      </div>
    </section>

    <div class="filters">
      <div class="chips" role="tablist">
        ${[['all', 'Все'], ...Object.entries(CATEGORIES)]
          .map(([k, v]) => `<button class="chip ${homeFilter === k ? 'on' : ''}" data-filter="${k}">${v}</button>`)
          .join('')}
      </div>
      <label class="sort">Сортировка
        <select id="sort">
          <option value="popularity">по популярности</option>
          <option value="difficulty">по сложности</option>
          <option value="progress">по прогрессу</option>
        </select>
      </label>
    </div>
    <div class="grid" id="grid"></div>
    <p class="legend-note muted">★ — насколько часто встречается у любителей · ● — сложность</p>
    <p class="version-note muted">${versionText()}</p>
  `;

  const installClose = app.querySelector('#install-close');
  if (installClose)
    installClose.onclick = () => {
      installClose.parentElement.remove();
      try {
        localStorage.setItem('install-hint', '1');
      } catch {}
    };

  const sortSel = app.querySelector('#sort');
  sortSel.value = homeSort;
  sortSel.onchange = () => {
    homeSort = sortSel.value;
    renderGrid();
  };
  app.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      homeFilter = b.dataset.filter;
      app.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      renderGrid();
    }),
  );

  function renderGrid() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    let list = OPENINGS.filter((o) => homeFilter === 'all' || o.category === homeFilter);
    const by = {
      popularity: (a, b) => b.popularity - a.popularity || a.difficulty - b.difficulty,
      difficulty: (a, b) => a.difficulty - b.difficulty || b.popularity - a.popularity,
      progress: (a, b) => store.openingStrength(b) - store.openingStrength(a) || b.popularity - a.popularity,
    }[homeSort];
    list = [...list].sort(by);
    const grid = app.querySelector('#grid');
    grid.innerHTML = list
      .map((o) => {
        const st = STATUS[store.openingStatus(o)];
        const dueCount = o.lines.filter((l) => store.isDue(l.id)).length;
        return `
        <a class="ocard" href="#/o/${o.id}">
          <div class="mini" data-mini="${o.id}"></div>
          <div class="ocard-body">
            <div class="ocard-top">
              <span class="side side-${o.category}">${CATEGORIES[o.category]}</span>
              ${dueCount ? '<span class="due">повторить</span>' : ''}
            </div>
            <h3>${esc(o.name)}</h3>
            <p class="tagline">${esc(o.tagline)}</p>
            <div class="meta">${stars(o.popularity)} ${diffDots(o.difficulty)}</div>
            ${memoryBar(store.openingStrength(o), `<span class="${st.cls}">${st.text}</span>`)}
          </div>
        </a>`;
      })
      .join('');
    grid.querySelectorAll('[data-mini]').forEach((el) => {
      const o = OPENINGS.find((x) => x.id === el.dataset.mini);
      const { fen, lastMove } = signaturePosition(o);
      miniBoard(el, fen, colorName(o.side), lastMove);
    });
  }
  renderGrid();
}

// ─────────────────────────── страница дебюта ───────────────────────────

function openingView(id) {
  const o = OPENINGS.find((x) => x.id === id);
  if (!o) return notFound();
  renderTopbar({ back: '#/', title: o.name });
  renderTabbar(null);
  const { fen, lastMove } = signaturePosition(o);
  const finalFen = buildLine(o.lines[0].steps).fens.at(-1);

  app.innerHTML = `
    <section class="opening">
      <div class="opening-hero">
        <div class="mini big" id="hero"></div>
        <div>
          <div class="ocard-top"><span class="side side-${o.category}">${CATEGORIES[o.category]}</span><span class="eco">ECO ${esc(o.eco)}</span></div>
          <h1>${esc(o.name)}</h1>
          ${o.aka ? `<p class="aka">${esc(o.aka)}</p>` : ''}
          <div class="meta">${stars(o.popularity)} <span class="muted">популярность</span></div>
          <div class="meta">${diffDots(o.difficulty)}</div>
          <p>${rich(o.about)}</p>
        </div>
      </div>
      <div class="card">
        <h2>Главные идеи</h2>
        <ul class="ideas">${o.ideas.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>
      </div>
      <h2 class="section">📚 Теория дебюта</h2>
      ${openingTheoryHtml(o)}
      <h2 class="section">Варианты</h2>
      <div class="lines">
        ${o.lines
          .map((l) => {
            const st = store.lineStatus(l.id);
            const c = store.card(l.id);
            const side = lineSide(o, l);
            const myCount = l.steps.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === side).length;
            const due = c ? (store.isDue(l.id) ? '<b class="due">пора повторить</b>' : `повторение ${inDays(store.daysUntil(c.due))}`) : '';
            return `
            <div class="line card">
              <div class="line-head">
                <div>
                  <h3>${esc(l.name)}</h3>
                  <p class="muted">Играешь ${sideName(side)} · ${myCount} ${plural(myCount, 'ход', 'хода', 'ходов')}${due ? ` · ${due}` : ''}</p>
                </div>
                <span class="${STATUS[st].cls} pill">${STATUS[st].text}</span>
              </div>
              ${memoryBar(store.strength(l.id), c ? `Память ${c.box}/${store.MAX_BOX}` : '')}
              <div class="row">
                <a class="btn ${st === 'none' ? 'primary' : ''}" href="#/learn/${l.id}">📖 Изучить</a>
                <a class="btn ${st !== 'none' ? 'primary' : ''}" href="#/drill/${l.id}">🎯 Тренировать</a>
              </div>
            </div>`;
          })
          .join('')}
      </div>
      <div class="card lichess-card">
        <h2>Практика на Lichess</h2>
        <p class="muted">Открой позицию в конце главного варианта и разбери её с движком или сыграй дальше против компьютера.</p>
        <div class="row">
          <a class="btn" target="_blank" rel="noopener" href="${lichess.analysisUrl(finalFen, colorName(o.side))}">🔍 Анализ</a>
          <a class="btn" target="_blank" rel="noopener" href="${lichess.playVsComputerUrl(finalFen)}">🤖 Игра с компьютером</a>
        </div>
      </div>
    </section>`;
  miniBoard(app.querySelector('#hero'), fen, colorName(o.side), lastMove);
  // На странице дебюта клетки из текста подсвечиваются на доске вверху.
  activeBoard = boardAdapters.get(app.querySelector('#hero'));
  mountDiagrams(app);
}

// ─────────────────────────── изучение ───────────────────────────

// Кнопка «Куда может пойти соперник» и пояснение к её стрелкам — общие для урока и свободной игры.
const INSIGHT_TOOLS = `
        <div class="board-tools">
          <button type="button" class="btn tiny insight-btn" id="insight-btn" aria-pressed="false">👁 <span class="lbl-full">Куда может пойти соперник</span><span class="lbl-short">Соперник</span></button>
        </div>
        <p class="insight-legend" id="insight-legend" hidden>
          <span><i class="ins line"></i>куда может пойти фигура соперника</span>
          <span><i class="ins line cap"></i>кого она может съесть</span>
          <span><i class="ins dot"></i>клетку бьёт пешка соперника</span>
          <span><i class="ins ring"></i>твоя фигура под ударом</span>
          <span><i class="ins ring guarded"></i>под ударом, но защищена</span>
          <span class="muted">Нажми на фигуру соперника — покажу только её ходы.</span>
        </p>`;

function playLayout(opening, line, mode) {
  return `
    <div class="play lesson">
      <div class="board-col">
        <div class="board-stage">
          <div class="board" id="board"></div>
          <div class="preview-badge" id="preview-badge" hidden></div>
        </div>
        ${INSIGHT_TOOLS}
        <div class="legend">
          <span><i class="lg g"></i>идея</span>
          <span><i class="lg r"></i>угроза</span>
          <span><i class="lg b"></i>план / защита</span>
          <span><i class="lg y"></i>важное поле</span>
        </div>
        <p class="version-note muted">${versionText()}</p>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="mode-tag ${mode}">${mode === 'learn' ? '📖 Изучение' : '🎯 Тренировка'}</div>
          <h2>${esc(opening.name)}</h2>
          <div class="sub-row">
            <p class="muted">${esc(line.name)}</p>
            <button type="button" class="btn tiny" id="theory-btn" aria-label="Теория">📚 <span class="lbl-theory">Теория</span></button>
          </div>
          <div class="dots" id="dots"></div>
        </div>
        <div id="panel-body"></div>
      </div>
    </div>`;
}

// Как сделать ход: понятная подсказка для новичка.
const ACC_PIECE = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя', k: 'короля' };
function howToMove(m) {
  const castle = m.flags.includes('k') || m.flags.includes('q');
  const what = castle ? `Рокировка: перетащи короля с ${m.from} на ${m.to}` : `Перетащи ${ACC_PIECE[m.piece]} с ${m.from} на ${m.to}`;
  return `${what} (или нажми на фигуру, а потом на клетку). Можно и кнопкой «Сделать ход» внизу.`;
}

// Кнопка «Куда может пойти соперник»: включённое состояние запоминается.
function setupInsight(board) {
  const btn = app.querySelector('#insight-btn');
  const legend = app.querySelector('#insight-legend');
  const apply = (on) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
    legend.hidden = !on;
    board.setInsight(on);
  };
  btn.onclick = () => {
    const on = !store.settings.insight;
    store.saveSettings({ insight: on });
    apply(on);
  };
  apply(!!store.settings.insight);
}

function renderDots(el, total, ply, side, fens) {
  el.innerHTML = Array.from({ length: total }, (_, i) => {
    const mine = turnAt(fens[i]) === side;
    return `<i class="${i < ply ? 'done' : i === ply ? 'cur' : ''} ${mine ? 'mine' : ''}"></i>`;
  }).join('');
}

function learnView(lineId) {
  const found = findLine(lineId);
  if (!found) return notFound();
  const { opening, line } = found;
  const side = lineSide(opening, line);
  const { fens, moves } = buildLine(line.steps);
  const N = line.steps.length;

  renderTopbar({ back: `#/o/${opening.id}`, title: opening.name });
  renderTabbar(null);
  app.innerHTML = playLayout(opening, line, 'learn');

  const body = app.querySelector('#panel-body');
  const dots = app.querySelector('#dots');
  const board = new Board(app.querySelector('#board'), { orientation: colorName(side), myColor: side, onUserMove });
  onCleanup(() => board.destroy());
  setupInsight(board);
  activeBoard = board;
  onCleanup(() => (activeBoard = null));

  let ply = 0;
  let alt = null; // { def, fens, moves, ply, base }
  let explorerOpen = false;
  let wrongMsg = '';
  let wrongVerdict = 'ok';
  let lastWrong = null;

  // «Идея дебюта»: перед первым ходом показываем на доске, к какой позиции придём и зачем.
  const essence = DIAGRAMS[opening.id]?.essence;
  let intro = !!essence;
  let essencePos = null;
  if (essence) {
    const l = opening.lines[essence.line || 0];
    const built = buildLine(l.steps.slice(0, essence.ply));
    essencePos = { fen: built.fens[built.fens.length - 1], last: built.moves[built.moves.length - 1] };
  }

  function renderIntro() {
    const last = essencePos.last;
    board.load(essencePos.fen, last ? [last.from, last.to] : undefined);
    board.setHint(null);
    board.shapes(parseArrows(essence.a));
    renderDots(dots, N, -1, side, fens);
    body.innerHTML = `
      <div class="move-card intro-card">
        <div class="move-head"><span class="san">Идея дебюта</span><span class="who me">ты играешь ${sideName(side)}</span></div>
        <div class="idea-box"><b>👆 На доске:</b> ${rich(essence.caption)}</div>
        <p class="explain">${rich(opening.about)}</p>
        <p class="explain muted">Это позиция, к которой мы придём. Теперь сыграем дебют с первого хода: свои ходы делай на доске сам — зелёная стрелка подскажет, а ходы соперника появятся по кнопке.</p>
      </div>
      <div class="actionbar">
        <button class="btn nav" id="prev" disabled aria-label="Назад">◀</button>
        <button class="btn primary" id="start">▶ Начать с первого хода</button>
        <button class="btn nav" id="next" aria-label="Вперёд">▶</button>
      </div>`;
    body.querySelector('#start').onclick = forward;
    body.querySelector('#next').onclick = forward;
  }

  function currentFen() {
    return alt ? alt.fens[alt.ply] : fens[ply];
  }

  // «Так играют в 48% партий»: насколько популярен показанный ход (Lichess или встроенная статистика).
  const popCache = new Map();
  function fillPopularity() {
    const slot = body.querySelector('.pop-slot');
    if (!slot || ply === 0) return;
    const k = ply - 1;
    const f = fens[k];
    const show = (data) => {
      if (slot.isConnected) slot.innerHTML = popularityHtml(data, moves[k].san);
    };
    if (popCache.has(f)) return show(popCache.get(f));
    moveStats(moves.slice(0, k).map((m) => m.from + m.to + (m.promotion || '')), f)
      .then((data) => {
        popCache.set(f, data);
        show(data);
      })
      .catch(() => popCache.set(f, null));
  }

  function uciHistory() {
    const main = moves.slice(0, alt ? alt.base : ply);
    const extra = alt ? alt.moves.slice(0, alt.ply) : [];
    return [...main, ...extra].map((m) => m.from + m.to + (m.promotion || ''));
  }

  function shapesFor(step, fen, nextMove) {
    const list = step ? parseArrows(step.a) : [];
    if (store.settings.threats) {
      const c = new Chess(fen);
      const seen = new Set(list.map((s) => s.orig + s.dest));
      for (const t of threatArrows(c, side)) if (!seen.has(t.orig + t.dest)) list.push(t);
    }
    if (nextMove && store.settings.hints) list.push({ orig: nextMove.from, dest: nextMove.to, brush: 'paleGreen' });
    return list;
  }

  function render() {
    if (alt) return renderAlt();
    if (intro) return renderIntro();
    const step = ply > 0 ? line.steps[ply - 1] : null;
    const last = ply > 0 ? moves[ply - 1] : null;
    board.load(fens[ply], last ? [last.from, last.to] : undefined);
    const next = ply < N ? moves[ply] : null;
    const myTurn = next && turnAt(fens[ply]) === side;
    // свой правильный ход отмечаем значком «★ по теории», как в свободной игре
    const lastMine = ply > 0 && turnAt(fens[ply - 1]) === side;
    board.shapes([...shapesFor(step, fens[ply], myTurn ? next : null), ...(lastMine ? [glyphShape(last.to, 'book')] : [])]);
    board.setHint(myTurn && store.settings.hints ? next.from : null);
    if (myTurn) board.enable(side);
    renderDots(dots, N, ply, side, fens);

    const mover = ply > 0 ? turnAt(fens[ply - 1]) : null;
    const head = step
      ? `<div class="move-head"><span class="san">${moveLabel(ply - 1, clean(step.m))}</span><span class="who ${mover === side ? 'me' : 'opp'}">${mover === side ? 'твой ход' : 'ход соперника'}</span>${annBadge(step.m)}</div>`
      : `<div class="move-head"><span class="san">Начало</span><span class="who me">ты играешь ${sideName(side)}</span></div>`;
    const text = step
      ? `<p class="explain">${rich(step.t)}</p>`
      : `<p class="explain">Начинаем с исходной позиции. Ходи на доске сам — зелёная стрелка подскажет. Ходы соперника появятся по кнопке. После каждого хода читай объяснение и смотри на стрелки.</p>${essence ? '<p class="explain muted">Кнопка ◀ вернёт к идее дебюта.</p>' : ''}`;

    let prompt = '';
    let mainBtn = '';
    if (!next) {
      prompt = `<div class="prompt done">🏁 Вариант пройден до конца! Нажми «Завершить», чтобы получить XP.</div>`;
      mainBtn = '<button class="btn primary" id="finish">🏁 Завершить</button>';
    } else if (myTurn) {
      const nextStep = line.steps[ply];
      prompt = `<div class="prompt mine">
          <div>Твой ход: <b>${figurine(clean(nextStep.m))}</b>. ${howToMove(next)}</div>
          <div class="why"><span class="why-label">Зачем этот ход</span>${rich(nextStep.t)}</div>
        </div>
        ${wrongMsg ? `<div class="wrong-msg vc-${wrongVerdict}" data-wrong="1">${wrongMsg}</div>` : ''}
        ${whyNotBlock()}`;
      mainBtn = `<button class="btn" id="auto">▶ Сделать ход ${figurine(clean(nextStep.m))}</button>`;
    } else {
      mainBtn = '<button class="btn primary" id="opp">Ход соперника ▶</button>';
    }

    // Варианты «а что если» к только что показанному ходу: явно пишем, чей это ход и вместо чего.
    const alts = step && step.alt
      ? `<div class="alts">
          <div class="alts-title">🤔 А если бы ${mover === side ? 'ты сыграл' : 'соперник сыграл'} иначе?</div>
          ${step.alt
            .map(
              (a, i) => `<button type="button" class="alt-card" data-alt="${i}">
                <span class="alt-move">Вместо ${moveLabel(ply - 1, clean(step.m))} → <b>${moveLabel(ply - 1, clean(a.steps[0].m))}</b> ${annBadge(a.steps[0].m)}</span>
                <span class="alt-name">${esc(a.label)}</span>
                ${a.intro ? `<span class="alt-intro">${figText(esc(a.intro))}</span>` : ''}
                <span class="alt-cta">▶ Разыграть на доске</span>
              </button>`,
            )
            .join('')}
        </div>`
      : '';

    body.innerHTML = `
      ${materialHtml(fens[ply], side, { onlyIfUnequal: true })}
      <div class="move-card">${head}${step ? '<div class="pop-slot"></div>' : ''}${text}</div>
      ${alts}
      ${prompt}
      ${explorerBlock()}
      <div class="actionbar">
        <button class="btn nav" id="prev" ${ply === 0 && !essence ? 'disabled' : ''} aria-label="Назад">◀</button>
        ${mainBtn}
        <button class="btn nav" id="next" ${!next ? 'disabled' : ''} aria-label="Вперёд">▶</button>
      </div>
    `;
    bindCommon();
    fillPopularity();
    body.querySelectorAll('[data-alt]').forEach((b) =>
      b.addEventListener('click', () => startAlt(step.alt[+b.dataset.alt])),
    );
    const wn = body.querySelector('.whynot');
    if (wn) {
      wn.addEventListener('toggle', () => {
        whyOpen = wn.open;
        try {
          localStorage.setItem('why-open', whyOpen ? '1' : '0');
        } catch {}
      });
      const list = whyNotList();
      body.querySelectorAll('[data-wn]').forEach((b) =>
        b.addEventListener('click', () => startDemo(list[+b.dataset.wn])),
      );
    }
    const wd = body.querySelector('#wrong-demo');
    if (wd) wd.onclick = () => startDemo(lastWrong);
    bindPreviews();
    const fin = body.querySelector('#finish');
    if (fin) fin.onclick = finish;
    const opp = body.querySelector('#opp');
    if (opp) opp.onclick = forward;
    const auto = body.querySelector('#auto');
    if (auto) auto.onclick = forward;
  }

  // Альтернативы к ходу ученика (кэшируем: считать каждый раз дорого).
  const whyNotCache = new Map();
  function whyNotList() {
    if (!whyNotCache.has(ply)) {
      whyNotCache.set(ply, coach.alternatives(fens[ply], moves[ply], { lineId: line.id, ply, stepAlt: line.steps[ply].alt || [] }));
    }
    return whyNotCache.get(ply);
  }

  function whyNotBlock() {
    const list = whyNotList();
    if (!list.length) return '';
    return `<details class="whynot" ${whyOpen ? 'open' : ''}>
      <summary>🤔 Почему не по-другому?</summary>
      <div class="wn-list">${list
        .map(
          (c, i) => `<div class="wn-item v-${c.verdict}">
            <div class="wn-head"><b class="wn-san">${moveLabel(ply, c.san)}</b>${verdictBadge(c.verdict)}</div>
            ${c.demoLabel ? `<div class="wn-label">${esc(c.demoLabel)}</div>` : ''}
            <p>${rich(c.text)}</p>
            <div class="wn-actions">
              <button type="button" class="btn tiny" data-peek="${i}">👀 Что будет на доске</button>
              ${c.demo ? `<button type="button" class="btn tiny" data-wn="${i}">▶ Разыграть по ходам</button>` : ''}
            </div>
            <div class="wn-preview" hidden></div>
          </div>`,
        )
        .join('')}</div>
    </details>`;
  }

  // Предпросмотр «что будет»: наведение мышью — на большой доске; кнопка — мини-доска в карточке
  // (на телефоне большая доска выше и её не видно рядом с карточкой).
  const badge = app.querySelector('#preview-badge');
  function previewLabel(pv, startPly) {
    return pv.sans.map((san, k) => moveLabel(startPly + k, san)).join(' → ');
  }
  function showPreview(pv, startPly) {
    board.preview(pv);
    badge.textContent = `👀 ${previewLabel(pv, startPly)}`;
    badge.hidden = false;
  }
  function hidePreview() {
    board.endPreview();
    badge.hidden = true;
  }
  function bindPreviews() {
    badge.hidden = true;
    const list = myTurnNow() ? whyNotList() : [];
    const items = [
      ...[...body.querySelectorAll('.wn-item')].map((el, i) => ({ el, c: list[i], startPly: ply })),
      ...[...body.querySelectorAll('[data-wrong]')].map((el) => ({ el, c: lastWrong, startPly: ply })),
    ].filter((x) => x.c && x.c.preview);
    for (const { el, c, startPly } of items) {
      hoverPreview(el, () => showPreview(c.preview, startPly));
      const btn = el.querySelector('[data-peek]');
      const box = el.querySelector('.wn-preview');
      if (!btn || !box) continue;
      btn.onclick = () => {
        box.hidden = !box.hidden;
        btn.textContent = box.hidden ? '👀 Что будет на доске' : 'Скрыть доску';
        if (!box.hidden && !box.dataset.mounted) {
          box.dataset.mounted = '1';
          mountCompare(box, c.preview, startPly);
        }
      };
    }
    // «А если бы соперник сыграл иначе?» — предпросмотр при наведении
    const step = ply > 0 ? line.steps[ply - 1] : null;
    body.querySelectorAll('[data-alt]').forEach((el) => {
      const def = step && step.alt ? step.alt[+el.dataset.alt] : null;
      if (!def) return;
      const sans = def.steps.slice(0, 2).map((x) => x.m);
      const mover = turnAt(fens[ply - 1]);
      const pv = coach.previewLine(fens[ply - 1], sans, def.steps[0].a, mover === side ? 'blue' : 'red', mover === side ? 'red' : 'blue');
      hoverPreview(el, () => showPreview(pv, ply - 1));
    });
  }
  // Предпросмотр только при настоящем движении мыши: если карточка оказалась под курсором
  // из-за перерисовки панели (после нажатия «▶»), доска не должна меняться сама.
  function hoverPreview(el, show) {
    let active = false;
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || active) return;
      active = true;
      show();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !active) return;
      active = false;
      hidePreview();
    });
  }
  // Сравнение: слева — что будет после варианта, справа — ход по теории со стрелками урока.
  function mountCompare(box, pv, startPly) {
    const theoryMove = moves[startPly];
    const theoryStep = line.steps[startPly];
    const theoryShapes = theoryMove
      ? [{ orig: theoryMove.from, dest: theoryMove.to, brush: 'green' }, ...parseArrows(theoryStep.a).filter((x) => x.orig + (x.dest || '') !== theoryMove.from + theoryMove.to)]
      : [];
    const theoryText = theoryStep ? (theoryStep.t.match(/^.*?[.!?](\s|$)/) || [theoryStep.t])[0] : '';
    box.innerHTML = `
      <div class="wn-compare">
        <figure>
          <figcaption><b>Если ${previewLabel(pv, startPly)}</b></figcaption>
          <div class="wn-preview-board" data-b="alt"></div>
          <p class="muted small">${rich(pv.caption || '')}</p>
        </figure>
        ${
          theoryMove
            ? `<figure>
                <figcaption><b>По теории: ${moveLabel(startPly, theoryMove.san)}</b></figcaption>
                <div class="wn-preview-board" data-b="theory"></div>
                <p class="muted small">${rich(theoryText)}</p>
              </figure>`
            : ''
        }
      </div>`;
    miniBoard(box.querySelector('[data-b="alt"]'), pv.fen, colorName(side), pv.lastMove, pv.shapes, true);
    if (theoryMove) {
      miniBoard(box.querySelector('[data-b="theory"]'), fens[startPly + 1], colorName(side), [theoryMove.from, theoryMove.to], theoryShapes, true);
    }
  }

  function myTurnNow() {
    return ply < N && turnAt(fens[ply]) === side;
  }

  function startDemo(c) {
    if (!c || !c.demo) return;
    badge.hidden = true;
    startAlt({ label: c.demoLabel || `Почему не ${figurine(c.san)}?`, intro: c.text, steps: c.demo }, ply, { autoReply: true });
  }

  function explorerBlock() {
    return `<div class="explorer">
      <button class="btn ghost" id="explorer-toggle">📊 ${explorerOpen ? 'Скрыть статистику Lichess' : 'Что здесь играют на Lichess?'}</button>
      <div id="explorer-body"></div>
    </div>`;
  }

  function bindCommon() {
    body.querySelector('#prev').onclick = back;
    body.querySelector('#next').onclick = forward;
    body.querySelector('#explorer-toggle').onclick = () => {
      explorerOpen = !explorerOpen;
      render();
    };
    if (explorerOpen) loadExplorer();
  }

  async function loadExplorer() {
    const el = body.querySelector('#explorer-body');
    el.innerHTML = '<p class="muted">Загружаю статистику…</p>';
    const theory = alt ? alt.moves[alt.ply] : moves[ply];
    try {
      const data = await moveStats(uciHistory(), currentFen());
      if (!el.isConnected) return;
      const total = data.total;
      if (!total) {
        el.innerHTML = '<p class="muted">В базе Lichess таких партий почти нет — позиция редкая.</p>';
        return;
      }
      el.innerHTML = `
        <p class="muted">${statsSourceText(data, total)}${data.opening ? ` · ${esc(data.opening.name)}` : ''}</p>
        <table class="ex-table">
          ${data.moves
            .map((m) => {
              const n = m.white + m.draws + m.black;
              const pct = Math.round((n / total) * 100);
              const isTheory = theory && m.uci === theory.from + theory.to;
              return `<tr class="ex-row ${isTheory ? 'theory' : ''}" data-uci="${m.uci}" data-san="${esc(m.san)}" data-w="${m.white}" data-d="${m.draws}" data-b="${m.black}" tabindex="0">
                <td class="ex-san">${figurine(m.san)}${isTheory ? ' ★' : ''}</td>
                <td class="ex-pct">${pct}%</td>
                <td class="ex-bar"><span class="wdb">
                  <i class="w" style="width:${(m.white / n) * 100}%"></i><i class="d" style="width:${(m.draws / n) * 100}%"></i><i class="b" style="width:${(m.black / n) * 100}%"></i>
                </span></td>
              </tr>`;
            })
            .join('')}
        </table>
        <p class="muted small">★ — ход по нашей теории. Полоска: победы белых / ничьи / победы чёрных. Наведи на ход — покажу его на доске, нажми — разберу.</p>
        ${data.lichessError ? '<p class="muted small">Свежая статистика Lichess (игроки 1400–2000): <button type="button" class="link-btn" id="ex-help-btn">подключить</button></p><div id="ex-help"></div>' : ''}`;
      bindExplorerRows(el, theory);
      const helpBtn = el.querySelector('#ex-help-btn');
      if (helpBtn) helpBtn.onclick = () => renderExplorerHelp(el.querySelector('#ex-help'), data.lichessError, currentFen(), side, loadExplorer);
    } catch (e) {
      if (el.isConnected) renderExplorerHelp(el, e, currentFen(), side, loadExplorer);
    }
  }

  // Строки статистики: наведение — стрелка на доске, нажатие — разбор хода с предпросмотром.
  function bindExplorerRows(el, theory) {
    const fen = currentFen();
    const startPly = alt ? alt.base + alt.ply : ply;
    el.querySelectorAll('.ex-row').forEach((row) => {
      const uci = row.dataset.uci;
      const isTheory = theory && uci === theory.from + theory.to;
      const arrow = [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: isTheory ? 'green' : 'blue' }];
      row.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && board.applyShapes(arrow));
      row.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && board.applyShapes());
      const toggle = () => {
        const next = row.nextElementSibling;
        if (next && next.classList.contains('ex-detail')) {
          next.remove();
          return;
        }
        const move = sanToMove(fen, row.dataset.san);
        if (!move) return;
        const w = +row.dataset.w;
        const d = +row.dataset.d;
        const b = +row.dataset.b;
        const n = w + d + b || 1;
        const pct = (x) => Math.round((x / n) * 100);
        const stats = `После этого хода белые выигрывают ${pct(w)}%, ничьи ${pct(d)}%, чёрные выигрывают ${pct(b)}%.`;
        let body2;
        let e2 = null;
        if (isTheory) {
          const step = alt ? alt.def.steps[alt.ply] : line.steps[ply];
          body2 = `<p><span class="wn-badge v-good">по теории</span> ${rich(step ? step.t : '')}</p>`;
        } else {
          e2 = coach.explain(fen, move, theory || null, alt ? {} : { lineId: line.id, ply });
          body2 = `<p>${verdictBadge(e2.verdict)} ${rich(e2.text)}</p>`;
        }
        const tr = document.createElement('tr');
        tr.className = 'ex-detail';
        tr.innerHTML = `<td colspan="3">
          ${body2}
          <p class="muted small">${stats}</p>
          ${e2 ? `<div class="wn-actions"><button type="button" class="btn tiny" data-peek="ex">👀 Что будет на доске</button>${e2.demo && !alt ? '<button type="button" class="btn tiny" data-demo="ex">▶ Разыграть по ходам</button>' : ''}</div><div class="wn-preview" hidden></div>` : ''}
        </td>`;
        row.after(tr);
        if (!e2) return;
        const btn = tr.querySelector('[data-peek]');
        const box = tr.querySelector('.wn-preview');
        btn.onclick = () => {
          box.hidden = !box.hidden;
          btn.textContent = box.hidden ? '👀 Что будет на доске' : 'Скрыть доску';
          if (!box.hidden && !box.dataset.mounted) {
            box.dataset.mounted = '1';
            if (alt) {
              box.innerHTML = '<div class="wn-preview-board"></div>';
              miniBoard(box.querySelector('.wn-preview-board'), e2.preview.fen, colorName(side), e2.preview.lastMove, e2.preview.shapes, true);
            } else mountCompare(box, e2.preview, startPly);
          }
        };
        const demo = tr.querySelector('[data-demo]');
        if (demo) demo.onclick = () => startDemo({ ...e2, san: move.san });
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle()));
    });
  }

  function forward() {
    clearTimeout(altTimer);
    if (intro) {
      intro = false;
      return render();
    }
    if (alt) {
      if (alt.ply < alt.def.steps.length) {
        alt.ply++;
        sound(alt.moves[alt.ply - 1].captured ? 'capture' : 'move');
      }
      return render();
    }
    if (ply >= N) return;
    wrongMsg = '';
    ply++;
    sound(moves[ply - 1].captured ? 'capture' : 'move');
    render();
  }

  function back() {
    clearTimeout(altTimer);
    wrongMsg = '';
    if (alt) {
      if (alt.ply > 0) alt.ply--;
      else alt = null;
      return render();
    }
    if (ply > 0) ply--;
    else if (essence) intro = true;
    render();
  }

  function onUserMove(m) {
    if (intro || alt || ply >= N) return;
    const expected = moves[ply];
    if (m.from === expected.from && m.to === expected.to) {
      wrongMsg = '';
      ply++;
      sound('correct');
      render();
    } else {
      sound('wrong');
      const tried = sanToMove(fens[ply], m);
      if (!tried) return board.shake(), render();
      lastWrong = coach.explain(fens[ply], tried, expected, { lineId: line.id, ply });
      const v = lastWrong.verdict;
      const replySan = lastWrong.demo && lastWrong.demo[1] ? lastWrong.demo[1].m : null;
      const after = new Chess(fens[ply]);
      after.move(tried.san);
      const reply = replySan ? sanToMove(after.fen(), replySan) : null;
      const punish = reply && (v === 'blunder' || v === 'mistake') ? `Красная стрелка — как соперник накажет: ${figurine(reply.san)}` : '';
      wrongMsg = `<div class="wn-head"><b>${moveLabel(ply, tried.san)}</b></div>
        ${verdictBanner(v, punish)}
        <p>${rich(lastWrong.text)}</p>
        <div class="wn-actions">
          <button type="button" class="btn tiny" data-peek="wrong">👀 Что будет на доске</button>
          ${lastWrong.demo ? '<button type="button" class="btn tiny" id="wrong-demo">▶ Разыграть по ходам</button>' : ''}
        </div>
        <div class="wn-preview" hidden></div>
        <p class="muted small">Ход по теории: <b>${figurine(expected.san)}</b> — сыграй его по зелёной стрелке.</p>`;
      wrongVerdict = v;
      render();
      // на доске: какой ход сделан (стрелка и значок) и чем он плох (стрелка ответа соперника)
      const bad = v === 'blunder' || v === 'mistake';
      const shapes = [{ orig: tried.from, dest: tried.to, brush: bad ? 'red' : 'yellow', modifiers: { lineWidth: 10 } }];
      const glyph = glyphShape(tried.to, v);
      if (glyph) shapes.push(glyph);
      if (reply && bad) shapes.push({ orig: reply.from, dest: reply.to, brush: 'red', modifiers: { lineWidth: 13 } });
      board.flashShapes(shapes, 4500);
      if (bad) board.pulse('bad');
      else board.shake();
    }
  }

  // base — с какой позиции начинается вариант: по умолчанию он заменяет показанный ход,
  // а для «почему не по-другому» — ход, который ученику предстоит сделать.
  // Первый ход варианта сразу играется на доске, а с autoReply — и ответ соперника,
  // чтобы было видно, что произошло, без лишних нажатий.
  let altTimer = null;
  onCleanup(() => clearTimeout(altTimer));
  function startAlt(def, base = ply - 1, { autoReply = false } = {}) {
    clearTimeout(altTimer);
    const built = buildLine(def.steps, fens[base]);
    const current = { def, base, ply: 0, ...built };
    alt = current;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const step = (to, then) => {
      altTimer = setTimeout(() => {
        if (alt !== current || current.ply !== to - 1 || to > def.steps.length) return;
        current.ply = to;
        sound(current.moves[to - 1].captured ? 'capture' : 'move');
        render();
        if (then) then();
      }, to === 1 ? 450 : 1300);
    };
    step(1, autoReply && def.steps.length > 1 ? () => step(2) : null);
  }

  function renderAlt() {
    const { def } = alt;
    const step = alt.ply > 0 ? def.steps[alt.ply - 1] : null;
    const last = alt.ply > 0 ? alt.moves[alt.ply - 1] : moves[alt.base - 1];
    board.load(alt.fens[alt.ply], last ? [last.from, last.to] : undefined);
    board.setHint(null);
    const altShapes = shapesFor(step, alt.fens[alt.ply], null);
    // У ходов без своих стрелок рисуем сам ход: наш — синим, соперника — красным.
    if (step && !step.a && alt.ply > 0) {
      const m = alt.moves[alt.ply - 1];
      altShapes.push({ orig: m.from, dest: m.to, brush: m.color === side ? 'blue' : 'red' });
    }
    board.shapes(altShapes);
    const done = alt.ply >= def.steps.length;
    body.innerHTML = `
      <div class="move-card alt-card">
        <div class="alt-label">🤔 ${esc(def.label)}</div>
        ${def.intro ? `<p class="alt-intro-text">${rich(def.intro)}</p>` : ''}
        ${
          step
            ? `<div class="move-head"><span class="san">${moveLabel(alt.base + alt.ply - 1, clean(step.m))}</span>${annBadge(step.m)}</div><p class="explain">${rich(step.t)}</p>`
            : def.intro
              ? ''
              : '<p class="explain">Посмотрим, что будет.</p>'
        }
      </div>
      ${done ? '<div class="prompt done">Вот к чему это приводит. Возвращаемся к главной линии!</div>' : ''}
      ${explorerBlock()}
      <div class="actionbar">
        <button class="btn nav" id="prev" aria-label="Назад">◀</button>
        <button class="btn ${done ? 'primary' : ''}" id="back-main">↩ К главной линии</button>
        <button class="btn ${done ? 'nav' : 'primary'}" id="next" ${done ? 'disabled' : ''} aria-label="Дальше">${done ? '▶' : 'Дальше ▶'}</button>
      </div>`;
    bindCommon();
    body.querySelector('#back-main').onclick = () => {
      clearTimeout(altTimer);
      alt = null;
      render();
    };
  }

  function finish() {
    const r = store.markLearned(line.id);
    sound('success');
    confetti();
    const { close } = modal(`
      <div class="result">
        <div class="result-icon">📖</div>
        <h2>Вариант изучен!</h2>
        <p class="xp-gain">+${r.xp} XP</p>
        <p>${r.first ? 'Теперь закрепи его: сыграй по памяти. Через день приложение напомнит повторить — так вариант запомнится надолго.' : 'Повторение — мать учения. Теперь проверь себя в тренировке.'}</p>
        <div class="col">
          <a class="btn primary big" href="#/drill/${line.id}" data-close>🎯 Тренировать по памяти</a>
          <a class="btn" href="#/o/${opening.id}" data-close>К дебюту</a>
        </div>
      </div>`);
    announceAchievements(r.unlocked);
    onCleanup(close);
  }

  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal-wrap')) return;
    if (e.key === 'ArrowRight') forward();
    if (e.key === 'ArrowLeft') back();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  render();
}

// Что показать, если статистика Lichess не загрузилась.
// Откуда проценты: живая статистика Lichess или встроенная (20 тыс. партий с Lichess).
function statsSourceText(data, total) {
  return data.source === 'local'
    ? `Встроенная статистика: в ${total.toLocaleString('ru-RU')} ${plural(total, 'партии', 'партиях', 'партиях')} с Lichess из этой позиции`
    : `Партии игроков 1400–2000 на Lichess: ${total.toLocaleString('ru-RU')}`;
}

async function renderExplorerHelp(el, e, fen, side, retry) {
  const hasToken = !!store.settings.lichessToken;
  const onServer = await store.checkServer();
  const open = `<a class="btn" target="_blank" rel="noopener" href="${lichess.analysisUrl(fen, colorName(side))}">📖 Открыть эту позицию на Lichess</a>`;
  let html;
  if (onServer && e.kind !== 'http') {
    html = `<p>Не удалось получить статистику через сервер. Проверь, что на сервере задан <code>LICHESS_TOKEN</code> (токен Lichess без галочек) и сервер видит интернет.</p>${open}`;
  } else if (e.kind === 'http') {
    html = `<p>Lichess сейчас не отвечает (${esc(e.message)}). Попробуй позже или открой позицию на сайте.</p>${open}`;
  } else if (hasToken && e.kind === 'network') {
    html = `<p>С токеном запрос тоже не прошёл: похоже, Lichess не разрешает такие запросы прямо из браузера. Статистика заработает, когда приложение будет на твоём сервере (там запрос идёт через сервер).</p>${open}`;
  } else if (hasToken) {
    html = `<p>Lichess не принял токен. Проверь, что он скопирован целиком и не удалён на Lichess.</p>${open}`;
  } else {
    html = `<p><b>Lichess закрыл статистику дебютов для анонимных запросов</b> (с 2026 года она доступна только вошедшим в аккаунт).</p>
      ${open}
      <p class="muted small">На Lichess войди в аккаунт (он бесплатный) и нажми под доской значок книги — откроется дебютная книга с процентами ходов.</p>`;
  }
  el.innerHTML = `<div class="ex-help">
    ${html}
    <details class="ex-token">
      <summary>${hasToken ? 'Заменить токен Lichess' : 'Показывать статистику прямо здесь (нужен токен Lichess)'}</summary>
      <ol class="small">
        <li><a href="${lichess.TOKEN_CREATE_URL}" target="_blank" rel="noopener">Создай токен на Lichess</a> — галочки ставить не нужно, просто нажми «Создать».</li>
        <li>Скопируй токен (начинается с <code>lip_</code>) и вставь сюда:</li>
      </ol>
      <div class="row">
        <input class="input" id="ex-token-input" type="password" placeholder="lip_…" autocomplete="off" value="${esc(store.settings.lichessToken)}">
        <button type="button" class="btn primary" id="ex-token-save">Сохранить</button>
      </div>
    </details>
  </div>`;
  el.querySelector('#ex-token-save').onclick = () => {
    const token = el.querySelector('#ex-token-input').value.trim();
    store.saveSettings({ lichessToken: token });
    lichess.resetExplorer();
    retry();
  };
}

// ─────────────────────────── тренировка ───────────────────────────

function drillView(lineId, queue) {
  const found = findLine(lineId);
  if (!found) return notFound();
  const { opening, line } = found;
  const side = lineSide(opening, line);
  const { fens, moves } = buildLine(line.steps);
  const N = line.steps.length;
  const myMoves = moves.filter((_, i) => turnAt(fens[i]) === side).length;

  renderTopbar({ back: queue ? '#/review' : `#/o/${opening.id}`, title: opening.name });
  renderTabbar(null);
  app.innerHTML = playLayout(opening, line, 'drill');
  const body = app.querySelector('#panel-body');
  const dots = app.querySelector('#dots');
  const board = new Board(app.querySelector('#board'), { orientation: colorName(side), myColor: side, onUserMove });
  onCleanup(() => board.destroy());
  setupInsight(board);
  activeBoard = board;
  onCleanup(() => (activeBoard = null));

  let ply = 0;
  let mistakes = 0;
  let hints = 0;
  let stepErrors = 0;
  let lastNote = '';
  let drillWhy = null;
  let timer = null;
  let finished = false;
  onCleanup(() => clearTimeout(timer));

  function myIndex() {
    return moves.slice(0, ply).filter((_, i) => turnAt(fens[i]) === side).length;
  }

  function render() {
    const last = ply > 0 ? moves[ply - 1] : null;
    board.load(fens[ply], last ? [last.from, last.to] : undefined);
    renderDots(dots, N, ply, side, fens);
    const next = ply < N ? moves[ply] : null;
    const myTurn = next && turnAt(fens[ply]) === side;

    // В тренировке показываем только угрозы соперника, чтобы не подсказывать ответ.
    const step = ply > 0 ? line.steps[ply - 1] : null;
    const shapes = step ? parseArrows(step.a).filter((s) => s.brush === 'red') : [];
    if (store.settings.threats) {
      const seen = new Set(shapes.map((s) => s.orig + s.dest));
      for (const t of threatArrows(new Chess(fens[ply]), side)) if (!seen.has(t.orig + t.dest)) shapes.push(t);
    }
    if (myTurn && stepErrors >= 1) shapes.push({ orig: next.from, brush: 'yellow' });
    if (myTurn && stepErrors >= 2) shapes.push({ orig: next.from, dest: next.to, brush: 'green' });
    board.shapes(shapes);

    let hint = '';
    if (myTurn && stepErrors === 1) hint = `Подсказка: ходит ${PIECE_NAME[next.piece]} (подсвечен жёлтым).`;
    if (myTurn && stepErrors >= 2) hint = `Правильно: <b>${figurine(next.san)}</b> — повтори по стрелке.`;

    body.innerHTML = `
      <div class="drill-stats">
        <span>Ход <b>${Math.min(myIndex() + (myTurn ? 1 : 0), myMoves)}</b> из ${myMoves}</span>
        <span class="${mistakes ? 'bad' : ''}">Ошибки: <b>${mistakes}</b></span>
        <span>Подсказки: <b>${hints}</b></span>
      </div>
      <div class="prompt ${myTurn ? 'mine' : ''}">
        ${!next ? '🏁 Готово!' : myTurn ? `Твой ход ${sideName(side)}. Вспомни, что здесь играют!` : 'Соперник думает…'}
      </div>
      ${
        myTurn && drillWhy
          ? `<div class="wrong-msg"><div class="wn-head"><b>${moveLabel(ply, drillWhy.san)}</b>${verdictBadge(drillWhy.verdict)}</div><p>${rich(drillWhy.text)}</p>${hint ? `<p>${hint}</p>` : ''}</div>`
          : hint
            ? `<div class="wrong-msg">${hint}</div>`
            : ''
      }
      ${lastNote && store.settings.drillText ? `<div class="move-card small">${lastNote}</div>` : ''}
      <div class="actionbar">
        <button class="btn" id="restart">↺ Заново</button>
        <button class="btn" id="show" ${myTurn ? '' : 'disabled'}>💡 Показать ход</button>
      </div>`;
    body.querySelector('#show').onclick = () => {
      if (!myTurn) return;
      hints++;
      stepErrors = 2;
      render();
    };
    body.querySelector('#restart').onclick = () => {
      clearTimeout(timer);
      ply = 0;
      mistakes = 0;
      hints = 0;
      stepErrors = 0;
      lastNote = '';
      drillWhy = null;
      step0();
    };
    if (myTurn) board.enable(side);
  }

  function noteFor(i) {
    return `<div class="move-head"><span class="san">${moveLabel(i, line.steps[i].m)}</span></div><p class="explain">${rich(line.steps[i].t)}</p>`;
  }

  function step0() {
    render();
    if (ply < N && turnAt(fens[ply]) !== side) {
      timer = setTimeout(opponentMove, 650);
    } else if (ply >= N) {
      finish();
    }
  }

  function opponentMove() {
    lastNote = noteFor(ply);
    ply++;
    sound(moves[ply - 1].captured ? 'capture' : 'move');
    step0();
  }

  function onUserMove(m) {
    if (finished || ply >= N) return;
    const expected = moves[ply];
    if (m.from === expected.from && m.to === expected.to) {
      sound('correct');
      lastNote = noteFor(ply);
      ply++;
      stepErrors = 0;
      drillWhy = null;
      step0();
    } else {
      sound('wrong');
      board.shake();
      if (stepErrors < 2) mistakes++;
      stepErrors++;
      const tried = sanToMove(fens[ply], m);
      drillWhy = tried ? { san: tried.san, ...coach.explain(fens[ply], tried, expected, { lineId: line.id, ply, reveal: false }) } : null;
      render();
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    const r = store.recordDrill(line.id, mistakes, hints);
    sound(r.stars === 3 ? 'success' : 'correct');
    if (r.stars === 3) confetti();
    const nextDue = queue ? store.dueLines().filter((x) => x.line.id !== line.id) : [];
    const days = store.daysUntil(r.due);
    const titles = ['Нужно повторить', 'Неплохо!', 'Хорошо!', 'Идеально!'];
    const { close } = modal(`
      <div class="result">
        <div class="big-stars">${[0, 1, 2].map((i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('')}</div>
        <h2>${titles[r.stars]}</h2>
        <p>Ошибок: <b>${mistakes}</b>${hints ? ` · подсказок: <b>${hints}</b>` : ''}</p>
        <p class="xp-gain">+${r.xp} XP</p>
        <div class="memory-change">
          <span>Сила памяти</span>
          <div class="boxes">${Array.from({ length: store.MAX_BOX }, (_, i) => `<i class="${i < r.after ? 'on' : ''} ${i >= r.before && i < r.after ? 'new' : ''}"></i>`).join('')}</div>
        </div>
        <p class="muted">${r.after < r.before ? 'Вариант подзабылся — повторим его поскорее.' : ''} Следующее повторение: <b>${inDays(days)}</b>.</p>
        <div class="col">
          ${
            queue
              ? nextDue.length
                ? `<a class="btn primary big" href="#/drill/${nextDue[0].line.id}/review" data-close>Дальше (осталось ${nextDue.length}) ▶</a>`
                : '<a class="btn primary big" href="#/review" data-close>🎉 Все повторения сделаны</a>'
              : ''
          }
          <button class="btn ${queue ? '' : 'primary big'}" id="again">↺ Ещё раз</button>
          ${r.stars < 2 ? `<a class="btn" href="#/learn/${line.id}" data-close>📖 Перечитать объяснения</a>` : ''}
          <a class="btn" href="#/" data-close>На главную</a>
        </div>
      </div>`);
    onCleanup(close);
    announceAchievements(r.unlocked);
    modalAgain(close);
  }

  function modalAgain(close) {
    const btn = document.querySelector('.modal #again');
    if (btn)
      btn.onclick = () => {
        close();
        finished = false;
        ply = 0;
        mistakes = 0;
        hints = 0;
        stepErrors = 0;
        lastNote = '';
        step0();
      };
  }

  step0();
}

// ─────────────────────────── повторение ───────────────────────────

function reviewView() {
  renderTopbar({ title: 'Повторение' });
  renderTabbar('review');
  const due = store.dueLines();
  const cards = Object.entries(store.progress.cards);
  const upcoming = cards
    .filter(([id]) => !store.isDue(id))
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .slice(0, 8);

  const list = (items) =>
    items
      .map(({ opening, line }) => {
        const c = store.card(line.id);
        return `<a class="rev-item" href="#/drill/${line.id}/review">
          <div><b>${esc(opening.name)}</b><br><span class="muted">${esc(line.name)}</span></div>
          ${memoryBar(store.strength(line.id), `${c.box}/${store.MAX_BOX}`)}
        </a>`;
      })
      .join('');

  app.innerHTML = `
    <section class="card review-hero">
      ${
        due.length
          ? `<h1>Пора повторить: ${due.length}</h1>
             <p>Повторение именно сейчас — когда начинаешь забывать — лучше всего укрепляет память. Сыграй каждый вариант по памяти.</p>
             <a class="btn primary big" href="#/drill/${due[0].line.id}/review">▶ Начать повторение</a>`
          : cards.length
            ? `<h1>Всё повторено! 🎉</h1><p>На сегодня повторений нет. Загляни завтра — или выучи новый вариант.</p>
               <a class="btn primary" href="#/">📖 Выбрать новый дебют</a>`
            : `<h1>Здесь будут повторения</h1><p>Изучи первый вариант — и приложение само напомнит, когда его повторить: через 1, 3, 7, 14, 30 и 60 дней. Каждое повторение без ошибок отправляет вариант в «долгую память».</p>
               <a class="btn primary" href="#/">📖 Выбрать дебют</a>`
      }
    </section>
    ${due.length ? `<h2 class="section">Сегодня</h2><div class="rev-list">${list(due)}</div>` : ''}
    ${
      upcoming.length
        ? `<h2 class="section">Скоро</h2><div class="rev-list">${upcoming
            .map(([id, c]) => {
              const f = findLine(id);
              if (!f) return '';
              return `<a class="rev-item" href="#/drill/${id}"><div><b>${esc(f.opening.name)}</b><br><span class="muted">${esc(f.line.name)}</span></div><span class="muted">${inDays(store.daysUntil(c.due))}</span></a>`;
            })
            .join('')}</div>`
        : ''
    }
    <div class="card">
      <h2>Как работают повторения</h2>
      <div class="boxes-explain">
        ${store.INTERVALS.slice(1)
          .map((d, i) => `<div><i class="box-n">${i + 1}</i><span>${d} ${plural(d, 'день', 'дня', 'дней')}</span></div>`)
          .join('')}
      </div>
      <p class="muted">Без ошибок — вариант переходит на следующую ступень, и следующее повторение будет позже. Одна ошибка — ступень та же. Две и больше — вариант возвращается на первую ступень. С 4-й ступени вариант считается выученным.</p>
    </div>
    <p class="version-note muted">${versionText()}</p>`;
}

// ─────────────────────────── викторина ───────────────────────────

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeQuiz(count = 10) {
  const learned = allLines().filter(({ line }) => store.progress.learned[line.id]);
  const pool = learned.length >= 3 ? learned : allLines();
  const qs = [];
  for (let i = 0; i < count; i++) {
    const { opening, line } = pool[(Math.random() * pool.length) | 0];
    const side = lineSide(opening, line);
    const built = buildLine(line.steps);
    if (i % 2 === 0) {
      // Угадай дебют
      const sig = Math.min(line.steps.length, (SIGNATURE[opening.id] || 4) + ((Math.random() * 3) | 0));
      const wrong = shuffle(OPENINGS.filter((o) => o.name !== opening.name)).slice(0, 3);
      qs.push({
        type: 'name',
        opening,
        fen: built.fens[sig],
        last: built.moves[sig - 1],
        moves: built.moves.slice(0, sig),
        options: shuffle([opening.name, ...wrong.map((o) => o.name)]),
      });
    } else {
      // Найди ход
      const idx = built.moves.map((_, k) => k).filter((k) => k >= 1 && turnAt(built.fens[k]) === side);
      const k = idx[(Math.random() * idx.length) | 0];
      qs.push({ type: 'move', opening, line, side, fen: built.fens[k], last: built.moves[k - 1], answer: built.moves[k], ply: k });
    }
  }
  return qs;
}

function quizView() {
  renderTopbar({ title: 'Викторина' });
  renderTabbar('quiz');
  app.innerHTML = `
    <section class="card quiz-start">
      <div class="result-icon">❓</div>
      <h1>Викторина</h1>
      <p>10 вопросов вперемешку: <b>угадай дебют</b> по позиции и <b>найди ход</b> из дебюта. За каждый правильный ответ +5 XP.</p>
      <p class="muted">${Object.keys(store.progress.learned).length >= 3 ? 'Вопросы — по вариантам, которые ты уже изучал.' : 'Пока вопросы по всем дебютам. Изучи 3 варианта — и викторина будет по твоим.'}</p>
      <p>Лучший результат: <b>${store.progress.quizBest || 0}/10</b></p>
      <button class="btn primary big" id="start">▶ Начать</button>
    </section>
    <p class="version-note muted">${versionText()}</p>`;
  app.querySelector('#start').onclick = () => runQuiz(makeQuiz());
}

function runQuiz(qs) {
  renderTabbar(null);
  let i = 0;
  let correct = 0;
  let board = null;
  onCleanup(() => board && board.destroy());

  function show() {
    if (board) board.destroy();
    const q = qs[i];
    app.innerHTML = `
      <div class="play quiz">
        <div class="board-col"><div class="board" id="board"></div></div>
        <div class="panel">
          <div class="panel-head">
            <div class="mode-tag quiz">❓ Вопрос ${i + 1} из ${qs.length}</div>
            <div class="dots">${qs.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'cur' : ''}"></i>`).join('')}</div>
          </div>
          <div id="q"></div>
        </div>
      </div>`;
    const qEl = app.querySelector('#q');
    board = new Board(app.querySelector('#board'), {
      orientation: q.type === 'move' ? colorName(q.side) : 'white',
      onUserMove: (m) => answerMove(m),
    });
    activeBoard = board;
    board.load(q.fen, q.last ? [q.last.from, q.last.to] : undefined);

    if (q.type === 'name') {
      const movesText = q.moves.map((m, k) => (k % 2 === 0 ? `${k / 2 + 1}. ` : '') + figurine(m.san)).join(' ');
      qEl.innerHTML = `
        <h2>Какой это дебют?</h2>
        <p class="moves-text">${movesText}</p>
        <div class="options">${q.options.map((o) => `<button class="btn opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        <div id="fb"></div>`;
      qEl.querySelectorAll('.opt').forEach((b) =>
        b.addEventListener('click', () => {
          const ok = b.dataset.o === q.opening.name;
          qEl.querySelectorAll('.opt').forEach((x) => {
            x.disabled = true;
            if (x.dataset.o === q.opening.name) x.classList.add('right');
          });
          if (!ok) b.classList.add('wrongopt');
          feedback(ok, ok ? 'Верно!' : `Это ${esc(q.opening.name)}.`);
        }),
      );
    } else {
      qEl.innerHTML = `
        <h2>Найди ход</h2>
        <p>Дебют: <b>${esc(q.opening.name)}</b>. Как здесь играют ${sideName(q.side)}? Сделай ход на доске.</p>
        <div id="fb"></div>`;
      board.enable(q.side);
    }
  }

  function answerMove(m) {
    const q = qs[i];
    board.disable();
    const ok = m.from === q.answer.from && m.to === q.answer.to;
    if (ok) board.play(q.answer.san);
    else board.reset(q.last ? [q.last.from, q.last.to] : undefined);
    board.shapes([{ orig: q.answer.from, dest: q.answer.to, brush: 'green' }]);
    const step = q.line.steps[q.ply];
    feedback(ok, `${ok ? 'Верно!' : `Правильно: <b>${figurine(q.answer.san)}</b>.`} <span class="muted">${rich(step.t)}</span>`);
  }

  function feedback(ok, html) {
    if (ok) correct++;
    sound(ok ? 'correct' : 'wrong');
    const fb = app.querySelector('#fb');
    fb.innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}">${ok ? '✅' : '❌'} ${html}</div>
      <button class="btn primary big" id="nextq">${i + 1 < qs.length ? 'Следующий вопрос ▶' : 'Результат'}</button>`;
    fb.querySelector('#nextq').onclick = () => {
      i++;
      if (i < qs.length) show();
      else done();
    };
  }

  function done() {
    const r = store.recordQuiz(correct, qs.length);
    if (correct >= 8) confetti();
    sound('success');
    renderTopbar({ title: 'Викторина' });
    renderTabbar('quiz');
    app.innerHTML = `
      <section class="card quiz-start">
        <div class="result-icon">${correct === qs.length ? '🏆' : correct >= 7 ? '🎉' : correct >= 4 ? '👍' : '📚'}</div>
        <h1>${correct} из ${qs.length}</h1>
        <p class="xp-gain">+${r.xp} XP</p>
        <p>${correct >= 8 ? 'Отличная память!' : correct >= 5 ? 'Хорошо! Повторения сделают ещё лучше.' : 'Ничего страшного — повтори варианты и попробуй снова.'}</p>
        <div class="col">
          <button class="btn primary big" id="again">↺ Ещё раз</button>
          <a class="btn" href="#/review">🔁 К повторению</a>
        </div>
      </section>`;
    app.querySelector('#again').onclick = () => runQuiz(makeQuiz());
    announceAchievements(r.unlocked);
  }

  show();
}

// ─────────────────────────── свободная игра ───────────────────────────
// Играешь как хочешь: приложение пишет, какой дебют получается, а на ходу соперника
// показывает его самые популярные ответы (Lichess + наша база) — ты выбираешь, как он сыграет.

// У каждого профиля своя партия (у первого — под прежним ключом).
const freeKey = () => (store.profiles.active === 'p1' ? 'free-game' : `free-game:${store.profiles.active}`);

function loadFreeGame() {
  try {
    const g = JSON.parse(localStorage.getItem(freeKey()) || 'null');
    if (g && (g.side === 'w' || g.side === 'b') && Array.isArray(g.sans)) return g;
  } catch {}
  return { side: 'w', sans: [], cursor: 0 };
}

function freeLayout(side) {
  return `
    <div class="play lesson free">
      <div class="board-col">
        <div class="board-stage">
          <div class="board" id="board"></div>
        </div>
        ${INSIGHT_TOOLS}
        <div class="legend">
          <span><i class="lg p"></i>популярный ход соперника (чем толще — тем чаще)</span>
          <span><i class="lg g"></i>идея хода по теории</span>
        </div>
        <p class="version-note muted">${versionText()}</p>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="mode-tag free">♟ Свободная игра</div>
          <h2>Играй и смотри, что получается</h2>
          <div class="sub-row">
            <p class="muted" id="side-label">Ты играешь ${sideName(side)}</p>
            <button type="button" class="btn tiny" id="side-btn" aria-label="Сменить цвет">⇅ <span class="lbl-theory">${side === 'w' ? 'За чёрных' : 'За белых'}</span></button>
          </div>
          <div class="dots" id="dots"></div>
        </div>
        <div id="panel-body"></div>
      </div>
    </div>`;
}

function freeView() {
  renderTopbar({ back: '#/', title: 'Свободная игра' });
  renderTabbar(null);

  const saved = loadFreeGame();
  let side = saved.side;
  // Партия: сделанные ходы и позиции (fens[i] — до хода i). cursor — сколько ходов сейчас на доске;
  // ходы дальше cursor можно вернуть кнопкой ▶, пока не сыгран другой ход.
  const moves = [];
  const fens = [new Chess().fen()];
  {
    const c = new Chess();
    for (const san of saved.sans) {
      try {
        moves.push(c.move(san));
        fens.push(c.fen());
      } catch {
        break;
      }
    }
  }
  let cursor = Math.min(Math.max(0, saved.cursor ?? moves.length), moves.length);
  const explorerData = new Map(); // позиция → { data } | { error } | 'loading'
  let alive = true; // статистика может прийти, когда экран уже закрыт
  onCleanup(() => (alive = false));

  app.innerHTML = freeLayout(side);
  const body = app.querySelector('#panel-body');
  const board = new Board(app.querySelector('#board'), { orientation: colorName(side), myColor: side, onUserMove });
  onCleanup(() => board.destroy());
  setupInsight(board);
  activeBoard = board;
  onCleanup(() => (activeBoard = null));

  const fen = () => fens[cursor];
  const save = () => {
    try {
      localStorage.setItem(freeKey(), JSON.stringify({ side, sans: moves.map((m) => m.san), cursor }));
    } catch {}
  };
  const uci = (m) => m.from + m.to + (m.promotion || '');
  // Основные ходы вариантов из базы в позиции и сыгранный ход i, если он «по книге».
  const bookMain = (f) => coach.bookMoves(f).filter((e) => e.ply !== undefined);
  const bookFor = (i) => bookMain(fens[i]).filter((e) => e.san === moves[i].san);

  // Какой дебют на доске: последний ход «по книге» (с учётом перестановки ходов).
  function detect() {
    let lastBook = -1;
    let entries = [];
    for (let i = 0; i < cursor; i++) {
      const es = bookFor(i);
      if (es.length) {
        lastBook = i;
        entries = es;
      }
    }
    return { lastBook, entries, inBook: cursor > 0 && lastBook === cursor - 1 };
  }

  // Названия дебютов из записей базы: сначала обычные дебюты, ловушки — отдельно.
  function namesOf(entries) {
    const openings = [];
    const traps = [];
    for (const e of entries) {
      const list = e.trap ? traps : openings;
      if (!list.find((x) => x.opening === e.opening)) list.push({ opening: e.opening, line: e.line, ply: e.ply });
    }
    return { openings, traps };
  }

  // Строка «что разыгрывается». Пока подходит много дебютов (например, после 1.e4) — перечисляем их,
  // когда дебют определился — пишем вариант и сколько ходов из него уже сыграно.
  // Название для шапки: какой дебют на доске (или «Свободная игра», пока непонятно).
  function openingTitle() {
    const d = detect();
    if (!d.entries.length) return 'Свободная игра';
    const { openings, traps } = namesOf(d.entries);
    if (d.inBook && openings.length >= 3) return 'Свободная игра';
    const name = (openings[0] || traps[0]).opening.name;
    return d.inBook ? name : `${name} (вне теории)`;
  }

  function openingStatus() {
    if (cursor === 0) return '';
    const d = detect();
    const ex = explorerData.get(fen());
    // английское название с Lichess нужно, только когда своего точного названия нет
    const lichessName = ex && ex.data && ex.data.opening ? ` · на Lichess: ${esc(ex.data.opening.name)}` : '';
    const link = (o) => `<a href="#/o/${o.opening.id}">${esc(o.opening.name)}</a>`;
    if (d.inBook) {
      const { openings, traps } = namesOf(d.entries);
      if (openings.length >= 3) {
        return `<div class="free-opening">📖 Подходит несколько дебютов: ${openings.slice(0, 4).map(link).join(', ')}${openings.length > 4 ? '…' : ''}<div class="fo-sub">${lichessName.replace(/^ · /, '')}</div></div>`;
      }
      const main = openings[0] || traps[0];
      const title = openings.length === 2 ? `${link(openings[0])} или ${link(openings[1])}` : `${main.opening.category === 'trap' ? '⚠️ ' : ''}${link(main)}`;
      const trap = traps.length && openings.length ? ` · ⚠️ ловушка ${link(traps[0])}` : '';
      return `<div class="free-opening">📖 <b>${title}</b>
          <div class="fo-sub">${esc(main.line.name)} · ход ${main.ply + 1} из ${main.line.steps.length} · <a href="#/learn/${main.line.id}">учить →</a>${trap}</div>
        </div>`;
    }
    if (d.lastBook >= 0) {
      const { openings, traps } = namesOf(d.entries);
      return `<div class="free-opening off">🧭 Ушли из теории после <b>${moveLabel(d.lastBook, moves[d.lastBook].san)}</b>
          <div class="fo-sub">Это была ${link(openings[0] || traps[0])}${lichessName}</div></div>`;
    }
    return `<div class="free-opening off">🧭 Такого начала нет в нашей базе<div class="fo-sub">${lichessName.replace(/^ · /, '')}</div></div>`;
  }

  // Разбор хода i: по теории он или нет, оценка тренера и как соперник накажет ошибку.
  const analysisCache = new Map();
  function analyse(i) {
    const key = fens[i] + ' ' + moves[i].san;
    if (analysisCache.has(key)) return analysisCache.get(key);
    const m = moves[i];
    let a;
    const book = bookFor(i);
    if (book.length) {
      a = { verdict: 'book', text: book[0].text, arrows: book[0].arrows };
    } else {
      const known = bookMain(fens[i]);
      const theory = known.length ? sanToMove(fens[i], known[0].san) : null;
      const e = coach.explain(fens[i], m, theory, known.length ? { lineId: known[0].line.id, ply: known[0].ply } : {});
      // ответ соперника, который наказывает ход (если тренер его знает)
      const replySan = e.demo && e.demo[1] ? e.demo[1].m : null;
      const reply = replySan ? sanToMove(fens[i + 1], replySan) : null;
      a = { verdict: e.verdict, text: e.text + (theory ? ` По теории здесь играют ${figurine(known[0].san)}.` : ''), reply };
    }
    analysisCache.set(key, a);
    return a;
  }

  // Разбор последнего хода: плашка с оценкой, насколько ход популярен, объяснение.
  function lastMoveCard() {
    if (cursor === 0) {
      return `<div class="move-card">
          <div class="move-head"><span class="san">Начальная позиция</span><span class="who me">ты играешь ${sideName(side)}</span></div>
          <p class="explain">Ходи на доске как хочешь. Я буду писать, какой дебют получается, оценивать каждый ход и показывать, насколько он популярен, а на ходу соперника — его самые частые ответы: выбери, как он сыграет.</p>
        </div>`;
    }
    const i = cursor - 1;
    const m = moves[i];
    const mover = turnAt(fens[i]);
    const a = analyse(i);
    const ex = explorerData.get(fens[i]);
    const pop = ex && ex.data ? popularityHtml(ex.data, m.san) : '';
    const punish =
      a.reply && (a.verdict === 'blunder' || a.verdict === 'mistake')
        ? `Красная стрелка на доске — как ${mover === side ? 'соперник накажет' : 'ты можешь наказать'}: ${figurine(a.reply.san)}`
        : '';
    const c = new Chess(fen());
    const over = c.isCheckmate()
      ? `<div class="prompt done">🏁 Мат! Победили ${mover === 'w' ? 'белые' : 'чёрные'}.</div>`
      : c.isDraw() || c.isStalemate()
        ? '<div class="prompt done">🤝 Ничья.</div>'
        : '';
    const choosing = !over && turnAt(fen()) !== side;
    const bad = a.verdict === 'blunder' || a.verdict === 'mistake';
    const text = choosing && !bad
      ? `<details class="why-more"><summary>Почему?</summary><p class="explain">${rich(a.text)}</p></details>`
      : `<p class="explain">${rich(a.text)}</p>`;
    return `<div class="move-card vc-${a.verdict}">
        <div class="move-head"><span class="san">${moveLabel(i, m.san)}</span><span class="who ${mover === side ? 'me' : 'opp'}">${mover === side ? 'твой ход' : 'ход соперника'}</span></div>
        ${verdictBanner(a.verdict, punish)}
        ${pop}
        ${text}
      </div>${over}`;
  }

  // Значок оценки и подсветка клетки последнего хода, стрелка наказания за ошибку.
  function verdictShapes() {
    if (cursor === 0) return { shapes: [], marks: [] };
    const i = cursor - 1;
    const m = moves[i];
    const a = analyse(i);
    const shapes = [];
    const marks = [];
    const glyph = glyphShape(m.to, a.verdict);
    if (glyph) shapes.push(glyph);
    const cls = { blunder: 'mark-bad', mistake: 'mark-bad', dubious: 'mark-warn', good: 'mark-good', book: 'mark-good' }[a.verdict];
    if (cls) marks.push([m.to, cls]);
    if (a.reply && (a.verdict === 'blunder' || a.verdict === 'mistake')) {
      shapes.push({ orig: a.reply.from, dest: a.reply.to, brush: 'red', modifiers: { lineWidth: 13 } });
      if (a.reply.captured) marks.push([a.reply.to, 'mark-lost']);
    }
    return { shapes, marks };
  }

  // Варианты хода для стороны, которая ходит: статистика Lichess + ходы из базы.
  function candidates() {
    const f = fen();
    const book = new Map();
    for (const e of coach.bookMoves(f)) {
      const label = e.altDef ? e.altDef.label : e.opening.name;
      const b = book.get(e.san) || { labels: [], main: false, text: '' };
      if (!b.labels.includes(label)) b.labels.push(label);
      if (e.ply !== undefined) b.main = true;
      // зачем этот ход — первая фраза объяснения из урока (основной вариант важнее побочного)
      if (e.text && (!b.text || (e.ply !== undefined && !b.fromMain))) {
        const sentences = e.text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [e.text];
        let why = '';
        for (const t of sentences.slice(0, 2)) if (why.length < 50) why += t;
        b.text = why.trim();
        b.fromMain = e.ply !== undefined;
      }
      book.set(e.san, b);
    }
    const ex = explorerData.get(f);
    const rows = [];
    let total = 0;
    if (ex && ex.data) {
      total = ex.data.total;
      for (const m of ex.data.moves) {
        const n = m.white + m.draws + m.black;
        if (n) rows.push({ san: m.san, n, w: m.white, d: m.draws, b: m.black, book: book.get(m.san) });
      }
    }
    for (const [san, b] of book) if (b.main && !rows.find((r) => r.san === san)) rows.push({ san, book: b });
    // Ни статистики, ни теории (например, без токена Lichess и после выхода из базы) —
    // предлагаем разумные ходы по оценке тренера, чтобы партию можно было продолжить.
    if (!rows.length && ex && ex !== 'loading' && !(ex.data && ex.data.moves.length)) {
      for (const m of sensibleMoves(f)) rows.push({ san: m.san, coachPick: true });
    }
    return rows
      .map((r) => ({ ...r, move: sanToMove(f, r.san), share: total && r.n ? r.n / total : null }))
      .filter((r) => r.move);
  }

  const sensibleCache = new Map();
  function sensibleMoves(f) {
    if (sensibleCache.has(f)) return sensibleCache.get(f);
    const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const scored = [];
    for (const m of new Chess(f).moves({ verbose: true })) {
      const e = coach.explain(f, m, null, {});
      if (e.verdict !== 'ok' && e.verdict !== 'good') continue;
      let score = 0;
      if (m.flags.includes('k') || m.flags.includes('q')) score += 6; // рокировка
      if (m.captured) score += 2 + VALUE[m.captured];
      if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) score += 4; // развитие
      if (m.piece === 'p' && (m.from[0] === 'd' || m.from[0] === 'e')) score += 3; // центр
      if (m.san.includes('+')) score += 1;
      scored.push({ m, score });
    }
    const out = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.m);
    sensibleCache.set(f, out);
    return out;
  }

  function candidateArrows(rows, mine) {
    return rows.slice(0, 6).map((r) => ({
      orig: r.move.from,
      dest: r.move.to,
      brush: mine ? 'candMine' : 'cand',
      modifiers: { lineWidth: r.share != null ? Math.round(3 + 13 * Math.min(1, r.share * 1.4)) : 8 },
    }));
  }

  function candidatesHtml(rows, mine) {
    const turn = turnAt(fen());
    const ex = explorerData.get(fen());
    const total = ex && ex.data ? ex.data.total : 0;
    const title = mine
      ? `💡 Что здесь чаще играют ${sideName(turn)}`
      : `Выбери ответ соперника (${turn === 'w' ? 'белые' : 'чёрные'}):`;
    const loading = ex === 'loading' ? '<p class="muted small">Загружаю статистику Lichess…</p>' : '';
    const noStats =
      ex && ex.error
        ? `<p class="muted small">Для этой позиции нет встроенной статистики, а статистика Lichess недоступна. <button type="button" class="link-btn" id="ex-help-btn">Подключить Lichess</button></p><div id="ex-help"></div>`
        : '';
    const list = rows.length
      ? rows
          .map((r, k) => {
            const n = r.n || 0;
            // ход из базы, которого нет среди самых частых, — значит, его играют редко
            const pct = r.share != null ? `${Math.max(1, Math.round(r.share * 100))}%` : total ? 'редко' : '';
            const bar = n
              ? `<span class="wdb"><i class="w" style="width:${(r.w / n) * 100}%"></i><i class="d" style="width:${(r.d / n) * 100}%"></i><i class="b" style="width:${(r.b / n) * 100}%"></i></span>`
              : '';
            const note = r.book ? `<span class="c-note">★ ${r.book.labels.slice(0, 2).map(esc).join(' · ')}</span>` : '';
            // зачем этот ход: из урока, а если его нет в базе — короткая идея от тренера
            const idea = (r.book && r.book.text) || coach.moveIdea(fen(), r.move);
            const ideaHtml = idea ? `<span class="c-idea">${richInButton(idea)}</span>` : '';
            return `<button type="button" class="cand ${r.book ? 'book' : ''}" data-k="${k}">
                <span class="c-san">${figurine(r.san)}</span><span class="c-pct">${pct}</span><span class="c-bar">${bar}</span>${note}${ideaHtml}
              </button>`;
          })
          .join('')
      : `<p class="muted">${ex === 'loading' ? '' : 'Ни в нашей базе, ни в статистике нет ходов для этой позиции.'} Сделай ход за ${mine ? 'себя' : 'соперника'} на доске сам.</p>`;
    return `<div class="cands">
        <div class="cands-title">${title}</div>
        ${list}
        ${rows.some((r) => r.coachPick) ? '<p class="muted small">Статистики для этой позиции нет — это ходы, которые тренер считает разумными.</p>' : ''}
        ${rows.some((r) => r.n) ? `<p class="muted small">% — как часто так играют: ${ex.data.source === 'local' ? `встроенная статистика по ${ex.data.total.toLocaleString('ru-RU')} ${plural(ex.data.total, 'партии', 'партиям', 'партиям')} с Lichess` : 'Lichess, игроки 1400–2000'}. Полоска: победы белых / ничьи / победы чёрных. ★ — ход из нашей базы.</p>` : ''}
        ${ex && ex.data && ex.data.lichessError ? '<p class="muted small">Свежая статистика Lichess: <button type="button" class="link-btn" id="ex-help-btn">подключить</button></p><div id="ex-help"></div>' : ''}
        ${loading}${noStats}
        ${mine ? '' : '<p class="muted small">Можно и самому передвинуть фигуру соперника на доске.</p>'}
      </div>`;
  }

  // Статистика позиции после k ходов: для выбора ответа и чтобы показать, насколько популярен ход.
  function loadExplorer(k = cursor) {
    const f = fens[k];
    if (explorerData.has(f)) return;
    explorerData.set(f, 'loading');
    moveStats(moves.slice(0, k).map(uci), f)
      .then((data) => explorerData.set(f, { data }))
      .catch((error) => explorerData.set(f, { error }))
      .finally(() => {
        if (alive && (fen() === f || fens[cursor - 1] === f)) render();
      });
  }

  function movesListHtml() {
    if (!moves.length) return '';
    const parts = moves.map((m, i) => {
      const num = i % 2 === 0 ? `<span class="ml-num">${i / 2 + 1}.</span>` : '';
      return `${num}<button type="button" class="ml-move ${i === cursor - 1 ? 'cur' : ''} ${i >= cursor ? 'future' : ''}" data-ply="${i + 1}">${figurine(m.san)}</button>`;
    });
    return `<div class="move-list"><div class="cands-title">Партия</div><div class="ml">${parts.join(' ')}</div>
      <button type="button" class="btn tiny" id="free-restart">⟲ Начать заново</button></div>`;
  }

  let rows = [];
  // Страницы под доской: 0 — разбор хода, 1 — ответ соперника / что играть, 2 — партия.
  // На телефоне они листаются свайпом, на компьютере идут одна под другой.
  let page = 0;
  const PAGE_NAMES = ['📋 Разбор', '', '📜 Партия'];

  // Стрелки на доске: на ходу соперника — его популярные ответы; на своём ходу — подсказка,
  // только если открыта страница «Что играть»; иначе — идеи хода из теории.
  function applyShapes() {
    const over = new Chess(fen()).isGameOver();
    const myTurn = turnAt(fen()) === side;
    const showCands = !over && (!myTurn || page === 1);
    const lastBook = cursor > 0 ? bookFor(cursor - 1) : [];
    const vs = verdictShapes();
    const main = showCands ? candidateArrows(rows, myTurn) : lastBook.length ? parseArrows(lastBook[0].arrows) : [];
    // стрелка наказания важнее: убираем совпадающую с ней стрелку-кандидата
    const taken = new Set(vs.shapes.filter((x) => x.dest).map((x) => x.orig + x.dest));
    board.shapes([...main.filter((x) => !taken.has(x.orig + x.dest)), ...vs.shapes]);
    return vs;
  }

  function render() {
    const f = fen();
    const c = new Chess(f);
    const over = c.isGameOver();
    const turn = c.turn();
    const myTurn = turn === side;
    const last = cursor > 0 ? moves[cursor - 1] : null;
    board.load(f, last ? [last.from, last.to] : undefined);
    if (!over) board.enable(turn);

    if (!over) loadExplorer();
    if (cursor > 0) loadExplorer(cursor - 1);
    rows = over ? [] : candidates();
    board.setMarks(applyShapes().marks);
    app.querySelector('#dots').innerHTML = materialChip(f, side);
    topbar.querySelector('.title').textContent = openingTitle();

    let mainBtn;
    if (over) mainBtn = '<button class="btn primary" id="free-new">⟲ Новая партия</button>';
    else if (!myTurn) mainBtn = `<button class="btn primary" id="free-random" ${rows.length ? '' : 'disabled'}>🎲 Ответ соперника</button>`;
    else mainBtn = `<button class="btn" id="free-hint">💡 ${page === 1 ? 'Скрыть подсказку' : 'Что здесь играют?'}</button>`;

    PAGE_NAMES[1] = over ? '🏁 Итог' : myTurn ? '💡 Что играть' : '🎯 Ответ соперника';
    body.innerHTML = `
      <div class="pager-tabs" role="tablist">
        ${PAGE_NAMES.map((name, k) => `<button type="button" role="tab" class="pager-tab ${k === page ? 'on' : ''}" data-go="${k}" aria-selected="${k === page}">${name}</button>`).join('')}
      </div>
      <div class="pager" id="pager">
        <section class="page" data-page="0">
          ${lastMoveCard()}
          ${openingStatus()}
          ${!over && myTurn ? `<div class="prompt mine">Твой ход ${sideName(turn)}: ходи на доске. <span class="phone-only">Не знаешь, что играть, — листай вправо 👉</span><span class="desk-only">Не знаешь, что играть, — нажми «💡 Что здесь играют?».</span></div>` : ''}
          ${!over && !myTurn ? '<p class="muted small phone-only">👉 Листай вправо — ответы соперника</p>' : ''}
        </section>
        <section class="page ${myTurn && page !== 1 ? 'desk-hidden' : ''}" data-page="1">
          ${!over && !myTurn ? lastMoveSummary() : ''}
          ${over ? '<p class="muted">Партия окончена. Можно отмотать ходы назад ◀ и попробовать иначе.</p>' : candidatesHtml(rows, myTurn)}
        </section>
        <section class="page" data-page="2">
          ${movesListHtml() || '<p class="muted">Ходов пока нет.</p>'}
        </section>
      </div>
      <div class="actionbar">
        <button class="btn nav" id="prev" ${cursor === 0 ? 'disabled' : ''} aria-label="Назад">◀</button>
        ${mainBtn}
        <button class="btn nav" id="next" ${cursor >= moves.length ? 'disabled' : ''} aria-label="Вперёд">▶</button>
      </div>`;
    bind();
    showPage(page, false);
    save();
  }

  // Строка «твой ход — оценка — популярность» над ответами соперника; нажатие открывает разбор.
  function lastMoveSummary() {
    if (cursor === 0) return '';
    const i = cursor - 1;
    const a = analyse(i);
    const ex = explorerData.get(fens[i]);
    const data = ex && ex.data;
    const st = data && data.total ? data.moves.find((m) => m.san === moves[i].san) : null;
    const pct = st ? ` · так играют в ${Math.max(1, Math.round(((st.white + st.draws + st.black) / data.total) * 100))}%` : data && data.total ? ' · редкий ход' : '';
    return `<button type="button" class="last-sum vc-${a.verdict}" data-go="0">
        <span>${moveLabel(i, moves[i].san)}</span>${verdictBadge(a.verdict)}<span class="muted small">${pct}</span><span class="ls-more">разбор ›</span>
      </button>`;
  }

  // Перейти на страницу k (на телефоне — прокрутить ленту страниц).
  function showPage(k, smooth = true) {
    page = k;
    const pager = body.querySelector('#pager');
    if (!pager) return;
    body.querySelectorAll('.pager-tab').forEach((t) => {
      const on = +t.dataset.go === k;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on);
    });
    const swipe = pager.scrollWidth > pager.clientWidth + 1;
    if (swipe) {
      const target = k * pager.clientWidth;
      if (Math.abs(pager.scrollLeft - target) > 2) {
        if (smooth) pager.scrollTo({ left: target, behavior: 'smooth' });
        else pager.scrollLeft = target;
      }
      fitPagerHeight();
    } else pager.style.height = '';
  }
  // поворот телефона или изменение окна: раскладка страниц могла смениться
  const onResize = () => showPage(page, false);
  window.addEventListener('resize', onResize);
  onCleanup(() => window.removeEventListener('resize', onResize));

  // Высота ленты — по открытой странице, чтобы под короткой страницей не было пустоты.
  // Только когда страницы листаются (телефон): на компьютере они стоят рядом/друг под другом,
  // и фиксированная высота обрезала бы их — панель кнопок наезжала на список ходов.
  function fitPagerHeight() {
    const pager = body.querySelector('#pager');
    if (!pager) return;
    if (pager.scrollWidth <= pager.clientWidth + 1) {
      pager.style.height = '';
      return;
    }
    const el = pager.querySelector(`[data-page="${page}"]`);
    if (el) pager.style.height = `${el.offsetHeight}px`;
  }

  function bind() {
    body.querySelector('#prev').onclick = back;
    body.querySelector('#next').onclick = forward;
    const q = (id) => body.querySelector(id);
    if (q('#free-new')) q('#free-new').onclick = restart;
    if (q('#free-random')) q('#free-random').onclick = playRandom;
    if (q('#free-hint'))
      q('#free-hint').onclick = () => {
        page = page === 1 ? 0 : 1;
        render();
      };
    if (q('#free-restart')) q('#free-restart').onclick = restart;
    body.querySelectorAll('.pager-tab, .last-sum').forEach((t) => {
      t.onclick = () => {
        const k = +t.dataset.go;
        if (k === page) return;
        const was = page;
        showPage(k);
        if (was === 1 || k === 1) applyShapes();
      };
    });
    // свайп: страница меняется, когда лента остановилась
    const pager = q('#pager');
    let settle = null;
    pager.addEventListener(
      'scroll',
      () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
          if (pager.scrollWidth <= pager.clientWidth + 1) return;
          const k = Math.round(pager.scrollLeft / pager.clientWidth);
          if (k === page) return fitPagerHeight();
          const was = page;
          showPage(k, false);
          if (was === 1 || k === 1) applyShapes();
          if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 90);
      },
      { passive: true },
    );
    body.querySelectorAll('.cand').forEach((b) => {
      const r = rows[+b.dataset.k];
      b.onclick = () => playMove(r.move);
      const arrow = [{ orig: r.move.from, dest: r.move.to, brush: 'paleBlue', modifiers: { lineWidth: 14 } }];
      b.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && board.applyShapes(arrow));
      b.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && board.applyShapes());
    });
    body.querySelectorAll('.ml-move').forEach((b) => {
      b.onclick = () => {
        cursor = +b.dataset.ply;
        page = 0;
        render();
      };
    });
    body.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', fitPagerHeight));
    const help = q('#ex-help-btn');
    if (help)
      help.onclick = () => {
        const f = fen();
        const ex = explorerData.get(f);
        renderExplorerHelp(q('#ex-help'), ex.error || ex.data.lichessError, f, side, () => {
          explorerData.clear();
          render();
        });
        fitPagerHeight();
      };
  }

  // Сделать ход в текущей позиции: если он совпадает с ходом из «будущего» — просто идём вперёд.
  function playMove(m) {
    const c = new Chess(fen());
    let mv;
    try {
      mv = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      return render();
    }
    if (moves[cursor] && moves[cursor].san === mv.san) {
      cursor++;
    } else {
      moves.length = cursor;
      fens.length = cursor + 1;
      moves.push(mv);
      fens.push(c.fen());
      cursor++;
    }
    const a = analyse(cursor - 1);
    page = mv.color === side && a.verdict !== 'blunder' && a.verdict !== 'mistake' ? 1 : 0;
    render();
    // свой ход: вспышка и звук по оценке; ход соперника — обычный звук
    if (mv.color === side && (a.verdict === 'blunder' || a.verdict === 'mistake')) {
      board.pulse('bad');
      sound('wrong');
    } else if (mv.color === side && (a.verdict === 'book' || a.verdict === 'good')) {
      board.pulse('good');
      sound('correct');
    } else sound(mv.captured ? 'capture' : 'move');
  }

  function onUserMove(m) {
    playMove(m);
  }

  // Соперник «как в жизни»: случайный ход, чаще — популярный.
  function playRandom() {
    if (!rows.length) return;
    const weights = rows.map((r) => r.n || 1);
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let k = 0; k < rows.length; k++) {
      x -= weights[k];
      if (x <= 0) return playMove(rows[k].move);
    }
    playMove(rows[0].move);
  }

  function back() {
    if (cursor === 0) return;
    cursor--;
    page = 0;
    render();
  }

  function forward() {
    if (cursor >= moves.length) return;
    cursor++;
    page = 0;
    render();
  }

  // «Заново» не стирает партию сразу: её можно вернуть кнопкой ▶, пока не сыгран другой ход.
  function restart() {
    cursor = 0;
    page = 0;
    render();
  }

  app.querySelector('#side-btn').onclick = () => {
    side = side === 'w' ? 'b' : 'w';
    board.myColor = side;
    board.cg.set({ orientation: colorName(side) });
    app.querySelector('#side-label').textContent = `Ты играешь ${sideName(side)}`;
    app.querySelector('#side-btn .lbl-theory').textContent = side === 'w' ? 'За чёрных' : 'За белых';
    page = 0;
    render();
  };

  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal-wrap')) return;
    if (e.key === 'ArrowRight') forward();
    if (e.key === 'ArrowLeft') back();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  render();
}

// ─────────────────────────── профиль ───────────────────────────

function profileView() {
  renderTopbar({ title: 'Профиль' });
  renderTabbar('profile');
  const lv = store.levelInfo();
  const p = store.progress;
  const lines = allLines();
  const learned = lines.filter(({ line }) => p.learned[line.id]).length;
  const mastered = lines.filter(({ line }) => store.lineStatus(line.id) === 'mastered').length;
  const s = store.settings;

  // Календарь активности за 12 недель: колонки — недели, начиная с понедельника.
  const cells = [];
  const weekday = (new Date().getDay() + 6) % 7;
  for (let d = -(77 + weekday); d <= 0; d++) {
    const key = store.today(d);
    const xp = p.days[key] || 0;
    const lvl = xp === 0 ? 0 : xp < 30 ? 1 : xp < 60 ? 2 : xp < 120 ? 3 : 4;
    cells.push(`<i class="c${lvl}" title="${key}: ${xp} XP"></i>`);
  }

  const me = store.activeProfile();
  app.innerHTML = `
    <section class="card who-card">
      <h2>Кто занимается</h2>
      <div class="who-list">
        ${store.profiles.list
          .map((x) => {
            const xlv = store.levelInfo(store.progressOf(x.id).xp);
            return `<button type="button" class="who-btn ${x.id === me.id ? 'on' : ''}" data-profile="${x.id}">
                <span class="who-emoji">${x.emoji}</span><b>${esc(x.name)}</b><span class="muted small">уровень ${xlv.level} · ${esc(xlv.rank)}</span>
              </button>`;
          })
          .join('')}
      </div>
      <p class="muted small">У каждого свой прогресс, серия и повторения. Сейчас: <b>${esc(me.name)}</b>. <button type="button" class="link-btn" id="who-rename">✏️ Изменить имя и значок</button></p>
    </section>
    <section class="card level-card">
      <div class="level-badge">${lv.level}</div>
      <div>
        <h1>${esc(lv.rank)}</h1>
        <p class="muted">Уровень ${lv.level} · всего ${p.xp} XP</p>
        <div class="xpbar big"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div>
        <p class="muted small">${lv.need - lv.into} XP до следующего уровня</p>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b>🔥 ${store.streak()}</b><span>серия дней</span></div>
      <div class="stat"><b>${learned}/${lines.length}</b><span>изучено</span></div>
      <div class="stat"><b>${mastered}</b><span>выучено</span></div>
      <div class="stat"><b>${p.quizBest || 0}/10</b><span>викторина</span></div>
    </div>
    <div class="card">
      <h2>Активность</h2>
      <div class="heat">${cells.join('')}</div>
    </div>
    <h2 class="section">Достижения</h2>
    <div class="achievements">
      ${store.ACHIEVEMENTS.map(
        (a) => `<div class="ach ${p.achievements[a.id] ? 'got' : ''}"><span class="ach-icon">${a.icon}</span><b>${esc(a.name)}</b><span class="muted">${esc(a.desc)}</span></div>`,
      ).join('')}
    </div>
    <h2 class="section">Настройки</h2>
    <div class="card settings">
      ${[
        ['sound', 'Звуки'],
        ['threats', 'Автоматически показывать угрозы соперника (красные стрелки)'],
        ['hints', 'Подсказка-стрелка в режиме изучения'],
        ['drillText', 'Объяснения ходов в тренировке'],
      ]
        .map(
          ([k, label]) =>
            `<label class="toggle"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span class="sw"></span>${label}</label>`,
        )
        .join('')}
    </div>
    <div class="card" id="sync-card">
      <h2>☁️ Синхронизация телефона и ноутбука</h2>
      <div id="gh-body"></div>
      <div id="sync-body"></div>
    </div>
    <div class="card">
      <h2>Lichess</h2>
      <p class="muted">С 2026 года Lichess показывает статистику дебютов только вошедшим пользователям. Чтобы видеть её в приложении, <a href="${lichess.TOKEN_CREATE_URL}" target="_blank" rel="noopener">создай токен на Lichess</a> (без галочек) и вставь сюда. На своём сервере вместо этого можно задать LICHESS_TOKEN.</p>
      <div class="row">
        <input class="input" id="li-token" type="password" placeholder="lip_…" value="${esc(s.lichessToken)}" autocomplete="off">
      </div>
      <div class="row token-actions">
        <button type="button" class="btn primary" id="li-save">Сохранить</button>
        <button type="button" class="btn" id="li-check">Проверить</button>
      </div>
      <p class="muted small" id="li-status">${s.lichessToken ? 'Токен сохранён на этом устройстве.' : 'Токен не задан.'}</p>
    </div>
    <div class="card">
      <h2>Резервная копия</h2>
      <div class="row">
        <button class="btn" id="export">⬇ Скачать прогресс</button>
        <label class="btn">⬆ Загрузить<input type="file" id="import" accept=".json,application/json" hidden></label>
        <button class="btn danger" id="reset">Сбросить всё</button>
      </div>
    </div>
    <div class="card version-card">
      <h2>О приложении</h2>
      <p>${versionText()}</p>
      <p class="muted small" id="version-status">Проверяю, есть ли обновление…</p>
      <button type="button" class="btn" id="version-check">🔄 Проверить обновление</button>
    </div>
    <p class="muted small center">Доска и фигуры — chessground (Lichess) · правила — chess.js</p>`;

  app.querySelectorAll('[data-profile]').forEach((b) => {
    b.onclick = () => {
      store.switchProfile(b.dataset.profile);
      toast(`${store.activeProfile().emoji} Теперь занимается: <b>${esc(store.activeProfile().name)}</b>`);
      profileView();
    };
  });
  app.querySelector('#who-rename').onclick = () => renameProfileModal();
  renderGithubSync();
  app.querySelectorAll('[data-set]').forEach((el) =>
    el.addEventListener('change', () => store.saveSettings({ [el.dataset.set]: el.checked })),
  );
  const liStatus = app.querySelector('#li-status');
  const saveToken = () => {
    const token = app.querySelector('#li-token').value.trim();
    store.saveSettings({ lichessToken: token });
    lichess.resetExplorer();
    liStatus.textContent = token ? 'Токен сохранён на этом устройстве.' : 'Токен удалён.';
  };
  app.querySelector('#li-save').onclick = () => {
    saveToken();
    toast('✅ Сохранено');
  };
  app.querySelector('#li-check').onclick = async () => {
    saveToken();
    liStatus.textContent = 'Проверяю…';
    try {
      const data = await lichess.explorer(['e2e4']);
      const total = data.white + data.draws + data.black;
      liStatus.textContent = `✅ Работает: Lichess отдал статистику (${total.toLocaleString('ru-RU')} партий после 1.e4).`;
    } catch (e) {
      liStatus.textContent =
        e.kind === 'auth'
          ? '❌ Lichess не принял токен. Проверь, что он скопирован целиком.'
          : e.kind === 'network'
            ? '❌ Запрос не прошёл: похоже, Lichess не пускает такие запросы прямо из браузера. Статистика заработает на твоём сервере.'
            : `❌ ${e.message}`;
    }
  };
  app.querySelector('#export').onclick = () => {
    const blob = new Blob([store.exportProgress()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chess-progress-${store.today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  app.querySelector('#import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      store.importProgress(await f.text());
      toast('✅ Прогресс загружен');
      profileView();
    } catch (err) {
      toast(`❌ ${esc(err.message)}`);
    }
  };
  app.querySelector('#reset').onclick = () => {
    const { el, close } = modal(`
      <div class="result">
        <div class="result-icon">⚠️</div>
        <h2>Сбросить весь прогресс?</h2>
        <p>Опыт, серия дней, достижения и расписание повторений будут удалены. Это нельзя отменить.</p>
        <div class="col">
          <button class="btn danger big" id="reset-yes">Да, сбросить</button>
          <button class="btn big" data-close>Отмена</button>
        </div>
      </div>`);
    el.querySelector('#reset-yes').onclick = () => {
      close();
      store.resetProgress();
      profileView();
      toast('Прогресс сброшен');
    };
  };
  renderSync();
  const vStatus = app.querySelector('#version-status');
  const showVersionStatus = async () => {
    vStatus.textContent = 'Проверяю, есть ли обновление…';
    const latest = await fetchLatestVersion();
    if (!vStatus.isConnected) return;
    if (!latest) vStatus.textContent = 'Не удалось проверить: нет связи с сайтом.';
    else if (latest.version === APP_VERSION) vStatus.textContent = '✅ У тебя последняя версия.';
    else vStatus.innerHTML = `На сайте уже версия ${esc(latest.version)}. <button type="button" class="btn tiny primary" id="version-update">Обновить</button>`;
    const up = app.querySelector('#version-update');
    if (up) up.onclick = updateApp;
  };
  app.querySelector('#version-check').onclick = showVersionStatus;
  showVersionStatus();
}

// Синхронизация через приватный гист GitHub — работает и на GitHub Pages, без своего сервера.
function renderGithubSync() {
  const el = document.getElementById('gh-body');
  if (!el) return;
  const st = store.syncState;
  if (!store.settings.githubToken) {
    el.innerHTML = `
      <p>Прогресс <b>всех профилей</b> хранится в твоём приватном гисте на GitHub (маленький закрытый файл) — телефон и ноутбук сами обмениваются им. Свой сервер не нужен.</p>
      <ol class="small">
        <li><a href="${store.GITHUB_TOKEN_URL}" target="_blank" rel="noopener">Создай токен GitHub</a> — галочка <b>gist</b> уже стоит, больше ничего не нужно. В «Expiration» выбери «No expiration», нажми «Generate token».</li>
        <li>Скопируй токен (начинается с <code>ghp_</code>) и вставь сюда:</li>
      </ol>
      <div class="row">
        <input class="input" id="gh-token" type="password" placeholder="ghp_…" autocomplete="off">
        <button type="button" class="btn primary" id="gh-connect">Подключить</button>
      </div>
      <p class="muted small">3. Потом здесь же появится ссылка и QR-код — открой их на телефоне, и он подключится сам.</p>`;
    el.querySelector('#gh-connect').onclick = async () => {
      const token = el.querySelector('#gh-token').value.trim();
      if (!token) return toast('Вставь токен GitHub');
      const ok = await store.connectGithub(token);
      if (!ok) {
        toast(`❌ ${esc(store.syncState.message)}`, '', 6000);
        store.disconnectGithub();
      } else toast('✅ GitHub подключён — прогресс сохранён в приватном гисте');
      renderGithubSync();
    };
    return;
  }
  el.innerHTML = `
    <p>✅ Подключено через GitHub. <span class="muted small" id="gh-status">${esc(st.message || '')}</span></p>
    <div class="row">
      <button type="button" class="btn" id="gh-now">🔄 Синхронизировать сейчас</button>
      <button type="button" class="btn primary" id="gh-pair">📱 Подключить телефон</button>
    </div>
    <p class="muted small">Обмен идёт сам: при открытии приложения и через пару секунд после каждого занятия. <button type="button" class="link-btn" id="gh-off">Отключить на этом устройстве</button></p>`;
  el.querySelector('#gh-now').onclick = async () => {
    await store.pull();
    toast(store.syncState.status === 'error' ? `❌ ${esc(store.syncState.message)}` : '✅ Синхронизировано');
    profileView();
  };
  el.querySelector('#gh-pair').onclick = pairModal;
  el.querySelector('#gh-off').onclick = () => {
    store.disconnectGithub();
    renderGithubSync();
  };
}

// Ссылка для другого устройства: токен и чей это телефон. Часть после # не уходит на сервер сайта.
function pairLink(profileId) {
  return `${location.origin}${location.pathname}#/link/${encodeURIComponent(store.settings.githubToken)}/${profileId}`;
}

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function pairModal() {
  modal(`
    <h2>📱 Подключить телефон</h2>
    <p>Наведи камеру телефона на QR-код того, кто будет заниматься на этом телефоне, или отправь себе ссылку (например, в Telegram) и открой её на телефоне.</p>
    <div class="pair-list">
      ${store.profiles.list
        .map(
          (x) => `<div class="pair-item">
            <b>${x.emoji} Телефон для: ${esc(x.name)}</b>
            <div class="qr">${qrSvg(pairLink(x.id))}</div>
            <button type="button" class="btn tiny" data-copy="${x.id}">📋 Скопировать ссылку</button>
          </div>`,
        )
        .join('')}
    </div>
    <p class="muted small">⚠️ Не пересылай ссылку другим людям: в ней ключ доступа к твоим гистам на GitHub. Если ссылка попала не туда — удали токен на GitHub (Settings → Developer settings → Tokens) и создай новый.</p>
    <button type="button" class="btn" data-close>Готово</button>`);
  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(pairLink(b.dataset.copy));
        toast('📋 Ссылка скопирована — открой её на телефоне');
      } catch {
        window.prompt('Скопируй ссылку:', pairLink(b.dataset.copy));
      }
    };
  });
}

// Открыли ссылку с другого устройства: подключаем GitHub и выбираем профиль.
async function linkDevice(token, profileId) {
  history.replaceState(null, '', '#/profile');
  renderTopbar({ title: 'Подключение' });
  renderTabbar(null);
  app.innerHTML = '<section class="card"><h2>☁️ Подключаю синхронизацию…</h2><p class="muted">Загружаю прогресс с GitHub.</p></section>';
  const ok = await store.connectGithub(decodeURIComponent(token || ''));
  if (profileId) store.switchProfile(profileId);
  if (ok) toast(`✅ Устройство подключено. Занимается: <b>${esc(store.activeProfile().name)}</b>`, '', 5000);
  else {
    toast(`❌ ${esc(store.syncState.message)}`, '', 6000);
    store.disconnectGithub();
  }
  route();
}

function renameProfileModal() {
  const me = store.activeProfile();
  let emoji = me.emoji;
  const { close } = modal(`
    <h2>✏️ Имя и значок</h2>
    <div class="row"><input class="input" id="rn-name" maxlength="24" value="${esc(me.name)}" autocomplete="off"></div>
    <div class="emoji-pick">${store.AVATARS.map((e) => `<button type="button" class="emoji-btn ${e === emoji ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>
    <div class="row">
      <button type="button" class="btn primary" id="rn-save">Сохранить</button>
      <button type="button" class="btn" data-close>Отмена</button>
    </div>`);
  document.querySelectorAll('[data-emoji]').forEach((b) => {
    b.onclick = () => {
      emoji = b.dataset.emoji;
      document.querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  document.querySelector('#rn-save').onclick = () => {
    store.renameProfile(me.id, document.querySelector('#rn-name').value, emoji);
    close();
    profileView();
  };
}

async function renderSync() {
  const el = document.getElementById('sync-body');
  if (!el) return;
  const ok = await store.checkServer();
  if (!el.isConnected) return;
  if (!ok) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <h3>Или через свой сервер</h3>
    <p class="muted">Придумай секретную фразу и введи её одинаково на iPhone и на ноутбуке — прогресс текущего профиля будет общим.</p>
    <div class="row">
      <input class="input" id="sync-key" type="password" placeholder="Секретная фраза (от 8 символов)" value="${esc(store.settings.syncKey)}" autocomplete="off">
      <button class="btn primary" id="sync-save">Синхронизировать</button>
    </div>
    <p class="muted small" id="sync-status">${esc(store.syncState.message)}</p>`;
  el.querySelector('#sync-save').onclick = async () => {
    const key = el.querySelector('#sync-key').value.trim();
    if (key && key.length < 8) return toast('Фраза должна быть не короче 8 символов');
    store.saveSettings({ syncKey: key });
    await store.pull();
    toast(store.syncState.status === 'error' ? `❌ ${esc(store.syncState.message)}` : '✅ Синхронизировано');
    profileView();
  };
}

// ─────────────────────────── теория ───────────────────────────

function accordion(items, openFirst = false) {
  return `<div class="acc">${items
    .map(
      ([icon, title, body], i) =>
        `<details ${openFirst && i === 0 ? 'open' : ''}><summary><span class="acc-icon">${icon}</span>${esc(title)}</summary><div class="acc-body">${body}</div></details>`,
    )
    .join('')}</div>`;
}

// Мини-доска со стрелками к разделу теории (рисуется после вставки HTML — mountDiagrams).
function diagramHtml(o, kind) {
  const spec = DIAGRAMS[o.id]?.[kind];
  if (!spec) return '';
  return `<figure class="diagram">
    <div class="diagram-board" data-diagram="${o.id}|${kind}"></div>
    <figcaption>${rich(spec.caption)}</figcaption>
  </figure>`;
}

function mountDiagrams(root) {
  root.querySelectorAll('[data-diagram]:not([data-mounted])').forEach((el) => {
    const details = el.closest('details');
    if (details && !details.open) {
      if (!details.dataset.watch) {
        details.dataset.watch = '1';
        details.addEventListener('toggle', () => {
          if (!details.open) return;
          mountDiagrams(details);
          // уже созданные схемы могли быть скрыты — пересчитываем их размеры
          details.querySelectorAll('[data-diagram][data-mounted]').forEach((x) => boardRedraw.get(x)?.());
        });
      }
      return;
    }
    const [id, kind] = el.dataset.diagram.split('|');
    const o = OPENINGS.find((x) => x.id === id);
    const spec = DIAGRAMS[id][kind];
    const line = o.lines[spec.line || 0];
    const { fens, moves } = buildLine(line.steps.slice(0, spec.ply));
    const last = moves[moves.length - 1];
    miniBoard(el, fens[fens.length - 1], colorName(lineSide(o, line)), last ? [last.from, last.to] : undefined, parseArrows(spec.a), true);
    el.dataset.mounted = '1';
  });
}

function openingTheoryHtml(o, openFirst = true) {
  const th = OPENING_THEORY[o.id];
  if (!th) return '';
  const list = (arr) => `<ul>${arr.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>`;
  const trap = o.category === 'trap';
  return accordion(
    [
      ['🏷️', `Что значит «${o.name}»`, `<p>${rich(th.name)}</p>`],
      ['💡', 'В чём суть', `<p>${rich(th.essence)}</p>${diagramHtml(o, 'essence')}`],
      ['🎯', trap ? 'Что нужно запомнить' : `Твои планы (играешь ${sideName(o.side)})`, list(th.plans) + diagramHtml(o, 'plans')],
      ['⚠️', 'Чего ждать от соперника', list(th.opponent)],
      ['❌', 'Частые ошибки', list(th.mistakes)],
      ['⭐', 'Интересный факт', `<p>${rich(th.famous)}</p>`],
    ],
    openFirst,
  );
}

function showTheory(opening) {
  const { el } = modal(`
    <div class="theory-modal">
      <h2>📚 ${esc(opening.name)}</h2>
      ${opening.aka ? `<p class="muted">${esc(opening.aka)} · ECO ${esc(opening.eco)}</p>` : `<p class="muted">ECO ${esc(opening.eco)}</p>`}
      ${openingTheoryHtml(opening)}
      <button class="btn primary big" data-close>Понятно, к доске</button>
    </div>`);
  mountDiagrams(el);
}

function showTerm(id) {
  const g = GLOSSARY_BY_ID[id];
  if (!g) return;
  modal(`
    <div class="term-modal">
      <h2>${esc(g.term)}</h2>
      <p>${esc(g.def)}</p>
      <div class="row">
        <a class="btn" href="#/theory" data-close>📚 Весь словарь</a>
        <button class="btn primary" data-close>Понятно</button>
      </div>
    </div>`);
}

function theoryView() {
  renderTopbar({ title: 'Теория' });
  renderTabbar('theory');
  app.innerHTML = `
    <section class="card theory-hero">
      <h1>📚 Теория</h1>
      <p>Основы шахмат и словарь терминов. Нажми на заголовок, чтобы раскрыть. В объяснениях ходов подчёркнутые слова тоже можно нажимать — появится пояснение.</p>
    </section>
    <h2 class="section">Основы</h2>
    ${accordion(BASICS.map((b) => [b.icon, b.title, b.html]))}
    <h2 class="section">Словарь терминов</h2>
    <input class="input" id="g-search" type="search" placeholder="🔎 Найти термин…" autocomplete="off">
    <div id="glossary">${glossaryHtml('')}</div>
    <h2 class="section">Теория по дебютам</h2>
    <div class="theory-list">
      ${Object.entries(CATEGORIES)
        .map(
          ([cat, label]) => `<h3>${label}</h3>${OPENINGS.filter((o) => o.category === cat)
            .map((o) => `<a class="rev-item" href="#/o/${o.id}"><div><b>${esc(o.name)}</b><br><span class="muted">${esc(o.tagline)}</span></div><span class="muted">›</span></a>`)
            .join('')}`,
        )
        .join('')}
    </div>
    <p class="version-note muted">${versionText()}</p>`;
  const search = app.querySelector('#g-search');
  search.addEventListener('input', () => {
    app.querySelector('#glossary').innerHTML = glossaryHtml(search.value.trim().toLowerCase());
  });
}

function glossaryHtml(q) {
  const items = [...GLOSSARY]
    .sort((a, b) => a.term.localeCompare(b.term, 'ru'))
    .filter((g) => !q || g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q));
  if (!items.length) return '<p class="muted">Ничего не найдено.</p>';
  return accordion(items.map((g) => ['•', g.term, `<p>${esc(g.def)}</p>`]), !!q && items.length === 1);
}

// ─────────────────────────── версия и обновления ───────────────────────────

function versionText() {
  const d = new Date(APP_DATE + 'T12:00:00');
  return `Версия ${APP_VERSION} от ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

async function fetchLatestVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Обновить приложение: сбросить офлайн-кэш и перезагрузить страницу с сервера.
async function updateApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
  } catch {}
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch {}
  try {
    sessionStorage.setItem('app-updated', '1');
  } catch {}
  location.reload();
}

// При запуске: если на сайте версия новее — показываем плашку «Обновить».
async function checkForUpdate() {
  const latest = await fetchLatestVersion();
  if (!latest || latest.version === APP_VERSION || document.querySelector('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.innerHTML = `<span>✨ Доступна новая версия ${esc(latest.version)} (у тебя ${APP_VERSION})</span><button type="button" class="btn tiny primary">Обновить</button>`;
  bar.querySelector('button').onclick = updateApp;
  document.body.appendChild(bar);
}

function notFound() {
  renderTopbar({ back: '#/' });
  renderTabbar('home');
  app.innerHTML = `<section class="card"><h1>Не найдено</h1><a class="btn" href="#/">На главную</a></section>`;
}

// ─────────────────────────── роутер ───────────────────────────

function route() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
  activeBoard = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [view, id, extra] = parts;
  document.body.dataset.view = view || 'home';
  window.scrollTo(0, 0);
  switch (view) {
    case undefined:
      return homeView();
    case 'o':
      return openingView(id);
    case 'learn':
      return learnView(id);
    case 'drill':
      return drillView(id, extra === 'review');
    case 'review':
      return reviewView();
    case 'quiz':
      return quizView();
    case 'free':
      return freeView();
    case 'link':
      return linkDevice(id, extra);
    case 'theory':
      return theoryView();
    case 'profile':
      return profileView();
    default:
      return notFound();
  }
}

window.addEventListener('hashchange', route);
// На компьютере клетка подсвечивается уже при наведении мыши.
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const sq = e.target.closest && e.target.closest('.sq');
  if (sq) flashSquareLink(sq, false);
});

// Какой доске показывать клетку: ищем ближайшую видимую мини-доску, поднимаясь от ссылки
// вверх (подпись под доской → карточка → раздел), но не выходя за пределы карточки, панели
// или окна. Не нашли — главная доска экрана; внутри окна (теория поверх доски) — никакая.
const BOARD_SCOPE_END = '.wn-item, .wrong-msg, .ex-detail, .alt-card, .panel, .modal, #app';
const isVisible = (el) => el.getClientRects().length > 0;
function targetBoardFor(link) {
  for (let node = link.parentElement; node; node = node.parentElement) {
    const el = [...node.querySelectorAll('.cg-wrap')].find((x) => boardAdapters.has(x) && isVisible(x));
    if (el) return boardAdapters.get(el);
    if (node.matches(BOARD_SCOPE_END)) break;
  }
  return link.closest('.modal') ? null : activeBoard;
}

// Верхняя граница видимой части страницы: низ шапки, а на телефоне — низ закреплённой доски.
function visibleTop() {
  const stage = document.querySelector('.play .board-stage, .play.quiz .board-col');
  if (stage && getComputedStyle(stage).position === 'sticky') return stage.getBoundingClientRect().bottom;
  return topbar.getBoundingClientRect().bottom;
}

function flashSquareLink(link, scrollToBoard) {
  const target = targetBoardFor(link);
  if (!target) return;
  if (link.dataset.path) target.flashPath(link.dataset.path.split(','));
  else target.flash([link.dataset.sq]);
  // Если доска ушла за край экрана или спряталась под закреплённой главной доской —
  // прокручиваем к ней, чтобы было видно подсветку.
  if (scrollToBoard && target.el) {
    const r = target.el.getBoundingClientRect();
    if (r.bottom < visibleTop() + 40 || r.top > innerHeight - 60) target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
// Повторное нажатие на ссылку текущей страницы (например, вкладку «Викторина» после результата)
// не меняет адрес, поэтому перерисовываем вручную.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-material]')) {
    showMaterial();
    return;
  }
  const sq = e.target.closest('.sq');
  if (sq && !sq.closest('button')) flashSquareLink(sq, true);
  const term = e.target.closest('.term');
  if (term) {
    e.preventDefault();
    return showTerm(term.dataset.term);
  }
  if (e.target.closest('#theory-btn')) {
    const [, view, id] = location.hash.split('/');
    const found = (view === 'learn' || view === 'drill') && findLine(id);
    if (found) showTheory(found.opening);
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === (location.hash || '#/')) {
    e.preventDefault();
    route();
  }
});
store.onChange(() => {
  // Обновляем только шапку и счётчики, не перерисовывая доску.
  const view = document.body.dataset.view;
  const title = topbar.querySelector('.title')?.textContent || '';
  const back = topbar.querySelector('.icon-btn')?.getAttribute('href');
  renderTopbar({ title, back });
  if (!tabbar.hidden) renderTabbar(view === 'home' ? 'home' : view);
});

// Синхронизация с другим устройством; если пришёл новый прогресс — обновляем экраны со сводкой.
function syncAndRefresh() {
  const before = JSON.stringify(store.progress) + store.profiles.active;
  store.pull().then(() => {
    const changed = JSON.stringify(store.progress) + store.profiles.active !== before;
    if (changed && ['home', 'review', 'profile'].includes(document.body.dataset.view) && !document.querySelector('.modal-wrap')) route();
  });
}

route();
syncAndRefresh();
checkForUpdate();
let lastPull = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkForUpdate();
  if (Date.now() - lastPull > 30000) {
    lastPull = Date.now();
    syncAndRefresh();
  }
});

// Офлайн-режим. В некоторых встроенных окнах service worker запрещён — тогда просто работаем без него.
// Когда на сайте появилась новая версия, новый service worker берёт управление —
// перезагружаем страницу, чтобы сразу показать свежую версию.
try {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      try {
        sessionStorage.setItem('app-updated', '1');
      } catch {}
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
} catch {
  /* нет доступа к service worker */
}
try {
  if (sessionStorage.getItem('app-updated')) {
    sessionStorage.removeItem('app-updated');
    setTimeout(() => toast('✨ Приложение обновлено'), 500);
  }
} catch {}
