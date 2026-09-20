/**
 * 入口：把状态、光学追迹、三维场景和界面接起来。
 *
 * 每帧的链路是：
 *   用户命令 → 逆映射（两条路线各自一套耦合结构）→ 五个执行轴
 *   → trace（真实折射/反射计算）→ 镜片位姿、光束折线、焦点、读数面板。
 *
 * 【两条技术路线】页面可以在 SCANLAB precSYS 与 Novanta / ARGES 之间切换。
 * 切换会重建整条光学链路、三维部件与光束渲染 —— 因为两条路线的光路拓扑本来不同：
 *   SCANLAB：三镜四反射的反射式平行移束模块 + 反射式 Z 等效模块；
 *   Novanta ：两块透射式平行玻璃板（折射移束）+ Galilei 望远镜动态调焦 + scanblock。
 * 这里通过 ChainView / BeamViewLike 两个接口把差异收口，避免到处写 vendor 判断。
 */

import { Group, Object3D, Vector3 } from 'three';
import { AppState, DEFAULT_TOGGLES, commonTrace, type AppMode, type AppSnapshot } from './app-state';
import { SceneView } from './scene/create-scene';
import { buildOpticsView } from './scene/create-optics';
import { buildNovantaOpticsView } from './scene/novanta-optics';
import { buildHousingView, EXTERNAL_SYSTEM_NOTE, type HousingView } from './scene/create-housing';
import { createWorkpieceAxes } from './scene/create-workpiece';
import { buildWorkpieceView, type WorkpieceView } from './scene/cumulative-workpiece';
import { MaterialDetail } from './ui/material-detail';
import { createBeamView } from './scene/create-beam';
import { createNovantaBeamView, createOffsetView, type OffsetView } from './scene/novanta-beam';
import { VISUAL_GAIN_LABEL } from './config/visual-scale';
import { createLabels } from './scene/labels';
import { createNovantaLabels } from './scene/novanta-labels';
import { Controls, type CameraPreset } from './ui/controls';
import { partInfo, renderInlineMarkup, renderPartCard, renderSources } from './ui/component-info';
import { TOUR_STEPS, type TourStep } from './animation/guided-tour';
import { PUBLIC_SPECS_UI } from './config/ui-text';
import { AXIS, BEAM_PATH } from './config/layout';
import {
  NOVANTA_AXIS,
  NOVANTA_BEAM_PATH,
  NOVANTA_TITLE,
} from './config/novanta-layout';
import {
  ARCHITECTURE_COMPARISON,
  NOVANTA_BOUNDARY_GROUPS,
  NOVANTA_BOUNDARY_NOTES,
  NOVANTA_KNOWN_UNKNOWNS,
} from './config/novanta-comparison';
import { SLOW_MOTION_NOTE } from './ui/labels-text';
import { ProcessPresets, presetParameters } from './ui/process-presets';
import { adaptScanlabView, type ChainView, type BeamViewLike, type BeamOptions } from './scene/chain-view';
import {
  DEFAULT_PRECESSION,
  samplePrecessionTrajectory,
  type PrecessionParams,
  type PrecessionTrajectory,
} from './optics/dual-plate-precession';
import type { NovantaTrainTrace } from './optics/novanta-optical-train';

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
/**
 * 整条链路的视图。两条路线各自构建，接口一致（ChainView）。
 * 切换路线时重建并与 root 重新挂载。
 */
let chainView: ChainView = adaptScanlabView(buildOpticsView(state.scanlabTrain, sceneView.materials));
let beamView: BeamViewLike = createBeamView(sceneView.materials);
/** Novanta 的位移轨迹面板（SCANLAB 模式下隐藏）。 */
let offsetView: OffsetView | null = null;

const housingView: HousingView = buildHousingView(sceneView.materials);
const workpieceView: WorkpieceView = buildWorkpieceView();
const materialDetail = new MaterialDetail(workpieceView);
const axesHelper = createWorkpieceAxes(26);

const labelsHolder = new Group();
const beamHolder = new Group();
const root = new Group();
root.add(beamHolder, workpieceView.group, labelsHolder, axesHelper);
sceneView.scene.add(root);

