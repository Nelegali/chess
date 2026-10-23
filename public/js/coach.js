// «Тренер»: объясняет, почему в позиции играют именно так, а не иначе.
//
// Для любого хода он проверяет по порядку:
//  1) есть ли этот ход в базе — как другой хороший дебют или как разобранная ошибка;
//  2) не даёт ли ход мат в один ход;
//  3) не подставляет ли фигуру (или не забывает забрать обратно);
//  4) не нарушает ли принципы дебюта (ранний ферзь, конь на краю, король в центре…).
// Ручные пояснения из alternatives.js имеют приоритет над автоматическими.
import { Chess } from '../vendor/chess.js';
import { OPENINGS, lineSide } from './openings.js';
import { ALTERNATIVES } from './alternatives.js';

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ACC = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя', k: 'короля' };
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

export const VERDICTS = {
  blunder: 'грубая ошибка',
  mistake: 'ошибка',
  dubious: 'сомнительно',
  ok: 'можно, но…',
  good: 'тоже хорошо',
  lost: 'спасения нет',
};

// lost — ход не хуже других, просто позиция уже проиграна (ошибка была раньше)
const SEVERITY = { blunder: 4, mistake: 3, dubious: 2, ok: 1, lost: 1, good: 0 };

const fig = (san) => san.replace(/^[KQRBN]/, (c) => FIG[c]);
const clean = (san) => san.replace(/[!?]+$/, '');
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const firstSentence = (t) => (t.match(/^.*?[.!?](\s|$)/) || [t])[0].trim();

// ─── индекс всех позиций из базы: позиция → ходы, которые в ней разобраны ───

const INDEX = new Map();

function addToIndex(fen, entry) {
  const key = posKey(fen);
  if (!INDEX.has(key)) INDEX.set(key, []);
  INDEX.get(key).push(entry);
}

for (const opening of OPENINGS) {
  for (const line of opening.lines) {
    const c = new Chess();
    for (const [ply, step] of line.steps.entries()) {
      const before = c.fen();
      for (const def of step.alt || []) {
        const first = def.steps[0];
        addToIndex(before, {
          san: new Chess(before).move(clean(first.m)).san,
          annotation: (first.m.match(/[!?]+$/) || [''])[0],
          text: first.t,
          arrows: first.a,
          opening,
          line,
          altDef: def,
        });
      }
      const m = c.move(clean(step.m));
      addToIndex(before, {
        san: m.san,
        annotation: (step.m.match(/[!?]+$/) || [''])[0],
        text: step.t,
        arrows: step.a,
        opening,
        line,
        ply,
        trap: opening.category === 'trap',
        side: lineSide(opening, line),
      });
    }
  }
}

// Что база знает о позиции: основные ходы вариантов (с ply) и разобранные ответвления (с altDef).
export function bookMoves(fen) {
  return INDEX.get(posKey(fen)) || [];
}

// ─── короткая идея хода: зачем он и что даёт дальше ───

const NOM = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };
const DAT = { p: 'пешке', n: 'коню', b: 'слону', r: 'ладье', q: 'ферзю', k: 'королю' };
const CENTER = ['d4', 'e4', 'd5', 'e5'];
const ALL_SQUARES = [];
for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) ALL_SQUARES.push(f + r);

// Сколько клеток бьёт фигура на square (для «открывает дорогу слону»).
function reach(chess, square, color) {
  let n = 0;
  for (const sq of ALL_SQUARES) if (chess.attackers(sq, color).includes(square)) n++;
  return n;
}

