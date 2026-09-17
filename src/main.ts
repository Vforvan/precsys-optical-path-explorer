/**
 * 入口：把状态、光学追迹、三维场景和界面接起来。
 *
 * 每帧的链路是：
 *   用户命令 → educationalInverseModel()/naiveInverse() → 五个执行轴
 *   → traceTrain()（真实反射计算）→ 镜片位姿、光束折线、焦点、读数面板。
 *
 * 页面上的任何一条光线、任何一个数字都来自这条链路。
 */

import { Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { AppState, DEFAULT_TOGGLES, type AppMode, type AppSnapshot } from './app-state';
import { SceneView } from './scene/create-scene';
import { buildOpticsView, type OpticsView } from './scene/create-optics';
import { buildHousingView, EXTERNAL_SYSTEM_NOTE, type HousingView } from './scene/create-housing';
import { createWorkpieceAxes } from './scene/create-workpiece';
import { buildWorkpieceView, type WorkpieceView } from './scene/cumulative-workpiece';
import { MaterialDetail } from './ui/material-detail';
import { createBeamView, type BeamView } from './scene/create-beam';
import { createLabels } from './scene/labels';
import { Controls, type CameraPreset } from './ui/controls';
import { partInfo, renderPartCard, renderSources } from './ui/component-info';
import { TOUR_STEPS, type TourStep } from './animation/guided-tour';
import { focusMirrorRadius } from './optics/focus-module';
import { PUBLIC_SPECS_UI } from './config/ui-text';
import { AXIS, BEAM_PATH } from './config/layout';
import { SLOW_MOTION_NOTE } from './ui/labels-text';
import { ProcessPresets, presetParameters } from './ui/process-presets';

const viewport = document.getElementById('viewport');
if (!viewport) throw new Error('missing #viewport');

let sceneView: SceneView;
try {
  sceneView = new SceneView({
    container: viewport,
    onPick: (id) => state.setSelectedPart(id),
  });
} catch (error) {
  viewport.innerHTML = `<div style="padding:24px;color:#ffb4a2">
    无法初始化 WebGL。请使用支持 WebGL2 的桌面浏览器（Chrome / Edge / Firefox）打开本页。
    <br />错误信息：${String(error)}
  </div>`;
  throw error;
}

const state = new AppState();

// ---------------------------------------------------------------- 场景装配
const opticsView: OpticsView = buildOpticsView(state.train, sceneView.materials);
const housingView: HousingView = buildHousingView(sceneView.materials);
const workpieceView: WorkpieceView = buildWorkpieceView();
const materialDetail = new MaterialDetail(workpieceView);
const beamView: BeamView = createBeamView(sceneView.materials);
const axesHelper = createWorkpieceAxes(26);

const labelsHolder = new Group();
function rebuildLabels(): void {
  labelsHolder.clear();
  const { group } = createLabels(state.train);
  labelsHolder.add(group);
}
rebuildLabels();

const root = new Group();
root.add(opticsView.group, housingView.group, workpieceView.group, beamView.group, labelsHolder, axesHelper);
sceneView.scene.add(root);

// 可拾取对象：镜片、模块、物镜、工件、外壳等
for (const part of [...opticsView.parts, ...housingView.parts, ...workpieceView.parts]) {
  sceneView.pickables.push(part.object);
}

// 爆炸/分层视图：外壳扩开、维护件下移
const explodeState = { value: 0 };

// ---------------------------------------------------------------- 界面
const controls = new Controls(state, {
  onPlayToggle: () => {
    state.playing = !state.playing;
    state.setPlaying(state.playing);
  },
  onStep: () => {
    if (state.mode === 'process') {
      const from = state.theta;
      workpieceView.sweep(state.process, from, from + Math.PI / 12);
    }
    state.theta += Math.PI / 12;
    state.playing = false;
    state.setPlaying(false);
  },
  onReset: () => {
    state.reset();
    state.setToggles({ ...DEFAULT_TOGGLES, housingOpacity: state.toggles.housingOpacity });
    beamView.clearTrail();
    sceneView.resetView();
  },
  onModeChange: (mode) => setMode(mode),
  onCommandChange: (patch) => {
    state.setTourStep(null);
    state.setMode('linked');
    state.setPlaying(false);
    state.setAxisDemo('none');
    state.setCommand(patch);
  },
  onToggleChange: (patch) => state.setToggles(patch),
  onProcessChange: (patch) => {
    state.setProcess(patch);
    if (patch.mode) {
      state.theta = 0;
      setMode('process');
    }
    beamView.clearTrail();
  },
  onAxisDemo: (axis) => {
    state.setAxisDemo(axis);
    state.playing = axis !== 'none';
    state.setPlaying(state.playing);
    if (axis !== 'none') state.setMode('axes');
    // 每个轴看不同的部位：X/Y 看振镜与物镜，Z 看 Z 模块，α/β 看移束模块
    if (axis === 'z') applyCameraPreset('z');
    else if (axis === 'alpha' || axis === 'beta') applyCameraPreset('alpha');
    else if (axis === 'x' || axis === 'y') applyCameraPreset('objective');
  },
  onCameraPreset: (preset) => applyCameraPreset(preset),
  onVariantChange: (key) => {
    state.setVariant(key);
    rebuildLabels();
  },
  onCompensationToggle: (on) => state.setToggles({ compensation: on }),
  onTourStep: (index) => applyTourStep(index),
});

const processPresets = new ProcessPresets((id) => {
  const params = presetParameters(id);
  if (!params) return;
  applyTourStep(null);
  state.theta = 0;
  state.setAxisDemo('none');
  state.setProcess(params);
  state.setToggles({ compensation: true, exploded: false, showGhost: false,
    showNormals: false, showLabels: false, housingOpacity: 0.06 });
  setMode('process');
});

// 引导流程
let tourIndex: number | null = null;
function applyTourStep(index: number | null): void {
  if (index !== null && (index < 0 || index >= TOUR_STEPS.length)) index = null;
  tourIndex = index;
  state.setTourStep(index);
  if (index === null) {
    controls.renderTour(null, TOUR_STEPS.length, null);
    state.setAxisDemo('none');
    return;
  }
  const step: TourStep = TOUR_STEPS[index];
  controls.renderTour(index, TOUR_STEPS.length, step);
  state.setAxisDemo(step.axisDemo ?? 'none');
  if (step.command) state.setCommand(step.command);
  else if (!step.axisDemo) state.setCommand({ xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 });
  if (step.mode) state.setMode(step.mode);
  sceneView.focusOn(new Vector3(...step.camera.target), step.camera.distance);
  state.playing = Boolean(step.play);
  state.setPlaying(state.playing);
  if (index + 1 > TOUR_STEPS.length) tourIndex = null;
}

function setMode(mode: AppMode): void {
  state.setMode(mode);
  if (mode === 'overview') applyCameraPreset('overview');
  if (mode !== 'axes') state.setAxisDemo('none');
  if (mode === 'axes') {
    applyCameraPreset('objective');
    if (state.axisDemo === 'none') state.setAxisDemo('x');
    state.playing = true;
    state.setPlaying(true);
  }
  if (mode === 'linked') {
    applyCameraPreset('objective');
    state.setAxisDemo('none');
    state.setCommand({ xMm: 1.25, yMm: -1.25, zMm: 0.6, alphaDeg: 5, betaDeg: -5 });
    state.playing = false;
    state.setPlaying(false);
  }
  if (mode === 'process') {
    applyCameraPreset('overview');
    state.setAxisDemo('none');
    state.playing = true;
    state.setPlaying(true);
    beamView.clearTrail();
  }
  if (mode === 'calibration') {
    applyCameraPreset('z');
    state.setAxisDemo('none');
    state.playing = false;
    state.setPlaying(false);
  }
  if (mode === 'evidence') {
    state.playing = false;
    state.setPlaying(false);
  }
  if (mode === 'evidence') renderEvidence();
  else {
    renderPartCard(
      document.getElementById('part-card') as HTMLElement,
      state.selectedPartId ? partInfo(state.selectedPartId, state.train) : null,
      state.snapshot(),
    );
  }
}

function applyCameraPreset(preset: CameraPreset): void {
  switch (preset) {
    case 'alpha':
      sceneView.focusOn(
        new Vector3(BEAM_PATH.afterAlpha.x - 8, BEAM_PATH.afterAlpha.y - 12, AXIS.alphaModuleOut + 16),
        300,
        0.25,
      );
      break;
    case 'z':
      sceneView.focusOn(
        new Vector3(BEAM_PATH.afterBeta.x + 8, BEAM_PATH.afterBeta.y - 4, AXIS.zGalvo - 6),
        300,
        0.2,
      );
      break;
    case 'objective':
      sceneView.focusOn(new Vector3(0, 0, AXIS.galvoPlane - 34), 300, 0.22);
      break;
    case 'workpiece':
      sceneView.focusOn(new Vector3(0, 0, 60), 430, 0.3);
      break;
    case 'overview':
    default:
      sceneView.resetView();
      break;
  }
}

function renderEvidence(): void {
  const card = document.getElementById('part-card') as HTMLElement;
  renderSources(card);
  card.insertAdjacentHTML(
    'beforeend',
    `<h3>已知的未知（页面不猜测）</h3>
     <ul class="source-list">
       <li>可动镜的具体形式：专利附图把可转镜画成一条实心镜条，未说明两次反射如何避开镜片；本模型用同一支架上两块平行镜面 + 一个法向小台阶实现，属教学等效。</li>
       <li>Z 轴内部镜组排布与曲率：未公开，本页只做"改变会聚度 → 移动焦点"的功能等效。</li>
       <li>两套平行移束单元的光路平面是否互相垂直：专利只写两个位移方向"可选正交"。</li>
       <li>物镜内部镜组数量、口径与镀膜：未公开。</li>
       <li>位移量—转角关系式：专利只有"每转角位移量与镜间距有关"的定性表述，没有公式。</li>
       <li>实机五个控制通道与模型五个执行轴的编号对应关系：未公开。</li>
     </ul>
     <div class="note">${PUBLIC_SPECS_UI.noSimulation}<br />${PUBLIC_SPECS_UI.noProcessPrediction}</div>`,
  );
}

// ---------------------------------------------------------------- 状态订阅
state.onChange((snapshot) => {
  controls.update(snapshot);
  if (snapshot.mode !== 'evidence') {
    renderPartCard(
      document.getElementById('part-card') as HTMLElement,
      snapshot.selectedPartId ? partInfo(snapshot.selectedPartId, state.train) : null,
      snapshot,
    );
  }
  if (snapshot.tourStep !== null) controls.renderTour(snapshot.tourStep, TOUR_STEPS.length, TOUR_STEPS[snapshot.tourStep]);
});

// ---------------------------------------------------------------- 每帧更新
let fpsAccum = 0;
let fpsFrames = 0;
let uiElapsed = 0;
let lastPhase = 0;

sceneView.onFrame = (elapsed) => {
  state.advance(Math.min(elapsed, 0.1));

  fpsAccum += elapsed;
  fpsFrames += 1;
  if (fpsAccum > 0.5) {
    state.fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
    updateFpsBadge();
  }

  const snapshot = state.snapshot();
  uiElapsed += elapsed;
  if (uiElapsed >= 0.12) {
    controls.update(snapshot);
    processPresets.update(snapshot);
    uiElapsed = 0;
  }

  // 镜片位姿
  opticsView.update(snapshot.actuators, snapshot.trace);
  // 变焦反射镜曲率（教学等效）
  opticsView.setCurvedMirrorRadius(focusMirrorRadius(snapshot.actuators.zDeg));
  // 光束
  beamView.update(snapshot.trace, snapshot.ghostTrace, {
    showCenter: snapshot.toggles.showCenterRay,
    showEnvelope: snapshot.toggles.showEnvelope,
    showGhost: snapshot.toggles.showGhost,
    showNormals: snapshot.toggles.showNormals,
  });
  // 只有加工策略改变才换料；暂停、视角、复位和循环均保留实体。
  workpieceView.selectSession(`${snapshot.process.mode}:${snapshot.process.mode === 'precession' ? snapshot.process.taper : ''}`);
  if (state.processSpan && snapshot.trace.ok) {
    workpieceView.sweep(snapshot.process, state.processSpan.from, state.processSpan.to);
  }
  materialDetail.update(snapshot, elapsed);
  // 外壳透明度
  housingView.setOpacity(snapshot.toggles.housingOpacity);
  // 标签与坐标轴
  labelsHolder.visible = snapshot.toggles.showLabels;
  axesHelper.visible = snapshot.toggles.showAxes;
  // 自动旋转
  sceneView.setAutoRotate(snapshot.toggles.autoRotate);
  // 分层视图
  const target = snapshot.toggles.exploded ? 1 : 0;
  explodeState.value += (target - explodeState.value) * Math.min(1, elapsed * 4);
  applyExplosion(explodeState.value);

  // 加工模式：累积焦点轨迹
  if (snapshot.mode === 'process' && snapshot.playing) {
    if (snapshot.theta < lastPhase) beamView.clearTrail();
    beamView.pushTrailPoint(snapshot.trace.focusPoint);
  }
  lastPhase = snapshot.theta;

  // 高亮 / 降透明度
  applyHighlight(highlightFor(snapshot));
};

function applyExplosion(value: number): void {
  housingView.group.scale.setScalar(1 + 0.14 * value);
  housingView.group.position.z = 40 * value;
  // 拆开外围包络，保持镜片、光路、标签、工件共享同一坐标。
  housingView.group.position.x = 65 * value;
  workpieceView.group.position.z = 0;
  opticsView.group.position.z = 0;
}

function highlightFor(snapshot: AppSnapshot): Set<string> | null {
  const step = snapshot.tourStep !== null ? TOUR_STEPS[snapshot.tourStep] : null;
  if (step) return new Set(step.highlight);
  switch (snapshot.mode) {
    case 'axes': {
      const map: Record<string, string[]> = {
        x: ['galvo-x', 'objective'],
        y: ['galvo-y', 'galvo-x', 'objective'],
        z: ['z-galvo', 'z-curved', 'z-fold', 'objective'],
        alpha: ['alpha-movable-in', 'alpha-movable-out', 'alpha-fixed-1', 'alpha-fixed-2', 'alpha-mount'],
        beta: ['beta-movable-in', 'beta-movable-out', 'beta-fixed-1', 'beta-fixed-2', 'beta-mount'],
      };
      return new Set(map[snapshot.axisDemo] ?? []);
    }
    case 'linked':
      return new Set(['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'z-curved', 'objective']);
    case 'process':
      return new Set(['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'objective', 'workpiece']);
    case 'calibration':
      return new Set(['monitor-splitter', 'position-sensor', 'alpha-movable-in', 'beta-movable-in']);
    default:
      return null;
  }
}

/**
 * 高亮：被强调的部件保持原样，其余部件降低不透明度。
 * 每块镜片的材质都在建模时单独克隆过，因此可以逐块调透明度而不互相干扰。
 */
function applyHighlight(highlight: Set<string> | null): void {
  const dimFactor = 0.65;
  for (const part of opticsView.parts) {
    const active = !highlight || highlight.has(part.id);
    part.object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const m = material as MeshStandardMaterial;
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = typeof m.opacity === 'number' ? m.opacity : 1;
        }
        const base = m.userData.baseOpacity as number;
        const reflective = Boolean(part.spec && part.spec.kind !== 'splitter');
        m.transparent = reflective ? false : base < 1;
        // 未高亮的部件"降低透明度"而不是消失，保留空间上下文
        m.opacity = reflective ? 1 : active ? base : Math.max(0.14, base * dimFactor);
        m.depthWrite = reflective || base > 0.95;
      }
    });
  }
}

function updateFpsBadge(): void {
  const notes = document.getElementById('visual-notes');
  if (!notes) return;
  notes.innerHTML = `
    <div>${PUBLIC_SPECS_UI.scaleNote}</div>
    <div>局部示意图放大显示焦点运动</div>
    <div>${SLOW_MOTION_NOTE(state.snapshot())}</div>
    <div>${EXTERNAL_SYSTEM_NOTE}</div>
    <div>FPS ${state.fps.toFixed(0)}</div>
  `;
}
const legend = document.getElementById('axis-legend');
if (legend) {
  legend.innerHTML = `
    <div><span class="axis-chip"><span class="axis-dot" style="background:#ff6b6b"></span>+X 工件右</span>
         <span class="axis-chip"><span class="axis-dot" style="background:#6bff9b"></span>+Y 工件后</span>
         <span class="axis-chip"><span class="axis-dot" style="background:#6bb8ff"></span>+Z 指向扫描头</span></div>
    <div>激光名义传播方向 −Z · 工件表面 z = 0 · 名义焦点 (0,0,0)</div>
    <div>α：XZ 面内倾斜分量 · β：YZ 面内倾斜分量</div>
  `;
}

const disclaimerClose = document.getElementById('disclaimer-close');
disclaimerClose?.addEventListener('click', () => {
  const node = document.getElementById('disclaimer');
  if (node) node.hidden = true;
});

// 键盘：空格播放/暂停，←/→ 单步，R 重置
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    state.playing = !state.playing;
    state.setPlaying(state.playing);
  } else if (event.code === 'ArrowRight') {
    state.theta += Math.PI / 24;
    state.setPlaying(state.playing);
  } else if (event.code === 'ArrowLeft') {
    state.theta -= Math.PI / 24;
    state.setPlaying(state.playing);
  } else if (event.key === 'r' || event.key === 'R') {
    state.reset();
    sceneView.resetView();
  } else if (event.key === 'n' || event.key === 'N') {
    applyTourStep(tourIndex === null ? 0 : tourIndex + 1);
  }
});

// 启动
applyCameraPreset('overview');
updateFpsBadge();
controls.renderTour(null, TOUR_STEPS.length, null);
setMode('overview');
sceneView.start();

// 启动成功：移除"页面没有启动"提示（该提示只在模块没能执行时才会留在页面上）
document.getElementById('boot-hint')?.remove();

// 供调试与自动化检查使用
declare global {
  interface Window {
    __PRECSYS__?: {
      state: AppState;
      sceneView: SceneView;
      /** 各分组，便于排查"某个东西挡住了画面"之类的渲染问题。 */
      groups: Record<string, Object3D>;
      workpiece: WorkpieceView;
    };
  }
}
window.__PRECSYS__ = {
  state,
  workpiece: workpieceView,
  sceneView,
  groups: {
    optics: opticsView.group,
    housing: housingView.group,
    workpiece: workpieceView.group,
    beam: beamView.group,
    labels: labelsHolder,
    axes: axesHelper,
  },
};
