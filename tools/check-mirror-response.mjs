/**
 * 判定：电机上显示的角度，是否真的反映到了对应镜片的姿态上。
 *
 * 做法：把某个执行器从 0 变到已知值，记录该镜片网格的世界四元数变化，
 * 换算成"姿态实际转过的角度"，与该轴执行器角对比。
 *
 * 用法：node tools/check-mirror-response.mjs
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
    let target = null;
    optics.traverse((o) => {
      if (!target && o.userData?.partId === partId && o.isMesh) target = o;
    });
    if (!target) return null;
    // 用现成的 Quaternion / Vector3 实例做容器，避免依赖构造函数签名
    const q = target.getWorldQuaternion(target.quaternion.clone());
    const p = target.getWorldPosition(target.position.clone());
    return { q: [q.x, q.y, q.z, q.w], p: [p.x, p.y, p.z] };
  };
});

const ids = ['z-galvo', 'z-fold', 'galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out'];

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
    return { actuators: s.actuators, hits: s.trace.hits.map((h) => ({ id: h.mirrorId, n: h.normal.toArray() })) };
  });
  const poses = {};
  for (const id of ids) {
    const pose = await page.evaluate((i) => window.__probe(i), id);
    poses[id] = pose;
  }
  const motorAngles = await page.evaluate(() => {
    const out = {};
    window.__PRECSYS__.groups.optics.traverse((o) => {
      if (o.userData?.motorAxis) out[o.userData.motorAxis] = (o.userData.angleRad * 180) / Math.PI;
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

console.log('Z 执行器角：', moved.snap.actuators.zDeg.toFixed(3), '°');
console.log('电机显示角：', JSON.stringify(moved.motorAngles, null, 0));
console.log('\n部件            网格姿态变化     位置变化(mm)    trace 法向变化');
for (const id of ids) {
  const a = zero.poses[id];
  const b = moved.poses[id];
  const na = zero.snap.hits.find((h) => h.id === id)?.n;
  const nb = moved.snap.hits.find((h) => h.id === id)?.n;
  const normalDelta = na && nb
    ? ((Math.acos(Math.min(1, Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]))) * 180) / Math.PI).toFixed(3)
    : '—';
  const posDelta = a && b
    ? Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]).toFixed(3)
    : '—';
  console.log(
    `${id.padEnd(18)} ${a && b ? quatDelta(a.q, b.q).toFixed(3).padStart(8) : '   —   '}°   ${String(posDelta).padStart(8)}   ${String(normalDelta).padStart(8)}°`,
  );
}

await browser.close();
