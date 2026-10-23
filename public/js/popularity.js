// Встроенная статистика популярности ходов: ~20 тысяч партий с Lichess (см. tools/build-popularity.mjs).
// Нужна, чтобы проценты «как часто так играют» были видны и без токена Lichess, и без интернета.
import { Chess } from '../vendor/chess.js';
import { explorer } from './lichess.js';

let loading = null;
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

function load() {
  if (!loading) {
    loading = fetch('data/popularity.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return loading;
}

// Статистика позиции в том же виде, что у Lichess Opening Explorer, плюс total и source.
export async function localStats(fen) {
  const data = await load();
  const rows = data && data.positions[posKey(fen)];
  if (!rows) return null;
  const total = rows[rows.length - 1][1];
  const moves = [];
  for (const [san, , w, d, b] of rows.slice(0, -1)) {
    let m;
    try {
      m = new Chess(fen).move(san);
    } catch {
      continue;
    }
    moves.push({ san: m.san, uci: m.from + m.to + (m.promotion || ''), white: w, draws: d, black: b });
  }
  const sum = (k) => moves.reduce((a, m) => a + m[k], 0);
  return { total, white: sum('white'), draws: sum('draws'), black: sum('black'), moves, opening: null, source: 'local', games: data.games };
}

// Сначала живая статистика Lichess; если её нет (нужен токен, нет интернета) — встроенная.
// Если нет и встроенной для этой позиции — ошибка Lichess, чтобы показать, как её подключить.
export async function moveStats(uciMoves, fen) {
  try {
    const data = await explorer(uciMoves);
    return { ...data, total: data.white + data.draws + data.black, source: 'lichess' };
  } catch (error) {
    const local = await localStats(fen);
    if (local) return { ...local, lichessError: error };
    throw error;
  }
}
