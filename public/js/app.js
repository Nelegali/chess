import { OPENINGS, CATEGORIES, SIGNATURE, findLine, lineSide, allLines } from './openings.js';
import * as store from './store.js';
import { Board, Chess, parseArrows, threatArrows, sanToMove, moveLabel, figurine, PIECE_NAME } from './board.js';
import { Chessground } from '../vendor/chessground.js';
import { play as sound } from './sound.js';
import * as lichess from './lichess.js';
import { BASICS, GLOSSARY, GLOSSARY_BY_ID, OPENING_THEORY, linkTerms } from './theory.js';

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const tabbar = document.getElementById('tabbar');

let cleanup = [];
const onCleanup = (fn) => cleanup.push(fn);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const clean = (san) => san.replace(/[!?]+$/, '');
// Экранированный текст, где термины из словаря — нажимаемые кнопки.
const rich = (s) => linkTerms(esc(s));
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

function miniBoard(el, fen, orientation, lastMove) {
  const cg = Chessground(el, {
    fen,
    orientation,
    viewOnly: true,
    coordinates: false,
    lastMove,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true },
  });
  onCleanup(() => cg.destroy());
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
    ? `<a class="icon-btn" href="${opts.back}" aria-label="Назад">‹</a>`
    : `<a class="brand" href="#/"><span class="logo">♞</span>${opts.title ? '' : '<span>Дебюты</span>'}</a>`;
  topbar.innerHTML = `
    ${back}
    <div class="title">${esc(opts.title || '')}</div>
    <a class="hud" href="#/profile" aria-label="Профиль">
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

function toast(html, cls = '') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.innerHTML = html;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 3200);
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
}

// ─────────────────────────── изучение ───────────────────────────

function playLayout(opening, line, mode) {
  return `
    <div class="play">
      <div class="board-col">
        <div class="board" id="board"></div>
        <div class="legend">
          <span><i class="lg g"></i>идея</span>
          <span><i class="lg r"></i>угроза</span>
          <span><i class="lg b"></i>план / защита</span>
          <span><i class="lg y"></i>важное поле</span>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="mode-tag ${mode}">${mode === 'learn' ? '📖 Изучение' : '🎯 Тренировка'}</div>
          <h2>${esc(opening.name)}</h2>
          <div class="sub-row">
            <p class="muted">${esc(line.name)}</p>
            <button type="button" class="btn tiny" id="theory-btn">📚 Теория</button>
          </div>
          <div class="dots" id="dots"></div>
        </div>
        <div id="panel-body"></div>
      </div>
    </div>`;
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
  const board = new Board(app.querySelector('#board'), { orientation: colorName(side), onUserMove });
  onCleanup(() => board.destroy());

  let ply = 0;
  let alt = null; // { def, fens, moves, ply, base }
  let explorerOpen = false;
  let wrongMsg = '';

  function currentFen() {
    return alt ? alt.fens[alt.ply] : fens[ply];
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
    const step = ply > 0 ? line.steps[ply - 1] : null;
    const last = ply > 0 ? moves[ply - 1] : null;
    board.load(fens[ply], last ? [last.from, last.to] : undefined);
    const next = ply < N ? moves[ply] : null;
    const myTurn = next && turnAt(fens[ply]) === side;
    board.shapes(shapesFor(step, fens[ply], myTurn ? next : null));
    if (myTurn) board.enable(side);
    renderDots(dots, N, ply, side, fens);

    const mover = ply > 0 ? turnAt(fens[ply - 1]) : null;
    const head = step
      ? `<div class="move-head"><span class="san">${moveLabel(ply - 1, step.m)}</span><span class="who ${mover === side ? 'me' : 'opp'}">${mover === side ? 'твой ход' : 'ход соперника'}</span></div>`
      : `<div class="move-head"><span class="san">Начало</span><span class="who me">ты играешь ${sideName(side)}</span></div>`;
    const text = step
      ? `<p class="explain">${rich(step.t)}</p>`
      : `<p class="explain">${rich(opening.about)}</p><p class="explain muted">Ходи на доске сам — зелёная стрелка подскажет. Ходы соперника появятся по кнопке. После каждого хода читай объяснение и смотри на стрелки.</p>`;

    let prompt = '';
    let mainBtn = '';
    if (!next) {
      prompt = `<div class="prompt done">🏁 Вариант пройден до конца! Нажми «Завершить», чтобы получить XP.</div>`;
      mainBtn = '<button class="btn primary" id="finish">🏁 Завершить</button>';
    } else if (myTurn) {
      prompt = `<div class="prompt mine">Твой ход: <b>${figurine(clean(line.steps[ply].m))}</b> ${store.settings.hints ? '— сыграй его на доске по зелёной стрелке' : '— сыграй его на доске'}</div>
        ${wrongMsg ? `<div class="wrong-msg">${wrongMsg}</div>` : ''}`;
      mainBtn = '<button class="btn" id="auto">💡 Сделать ход за меня</button>';
    } else {
      mainBtn = '<button class="btn primary" id="opp">Ход соперника ▶</button>';
    }

    const alts = step && step.alt
      ? `<div class="alts"><div class="alts-title">🤔 А что если…</div>${step.alt
          .map((a, i) => `<button class="btn alt" data-alt="${i}">${esc(a.label)}</button>`)
          .join('')}</div>`
      : '';

    body.innerHTML = `
      <div class="move-card">${head}${text}</div>
      ${prompt}
      ${alts}
      ${explorerBlock()}
      <div class="actionbar">
        <button class="btn nav" id="prev" ${ply === 0 ? 'disabled' : ''} aria-label="Назад">◀</button>
        ${mainBtn}
        <button class="btn nav" id="next" ${!next ? 'disabled' : ''} aria-label="Вперёд">▶</button>
      </div>
    `;
    bindCommon();
    body.querySelectorAll('[data-alt]').forEach((b) =>
      b.addEventListener('click', () => startAlt(step.alt[+b.dataset.alt])),
    );
    const fin = body.querySelector('#finish');
    if (fin) fin.onclick = finish;
    const opp = body.querySelector('#opp');
    if (opp) opp.onclick = forward;
    const auto = body.querySelector('#auto');
    if (auto) auto.onclick = forward;
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
      const data = await lichess.explorer(uciHistory());
      if (!el.isConnected) return;
      const total = data.white + data.draws + data.black;
      if (!total) {
        el.innerHTML = '<p class="muted">В базе Lichess таких партий почти нет — позиция редкая.</p>';
        return;
      }
      el.innerHTML = `
        <p class="muted">Партии игроков 1400–2000 на Lichess: ${total.toLocaleString('ru-RU')}${data.opening ? ` · ${esc(data.opening.name)}` : ''}</p>
        <table class="ex-table">
          ${data.moves
            .map((m) => {
              const n = m.white + m.draws + m.black;
              const pct = Math.round((n / total) * 100);
              const isTheory = theory && m.uci === theory.from + theory.to;
              return `<tr class="${isTheory ? 'theory' : ''}">
                <td class="ex-san">${figurine(m.san)}${isTheory ? ' ★' : ''}</td>
                <td class="ex-pct">${pct}%</td>
                <td class="ex-bar"><span class="wdb">
                  <i class="w" style="width:${(m.white / n) * 100}%"></i><i class="d" style="width:${(m.draws / n) * 100}%"></i><i class="b" style="width:${(m.black / n) * 100}%"></i>
                </span></td>
              </tr>`;
            })
            .join('')}
        </table>
        <p class="muted small">★ — ход по нашей теории. Полоска: победы белых / ничьи / победы чёрных.</p>`;
    } catch (e) {
      if (el.isConnected) renderExplorerHelp(el, e, currentFen(), side, loadExplorer);
    }
  }

  function forward() {
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
    wrongMsg = '';
    if (alt) {
      if (alt.ply > 0) alt.ply--;
      else alt = null;
      return render();
    }
    if (ply > 0) ply--;
    render();
  }

  function onUserMove(m) {
    if (alt || ply >= N) return;
    const expected = moves[ply];
    if (m.from === expected.from && m.to === expected.to) {
      wrongMsg = '';
      ply++;
      sound('correct');
      render();
    } else {
      sound('wrong');
      board.shake();
      const tried = sanToMove(fens[ply], m) || { san: m.from + '-' + m.to };
      wrongMsg = `${figurine(tried.san)} — тоже ход, но в этом дебюте здесь играют <b>${figurine(expected.san)}</b>. Смотри на зелёную стрелку.`;
      render();
    }
  }

  function startAlt(def) {
    const base = ply - 1; // вариант заменяет текущий показанный ход
    const built = buildLine(def.steps, fens[base]);
    alt = { def, base, ply: 0, ...built };
    render();
  }

  function renderAlt() {
    const { def } = alt;
    const step = alt.ply > 0 ? def.steps[alt.ply - 1] : null;
    const last = alt.ply > 0 ? alt.moves[alt.ply - 1] : moves[alt.base - 1];
    board.load(alt.fens[alt.ply], last ? [last.from, last.to] : undefined);
    board.shapes(shapesFor(step, alt.fens[alt.ply], null));
    const done = alt.ply >= def.steps.length;
    body.innerHTML = `
      <div class="move-card alt-card">
        <div class="alt-label">🤔 ${esc(def.label)}</div>
        ${
          step
            ? `<div class="move-head"><span class="san">${moveLabel(alt.base + alt.ply - 1, step.m)}</span></div><p class="explain">${rich(step.t)}</p>`
            : `<p class="explain">${rich(def.intro || 'Посмотрим, что будет.')}</p>`
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
    if (e.key === 'ArrowRight') forward();
    if (e.key === 'ArrowLeft') back();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  render();
}