// Одна-две короткие фразы для подсказки «что здесь играют»: например,
// «Выводит коня в игру и бьёт центр (e5). Потом можно сделать рокировку».
export function moveIdea(fenBefore, move) {
  const before = new Chess(fenBefore);
  const c = new Chess(fenBefore);
  let m;
  try {
    m = c.move(move);
  } catch {
    return '';
  }
  if (c.isCheckmate()) return 'Мат — партия окончена!';
  const me = m.color;
  const opp = me === 'w' ? 'b' : 'w';
  const out = [];
  const later = [];

  if (m.flags.includes('k') || m.flags.includes('q')) out.push('Рокировка: король уходит в безопасный угол, а ладья включается в игру');
  if (m.captured) {
    // забрали обратно то, что соперник только что взял? (на этой клетке стояла наша фигура до его хода — не знаем,
    // поэтому просто говорим, что забирает и сколько это очков)
    out.push(`Забирает ${ACC[m.captured]} на ${m.to} (+${VAL[m.captured]} ${VAL[m.captured] === 1 ? 'очко' : 'очка'})`);
  }
  if (c.inCheck()) out.push('Шах — соперник обязан защищаться');

  // нападение: какие фигуры соперника теперь бьёт сходившая фигура
  let target = null;
  for (const sq of ALL_SQUARES) {
    const p = c.get(sq);
    if (!p || p.color !== opp || p.type === 'k') continue;
    if (!c.attackers(sq, me).includes(m.to)) continue;
    const defended = c.attackers(sq, opp).length > 0;
    if (!defended || VAL[p.type] > VAL[m.piece]) {
      if (!target || VAL[p.type] > VAL[target.type]) target = { type: p.type, sq, defended };
    }
  }
  if (target) {
    const fem = target.type === 'p' || target.type === 'r';
    const must = target.type === 'p' ? (fem ? 'её защищать' : 'его защищать') : fem ? 'её спасать' : 'его спасать';
    later.push(`нападает на ${ACC[target.type]} ${target.sq} — соперник должен ${must}`);
  }

  // развитие лёгкой фигуры с последней горизонтали
  const home = me === 'w' ? '1' : '8';
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === home) {
    const hits = CENTER.filter((sq) => c.attackers(sq, me).includes(m.to));
    out.push(`Выводит ${ACC[m.piece]} в игру${hits.length ? ` и бьёт центр (${hits.join(', ')})` : ''}`);
  }
  // пешка в центр
  if (m.piece === 'p' && CENTER.includes(m.to)) out.push('Пешка занимает центр');

  // открывает дорогу слону/ферзю
  if (m.piece === 'p') {
    const opened = [];
    for (const sq of ALL_SQUARES) {
      const p = c.get(sq);
      if (!p || p.color !== me || (p.type !== 'b' && p.type !== 'q') || sq[1] !== home) continue;
      if (reach(c, sq, me) >= reach(before, sq, me) + 2) opened.push(`${DAT[p.type]} ${sq}`);
    }
    if (opened.length) later.push(`открывает дорогу ${opened.slice(0, 2).join(' и ')}`);
  }
  // уводит фигуру из-под удара
  const wasAttacked = before.attackers(m.from, opp);
  if (!m.captured && m.piece !== 'p' && wasAttacked.length && !c.attackers(m.to, opp).length) {
    const cheapest = Math.min(...wasAttacked.map((sq) => VAL[before.get(sq).type]));
    if (!before.attackers(m.from, me).length || cheapest < VAL[m.piece]) out.unshift(`Уводит ${ACC[m.piece]} из-под удара`);
  }
  // готовит рокировку: между королём и ладьёй стало пусто
  const rights = fenBefore.split(' ')[2];
  const kSide = me === 'w' ? 'K' : 'k';
  if (rights.includes(kSide) && !m.flags.includes('k')) {
    const between = me === 'w' ? ['f1', 'g1'] : ['f8', 'g8'];
    const emptyNow = between.every((sq) => !c.get(sq));
    const emptyBefore = between.every((sq) => !before.get(sq));
    if (emptyNow && !emptyBefore && m.piece !== 'k' && m.piece !== 'r') later.push('потом можно сделать рокировку');
  }

  const first = out.slice(0, 2).join('. ');
  const next = later.slice(0, 1).join('');
  if (!first && !next) return 'Спокойный полезный ход: ничего не подставляет.';
  if (!first) return next[0].toUpperCase() + next.slice(1) + '.';
  return `${first}${next ? `. ${next[0].toUpperCase() + next.slice(1)}` : ''}.`;
}

