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

export function toDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

export function sanToMove(fen, san) {
  const c = new Chess(fen);
  try {
    return c.move(san.replace(/[!?]+$/, ''));
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
  constructor(el, { orientation = 'white', onUserMove } = {}) {
    this.el = el;
    this.onUserMove = onUserMove;
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
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
    });
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
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: this.chess.turn() === 'w' ? 'white' : 'black',
      check: this.chess.inCheck(),
      lastMove,
      movable: { color: undefined, dests: new Map() },
    });
  }

  // Разрешить пользователю ходить за цвет color ('w'/'b').
  enable(color) {
    this.cg.set({
      movable: {
        color: color === 'w' ? 'white' : 'black',
        dests: toDests(this.chess),
      },
    });
  }

  disable() {
    this.cg.set({ movable: { color: undefined, dests: new Map() } });
  }

  // Вернуть доску в позицию chess.js (после неправильного хода).
  reset(lastMove) {
    this.cg.set({ fen: this.chess.fen(), lastMove, check: this.chess.inCheck() });
  }

  shapes(list) {
    this.cg.setAutoShapes(list);
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
    this.cg.destroy();
  }
}

export { Chess };
