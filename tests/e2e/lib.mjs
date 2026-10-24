// Общее для браузерных проверок: Playwright, адрес приложения и папка для скриншотов.
// Адрес задаёт run.mjs (сам поднимает server.js) или переменная BASE_URL.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

export { chromium, devices };
export const BASE = (process.env.BASE_URL || 'http://localhost:8099/').replace(/\/?$/, '/');
// Корень репозитория как file:// — для import() модулей приложения (openings.js, chess.js)
export const ROOT_URL = new URL('../../', import.meta.url).href;
// Скриншоты складываются сюда (папка в .gitignore)
export const OUT = fileURLToPath(new URL('./out', import.meta.url));
mkdirSync(OUT, { recursive: true });
