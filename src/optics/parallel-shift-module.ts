/**
 * α / β 平行移束模块（parallel shifting unit）—— 教学等效模型。
 *
 * 与专利 EP3932609B1 的对应（权利要求 1/3/4/5，说明书 [0015][0030][0032]）：
 *   至少三镜；一镜可转（26，振镜驱动）、两镜固定（28、30）；可选法向共面；
 *   光束反射四次；第 1 次（入）与第 4 次（出）都落在可转镜 26 上。
 *
 * 模型内部结构（局部坐标，输出点即第 4 次命中点 B）：
 *
 *       入光 (-Z)
 *          │
 *          A ◄── 可动镜组第 1 块镜面（第 1 次反射）
 *           ╲
 *            F1 ── 固定镜 1（平面 x + z = c1）
 *            │
 *            │   ← 这一段穿过可动镜组所在区域，但走的是两块镜面之间的空档
 *            │
 *            F2 ── 固定镜 2（同法向，平面 x + z = c2）
 *           ╱
 *          B ◄── 可动镜组第 2 块镜面（第 4 次反射）
 *          │
 *       出光 (-Z) = 模块输出点
 *
 * 三条可验证的结论（tests/parallel-shift.test.ts 逐条断言）：
 *   1. 两固定镜法向相同，两次反射对方向的作用互相抵消。这与专利的关系式
 *      定性描述相符。本模型由反射定律推导 φ_out = φ_in + 2(θ28 − θ30)，不是专利公式。
 *   2. 所以输出方向与输入方向严格平行、与可动镜转角无关；
 *      转角只改变横向位移量（量级 2Δ mm/rad，Δ = c1 − c2），
 *      即专利所说的"相对光轴 oA 的平行偏移"。
 *   3. 本模型 F1→F2 段会经过两可动镜面所在的平面；须校验有限光束包络避让。
 *      专利未规定可动镜的背面、开孔或让位结构，本模型选取同一支架上的
 *      两块平行镜面及法向台阶。四个独立反射面只能演示功能，不能宣称
 *      已复原专利的单镜 26，更不能据此证明实机必须分体或背面入射。
 */

import { Vector3 } from 'three';
import { DEG, clamp, intersectPlane, makeRay, propagate, reflect, type Ray, type BeamEnvelope } from './ray';
import { intersectMirror, mirrorAxes, mirrorCenter, mirrorNormal, type MirrorSpec } from './mirror';
import { SHIFT_INPUT_OFFSET_MM, SHIFT_MODULE } from '../config/layout';

export type ShiftAxis = 'alpha' | 'beta';

/** 两固定镜平面方程常数差；实际法向间距为 STATIC_DELTA/√2。 */
export const STATIC_DELTA = SHIFT_MODULE.delta;

/** 模块所需入光横向偏移（含台阶造成的附加偏移）。 */
export const INPUT_OFFSET_MM = SHIFT_INPUT_OFFSET_MM;

export interface ShiftModuleGeometry {
  id: string;
  label: string;
  axis: ShiftAxis;
  /** 移束方向（世界坐标，单位向量）：α 沿 +X，β 沿 +Y。 */
  sAxis: Vector3;
  /** 光轴方向（世界 +Z）。 */
  zAxis: Vector3;
  /** 可动镜名义法向。 */
  n0: Vector3;
  /** 可动镜旋转轴 = zAxis × sAxis。 */
  rotAxis: Vector3;
  /** 镜面内、由第 1 次命中点指向第 4 次命中点的方向。 */
  e1: Vector3;
  /** 第 1 次命中点（δ = 0），同时是旋转支点。 */
  A: Vector3;
  /** 模块输出点（δ = 0 时的第 4 次命中点）。 */
  outputPoint: Vector3;
  /** δ = 0 时输出相对 A 的横向距离（即静态移束量，也是位移的零点基准）。 */
  staticOffsetMm: number;
  /** 可动镜组第 1 块镜面（承受第 1 次反射）。 */
  movableIn: MirrorSpec;
  /** 可动镜组第 2 块镜面（承受第 4 次反射）。 */
  movableOut: MirrorSpec;
  fixed1: MirrorSpec;
  fixed2: MirrorSpec;
  /** 两块可动镜面之间的法向台阶 mm。 */
  stepMm: number;
}

export interface ShiftCrossing {
  tile: 'in' | 'out';
  point: Vector3;
  /** 穿越点是否落在该镜片有效口径内（应为 false）。 */
  insideAperture: boolean;
  /** 穿越点距该镜片中心的距离 mm。 */
  distanceFromCenterMm: number;
  beamRadiusMm: number;
  /** 镜面内的保守分离距离，已扣除斜入射足迹、板厚投影与安全余量。 */
  clearanceMm: number;
  envelopeClear: boolean;
}

