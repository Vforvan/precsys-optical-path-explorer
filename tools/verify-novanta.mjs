/**
 * Novanta / ARGES 模式的浏览器验收脚本。
 *
 * 在真实浏览器里用 file:// 打开 dist/index.html（与用户"双击打开"的方式一致），
 * 逐项核对本任务的验收标准：
 *   1. 页面能启动，SCANLAB 模式没有回归；
 *   2. 技术路线切换器存在并且能切到 Novanta；
 *   3. 两块平行板是带厚度的透明玻璃板（几何体是 Box 且材质是透明的）；
 *   4. 光线真的穿过两块板：玻璃内线段长度 = 板厚，且进出各有折射界面；
 *   5. 单块平行板出射方向与入射方向平行；
 *   6. 两板只做各自正交轴的倾斜，但合位移向量绕光轴旋转（扫一圈相位验证）；
 *   7. Dual-Plate Top View 等快捷视角存在且能切换；
 *   8. 事实边界三类色标、两条路线对照表、已知未知清单都在；
 *   9. 位移轨迹面板画出来了。
 *
 * 用法：node tools/verify-novanta.mjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots', 'novanta');
await mkdir(outDir, { recursive: true });

const args = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--ignore-gpu-blocklist',
];

async function launchBrowser() {
  for (const options of [{ args }, { channel: 'msedge', args }, { channel: 'chrome', args }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* try next */
    }
  }
  throw new Error('无法启动浏览器');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  const mark = ok ? '  ✓' : '  ✗';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(msg.text());
});
page.on('pageerror', (error) => problems.push(String(error)));

const url = pathToFileURL(join(root, 'dist', 'index.html')).href;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// ---------------------------------------------------------------- 1. 启动 + SCANLAB 未回归
const booted = await page.evaluate(() => Boolean(window.__PRECSYS__));
check('file:// 双击打开后页面启动（WebGL 正常）', booted);
if (!booted) {
  console.log('\n控制台错误：', problems.slice(0, 8));
  await browser.close();
  process.exit(1);
}

const startVendor = await page.evaluate(() => window.__PRECSYS__.state.vendor);
check('默认路线仍为 SCANLAB precSYS（原模式未变）', startVendor === 'scanlab', startVendor);

const scanlabHits = await page.evaluate(() => {
  const s = window.__PRECSYS__.state.snapshot();
  return { ok: s.trace.trace.ok, hits: s.trace.trace.hits.length, focus: s.trace.trace.focus.zMm };
});
check('SCANLAB 标称链路可追迹且命中 10 个镜面', scanlabHits.ok && scanlabHits.hits === 10, JSON.stringify(scanlabHits));

// ---------------------------------------------------------------- 2. 切换器存在
const switchButtons = await page.$$eval('#vendor-switch .vendor-button', (nodes) =>
  nodes.map((n) => ({ label: n.querySelector('.vendor-name')?.textContent ?? '', pressed: n.getAttribute('aria-pressed') })),
);
check(
  '顶部有明显的技术路线切换器，含两家条目',
  switchButtons.length === 2 &&
    switchButtons.some((b) => b.label.includes('SCANLAB')) &&
    switchButtons.some((b) => b.label.includes('Novanta')),
  JSON.stringify(switchButtons),
);

// ---------------------------------------------------------------- 3. 切到 Novanta
await page.click('#vendor-switch .vendor-button[data-vendor="novanta"]');
await page.waitForTimeout(1800);
const novantaState = await page.evaluate(() => {
  const s = window.__PRECSYS__.state.snapshot();
  return {
    vendor: s.vendor,
    ok: s.trace.trace.ok,
    segments: s.trace.trace.segments.length,
    glass: s.trace.trace.segments.filter((g) => g.medium === 'glass').map((g) => ({
      len: Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y, g.to.z - g.from.z),
    })),
    focus: [s.trace.trace.focus.xMm, s.trace.trace.focus.yMm, s.trace.trace.focus.zMm],
    aoi: [s.trace.trace.focus.aoiXDeg, s.trace.trace.focus.aoiYDeg],
    plates: s.trace.trace.wobble
      ? {
          directionErrA: s.trace.trace.wobble.poseA.directionDeviationDeg,
          directionErrB: s.trace.trace.wobble.poseB.directionDeviationDeg,
          incidenceA: s.trace.trace.wobble.poseA.incidenceDeg,
          incidenceB: s.trace.trace.wobble.poseB.incidenceDeg,
        }
      : null,
  };
});
check('切换到 Novanta 模式成功', novantaState.vendor === 'novanta');
check(
  'Novanta 标称链路可追迹',
  novantaState.ok === true,
  JSON.stringify(novantaState.focus),
);

