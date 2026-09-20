/**
 * 平行平板元件（plane-parallel plate）—— 转轴、姿态、增量转动。
 *
 * 公开依据（DE102004053298B4）：Taumeleinheit 由两块 planparallele Fenster 组成，
 * 两块板都可转动；**两块板的转轴都与激光传播方向正交，并且互相正交**；
 * 斜入射时靠折射产生"平行于传播方向的 Strahlversatz"（横向位移）。
 * 专利明确写了位移量与折射率、板厚、入射角有关，并给出 Fig.5 的关系式。
 *
 * 本文件负责的是**机械侧**：一块板绕哪根轴、转多少、法向与面内点怎么变。
 * 折射本身在 refraction.ts 里做真实的向量追迹，这里不重复任何光学公式。
 *
 * 专利未规定的部分（全部按教学参数处理，标 "教学等效"）：
 *   - 板厚、玻璃折射率、口径与两块板的法向间距；
 *   - 板绕各自转轴"从零位起倾斜"的具体零位定义（本模型取"板面垂直于光轴"为零位，
 *     此时光线垂直入射、不产生位移，符合专利"平行位移可调"的功能描述）。
 *
 * 禁止事项（本仓库约定）：不把平行平板画成 wedge prism、不称为 Risley prism、
 * 不让它绕光轴连续自转来伪造进动。
 */

import { Vector3 } from 'three';
import { NOVANTA_PLATES } from '../config/novanta-layout';
import { makeRay, type Ray } from './ray';
import {
  tracePlaneParallelPlate,
  type PlateTraceResult,
} from './refraction';

/**
 * 一块平行平板的机械定义。
 *
 * 转轴与光轴正交；`lateralAxis` 是转轴与光轴叉乘得到的**面内横向轴** ——
 * 板倾斜时，光线横向位移就发生在这根轴上（位移方向随倾角符号翻转）。
 */
export interface ParallelPlateGeometry {
  id: string;
  label: string;
  /** 所属通道（plateA 绕 X 轴倾斜 → 位移沿 Y；plateB 绕 Y 轴倾斜 → 位移沿 X）。 */
  driveAxis: 'A' | 'B';
  /** 转轴（世界坐标，单位向量，与名义光轴 -Z 正交）。 */
  rotationAxis: Vector3;
  /** 倾斜时横向位移所在的轴（世界坐标，单位向量，与光轴正交）。 */
  lateralAxis: Vector3;
  /** 名义（零位）法向：与光轴平行。 */
  nominalNormal: Vector3;
  /** 零位时入射面上的参考点（转轴与之相交）。 */
  pivot: Vector3;
  /** 沿法向的板厚 mm —— 教学参数。 */
  thicknessMm: number;
  /** 玻璃折射率 —— 教学参数。 */
  refractiveIndex: number;
  /** 口径（绘制与追迹可接受范围）mm —— 教学参数。 */
  apertureMm: number;
  trust: '专利原理' | '教学等效';
  note: string;
}

/** 给定机械倾角下的平板姿态。 */
export interface PlatePose {
  /** 入射面上的一点（绕转轴刚体转动后的结果）。 */
  entryPlanePoint: Vector3;
  /** 入射面法向（单位向量）。 */
  normal: Vector3;
  /** 光束中心在入射面上的命中点。 */
  entryHit: Vector3;
  /** 玻璃内传播方向（单位向量）。 */
  internalDirection: Vector3;
  /** 出射面上的命中点。 */
  exitHit: Vector3;
  /** 出射光线。 */
  outputRay: Ray;
  /** 入射角（度）。 */
  incidenceDeg: number;
  /** 玻璃内折射角（度）。 */
  internalRefractionDeg: number;
  /** 出射面入射角（度）。 */
  exitIncidenceDeg: number;
  /** 沿 lateralAxis 的**带符号**横向位移 mm。 */
  signedShiftMm: number;
  /** 横向位移大小 mm。 */
  shiftMagnitudeMm: number;
  /** 横向位移向量（垂直于光线方向）。 */
  shiftVector: Vector3;
  /** 输入与输出方向夹角（度）；空气→平板→空气时应为 0。 */
  directionDeviationDeg: number;
  /** 是否发生全内反射（正常参数下不应发生）。 */
  totalInternalReflection: boolean;
}

