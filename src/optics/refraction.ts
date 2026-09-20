/**
 * 折射与平行平板光线追迹（Novanta / ARGES 路线用）。
 *
 * 本文件是纯几何光学：入射光线、界面法向与折射率进，折射方向/交点出。
 * 没有"二维公式假装三维折射"：所有计算都在三维向量上做，
 * 因此画面上的红色折线、数值读数、AOI 与 offset 都来自同一次追迹。
 *
 * 坐标约定沿用 config/layout.ts：光束名义传播方向为 -Z。
 *
 * 依据（公开专利 DE102004053298B4，ARGES）：
 *   - Taumeleinheit（wobble unit）由两块 planparallele Fenster（平行平面窗口）组成；
 *   - 两块板都可转动，各自转轴与激光传播方向正交、且互相正交（[0024] 区段）；
 *   - 斜入射时平板因折射产生"平行于传播方向的 Strahlversatz"（横向位移）；
 *   - 位移量与板的折射率、板厚和入射角有关。
 * 专利只给出这些定性/关系式依据；**板厚、玻璃折射率、口径均为教学参数**。
 */

import { Vector3 } from 'three';
import { intersectPlane, makeRay, type Ray } from './ray';

/** 界面法向与光线方向夹角小于该值时按"垂直入射"处理。 */
export const NORMAL_INCIDENCE_EPSILON = 1e-12;

/** 光线方向与面法向的平行判据（用于判断掠入射/求交退化）。 */
export const GRAZING_EPSILON = 1e-9;

/** 折射率下界：避免 n < 1 的非法介质与除零。 */
const MIN_REFRACTIVE_INDEX = 1e-6;

/**
 * 向量形式的 Snell 折射。
 *
 *   cosθᵢ = -(d̂ · n̂)   （n̂ 指向上游、即逆着入射光更自然，但本函数对 n̂ 定向不敏感，
 *                          因为折射结果只取决于 sinθᵢ 与 n̂ 所在的直线）
 *   sin²θₜ = (n₁/n₂)² · (1 - cos²θᵢ)
 *   sin²θₜ > 1  → 全内反射，返回 null
 *   d̂ₜ = (n₁/n₂)·d̂ + (n₁/n₂·cosθᵢ - cosθₜ)·n̂
 *
 * 返回单位向量；全内反射或数值非法时返回 null（调用方负责如实报告，不做近似）。
 */
export function refractDirection(
  incident: Vector3,
  normal: Vector3,
  n1: number,
  n2: number,
): Vector3 | null {
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;
  if (n1 < MIN_REFRACTIVE_INDEX || n2 < MIN_REFRACTIVE_INDEX) return null;

  const d = incident.clone().normalize();
  const n = normal.clone().normalize();
  if (!Number.isFinite(d.x + d.y + d.z) || !Number.isFinite(n.x + n.y + n.z)) return null;

  const eta = n1 / n2;
  let cosI = -d.dot(n);
  // n̂ 定向不敏感：把它翻到与入射方向相对的一侧
  if (cosI < 0) {
    cosI = -cosI;
    n.negate();
  }

  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null; // 全内反射
  const cosT = Math.sqrt(Math.max(0, 1 - sin2T));

  const out = d.clone().multiplyScalar(eta).addScaledVector(n, eta * cosI - cosT);
  const length = out.length();
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return out.multiplyScalar(1 / length);
}

/** 介质折射率：空气取 1，玻璃用教学参数 n。 */
export function refractiveIndexOf(medium: 'air' | 'glass', glassIndex: number): number {
  return medium === 'air' ? 1 : glassIndex;
}

/** 由入射角与折射率求玻璃内折射角（弧度）；掠入射或非法输入返回 NaN。 */
export function refractionAngleRad(incidenceRad: number, n1: number, n2: number): number {
  const s = (n1 / n2) * Math.sin(incidenceRad);
  if (!Number.isFinite(s) || Math.abs(s) > 1) return Number.NaN;
  return Math.asin(s);
}

