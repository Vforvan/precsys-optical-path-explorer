/**
 * 双平行板 wobble unit 与进动轨迹（Novanta / ARGES 路线）。
 *
 * 公开依据（DE102004053298B4）：
 *   · wobble unit = 两块 plane-parallel window，都可转动；
 *   · **两转轴互相正交，且都与激光传播方向正交**；
 *   · 倾斜靠折射产生平行于传播方向的横向位移，出射光仍与入射光平行；
 *   · 两板联合 → 任意方向的平行位移；
 *   · 一板按 sin、另一板按相移 sin 倾斜 → Lissajous（圆 / 椭圆），
 *     "改变幅值或相位差即改变轨迹"；
 *   · 简单 sin/cos 驱动**不是精确圆**：专利原文说"deviation is about one percent
 *     at the used tilt angles of about 18°"。
 *
 * 本文件的严格边界：
 *   1. 两板**只绕各自的正交横向轴倾斜**，绝不绕光轴连续自转（禁止伪造进动）；
 *   2. 位移量一律来自 tracePlate() 的真实折射追迹，不用解析公式替代；
 *   3. 简单 sin/cos 模式下**不声称**能生成数学上完美的圆，页面同时给出实测
 *      非圆度；"精确圆补偿"模式是**教学逆解**，不是厂商控制器算法。
 */

import { Vector3 } from 'three';
import { DEG, clamp, makeRay, radToDeg, type Ray } from './ray';
import {
  createParallelPlate,
  plateShiftAt,
  tracePlate,
  withinPlateTiltLimit,
  type ParallelPlateGeometry,
  type PlatePose,
} from './plane-parallel-plate';
import {
  NOVANTA_AXIS,
  NOVANTA_BEAM_PATH,
  NOVANTA_PLATES,
  NOVANTA_PRECESSION,
} from '../config/novanta-layout';

/** 双板 wobble unit 的几何。 */
export interface WobbleUnitGeometry {
  id: string;
  label: string;
  /** 板 A：绕 X 轴倾斜，位移沿 Y。 */
  plateA: ParallelPlateGeometry;
  /** 板 B：绕 Y 轴倾斜，位移沿 X。 */
  plateB: ParallelPlateGeometry;
  /** 名义光轴（世界坐标，即 -Z）。 */
  beamAxis: Vector3;
  /** 两块板之间的轴向间距 mm。 */
  spacingMm: number;
  /** 模块名义入光（沿 -Z、位于机器光轴上）。 */
  nominalInput: Ray;
}

export type PrecessionDriveMode = 'patent-sin-cos' | 'compensated-circle';

export interface PrecessionParams {
  /** 机械倾斜幅值（度）。补偿模式下作为逆解的起点，不直接决定结果位移。 */
  amplitudeDeg: number;
  /** 两板驱动之间的相位差（度）；90° 对应近似圆。 */
  phaseDeg: number;
  /** 驱动方式。 */
  driveMode: PrecessionDriveMode;
  /** 补偿模式的目标位移半径 mm（沿两轴一致）。 */
  targetRadiusMm: number;
}

export const DEFAULT_PRECESSION: PrecessionParams = {
  amplitudeDeg: NOVANTA_PRECESSION.amplitudeDeg,
  phaseDeg: NOVANTA_PRECESSION.phaseDeg,
  driveMode: 'patent-sin-cos',
  targetRadiusMm: NOVANTA_PRECESSION.targetRadiusMm,
};