/**
 * 建立一块平行平板。`pivot` 是转轴与板面的交点（板绕它刚体转动）。
 *
 * 约定沿用仓库坐标系：名义传播方向 -Z，故零位法向为 +Z；
 * `rotationAxis` 必须是 X 或 Y（与光轴及彼此正交），`lateralAxis = rotationAxis × (0,0,-1)`。
 */
export function createParallelPlate(params: {
  id: string;
  label: string;
  driveAxis: 'A' | 'B';
  rotationAxis: Vector3;
  pivot: Vector3;
  thicknessMm?: number;
  refractiveIndex?: number;
  apertureMm?: number;
}): ParallelPlateGeometry {
  const rotationAxis = params.rotationAxis.clone().normalize();
  const beamAxis = new Vector3(0, 0, -1);
  /**
   * 横向位移轴：`lateralAxis = rotationAxis × beamAxis = r × (0,0,−1)`。
   *
   * 这个取法不是凑出来的，而是由**向量 Snell 定律定符号**：
   * 平板绕 r 转 +θ 后法向变为 n = R(r,θ)·(0,0,1)，折射光线偏离光轴的方向
   * 始终与 (r × d) 同向（d 为入射方向）。
   *   板绕 X 转 +5°（n = (0,−0.087,0.996)）→ 位移沿 +Y；
   *   板绕 Y 转 +5°（n = (+0.087,0,0.996)）→ 位移沿 −X。
   * 取 lateralAxis = r × (0,0,−1) 正好让这两者都是"正倾角 → 沿 lateralAxis 正向"：
   *   r = X ⇒ lateralAxis = +Y ✔    r = Y ⇒ lateralAxis = −X ✔
   * 于是机械角符号与位移符号一致，逆解与 UI 读数都不会出现"反号"的坑
   * （sign 由 parallel-plate.test.ts 的三条断言钉住）。
   */
  const lateralAxis = new Vector3().crossVectors(rotationAxis, beamAxis).normalize();
  return {
    id: params.id,
    label: params.label,
    driveAxis: params.driveAxis,
    rotationAxis,
    lateralAxis,
    nominalNormal: new Vector3(0, 0, 1),
    pivot: params.pivot.clone(),
    thicknessMm: params.thicknessMm ?? NOVANTA_PLATES.thicknessMm,
    refractiveIndex: params.refractiveIndex ?? NOVANTA_PLATES.refractiveIndex,
    apertureMm: params.apertureMm ?? NOVANTA_PLATES.apertureMm,
    trust: '专利原理',
    note:
      '两板转轴正交、且都与激光传播方向正交（DE102004053298B4）。' +
      '板厚、折射率、口径与两板间距是本模型选取的教学参数，专利未给出。',
  };
}

/** 板在给定机械倾角下的入射面法向。 */
export function plateNormalAt(plate: ParallelPlateGeometry, tiltRad: number): Vector3 {
  return plate.nominalNormal
    .clone()
    .applyAxisAngle(plate.rotationAxis, tiltRad)
    .normalize();
}

/**
 * 板的光学面在给定倾角下的**定位基准点** —— 恒为转轴与板面的交点 `pivot`。
 *
 * 【为什么是它，而不是"把 pivot 绕转轴转一个倾角"】
 * 入射面是"过 pivot、以 n(θ) = R(r,θ)·n₀ 为法向"的那张平面。
 * 因为 r ⊥ n₀，所以 n(θ) 始终与 r 正交，于是对任意 θ 都有
 *     (pivot − pivot) · n(θ) = 0
 * 即 **pivot 恒在该平面上**，不需要、也不应该跟着转。
 *
 * 若把 pivot 绕 r 旋转 θ（本文件早期版本就是这么做的），由于 pivot 位于光轴上、
 * 离板面有很长的"力臂"（本模型里是 |pivot.z| ≈ 400 mm），
 * 一个 10° 的倾角会把定位点沿光轴横向甩出 70 mm 以上 ——
 * 光学计算仍然正确（平面没变），但三维里的玻璃板会整块飞离光路。
 * 这个 bug 的表现就是"板漂到光路旁边、而光线还是直的"。
 */
