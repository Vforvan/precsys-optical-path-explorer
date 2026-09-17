/**
 * 物镜等效模型。
 *
 * 公开数值：物镜焦距 75 mm、有效焦距 25 mm、典型入射光束直径 2 mm、
 * 典型全会聚角 0.08 rad、工作距离（最后一片透镜到工件）75 mm。
 *
 * 四者互相自洽的等效解释（也是本模型采用的解释）：
 *   物镜内部等效为"扩束 M 倍 + 焦距 75 mm 聚焦镜"。
 *   2 mm 输入光束被扩到 6 mm，聚焦到 75 mm 处 → 半角 atan(3/75) = 0.04 rad，
 *   全角 0.08 rad ✓；而"有效焦距" = 1/0.04 = 25 mm ✓，正好同时是
 *   "入瞳位移 → AOI" 与 "入瞳坡度 → 焦点位置" 的换算基准：
 *
 *     X_focus = Feff · u          （u = 主光线在入瞳的坡度）
 *     AOI     = atan(-h / Feff)   （h = 主光线在入瞳相对光轴的高度）
 *
 * 这两条关系使"X/Y 移动焦点"与"α/β 改变入射角"在理想情况下互不干扰，
 * 而真实系统里的干扰来自振镜间距、厚透镜、畸变与装配误差 —— 这正是需要
 * 五轴联合标定的原因，也是本页"补偿开/关"演示要展示的东西。
 *
 * 内部镜组数量与曲率未公开，画出来的镜筒结构为教学等效。
 */

import { Vector3 } from 'three';
import { directionFromTilt, radToDeg } from './ray';
import { OBJECTIVE } from '../config/layout';
import { focusZFromPupilVergence } from './focus-module';
import type { OpticsVariant } from '../config/public-specs';

/** 主光线在物镜入瞳平面的状态。 */
export interface PupilState {
  /** 主光线在入瞳上的位置（mm，相对物镜光轴）。 */
  hxMm: number;
  hyMm: number;
  /** 主光线坡度（rad）：u = -dx/dz，v = -dy/dz。 */
  u: number;
  v: number;
  /** 光束半径 mm。 */
  radiusMm: number;
  /** 会聚度 1/mm（正 = 会聚）。 */
  vergence: number;
}

export interface FocusState {
  xMm: number;
  yMm: number;
  /** 焦点高度（mm，相对工件表面，正 = 在表面上方）。 */
  zMm: number;
  /** 入射角分量（度），正负与 direction = normalize([tanα, tanβ, -1]) 一致。 */
  aoiXDeg: number;
  aoiYDeg: number;
  /** 焦点处光束中心方向（单位向量）。 */
  beamDirection: Vector3;
  /** 物镜后光锥半角（rad）。 */
  coneHalfAngleRad: number;
  /** 物镜内部光束半径 mm。 */
  internalRadiusMm: number;
}

export function effectiveFocalLengthMm(): number {
  return OBJECTIVE.effectiveFocalLengthMm;
}

/** 由入瞳状态求焦点状态（物镜等效关系）。 */
export function evaluateObjective(pupil: PupilState): FocusState {
  const feff = OBJECTIVE.effectiveFocalLengthMm;
  const xMm = feff * pupil.u;
  const yMm = feff * pupil.v;
  const aoiXRad = Math.atan(-pupil.hxMm / feff);
  const aoiYRad = Math.atan(-pupil.hyMm / feff);
  const zMm = focusZFromPupilVergence(pupil.vergence);
  const internalRadiusMm = pupil.radiusMm * OBJECTIVE.internalMagnification;
  return {
    xMm,
    yMm,
    zMm,
    aoiXDeg: radToDeg(aoiXRad),
    aoiYDeg: radToDeg(aoiYRad),
    beamDirection: directionFromTilt(aoiXRad, aoiYRad),
    coneHalfAngleRad: Math.atan(internalRadiusMm / OBJECTIVE.backFocalLengthMm),
    internalRadiusMm,
  };
}

/**
 * 理想逆关系：给定目标焦点与目标 AOI，求入瞳处应有的主光线状态。
 * 不含任何耦合项（这就是"一轴对应一个坐标"的教科书版本）。
 */
export function idealPupilState(
  xMm: number,
  yMm: number,
  alphaDeg: number,
  betaDeg: number,
  radiusMm: number,
  vergence: number,
): PupilState {
  const feff = OBJECTIVE.effectiveFocalLengthMm;
  return {
    hxMm: -feff * Math.tan((alphaDeg * Math.PI) / 180),
    hyMm: -feff * Math.tan((betaDeg * Math.PI) / 180),
    u: xMm / feff,
    v: yMm / feff,
    radiusMm,
    vergence,
  };
}

/** 理想薄透镜对照值：同样的入瞳偏心，若按简单薄透镜应有约多大的 AOI。 */
export function thinLensEstimateAoiDeg(hxMm: number): number {
  return radToDeg(Math.atan(hxMm / OBJECTIVE.effectiveFocalLengthMm));
}

/** 由变体规格给出的理论焦斑直径（µm）——规格值，不是本模型算出来的。 */
export function specSpotDiameterUm(variant: OpticsVariant): number {
  const table: Record<string, number> = {
    '1030': 20,
    '515-std': 10.2,
    '515-min': 8.2,
  };
  return table[variant.key] ?? 0;
}

/** 规格给出的理论全会聚角（与内部等效扩束模型互相印证）。 */
export function specFullConeAngleRad(variant: OpticsVariant): number {
  return variant.fullConeAngleRad;
}
