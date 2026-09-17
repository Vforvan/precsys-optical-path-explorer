/**
 * Z 动态调焦等效模块。
 *
 * 计划书 §9.5 明确要求：公开资料没有给出 precSYS Z 轴的完整生产结构，
 * 因此本模块采用"功能真实、结构抽象"的反射式等效模型，页面固定标注：
 *
 *   「此处为动态调焦功能等效模型，展示"改变物镜前光束会聚状态 → 改变焦点 Z"
 *     的关系，不代表 precSYS 内部真实镜组排布。」
 *
 * 模型内部做到三件事：
 *   1. 可动折转镜受执行器驱动真实偏转，光线按反射定律逐面计算；
 *   2. 折返镜法向由"入射方向 → 目标方向 -Z"解出，输出严格沿 -Z
 *      （实机由控制器保证同一效果）；
 *   3. 变焦反射镜曲率随执行器信号在"凸—平—凹"之间变化，直接实现
 *      "改变物镜前光束会聚度"；输出会聚度 = 2·cos(入射角)/R。
 *
 * 曲率随信号变化的规律、镜面口径与排布均为教学等效，公开资料未给出。
 */

import { Vector3 } from 'three';
import {
  DEG,
  clamp,
  intersectPlane,
  makeRay,
  mirrorVergenceKick,
  radToDeg,
  reflect,
  type Ray,
} from './ray';
import { intersectMirror, mirrorNormal, type MirrorSpec } from './mirror';
import { FOCUS_MODULE, OBJECTIVE } from '../config/layout';

/** 执行器角（度）→ 变焦镜功率（1/mm）。δ = 0 时镜面为平面。 */
export const FOCUS_POWER_PER_DEG = FOCUS_MODULE.powerPerDeg;

export interface FocusModuleGeometry {
  id: string;
  label: string;
  /** 可动折转镜（执行器驱动，绕 Y 轴）。 */
  galvo: MirrorSpec;
  /** 变焦反射镜（曲率随信号变化）。 */
  curved: MirrorSpec;
  /** 折返镜（法向由几何解出，保证输出沿 -Z）。 */
  fold: MirrorSpec;
  anchor: Vector3;
  armMm: number;
  dropMm: number;
  /** 模块输出到物镜入瞳的距离 mm（用于会聚度传播换算）。 */
  distanceToPupilMm: number;
}