/** 由入射角、玻璃内折射角、厚度求理论横向位移（专利 Fig.5 关系式的等价标量形式）。 */
export function analyticLateralShiftMm(
  incidenceRad: number,
  refractionRad: number,
  thicknessMm: number,
): number {
  const denom = Math.cos(refractionRad);
  if (Math.abs(denom) < 1e-12) return Number.NaN;
  return (thicknessMm * Math.sin(incidenceRad - refractionRad)) / denom;
}

/** 一块平行平板：一个面内点 + 面法向 + 法向厚度。 */
export interface ParallelPlate {
  /** 入射面（第一界面）上的一个点。 */
  entryPlanePoint: Vector3;
  /** 入射面法向（任意定向；内部会按入射方向定向）。 */
  normal: Vector3;
  /** 沿法向测得的板厚 mm。 */
  thicknessMm: number;
  /** 玻璃折射率（教学参数）。 */
  refractiveIndex: number;
  /** 环境折射率，默认空气 n = 1。 */
  ambientIndex?: number;
}

/** 折射诊断量：由实际追迹结果反算，供单元测试与读数面板使用。 */
export interface RefractionDiagnostics {
  /** 第一界面入射角（度）。 */
  entryIncidenceDeg: number;
  /** 玻璃内折射角（度）。 */
  internalRefractionDeg: number;
  /** 第二界面（玻璃→空气）入射角（度）。 */
  exitIncidenceDeg: number;
  /** 第二界面是否发生全内反射。 */
  totalInternalReflection: boolean;
}

export interface PlateTraceResult {
  entryHit: Vector3;
  internalDirection: Vector3;
  exitHit: Vector3;
  outputRay: Ray;
  /** 横向位移的标量大小 mm（垂直于光线方向）。 */
  lateralShiftMm: number;
  /** 横向位移向量（垂直于光线方向，位于入射面内）。 */
  lateralShiftVector: Vector3;
  /** 输入与输出方向夹角（度）。空气→平板→空气时应为 0。 */
  directionDeviationDeg: number;
  diagnostics: RefractionDiagnostics;
}

/** 光线与平板入射面的交点；不检查是否在有限口径内（口径由调用方校验）。 */
export function intersectPlateSurface(
  ray: Ray,
  planePoint: Vector3,
  planeNormal: Vector3,
): number | null {
  return intersectPlane(ray, planePoint, planeNormal);
}

/**
 * 追迹一条光线穿过一块平行平板：入射面折射 → 玻璃内传播 → 出射面折射。
 *
 * 结果里的横向位移按"把出射光线与未折射参考光线比较"定义，
 * 因此它同时包含了玻璃内传播与出射面折射两段效果，
 * 不依赖任何二维近似。参考光线从入射点沿入射方向直行，
 * 位移取其在垂直于光线方向上的分量（这与专利 Fig.5 的 Δ 定义一致）。
 *
 * 全内反射、求交失败或数值非法时返回 null —— 不静默降级。
 */
