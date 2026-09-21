/**
 * 执行器外形与执行器量的绑定核对（教学模型，`dist/index.html`）。
 *
 * 当前设计是 **5 个执行轴**：
 *   - X / Y / α / β：四个旋转振镜电机（`createGalvoMotor`，`userData.motorAxis` 为轴名、
 *     `userData.angleRad` 为显示角）；
 *   - Z：直线调焦台（`createFocusStage`，`userData.travelMm` 为行程，标签为
 *     `L1/L2/L3` 镜片位移）。**Z 是直线运动，不是振镜旋转**，因此不参与角度比对。
 *
 * 检查四件事，任一条不成立即退出码 1：
 *   1. 四个振镜电机的显示角 = 对应执行器角（X → xRad，Y → yRad，α → alphaRad，β → betaRad）；
 *   2. 各镜片在追迹里的实际转角（由本帧 trace 法向与名义法向求出）与执行器角一致；
 *   3. Z 台的 `travelMm` 与快照里的 `zTravelMm` 一致；
 *   4. 电机装在镜片位置上：电机转轴所在直线到镜心的距离 ≈ 0（**世界坐标**）。
 *
 * 第 4 条必须用世界位置：电机组是挂在镜片组下的子组，其 `position` 是局部坐标，
 * 直接拿局部位置比镜心会得到毫无意义的偏差。
 *
 * 用法：node tools/check-motors.mjs
 * 输出：JSON 报告 + 一张 Z 模块特写（screenshots/z-motor-check.png，该目录不入库）。
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => window.__PRECSYS__);
await page.waitForTimeout(1200);

// 给各轴已知的非零工程量，让执行器都动起来
await page.evaluate(() => {
  const { state } = window.__PRECSYS__;
  state.setMode('axes');
  state.setAxisDemo('none');
  state.setCommand({ xMm: 1.2, yMm: -1.2, zMm: 1, alphaDeg: 6, betaDeg: -6 });
});
// 等几帧：执行器位姿是在渲染循环里更新的
await page.waitForTimeout(800);

const report = await page.evaluate(() => {
  const api = window.__PRECSYS__;
  const { state, groups } = api;
  const snap = state.snapshot();
  // 注意：snapshot().actuators / .trace 都是 { vendor, ... } 包装层
  const a = snap.actuators.actuators;
  const trace = snap.trace.trace;
  const deg = (rad) => (rad * 180) / Math.PI;

  /** 旋转执行轴 → 该轴电机应显示的角度。Z 是直线台，单独核对。 */
  const expectedAngle = { X: deg(a.xRad), Y: deg(a.yRad), α: deg(a.alphaRad), β: deg(a.betaRad) };
  /** 电机轴名 → 所属镜片 id。 */
  const motorToMirror = { X: 'galvo-x', Y: 'galvo-y', α: 'alpha-movable-in', β: 'beta-movable-in' };

  const mirrorById = new Map(state.train.mirrors.map((m) => [m.id, m]));
  const hitsById = {};
  for (const hit of trace.hits) hitsById[hit.mirrorId] = hit;

  /** 由名义法向与 trace 法向求**带符号**转角（绕该镜片自身转轴，右手为正）。 */
  const signedRotationDeg = (id) => {
    const spec = mirrorById.get(id);
    const hit = hitsById[id];
    if (!spec || !hit) return null;
    const axis = (spec.rotationAxis ?? spec.v).clone().normalize();
    const n0 = spec.normal.clone().normalize();
    const n1 = hit.normal.clone().normalize();
    return Number(((Math.atan2(n1.clone().crossVectors(n0, n1).dot(axis), n0.dot(n1)) * 180) / Math.PI).toFixed(4));
  };
  const angleBetween = (u, v) => {
    const c = Math.min(1, Math.max(-1, u.clone().normalize().dot(v.clone().normalize())));
    return Number(((Math.acos(c) * 180) / Math.PI).toFixed(4));
  };

  // 世界矩阵先刷新，否则 getWorldPosition 读到的是上一帧
  groups.optics.updateMatrixWorld(true);

  const motors = [];
  let focusStage = null;
  groups.optics.traverse((object) => {
    const axisName = object.userData?.motorAxis;
    if (axisName === undefined) return;
    if (axisName === 'Z') {
      focusStage = {
        node: object.name || object.type,
        travelMm: object.userData.travelMm ?? null,
        expectedTravelMm: Number(a.zTravelMm.toFixed(5)),
        // 镜片位移标签：L1/L3 应随行程变化，L2 固定
        lensLabels: [...document.querySelectorAll('.motor-label')]
          .map((element) => element.textContent?.trim() ?? '')
          .filter((text) => text.startsWith('L')),
      };
      return;
    }
    const mirrorId = motorToMirror[axisName] ?? null;
    const spec = mirrorId ? mirrorById.get(mirrorId) : null;
    const worldPosition = object.getWorldPosition(object.position.clone());
    // 电机转轴所在直线到镜心的距离
    let axisOffsetMm = null;
    if (spec?.rotationAxis) {
      const axis = spec.rotationAxis.clone().normalize();
      const delta = spec.center.clone().sub(worldPosition);
      axisOffsetMm = Number(delta.addScaledVector(axis, -delta.dot(axis)).length().toFixed(4));
    }
    motors.push({
      axisName,
      mirrorId,
      displayedAngleDeg: Number(deg(object.userData.angleRad).toFixed(4)),
      expectedAngleDeg: axisName in expectedAngle ? Number(expectedAngle[axisName].toFixed(4)) : null,
      worldPosition: worldPosition.toArray().map((v) => Number(v.toFixed(3))),
      offsetFromMirrorCenterMm: axisOffsetMm,
      traceSignedAngleDeg: mirrorId ? signedRotationDeg(mirrorId) : null,
    });
  });

  const actingMirrors = ['galvo-x', 'galvo-y', 'alpha-movable-in', 'alpha-movable-out', 'beta-movable-in', 'beta-movable-out'];
  const mirrorAngles = actingMirrors
    .filter((id) => hitsById[id] && mirrorById.has(id))
    .map((id) => ({
      id,
      traceAngleDeg: angleBetween(hitsById[id].normal, mirrorById.get(id).normal),
      signedDeg: signedRotationDeg(id),
      hitPoint: hitsById[id].point.toArray().map((v) => Number(v.toFixed(2))),
    }));

  return {
    actuators: { X: deg(a.xRad), Y: deg(a.yRad), Z: a.zTravelMm, α: deg(a.alphaRad), β: deg(a.betaRad) },
    motors,
    focusStage,
    mirrorAngles,
  };
});