/**
 * 移除一个分组，并**同时清掉它携带的 CSS2D 标签 DOM 节点**。
 *
 * 为什么必须手动清：CSS2DRenderer 只负责"隐藏自己这一帧遍历到的标签"，
 * 分组一旦从场景里摘掉，它原来挂在 labelRenderer.domElement 下的那些
 * `<div class="motor-label">` / `.scene-label` 就再也不会被遍历到，
 * 于是**永久留在页面上**。切换技术路线时表现为：SCANLAB 的
 * "α 电机 / β 电机 / L1 移动" 标签叠在 Novanta 的模型上。
 */
function detachGroup(target: Object3D): void {
  target.traverse((object) => {
    const element = (object as unknown as { element?: HTMLElement }).element;
    if (element && element.parentNode) element.parentNode.removeChild(element);
  });
  target.removeFromParent();
  target.clear();
}

function rebuildChain(): void {
  detachGroup(chainView.group);
  housingView.group.removeFromParent();
  chainView = buildChainView();
  root.add(chainView.group, housingView.group);
  applyHousingEnvelope();
  // 可拾取对象：镜片/平板/望远镜/物镜/工件/外壳
  sceneView.pickables.length = 0;
  for (const part of [
    ...chainView.parts,
    ...housingView.parts,
    ...workpieceView.parts,
  ]) {
    sceneView.pickables.push(part.object);
  }
}

/**
 * 外壳是**教学示意包络**，两条路线的轴向长度差很多（Novanta 的入光更高），
 * 因此这里按当前路线缩放/抬升外壳分组，而不是改外壳模块本身。
 * 缩放只作用于外壳与外围系统，光学件与光路一直共享同一坐标系。
 */
function applyHousingEnvelope(): void {
  const novanta = state.vendor === 'novanta';
  const scanlabHeight = AXIS.housingTop - AXIS.housingBottom;
  const novantaHeight = NOVANTA_AXIS.housingTop - NOVANTA_AXIS.housingBottom;
  housingView.group.scale.set(novanta ? 1.06 : 1, novanta ? 1.06 : 1, novanta ? novantaHeight / scanlabHeight : 1);
  housingView.group.position.z = novanta ? NOVANTA_AXIS.housingBottom - AXIS.housingBottom : 0;
}

function buildChainView(): ChainView {
  return state.vendor === 'novanta'
    ? buildNovantaOpticsView(state.novantaTrain, sceneView.materials)
    : adaptScanlabView(buildOpticsView(state.scanlabTrain, sceneView.materials));
}

function rebuildBeamView(): void {
  beamHolder.clear();
  beamView = state.vendor === 'novanta'
    ? createNovantaBeamView(sceneView.materials)
    : createBeamView(sceneView.materials);
  beamHolder.add(beamView.group);
}

function rebuildLabels(): void {
  // 同样要清掉上一组标签的 DOM 节点，否则切换路线后会叠加两套标签
  detachGroup(labelsHolder);
  const { group } =
    state.vendor === 'novanta'
      ? createNovantaLabels(state.novantaTrain)
      : createLabels(state.scanlabTrain);
  labelsHolder.add(group);
}

rebuildChain();
rebuildBeamView();
rebuildLabels();

/**
 * Novanta 的位移轨迹面板：挂在侧栏，专门讲清
 * "两块板只做各自正交轴的倾斜，但合成位移向量绕光轴旋转"。
 */