export interface ShiftTraceResult {
  input: Ray;
  /** 四次反射命中点：A、F1、F2、B。 */
  points: [Vector3, Vector3, Vector3, Vector3];
  /** 输出光线（起点 B，方向与输入平行）。 */
  output: Ray;
  /** 输入与输出方向夹角，度（应≈0）。 */
  directionDeviationDeg: number;
  /** 输出相对 δ = 0 的横向位移 mm（沿 sAxis）。 */
  displacementMm: number;
  /** 光束在 F1→F2 段与两块可动镜面所在平面的交点（用于验证不穿镜片）。 */
  crossings: ShiftCrossing[];
  /** 第 4 次命中点沿镜面距 A 的距离 mm（用于选镜片长度）。 */
  hitDistanceFromAMm: number;
  /** 穿越点沿镜面距 A 的距离 mm。 */
  crossingDistancesFromAMm: number[];
  /** 两镜片沿共同 u 轴的边缘间距；不是法向台阶 stepMm。 */
  gapWidthMm: number;
}

const Z_AXIS = new Vector3(0, 0, 1);

/**
 * 建立平行移束模块。
 * @param axis 'alpha' 沿 +X 移束，'beta' 沿 +Y 移束
 * @param outputPoint δ = 0 时的输出点（模块下游光轴上的点）
 * @param inputOffsetMm 入光相对输出点的横向偏移（沿 sAxis），默认按几何解出
 */
export function createShiftModule(
  axis: ShiftAxis,
  outputPoint: Vector3,
  inputOffsetMm = INPUT_OFFSET_MM,
): ShiftModuleGeometry {
  const sAxis = axis === 'alpha' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const zAxis = Z_AXIS.clone();
  const n0 = sAxis.clone().add(zAxis).normalize();
  // 专利未规定，本模型选取垂直于单元光路平面的转轴。
  const rotAxis = zAxis.clone().cross(sAxis).normalize();
  const e1 = sAxis.clone().sub(zAxis).normalize();
  const e2 = rotAxis.clone();

  const step = SHIFT_MODULE.stepMm;
  const root2 = Math.SQRT2;

  // A 在第 1 块镜面所在平面上：该平面相对输出点所在的第 2 块镜面平面沿 n0 后退 step
  const A = outputPoint
    .clone()
    .addScaledVector(sAxis, inputOffsetMm)
    .addScaledVector(zAxis, -(inputOffsetMm + step * root2));

  // 命中点（δ = 0）：A → F1 → F2 → B
  const t1 = SHIFT_MODULE.c1 + step * root2;
  const t2 = SHIFT_MODULE.c1 - SHIFT_MODULE.c2;
  const t3 = -SHIFT_MODULE.c2;
  const P1 = A.clone().addScaledVector(sAxis, t1);
  const P2 = P1.clone().addScaledVector(zAxis, -t2);
  const B = P2.clone().addScaledVector(sAxis, t3);

  const fixedSize = {
    u: SHIFT_MODULE.fixedMirrorSize,
    v: SHIFT_MODULE.fixedMirrorSize,
  };

  const movableIn: MirrorSpec = {
    id: `${axis}-movable-in`,
    label: axis === 'alpha' ? 'α 可动镜组 · 入光镜面' : 'β 可动镜组 · 入光镜面',
    kind: 'movable',
    center: A.clone(),
    normal: n0.clone(),
    u: e1.clone(),
    v: e2.clone(),
    size: { u: SHIFT_MODULE.inTileSizeMm, v: SHIFT_MODULE.plateWidth },
    rotationAxis: rotAxis.clone(),
    rotationPivot: A.clone(),
    angleRad: 0,
    trust: '教学等效',
    note:
      '可动镜组的第 1 块镜面，承受第 1 次反射。它与第 2 块镜面装在同一振镜支架上、法向相同、沿法向错开一个很小的台阶（教学等效处理）。',
    interactive: true,
  };

  const movableOut: MirrorSpec = {
    id: `${axis}-movable-out`,
    label: axis === 'alpha' ? 'α 可动镜组 · 出光镜面' : 'β 可动镜组 · 出光镜面',
    kind: 'movable',
    center: B.clone(),
    normal: n0.clone(),
    u: e1.clone(),
    v: e2.clone(),
    size: { u: SHIFT_MODULE.outTileSizeMm, v: SHIFT_MODULE.plateWidth },
    rotationAxis: rotAxis.clone(),
    rotationPivot: A.clone(),
    angleRad: 0,
    trust: '教学等效',
    note:
      '可动镜组的第 2 块镜面，承受第 4 次反射，也就是模块的出光反射点。转角改变它上面落点的位置，从而改变输出光束的横向位移。',
    interactive: true,
  };

  const fixed1: MirrorSpec = {
    id: `${axis}-fixed-1`,
    label: axis === 'alpha' ? 'α 固定镜 1' : 'β 固定镜 1',
    kind: 'fixed',
    center: P1.clone(),
    normal: n0.clone(),
    u: e1.clone(),
    v: e2.clone(),
    size: fixedSize,
    trust: '专利原理',
    note: '固定镜功能对应专利 28，把光束折向固定镜 30；本页的尺寸、法向和位置为教学几何。',
    interactive: true,
  };

  const fixed2: MirrorSpec = {
    id: `${axis}-fixed-2`,
    label: axis === 'alpha' ? 'α 固定镜 2' : 'β 固定镜 2',
    kind: 'fixed',
    center: P2.clone(),
    normal: n0.clone(),
    u: e1.clone(),
    v: e2.clone(),
    size: fixedSize,
    trust: '专利原理',
    note:
      '固定平行镜对的第二块（专利 30），与第一块法向相同。两次反射对方向的作用互相抵消，是"输出方向不变、只改变位移"的关键。',
    interactive: true,
  };

  return {
    id: `${axis}-shift-module`,
    label: axis === 'alpha' ? 'α 平行移束模块' : 'β 平行移束模块',
    axis,
    sAxis,
    zAxis,
    n0,
    rotAxis,
    e1,
    A,
    outputPoint: B.clone(),
    staticOffsetMm: -inputOffsetMm,
    movableIn,
    movableOut,
    fixed1,
    fixed2,
    stepMm: step,
  };
}