/**
 * 标签清理回归：CSS2DRenderer 不会自动移除"已从场景摘掉的分组"里的标签 DOM 节点，
 * 于是切换路线后 SCANLAB 的"α 电机 / L1 移动"会永久叠在 Novanta 的模型上。
 * 这条断言专门钉住那个 bug。
 */
const motorLabels = await page.$$eval('.motor-label', (nodes) => nodes.map((n) => n.textContent ?? ''));
check(
  '切换路线后不残留上一套电机/执行器标签（CSS2D DOM 泄漏回归）',
  motorLabels.length === 5 &&
    motorLabels.every((t) => !/α 电机|β 电机|L1 移动|L2 固定|L3 移动/.test(t)) &&
    motorLabels.some((t) => /平板 A 倾角/.test(t)) &&
    motorLabels.some((t) => /Z 行程/.test(t)),
  JSON.stringify(motorLabels),
);

// 执行器外形开关：只影响外观，不影响光学与读数
const motorToggle = await page.$('.toggle input[type="checkbox"]');
const motorStateBefore = await page.evaluate(() => {
  let visible = 0;
  window.__PRECSYS__.chain().group.traverse((o) => {
    if (o.userData.motorAxis && o.visible) visible += 1;
  });
  return visible;
});
await page.evaluate(() => {
  const input = [...document.querySelectorAll('.toggle input')].find((x) =>
    x.parentElement?.textContent?.includes('执行器外形'),
  );
  input.click();
});
await page.waitForTimeout(700);
const motorStateAfter = await page.evaluate(() => {
  let visible = 0;
  let total = 0;
  window.__PRECSYS__.chain().group.traverse((o) => {
    if (o.userData.motorAxis) {
      total += 1;
      if (o.visible) visible += 1;
    }
  });
  const s = window.__PRECSYS__.state.snapshot();
  return { visible, total, focusZ: s.trace.trace.focus.zMm, travel: s.actuators.actuators.telescopeTravelMm };
});
check(
  '「执行器外形」开关可整体隐藏执行器（0/5 可见）',
  motorStateBefore === 5 && motorStateAfter.visible === 0 && motorStateAfter.total === 5,
  `${motorStateBefore} -> ${motorStateAfter.visible}/${motorStateAfter.total}`,
);
await page.evaluate(() => {
  const input = [...document.querySelectorAll('.toggle input')].find((x) =>
    x.parentElement?.textContent?.includes('执行器外形'),
  );
  input.click();
});
await page.waitForTimeout(400);
void motorToggle;
check(
  '零指令下焦点与 AOI 都为 0',
  novantaState.focus.every((v) => Math.abs(v) < 1e-9) && novantaState.aoi.every((v) => Math.abs(v) < 1e-9),
  `focus=${JSON.stringify(novantaState.focus)} aoi=${JSON.stringify(novantaState.aoi)}`,
);

// ---------------------------------------------------------------- 4. 两块透明玻璃板
const plateInfo = await page.evaluate(() => {
  const chain = window.__PRECSYS__.chain();
  const out = [];
  for (const id of ['novanta-plate-a', 'novanta-plate-b']) {
    const part = chain.parts.find((p) => p.id === id);
    if (!part) continue;
    let mesh = null;
    part.object.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'BoxGeometry' && !mesh) mesh = o;
    });
    const params = mesh?.geometry?.parameters ?? {};
    out.push({
      id,
      geometry: mesh?.geometry?.type ?? null,
      depth: params.depth ?? null,
      width: params.width ?? null,
      transparent: mesh?.material?.transparent ?? null,
      // transmission 是 MeshPhysicalMaterial 的玻璃表现参数
      transmission: mesh?.material?.transmission ?? null,
      ior: mesh?.material?.ior ?? null,
      visible: mesh?.visible ?? null,
    });
  }
  return out;
});
check('存在两块平行平板网格', plateInfo.length === 2, JSON.stringify(plateInfo.map((p) => p.id)));
check(
  '两块板都是**有厚度的透明玻璃板**（Box 几何 + transmission 玻璃材质）',
  plateInfo.length === 2 &&
    plateInfo.every((p) => p.geometry === 'BoxGeometry' && p.depth > 1 && p.transparent === true && p.transmission > 0.5),
  JSON.stringify(plateInfo),
);

