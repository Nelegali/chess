// Обёртка над chessground (доска Lichess) + chess.js (правила).
import { Chessground } from '../vendor/chessground.js';
import { Chess, SQUARES } from '../vendor/chess.js';

const BRUSH = { g: 'green', r: 'red', b: 'blue', y: 'yellow' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const PIECE_NAME = {
  p: 'пешка',
  n: 'конь',
  b: 'слон',
  r: 'ладья',
  q: 'ферзь',
  k: 'король',
};

// 'gc4f7 yf7' → фигуры для chessground
export function parseArrows(str) {
  if (!str) return [];
  return str
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const brush = BRUSH[tok[0]] || 'green';
      const orig = tok.slice(1, 3);
      const dest = tok.length === 5 ? tok.slice(3, 5) : undefined;
      return dest ? { orig, dest, brush } : { orig, brush };
    });
}

// Угрозы соперника: его фигуры, которые бьют наши незащищённые фигуры
// или фигуры дороже атакующей.
export function threatArrows(chess, myColor) {
  const enemy = myColor === 'w' ? 'b' : 'w';
  const out = [];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color !== myColor) continue;
    const attackers = chess.attackers(sq, enemy);
    if (!attackers.length) continue;
    const defended = chess.attackers(sq, myColor).length > 0;
    for (const from of attackers) {
      const a = chess.get(from);
      if (p.type === 'k' || !defended || VALUE[a.type] < VALUE[p.type]) {
        out.push({ orig: from, dest: sq, brush: 'paleRed' });
      }
    }
  }
  return out.slice(0, 6);
}

// Ходы стороны color, даже если сейчас её очередь не наступила.
export function movesFor(chess, color) {
  if (chess.turn() === color) return chess.moves({ verbose: true });
  const parts = chess.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  try {
    return new Chess(parts.join(' ')).moves({ verbose: true });
  } catch {
    return [];
  }
}

// Подсветка клеток и путей из текста — общая для главной доски и мини-досок.
// Значок оценки хода в углу клетки — как «??» и «!» в анализе Lichess.
const GLYPHS = {
  blunder: ['#d64545', '??'],
  mistake: ['#e07b2a', '?'],
  dubious: ['#c99a06', '?!'],
  good: ['#4c9a2a', '!'],
  book: ['#2f7fd1', '★'],
};
export function glyphShape(square, verdict) {
  const g = GLYPHS[verdict];
  if (!g) return null;
  const [color, text] = g;
  const size = text.length > 1 ? 26 : 32;
  return {
    orig: square,
    customSvg: {
      html: `<circle cx="78" cy="22" r="20" fill="${color}" stroke="#fff" stroke-width="4"/><text x="78" y="${Math.round(22 + size * 0.36)}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="${size}" fill="#fff">${text}</text>`,
    },
  };
}

export const FLASH_MS = 1800;
export const PATH_MS = 2200;
export const circleShapes = (squares) => squares.map((sq) => ({ orig: sq, brush: 'blue' }));
export const pathArrows = (path) => path.slice(1).map((sq, i) => ({ orig: path[i], dest: sq, brush: 'blue' }));