// ─── предпросмотр «что будет» ───

const BRUSH = { g: 'green', r: 'red', b: 'blue', y: 'yellow' };
function parseArrows(str) {
  if (!str) return [];
  return str
    .trim()
    .split(/\s+/)
    .map((t) => (t.length === 5 ? { orig: t.slice(1, 3), dest: t.slice(3, 5), brush: BRUSH[t[0]] } : { orig: t.slice(1, 3), brush: BRUSH[t[0]] }));
}

// Позиция после ходов sans (первый — наш вариант, второй — ответ соперника) со стрелками.
export function previewLine(fenBefore, sans, arrows, firstBrush = 'blue', replyBrush = 'red') {
  const c = new Chess(fenBefore);
  const shapes = [];
  const played = [];
  let lastMove;
  for (const [i, san] of sans.entries()) {
    let m;
    try {
      m = c.move(clean(san));
    } catch {
      break;
    }
    played.push(m.san);
    shapes.push({ orig: m.from, dest: m.to, brush: i === 0 ? firstBrush : replyBrush });
    lastMove = [m.from, m.to];
  }
  if (sans.length === 1) shapes.push(...parseArrows(arrows));
  return { fen: c.fen(), lastMove, shapes, sans: played };
}

// ─── материал под ударом ───

// Фигуры цвета color, которые соперник может выгодно взять.
function hanging(chess, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue;
      const attackers = chess.attackers(p.square, enemy);
      if (!attackers.length) continue;
      const defended = chess.attackers(p.square, color).length > 0;
      const cheapest = Math.min(...attackers.map((sq) => VAL[chess.get(sq).type] || 100));
      const loss = defended ? VAL[p.type] - cheapest : VAL[p.type];
      if (loss > 0) out.push({ square: p.square, type: p.type, loss });
    }
  }
  return out;
}

function captureOf(chess, square) {
  // самый дешёвый способ взять фигуру на square
  const caps = chess.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  caps.sort((a, b) => VAL[a.piece] - VAL[b.piece]);
  return caps[0] || null;
}

function mateInOne(chess) {
  for (const m of chess.moves({ verbose: true })) {
    if (!m.san.includes('#')) continue;
    return m;
  }
  return null;
}

// Есть ли ход, после которого соперник не ставит мат сразу.
function canAvoidMate(fen) {
  const c = new Chess(fen);
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mated = mateInOne(c);
    c.undo();
    if (!mated) return true;
  }
  return false;
}

// Тексты тренера написаны для того, кто ходит. Когда разбираем ход соперника — обращаемся к ученику.
const OPPONENT_VIEW = [
  [/соперник сразу ставит мат/g, 'ты сразу ставишь мат'],
  [/соперник ставит мат/g, 'ты ставишь мат'],
  [/соперник просто забирает/g, 'ты просто забираешь'],
  [/соперник забирает/g, 'ты забираешь'],
  [/Соперник забирает/g, 'Ты забираешь'],
  [/лёгкие фигуры соперника будут нападать на него с темпом, а твоё развитие/g, 'твои лёгкие фигуры будут нападать на него с темпом, а развитие соперника'],
  [/как соперник сможет нападать на ферзя, заодно развивая свои фигуры/g, 'как ты сможешь нападать на ферзя, заодно развивая свои фигуры'],
];
export function forOpponentMove(text) {
  return OPPONENT_VIEW.reduce((t, [re, to]) => t.replace(re, to), text);
}

// Каких вражеских фигур новые атаки после хода (нападение «с темпом»).
function newThreats(after, move) {
  const enemy = move.color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of after.board()) {
    for (const p of row) {
      if (!p || p.color !== enemy || p.type === 'k') continue;
      const nowAttackedByMover = after.attackers(p.square, move.color).includes(move.to);
      if (!nowAttackedByMover) continue;
      const defended = after.attackers(p.square, enemy).length > 0;
      if (!defended || VAL[move.piece] < VAL[p.type]) out.push(p);
    }
  }
  return out;
}

