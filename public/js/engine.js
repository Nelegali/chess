// Шахматный движок Stockfish 17.1 (облегчённая сборка, один поток) в фоновом потоке браузера.
// Файл ~7 МБ скачивается один раз — при первом запросе «лучших ходов» — и дальше берётся из кэша.

const ENGINE_URL = 'vendor/stockfish/stockfish.js';

let worker = null;
let booting = null;
let job = null; // текущий расчёт: { fen, multipv, lines, resolve, reject }
const queue = []; // ждущие расчёты (выполняется только последний)
const cache = new Map();

export const engineState = { status: 'off' }; // off | loading | ready | error

function boot() {
  if (booting) return booting;
  engineState.status = 'loading';
  booting = new Promise((resolve, reject) => {
    try {
      worker = new Worker(ENGINE_URL);
    } catch (e) {
      engineState.status = 'error';
      booting = null;
      return reject(e);
    }
    worker.onerror = (e) => {
      engineState.status = 'error';
      booting = null;
      reject(new Error(e.message || 'движок не запустился'));
      if (job) job.reject(new Error('движок остановился'));
      job = null;
    };
    worker.onmessage = (e) => {
      const line = String(e.data);
      if (line === 'uciok') worker.postMessage('isready');
      else if (line === 'readyok' && engineState.status === 'loading') {
        engineState.status = 'ready';
        resolve();
      } else onLine(line);
    };
    worker.postMessage('uci');
  });
  return booting;
}

// «info depth 17 multipv 2 score cp 35 … pv f1c4 g8f6» → { rank, depth, cp | mate, pv }
function onLine(line) {
  if (!job) return;
  if (line.startsWith('info') && line.includes(' pv ')) {
    const num = (key) => {
      const m = line.match(new RegExp(` ${key} (-?\\d+)`));
      return m ? +m[1] : null;
    };
    const rank = num('multipv') || 1;
    const depth = num('depth');
    const cp = num('score cp');
    const mate = num('score mate');
    const pv = line.split(' pv ')[1].trim().split(' ');
    const prev = job.lines.get(rank);
    if (!prev || depth >= prev.depth) job.lines.set(rank, { rank, depth, cp, mate, pv, uci: pv[0] });
  } else if (line.startsWith('bestmove')) {
    const done = job;
    job = null;
    const lines = [...done.lines.values()].sort((a, b) => a.rank - b.rank);
    if (!done.cancelled) {
      cache.set(`${done.fen}|${done.multipv}`, lines);
      done.resolve(lines);
    } else done.reject(new Error('cancelled'));
    next();
  }
}

function next() {
  if (job || !queue.length) return;
  // старые запросы уже не нужны — считаем только последнюю позицию
  const req = queue.pop();
  for (const old of queue.splice(0)) old.reject(new Error('cancelled'));
  job = { ...req, lines: new Map() };
  worker.postMessage(`setoption name MultiPV value ${req.multipv}`);
  worker.postMessage(`position fen ${req.fen}`);
  worker.postMessage(`go movetime ${req.movetime} depth 20`);
}

// Лучшие ходы в позиции: [{ rank, uci, cp, mate, pv, depth }] — оценка с точки зрения того, кто ходит.
export async function analyse(fen, { multipv = 5, movetime = 1500 } = {}) {
  const key = `${fen}|${multipv}`;
  if (cache.has(key)) return cache.get(key);
  await boot();
  return new Promise((resolve, reject) => {
    if (job) {
      job.cancelled = true;
      worker.postMessage('stop');
    }
    queue.push({ fen, multipv, movetime, resolve, reject });
    next();
  });
}

export function cached(fen, multipv = 5) {
  return cache.get(`${fen}|${multipv}`) || null;
}

// Оценка в «пешках» для сравнения ходов: мат — очень много.
export function scoreOf(line) {
  if (!line) return null;
  if (line.mate != null) return line.mate > 0 ? 10000 - line.mate : -10000 - line.mate;
  return line.cp;
}