console.log(JSON.stringify(report, null, 2));

// ---- 断言 ----
const failures = [];
const ANGLE_TOL = 1e-3;   // 角度容差（度）
const CENTER_TOL = 0.01;  // 转轴到镜心的距离容差（mm）
const TRAVEL_TOL = 1e-3;  // Z 行程容差（mm）

for (const m of report.motors) {
  if (m.expectedAngleDeg !== null && Math.abs(m.displayedAngleDeg - m.expectedAngleDeg) > ANGLE_TOL) {
    failures.push(`${m.axisName}: 显示角 ${m.displayedAngleDeg}° ≠ 执行器角 ${m.expectedAngleDeg}°`);
  }
  if (m.offsetFromMirrorCenterMm !== null && m.offsetFromMirrorCenterMm > CENTER_TOL) {
    failures.push(`${m.axisName}: 转轴偏离镜心 ${m.offsetFromMirrorCenterMm} mm（应 ≤ ${CENTER_TOL}）`);
  }
  if (m.traceSignedAngleDeg !== null && m.expectedAngleDeg !== null
    && Math.abs(m.traceSignedAngleDeg - m.expectedAngleDeg) > ANGLE_TOL) {
    failures.push(`${m.axisName}: 镜片实际转角 ${m.traceSignedAngleDeg}° ≠ 执行器角 ${m.expectedAngleDeg}°`);
  }
}
if (!report.focusStage) {
  failures.push('未找到 Z 直线调焦台（userData.motorAxis === "Z"）');
} else if (report.focusStage.travelMm === null) {
  failures.push('Z 台缺少 userData.travelMm');
} else if (Math.abs(report.focusStage.travelMm - report.focusStage.expectedTravelMm) > TRAVEL_TOL) {
  failures.push(`Z 台行程 ${report.focusStage.travelMm} mm ≠ 快照 zTravelMm ${report.focusStage.expectedTravelMm} mm`);
}

// 再拍一张 Z 模块特写，便于肉眼核对执行器位置
await page.evaluate(() => {
  const v = window.__PRECSYS__.sceneView;
  v.camera.position.set(-88, -96, 250);
  v.controls.target.set(-16, -2, 224);
  v.controls.update();
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(root, 'screenshots', 'z-motor-check.png') });

await browser.close();

console.log(`\n执行器外形 ${report.motors.length} 个旋转振镜电机 + ${report.focusStage ? 1 : 0} 个 Z 直线台`);
console.log(`Z 台镜片标签: ${report.focusStage ? JSON.stringify(report.focusStage.lensLabels) : '—'}`);
if (failures.length) {
  console.error(`\n❌ ${failures.length} 项不通过：`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}
console.log('✅ 绑定核对通过：显示角 = 执行器角、镜片实际转角一致、转轴穿过镜心、Z 行程一致');
