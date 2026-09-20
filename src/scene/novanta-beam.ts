/**
 * Novanta 路线的光束渲染 + 位移轨迹面板。
 *
 * 与 SCANLAB 的光束渲染共用同一套对象池思路，但有两点必须不同：
 *
 *  1. **玻璃内光路**：两段"在玻璃里"的光线要单独着色（青白色），
 *     这样"第一界面折射 → 玻璃内传播 → 第二界面出射"三步在画面上分得清；
 *  2. **位移轨迹面板**（Top View 用的独立小场景）：把
 *       · 当前 offset 向量
 *       · 一整圈实测轨迹
 *       · 理想圆
 *     画在同一平面上，让"两板只绕各自正交轴摆动、但 offset 向量绕光轴旋转"
 *     一眼可见。面板里的点全部来自 samplePrecessionTrajectory()，
 *     与主视口的光路来自同一次追迹模型。
 *
 * 所有坐标都来自 NovantaTrainTrace；这里不推算任何光学量。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { NovantaTrainTrace } from '../optics/novanta-optical-train';
import type { PrecessionTrajectory } from '../optics/dual-plate-precession';
import { NOVANTA_AXIS } from '../config/novanta-layout';
import { COLORS } from '../config/visual-scale';
import type { SceneMaterials } from './create-scene';
import type { AnyTrainTrace } from '../app-state';
import type { BeamOptions, BeamViewLike } from './chain-view';

const POOL_SIZE = 24;
const UP = new Vector3(0, 1, 0);

interface Slot {
  core: Mesh;
  envelope: Mesh;
}

function placeCylinder(
  mesh: Mesh,
  from: Vector3,
  to: Vector3,
  radiusFrom: number,
  radiusTo: number,
  gain = 1,
): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  const rf = Math.max(0.06, radiusFrom * gain);
  const rt = Math.max(0.06, radiusTo * gain);
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position') as BufferAttribute;
  if (!geometry.userData.unitPositions) {
    geometry.userData.unitPositions = Float32Array.from(position.array);
  }
  const unit = geometry.userData.unitPositions as Float32Array;
  for (let i = 0; i < position.count; i += 1) {
    const y = unit[i * 3 + 1];
    const radius = rf + (rt - rf) * (y + 0.5);
    position.setXYZ(i, unit[i * 3] * radius, y * len, unit[i * 3 + 2] * radius);
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** 主视口的光束：逐段画折线，玻璃内单独着色。 */
export function createNovantaBeamView(_materials: SceneMaterials): BeamViewLike {
  const group = new Group();
  const slots: Slot[] = [];
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const core = new Mesh(
      new CylinderGeometry(1, 1, 1, 14, 1, true),
      new MeshBasicMaterial({ color: COLORS.beamMain, toneMapped: false }),
    );
    const envelope = new Mesh(
      new CylinderGeometry(1, 1, 1, 16, 1, true),
      new MeshBasicMaterial({
        color: new Color(COLORS.beamMain),
        transparent: true,
        opacity: 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    core.visible = false;
    envelope.visible = false;
    slots.push({ core, envelope });
    group.add(core, envelope);
  }

  /** 玻璃内光路单独一批（青白色），与空气段区分。 */
  const glassSlots: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const mesh = new Mesh(
      new CylinderGeometry(1, 1, 1, 12, 1, true),
      new MeshBasicMaterial({
        color: 0xbdf3ff,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    glassSlots.push(mesh);
    group.add(mesh);
  }

  const ghostGeometry = new BufferGeometry();
  ghostGeometry.setAttribute('position', new BufferAttribute(new Float32Array(POOL_SIZE * 3 * 3), 3));
  ghostGeometry.setDrawRange(0, 0);
  const ghostLine = new Line(
    ghostGeometry,
    new LineBasicMaterial({ color: new Color(COLORS.beamGhost), transparent: true, opacity: 0.5 }),
  );
  ghostLine.visible = false;
  group.add(ghostLine);

  // 命中点 + 界面法线（折射界面与反射面都画，便于核对入射角）
  const markers: { sphere: Mesh; rod: Mesh }[] = [];
  const NORMAL_LENGTH = 14;
  for (let i = 0; i < 14; i += 1) {
    const sphere = new Mesh(new SphereGeometry(1.1, 12, 10), new MeshBasicMaterial({ color: 0xfff27a }));
    const rod = new Mesh(
      new CylinderGeometry(0.4, 0.4, 1, 10),
      new MeshBasicMaterial({ color: 0x6ff2ff }),
    );
    sphere.visible = false;
    rod.visible = false;
    markers.push({ sphere, rod });
    group.add(sphere, rod);
  }

  // 焦点标记
  const focusMarker = new Mesh(
    new SphereGeometry(0.32, 16, 12),
    new MeshBasicMaterial({ color: new Color(COLORS.focus), toneMapped: false }),
  );
  group.add(focusMarker);

  // 物镜后光锥
  const coneMaterial = new MeshBasicMaterial({
    color: COLORS.beamMain,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    toneMapped: false,
  });
  const focusCone = new Mesh(new CylinderGeometry(1, 1, 1, 24, 1, true), coneMaterial);
  group.add(focusCone);

  // 轨迹尾迹
  const trailGeometry = new BufferGeometry();
  const maxTrail = 4000;
  trailGeometry.setAttribute('position', new BufferAttribute(new Float32Array(maxTrail * 3), 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new Line(trailGeometry, new LineBasicMaterial({ color: new Color(COLORS.ablation) }));
  group.add(trail);

  let trailCount = 0;

  const update = (traceRaw: AnyTrainTrace, ghostRaw: AnyTrainTrace | null, options: BeamOptions): void => {
    if (traceRaw.vendor !== 'novanta') return;
    const trace: NovantaTrainTrace = traceRaw.trace;

    // ---- 逐段光路
    let coreIndex = 0;
    let glassIndex = 0;
    for (const segment of trace.segments) {
      if (segment.medium === 'glass') {
        const mesh = glassSlots[glassIndex];
        if (mesh) {
          placeCylinder(mesh, segment.from, segment.to, 0.16, 0.16, 1);
          mesh.visible = options.showCenter;
          glassIndex += 1;
        }
        continue;
      }
      const slot = slots[coreIndex];
      if (!slot) continue;
      placeCylinder(slot.core, segment.from, segment.to, 0.16, 0.16, 1);
      slot.core.visible = options.showCenter;
      if (options.showEnvelope) {
        placeCylinder(slot.envelope, segment.from, segment.to, segment.radiusFrom, segment.radiusTo, 1);
        slot.envelope.visible = true;
      } else {
        slot.envelope.visible = false;
      }
      coreIndex += 1;
    }
    for (let i = coreIndex; i < slots.length; i += 1) {
      slots[i].core.visible = false;
      slots[i].envelope.visible = false;
    }
    for (let i = glassIndex; i < glassSlots.length; i += 1) glassSlots[i].visible = false;

    // ---- 命中点与法线
    for (let i = 0; i < markers.length; i += 1) {
      const marker = markers[i];
      const hit = options.showNormals ? trace.hits[i] : undefined;
      if (!hit) {
        marker.sphere.visible = false;
        marker.rod.visible = false;
        continue;
      }
      marker.sphere.visible = true;
      marker.sphere.position.copy(hit.point);
      const normal = hit.normal.clone().normalize();
      const a = hit.point.clone().addScaledVector(normal, -NORMAL_LENGTH * 0.3);
      const b = hit.point.clone().addScaledVector(normal, NORMAL_LENGTH);
      placeCylinder(marker.rod, a, b, 0.4, 0.4, 1);
      marker.rod.visible = true;
    }

    // ---- 幽灵光路（零位）
    if (ghostRaw && ghostRaw.vendor === 'novanta' && options.showGhost) {
      const points: number[] = [];
      for (const p of ghostRaw.trace.chiefPoints) points.push(p.x, p.y, p.z);
      if (points.length / 3 <= POOL_SIZE) {
        const attr = ghostLine.geometry.getAttribute('position') as BufferAttribute;
        const array = attr.array as Float32Array;
        array.set(points);
        attr.needsUpdate = true;
        ghostLine.geometry.setDrawRange(0, points.length / 3);
        ghostLine.geometry.computeBoundingSphere();
        ghostLine.visible = true;
      }
    } else {
      ghostLine.visible = false;
    }

    // ---- 物镜后光锥
    const focus = trace.focusPoint;
    const internalR = Math.max(0.2, trace.pupil.radiusMm);
    const lensZ = NOVANTA_AXIS.objectiveLastLens;
    const lensPoint = new Vector3(
      focus.x - Math.tan((trace.focus.aoiXDeg * Math.PI) / 180) * (lensZ - focus.z),
      focus.y - Math.tan((trace.focus.aoiYDeg * Math.PI) / 180) * (lensZ - focus.z),
      lensZ,
    );
    placeCylinder(focusCone, lensPoint, focus, internalR, 0.08, 1);
    focusCone.visible = trace.ok && options.showEnvelope;
    focusMarker.visible = trace.ok;
    focusMarker.position.copy(focus);
    focusMarker.scale.setScalar(1 + 0.12 * Math.sin(performance.now() / 160));
  };

  const pushTrailPoint = (point: Vector3) => {
    if (trailCount >= maxTrail) return;
    const attr = trail.geometry.getAttribute('position') as BufferAttribute;
    const array = attr.array as Float32Array;
    array[trailCount * 3] = point.x;
    array[trailCount * 3 + 1] = point.y;
    array[trailCount * 3 + 2] = point.z;
    trailCount += 1;
    attr.needsUpdate = true;
    trail.geometry.setDrawRange(0, trailCount);
    trail.geometry.computeBoundingSphere();
  };

  return {
    group,
    update,
    pushTrailPoint,
    clearTrail: () => {
      trailCount = 0;
      trail.geometry.setDrawRange(0, 0);
    },
  };
}

/* ------------------------------------------------------------------ *
 * 位移轨迹面板（Dual-Plate Top View 的核心）
 * ------------------------------------------------------------------ */

export interface OffsetView {
  /** 面板容器（挂到页面上）。 */
  domElement: HTMLCanvasElement;
  /** 用新的轨迹数据刷新。 */
  update(trajectory: PrecessionTrajectory, live: { current: Vector3 | null }): void;
  dispose(): void;
}

/**
 * 画"两板倾斜如何合成一个绕光轴旋转的位移向量"。
 *
 * 平面是光束横截面（X–Y），视线沿 −Z（与机器光轴同向）：
 *   · 灰色虚线 = 理想圆（半径取实测平均半径）
 *   · 橙色线 = 实测轨迹（来自 samplePrecessionTrajectory）
 *   · 青色箭头 = 当前 offset 向量
 *   · 十字 = 光轴（offset = 0）
 */
export function createOffsetView(): OffsetView {
  const size = 240;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'offset-view-canvas';

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(size, size, false);

  const scene = new Scene();
  const span = 2.6;
  const camera = new OrthographicCamera(-span, span, span, -span, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  /** 把 (x, y) 位移映射到面板坐标（+X 向右、+Y 向上）。 */
  const toWorld = (v: Vector3) => new Vector3(v.x, v.y, 0);

  const maxPoints = 720;
  const actualGeometry = new BufferGeometry();
  actualGeometry.setAttribute('position', new BufferAttribute(new Float32Array(maxPoints * 3), 3));
  actualGeometry.setDrawRange(0, 0);
  const actualLine = new Line(
    actualGeometry,
    new LineBasicMaterial({ color: 0xff9d5c, linewidth: 2 }),
  );
  scene.add(actualLine);

  const circleGeometry = new BufferGeometry();
  circleGeometry.setAttribute('position', new BufferAttribute(new Float32Array(maxPoints * 3), 3));
  circleGeometry.setDrawRange(0, 0);
  const circleLine = new Line(
    circleGeometry,
    new LineBasicMaterial({ color: 0x8fa2b8, transparent: true, opacity: 0.8 }),
  );
  scene.add(circleLine);

  // 光轴十字
  const axes = new Group();
  for (const [dx, dy] of [
    [span, 0],
    [0, span],
  ]) {
    const g = new BufferGeometry().setFromPoints([
      new Vector3(-dx, -dy, 0),
      new Vector3(dx, dy, 0),
    ]);
    axes.add(new Line(g, new LineBasicMaterial({ color: 0x415066 })));
  }
  scene.add(axes);

  // 当前 offset 向量（从光轴到当前位移点）
  const arrowMaterial = new MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false });
  const arrow = new Mesh(new CylinderGeometry(0.035, 0.035, 1, 8), arrowMaterial);
  const arrowTip = new Mesh(new SphereGeometry(0.07, 12, 10), arrowMaterial);
  scene.add(arrow, arrowTip);

  let animation = 0;
  let disposed = false;

  const update = (trajectory: PrecessionTrajectory, live: { current: Vector3 | null }): void => {
    if (disposed) return;

    // 实测轨迹
    const pts = trajectory.points;
    const actualAttr = actualGeometry.getAttribute('position') as BufferAttribute;
    const actualArray = actualAttr.array as Float32Array;
    for (let i = 0; i < pts.length && i < maxPoints; i += 1) {
      actualArray[i * 3] = pts[i].x;
      actualArray[i * 3 + 1] = pts[i].y;
      actualArray[i * 3 + 2] = 0;
    }
    actualAttr.needsUpdate = true;
    actualGeometry.setDrawRange(0, Math.min(pts.length, maxPoints));

    // 理想圆
    const circle = trajectory.nominalCircle;
    const circleAttr = circleGeometry.getAttribute('position') as BufferAttribute;
    const circleArray = circleAttr.array as Float32Array;
    for (let i = 0; i < circle.length && i < maxPoints; i += 1) {
      circleArray[i * 3] = circle[i].x;
      circleArray[i * 3 + 1] = circle[i].y;
      circleArray[i * 3 + 2] = 0;
    }
    circleAttr.needsUpdate = true;
    circleGeometry.setDrawRange(0, Math.min(circle.length, maxPoints));

    // 当前 offset 向量
    const current = live.current;
    if (current && current.lengthSq() > 1e-12) {
      const tip = toWorld(current);
      arrow.visible = true;
      arrowTip.visible = true;
      placeCylinder(arrow, new Vector3(0, 0, 0), tip, 0.035, 0.035, 1);
      arrowTip.position.copy(tip);
    } else {
      arrow.visible = false;
      arrowTip.visible = false;
    }

    renderer.render(scene, camera);
    void animation;
  };

  return {
    domElement: canvas,
    update,
    dispose: () => {
      disposed = true;
      renderer.dispose();
      actualGeometry.dispose();
      circleGeometry.dispose();
    },
  };
}
