/**
 * 光束渲染。
 *
 * 光束几何完全来自光学层的追迹结果（每段有起点、终点、两端半径），
 * 因此画面上的折线就是真实反射计算的结果，没有任何手工摆放的假光路。
 *
 * 采用对象池：预分配若干"圆台"网格，每帧只改位置/朝向/缩放，
 * 避免每帧新建几何体导致的卡顿（计划书 §18.3 要求 50–60 FPS）。
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
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { TrainTrace } from '../optics/optical-train';
import { OBJECTIVE, AXIS } from '../config/layout';
import { COLORS, VISUAL_GAIN } from '../config/visual-scale';
import type { SceneMaterials } from './create-scene';

const POOL_SIZE = 40;
const UP = new Vector3(0, 1, 0);

export interface BeamOptions {
  showCenter: boolean;
  showEnvelope: boolean;
  showGhost: boolean;
  /** 显示每个反射点的镜面法线（"垂线"）与镜面切向短线。 */
  showNormals: boolean;
}

export interface BeamView {
  group: Group;
  /** 焦点标记。 */
  focusMarker: Mesh;
  /** 进动轨迹尾迹。 */
  trail: Line;
  update(trace: TrainTrace, ghost: TrainTrace | null, options: BeamOptions): void;
  /** 追加轨迹点（加工演示用）。 */
  pushTrailPoint(point: Vector3): void;
  clearTrail(): void;
  setTrailColor(color: string): void;
}

interface SegmentSlot {
  core: Mesh;
  envelope: Mesh;
}

function makeSlot(_materials: SceneMaterials, radiusScale = 1): SegmentSlot {
  const core = new Mesh(new CylinderGeometry(1, 1, 1, 14, 1, true), new MeshBasicMaterial({
    color: COLORS.beamMain, toneMapped: false,
  }));
  core.visible = false;
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
  envelope.visible = false;
  void radiusScale;
  return { core, envelope };
}

function placeCylinder(
  mesh: Mesh,
  from: Vector3,
  to: Vector3,
  radiusFrom: number,
  radiusTo: number,
  visualRadiusGain = 1.6,
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
  const rf = Math.max(0.06, radiusFrom * visualRadiusGain);
  const rt = Math.max(0.06, radiusTo * visualRadiusGain);
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

/** 等半径的一段圆柱（法线指示、镜面切向短线用）。 */
function placeRod(mesh: Mesh, from: Vector3, to: Vector3): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  mesh.scale.set(1, len, 1);
}