function ensureOffsetView(): void {
  const host = document.getElementById('offset-card');
  if (!host) return;
  if (!offsetView) {
    offsetView = createOffsetView();
    host.innerHTML =
      '<h2>位移轨迹（Top View）</h2>' +
      '<p class="dim">横截面视角（视线沿机器光轴）。<b>橙色</b>是本模型实测的合位移轨迹，' +
      '<b>灰虚线</b>是同样半径的理想圆，<b>青色箭头</b>是当前位移向量。</p>';
    const panel = document.createElement('div');
    panel.className = 'offset-view-host';
    panel.appendChild(offsetView.domElement);
    host.appendChild(panel);
    const readout = document.createElement('div');
    readout.id = 'offset-readout';
    readout.className = 'offset-readout';
    host.appendChild(readout);
  }
  host.hidden = state.vendor !== 'novanta';
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
    // 每个轴看不同的部位
    if (state.vendor === 'novanta') {
      if (axis === 'z') applyCameraPreset('telescope');
      else if (axis === 'alpha' || axis === 'beta') applyCameraPreset('plates');
      else applyCameraPreset('galvos');
    } else if (axis === 'z') applyCameraPreset('z');
    else if (axis === 'alpha' || axis === 'beta') applyCameraPreset('alpha');
    else if (axis === 'x' || axis === 'y') applyCameraPreset('objective');
  },
  onCameraPreset: (preset) => applyCameraPreset(preset),
  onVariantChange: (key) => {
    state.setVariant(key);
    rebuildChain();
    rebuildLabels();
  },
  onCompensationToggle: (on) => state.setToggles({ compensation: on }),
  onTourStep: (index) => applyTourStep(index),
  onVendorChange: (vendor) => {
    state.setVendor(vendor);
    rebuildChain();
    rebuildBeamView();
    rebuildLabels();
    ensureOffsetView();
    ensurePrecessionPanel();
    setMode(state.mode);
  },
});

const processPresets = new ProcessPresets((id) => {
  const params = presetParameters(id);
  if (!params) return;
  applyTourStep(null);
  state.theta = 0;
  state.setAxisDemo('none');
  state.setProcess(params);
  state.setToggles({
    compensation: true,
    exploded: false,
    showGhost: false,
    showNormals: false,
    showLabels: false,
    housingOpacity: 0.06,
  });
  setMode('process');
});

// 进动参数（Novanta 模式的"简单 sin/cos vs 精确圆补偿"教学开关）
let precessionParams: PrecessionParams = { ...DEFAULT_PRECESSION };
let precessionCache: { key: string; trajectory: PrecessionTrajectory } | null = null;

function currentTrajectory(): PrecessionTrajectory {
  const key = `${precessionParams.driveMode}|${precessionParams.amplitudeDeg}|${precessionParams.phaseDeg}|${precessionParams.targetRadiusMm}`;
  if (!precessionCache || precessionCache.key !== key) {
    precessionCache = {
      key,
      trajectory: samplePrecessionTrajectory(state.novantaTrain.wobbleUnit, precessionParams, 360, 1),
    };
  }
  return precessionCache.trajectory;
}

function ensurePrecessionPanel(): void {
  const host = document.getElementById('precession-card');
  if (!host) return;
  host.hidden = state.vendor !== 'novanta';
  if (host.hidden) return;
  // 先建内容、再判断可见性：这个函数在启动时（此时还是 SCANLAB 路线）也会被调用，
  // 如果先 return 就永远不会把面板建起来 —— 切到 Novanta 后只能看到一个空卡片。
  if (host.firstElementChild) return;
  host.innerHTML = `
    <h2>进动驱动策略</h2>
    <p class="dim">专利描述的是"一板按正弦、另一板按相移正弦倾斜"，
      合成轨迹是 Lissajous（圆或椭圆）。但平行平板的位移对倾角是<b>非线性</b>的，
      因此简单 sin/cos <b>不是</b>数学上精确的圆 —— 专利原文也说约 18° 倾角时偏差约 1%。
      下面是本模型自己实测的非圆度。</p>
    <div class="control-group">
      <label>驱动方式</label>
      <select class="ctl" id="precession-mode">
        <option value="patent-sin-cos">Patent Simple Sin/Cos</option>
        <option value="compensated-circle">Compensated Circular Offset（教学逆解）</option>
      </select>
    </div>
    <div class="precession-values" id="precession-values"></div>
    <p class="dim">Compensated Circular Offset 是本模型按目标位移数值逆解每块板的机械角，
      属于<b>教学等效</b>；控制器实际算法未公开。</p>
  `;
  const select = host.querySelector<HTMLSelectElement>('#precession-mode');
  select?.addEventListener('change', () => {
    precessionParams = {
      ...precessionParams,
      driveMode: select.value as PrecessionParams['driveMode'],
    };
    precessionCache = null;
  });
}

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
    applyCameraPreset(state.vendor === 'novanta' ? 'galvos' : 'objective');
    if (state.axisDemo === 'none') state.setAxisDemo('x');
    state.playing = true;
    state.setPlaying(true);
  }
  if (mode === 'linked') {
    applyCameraPreset(state.vendor === 'novanta' ? 'plates' : 'objective');
    state.setAxisDemo('none');
    // Novanta 的机械倾角行程更窄，用更小的 AOI 指令；两条路线的工程量语义一致。
    const aoi = state.vendor === 'novanta' ? 3 : 5;
    state.setCommand({
      xMm: 1.25,
      yMm: -1.25,
      zMm: state.vendor === 'novanta' ? 0.15 : 0.6,
      alphaDeg: aoi,
      betaDeg: -aoi,
    });
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
    applyCameraPreset(state.vendor === 'novanta' ? 'telescope' : 'z');
    state.setAxisDemo('none');
    state.playing = false;
    state.setPlaying(false);
  }
  if (mode === 'evidence') {
    state.playing = false;
    state.setPlaying(false);
  }
  // 部件卡由下面的状态订阅统一渲染（见 state.onChange），这里不重复渲染 ——
  // 否则"先 renderEvidence 再被一次快照渲染覆盖"会把结构依据刷成空白部件卡。
}