export function tracePlaneParallelPlate(ray: Ray, plate: ParallelPlate): PlateTraceResult | null {
  const ambient = plate.ambientIndex ?? 1;
  const glass = plate.refractiveIndex;
  if (!Number.isFinite(plate.thicknessMm) || plate.thicknessMm <= 0) return null;
  if (!Number.isFinite(glass) || glass < MIN_REFRACTIVE_INDEX) return null;

  const incident = ray.direction.clone().normalize();
  if (!Number.isFinite(incident.x + incident.y + incident.z)) return null;

  // --- 第一界面：按入射方向把法向定向到"逆着入射光"的一侧
  let front = plate.normal.clone().normalize();
  if (!Number.isFinite(front.x + front.y + front.z)) return null;
  if (front.dot(incident) > 0) front.negate();

  const tEntry = intersectPlateSurface(ray, plate.entryPlanePoint, front);
  if (tEntry === null || !Number.isFinite(tEntry) || tEntry < -1e-9) return null;
  const entryHit = ray.origin.clone().addScaledVector(incident, tEntry);

  // --- 入射面折射（空气 → 玻璃）
  const internalDirection = refractDirection(incident, front, ambient, glass);
  if (!internalDirection) return null;

  const cosEntry = Math.min(1, Math.max(0, -incident.dot(front)));
  const entryIncidenceRad = Math.acos(cosEntry);
  const internalRefractionRad = refractionAngleRad(entryIncidenceRad, ambient, glass);

  // --- 玻璃内传播到第二界面：与第一界面平行、沿法向偏 n̂·(-thickness)
  const backPoint = plate.entryPlanePoint.clone().addScaledVector(front, -plate.thicknessMm);
  const tInternal = intersectPlateSurface(
    makeRay(entryHit, internalDirection),
    backPoint,
    front,
  );
  if (tInternal === null || !Number.isFinite(tInternal) || tInternal <= 0) return null;
  const exitHit = entryHit.clone().addScaledVector(internalDirection, tInternal);

  // 玻璃内实际程长应等于厚度/cos(r)；不一致说明求交退化。
  const expectedInternal = plate.thicknessMm / Math.max(1e-12, Math.cos(internalRefractionRad));
  if (!Number.isFinite(expectedInternal)) return null;

  // --- 第二界面折射（玻璃 → 空气）。出射面法向取 +ẑ 一侧（与入射方向相对）。
  const backNormal = front.clone().negate();
  const exitIncidenceRad = Math.acos(
    Math.min(1, Math.max(0, internalDirection.dot(backNormal))),
  );
  const outputDirection = refractDirection(internalDirection, backNormal, glass, ambient);
  if (!outputDirection) {
    return {
      entryHit,
      internalDirection,
      exitHit,
      outputRay: makeRay(exitHit, internalDirection),
      lateralShiftMm: Number.NaN,
      lateralShiftVector: new Vector3(),
      directionDeviationDeg: Number.NaN,
      diagnostics: {
        entryIncidenceDeg: rad2deg(entryIncidenceRad),
        internalRefractionDeg: rad2deg(internalRefractionRad),
        exitIncidenceDeg: rad2deg(exitIncidenceRad),
        totalInternalReflection: true,
      },
    };
  }

  const outputRay = makeRay(exitHit, outputDirection);

  // --- 横向位移：与"未折射参考光线"比较。
  // 参考光线从入射点沿入射方向直行；其在垂直于光线方向上的分量即专利 Fig.5 的 Δ。
  const referenceAdvance = exitHit.clone().sub(entryHit).dot(incident);
  const referencePoint = entryHit.clone().addScaledVector(incident, referenceAdvance);
  const offsetVector = exitHit.clone().sub(referencePoint);
  // 数值上把沿光线方向的残差投影掉，保证 offset ⊥ direction
  const lateralShiftVector = offsetVector.addScaledVector(
    incident,
    -offsetVector.dot(incident),
  );

  const deviationRad = Math.acos(
    Math.min(1, Math.max(-1, incident.dot(outputDirection))),
  );

  return {
    entryHit,
    internalDirection,
    exitHit,
    outputRay,
    lateralShiftMm: lateralShiftVector.length(),
    lateralShiftVector,
    directionDeviationDeg: rad2deg(deviationRad),
    diagnostics: {
      entryIncidenceDeg: rad2deg(entryIncidenceRad),
      internalRefractionDeg: rad2deg(internalRefractionRad),
      exitIncidenceDeg: rad2deg(exitIncidenceRad),
      totalInternalReflection: false,
    },
  };
}

/** 备用：玻璃内程长（诊断用）。 */
export function internalPathLengthMm(
  thicknessMm: number,
  refractionRad: number,
): number {
  const c = Math.cos(refractionRad);
  if (!Number.isFinite(c) || Math.abs(c) < 1e-12) return Number.NaN;
  return thicknessMm / c;
}

function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}
