/**
 * 三透镜移动光学件 Z 模块。
 * varioSCAN II p2 公开 moving/fixed optics；CN113319425A Fig.4 描述凸/凹/凸，
 * L2 固定、L1/L3 轴向移动。焦距、间距及单参数联动是教学选取，非 precSYS 结构。
 * 光焦度固定，改变的是间距；不使用随信号变化的曲率反射镜。
 */
import { Vector3 } from 'three';
import { clamp, intersectPlane, makeRay, propagate, type BeamEnvelope, type Ray } from './ray';
import type { MirrorSpec } from './mirror';
import { FOCUS_MODULE, OBJECTIVE } from '../config/layout';

export interface FocusLens extends MirrorSpec { focalLengthMm: number }

export interface FocusModuleGeometry {
  id: string;
  label: string;
  anchor: Vector3;
  lenses: [FocusLens, FocusLens, FocusLens];
  distanceToPupilMm: number;
}

export interface FocusTraceResult {
  points: [Vector3, Vector3, Vector3];
  lenses: [FocusLens, FocusLens, FocusLens];
  output: Ray;
  envelope: BeamEnvelope;
  envelopesBefore: [BeamEnvelope, BeamEnvelope, BeamEnvelope];
  envelopesAfter: [BeamEnvelope, BeamEnvelope, BeamEnvelope];
  vergence: number;
  d12Mm: number;
  d23Mm: number;
  l1TravelMm: number;
  l3TravelMm: number;
  apertureClear: boolean;
}

/** anchor 是固定 L2 光学中心，distanceToPupilMm 从零位 L3 计。 */
export function createFocusModule(anchor: Vector3, distanceToPupilMm: number): FocusModuleGeometry {
  const lenses = FOCUS_MODULE.focalLengthsMm.map((focalLengthMm, i): FocusLens => ({
    id: `z-l${i + 1}`,
    label: `Z · L${i + 1} ${i === 1 ? '固定凹透镜' : '移动凸透镜'}`,
    kind: 'lens',
    center: anchor.clone().add(new Vector3(0, 0, (1 - i) * FOCUS_MODULE.spacingMm)),
    normal: new Vector3(0, 0, 1),
    u: new Vector3(1, 0, 0), v: new Vector3(0, 1, 0),
    size: { u: FOCUS_MODULE.lensDiameterMm, v: FOCUS_MODULE.lensDiameterMm },
    focalLengthMm,
    trust: '教学等效',
    note: '方案见 CN113319425A Fig.4；焦距、尺寸、安装位置和 L1/L3 单指令联动是模型选择，不是 precSYS 实机镜组。',
    interactive: true,
  })) as FocusModuleGeometry['lenses'];
  return { id: 'z-focus-module', label: 'Z 三透镜移动调焦模块', anchor: anchor.clone(), lenses, distanceToPupilMm };
}

/** q 是 L3 沿光束方向的行程 mm；L1 反向移动 q/4，只有一个独立自由度。 */
export function focusLensesAt(geom: FocusModuleGeometry, qMm: number): FocusModuleGeometry['lenses'] {
  return geom.lenses.map((lens, i) => ({ ...lens,
    center: lens.center.clone().add(new Vector3(0, 0,
      i === 0 ? FOCUS_MODULE.l1TravelRatio * qMm : i === 2 ? -qMm : 0)),
  })) as FocusModuleGeometry['lenses'];
}

/** 空气中理想薄透镜的近轴折射；倾斜与轴向平移不是同一个动作。 */
export function refractFocusLens(input: Ray, point: Vector3, lens: FocusLens): Ray {
  const dz = -input.direction.z;
  const hx = point.x - lens.center.x, hy = point.y - lens.center.y;
  return makeRay(point, new Vector3(input.direction.x / dz - hx / lens.focalLengthMm,
    input.direction.y / dz - hy / lens.focalLengthMm, -1));
}