// Доска на странице и имеет ненулевой размер (не в свёрнутом разделе, не на скрытом экране).
export function hasSize(node) {
  if (!node.isConnected) return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

const resizeWatchers = new WeakMap();

// Защита перерисовки: chessground откладывает перерисовку на следующий кадр и не проверяет,
// что доска к тому моменту ещё на странице и видима. Кроме того, он запоминает размер доски:
// если доску прятали, запомненный размер — 0×0, и при повторном показе стрелки получали
// координаты NaN (в консоли — «attribute y2: Expected length, NaN»). Поэтому перед каждой
// перерисовкой проверяем настоящий размер доски и сбрасываем устаревший запомненный.
// Пропущенная пока доска скрыта перерисовка выполняется, когда доска снова получает размер.
// Вызывать после создания доски и после каждого redrawAll (он пересоздаёт state.dom).
export function guardRedraw(cg, el) {
  const dom = cg.state.dom;
  const original = dom.redrawNow;
  const ok = () => {
    if (dom.destroyed || !el.isConnected) return false;
    const r = dom.elements.board.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const b = dom.bounds();
    if (b.width !== r.width || b.height !== r.height || b.left !== r.left || b.top !== r.top) dom.bounds.clear();
    return true;
  };
  let pending = false;
  dom.redrawNow = (skipSvg) => ok() && original(skipSvg);
  dom.redraw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (ok()) original();
    });
  };
  if (!resizeWatchers.has(el) && 'ResizeObserver' in window) {
    // cg.state.dom берём в момент вызова: после redrawAll это уже новая, тоже защищённая версия.
    const watcher = new ResizeObserver(() => hasSize(el) && !cg.state.dom.destroyed && cg.state.dom.redraw());
    watcher.observe(el);
    resizeWatchers.set(el, watcher);
  }
}

// Уничтожить доску chessground без «хвостов»: её отложенная перерисовка (в следующем кадре)
// не проверяет, что доска уже убрана, и рисовала бы стрелки на отсоединённом элементе
// нулевого размера (в консоли — «attribute x1: Expected length, NaN»). Очищаем стрелки заранее.
export function destroyBoard(cg) {
  const wrap = cg.state.dom.elements.wrap;
  resizeWatchers.get(wrap)?.disconnect();
  resizeWatchers.delete(wrap);
  cg.state.drawable.autoShapes = [];
  cg.state.drawable.shapes = [];
  cg.state.drawable.current = undefined;
  cg.destroy();
}

export function toDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

// Ход в позиции fen: принимает SAN («Nf3») или объект { from, to, promotion }.
export function sanToMove(fen, move) {
  const c = new Chess(fen);
  try {
    return c.move(typeof move === 'string' ? move.replace(/[!?]+$/, '') : move);
  } catch {
    return null;
  }
}

const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
export function figurine(san) {
  return san.replace(/^[KQRBN]/, (ch) => FIG[ch]).replace(/=([QRBN])/, (_, ch) => '=' + FIG[ch]);
}

