// Интеграция с Lichess: ссылки на анализ / игру с компьютером и статистика
// «что чаще всего играют в этой позиции» из Opening Explorer.
//
// С 2026 года Lichess отдаёт статистику дебютов только авторизованным запросам.
// Поэтому порядок такой: сначала свой сервер (server.js подставляет LICHESS_TOKEN),
// затем прямой запрос из браузера с личным токеном из настроек.
import { settings, checkServer } from './store.js';

const fenPath = (fen) => fen.replace(/ /g, '_');

export function analysisUrl(fen, color = 'white') {
  return `https://lichess.org/analysis/standard/${fenPath(fen)}?color=${color}`;
}

export function playVsComputerUrl(fen) {
  return `https://lichess.org/?fen=${encodeURIComponent(fen)}#ai`;
}

export const TOKEN_CREATE_URL =
  'https://lichess.org/account/oauth/token/create?description=' + encodeURIComponent('Шахматные дебюты');

// kind: 'auth' — Lichess требует вход/токен; 'network' — запрос не дошёл
// (в т.ч. браузер не пустил ответ); 'http' — другая ошибка сервера.
export class ExplorerError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

const cache = new Map();
// Если Lichess уже отказал, не повторяем запрос на каждом ходу — до смены токена.
let refused = null;

export function resetExplorer() {
  refused = null;
}

// uciMoves — ходы от начальной позиции в формате UCI (e2e4, e7e5…)
export async function explorer(uciMoves) {
  const params = new URLSearchParams({
    variant: 'standard',
    play: uciMoves.join(','),
    speeds: 'blitz,rapid,classical',
    ratings: '1400,1600,1800,2000',
    moves: '6',
    topGames: '0',
    recentGames: '0',
  });
  const key = params.toString();
  if (cache.has(key)) return cache.get(key);
  if (refused) throw refused;

  let error = null;

  // 1) свой сервер: работает без ограничений браузера, если на сервере задан LICHESS_TOKEN
  if (await checkServer()) {
    try {
      const r = await fetch(`api/explorer?${key}`);
      if (r.ok) return remember(key, await r.json());
      error =
        r.status === 401
          ? new ExplorerError('Lichess требует токен: задайте LICHESS_TOKEN на сервере', 'auth')
          : new ExplorerError(`Сервер ответил ${r.status}`, 'http');
    } catch (e) {
      error = new ExplorerError(e.message, 'network');
    }
  }

  // 2) напрямую из браузера
  try {
    const r = await fetch(`https://explorer.lichess.ovh/lichess?${key}`, {
      headers: settings.lichessToken ? { Authorization: `Bearer ${settings.lichessToken}` } : {},
    });
    if (r.ok) return remember(key, await r.json());
    error =
      r.status === 401 || r.status === 403
        ? new ExplorerError('Lichess требует вход в аккаунт', 'auth')
        : new ExplorerError(`Lichess ответил ${r.status}`, 'http');
  } catch (e) {
    // Без токена Lichess отвечает отказом, который браузер показывает как сетевую ошибку.
    error = error && error.kind === 'auth' ? error : new ExplorerError(e.message, settings.lichessToken ? 'network' : 'auth');
  }

  if (error.kind !== 'http') refused = error;
  throw error;
}

function remember(key, data) {
  cache.set(key, data);
  return data;
}
