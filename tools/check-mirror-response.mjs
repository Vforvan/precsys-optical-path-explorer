/**
 * 响应核对：某轴变化时，**哪些部件真的动了**（教学模型，`dist/index.html`）。
 *
 * 做法：把某个执行器从零位变到已知值（默认 Z = 1 mm），记录各部件网格的世界四元数与
 * 世界位置变化，并与该轴执行器量对照。用来回答"电机转了，镜片/镜片组真的跟着动了吗"。
 *
 * 当前设计要点：
 *   - X/Y/α/β 是旋转振镜，绕自身转轴转动；
 *   - **Z 是直线调焦台**：`z-l1`/`z-l3` 两片透镜沿轴平移，`z-l2` 是固定凹透镜，不动；
 *   - `snapshot().actuators` 与 `snapshot().trace` 都是 `{ vendor, ... }` 包装层，
 *     真正的执行器量与追迹结果在 `.actuators` / `.trace` 下。
 *
 * 用法：node tools/check-mirror-response.mjs
 * 失败（例如 Z 命令下应动的镜片没动）时退出码 1。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = pathToFileURL(join(root, 'dist', 'index.html')).href;

const args = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
async function launch() {
  for (const options of [{ args }, { channel: 'msedge', args }, { channel: 'chrome', args }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* next */
    }
  }
  throw new Error('no browser');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto(url);
await page.waitForFunction(() => window.__PRECSYS__);
await page.waitForTimeout(900);

/** 在页面里注入一个"取某部件世界姿态"的函数（按 userData.partId 找网格）。 */
await page.evaluate(() => {
  window.__probe = (partId) => {
    const optics = window.__PRECSYS__.groups.optics;
    optics.updateMatrixWorld(true);
    let target = null;
    optics.traverse((o) => {
      if (!target && o.userData?.partId === partId && o.isMesh) target = o;
    });
    if (!target) return null;
    const q = target.getWorldQuaternion(target.quaternion.clone());
    const p = target.getWorldPosition(target.position.clone());
    return { q: [q.x, q.y, q.z, q.w], p: [p.x, p.y, p.z] };
  };
});

/** 需要跟踪的部件：四个振镜镜片 + Z 台三片透镜。 */
const ids = ['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'z-l1', 'z-l2', 'z-l3'];

async function sample(label, command) {
  await page.evaluate((c) => {
    const { state } = window.__PRECSYS__;
    state.setMode('axes');
    state.setAxisDemo('none');
    state.setCommand(c);
  }, command);
  await page.waitForTimeout(700);
  const snap = await page.evaluate(() => {
    const s = window.__PRECSYS__.state.snapshot();
    // 包装层：真正的执行器量与追迹结果分别在 .actuators / .trace 下
    return {
      actuators: s.actuators.actuators,
      hits: s.trace.trace.hits.map((h) => ({ id: h.mirrorId, n: h.normal.toArray() })),
    };
  });
  const poses = {};
  for (const id of ids) poses[id] = await page.evaluate((i) => window.__probe(i), id);
  const motorAngles = await page.evaluate(() => {
    const out = {};
    window.__PRECSYS__.groups.optics.traverse((o) => {
      const axis = o.userData?.motorAxis;
      if (axis === undefined) return;
      if (axis === 'Z') out.Z = o.userData.travelMm ?? null;
      else out[axis] = (o.userData.angleRad * 180) / Math.PI;
    });
    return out;
  });
  return { label, snap, poses, motorAngles };
}

const zero = await sample('零位', { xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
const moved = await sample('Z=1mm', { xMm: 0, yMm: 0, zMm: 1, alphaDeg: 0, betaDeg: 0 });

/** 两个四元数之间的夹角（度）。 */
function quatDelta(a, b) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

console.log(`Z 执行器行程：${moved.snap.actuators.zTravelMm.toFixed(3)} mm`);
console.log(`执行器读数：${JSON.stringify(moved.motorAngles)}`);
console.log('\n部件                姿态变化      位置变化(mm)    trace 法向变化');
const deltas = {};
for (const id of ids) {
  const a = zero.poses[id];
  const b = moved.poses[id];
  const na = zero.snap.hits.find((h) => h.id === id)?.n;
  const nb = moved.snap.hits.find((h) => h.id === id)?.n;
  const normalDelta = na && nb
    ? ((Math.acos(Math.min(1, Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]))) * 180) / Math.PI)
    : null;
  const posDelta = a && b ? Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) : null;
  deltas[id] = { quat: a && b ? quatDelta(a.q, b.q) : null, pos: posDelta };
  console.log(
    `${id.padEnd(18)} ${a && b ? quatDelta(a.q, b.q).toFixed(3).padStart(8) : '   —   '}°   ${(posDelta === null ? '—' : posDelta.toFixed(3)).padStart(8)}   ${(normalDelta === null ? '—' : normalDelta.toFixed(3)).padStart(8)}°`,
  );
}

await browser.close();

// ---- 断言：Z 命令下哪些该动、哪些不该动 ----
const failures = [];
const MOVED_TOL = 0.05;   // 位置变化阈值（mm）
const STILL_TOL = 1e-4;   // "应当静止"的阈值
// z-l1 / z-l3 是移动透镜；z-l2 是固定凹透镜（见 create-focus-stage 的标签约定）
if (!(deltas['z-l1']?.pos > MOVED_TOL)) failures.push(`z-l1 在 Z=1mm 下未移动（Δ=${deltas['z-l1']?.pos}）`);
if (!(deltas['z-l3']?.pos > MOVED_TOL)) failures.push(`z-l3 在 Z=1mm 下未移动（Δ=${deltas['z-l3']?.pos}）`);
if (deltas['z-l2']?.pos > STILL_TOL) failures.push(`z-l2 是固定凹透镜，却移动了 ${deltas['z-l2']?.pos} mm`);
for (const id of ['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out']) {
  if (deltas[id]?.pos > MOVED_TOL) failures.push(`${id} 不应随 Z 命令移动（Δ=${deltas[id]?.pos}）`);
}

if (failures.length) {
  console.error(`\n❌ ${failures.length} 项不符合预期：`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}
console.log('\n✅ 响应核对通过：Z 命令只移动 z-l1/z-l3，z-l2 与四个振镜保持不动');
