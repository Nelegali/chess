// Прогресс ученика: интервальные повторения (система Лейтнера), опыт, серия дней,
// достижения. Хранится в localStorage отдельно для каждого профиля (например, «я» и «жена»).
// Синхронизация между устройствами: через приватный гист GitHub (без своего сервера)
// или через свой сервер по секретной фразе.
import { OPENINGS, allLines, findLine, lineSide } from './openings.js';

const KEY = 'chess-openings-progress-v1';
const SETTINGS_KEY = 'chess-openings-settings-v1';
const PROFILES_KEY = 'chess-openings-profiles-v1';
// Прогресс первого профиля лежит под прежним ключом — у тех, кто уже занимался, ничего не теряется.
const progressKey = (id) => (id === 'p1' ? KEY : `${KEY}:${id}`);

// Интервалы повторений по «коробкам» Лейтнера, в днях.
export const INTERVALS = [0, 1, 3, 7, 14, 30, 60];
export const MAX_BOX = INTERVALS.length - 1;
export const LEARNED_BOX = 4;
export const DAILY_GOAL = 60;

export const RANKS = [
  'Новичок',
  'Ученик',
  'Любитель',
  'Третий разряд',
  'Второй разряд',
  'Первый разряд',
  'Кандидат в мастера',
  'Мастер ФИДЕ',
  'Международный мастер',
  'Гроссмейстер',
  'Чемпион мира',
];

function emptyProgress() {
  return { v: 1, updatedAt: 0, xp: 0, days: {}, cards: {}, learned: {}, quizBest: 0, achievements: {} };
}

const DEFAULT_SETTINGS = {
  sound: true,
  threats: true,
  hints: true,
  drillText: true,
  syncKey: '',
  lichessToken: '',
  githubToken: '',
  gistId: '',
};

const DEFAULT_PROFILES = {
  active: 'p1',
  list: [
    { id: 'p1', name: 'Олег', emoji: '👨', renamedAt: 0 },
    { id: 'p2', name: 'Сабина', emoji: '👩', renamedAt: 0 },
  ],
};
export const AVATARS = ['👨', '👩', '🧑', '👧', '👦', '🧔', '👱‍♀️', '🦊', '🐱', '🐻', '🦁', '🐼'];

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим или переполнение — работаем в памяти */
  }
}

export let settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
export let profiles = load(PROFILES_KEY, DEFAULT_PROFILES);
if (!profiles.list.find((x) => x.id === profiles.active)) profiles.active = profiles.list[0].id;
export let progress = load(progressKey(profiles.active), emptyProgress());

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export function save() {
  progress.updatedAt = Date.now();
  persist(progressKey(profiles.active), progress);
  notify();
  schedulePush();
}

// ─── профили ───

export function activeProfile() {
  return profiles.list.find((x) => x.id === profiles.active) || profiles.list[0];
}

// Прогресс любого профиля (для списка «кто занимается»).
export function progressOf(id) {
  return id === profiles.active ? progress : load(progressKey(id), emptyProgress());
}

export function switchProfile(id) {
  if (id === profiles.active || !profiles.list.find((x) => x.id === id)) return;
  profiles = { ...profiles, active: id };
  persist(PROFILES_KEY, profiles);
  progress = load(progressKey(id), emptyProgress());
  notify();
  pull();
}

export function renameProfile(id, name, emoji) {
  profiles = {
    ...profiles,
    list: profiles.list.map((x) => (x.id === id ? { ...x, name: name.trim().slice(0, 24) || x.name, emoji: emoji || x.emoji, renamedAt: Date.now() } : x)),
  };
  persist(PROFILES_KEY, profiles);
  notify();
  schedulePush();
}

export function saveSettings(patch) {
  settings = { ...settings, ...patch };
  persist(SETTINGS_KEY, settings);
}

// ─── даты ───

export function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dateKey(d);
}