/** 一次进动相位下的完整状态。 */
export interface PrecessionSample {
  phaseRad: number;
  /** 板 A 机械倾角（弧度）。 */
  tiltARad: number;
  /** 板 B 机械倾角（弧度）。 */
  tiltBRad: number;
  /** 板 A 姿态（真实折射追迹结果）。 */
  poseA: PlatePose;
  /** 板 B 姿态。 */
  poseB: PlatePose;
  /** 经过两板后的主光线（起点在板 B 出射面）。 */
  outputRay: Ray;
  /** 模块输出处的合位移向量（mm，世界坐标系；只含 x、y 分量）。 */
  offsetVector: Vector3;
  /** 位移大小 mm。 */
  offsetRadiusMm: number;
  /** 位移方位角（度，atan2(Δy, Δx)）。 */
  offsetAzimuthDeg: number;
  /** 板 A 单独的位移（沿 Y，mm）。 */
  shiftAMm: number;
  /** 板 B 单独的位移（沿 X，mm）。 */
  shiftBMm: number;
  /** 该相位下三块光学面是否都在口径内。 */
  apertureClear: boolean;
  /**
   * 该相位下是否有板的机械角被教学行程夹住（补偿模式的目标达不到时）。
   * 与 apertureClear 分开报告：一个是"装不下"，一个是"转不到"。
   */
  tiltSaturated: boolean;
}