/** 建立 Z 模块。anchor = 可动折转镜中心（位于模块上游光轴上）。 */
export function createFocusModule(
  anchor: Vector3,
  distanceToPupilMm: number,
  armMm = FOCUS_MODULE.armMm,
  dropMm = FOCUS_MODULE.dropMm,
): FocusModuleGeometry {
  const yAxis = new Vector3(0, 1, 0);
  const size = { u: FOCUS_MODULE.mirrorSizeMm, v: FOCUS_MODULE.mirrorSizeMm };

  // 折转镜：把 -Z 折向 +X，法向朝上来迎着光束
  const galvoNormal = new Vector3(1, 0, 1).normalize();
  const galvo: MirrorSpec = {
    id: 'z-galvo',
    label: 'Z 可动折转镜（执行器驱动）',
    kind: 'movable',
    center: anchor.clone(),
    normal: galvoNormal,
    u: new Vector3(1, 0, -1).normalize(),
    v: yAxis.clone(),
    size,
    rotationAxis: yAxis.clone(),
    angleRad: 0,
    trust: '教学等效',
    note:
      'Z 模块内的可动折转镜。转角改变光束在变焦反射镜上的落点，并改变输出光束的会聚状态。',
    interactive: true,
  };

  // 变焦反射镜：位于 anchor + (arm, 0, 0)，把光束折回折返镜
  const curvedCenter = anchor.clone().add(new Vector3(armMm, 0, 0));
  const outDir = anchor
    .clone()
    .add(new Vector3(0, 0, -dropMm))
    .sub(curvedCenter)
    .normalize();
  const curvedNormal = new Vector3(1, 0, 0).sub(outDir).normalize().negate();
  const curved: MirrorSpec = {
    id: 'z-curved',
    label: '变焦反射镜（曲率随信号变化）',
    kind: 'curved',
    center: curvedCenter,
    normal: curvedNormal,
    u: yAxis.clone(),
    v: new Vector3().crossVectors(curvedNormal, yAxis).normalize(),
    size,
    radiusOfCurvature: Number.POSITIVE_INFINITY,
    trust: '教学等效',
    note:
      '教学等效件：曲率随 Z 执行器信号在凸—平—凹之间变化，改变物镜前光束的会聚状态，从而移动焦点 Z。实机内部结构未公开。',
    interactive: true,
  };

  // 折返镜：名义法向由入射方向解出（渲染姿态用，追迹时每帧重算）
  const nominalDir2 = curvedCenter
    .clone()
    .add(new Vector3(0, 0, -dropMm))
    .sub(curvedCenter)
    .normalize();
  void nominalDir2;
  const foldNormal = outDir
    .clone()
    .sub(new Vector3(0, 0, -1))
    .normalize()
    .negate();
  const fold: MirrorSpec = {
    id: 'z-fold',
    label: 'Z 折返镜（随动）',
    kind: 'movable',
    center: anchor.clone().add(new Vector3(0, 0, -dropMm)),
    normal: foldNormal,
    u: new Vector3().crossVectors(yAxis, foldNormal).normalize(),
    v: yAxis.clone(),
    size,
    rotationAxis: yAxis.clone(),
    angleRad: 0,
    trust: '教学等效',
    note: '折返镜组的第二片，随动后使输出光束严格沿 -Z 出射；实机由控制器实现同一功能。',
    interactive: true,
  };

  return {
    id: 'z-focus-module',
    label: 'Z 动态调焦等效模块',
    galvo,
    curved,
    fold,
    anchor: anchor.clone(),
    armMm,
    dropMm,
    distanceToPupilMm,
  };
}

/** 执行器机械角（度）→ 变焦镜曲率半径（mm）：正角 = 凹（会聚），负角 = 凸（发散）。 */
export function focusMirrorRadius(actuatorDeg: number): number {
  const power = FOCUS_POWER_PER_DEG * actuatorDeg;
  if (Math.abs(power) < 1e-12) return Number.POSITIVE_INFINITY;
  return 1 / power;
}

/** 模块输出光束的会聚度（1/mm，正 = 会聚）。 */
export function focusModuleVergence(actuatorDeg: number, incidenceRad: number): number {
  return mirrorVergenceKick(incidenceRad, focusMirrorRadius(actuatorDeg));
}

/** 把模块输出会聚度传播到物镜入瞳（自由空间传播）。 */
export function vergenceAtPupil(moduleVergence: number, distanceMm: number): number {
  const denom = 1 - moduleVergence * distanceMm;
  if (Math.abs(denom) < 1e-12) return Math.sign(moduleVergence) * 1e12;
  return moduleVergence / denom;
}

/** 物镜后焦点相对工件表面的高度：z = 75 - 1/(1/75 + v/M²)。 */
export function focusZFromPupilVergence(pupilVergence: number): number {
  const m2 = OBJECTIVE.internalMagnification ** 2;
  const inv = 1 / OBJECTIVE.backFocalLengthMm + pupilVergence / m2;
  if (Math.abs(inv) < 1e-12) return Number.NEGATIVE_INFINITY;
  return OBJECTIVE.backFocalLengthMm - 1 / inv;
}

/** 由目标焦点高度反推物镜入瞳处需要的会聚度。 */
export function pupilVergenceForFocusZ(zMm: number): number {
  const m2 = OBJECTIVE.internalMagnification ** 2;
  const imageDistance = OBJECTIVE.backFocalLengthMm - zMm;
  if (Math.abs(imageDistance) < 1e-9) return Number.POSITIVE_INFINITY;
  return m2 * (1 / imageDistance - 1 / OBJECTIVE.backFocalLengthMm);
}