// ---------------------------------------------------------------- 5. 光线真实穿过两块板
const thickness = await page.evaluate(() => {
  const chain = window.__PRECSYS__.chain();
  const part = chain.parts.find((p) => p.id === 'novanta-plate-a');
  let mesh = null;
  part.object.traverse((o) => {
    if (o.isMesh && o.geometry?.type === 'BoxGeometry' && !mesh) mesh = o;
  });
  return mesh.geometry.parameters.depth;
});
check(
  '玻璃内每一段的长度等于板厚（光线真的在玻璃里走）',
  novantaState.glass.length === 2 && novantaState.glass.every((g) => Math.abs(g.len - thickness) < 1e-6),
  `segments=${novantaState.glass.length} thickness=${thickness}`,
);

// ---------------------------------------------------------------- 6. 平板出射方向平行
const tiltCheck = await page.evaluate(() => {
  const { state } = window.__PRECSYS__;
  const out = [];
  for (const tilt of [-10, -4, 4, 10]) {
    state.setCommand({ alphaDeg: tilt * 0.18, betaDeg: -tilt * 0.18, xMm: 0, yMm: 0, zMm: 0 });
    const w = state.snapshot().trace.trace.wobble;
    out.push({ tilt, errA: w.poseA.directionDeviationDeg, errB: w.poseB.directionDeviationDeg });
  }
  state.setCommand({ alphaDeg: 0, betaDeg: 0 });
  return out;
});
check(
  '单块（及两块）平行板出射方向与入射方向平行（误差 < 1e-9 度）',
  tiltCheck.every((t) => t.errA < 1e-9 && t.errB < 1e-9),
  JSON.stringify(tiltCheck.map((t) => Math.max(t.errA, t.errB).toExponential(1))),
);

// ---------------------------------------------------------------- 7. 板只做正交轴倾斜、位移向量在转
const orbit = await page.evaluate(() => {
  const { state } = window.__PRECSYS__;
  /**
   * 直接给 α/β 工程量按正交相位驱动，这就是进动的定义：
   *   α(φ) = A·sin φ,  β(φ) = A·cos φ
   * 逆解后两块板各自绕自己的正交轴倾斜。
   */
  state.setAxisDemo('none');
  state.playing = false;
  const amp = 3;
  const samples = [];
  for (let i = 0; i < 24; i += 1) {
    const phi = (i / 24) * 2 * Math.PI;
    state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: amp * Math.sin(phi), betaDeg: amp * Math.cos(phi) });
    const s = state.snapshot();
    const w = s.trace.trace.wobble;
    const a = s.actuators.actuators;
    samples.push({
      tiltA: a.plateARad,
      tiltB: a.plateBRad,
      az: w.offsetAzimuthDeg,
      r: w.offsetRadiusMm,
      // 板法向：A 只应有 y 分量、B 只应有 x 分量（绕正交轴倾斜的特征）
      nAx: w.poseA.normal.x,
      nBy: w.poseB.normal.y,
    });
  }
  state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
  return samples;
});
const azimuths = orbit.map((s) => s.az);
// 方位角是环形量：取相邻采样差的和来判断覆盖范围
let travelled = 0;
for (let i = 1; i < azimuths.length; i += 1) {
  let d = azimuths[i] - azimuths[i - 1];
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  travelled += Math.abs(d);
}
const radii = orbit.map((s) => s.r);
const radiusVariation = (Math.max(...radii) - Math.min(...radii)) / Math.max(...radii);
check(
  '两板都只在倾斜（机械角随时间变化，不是静止）',
  Math.max(...orbit.map((s) => Math.abs(s.tiltA))) > 0.01 &&
    Math.max(...orbit.map((s) => Math.abs(s.tiltB))) > 0.01,
  `Δθ_A=${Math.max(...orbit.map((s) => Math.abs(s.tiltA))).toFixed(4)} rad, Δθ_B=${Math.max(...orbit.map((s) => Math.abs(s.tiltB))).toFixed(4)} rad`,
);
check(
  '板 A 只绕 X 轴倾斜（法向无 x 分量）、板 B 只绕 Y 轴倾斜（法向无 y 分量）',
  orbit.every((s) => Math.abs(s.nAx) < 1e-9 && Math.abs(s.nBy) < 1e-9),
);
check(
  '合位移向量绕光轴旋转（方位角累计 ≈ 整圈），且半径基本不变 —— 板没有绕光轴自转',
  travelled > 330 && radiusVariation < 0.1,
  `方位角累计 ${travelled.toFixed(1)}°，半径相对变化 ${(radiusVariation * 100).toFixed(2)}%`,
);