export function moveLabel(ply, san) {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}. ${figurine(san)}` : `${n}… ${figurine(san)}`;
}

export class Board {
  constructor(el, { orientation = 'white', onUserMove, myColor = orientation === 'white' ? 'w' : 'b' } = {}) {
    this.el = el;
    this.onUserMove = onUserMove;
    this.myColor = myColor;
    this.insightOn = false; // показывать все ходы соперника и фигуры под ударом
    this.focus = null; // фигура соперника, которую нажали, — показываем её ходы
    this.hint = null; // клетка фигуры, которой ученику нужно ходить (мигает)
    this.chess = new Chess();
    this.cg = Chessground(el, {
      fen: this.chess.fen(),
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 260 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      movable: {
        free: false,
        color: undefined,
        showDests: true,
        events: { after: (orig, dest) => this.handleMove(orig, dest) },
      },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        // кисти для режима «куда может пойти соперник»
        brushes: {
          oppMove: { key: 'om', color: '#4a4a4a', opacity: 0.5, lineWidth: 4 },
          oppMoveStrong: { key: 'oms', color: '#3a3a3a', opacity: 0.8, lineWidth: 7 },
          oppCapture: { key: 'oc', color: '#d0021b', opacity: 0.9, lineWidth: 8 },
          // свободная игра: популярные ходы (толщина стрелки — насколько часто играют)
          cand: { key: 'cd', color: '#8e44ad', opacity: 0.7, lineWidth: 10 },
          candMine: { key: 'cm', color: '#15781b', opacity: 0.6, lineWidth: 10 },
        },
      },
      events: { select: (key) => this.onSelect(key) },
    });
    guardRedraw(this.cg, el);
  }

  // Нажатие на фигуру соперника показывает, куда она может пойти и на что нападает.
  onSelect(key) {
    const p = this.chess.get(key);
    const enemy = this.myColor === 'w' ? 'b' : 'w';
    const focus = p && p.color === enemy && this.focus !== key ? key : null;
    if (focus === this.focus) return;
    this.focus = focus;
    this.renderInsight();
  }

  // Подсветка клеток цветом оценки хода: [[клетка, класс], …]. Сбрасывается при смене позиции.
  setMarks(marks) {
    this.marks = marks;
    this.renderInsight();
  }

  // Вспышка всей доски: зелёная — хороший ход, красная (и встряска) — ошибка.
  pulse(kind) {
    this.el.classList.remove('fx-good', 'fx-bad');
    void this.el.offsetWidth;
    this.el.classList.add(kind === 'bad' ? 'fx-bad' : 'fx-good');
    if (kind === 'bad') this.shake();
  }

  setHint(square) {
    if (this.hint === square) return;
    this.hint = square;
    this.renderInsight();
  }

  setInsight(on) {
    this.insightOn = on;
    this.renderInsight();
  }

  renderInsight() {
    const map = new Map();
    const add = (sq, cls) => map.set(sq, map.has(sq) ? `${map.get(sq)} ${cls}` : cls);
    const enemy = this.myColor === 'w' ? 'b' : 'w';
    const arrows = [];
    if (this.insightOn || this.focus) {
      const all = movesFor(this.chess, enemy);
      const shown = this.focus ? all.filter((m) => m.from === this.focus) : all;
      const seen = new Set();
      for (const m of shown) {
        if (seen.has(m.from + m.to)) continue; // превращения дают несколько одинаковых ходов
        seen.add(m.from + m.to);
        const brush = m.captured ? 'oppCapture' : this.focus ? 'oppMoveStrong' : 'oppMove';
        arrows.push({ orig: m.from, dest: m.to, brush });
      }
      // Пешка ходит прямо, а бьёт наискосок: клетки, которые она бьёт, отмечаем точкой.
      for (const sq of SQUARES) {
        const p = this.chess.get(sq);
        if (!p || p.color !== enemy || p.type !== 'p' || (this.focus && this.focus !== sq)) continue;
        const file = sq.charCodeAt(0);
        const rank = +sq[1] + (enemy === 'w' ? 1 : -1);
        if (rank < 1 || rank > 8) continue;
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 97 || f > 104) continue;
          const target = String.fromCharCode(f) + rank;
          if (!this.chess.get(target)) add(target, 'opp-pawn');
        }
      }
      if (this.focus) add(this.focus, 'opp-focus');
      // Наши фигуры под ударом: красная рамка — без защиты (или бьёт фигура дешевле), оранжевая — защищена.
      for (const sq of SQUARES) {
        const p = this.chess.get(sq);
        if (!p || p.color !== this.myColor) continue;
        let attackers = this.chess.attackers(sq, enemy);
        if (this.focus) attackers = attackers.filter((a) => a === this.focus);
        if (!attackers.length) continue;
        const defended = this.chess.attackers(sq, this.myColor).length > 0;
        const cheapest = Math.min(...attackers.map((a) => VALUE[this.chess.get(a).type]));
        add(sq, !defended || cheapest < VALUE[p.type] ? 'attacked' : 'guarded');
      }
    }
    for (const [sq, cls] of this.marks || []) add(sq, cls);
    if (this.hint) add(this.hint, 'hint-from');
    this.insightShapes = arrows;
    if (this.previewing) return;
    this.cg.set({ highlight: { custom: map } });
    this.applyShapes();
  }

  // Стрелки на доске = стрелки урока + стрелки режима соперника + временные (подсветка клетки).
  applyShapes(extra = []) {
    const base = this.baseShapes || [];
    const seen = new Set(base.map((x) => x.orig + (x.dest || '')));
    const insight = (this.insightShapes || []).filter((x) => !seen.has(x.orig + x.dest));
    this.cg.setAutoShapes([...insight, ...base, ...extra]);
  }

  handleMove(orig, dest) {
    // Превращение в ферзя по умолчанию (в дебютах не встречается, но на всякий случай).
    const piece = this.chess.get(orig);
    const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
    this.onUserMove && this.onUserMove({ from: orig, to: dest, promotion: promo });
  }

  // Полностью задать позицию.
  load(fen, lastMove) {
    this.chess = new Chess(fen);
    this.sync(lastMove);
  }

  // Применить ход (SAN или объект). Возвращает ход chess.js или null.
  play(move) {
    let m;
    try {
      m = this.chess.move(typeof move === 'string' ? move.replace(/[!?]+$/, '') : move);
    } catch {
      return null;
    }
    this.sync([m.from, m.to]);
    return m;
  }

  sync(lastMove) {
    this.focus = null;
    this.marks = null;
    this.lastMove = lastMove;
    this.movableColor = null;
    this.previewing = false;
    clearTimeout(this.previewTimer);
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: this.chess.turn() === 'w' ? 'white' : 'black',
      check: this.chess.inCheck(),
      lastMove,
      movable: { color: undefined, dests: new Map() },
    });
    this.renderInsight();
  }

  // Разрешить пользователю ходить за цвет color ('w'/'b').
  enable(color) {
    this.movableColor = color;
    this.cg.set({
      movable: {
        color: color === 'w' ? 'white' : 'black',
        dests: toDests(this.chess),
      },
    });
  }

  disable() {
    this.movableColor = null;
    this.cg.set({ movable: { color: undefined, dests: new Map() } });
  }

  // Вернуть доску в позицию chess.js (после неправильного хода).
  reset(lastMove) {
    this.cg.set({ fen: this.chess.fen(), lastMove, check: this.chess.inCheck() });
    this.renderInsight();
  }

  shapes(list) {
    this.baseShapes = list;
    clearTimeout(this.flashTimer);
    if (!this.previewing) this.applyShapes();
  }

  // Предпросмотр «что будет»: временно показать другую позицию со стрелками.
  preview({ fen, lastMove, shapes }) {
    if (!this.el.isConnected) return;
    clearTimeout(this.flashTimer);
    this.previewing = true;
    this.previewShapes = shapes;
    this.cg.set({ fen, lastMove, check: false, movable: { color: undefined, dests: new Map() }, highlight: { custom: new Map() } });
    this.cg.setAutoShapes(shapes);
  }

  endPreview() {
    if (!this.previewing || !this.el.isConnected) return;
    this.previewing = false;
    this.cg.set({ fen: this.chess.fen(), lastMove: this.lastMove, check: this.chess.inCheck() });
    if (this.movableColor) this.enable(this.movableColor);
    this.renderInsight();
  }

  // Ненадолго показать путь стрелками (когда в тексте нажали на «e1–h4»).
  flashPath(squares) {
    this.flashShapes(pathArrows(squares), PATH_MS);
  }

  // Ненадолго подсветить клетки (когда в тексте нажали на «f7»).
  flash(squares) {
    this.flashShapes(circleShapes(squares), FLASH_MS);
  }

  // Подсветка работает и поверх предпросмотра (курсор над карточкой варианта).
  flashShapes(extra, ms) {
    if (!this.el.isConnected) return;
    clearTimeout(this.flashTimer);
    if (this.previewing) this.cg.setAutoShapes([...(this.previewShapes || []), ...extra]);
    else this.applyShapes(extra);
    this.flashTimer = setTimeout(() => {
      if (!this.el.isConnected) return;
      if (this.previewing) this.cg.setAutoShapes(this.previewShapes || []);
      else this.applyShapes();
    }, ms);
  }

  orientation(o) {
    this.cg.set({ orientation: o });
  }

  shake() {
    this.el.classList.remove('shake');
    void this.el.offsetWidth;
    this.el.classList.add('shake');
  }

  destroy() {
    clearTimeout(this.flashTimer);
    clearTimeout(this.previewTimer);
    destroyBoard(this.cg);
  }
}

export { Chess };