function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysUntil(key) {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

// ─── опыт и уровни ───

export function levelInfo(xp = progress.xp) {
  // Уровень L требует 100·L·(L−1)/2 опыта: 0, 100, 300, 600, 1000…
  let level = 1;
  while (100 * ((level + 1) * level) / 2 <= xp) level++;
  const base = (100 * level * (level - 1)) / 2;
  const next = (100 * (level + 1) * level) / 2;
  return {
    level,
    rank: RANKS[Math.min(level - 1, RANKS.length - 1)],
    into: xp - base,
    need: next - base,
  };
}

export function addXp(amount) {
  progress.xp += amount;
  const t = today();
  progress.days[t] = (progress.days[t] || 0) + amount;
}

export function todayXp() {
  return progress.days[today()] || 0;
}

export function streak() {
  let n = 0;
  let offset = progress.days[today()] ? 0 : -1;
  while (progress.days[today(offset)]) {
    n++;
    offset--;
  }
  return n;
}

// ─── карточки (линии) ───

export function card(lineId) {
  return progress.cards[lineId];
}

export function lineStatus(lineId) {
  const c = progress.cards[lineId];
  if (!c) return progress.learned[lineId] ? 'new' : 'none';
  if (c.box >= LEARNED_BOX) return 'mastered';
  return 'learning';
}

export function isDue(lineId) {
  const c = progress.cards[lineId];
  return !!c && c.due <= today();
}

export function dueLines() {
  return allLines()
    .filter(({ line }) => isDue(line.id))
    .sort((a, b) => progress.cards[a.line.id].due.localeCompare(progress.cards[b.line.id].due));
}

export function strength(lineId) {
  const c = progress.cards[lineId];
  return c ? c.box / MAX_BOX : 0;
}

export function markLearned(lineId) {
  const first = !progress.learned[lineId];
  if (first) progress.learned[lineId] = Date.now();
  if (!progress.cards[lineId]) {
    progress.cards[lineId] = { box: 0, due: today(), reps: 0, lapses: 0, last: Date.now(), best: null };
  }
  const xp = first ? 30 : 10;
  addXp(xp);
  const unlocked = checkAchievements();
  save();
  return { xp, first, unlocked };
}

// Результат тренировки: mistakes — ошибки, hints — подсказки «показать ход».
export function recordDrill(lineId, mistakes, hints) {
  const errors = mistakes + hints;
  let c = progress.cards[lineId];
  if (!c) {
    c = progress.cards[lineId] = { box: 0, due: today(), reps: 0, lapses: 0, last: 0, best: null };
    progress.learned[lineId] = progress.learned[lineId] || Date.now();
  }
  const wasDue = c.due <= today();
  const before = c.box;

  if (errors === 0) {
    // Повтор раньше срока без ошибок не двигает карточку — иначе можно «накрутить» память.
    if (wasDue || c.box === 0) c.box = Math.min(MAX_BOX, c.box + 1);
    if (wasDue || c.box === 1) c.due = today(INTERVALS[c.box]);
  } else if (errors === 1) {
    c.box = Math.max(1, c.box);
    c.due = today(Math.max(1, Math.floor(INTERVALS[c.box] / 2)));
  } else {
    if (c.box > 1) c.lapses++;
    c.box = 1;
    c.due = today(1);
  }
  c.reps++;
  c.last = Date.now();
  c.best = c.best === null ? errors : Math.min(c.best, errors);

  let xp = 15;
  if (errors === 0) xp += 10;
  if (wasDue) xp += 10;
  addXp(xp);

  if (errors === 0) progress.perfectDrills = (progress.perfectDrills || 0) + 1;

  const unlocked = checkAchievements();
  save();
  return { xp, wasDue, before, after: c.box, due: c.due, stars: starsFor(errors), unlocked };
}

export function starsFor(errors) {
  if (errors === 0) return 3;
  if (errors === 1) return 2;
  if (errors <= 3) return 1;
  return 0;
}

export function recordQuiz(correct, total) {
  const xp = correct * 5;
  addXp(xp);
  progress.quizBest = Math.max(progress.quizBest || 0, correct);
  if (correct === total) progress.quizPerfect = (progress.quizPerfect || 0) + 1;
  const unlocked = checkAchievements();
  save();
  return { xp, unlocked };
}

// Средняя «сила памяти» по дебюту (0..1).
export function openingStrength(opening) {
  const s = opening.lines.map((l) => strength(l.id));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

export function openingStatus(opening) {
  const st = opening.lines.map((l) => lineStatus(l.id));
  if (st.every((s) => s === 'mastered')) return 'mastered';
  if (st.every((s) => s === 'none')) return 'none';
  return 'learning';
}

// Что учить дальше: первый не начатый вариант, от простого к сложному.
export function suggestNext() {
  const candidates = [];
  for (const o of OPENINGS) {
    for (const l of o.lines) {
      if (lineStatus(l.id) === 'none') candidates.push({ opening: o, line: l });
    }
  }
  candidates.sort(
    (a, b) =>
      a.opening.difficulty - b.opening.difficulty ||
      b.opening.popularity - a.opening.popularity ||
      a.opening.lines.indexOf(a.line) - b.opening.lines.indexOf(b.line),
  );
  return candidates[0] || null;
}

// ─── достижения ───

export const ACHIEVEMENTS = [
  { id: 'first-line', icon: '🌱', name: 'Первый шаг', desc: 'Изучи первый вариант' },
  { id: 'first-drill', icon: '🎯', name: 'Без ошибок', desc: 'Пройди тренировку без единой ошибки' },
  { id: 'streak-3', icon: '🔥', name: 'В ритме', desc: 'Занимайся 3 дня подряд' },
  { id: 'streak-7', icon: '⚡', name: 'Неделя силы', desc: 'Занимайся 7 дней подряд' },
  { id: 'streak-30', icon: '🏆', name: 'Железная привычка', desc: 'Занимайся 30 дней подряд' },
  { id: 'white-3', icon: '♔', name: 'Белый рыцарь', desc: 'Изучи 3 дебюта за белых' },
  { id: 'black-3', icon: '♚', name: 'Чёрная пантера', desc: 'Изучи 3 дебюта за чёрных' },
  { id: 'traps-all', icon: '🪤', name: 'Ловец', desc: 'Изучи все ловушки' },
  { id: 'mastered-1', icon: '🐘', name: 'Память слона', desc: 'Доведи вариант до статуса «выучено»' },
  { id: 'mastered-10', icon: '🧠', name: 'Библиотека в голове', desc: 'Выучи 10 вариантов' },
  { id: 'quiz-perfect', icon: '💯', name: 'Знаток', desc: 'Ответь на все вопросы викторины' },
  { id: 'all-lines', icon: '📚', name: 'Энциклопедист', desc: 'Изучи все варианты в приложении' },
  { id: 'level-5', icon: '⭐', name: 'Разрядник', desc: 'Достигни 5 уровня' },
];

function learnedOpenings(category) {
  return OPENINGS.filter(
    (o) => o.category === category && o.lines.some((l) => progress.learned[l.id]),
  ).length;
}

function checkAchievements() {
  const has = (id) => progress.achievements[id];
  const s = streak();
  const lines = allLines();
  const mastered = lines.filter(({ line }) => lineStatus(line.id) === 'mastered').length;
  const conditions = {
    'first-line': Object.keys(progress.learned).length >= 1,
    'first-drill': (progress.perfectDrills || 0) >= 1,
    'streak-3': s >= 3,
    'streak-7': s >= 7,
    'streak-30': s >= 30,
    'white-3': learnedOpenings('white') >= 3,
    'black-3': learnedOpenings('black') >= 3,
    'traps-all': OPENINGS.filter((o) => o.category === 'trap').every((o) =>
      o.lines.every((l) => progress.learned[l.id]),
    ),
    'mastered-1': mastered >= 1,
    'mastered-10': mastered >= 10,
    'quiz-perfect': (progress.quizPerfect || 0) >= 1,
    'all-lines': lines.every(({ line }) => progress.learned[line.id]),
    'level-5': levelInfo().level >= 5,
  };
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!has(a.id) && conditions[a.id]) {
      progress.achievements[a.id] = Date.now();
      unlocked.push(a);
    }
  }
  return unlocked;
}