// ---------------------------------------------------------------- 8. 自动进动（播放）
await page.evaluate(() => {
  const { state } = window.__PRECSYS__;
  state.setAxisDemo('beta');
  state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
  state.playing = true;
  state.setPlaying(true);
});
await page.waitForTimeout(1200);
const playing = await page.evaluate(() => {
  const s = window.__PRECSYS__.state.snapshot();
  const w = s.trace.trace.wobble;
  return { theta: s.theta, r: w?.offsetRadiusMm ?? 0, tiltA: s.actuators.actuators.plateARad };
});
check(
  '自动进动时位移半径非零（beam offset 在动）',
  playing.theta > 0 && playing.r > 0,
  JSON.stringify(playing),
);
await page.evaluate(() => {
  window.__PRECSYS__.state.playing = false;
  window.__PRECSYS__.state.setAxisDemo('none');
  window.__PRECSYS__.state.setPlaying(false);
  window.__PRECSYS__.state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
});

// ---------------------------------------------------------------- 8b. Z 轴演示：镜组必须真的在动
/**
 * 回归：Novanta 的可达焦点 Z 只有约 ±0.27 mm（Z 执行器 ±1.5 mm）。
 * 早期把轴演示的 Z 幅值取成 SCANLAB 的 ±1 mm，命令被 clamp 到上限、
 * 求解器长期顶在行程端点，表现为"点 Z 轴演示时镜片纹丝不动"。
 * 这里逐帧采样**真实行程**与**绘制位置**，两者都必须变化。
 */
await page.$eval('#controlbar details', (d) => {
  d.open = true;
});
await page.waitForTimeout(300);
await page.click('button[data-axis="z"]');
await page.waitForTimeout(1200);
const zFrames = [];
for (let i = 0; i < 8; i += 1) {
  zFrames.push(
    await page.evaluate(() => {
      const api = window.__PRECSYS__;
      const V = api.sceneView.camera.position.constructor;
      const chain = api.chain();
      const s = api.state.snapshot();
      const part = chain.parts.find((p) => p.id === 'novanta-telescope-negative');
      let mesh = null;
      part.object.traverse((o) => {
        if (o.isMesh && !mesh) mesh = o;
      });
      return {
        drawnZ: mesh.getWorldPosition(new V()).z,
        travel: s.actuators.actuators.telescopeTravelMm,
        focusZ: s.trace.trace.focus.zMm,
        saturated: s.inverse.saturated,
      };
    }),
  );
  await page.waitForTimeout(420);
}
const spans = (values) => Math.max(...values) - Math.min(...values);
const travelSpan = spans(zFrames.map((f) => f.travel));
const focusSpan = spans(zFrames.map((f) => f.focusZ));
const drawnSpan = spans(zFrames.map((f) => f.drawnZ));
check(
  'Z 轴演示：执行器真实行程在变化、且没有顶在行程端点',
  travelSpan > 0.2 && zFrames.every((f) => !f.saturated),
  `行程跨度 ${travelSpan.toFixed(3)} mm，saturated=${zFrames.some((f) => f.saturated)}`,
);
check(
  'Z 轴演示：焦点深度随之变化（±0.27 mm 量级）',
  focusSpan > 0.05 && focusSpan < 1,
  `焦点 Z 跨度 ${focusSpan.toFixed(4)} mm`,
);
check(
  'Z 轴演示：望远镜镜组在画面上可见地移动（绘制放大生效）',
  drawnSpan > travelSpan * 2,
  `绘制跨度 ${drawnSpan.toFixed(1)} mm vs 真实跨度 ${travelSpan.toFixed(3)} mm`,
);
await page.screenshot({ path: join(outDir, 'zdemo.png') });
await page.click('button[data-axis="none"]');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 9. 视角
// 注意：工艺预设按钮也用 data-preset 作为自己的标识，因此这里只取视角那一组。
const presets = await page.$$eval('.control-group [data-preset]', (nodes) =>
  nodes
    .map((n) => ({ key: n.getAttribute('data-preset'), label: n.textContent?.trim() ?? '' }))
    .filter((p) => p.label && !/^0\d/.test(p.label)),
);
const need = ['overview', 'plates', 'plateA', 'plateB', 'telescope', 'galvos', 'objective', 'workpiece'];
check(
  'Novanta 提供全部要求的快捷视角（含 Dual-Plate Top View）',
  need.every((k) => presets.some((p) => p.key === k)),
  presets.map((p) => p.label).join(' / '),
);

