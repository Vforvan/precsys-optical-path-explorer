/**
 * Novanta / ARGES 路线的物镜等效与焦点状态。
 *
 * 与 SCANLAB 路线的关系：**共用同一个物理概念**——
 *   入瞳处的偏心 h → 焦点处的入射角 AOI；
 *   入瞳处的坡度 u → 焦点的横向位置 X/Y；
 *   入瞳处的会聚度 → 焦点 Z。
 * 但两条路线的**拓扑不同**，因此耦合项不同，不能共用一条 train 的换算。
 * 本文件只负责 Novanta 拓扑下的换算，不复制 SCANLAB 的 mirror 追迹。
 *
 * 公开确认：PE III 物镜焦距 **60 mm**（官方数据表）；五轴 = X/Y/Z + 两个光束倾角。
 * 未公开：有效焦距、内部镜组、入射净孔径、工作距离。
 *
 * 【教学等效】本模型取有效焦距 = 公开焦距 = 60 mm，于是两个公开事实自洽：
 *   放大后的平行位移 h = M·Δx（M = 望远镜放大率，专利 ΔX_BET = M·Δx）
 *   → AOI = atan(h / Feff) 自然给出量级合适的光束倾角，无需虚构额外自由度。
 *
 * 拓扑决定的**真实耦合**（不是近似，是几何必然）：
 *   平行位移发生在平板处，经望远镜放大为 M·Δx；但它到达**最后一片振镜**所在的
 *   参考面时，高度仍是 M·Δx（平行位移在自由空间不衰减）。
 *   焦点位置由"最后一片振镜处的偏心 h 与出射坡度 u"共同决定：
 *       ΔX_focus = 2θ·f + (1 − L/f)·h
 *   其中 L 是"最后一片振镜 → 物镜入瞳参考面"的距离。
 *   因此：
 *     · 当 L = f 时平板位移**完全不串**到焦点 X/Y，只产生 AOI —— 这正是
 *       "平板改变光束位置、不改变准直出射方向"的教学重点；
 *     · 偏离这个条件就会出现真实耦合，页面用五轴联合补偿把它们一起解掉。
 */

import { Vector3 } from 'three';
import { radToDeg, type Ray } from './ray';
import { focusZFromPupilVergence } from './focus-module';
import { NOVANTA_OBJECTIVE } from '../config/novanta-layout';

/** 物镜入瞳处的等效状态（相对物镜光轴）。 */
export interface NovantaPupilState {
  /** 主光线在入瞳参考面上相对光轴的偏心 mm。 */
  hxMm: number;
  hyMm: number;
  /** 主光线坡度（rad）：tan(α) = −dx/dz，近轴下即 α。 */
  u: number;
  v: number;
  /** 主光线经过会聚度折算后的会聚度 1/mm（正 = 会聚）。 */
  vergence: number;
  /** 光束半径 mm（物镜入瞳处）。 */
  radiusMm: number;
}

export interface NovantaFocusState {
  xMm: number;
  yMm: number;
  /** 焦点高度 mm（相对工件表面，正 = 在表面上方）。 */
  zMm: number;
  /** 入射角分量（度）。 */
  aoiXDeg: number;
  aoiYDeg: number;
  /** AOI 极坐标表达：sqrt(α² + β²)（度）。 */
  aoiMagnitudeDeg: number;
  /** 方位角 atan2(β, α)（度）——即"入射面方位"，由两个倾角分量派生。 */
  planeAngleDeg: number;
  /** 焦点处光束中心方向（单位向量）。 */
  beamDirection: Vector3;
  /** 物镜后光锥半角（rad）。 */
  coneHalfAngleRad: number;
}

/** 物镜等效参数。 */
export function novantaEffectiveFocalLengthMm(): number {
  return NOVANTA_OBJECTIVE.effectiveFocalLengthMm;
}

export function novantaFocalLengthMm(): number {
  return NOVANTA_OBJECTIVE.focalLengthMm;
}

/** 由 α、β（弧度）得到单位方向，沿用仓库 ray.ts 的约定。 */
export function directionFromAoi(alphaRad: number, betaRad: number): Vector3 {
  return new Vector3(Math.tan(alphaRad), Math.tan(betaRad), -1).normalize();
}