// ─── экспорт / импорт / сброс ───

export function exportProgress() {
  return JSON.stringify(progress);
}

export function importProgress(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.cards) throw new Error('Неверный формат');
  progress = merge(progress, data);
  save();
}

export function resetProgress() {
  progress = emptyProgress();
  save();
}

// ─── синхронизация с сервером ───

// Объединение двух копий прогресса: по каждой карточке берём более свежую.
export function merge(a, b) {
  const out = emptyProgress();
  out.xp = Math.max(a.xp || 0, b.xp || 0);
  out.quizBest = Math.max(a.quizBest || 0, b.quizBest || 0);
  out.quizPerfect = Math.max(a.quizPerfect || 0, b.quizPerfect || 0);
  out.perfectDrills = Math.max(a.perfectDrills || 0, b.perfectDrills || 0);
  for (const src of [a, b]) {
    for (const [d, x] of Object.entries(src.days || {})) out.days[d] = Math.max(out.days[d] || 0, x);
    for (const [id, t] of Object.entries(src.learned || {})) {
      out.learned[id] = out.learned[id] ? Math.min(out.learned[id], t) : t;
    }
    for (const [id, t] of Object.entries(src.achievements || {})) {
      out.achievements[id] = out.achievements[id] ? Math.min(out.achievements[id], t) : t;
    }
    for (const [id, c] of Object.entries(src.cards || {})) {
      const cur = out.cards[id];
      if (!cur || (c.last || 0) > (cur.last || 0)) out.cards[id] = { ...c };
    }
  }
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}

let serverAvailable = null;
let pushTimer = null;
let syncing = null;
export const syncState = { status: 'off', message: '' };

export async function checkServer() {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    serverAvailable = r.ok && (await r.json()).sync === true;
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

function setSync(status, message = '') {
  syncState.status = status;
  syncState.message = message;
  notify();
}

const timeNow = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// Получить свежий прогресс с другого устройства и отправить объединённый.
// Несколько одновременных вызовов превращаются в один.
export function pull() {
  if (syncing) return syncing;
  const run = (async () => {
    // сначала отдаём управление: иначе при мгновенном завершении finally сработал бы
    // раньше, чем syncing = run, и синхронизация «зависла» бы навсегда
    await null;
    try {
      if (settings.githubToken) await githubSync();
      else if (settings.syncKey && (await checkServer())) await serverSync();
      else setSync('off');
    } catch (e) {
      setSync('error', `Ошибка синхронизации: ${e.message}`);
    } finally {
      syncing = null;
    }
  })();
  syncing = run;
  return run;
}

function schedulePush() {
  if (!settings.githubToken && !settings.syncKey) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pull, settings.githubToken ? 3000 : 1500);
}