// 逐个点一遍并截图，确保每个视角都不报错
for (const { key } of presets) {
  await page.click(`[data-preset="${key}"]`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `view-${key}.png`) });
}
check('逐个切换快捷视角无控制台错误', problems.length === 0, problems.slice(0, 3).join(' | '));

// ---------------------------------------------------------------- 10. 位移轨迹面板
const offsetPanel = await page.evaluate(() => {
  const card = document.getElementById('offset-card');
  const canvas = card?.querySelector('canvas');
  return {
    hidden: card?.hidden ?? true,
    hasCanvas: Boolean(canvas),
    w: canvas?.width ?? 0,
    readout: document.getElementById('offset-readout')?.textContent?.slice(0, 200) ?? '',
  };
});
check('位移轨迹（Top View）面板可见并已绘制', !offsetPanel.hidden && offsetPanel.hasCanvas && offsetPanel.w > 0, JSON.stringify({ w: offsetPanel.w }));
check(
  '面板给出非圆度读数（简单 sin/cos 模式下必然 > 0）',
  /非圆度/.test(offsetPanel.readout),
  offsetPanel.readout.replace(/\s+/g, ' ').slice(0, 120),
);

// ---------------------------------------------------------------- 10b. 进动驱动策略切换
const precessionPanel = await page.evaluate(() => {
  const card = document.getElementById('precession-card');
  return { hidden: card?.hidden ?? true, hasSelect: Boolean(document.getElementById('precession-mode')) };
});
check(
  '进动驱动策略面板可见且含两种驱动方式选择',
  !precessionPanel.hidden && precessionPanel.hasSelect,
  JSON.stringify(precessionPanel),
);

/** 读面板上的"非圆度"百分比。 */
async function readNonCircularity() {
  return page.evaluate(() => {
    const text = document.getElementById('offset-readout')?.textContent ?? '';
    const m = text.match(/非圆度[^0-9]*([0-9.]+)\s*%/);
    return m ? Number(m[1]) : Number.NaN;
  });
}

await page.evaluate(() => {
  window.__PRECSYS__.state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 3, betaDeg: 0 });
});
await page.selectOption('#precession-mode', 'patent-sin-cos');
await page.waitForTimeout(700);
const simpleNC = await readNonCircularity();
await page.selectOption('#precession-mode', 'compensated-circle');
await page.waitForTimeout(700);
const compNC = await readNonCircularity();
check(
  '补偿模式把非圆度降到数值精度级（简单 sin/cos 模式下 > 0）',
  Number.isFinite(simpleNC) && Number.isFinite(compNC) && simpleNC > 0 && compNC < simpleNC / 100,
  `Patent Simple Sin/Cos ${simpleNC}% → Compensated ${compNC}%`,
);
await page.screenshot({ path: join(outDir, 'precession-compensated.png') });
await page.selectOption('#precession-mode', 'patent-sin-cos');
await page.evaluate(() => {
  window.__PRECSYS__.state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
});
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 11. 部件点击信息
/**
 * 部件卡是由 state 订阅渲染的。直接在 evaluate 里改状态时，
 * 既没有 await 也没有重新触发订阅路径，因此这里显式等一小段时间让 UI 刷新。
 */
async function clickPart(id) {
  await page.evaluate((partId) => {
    window.__PRECSYS__.state.setSelectedPart(partId);
  }, id);
  await page.waitForTimeout(400);
  return page.evaluate(() => document.getElementById('part-card')?.textContent ?? '');
}