/** 变焦镜的名义入射角（取锐角，符号与追迹时的绝对值口径一致）。 */
export function nominalIncidenceRad(geom: FocusModuleGeometry): number {
  const cos = Math.abs(new Vector3(1, 0, 0).dot(mirrorNormal(geom.curved)));
  return Math.acos(Math.min(1, cos));
}

/** 由目标焦点高度反推 Z 执行器机械角（度）。会聚度随角度单调，用二分求解。 */
export function actuatorForFocusZ(
  geom: FocusModuleGeometry,
  zMm: number,
  rangeDeg = 3.2,
): number {
  const target = pupilVergenceForFocusZ(zMm);
  const inc = nominalIncidenceRad(geom);
  const evalAt = (deg: number) =>
    vergenceAtPupil(focusModuleVergence(deg, inc), geom.distanceToPupilMm) - target;
  let lo = -rangeDeg;
  let hi = rangeDeg;
  let fLo = evalAt(lo);
  const fHi = evalAt(hi);
  if (fLo * fHi > 0) return clamp(zMm > 0 ? hi : lo, lo, hi);
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = evalAt(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export interface FocusTraceResult {
  /** 折转镜、变焦镜、折返镜命中点。 */
  points: [Vector3, Vector3, Vector3];
  output: Ray;
  /** 变焦镜入射角（弧度）。 */
  incidenceRad: number;
  /** 变焦镜落点相对名义中心的偏移 mm。 */
  spotOffsetMm: number;
  /** 模块输出会聚度 1/mm。 */
  vergence: number;
}

/** 追迹 Z 模块：可动折转镜 → 变焦镜 → 折返镜 → 输出（严格 -Z）。 */
export function traceFocusModule(
  geom: FocusModuleGeometry,
  input: Ray,
  actuatorDeg: number,
): FocusTraceResult | null {
  const galvoSpec: MirrorSpec = { ...geom.galvo, angleRad: actuatorDeg * DEG };
  const hitGalvo = intersectMirror(galvoSpec, input);
  if (!hitGalvo) return null;
  const ray1 = makeRay(hitGalvo.point, reflect(input.direction, mirrorNormal(galvoSpec)));

  const hitCurved = intersectMirror(geom.curved, ray1);
  if (!hitCurved) return null;
  const dir2 = reflect(ray1.direction, mirrorNormal(geom.curved));

  // 折返镜法向 = 入射方向与目标方向(-Z)的角平分线 → 输出严格沿 -Z
  const targetDir = new Vector3(0, 0, -1);
  const foldNormal = dir2.clone().sub(targetDir).normalize();
  const ray2 = makeRay(hitCurved.point, dir2);
  const t = intersectPlane(ray2, geom.fold.center, foldNormal);
  if (t === null || t <= 0) return null;
  const hitFold = ray2.origin.clone().addScaledVector(ray2.direction, t);
  const output = makeRay(hitFold, reflect(dir2, foldNormal));

  return {
    points: [hitGalvo.point, hitCurved.point, hitFold],
    output,
    incidenceRad: hitCurved.incidenceAngleRad,
    spotOffsetMm: hitCurved.point.distanceTo(geom.curved.center),
    vergence: focusModuleVergence(actuatorDeg, hitCurved.incidenceAngleRad),
  };
}

/** 折返镜当前机械角（度），仅用于渲染姿态与运动箭头。 */
export function foldMirrorAngleDeg(dir2: Vector3): number {
  const targetDir = new Vector3(0, 0, -1);
  const normal = dir2.clone().sub(targetDir).normalize();
  return radToDeg(Math.atan2(normal.x, -normal.z));
}
