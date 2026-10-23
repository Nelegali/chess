// Встроенная статистика популярности ходов — чтобы проценты были видны и без доступа к Lichess.
//
// Источник: «Chess Game Dataset (Lichess)» (datasnaek, Kaggle; CC0 — общественное достояние):
// ~20 тысяч партий с lichess.org, файл games.csv. Скачать: https://www.kaggle.com/datasets/datasnaek/chess
//
// Запуск: node tools/build-popularity.mjs путь/к/games.csv
// Результат: public/data/popularity.json — для каждой позиции первых MAX_PLY полуходов, где сыграно
// не меньше MIN_GAMES партий, — самые частые ходы: [ход, партий, победы белых, ничьи, победы чёрных].
import fs from 'node:fs';
import { Chess } from '../public/vendor/chess.js';

const MAX_PLY = 16;
const MIN_GAMES = 12;
const MAX_MOVES = 6;

const file = process.argv[2];
if (!file) {
  console.error('Укажите путь к games.csv');
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const head = lines[0].split(',');
const col = (name) => head.indexOf(name);
const [cMoves, cWinner] = [col('moves'), col('winner')];

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const stats = new Map(); // позиция → Map(ход → [n, w, d, b])
let games = 0;

for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  // в этом наборе запятые встречаются только в названии дебюта — ходы и результат стоят раньше
  const cells = line.split(',');
  const sans = cells[cMoves].trim().split(/\s+/);
  const winner = cells[cWinner];
  const res = winner === 'white' ? 1 : winner === 'black' ? 3 : 2;
  const c = new Chess();
  games++;
  for (const san of sans.slice(0, MAX_PLY)) {
    const key = posKey(c.fen());
    let m;
    try {
      m = c.move(san);
    } catch {
      break;
    }
    if (!stats.has(key)) stats.set(key, new Map());
    const byMove = stats.get(key);
    const rec = byMove.get(m.san) || [0, 0, 0, 0];
    rec[0]++;
    rec[res]++;
    byMove.set(m.san, rec);
  }
}

const positions = {};
for (const [key, byMove] of stats) {
  const total = [...byMove.values()].reduce((a, r) => a + r[0], 0);
  if (total < MIN_GAMES) continue;
  positions[key] = [...byMove.entries()]
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, MAX_MOVES)
    .filter(([, r]) => r[0] >= 2)
    .map(([san, r]) => [san, ...r])
    .concat([['', total, 0, 0, 0]]); // последняя запись — всего партий в позиции
}

const out = {
  source: 'Chess Game Dataset (Lichess), datasnaek, Kaggle — CC0',
  games,
  maxPly: MAX_PLY,
  positions,
};
fs.mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
const path = new URL('../public/data/popularity.json', import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));
console.log(`партий: ${games}, позиций: ${Object.keys(positions).length}, размер: ${(fs.statSync(path).size / 1024).toFixed(0)} КБ`);