const homeRank = (color) => (color === 'w' ? '1' : '8');
const isDevelopment = (m) => 'nb'.includes(m.piece) && m.from[1] === homeRank(m.color);
const isCastle = (m) => m.flags.includes('k') || m.flags.includes('q');

// ─── объяснение одного хода ───
//
// fenBefore — позиция до хода; alt — ход, который хотим объяснить (объект chess.js);
// theory — ход по теории (объект chess.js); reveal — можно ли упоминать правильный ход.
export function explain(fenBefore, alt, theory, opts = {}) {
  const r = explainCore(fenBefore, alt, theory, opts);
  const reply = r.demo && r.demo[1] ? r.demo[1].m : null;
  r.preview = previewLine(fenBefore, reply ? [alt.san, reply] : [alt.san], r.arrows, r.verdict === 'good' ? 'green' : 'blue');
  if (!reply && r.visual) r.preview.shapes.push(...r.visual);
  r.preview.caption = reply
    ? 'Синяя стрелка — этот ход, красная — ответ соперника.'
    : r.visualCaption ||
      (r.arrows ? 'Синяя стрелка — этот ход, остальные — его идеи и угрозы.' : r.verdict === 'good' ? 'Зелёная стрелка — этот ход.' : 'Синяя стрелка — этот ход.');
  return r;
}

// Наглядность к причинам «почему хуже»: что показать на доске после хода.
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
function knightTargets(sq) {
  const f = sq.charCodeAt(0) - 97;
  const r = +sq[1] - 1;
  return KNIGHT_JUMPS.map(([df, dr]) => [f + df, r + dr])
    .filter(([x, y]) => x >= 0 && x < 8 && y >= 0 && y < 8)
    .map(([x, y]) => String.fromCharCode(97 + x) + (y + 1));
}

// Ходы соперника, которые нападают на фигуру на square (например, гонят рано вышедшего ферзя).
function chasers(after, square, limit = 2) {
  const out = [];
  for (const m of after.moves({ verbose: true })) {
    if (m.captured) continue;
    after.move(m);
    const hits = after.attackers(square, m.color).includes(m.to);
    after.undo();
    if (hits) out.push({ orig: m.from, dest: m.to, brush: 'red' });
    if (out.length >= limit) break;
  }
  return out;
}