export function plateAnchorAt(plate: ParallelPlateGeometry, tiltRad: number): Vector3 {
  void tiltRad;
  return plate.pivot.clone();
}

/**
 * 追迹一条光线穿过平板当前姿态。
 * 全内反射、求交失败或数值非法时返回 null（不静默降级）。
 */
export function tracePlate(
  plate: ParallelPlateGeometry,
  ray: Ray,
  tiltRad: number,
): PlatePose | null {
  if (!Number.isFinite(tiltRad)) return null;
  const normal = plateNormalAt(plate, tiltRad);
  const entryPlanePoint = plateAnchorAt(plate, tiltRad);
  const traced: PlateTraceResult | null = tracePlaneParallelPlate(ray, {
    entryPlanePoint,
    normal,
    thicknessMm: plate.thicknessMm,
    refractiveIndex: plate.refractiveIndex,
  });
  if (!traced) return null;

  const shiftVector = traced.lateralShiftVector.clone();
  const signedShiftMm = shiftVector.dot(plate.lateralAxis);

  return {
    entryPlanePoint,
    normal,
    entryHit: traced.entryHit,
    internalDirection: traced.internalDirection,
    exitHit: traced.exitHit,
    outputRay: traced.outputRay,
    incidenceDeg: traced.diagnostics.entryIncidenceDeg,
    internalRefractionDeg: traced.diagnostics.internalRefractionDeg,
    exitIncidenceDeg: traced.diagnostics.exitIncidenceDeg,
    signedShiftMm,
    shiftMagnitudeMm: traced.lateralShiftMm,
    shiftVector,
    directionDeviationDeg: traced.directionDeviationDeg,
    totalInternalReflection: traced.diagnostics.totalInternalReflection,
  };
}

/** 沿板自身法向的入射光线（用于单元测试与特性曲线）。 */
export function plateInputRay(plate: ParallelPlateGeometry, fromAboveMm = 60): Ray {
  const origin = plate.pivot.clone().add(new Vector3(0, 0, fromAboveMm));
  return makeRay(origin, new Vector3(0, 0, -1));
}

/**
 * 单板横向位移随倾角的变化（mm，带符号，沿 lateralAxis）。
 * 映射在 ±90° 内单调；返回 NaN 表示该倾角下追迹失败。
 */
export function plateShiftAt(plate: ParallelPlateGeometry, tiltRad: number): number {
  const pose = tracePlate(plate, plateInputRay(plate), tiltRad);
  return pose ? pose.signedShiftMm : Number.NaN;
}

/**
 * 单板位移对倾角的数值灵敏度 mm/rad（中心差分）。
 * 专利只说明位移与折射率、板厚、入射角有关，未给出数值；此函数是本模型的结果。
 */
export function plateShiftSensitivity(plate: ParallelPlateGeometry, tiltRad = 0): number {
  const h = 1e-5;
  const a = plateShiftAt(plate, tiltRad - h);
  const b = plateShiftAt(plate, tiltRad + h);
  return (b - a) / (2 * h);
}

/** 机械倾角安全上限（度）—— 教学扫描范围，非厂商机械行程。 */
export const PLATE_TILT_LIMIT_DEG = NOVANTA_PLATES.maxMechanicalTiltDeg;

/** 该倾角是否在教学机械行程内。 */
export function withinPlateTiltLimit(tiltRad: number): boolean {
  return Math.abs(tiltRad) <= (PLATE_TILT_LIMIT_DEG * Math.PI) / 180 + 1e-12;
}