/** 一整圈轨迹与圆度指标。 */
export interface PrecessionTrajectory {
  sampleCount: number;
  /** 逐点位移向量（世界坐标，z 分量为 0）。 */
  points: Vector3[];
  /** 轨迹半径序列（mm）。 */
  radiiMm: number[];
  /** 半径平均值 mm。 */
  meanRadiusMm: number;
  /** 半径最大值 / 最小值 mm。 */
  maxRadiusMm: number;
  minRadiusMm: number;
  /**
   * 非圆度（半径相对偏差峰值，小数）：(max − min) / mean。
   * 简单 sin/cos 驱动下**必然大于 0**，因为位移对倾角是非线性的。
   */
  nonCircularity: number;
  /** 首末点间距 mm；理想闭合轨迹应为 0。 */
  closureErrorMm: number;
  /** 理想圆（半径 = meanRadiusMm）用于对照绘制。 */
  nominalCircle: Vector3[];
  /** 全部采样是否都在口径内、追迹都成功。 */
  ok: boolean;
  /** 是否有采样点的机械角被教学行程夹住（目标位移超出可达范围）。 */
  tiltSaturated: boolean;
  /** 机械倾角最大值（度），用于和专利提到的约 18° 对照。 */
  maxTiltDeg: number;
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/**
 * 建立双板 wobble unit。
 *
 * 板 A 绕 X 轴倾斜（横向位移沿 Y），板 B 绕 Y 轴倾斜（横向位移沿 X）——
 * 即专利要求的"两转轴互相正交且都与传播方向正交"。
 * 【教学等效】"哪块板对应哪根正交轴"是教学空间排布；专利只规定两轴正交且垂直于光轴。
 */
export function createWobbleUnit(): WobbleUnitGeometry {
  // 两块板位于 scanblock **上游**的竖直光路段上，因此用 upstreamAxis 而不是机器光轴。
  const axisX = NOVANTA_BEAM_PATH.upstreamAxis.x;
  const axisY = NOVANTA_BEAM_PATH.upstreamAxis.y;

  const plateA = createParallelPlate({
    id: 'novanta-plate-a',
    label: '平行平板 A（绕 X 轴倾斜 → 位移沿 Y）',
    driveAxis: 'A',
    rotationAxis: X_AXIS,
    pivot: new Vector3(axisX, axisY, NOVANTA_AXIS.plateA),
  });

  const plateB = createParallelPlate({
    id: 'novanta-plate-b',
    label: '平行平板 B（绕 Y 轴倾斜 → 位移沿 X）',
    driveAxis: 'B',
    rotationAxis: Y_AXIS,
    pivot: new Vector3(axisX, axisY, NOVANTA_AXIS.plateB),
  });

  const nominalInput = makeRay(
    new Vector3(axisX, axisY, NOVANTA_AXIS.inlet),
    new Vector3(0, 0, -1),
  );

  return {
    id: 'novanta-wobble-unit',
    label: 'wobble unit —— 两块平行平面板',
    plateA,
    plateB,
    beamAxis: new Vector3(0, 0, -1),
    spacingMm: NOVANTA_PLATES.spacingMm,
    nominalInput,
  };
}

/** 板 A 当前姿态（给定倾斜）。 */
export function tracePlateA(unit: WobbleUnitGeometry, tiltRad: number, input?: Ray): PlatePose | null {
  return tracePlate(unit.plateA, input ?? unit.nominalInput, tiltRad);
}

/** 板 B 当前姿态：入光取板 A 的出射光。 */
export function tracePlateB(unit: WobbleUnitGeometry, tiltARad: number, tiltBRad: number): PlatePose | null {
  const a = tracePlateA(unit, tiltARad);
  if (!a) return null;
  return tracePlate(unit.plateB, a.outputRay, tiltBRad);
}

/** 命中点是否在板的有效口径内（含 1/e² 光束半径余量）。 */
function insideAperture(plate: ParallelPlateGeometry, pose: PlatePose, beamRadiusMm: number): boolean {
  const half = plate.apertureMm / 2;
  const offset = pose.entryHit.clone().sub(plate.pivot);
  const radial = Math.hypot(offset.dot(X_AXIS), offset.dot(Y_AXIS));
  return radial + beamRadiusMm <= half;
}

/**
 * 单板位移 → 机械倾角的数值逆解（二分法）。
 *
 * 映射在行程内单调，因此二分法必然收敛；超出可达行程时夹到端点，
 * 并由调用方通过返回值与目标比较判断是否饱和（不静默给出"看似成功"的结果）。
 */
export function tiltForPlateShift(
  plate: ParallelPlateGeometry,
  targetShiftMm: number,
  rangeDeg = NOVANTA_PLATES.maxMechanicalTiltDeg,
): { tiltRad: number; saturated: boolean } {
  if (!Number.isFinite(targetShiftMm)) return { tiltRad: 0, saturated: true };
  let lo = -rangeDeg * DEG;
  let hi = rangeDeg * DEG;
  const fLo = plateShiftAt(plate, lo) - targetShiftMm;
  const fHi = plateShiftAt(plate, hi) - targetShiftMm;
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return { tiltRad: 0, saturated: true };
  if (fLo > 0) return { tiltRad: lo, saturated: true };
  if (fHi < 0) return { tiltRad: hi, saturated: true };
  for (let i = 0; i < 52; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = plateShiftAt(plate, mid) - targetShiftMm;
    if (fMid === 0) return { tiltRad: mid, saturated: false };
    if (fMid > 0) hi = mid;
    else lo = mid;
  }
  return { tiltRad: (lo + hi) / 2, saturated: false };
}

/** 给定相位下的两板机械倾角。 */
export function plateTiltsForPhase(
  unit: WobbleUnitGeometry,
  phaseRad: number,
  params: PrecessionParams,
): { tiltARad: number; tiltBRad: number; saturated: boolean } {
  if (params.driveMode === 'compensated-circle') {
    // 目标：Δx = R cos φ、Δy = R sin φ（精确圆），逐板数值逆解机械角。
    // 注意：这是**教学补偿模型**；控制器实际算法未公开。
    const targetX = params.targetRadiusMm * Math.cos(phaseRad);
    const targetY = params.targetRadiusMm * Math.sin(phaseRad);
    const bx = tiltForPlateShift(unit.plateB, targetX);
    const ay = tiltForPlateShift(unit.plateA, targetY);
    return {
      tiltARad: ay.tiltRad,
      tiltBRad: bx.tiltRad,
      saturated: ay.saturated || bx.saturated,
    };
  }

  // 专利模式：一板 sin、另一板相移 sin。
  // 板 A 的位移沿 Y，故用 sin；板 B 的位移沿 X，故用 cos（相位差 90°）。
  const amplitudeRad = params.amplitudeDeg * DEG;
  const phaseShift = params.phaseDeg * DEG;
  const tiltARad = amplitudeRad * Math.sin(phaseRad);
  const tiltBRad = amplitudeRad * Math.sin(phaseRad + phaseShift);
  return {
    tiltARad,
    tiltBRad,
    saturated: !withinPlateTiltLimit(tiltARad) || !withinPlateTiltLimit(tiltBRad),
  };
}

/** 给定两板机械倾角，追迹并给出模块输出状态。 */
export function traceWobbleUnit(
  unit: WobbleUnitGeometry,
  tiltARad: number,
  tiltBRad: number,
  beamRadiusMm = 1,
): PrecessionSample | null {
  const poseA = tracePlateA(unit, tiltARad);
  if (!poseA) return null;
  const poseB = tracePlate(unit.plateB, poseA.outputRay, tiltBRad);
  if (!poseB) return null;

  const rawOffset = poseA.shiftVector.clone().add(poseB.shiftVector);
  // 位移与光线方向正交；这里把数值残差投影掉，保证 offset 是纯横向向量。
  const beam = unit.beamAxis;
  const offsetVector = rawOffset.addScaledVector(beam, -rawOffset.dot(beam));
  const radius = offsetVector.length();
  const azimuth = Math.atan2(
    offsetVector.dot(new Vector3(0, 1, 0)),
    offsetVector.dot(new Vector3(1, 0, 0)),
  );

  return {
    phaseRad: 0,
    tiltARad,
    tiltBRad,
    poseA,
    poseB,
    outputRay: poseB.outputRay,
    offsetVector,
    offsetRadiusMm: radius,
    offsetAzimuthDeg: radToDeg(azimuth),
    shiftAMm: poseA.signedShiftMm,
    shiftBMm: poseB.signedShiftMm,
    apertureClear:
      insideAperture(unit.plateA, poseA, beamRadiusMm) &&
      insideAperture(unit.plateB, poseB, beamRadiusMm),
    // 是否被行程夹住由调用方给出（见 precessionSampleAt）：
    // 单纯 traceWobbleUnit 只拿到两个机械角，无法判断"这是不是目标想要的角"。
    tiltSaturated: false,
  };
}

/** 取一个进动相位下的完整状态。 */
export function precessionSampleAt(
  unit: WobbleUnitGeometry,
  phaseRad: number,
  params: PrecessionParams = DEFAULT_PRECESSION,
  beamRadiusMm = 1,
): PrecessionSample | null {
  const tilts = plateTiltsForPhase(unit, phaseRad, params);
  const sample = traceWobbleUnit(unit, tilts.tiltARad, tilts.tiltBRad, beamRadiusMm);
  if (!sample) return null;
  sample.phaseRad = phaseRad;
  sample.tiltSaturated = tilts.saturated;
  return sample;
}

/**
 * 采样一整圈，得到轨迹与圆度指标。
 *
 * 只有在简单 sin/cos 驱动下 nonCircularity 才必然大于 0：
 * 位移对倾角是非线性的（正比于 t·sin(i−r)/cos r），
 * 因此即使两轴驱动严格是 sin/cos，合成位移也不会落在数学圆上。
 */
export function samplePrecessionTrajectory(
  unit: WobbleUnitGeometry,
  params: PrecessionParams = DEFAULT_PRECESSION,
  samples: number = NOVANTA_PRECESSION.samplesPerRevolution,
  beamRadiusMm = 1,
): PrecessionTrajectory {
  const count = Math.max(8, Math.floor(samples));
  const points: Vector3[] = [];
  const radii: number[] = [];
  let ok = true;
  let tiltSaturated = false;
  let maxTiltDeg = 0;

  for (let i = 0; i < count; i += 1) {
    const phase = (i / count) * 2 * Math.PI;
    const sample = precessionSampleAt(unit, phase, params, beamRadiusMm);
    if (!sample) {
      ok = false;
      continue;
    }
    points.push(sample.offsetVector.clone());
    radii.push(sample.offsetRadiusMm);
    maxTiltDeg = Math.max(
      maxTiltDeg,
      Math.abs(radToDeg(sample.tiltARad)),
      Math.abs(radToDeg(sample.tiltBRad)),
    );
    if (!sample.apertureClear) ok = false;
    if (sample.tiltSaturated) tiltSaturated = true;
  }

  if (radii.length === 0) {
    return {
      sampleCount: 0,
      points: [],
      radiiMm: [],
      meanRadiusMm: 0,
      maxRadiusMm: 0,
      minRadiusMm: 0,
      nonCircularity: 0,
      closureErrorMm: Number.NaN,
      nominalCircle: [],
      ok: false,
      tiltSaturated,
      maxTiltDeg: 0,
    };
  }

  const maxRadiusMm = Math.max(...radii);
  const minRadiusMm = Math.min(...radii);
  const meanRadiusMm = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const nonCircularity = meanRadiusMm > 1e-9 ? (maxRadiusMm - minRadiusMm) / meanRadiusMm : 0;

  // 闭合性：单独追迹相位 2π 的点与相位 0 的点比较。
  // 不能用"末点 − 首点"——采样从 0 到 2π 之前一点，末点与首点本来就差一个采样步。
  const wrap = precessionSampleAt(unit, 2 * Math.PI, params, beamRadiusMm);
  const closureErrorMm = wrap
    ? points[0].distanceTo(wrap.offsetVector)
    : Number.NaN;

  const nominalCircle: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const phase = (i / count) * 2 * Math.PI;
    nominalCircle.push(
      new Vector3(meanRadiusMm * Math.cos(phase), meanRadiusMm * Math.sin(phase), 0),
    );
  }