/**
 * 按当前模式渲染右侧部件卡。
 * 由状态订阅统一调用，保证"任何触发方式（点标签页 / 代码里 setMode）都得到同一个结果"。
 */
function renderModeCard(snapshot: AppSnapshot): void {
  if (snapshot.mode === 'evidence') {
    renderEvidence();
    return;
  }
  renderPartCard(
    document.getElementById('part-card') as HTMLElement,
    snapshot.selectedPartId ? partInfo(snapshot.selectedPartId, state) : null,
    { trace: commonTrace(snapshot.trace) },
  );
}

/**
 * 快捷视角。两条路线的位置完全不同，因此这里按 vendor 分派。
 * Novanta 的 Dual-Plate Top View：相机沿 −Z 俯视两块平板，
 * 让人一眼看到"两块板没有绕光轴自转，但合位移向量在绕光轴旋转"。
 */
function applyCameraPreset(preset: CameraPreset): void {
  if (state.vendor === 'novanta') {
    const plateZ = (NOVANTA_AXIS.plateA + NOVANTA_AXIS.plateB) / 2;
    switch (preset) {
      case 'plates':
        /**
         * Dual-Plate Top View：沿机器光轴俯视两块平板。
         * 只留很小的横向偏移，让画面既有深度感、又接近正交俯视 ——
         * 这样"两板只做绕各自正交轴的摆动、而位移向量在绕光轴转"才看得清。
         */
        sceneView.lookAlongOpticalAxis(
          new Vector3(NOVANTA_BEAM_PATH.upstreamAxis.x, NOVANTA_BEAM_PATH.upstreamAxis.y, plateZ),
          190,
          0.22,
        );
        break;
      case 'plateA':
        sceneView.focusOn(
          new Vector3(NOVANTA_BEAM_PATH.upstreamAxis.x - 14, NOVANTA_BEAM_PATH.upstreamAxis.y - 26, NOVANTA_AXIS.plateA),
          150,
          0.28,
        );
        break;
      case 'plateB':
        sceneView.focusOn(
          new Vector3(NOVANTA_BEAM_PATH.upstreamAxis.x + 14, NOVANTA_BEAM_PATH.upstreamAxis.y + 26, NOVANTA_AXIS.plateB),
          150,
          0.28,
        );
        break;
      case 'telescope': {
        /**
         * Telescope View 必须把**两片**镜组都框进来：
         * 移动的是上游那片凹透镜（z = telescopeNegativeLens），
         * 如果只对着凸透镜，读者会看到"Z 轴在动但镜片没动"。
         * 这里以两片的中点为靶心，距离覆盖整个镜组轴向跨度。
         */
        const zMid = (NOVANTA_AXIS.telescopePositiveLens + NOVANTA_AXIS.telescopeNegativeLens) / 2;
        sceneView.focusOn(
          new Vector3(NOVANTA_BEAM_PATH.upstreamAxis.x + 14, NOVANTA_BEAM_PATH.upstreamAxis.y - 14, zMid),
          210,
          0.24,
        );
        break;
      }
      case 'galvos':
        sceneView.focusOn(
          new Vector3(-8, -6, (NOVANTA_AXIS.yGalvo + NOVANTA_AXIS.xGalvo) / 2),
          220,
          0.28,
        );
        break;
      case 'objective':
        sceneView.focusOn(new Vector3(0, 0, NOVANTA_AXIS.entrancePupil - 30), 280, 0.22);
        break;
      case 'workpiece':
        sceneView.focusOn(new Vector3(0, 0, 55), 420, 1.55);
        break;
      case 'overview':
      default:
        sceneView.resetView();
        break;
    }
    return;
  }

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
        new Vector3(BEAM_PATH.afterBeta.x + 8, BEAM_PATH.afterBeta.y - 4, AXIS.zLens2 - 6),
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
  if (state.vendor === 'novanta') {
    renderNovantaEvidence(card);
    return;
  }
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

/** Novanta 模式的"结构依据"卡片：三类事实边界 + 已知未知 + 两条路线对照。 */
function renderNovantaEvidence(card: HTMLElement): void {
  const boundary = NOVANTA_BOUNDARY_GROUPS.map(
    (group) => `
      <h3><span class="badge badge-${
        group.level === '公开确认' ? 'public' : group.level === '专利原理' ? 'patent' : 'edu'
      }">${group.title}</span></h3>
      <ul class="source-list">${group.items.map((item) => `<li>${renderInlineMarkup(item)}</li>`).join('')}</ul>`,
  ).join('');

  const comparison = `
    <h3>两条技术路线对照</h3>
    <table class="matrix compare">
      <thead><tr><th></th><th>SCANLAB precSYS</th><th>Novanta / ARGES</th></tr></thead>
      <tbody>
        ${ARCHITECTURE_COMPARISON.map(
          (row) =>
            `<tr><th>${renderInlineMarkup(row.dimension)}</th><td>${renderInlineMarkup(row.scanlab)}</td><td>${renderInlineMarkup(row.novanta)}</td></tr>`,
        ).join('')}
      </tbody>
    </table>
    <p class="dim">只比较实现方式，不评价谁更先进。两条路线的共同目的是一样的：
      控制光束在物镜入瞳上的位置与方向，从而独立控制焦点位置与入射方向。</p>
  `;

  const notes = `
    <h3>本页明确不做的事</h3>
    <ul class="source-list">
      ${NOVANTA_BOUNDARY_NOTES.map((note) => `<li>${renderInlineMarkup(note.text)}</li>`).join('')}
    </ul>
  `;

  card.innerHTML = `
    <h2>${NOVANTA_TITLE.nameZh}</h2>
    <p class="dim">${NOVANTA_TITLE.subtitle}</p>
    <p>${NOVANTA_TITLE.subtitleZh}</p>
    <h3>事实边界</h3>
    ${boundary}
    ${notes}
    ${comparison}
    <h3>已知的未知（页面不猜测）</h3>
    <ul class="source-list">${NOVANTA_KNOWN_UNKNOWNS.map((item) => `<li>${renderInlineMarkup(item)}</li>`).join('')}</ul>
    <div class="note">${NOVANTA_DISCLAIMER_TEXT}<br />${PUBLIC_SPECS_UI.noSimulation}</div>
  `;
}

const NOVANTA_DISCLAIMER_TEXT =
  '本模式是依据公开 ARGES 专利原理（DE102004053298B4）建立的教学重建，不是 PE III 实机内部结构的 CAD 复刻。' +
  '平板尺寸/厚度/折射率/间距、Galilei 望远镜焦距与放大倍率、物镜内部结构，以及当前 PE III 的真实机械布局均未公开。';

// ---------------------------------------------------------------- 状态订阅
state.onChange((snapshot) => {
  controls.update(snapshot);
  renderModeCard(snapshot);
  if (snapshot.tourStep !== null)
    controls.renderTour(snapshot.tourStep, TOUR_STEPS.length, TOUR_STEPS[snapshot.tourStep]);
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

  // 部件位姿
  chainView.update(snapshot.actuators, snapshot.trace);
  // 执行器外形开关（只影响外观，不影响光学与读数）
  chainView.setMotorsVisible(snapshot.toggles.showMotors);
  // 光束
  const beamOptions: BeamOptions = {
    showCenter: snapshot.toggles.showCenterRay,
    showEnvelope: snapshot.toggles.showEnvelope,
    showGhost: snapshot.toggles.showGhost,
    showNormals: snapshot.toggles.showNormals,
  };
  beamView.update(snapshot.trace, snapshot.ghostTrace, beamOptions);
  // 位移轨迹面板（仅 Novanta）
  if (snapshot.vendor === 'novanta' && offsetView) {
    const trace = snapshot.trace.trace as NovantaTrainTrace;
    offsetView.update(currentTrajectory(), { current: trace.wobble?.offsetVector ?? null });
    if (uiElapsed === 0) refreshOffsetReadout(trace);
  }
  // 只有加工策略改变才换料；暂停、视角、复位和循环均保留实体。
  workpieceView.selectSession(
    `${snapshot.process.mode}:${snapshot.process.mode === 'precession' ? snapshot.process.taper : ''}`,
  );
  if (state.processSpan && commonTrace(snapshot.trace).ok) {
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
    beamView.pushTrailPoint(commonTrace(snapshot.trace).focusPoint);
  }
  lastPhase = snapshot.theta;

  // 高亮 / 降透明度
  applyHighlight(highlightFor(snapshot));
};

function refreshOffsetReadout(trace: NovantaTrainTrace): void {
  const host = document.getElementById('offset-readout');
  if (!host || !trace.wobble) return;
  const traj = currentTrajectory();
  const w = trace.wobble;
  const rows = [
    ['驱动方式', precessionParams.driveMode === 'patent-sin-cos' ? 'Patent Simple Sin/Cos' : 'Compensated Circular Offset'],
    ['机械幅值 A', `${precessionParams.amplitudeDeg.toFixed(2)} °`],
    ['相位差', `${precessionParams.phaseDeg.toFixed(0)} °`],
    ['板 A 瞬时角', `${((w.tiltARad * 180) / Math.PI).toFixed(3)} °`],
    ['板 B 瞬时角', `${((w.tiltBRad * 180) / Math.PI).toFixed(3)} °`],
    ['Δx / Δy', `${w.offsetVector.x.toFixed(4)} / ${w.offsetVector.y.toFixed(4)} mm`],
    ['offset 半径', `${w.offsetRadiusMm.toFixed(4)} mm`],
    ['offset 方位角', `${w.offsetAzimuthDeg.toFixed(2)} °`],
    ['非圆度（半径相对偏差）', `${(traj.nonCircularity * 100).toFixed(3)} %`],
    ['理想圆半径', `${traj.meanRadiusMm.toFixed(4)} mm`],
  ];
  host.innerHTML = `<dl class="kv">${rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('')}</dl>`;
}

function applyExplosion(value: number): void {
  const novanta = state.vendor === 'novanta';
  const scanlabHeight = AXIS.housingTop - AXIS.housingBottom;
  const novantaHeight = NOVANTA_AXIS.housingTop - NOVANTA_AXIS.housingBottom;
  const zScale = novanta ? novantaHeight / scanlabHeight : 1;
  housingView.group.scale.set(
    (novanta ? 1.06 : 1) * (1 + 0.14 * value),
    (novanta ? 1.06 : 1) * (1 + 0.14 * value),
    zScale * (1 + 0.14 * value),
  );
  housingView.group.position.z = (novanta ? NOVANTA_AXIS.housingBottom - AXIS.housingBottom : 0) + 40 * value;
  // 拆开外围包络，保持镜片、光路、标签、工件共享同一坐标。
  housingView.group.position.x = 65 * value;
  workpieceView.group.position.z = 0;
  chainView.explode(value);
}

function highlightFor(snapshot: AppSnapshot): Set<string> | null {
  const step = snapshot.tourStep !== null ? TOUR_STEPS[snapshot.tourStep] : null;
  if (step) return new Set(step.highlight);
  const novanta = snapshot.vendor === 'novanta';
  switch (snapshot.mode) {
    case 'axes': {
      const map: Record<string, string[]> = novanta
        ? {
            x: ['novanta-galvo-x', 'objective'],
            y: ['novanta-galvo-y', 'novanta-galvo-x', 'objective'],
            z: ['novanta-telescope-negative', 'novanta-telescope-positive', 'objective'],
            alpha: ['novanta-plate-a', 'novanta-plate-b'],
            beta: ['novanta-plate-b', 'novanta-plate-a'],
          }
        : {
            x: ['galvo-x', 'objective'],
            y: ['galvo-y', 'galvo-x', 'objective'],
            z: ['z-galvo', 'z-curved', 'z-fold', 'objective'],
            alpha: ['alpha-movable-in', 'alpha-movable-out', 'alpha-fixed-1', 'alpha-fixed-2', 'alpha-mount'],
            beta: ['beta-movable-in', 'beta-movable-out', 'beta-fixed-1', 'beta-fixed-2', 'beta-mount'],
          };
      return new Set(map[snapshot.axisDemo] ?? []);
    }
    case 'linked':
      return new Set(
        novanta
          ? ['novanta-galvo-x', 'novanta-galvo-y', 'novanta-plate-a', 'novanta-plate-b', 'novanta-telescope-negative', 'objective']
          : ['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'z-curved', 'objective'],
      );
    case 'process':
      return new Set(
        novanta
          ? ['novanta-galvo-x', 'novanta-galvo-y', 'novanta-plate-a', 'novanta-plate-b', 'objective', 'workpiece']
          : ['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'objective', 'workpiece'],
      );
    case 'calibration':
      return new Set(
        novanta
          ? ['novanta-telescope-negative', 'novanta-telescope-positive']
          : ['monitor-splitter', 'position-sensor', 'alpha-movable-in', 'beta-movable-in'],
      );
    default:
      return null;
  }
}

/**
 * 高亮：被强调的部件保持原样，其余部件降低不透明度。
 * 每条路线自己实现（玻璃板必须保持透明材质，不能变成不透明）。
 */
function applyHighlight(highlight: Set<string> | null): void {
  chainView.setHighlight(highlight);
}

function updateFpsBadge(): void {
  const notes = document.getElementById('visual-notes');
  if (!notes) return;
  const novanta = state.vendor === 'novanta';
  notes.innerHTML = `
    <div>${
      novanta
        ? `光路轴向长度按教学需要拉开（非等比例）；官方外形图给出 PE III 总体高度约 549 mm，本模型场景高约 ${NOVANTA_AXIS.inlet} mm。`
        : PUBLIC_SPECS_UI.scaleNote
    }</div>
    <div>局部示意图放大显示焦点运动</div>
    ${novanta ? `<div>${VISUAL_GAIN_LABEL.novantaLensTravel}</div>` : ''}
    <div>${SLOW_MOTION_NOTE(state.snapshot())}</div>
    ${novanta ? '<div>玻璃材质的折射只用于视觉表现；光线路径与读数全部来自向量 Snell 追迹</div>' : ''}
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
ensureOffsetView();
ensurePrecessionPanel();
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
      /** 当前路线的部件视图（切换路线后会替换）。 */
      chain: () => ChainView;
      /** Novanta 进动参数（调试用）。 */
      precession: () => PrecessionParams;
      setPrecession: (patch: Partial<PrecessionParams>) => void;
    };
  }
}
window.__PRECSYS__ = {
  state,
  workpiece: workpieceView,
  sceneView,
  chain: () => chainView,
  precession: () => precessionParams,
  setPrecession: (patch) => {
    precessionParams = { ...precessionParams, ...patch };
    precessionCache = null;
  },
  /**
   * 分组引用用 getter：`optics` 会随技术路线切换而换成新建的分组，
   * 直接存值会在切换后指向已摘除的旧分组（调试脚本会因此数错电机）。
   */
  groups: {
    get optics() {
      return chainView.group;
    },
    housing: housingView.group,
    workpiece: workpieceView.group,
    beam: beamHolder,
    labels: labelsHolder,
    axes: axesHelper,
  },
};