function specAt(spec: MirrorSpec, angleRad: number): MirrorSpec {
  return { ...spec, angleRad };
}

/** 判断点是否在某镜片有效口径内。 */
function crossingClearance(spec: MirrorSpec, point: Vector3, direction: Vector3,
  beamRadiusMm: number, safetyMm: number): ShiftCrossing {
  const center = mirrorCenter(spec);
  const { u: e1, v: e2 } = mirrorAxes(spec);
  const offset = point.clone().sub(center);
  const alongU = Math.abs(offset.dot(e1));
  const alongV = Math.abs(offset.dot(e2));
  const dn = Math.abs(direction.dot(mirrorNormal(spec)));
  // 圆截面斜穿镜面变成椭圆；按两个局部轴的包围区间做保守分离判定。
  // 板厚用两侧最坏投影，不依赖显示层的法向翻转。
  const margin = (axis: Vector3, distance: number, halfSize: number) => {
    const slope = Math.abs(direction.dot(axis)) / Math.max(dn, 1e-12);
    return distance - halfSize - beamRadiusMm * Math.hypot(1, slope)
      - SHIFT_MODULE.plateThickness * slope - safetyMm;
  };
  const clearanceMm = Math.max(margin(e1, alongU, spec.size.u / 2),
    margin(e2, alongV, spec.size.v / 2));
  return {
    tile: spec.id.endsWith('in') ? 'in' : 'out',
    point: point.clone(),
    insideAperture: alongU <= spec.size.u / 2 && alongV <= spec.size.v / 2,
    distanceFromCenterMm: offset.length(),
    beamRadiusMm,
    clearanceMm,
    envelopeClear: clearanceMm >= 0,
  };
}