  /**
   * 补偿模式下还要检查"目标半径是否真的达到了"。
   *
   * `plateTiltsForPhase` 在超出行程时会把机械角夹到端点，
   * 此时追迹仍然成功、口径也可能仍然通过，但**位移比目标小**。
   * 那属于"转不到"，必须和"装不下"一样如实报告，不能显示成成功。
   */
  if (params.driveMode === 'compensated-circle' && params.targetRadiusMm > 1e-9) {
    const shortfall = (params.targetRadiusMm - meanRadiusMm) / params.targetRadiusMm;
    if (shortfall > 0.01) tiltSaturated = true;
  }

  return {
    sampleCount: points.length,
    points,
    radiiMm: radii,
    meanRadiusMm,
    maxRadiusMm,
    minRadiusMm,
    nonCircularity,
    closureErrorMm,
    nominalCircle,
    // ok 表示"这一圈能如实地做出来"：追迹成功、口径通过、且参数没有被行程夹住
    ok: ok && !tiltSaturated,
    tiltSaturated,
    maxTiltDeg,
  };
}

/** 模块输出光线在给定倾角下的横向位移（世界坐标向量）。 */
export function wobbleOffsetAt(
  unit: WobbleUnitGeometry,
  tiltARad: number,
  tiltBRad: number,
): Vector3 | null {
  const sample = traceWobbleUnit(unit, tiltARad, tiltBRad);
  return sample ? sample.offsetVector.clone() : null;
}

/** 把机械倾角夹进教学扫描范围（UI 滑杆用）。 */
export function clampPlateTilt(tiltRad: number): number {
  const limit = NOVANTA_PLATES.maxMechanicalTiltDeg * DEG;
  return clamp(tiltRad, -limit, limit);
}

/** 单板位移特性曲线（供 UI 画"非线性"对照）。 */
export function plateShiftCurve(
  unit: WobbleUnitGeometry,
  plate: 'A' | 'B',
  samples = 81,
): { tiltDeg: number; shiftMm: number }[] {
  const target = plate === 'A' ? unit.plateA : unit.plateB;
  const limit = NOVANTA_PLATES.maxMechanicalTiltDeg;
  const out: { tiltDeg: number; shiftMm: number }[] = [];
  for (let i = 0; i < samples; i += 1) {
    const tiltDeg = -limit + (2 * limit * i) / (samples - 1);
    out.push({ tiltDeg, shiftMm: plateShiftAt(target, tiltDeg * DEG) });
  }
  return out;
}
