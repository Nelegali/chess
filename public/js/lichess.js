// Интеграция с Lichess: ссылки на анализ / игру с компьютером и статистика
// «что чаще всего играют в этой позиции» из Opening Explorer.
import { settings } from './store.js';

const fenPath = (fen) => fen.replace(/ /g, '_');

export function analysisUrl(fen, color = 'white') {
  return `https://lichess.org/analysis/standard/${fenPath(fen)}?color=${color}`;
}

export function playVsComputerUrl(fen) {
  return `https://lichess.org/?fen=${encodeURIComponent(fen)}#ai`;
}

const cache = new Map();

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

  const attempts = [];
  // 1) напрямую из браузера (с личным токеном Lichess, если он указан в настройках)
  attempts.push(() =>
    fetch(`https://explorer.lichess.ovh/lichess?${key}`, {
      headers: settings.lichessToken ? { Authorization: `Bearer ${settings.lichessToken}` } : {},
    }),
  );
  // 2) через свой сервер (server.js), который может подставить токен из переменной окружения
  attempts.push(() => fetch(`api/explorer?${key}`));

  let lastError = 'нет ответа';
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (r.ok) {
        const data = await r.json();
        cache.set(key, data);
        return data;
      }
      lastError = r.status === 401 ? 'Lichess просит токен (см. Настройки)' : `HTTP ${r.status}`;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError);
}