/**
 * 由入瞳状态求焦点状态。
 *
 *   X_focus = Feff · u               （入瞳坡度 → 焦点横向位置）
 *   AOI     = atan(−h / Feff)        （入瞳偏心 → 焦点入射角）
 *   Z       = focusZFromPupilVergence(v)
 *
 * 注意：AOI 与 Plane 是**两个倾角分量派生出的极坐标表达**，
 * 不是"A 板 = AOI、B 板 = Plane"这种错误的一一对应。
 */
export function evaluateNovantaObjective(pupil: NovantaPupilState): NovantaFocusState {
  const feff = NOVANTA_OBJECTIVE.effectiveFocalLengthMm;
  const xMm = feff * pupil.u;
  const yMm = feff * pupil.v;
  const aoiXRad = Math.atan(-pupil.hxMm / feff);
  const aoiYRad = Math.atan(-pupil.hyMm / feff);
  const aoiXDeg = radToDeg(aoiXRad);
  const aoiYDeg = radToDeg(aoiYRad);
  const zMm = focusZFromPupilVergence(pupil.vergence);
  const internalRadiusMm = pupil.radiusMm * NOVANTA_OBJECTIVE.internalMagnification;
  return {
    xMm,
    yMm,
    zMm,
    aoiXDeg,
    aoiYDeg,
    aoiMagnitudeDeg: Math.hypot(aoiXDeg, aoiYDeg),
    planeAngleDeg: (Math.atan2(aoiYDeg, aoiXDeg) * 180) / Math.PI,
    beamDirection: directionFromAoi(aoiXRad, aoiYRad),
    coneHalfAngleRad: Math.atan(internalRadiusMm / NOVANTA_OBJECTIVE.focalLengthMm),
  };
}

/**
 * 由"最后一片振镜处的偏心与出射坡度"给出物镜入瞳状态。
 *
 * @param lastGalvoPoint 主光线在最后一片振镜上的命中点
 * @param lastGalvoToPupilMm 该点沿光路到入瞳参考面的距离 L
 * @param outputDirection 最后一片振镜之后的出射方向
 * @param pupilVergence 已折算到入瞳的会聚度 1/mm
 * @param radiusMm 物镜入瞳处的光束半径 mm
 */
export function pupilFromLastGalvo(params: {
  lastGalvoPoint: Vector3;
  lastGalvoToPupilMm: number;
  outputDirection: Ray['direction'];
  pupilVergence: number;
  radiusMm: number;
}): NovantaPupilState {
  const d = params.outputDirection.clone().normalize();
  const u = -d.x / Math.max(1e-12, -d.z);
  const v = -d.y / Math.max(1e-12, -d.z);
  const L = params.lastGalvoToPupilMm;
  return {
    // 主光线沿传播方向前进 L 后的横向位置
    hxMm: params.lastGalvoPoint.x + L * u,
    hyMm: params.lastGalvoPoint.y + L * v,
    u,
    v,
    vergence: params.pupilVergence,
    radiusMm: params.radiusMm,
  };
}

/**
 * 焦点 X/Y 的解析对照式（教学用，便于讲清耦合来源）：
 *   ΔX_focus = 2θ·f + (1 − L/f)·h
 * 只在近轴、小角度下成立；页面读数仍以真实追迹为准。
 */
export function focusOffsetAnalytic(params: {
  galvoMechanicalRad: number;
  focalLengthMm: number;
  pupilOffsetMm: number;
  lastGalvoToPupilMm: number;
}): number {
  const f = params.focalLengthMm;
  const L = params.lastGalvoToPupilMm;
  return 2 * params.galvoMechanicalRad * f + (1 - L / f) * params.pupilOffsetMm;
}

/** 理想逆关系：给定目标焦点与目标 AOI，求入瞳处应有的主光线状态（不含耦合）。 */
export function idealNovantaPupil(
  xMm: number,
  yMm: number,
  alphaDeg: number,
  betaDeg: number,
  radiusMm: number,
  vergence: number,
): NovantaPupilState {
  const feff = NOVANTA_OBJECTIVE.effectiveFocalLengthMm;
  return {
    hxMm: -feff * Math.tan((alphaDeg * Math.PI) / 180),
    hyMm: -feff * Math.tan((betaDeg * Math.PI) / 180),
    u: xMm / feff,
    v: yMm / feff,
    radiusMm,
    vergence,
  };
}
