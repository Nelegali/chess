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
        },
      },
      events: { select: (key) => this.onSelect(key) },
    });
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
    if (!this.el.isConnected || this.previewing) return;
    clearTimeout(this.flashTimer);
    const arrows = [];
    for (let i = 1; i < squares.length; i++) arrows.push({ orig: squares[i - 1], dest: squares[i], brush: 'blue' });
    this.applyShapes(arrows);
    this.flashTimer = setTimeout(() => {
      if (!this.previewing && this.el.isConnected) this.applyShapes();
    }, 2200);
  }

  // Ненадолго подсветить клетки (когда в тексте нажали на «f7»).
  flash(squares) {
    if (!this.el.isConnected || this.previewing) return;
    clearTimeout(this.flashTimer);
    this.applyShapes(squares.map((sq) => ({ orig: sq, brush: 'blue' })));
    this.flashTimer = setTimeout(() => {
      if (!this.previewing && this.el.isConnected) this.applyShapes();
    }, 1800);
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
    this.cg.destroy();
  }
}

export { Chess };