function explainCore(fenBefore, alt, theory, { lineId, ply, reveal = true } = {}) {
  const fullmove = +fenBefore.split(' ')[5];
  const side = alt.color;
  const altFig = fig(alt.san);
  const theoryFig = theory ? fig(theory.san) : '';
  const manual = lineId != null ? ALTERNATIVES[lineId]?.[ply]?.[alt.san] : null;
  const authored = manual ? (typeof manual === 'string' ? manual : manual.t) : null;
  const authoredVerdict = manual && typeof manual === 'object' ? manual.v : null;

  const after = new Chess(fenBefore);
  after.move(alt.san);
  const afterTheory = theory ? new Chess(fenBefore) : null;
  if (afterTheory) afterTheory.move(theory.san);

  const result = (verdict, text, demo) => ({
    san: alt.san,
    verdict: authoredVerdict || verdict,
    text: authored || text,
    demo,
  });

  // 1. Мат в один ход
  const mate = mateInOne(after);
  if (mate) {
    const hopeless = !canAvoidMate(fenBefore);
    const demo = [
      { m: alt.san, t: authored || `Ход ${altFig}…` },
      { m: mate.san, t: hopeless ? '…и мат: другие ходы тоже не спасали.' : `…и мат! Вот почему так нельзя.` },
    ];
    if (hopeless) {
      return result('lost', `Спасения уже не было: после любого хода — мат. Здесь это ${fig(mate.san)}. Ошибка была раньше.`, demo);
    }
    return result('blunder', `После ${altFig} соперник сразу ставит мат: ${fig(mate.san)}!`, demo);
  }

  // 2. Ход есть в базе
  const known = (INDEX.get(posKey(fenBefore)) || []).find((e) => e.san === alt.san);
  if (known) {
    const fromAnnotation = { '??': 'blunder', '?': 'mistake', '?!': 'dubious' }[known.annotation];
    if (fromAnnotation || known.altDef) {
      return {
        san: alt.san,
        verdict: authoredVerdict || fromAnnotation || 'good',
        text: authored || (known.altDef ? known.altDef.intro || known.text : known.text),
        demo: known.altDef ? known.altDef.steps : null,
        demoLabel: known.altDef ? known.altDef.label : null,
        arrows: known.arrows,
      };
    }
    if (known.trap && known.side !== side) {
      // ход «ставящей ловушку» стороны в линии, где ученик защищается, — сомнительный
      return { ...result('dubious', known.text), arrows: known.arrows };
    }
    if (!(lineId && known.line.id === lineId)) {
      const sameOpening = theory && OPENINGS.find((o) => o.lines.some((l) => l.id === lineId))?.id === known.opening.id;
      const where = sameOpening ? `вариант «${known.line.name}»` : `«${known.opening.name}»`;
      return result('good', `Это тоже хороший ход — так играют в ${where}. ${reveal ? 'Просто в этом варианте мы учим другой план.' : 'Но в этом варианте план другой.'}`);
    }
  }

  // 3. Материал
  const theoryHanging = afterTheory ? hanging(afterTheory, side) : [];
  const altHanging = hanging(after, side).filter(
    (h) => !theoryHanging.some((t) => t.square === h.square && t.loss >= h.loss),
  );
  altHanging.sort((a, b) => b.loss - a.loss);
  const gained = alt.captured ? VAL[alt.captured] : 0;
  const worst = altHanging[0];
  if (worst && worst.loss > gained) {
    const cap = captureOf(after, worst.square);
    const movedPiece = worst.square === alt.to;
    const text = movedPiece
      ? `${altFig} ставит ${ACC[worst.type]} под удар: соперник просто забирает ${worst.type === 'p' ? 'её' : 'его'}${cap ? ` ходом ${fig(cap.san)}` : ''}.`
      : `После ${altFig} ${worst.type === 'p' ? 'пешка' : ACC[worst.type] === 'ладью' ? 'ладья' : ACC[worst.type] === 'ферзя' ? 'ферзь' : worst.type === 'n' ? 'конь' : 'слон'} на ${worst.square} остаётся без защиты — соперник забирает ${worst.type === 'p' ? 'её' : 'его'}${cap ? ` ходом ${fig(cap.san)}` : ''}.`;
    const verdict = worst.loss - gained >= 3 ? 'blunder' : 'mistake';
    return result(
      verdict,
      text + (worst.loss - gained >= 3 ? ' Это потеря фигуры.' : ''),
      cap ? [{ m: alt.san, t: `Ход ${altFig}.` }, { m: cap.san, t: `Соперник забирает ${ACC[worst.type]}. Вот чем плох ход ${altFig}.` }] : null,
    );
  }

  // Не забрал обратно
  if (theory && theory.captured && !alt.captured && VAL[theory.captured] >= 1) {
    return result(
      'mistake',
      reveal
        ? `Нужно было забрать обратно: ${theoryFig} возвращает ${ACC[theory.captured]}. Иначе соперник останется с лишним материалом.`
        : `Соперник только что взял материал — его нужно вернуть, иначе останешься без ${theory.captured === 'p' ? 'пешки' : 'фигуры'}.`,
    );
  }

  // 4. Принципы дебюта
  const reasons = [];
  const visuals = [];
  if (alt.piece === 'k' && !isCastle(alt)) {
    reasons.push(['dubious', 'Король уходит с места и теряет право на рокировку — он останется в центре, под ударом.']);
    visuals.push([[{ orig: alt.to, brush: 'yellow' }], 'Король сдвинулся с места — рокировка ему больше недоступна.']);
  }
  if (theory && isCastle(theory) && !isCastle(alt)) {
    reasons.push(['dubious', 'Пора прятать короля: рокировка уводит его из центра и подключает ладью к игре.']);
  }
  if (alt.piece === 'q' && fullmove <= 8 && !alt.captured && !(theory && theory.piece === 'q')) {
    reasons.push(['dubious', 'Ферзь выходит слишком рано: лёгкие фигуры соперника будут нападать на него с темпом, а твоё развитие отстанет.']);
    const ch = chasers(new Chess(after.fen()), alt.to);
    if (ch.length) visuals.push([ch, 'Красные стрелки — как соперник сможет нападать на ферзя, заодно развивая свои фигуры.']);
  }
  if (alt.piece === 'n' && 'ah'.includes(alt.to[0]) && !(theory && theory.piece === 'n' && 'ah'.includes(theory.to[0]))) {
    reasons.push(['dubious', 'Конь на краю доски контролирует вдвое меньше полей. Недаром говорят: «конь на краю — доске урон».']);
    const t = knightTargets(alt.to);
    visuals.push([t.map((sq) => ({ orig: sq, brush: 'yellow' })), `Жёлтые кружки — клетки, которые бьёт конь с ${alt.to}: всего ${t.length}. Из центра доски конь бьёт до 8 клеток.`]);
  }
  if (alt.piece === 'p' && alt.from[0] === 'f' && fullmove <= 10 && !(theory && theory.from[0] === 'f')) {
    reasons.push(['dubious', 'Пешка f прикрывает короля: её ход ослабляет диагональ к королю (вспомни мат дурака).']);
    const k = side === 'w' ? 'e1' : 'e8';
    const corner = side === 'w' ? 'h4' : 'h5';
    const middle = side === 'w' ? 'g3' : 'g6';
    if (after.get(k)?.type === 'k' && !after.get(middle)) {
      visuals.push([[{ orig: corner, dest: k, brush: 'red' }], 'Красная стрелка — открывшаяся диагональ: по ней ферзь соперника может добраться до короля.']);
    }
  }
  if (alt.piece === 'p' && 'ah'.includes(alt.from[0]) && fullmove <= 6 && !(theory && theory.piece === 'p' && 'ah'.includes(theory.from[0]))) {
    reasons.push(['dubious', 'Ход крайней пешкой почти ничего не даёт: в дебюте важнее центр и развитие фигур.']);
  }
  if (theory && isDevelopment(theory) && 'nbq'.includes(alt.piece) && alt.from[1] !== homeRank(side) && !alt.captured) {
    reasons.push(['dubious', reveal ? `Эта фигура уже ходила. Пока другие стоят дома, лучше вывести новую — например, ${theoryFig}.` : 'Эта фигура уже ходила. Пока другие стоят дома, лучше вывести новую.']);
  }
  if (theory && isDevelopment(theory) && alt.piece === 'p' && !alt.captured && fullmove <= 8) {
    reasons.push(['ok', reveal ? `Сейчас важнее развить фигуру (${theoryFig}), чем двигать пешку.` : 'Сейчас важнее развить фигуру, чем двигать пешку.']);
  }
  if (theory && afterTheory && reveal) {
    const threats = newThreats(afterTheory, theory);
    const altThreats = newThreats(after, alt);
    if (threats.length && !altThreats.length) {
      const t = threats.sort((a, b) => VAL[b.type] - VAL[a.type])[0];
      reasons.push(['ok', `${theoryFig} нападает на ${ACC[t.type]} на ${t.square} — это ход с темпом: соперник вынужден отвечать, а ${altFig} ничего не создаёт.`]);
    }
  }
  if (reasons.length) {
    reasons.sort((a, b) => SEVERITY[b[0]] - SEVERITY[a[0]]);
    const r = result(reasons[0][0], reasons.slice(0, 2).map((x) => x[1]).join(' '));
    if (visuals.length) {
      r.visual = visuals[0][0];
      r.visualCaption = visuals[0][1];
    }
    return r;
  }

  // 5. Ничего плохого не нашли
  return result(
    'ok',
    !theory
      ? 'Нормальный ход: фигуры не подставлены, явных ошибок нет.'
      : reveal
        ? `Так тоже можно, но это не план дебюта. ${theoryFig}: ${firstSentence(OPENINGS_TEXT(lineId, ply) || '')}`.trim()
        : 'Так тоже можно, но в этом дебюте план другой. Вспомни, что мы учили!',
  );
}