export function createBeamView(materials: SceneMaterials): BeamView {
  const group = new Group();
  const slots: SegmentSlot[] = [];
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const slot = makeSlot(materials);
    slots.push(slot);
    group.add(slot.core, slot.envelope);
  }

  const ghostMaterial = new LineBasicMaterial({
    color: new Color(COLORS.beamGhost),
    transparent: true,
    opacity: 0.55,
  });
  const ghostGeometry = new BufferGeometry();
  ghostGeometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(POOL_SIZE * 3 * 3), 3),
  );
  ghostGeometry.setDrawRange(0, 0);
  const ghostLine = new Line(ghostGeometry, ghostMaterial);
  ghostLine.visible = false;
  group.add(ghostLine);

  // 命中点标记 + 镜面法线指示：
  // 每个反射点画一个小球（命中点）、一条沿镜面法向的实体短线（"垂线"，
  // 用圆柱而不是 Line，保证在任何缩放下都看得见），以及一条沿镜面方向的横线。
  // 这样"入射光线与法线的夹角 = 反射光线与法线的夹角"可以直接量出来。
  const hitMarkers: { sphere: Mesh; normalRod: Mesh; surfaceRod: Mesh }[] = [];
  const NORMAL_LENGTH = 16;
  for (let i = 0; i < 20; i += 1) {
    const sphere = new Mesh(
      new SphereGeometry(1.2, 14, 12),
      new MeshBasicMaterial({ color: 0xfff27a }),
    );
    sphere.visible = false;
    const normalRod = new Mesh(
      new CylinderGeometry(0.42, 0.42, 1, 10),
      new MeshBasicMaterial({ color: 0x6ff2ff }),
    );
    normalRod.visible = false;
    const surfaceRod = new Mesh(
      new CylinderGeometry(0.3, 0.3, 1, 10),
      new MeshBasicMaterial({ color: 0xcfe0f2, transparent: true, opacity: 0.75 }),
    );
    surfaceRod.visible = false;
    hitMarkers.push({ sphere, normalRod, surfaceRod });
    group.add(sphere, normalRod, surfaceRod);
  }

  const focusMarker = new Mesh(
    new SphereGeometry(0.35, 16, 12),
    new MeshStandardMaterial({
      color: new Color(COLORS.focus),
      emissive: new Color(COLORS.focus),
      emissiveIntensity: 3.4,
    }),
  );
  group.add(focusMarker);

  // 物镜后光锥（入瞳处 1 mm → 内部 3 mm → 焦点）
  const coneMaterial = new MeshBasicMaterial({ color: COLORS.beamMain, transparent: true,
    opacity: 0.2, depthWrite: false, toneMapped: false });
  const internalCone = new Mesh(new CylinderGeometry(1, 1, 1, 20, 1, true), coneMaterial);
  const focusCone = new Mesh(new CylinderGeometry(1, 1, 1, 24, 1, true), coneMaterial);
  const relayCone = new Mesh(new CylinderGeometry(1, 1, 1, 20, 1, true), coneMaterial);
  group.add(internalCone, relayCone, focusCone);
  const objectiveRays = Array.from({ length: 3 }, () => makeSlot(materials).core);
  group.add(...objectiveRays);

  const trailGeometry = new BufferGeometry();
  const maxTrail = 4000;
  trailGeometry.setAttribute('position', new BufferAttribute(new Float32Array(maxTrail * 3), 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new Line(
    trailGeometry,
    new LineBasicMaterial({ color: new Color(COLORS.ablation) }),
  );
  group.add(trail);

  let trailCount = 0;

  const update = (trace: TrainTrace, ghost: TrainTrace | null, options: BeamOptions) => {
    const segments = trace.segments;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const segment = segments[i];
      if (!segment) {
        slot.core.visible = false;
        slot.envelope.visible = false;
        continue;
      }
      placeCylinder(slot.core, segment.from, segment.to, 0.18, 0.18, 1);
      slot.core.visible = options.showCenter;
      if (options.showEnvelope) {
        placeCylinder(
          slot.envelope,
          segment.from,
          segment.to,
          segment.radiusFrom,
          segment.radiusTo,
          1,
        );
        slot.envelope.visible = true;
      } else {
        slot.envelope.visible = false;
      }
    }

    // 命中点与镜面法线（实体短线，任何缩放下都看得见）
    for (let i = 0; i < hitMarkers.length; i += 1) {
      const marker = hitMarkers[i];
      const hit = options.showNormals ? trace.hits[i] : undefined;
      if (!hit) {
        marker.sphere.visible = false;
        marker.normalRod.visible = false;
        marker.surfaceRod.visible = false;
        continue;
      }
      marker.sphere.visible = true;
      marker.sphere.position.copy(hit.point);

      // 法线：从镜面上方 -0.3L 画到 +L
      const normal = hit.normal.clone().normalize();
      const na = hit.point.clone().addScaledVector(normal, -NORMAL_LENGTH * 0.3);
      const nb = hit.point.clone().addScaledVector(normal, NORMAL_LENGTH);
      placeRod(marker.normalRod, na, nb);
      marker.normalRod.visible = true;

      // 镜面内的横线：与法线垂直，帮助确认"镜面朝向"
      const tangent = new Vector3(0, 0, 1);
      if (Math.abs(tangent.dot(normal)) > 0.9) tangent.set(1, 0, 0);
      tangent.crossVectors(normal, tangent).normalize();
      const sa = hit.point.clone().addScaledVector(tangent, -NORMAL_LENGTH * 0.42);
      const sb = hit.point.clone().addScaledVector(tangent, NORMAL_LENGTH * 0.42);
      placeRod(marker.surfaceRod, sa, sb);
      marker.surfaceRod.visible = true;
    }

    // 幽灵光路（零位）
    if (ghost && options.showGhost) {
      const points: number[] = [];
      for (const p of ghost.chiefPoints) points.push(p.x, p.y, p.z);
      const attr = ghostLine.geometry.getAttribute('position') as BufferAttribute;
      const array = attr.array as Float32Array;
      if (array.length < points.length) {
        ghostLine.geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(points), 3),
        );
        ghostLine.geometry.setDrawRange(0, points.length / 3);
      } else {
        array.set(points);
        attr.needsUpdate = true;
        ghostLine.geometry.setDrawRange(0, points.length / 3);
      }
      ghostLine.geometry.computeBoundingSphere();
      ghostLine.visible = true;
    } else {
      ghostLine.visible = false;
    }

    // 物镜后光锥
    const focus = trace.focusPoint;
    const internalR = Math.max(0.15, trace.pupil.radiusMm * OBJECTIVE.internalMagnification);
    const pupilPoint = trace.chiefPoints[trace.chiefPoints.length - 1].clone();
    const lensPoint = new Vector3(
      focus.x - Math.tan(trace.focus.aoiXDeg * Math.PI / 180) * (AXIS.objectiveLastLens - focus.z),
      focus.y - Math.tan(trace.focus.aoiYDeg * Math.PI / 180) * (AXIS.objectiveLastLens - focus.z),
      AXIS.objectiveLastLens);
    const relayPoint = pupilPoint.clone().lerp(lensPoint, 0.35);
    placeCylinder(
      internalCone,
      pupilPoint,
      relayPoint,
      trace.pupil.radiusMm,
      internalR,
      1.0,
    );
    placeCylinder(
      focusCone,
      lensPoint,
      focus,
      internalR,
      0.08,
      1.0,
    );
    placeCylinder(relayCone, relayPoint, lensPoint, internalR, internalR, 1);
    internalCone.visible = trace.ok && options.showEnvelope;
    relayCone.visible = internalCone.visible;
    focusCone.visible = internalCone.visible;
    focusMarker.visible = trace.ok;
    const vertices = [pupilPoint, relayPoint, lensPoint, focus];
    objectiveRays.forEach((mesh, i) => {
      placeCylinder(mesh, vertices[i], vertices[i + 1], 0.18, 0.18, 1);
      mesh.visible = trace.ok && options.showCenter;
    });

    focusMarker.position.copy(focus);
    const markerScale = 1 + 0.12 * Math.sin(performance.now() / 160);
    focusMarker.scale.setScalar(markerScale);
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
    focusMarker,
    trail,
    update,
    pushTrailPoint,
    clearTrail: () => {
      trailCount = 0;
      trail.geometry.setDrawRange(0, 0);
    },
    setTrailColor: (color: string) => {
      (trail.material as LineBasicMaterial).color = new Color(color);
    },
  };
}

export const __beamVisualNotes = {
  zFocusGain: VISUAL_GAIN.zFocus,
  vergenceGain: VISUAL_GAIN.vergence,
};