// Что показать, если статистика Lichess не загрузилась.
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
  const board = new Board(app.querySelector('#board'), { orientation: colorName(side), onUserMove });
  onCleanup(() => board.destroy());

  let ply = 0;
  let mistakes = 0;
  let hints = 0;
  let stepErrors = 0;
  let lastNote = '';
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
      ${hint ? `<div class="wrong-msg">${hint}</div>` : ''}
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
      step0();
    } else {
      sound('wrong');
      board.shake();
      if (stepErrors < 2) mistakes++;
      stepErrors++;
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
    </div>`;
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
    </section>`;
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

  app.innerHTML = `
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
      <h2>Синхронизация iPhone ↔ ноутбук</h2>
      <div id="sync-body"><p class="muted">Проверяю сервер…</p></div>
    </div>
    <div class="card">
      <h2>Lichess</h2>
      <p class="muted">С 2026 года Lichess показывает статистику дебютов только вошедшим пользователям. Чтобы видеть её в приложении, <a href="${lichess.TOKEN_CREATE_URL}" target="_blank" rel="noopener">создай токен на Lichess</a> (без галочек) и вставь сюда. На своём сервере вместо этого можно задать LICHESS_TOKEN.</p>
      <input class="input" id="li-token" type="password" placeholder="lip_…" value="${esc(s.lichessToken)}" autocomplete="off">
    </div>
    <div class="card">
      <h2>Резервная копия</h2>
      <div class="row">
        <button class="btn" id="export">⬇ Скачать прогресс</button>
        <label class="btn">⬆ Загрузить<input type="file" id="import" accept=".json,application/json" hidden></label>
        <button class="btn danger" id="reset">Сбросить всё</button>
      </div>
    </div>
    <p class="muted small center">Доска и фигуры — chessground (Lichess) · правила — chess.js</p>`;

  app.querySelectorAll('[data-set]').forEach((el) =>
    el.addEventListener('change', () => store.saveSettings({ [el.dataset.set]: el.checked })),
  );
  app.querySelector('#li-token').addEventListener('change', (e) => {
    store.saveSettings({ lichessToken: e.target.value.trim() });
    lichess.resetExplorer();
  });
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
}

