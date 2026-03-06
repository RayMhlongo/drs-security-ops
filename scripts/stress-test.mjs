import { performance } from 'node:perf_hooks';

const guards = 400;
const rows = 5000;

const attendance = Array.from({ length: rows }).map((_, i) => ({
  guardUid: `g_${i % guards}`,
  mode: i % 2 === 0 ? 'IN' : 'OUT',
  branchId: i % 3 === 0 ? 'branch-a' : 'branch-b',
  createdAt: Date.now() - i * 1000
}));

const incidents = Array.from({ length: rows }).map((_, i) => ({
  branchId: i % 3 === 0 ? 'branch-a' : 'branch-b',
  createdAt: Date.now() - i * 900
}));

const patrol = Array.from({ length: rows }).map((_, i) => ({
  branchId: i % 3 === 0 ? 'branch-a' : 'branch-b',
  createdAt: Date.now() - i * 800
}));

const t0 = performance.now();
const active = new Set(attendance.filter((x) => x.mode === 'IN').map((x) => x.guardUid));
const today = new Date().toISOString().slice(0, 10);
const incidentsToday = incidents.filter((x) => new Date(x.createdAt).toISOString().startsWith(today)).length;
const patrolRate = Math.min(100, Math.round((patrol.length / 40) * 100));
const ms = performance.now() - t0;

console.log(JSON.stringify({ activeGuards: active.size, incidentsToday, patrolRate, processedRows: rows * 3, durationMs: Number(ms.toFixed(2)) }, null, 2));
if (ms > 500) {
  process.exit(1);
}