// ─── свой сервер: прогресс текущего профиля по секретной фразе ───

const serverKey = () => (profiles.active === 'p1' ? settings.syncKey : `${settings.syncKey}::${profiles.active}`);

async function serverSync() {
  setSync('busy', 'Синхронизация…');
  const headers = { 'X-Sync-Key': encodeURIComponent(serverKey()) };
  const r = await fetch('api/progress', { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const remote = await r.json();
  if (remote && remote.cards) {
    progress = merge(progress, remote);
    persist(progressKey(profiles.active), progress);
  }
  const w = await fetch('api/progress', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(progress) });
  if (!w.ok) throw new Error(`HTTP ${w.status}`);
  setSync('ok', `Синхронизировано в ${timeNow()}`);
}

// ─── GitHub: все профили в одном приватном гисте ───

export const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=' + encodeURIComponent('Шахматные дебюты: синхронизация');
const GIST_FILE = 'chess-openings-progress.json';
const GIST_DESC = 'Шахматные дебюты — прогресс (синхронизация телефона и ноутбука)';

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.githubToken}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (r.status === 401) throw new Error('GitHub не принял токен — проверь его или создай новый');
  if (r.status === 403) throw new Error('у токена нет права на гисты (нужна галочка «gist»)');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  return r.json();
}

// Ищем свой гист среди гистов пользователя (на новом устройстве известен только токен).
async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = (await gh(`/gists?per_page=100&page=${page}`)) || [];
    const g = list.find((x) => x.files && x.files[GIST_FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return '';
}

function localDoc() {
  const doc = { app: 'chess-openings', v: 2, profiles: {} };
  for (const p of profiles.list) doc.profiles[p.id] = { name: p.name, emoji: p.emoji, renamedAt: p.renamedAt || 0, progress: progressOf(p.id) };
  return doc;
}

// Объединить копию с GitHub с тем, что на устройстве: прогресс — по каждому профилю, имена — более свежие.
function absorb(doc) {
  if (!doc || !doc.profiles) return;
  let list = profiles.list;
  for (const [id, rp] of Object.entries(doc.profiles)) {
    if (!rp || !rp.progress) continue;
    const merged = merge(progressOf(id), rp.progress);
    persist(progressKey(id), merged);
    if (id === profiles.active) progress = merged;
    const local = list.find((x) => x.id === id);
    if (!local) list = [...list, { id, name: rp.name || id, emoji: rp.emoji || '🧑', renamedAt: rp.renamedAt || 0 }];
    else if ((rp.renamedAt || 0) > (local.renamedAt || 0)) list = list.map((x) => (x.id === id ? { ...x, name: rp.name, emoji: rp.emoji, renamedAt: rp.renamedAt } : x));
  }
  profiles = { ...profiles, list };
  persist(PROFILES_KEY, profiles);
}

async function githubSync() {
  setSync('busy', 'Синхронизация с GitHub…');
  let id = settings.gistId;
  let gist = id ? await gh(`/gists/${id}`) : null;
  if (!gist) {
    id = await findGist();
    gist = id ? await gh(`/gists/${id}`) : null;
  }
  let remoteText = '';
  if (gist && gist.files[GIST_FILE]) {
    const f = gist.files[GIST_FILE];
    remoteText = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
    try {
      absorb(JSON.parse(remoteText));
    } catch {
      /* испорченный файл — перезапишем своим */
    }
  }
  const text = JSON.stringify(localDoc());
  if (text !== remoteText) {
    const body = JSON.stringify({ description: GIST_DESC, files: { [GIST_FILE]: { content: text } } });
    if (gist) await gh(`/gists/${id}`, { method: 'PATCH', body });
    else {
      const created = await gh('/gists', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), public: false }) });
      id = created.id;
    }
  }
  if (id !== settings.gistId) saveSettings({ gistId: id });
  setSync('ok', `Синхронизировано в ${timeNow()}`);
}

// Подключить GitHub на этом устройстве (токен — из настроек или из ссылки с другого устройства).
export async function connectGithub(token) {
  saveSettings({ githubToken: token.trim(), gistId: '' });
  await pull();
  return syncState.status !== 'error';
}

export function disconnectGithub() {
  saveSettings({ githubToken: '', gistId: '' });
  setSync('off');
}

export { findLine, lineSide };
