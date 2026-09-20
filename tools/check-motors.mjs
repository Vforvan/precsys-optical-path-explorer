/**
 * 检查五个电机的绑定是否正确：
 *   - 电机显示角（group.userData.angleRad）是否等于该轴执行器角；
 *   - 该镜片在追迹里实际转过的角度（由本帧 trace 的法向与名义法向求出）是否与之一致；
 *   - 电机是否装在该镜片的位置上（转轴是否穿过镜面中心）。
 *
 * 用法：node tools/check-motors.mjs
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = pathToFileURL(join(root, 'dist', 'index.html')).href;
void readFile;

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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => window.__PRECSYS__);
await page.waitForTimeout(1200);

// 给五个轴都一个已知的非零工程量，让电机都动起来
await page.evaluate(() => {
  const { state } = window.__PRECSYS__;
  state.setMode('axes');
  state.setAxisDemo('none');
  state.setCommand({ xMm: 1.2, yMm: -1.2, zMm: 1, alphaDeg: 6, betaDeg: -6 });
});
// 等几帧：电机位姿是在渲染循环里更新的
await page.waitForTimeout(700);

const report = await page.evaluate(() => {
  const api = window.__PRECSYS__;
  const { state, groups } = api;
  state.setMode('axes');
  state.setAxisDemo('none');
  state.setCommand({ xMm: 1.2, yMm: -1.2, zMm: 1, alphaDeg: 6, betaDeg: -6 });
  const snap = state.snapshot();
  const a = snap.actuators.actuators;

  // 名义法向：从 train 里取（angleRad = 0 的那份）
  const nominal = {};
  for (const spec of state.train.mirrors) nominal[spec.id] = spec.normal.clone();

  const found = [];
  groups.optics.traverse((o) => {
    if (o.userData?.motorAxis) found.push(o);
  });

  const angleBetween = (u, v) => {
    const c = Math.min(1, Math.max(-1, u.clone().normalize().dot(v.clone().normalize())));
    return (Math.acos(c) * 180) / Math.PI;
  };

  const motors = found.map((motor) => {
    const axisName = motor.userData.motorAxis;
    const parts = api.__parts ?? [];
    void parts;
    // 找该电机的“归属镜片”：用 worldToLocal 反推——遍历 optics 里 partId 与电机同名轴
    return {
      axisName,
      displayedAngleDeg: (motor.userData.angleRad * 180) / Math.PI,
      position: motor.position.toArray().map((v) => Number(v.toFixed(3))),
    };
  });

  // 各镜片的实际转角（由本帧 trace 法向求得）
  const hitsById = {};
  for (const hit of snap.trace.trace.hits) hitsById[hit.mirrorId] = hit;

  /** 由名义法向与 trace 法向求"带符号"的镜片转角（绕该镜片自身转轴，右手为正）。 */
  const signedRotationDeg = (id) => {
    const spec = state.train.mirrors.find((m) => m.id === id);
    const hit = hitsById[id];
    if (!spec || !hit) return null;
    const axis = (spec.rotationAxis ?? spec.v).clone().normalize();
    const n0 = spec.normal.clone().normalize();
    const n1 = hit.normal.clone().normalize();
    const sin = n1.clone().crossVectors(n0, n1).dot(axis);
    return {
      deg: Number(((Math.atan2(sin, n0.dot(n1)) * 180) / Math.PI).toFixed(3)),
      axis: axis.toArray().map((v) => Number(v.toFixed(3))),
    };
  };

  const actingMirrors = ['galvo-x', 'galvo-y', 'z-galvo', 'z-fold', 'alpha-movable-in', 'alpha-movable-out', 'beta-movable-in', 'beta-movable-out'];
  const mirrorAngles = actingMirrors
    .filter((id) => hitsById[id] && nominal[id])
    .map((id) => ({
      id,
      traceAngleDeg: Number(angleBetween(hitsById[id].normal, nominal[id]).toFixed(3)),
      signed: signedRotationDeg(id),
      hitPoint: hitsById[id].point.toArray().map((v) => Number(v.toFixed(2))),
    }));

  return {
    actuatorsDeg: {
      x: (a.xRad * 180) / Math.PI,
      y: (a.yRad * 180) / Math.PI,
      z: a.zTravelMm,
      alpha: (a.alphaRad * 180) / Math.PI,
      beta: (a.betaRad * 180) / Math.PI,
    },
    motors,
    mirrorAngles,
  };
});

console.log(JSON.stringify(report, null, 2));

// 再拍一张 Z 模块特写，便于肉眼核对电机位置
await page.evaluate(() => {
  const v = window.__PRECSYS__.sceneView;
  v.camera.position.set(-88, -96, 250);
  v.controls.target.set(-16, -2, 224);
  v.controls.update();
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(root, 'screenshots', 'z-motor-check.png') });

await browser.close();