async function renderSync() {
  const el = document.getElementById('sync-body');
  if (!el) return;
  const ok = await store.checkServer();
  if (!el.isConnected) return;
  if (!ok) {
    el.innerHTML = `<p class="muted">Синхронизация работает, когда приложение запущено на твоём сервере (server.js). Сейчас прогресс хранится только на этом устройстве — можно перенести его через «Резервную копию».</p>`;
    return;
  }
  el.innerHTML = `
    <p class="muted">Придумай секретную фразу и введи её одинаково на iPhone и на ноутбуке — прогресс будет общим.</p>
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

function openingTheoryHtml(o, openFirst = true) {
  const th = OPENING_THEORY[o.id];
  if (!th) return '';
  const list = (arr) => `<ul>${arr.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>`;
  const trap = o.category === 'trap';
  return accordion(
    [
      ['🏷️', `Что значит «${o.name}»`, `<p>${rich(th.name)}</p>`],
      ['💡', 'В чём суть', `<p>${rich(th.essence)}</p>`],
      ['🎯', trap ? 'Что нужно запомнить' : `Твои планы (играешь ${sideName(o.side)})`, list(th.plans)],
      ['⚠️', 'Чего ждать от соперника', list(th.opponent)],
      ['❌', 'Частые ошибки', list(th.mistakes)],
      ['⭐', 'Интересный факт', `<p>${rich(th.famous)}</p>`],
    ],
    openFirst,
  );
}

function showTheory(opening) {
  modal(`
    <div class="theory-modal">
      <h2>📚 ${esc(opening.name)}</h2>
      ${opening.aka ? `<p class="muted">${esc(opening.aka)} · ECO ${esc(opening.eco)}</p>` : `<p class="muted">ECO ${esc(opening.eco)}</p>`}
      ${openingTheoryHtml(opening)}
      <button class="btn primary big" data-close>Понятно, к доске</button>
    </div>`);
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
    </div>`;
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
    case 'theory':
      return theoryView();
    case 'profile':
      return profileView();
    default:
      return notFound();
  }
}

window.addEventListener('hashchange', route);
// Повторное нажатие на ссылку текущей страницы (например, вкладку «Викторина» после результата)
// не меняет адрес, поэтому перерисовываем вручную.
document.addEventListener('click', (e) => {
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

route();
store.pull();

// Офлайн-режим. В некоторых встроенных окнах service worker запрещён — тогда просто работаем без него.
try {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
} catch {
  /* нет доступа к service worker */
}
