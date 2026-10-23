// Проверяет, что все ходы во всех линиях и побочных вариантах легальны,
// стрелки ссылаются на существующие поля, а id уникальны.
// Запуск: node tests/validate-openings.mjs
import { Chess } from '../public/vendor/chess.js';
import { OPENINGS } from '../public/js/openings.js';
import { ALTERNATIVES } from '../public/js/alternatives.js';
import { APP_VERSION } from '../public/js/version.js';
import { readFileSync } from 'node:fs';

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

// Ручные пояснения «почему не по-другому»: ход легален и отличается от теории.
let altCount = 0;
for (const [lineId, byPly] of Object.entries(ALTERNATIVES)) {
  const found = OPENINGS.flatMap((o) => o.lines).find((l) => l.id === lineId);
  if (!found) {
    errors.push(`alternatives: нет линии ${lineId}`);
    continue;
  }
  for (const [ply, moves] of Object.entries(byPly)) {
    const c = new Chess();
    for (const s of found.steps.slice(0, +ply)) c.move(s.m.replace(/[!?]+$/, ''));
    const main = new Chess(c.fen()).move(found.steps[+ply].m.replace(/[!?]+$/, '')).san;
    for (const [san, val] of Object.entries(moves)) {
      altCount++;
      if (typeof val !== 'string' && !(val && typeof val.t === 'string' && ['blunder', 'mistake', 'dubious', 'ok', 'good'].includes(val.v))) {
        errors.push(`alternatives ${lineId}[${ply}] ${san}: значение должно быть строкой или { v, t }`);
      }
      const legal = c.moves();
      if (!legal.includes(san)) errors.push(`alternatives ${lineId}[${ply}]: ход ${san} нелегален (есть: ${legal.join(' ')})`);
      if (san === main) errors.push(`alternatives ${lineId}[${ply}]: ${san} совпадает с ходом по теории`);
    }
  }
}

// Версия приложения одинакова в version.js, version.json и sw.js
const versionJson = JSON.parse(readFileSync(new URL('../public/version.json', import.meta.url), 'utf8')).version;
const swVersion = (readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
if (versionJson !== APP_VERSION || swVersion !== APP_VERSION) {
  errors.push(`версии не совпадают: version.js=${APP_VERSION}, version.json=${versionJson}, sw.js=${swVersion}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n✗ ошибок: ${errors.length}`);
  process.exit(1);
}
console.log(`✓ версия ${APP_VERSION}; ${OPENINGS.length} дебютов, ${lines} линий, ${moves} ходов, ${altCount} ручных пояснений — всё легально`);