function OPENINGS_TEXT(lineId, ply) {
  for (const o of OPENINGS) for (const l of o.lines) if (l.id === lineId) return l.steps[ply]?.t;
  return null;
}

// ─── подборка «почему не по-другому» для хода по теории ───

function naturalness(m, fullmove, chess) {
  let s = 0;
  const enemy = m.color === 'w' ? 'b' : 'w';
  if (!m.captured && m.piece !== 'p') {
    const pawnAttack = chess.attackers(m.to, enemy).some((sq) => chess.get(sq).type === 'p');
    if (pawnAttack) s -= 5;
  }
  if (m.piece === 'b' && 'ah'.includes(m.to[0]) && !m.captured) s -= 2;
  if (m.captured) s += 3 + VAL[m.captured];
  if (m.san.includes('+')) s += 2;
  if (isDevelopment(m)) s += 3;
  if (m.piece === 'p' && 'cdef'.includes(m.from[0])) s += 2;
  if (m.piece === 'q') s += fullmove <= 8 ? 2 : 0;
  if (m.piece === 'k' && !isCastle(m)) s -= 6;
  if (m.piece === 'r') s -= 3;
  if (m.piece === 'p' && 'ah'.includes(m.from[0])) s -= 1;
  return s;
}

export function alternatives(fenBefore, theory, { lineId, ply, stepAlt = [] } = {}) {
  const fullmove = +fenBefore.split(' ')[5];
  const c = new Chess(fenBefore);
  const legal = c.moves({ verbose: true }).filter((m) => m.san !== theory.san);
  const out = [];
  const used = new Set();
  const push = (e) => {
    if (!e || used.has(e.san)) return;
    used.add(e.san);
    out.push(e);
  };

  // разобранные в данных варианты «а что если» для этого хода
  for (const def of stepAlt) {
    const first = new Chess(fenBefore).move(clean(def.steps[0].m));
    const annotation = (def.steps[0].m.match(/[!?]+$/) || [''])[0];
    const manual = ALTERNATIVES[lineId]?.[ply]?.[first.san];
    const verdict = (manual && manual.v) || { '??': 'blunder', '?': 'mistake', '?!': 'dubious' }[annotation] || 'good';
    const reply = def.steps[1] ? def.steps[1].m : null;
    push({
      san: first.san,
      verdict,
      text: (manual && (manual.t || manual)) || def.intro || def.steps[0].t,
      demo: def.steps,
      demoLabel: def.label,
      preview: previewLine(fenBefore, reply ? [first.san, reply] : [first.san], def.steps[0].a, verdict === 'good' ? 'green' : 'blue'),
    });
  }
  // ручные пояснения
  for (const san of Object.keys(ALTERNATIVES[lineId]?.[ply] || {})) {
    const m = legal.find((x) => x.san === san);
    if (m) push(explain(fenBefore, m, theory, { lineId, ply }));
  }
  // автоматические: самые «соблазнительные» плохие ходы и один хороший из базы
  if (out.length < 3) {
    const scored = legal
      .filter((m) => !used.has(m.san))
      .map((m) => ({ m, n: naturalness(m, fullmove, c) }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, 10)
      .map((x) => ({ ...explain(fenBefore, x.m, theory, { lineId, ply }), n: x.n }));
    const bad = scored
      .filter((e) => SEVERITY[e.verdict] >= 2)
      .sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict] || b.n - a.n);
    const good = scored.filter((e) => e.verdict === 'good');
    for (const e of bad) if (out.length < 3) push(e);
    if (good.length && out.length < 4) push(good[0]);
  }
  return out.slice(0, 4);
}