/** 用反射定律逐面追迹一次完整的四次反射；任一次求交失败返回 null。 */
export function traceShiftModule(
  geom: ShiftModuleGeometry,
  input: Ray,
  deltaRad: number,
  inputEnvelope: BeamEnvelope = { radius: 1, vergence: 0 },
  safetyMm = 0.25,
): ShiftTraceResult | null {
  const inSpec = specAt(geom.movableIn, deltaRad);
  const outSpec = specAt(geom.movableOut, deltaRad);

  const hitA = intersectMirror(inSpec, input);
  if (!hitA) return null;
  const ray1 = makeRay(hitA.point, reflect(input.direction, mirrorNormal(inSpec)));

  const hitF1 = intersectMirror(geom.fixed1, ray1);
  if (!hitF1) return null;
  const ray2 = makeRay(hitF1.point, reflect(ray1.direction, mirrorNormal(geom.fixed1)));

  const hitF2 = intersectMirror(geom.fixed2, ray2);
  if (!hitF2) return null;
  const ray3 = makeRay(hitF2.point, reflect(ray2.direction, mirrorNormal(geom.fixed2)));

  const hitB = intersectMirror(outSpec, ray3);
  if (!hitB) return null;
  if (hitB.point.distanceTo(hitA.point) < 1e-3) return null;
  const output = makeRay(hitB.point, reflect(ray3.direction, mirrorNormal(outSpec)));

  // 诊断：F1→F2 段是否穿过任一可动镜片
  const crossings: ShiftCrossing[] = [];
  const toF1 = input.origin.distanceTo(hitA.point) + hitA.point.distanceTo(hitF1.point);
  const segmentLength = hitF1.point.distanceTo(hitF2.point);
  // 对整段取最大半径，保守覆盖板厚内的包络变化；同时记录交点处实际半径。
  const maxRadius = Math.max(propagate(inputEnvelope, toF1).radius,
    propagate(inputEnvelope, toF1 + segmentLength).radius);
  for (const spec of [inSpec, outSpec]) {
    const t = intersectPlane(ray2, mirrorCenter(spec), mirrorNormal(spec));
    if (t !== null && t > 0 && t < segmentLength) {
      const p = ray2.origin.clone().addScaledVector(ray2.direction, t);
      const crossing = crossingClearance(spec, p, ray2.direction, maxRadius, safetyMm);
      crossing.beamRadiusMm = propagate(inputEnvelope, toF1 + t).radius;
      crossings.push(crossing);
    }
  }

  const deviation =
    (Math.acos(
      clamp(
        Math.abs(
          input.direction.clone().normalize().dot(output.direction.clone().normalize()),
        ),
        -1,
        1,
      ),
    ) *
      180) /
    Math.PI;

  const displacement =
    hitB.point.dot(geom.sAxis) - geom.A.dot(geom.sAxis) - geom.staticOffsetMm;

  return {
    input,
    points: [hitA.point, hitF1.point, hitF2.point, hitB.point],
    output,
    directionDeviationDeg: deviation,
    displacementMm: displacement,
    crossings,
    hitDistanceFromAMm: hitB.point.clone().sub(hitA.point).dot(geom.e1),
    crossingDistancesFromAMm: crossings.map((c) => c.point.clone().sub(geom.A).dot(geom.e1)),
    gapWidthMm: Math.abs(mirrorCenter(outSpec).sub(mirrorCenter(inSpec)).dot(mirrorAxes(inSpec).u))
      - (inSpec.size.u + outSpec.size.u) / 2,
  };
}

/** 构造模块入光光线（与建模块时的约定一致）。 */
export function moduleInputRay(geom: ShiftModuleGeometry, fromAboveMm = 120): Ray {
  const origin = geom.A.clone().addScaledVector(geom.zAxis, fromAboveMm);
  return makeRay(origin, geom.zAxis.clone().multiplyScalar(-1));
}

/** 模块在给定机械角下的移束量（相对 δ = 0，mm）。 */
export function shiftDisplacement(geom: ShiftModuleGeometry, deltaRad: number): number {
  const traced = traceShiftModule(geom, moduleInputRay(geom), deltaRad);
  return traced ? traced.displacementMm : Number.NaN;
}

/** 用二分法把目标移束量换算为可动镜机械角（弧度）。映射单调。 */
export function deltaForShift(
  geom: ShiftModuleGeometry,
  targetDisplacementMm: number,
  rangeDeg = SHIFT_MODULE.mechanicalRangeDeg,
): number {
  let lo = -rangeDeg * DEG;
  let hi = rangeDeg * DEG;
  const fLo = shiftDisplacement(geom, lo) - targetDisplacementMm;
  const fHi = shiftDisplacement(geom, hi) - targetDisplacementMm;
  if (fLo > 0 || fHi < 0) {
    // 超出模块行程：夹到端点（UI 会提示超限）
    return fLo > 0 ? lo : hi;
  }
  for (let i = 0; i < 44; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = shiftDisplacement(geom, mid) - targetDisplacementMm;
    if (fMid === 0) return mid;
    if (fMid > 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

/** 模块可动镜全行程对应的移束范围。 */
export function shiftRange(
  geom: ShiftModuleGeometry,
  rangeDeg = SHIFT_MODULE.mechanicalRangeDeg,
): { minMm: number; maxMm: number } {
  return {
    minMm: shiftDisplacement(geom, -rangeDeg * DEG),
    maxMm: shiftDisplacement(geom, rangeDeg * DEG),
  };
}

/** 模块内全部镜片（渲染与拾取用）。 */
export function shiftModuleMirrors(geom: ShiftModuleGeometry): MirrorSpec[] {
  return [geom.movableIn, geom.movableOut, geom.fixed1, geom.fixed2];
}