/** 逐片更新主光线与光束包络；两个间距都参与会聚度计算。 */
export function traceFocusModule(geom: FocusModuleGeometry, input: Ray, qMm: number,
  inputEnvelope: BeamEnvelope = { radius: 1, vergence: 0 }): FocusTraceResult | null {
  if (!Number.isFinite(qMm) || input.direction.z >= -1e-9) return null;
  const lenses = focusLensesAt(geom, qMm);
  const points: Vector3[] = [], before: BeamEnvelope[] = [], after: BeamEnvelope[] = [];
  let ray = input, envelope = { ...inputEnvelope }, apertureClear = true;
  for (const lens of lenses) {
    const t = intersectPlane(ray, lens.center, lens.normal);
    if (t === null || t <= 1e-6) return null;
    const point = ray.origin.clone().addScaledVector(ray.direction, t);
    // 近轴传播沿光轴计距，与薄透镜 ABCD 约定一致。
    const distance = ray.origin.z - point.z;
    if (1 - envelope.vergence * distance <= 0) return null;
    envelope = propagate(envelope, distance);
    before.push({ ...envelope });
    points.push(point);
    const decenter = Math.hypot(point.x - lens.center.x, point.y - lens.center.y);
    apertureClear &&= decenter + envelope.radius + 0.25 <= lens.size.u / 2;
    envelope = { radius: envelope.radius, vergence: envelope.vergence + 1 / lens.focalLengthMm };
    after.push({ ...envelope });
    ray = refractFocusLens(ray, point, lens);
  }
  return { points: points as FocusTraceResult['points'], lenses, output: ray, envelope,
    envelopesBefore: before as FocusTraceResult['envelopesBefore'],
    envelopesAfter: after as FocusTraceResult['envelopesAfter'], vergence: envelope.vergence,
    d12Mm: lenses[0].center.z - lenses[1].center.z,
    d23Mm: lenses[1].center.z - lenses[2].center.z,
    l1TravelMm: FOCUS_MODULE.l1TravelRatio * qMm, l3TravelMm: -qMm, apertureClear };
}

export function vergenceAtPupil(moduleVergence: number, distanceMm: number): number {
  const denom = 1 - moduleVergence * distanceMm;
  if (Math.abs(denom) < 1e-12) return Math.sign(moduleVergence) * 1e12;
  return moduleVergence / denom;
}

/** 保留物镜等效换算：z = 75 - 1/(1/75 + v/M²)。 */
export function focusZFromPupilVergence(pupilVergence: number): number {
  const m2 = OBJECTIVE.internalMagnification ** 2;
  const inv = 1 / OBJECTIVE.backFocalLengthMm + pupilVergence / m2;
  if (Math.abs(inv) < 1e-12) return Number.NEGATIVE_INFINITY;
  return OBJECTIVE.backFocalLengthMm - 1 / inv;
}

export function pupilVergenceForFocusZ(zMm: number): number {
  const m2 = OBJECTIVE.internalMagnification ** 2;
  const imageDistance = OBJECTIVE.backFocalLengthMm - zMm;
  if (Math.abs(imageDistance) < 1e-9) return Number.POSITIVE_INFINITY;
  return m2 * (1 / imageDistance - 1 / OBJECTIVE.backFocalLengthMm);
}

/** 由目标 Z 估计 L3 行程；最终五轴联动仍通过全链路求解。 */
export function actuatorForFocusZ(geom: FocusModuleGeometry, zMm: number,
  rangeMm: number = FOCUS_MODULE.maxTravelMm): number {
  const target = pupilVergenceForFocusZ(zMm);
  const input = makeRay(geom.anchor.clone().add(new Vector3(0, 0, 40)), new Vector3(0, 0, -1));
  const evalAt = (q: number) => {
    const traced = traceFocusModule(geom, input, q)!;
    return vergenceAtPupil(traced.vergence, geom.distanceToPupilMm - q) - target;
  };
  let lo = -rangeMm, hi = rangeMm;
  if (evalAt(lo) >= 0) return lo;
  if (evalAt(hi) <= 0) return hi;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (evalAt(mid) > 0) hi = mid; else lo = mid;
  }
  return clamp((lo + hi) / 2, -rangeMm, rangeMm);
}
