// Браузерные проверки: поднимает приложение (server.js) и по очереди запускает сценарии из этой папки.
//   npm run e2e                 — все сценарии
//   npm run e2e -- free pick    — только выбранные
//   BASE_URL=https://nelegali.github.io/chess/ npm run e2e -- nested   — проверить опубликованный сайт
// Нужен Playwright с Chromium: npm install && npx playwright install chromium
// Скриншоты — в tests/e2e/out/.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const PORT = process.env.E2E_PORT || '8099';
const external = !!process.env.BASE_URL;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}/`;
const TIMEOUT = 6 * 60 * 1000;

const all = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && !['run.mjs', 'lib.mjs'].includes(f))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !all.includes(n));
if (unknown.length) {
  console.error(`Нет таких сценариев: ${unknown.join(', ')}. Есть: ${all.join(', ')}`);
  process.exit(2);
}
const names = wanted.length ? wanted : all;

let server = null;
if (!external) {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    if (i > 50) {
      console.error(`Сервер не поднялся на ${BASE}`);
      server.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [`${here}${name}.mjs`], { cwd: here, env: { ...process.env, BASE_URL: BASE } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      out += '\n(превышено время)';
      child.kill();
    }, TIMEOUT);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ name, ok: code === 0, out, ms: Date.now() - started });
    });
  });
}

const failed = [];
for (const name of names) {
  const r = await run(name);
  const last = r.out.trim().split('\n').slice(-1)[0] || '';
  console.log(`${r.ok ? '✓' : '✗'} ${name.padEnd(10)} ${(r.ms / 1000).toFixed(1).padStart(5)} с  ${last.slice(0, 110)}`);
  if (!r.ok) failed.push(r);
}
server?.kill();

for (const r of failed) console.log(`\n──── ${r.name} ────\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
console.log(failed.length ? `\n✗ не прошло: ${failed.map((r) => r.name).join(', ')}` : `\n✓ все сценарии прошли: ${names.length}`);
process.exit(failed.length ? 1 : 0);
