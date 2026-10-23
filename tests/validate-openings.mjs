// Проверяет, что все ходы во всех линиях и побочных вариантах легальны,
// стрелки ссылаются на существующие поля, а id уникальны.
// Запуск: node tests/validate-openings.mjs
import { Chess } from '../public/vendor/chess.js';
import { OPENINGS } from '../public/js/openings.js';

const SQ = /^[a-h][1-8]$/;
const errors = [];
const ids = new Set();
let lines = 0;
let moves = 0;

function checkArrows(where, a) {
  if (!a) return;
  for (const tok of a.trim().split(/\s+/)) {
    const color = tok[0];
    const rest = tok.slice(1);
    if (!'grby'.includes(color)) errors.push(`${where}: неизвестный цвет стрелки "${tok}"`);
    if (rest.length === 2 ? !SQ.test(rest) : rest.length !== 4 || !SQ.test(rest.slice(0, 2)) || !SQ.test(rest.slice(2))) {
      errors.push(`${where}: плохая стрелка "${tok}"`);
    }
  }
}

function playSteps(where, chess, steps) {
  for (const [i, s] of steps.entries()) {
    const w = `${where} шаг ${i + 1} (${s.m})`;
    if (s.alt) {
      for (const alt of s.alt) {
        const c2 = new Chess(chess.fen());
        playSteps(`${w} / alt "${alt.label}"`, c2, alt.steps);
      }
    }
    let mv;
    try {
      mv = chess.move(s.m.replace(/[!?]+$/, ''));
    } catch {
      errors.push(`${w}: нелегальный ход в позиции ${chess.fen()}`);
      return;
    }
    moves++;
    if (!s.t) errors.push(`${w}: нет текста`);
    checkArrows(w, s.a);
    const clean = s.m.replace(/[!?]+$/, '');
    if (clean !== mv.san) errors.push(`${w}: SAN записан как "${clean}", должно быть "${mv.san}"`);
  }
}

for (const o of OPENINGS) {
  if (ids.has(o.id)) errors.push(`дубликат id ${o.id}`);
  ids.add(o.id);
  for (const k of ['name', 'eco', 'category', 'side', 'difficulty', 'popularity', 'about', 'tagline']) {
    if (o[k] === undefined) errors.push(`${o.id}: нет поля ${k}`);
  }
  for (const l of o.lines) {
    lines++;
    if (ids.has(l.id)) errors.push(`дубликат id ${l.id}`);
    ids.add(l.id);
    const chess = new Chess();
    playSteps(`${o.id}/${l.id}`, chess, l.steps);
    const side = l.side || o.side;
    if (!l.steps.some((s, i) => (i % 2 === 0 ? 'w' : 'b') === side)) {
      errors.push(`${l.id}: у ученика нет ни одного хода`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n✗ ошибок: ${errors.length}`);
  process.exit(1);
}
console.log(`✓ ${OPENINGS.length} дебютов, ${lines} линий, ${moves} ходов — всё легально`);