const partCard = await clickPart('novanta-plate-a');
check(
  '点击平板给出参数与事实标签（含机械角/入射角/折射角/位移/出射方向误差）',
  /平板 A/.test(partCard) &&
    /入射角/.test(partCard) &&
    /折射角/.test(partCard) &&
    /横向位移/.test(partCard) &&
    /出射方向误差/.test(partCard),
  partCard.replace(/\s+/g, ' ').slice(0, 120),
);
check('平板依据标注为历史专利原理并给出专利号', /DE102004053298B4/.test(partCard) && /专利原理/.test(partCard));

const telescopeCard = await clickPart('novanta-telescope-negative');
check(
  '点击望远镜给出倍率/位移前后/光束直径前后/Z 执行器状态',
  /放大倍率/.test(telescopeCard) &&
    /位移（前 → 后）/.test(telescopeCard) &&
    /光束直径（前 → 后）/.test(telescopeCard) &&
    /Z 执行器行程/.test(telescopeCard),
  telescopeCard.replace(/\s+/g, ' ').slice(0, 120),
);
check('望远镜参数标注为教学等效', /教学等效/.test(telescopeCard));

// ---------------------------------------------------------------- 12. 事实边界 / 对照表
await page.evaluate(() => {
  window.__PRECSYS__.state.setMode('evidence');
});
await page.waitForTimeout(500);
const evidence = await page.evaluate(() => document.getElementById('part-card')?.textContent ?? '');
check(
  '结构依据含三类事实边界（公开确认 / 专利原理 / 教学等效）',
  /公开确认/.test(evidence) && /专利原理/.test(evidence) && /教学等效/.test(evidence),
  `长度 ${evidence.length}`,
);
check(
  '结构依据含两条技术路线对照表',
  /两条技术路线对照/.test(evidence) && /SCANLAB precSYS/.test(evidence) && /Novanta/.test(evidence),
);
check('结构依据含"已知的未知"清单', /已知的未知/.test(evidence) && evidence.length > 3000);
check('明确说明不是 PE III 实机 CAD 复刻', /不是 PE III 实机内部结构的 CAD 复刻/.test(evidence));
check('明确说明不把平行板画成楔形棱镜/Risley prism、且不自转', /Risley/.test(evidence) && /楔形/.test(evidence));
check('明确说明 AOI/Plane 不是"一板对一轴"', /极坐标/.test(evidence));
check(
  '非圆度按专利原文表述（约 18° 时约 1%）且不声称复现该数字',
  /18/.test(evidence) && /(一个百分点|百分之一|percent|1%)/.test(evidence) &&
    /不声称复现/.test(evidence),
);
check(
  '说明文字里的强调标记被渲染成真正的粗体，而不是留下星号',
  !/\*\*/.test(evidence) && /<b>/.test(await page.evaluate(() => document.getElementById('part-card')?.innerHTML ?? '')),
);
await page.screenshot({ path: join(outDir, 'evidence-novanta.png') });
await page.evaluate(() => {
  window.__PRECSYS__.state.setMode('overview');
});
await page.waitForTimeout(300);

// ---------------------------------------------------------------- 13. 切回 SCANLAB 仍正常
await page.click('#vendor-switch .vendor-button[data-vendor="scanlab"]');
await page.waitForTimeout(1200);
const back = await page.evaluate(() => {
  const s = window.__PRECSYS__.state.snapshot();
  return { vendor: s.vendor, ok: s.trace.trace.ok, hits: s.trace.trace.hits.length };
});
check('切回 SCANLAB 后原链路与测试结构不变', back.vendor === 'scanlab' && back.ok && back.hits === 10, JSON.stringify(back));

await page.screenshot({ path: join(outDir, 'back-to-scanlab.png') });

// 回到 Novanta 出主验收图
await page.click('#vendor-switch .vendor-button[data-vendor="novanta"]');
await page.waitForTimeout(900);
await page.click('[data-preset="plates"]');
await page.waitForTimeout(900);
await page.screenshot({ path: join(outDir, 'novanta-overview.png') });
await page.click('[data-preset="overview"]');
await page.waitForTimeout(900);
await page.screenshot({ path: join(outDir, 'novanta-isometric.png'), fullPage: false });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过`);
if (problems.length) {
  console.log(`控制台错误 ${problems.length} 条：`);
  for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
}
console.log(`截图目录：${outDir}`);
process.exit(failed.length === 0 ? 0 : 1);
