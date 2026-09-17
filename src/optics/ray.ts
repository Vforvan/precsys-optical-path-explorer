/**
 * 光线与光束包络的基础数学。
 *
 * 计划书 §10.1：每段光线由起点 p 和单位方向 d 表示，镜面由平面上一点 m 和法向 n 表示，
 * 反射方向一律用 d' = d - 2·(d·n)·n 计算。任何"手工移动折线端点"的做法都不允许。
 *
 * 坐标约定见 config/layout.ts：激光名义传播方向为 -Z。
 * 坡度（slope）约定与计划书 §6 的 α/β 定义一致：
 *   u = -d.x / d.z   （α 的斜率：光束向 +X 倾斜时 u > 0）
 *   v = -d.y / d.z   （β 的斜率）
 * 于是 direction = normalize([tan α, tan β, -1]) 对应 u = tan α、v = tan β。
 */

import { Vector3 } from 'three';

/** 一条光线：起点 + 单位方向。 */
export interface Ray {
  origin: Vector3;
  direction: Vector3;
}

/** 光线在传播方向上的采样点。 */
export interface RaySegment {
  from: Vector3;
  to: Vector3;
}

export const PARALLEL_EPSILON = 1e-9;

export function makeRay(origin: Vector3, direction: Vector3): Ray {
  return { origin: origin.clone(), direction: direction.clone().normalize() };
}

/** 反射定律：d' = d - 2(d·n)n。n 不需要预先定向。 */
export function reflect(direction: Vector3, normal: Vector3): Vector3 {
  const n = normal.clone().normalize();
  const dot = direction.dot(n);
  return direction.clone().addScaledVector(n, -2 * dot).normalize();
}

/**
 * 光线与平面求交。返回沿光线的参数 t（可为负值，调用方需判断）。
 * 平面与光线平行时返回 null。
 */
export function intersectPlane(
  ray: Ray,
  planePoint: Vector3,
  planeNormal: Vector3,
): number | null {
  const n = planeNormal.clone().normalize();
  const denom = ray.direction.dot(n);
  if (Math.abs(denom) < PARALLEL_EPSILON) return null;
  return planePoint.clone().sub(ray.origin).dot(n) / denom;
}

export function pointAt(ray: Ray, t: number): Vector3 {
  return ray.origin.clone().addScaledVector(ray.direction, t);
}

/** 点到平面的有符号距离（沿法向）。 */
export function signedDistanceToPlane(
  point: Vector3,
  planePoint: Vector3,
  planeNormal: Vector3,
): number {
  return point.clone().sub(planePoint).dot(planeNormal.clone().normalize());
}

/** 由方向向量得到 α、β（弧度）。 */
export function tiltFromDirection(direction: Vector3): { alphaRad: number; betaRad: number } {
  const d = direction.clone().normalize();
  // 光束必须大致沿 -Z 传播；若 d.z >= 0 说明方向反了，用其反向处理。
  const sign = d.z > 0 ? -1 : 1;
  const dz = Math.abs(d.z) < 1e-12 ? 1e-12 : d.z;
  return {
    alphaRad: Math.atan2(sign * d.x, -sign * dz),
    betaRad: Math.atan2(sign * d.y, -sign * dz),
  };
}

/** 由 α、β（弧度）得到单位方向，等价于 normalize([tan α, tan β, -1])。 */
export function directionFromTilt(alphaRad: number, betaRad: number): Vector3 {
  return new Vector3(Math.tan(alphaRad), Math.tan(betaRad), -1).normalize();
}

/**
 * 光束包络：半径 + 会聚度。
 * vergence = 1/R，单位 1/mm；正值表示会聚（焦点在传播前方），0 为准直，负值为发散。
 */
export interface BeamEnvelope {
  /** 光束半径 mm（1/e² 半径）。 */
  radius: number;
  /** 波前曲率 1/mm。 */
  vergence: number;
}

/** 自由传播 distance（mm，沿传播方向为正）后的会聚度。 */
export function propagateVergence(vergence: number, distance: number): number {
  const denom = 1 - vergence * distance;
  if (Math.abs(denom) < 1e-12) return Math.sign(vergence) * 1e12;
  return vergence / denom;
}

/** 自由传播 distance 后的光束半径。 */
export function propagateRadius(envelope: BeamEnvelope, distance: number): number {
  return Math.max(1e-6, envelope.radius * (1 - envelope.vergence * distance));
}

/** 传播一段距离。 */
export function propagate(envelope: BeamEnvelope, distance: number): BeamEnvelope {
  return {
    radius: propagateRadius(envelope, distance),
    vergence: propagateVergence(envelope.vergence, distance),
  };
}

/**
 * 变焦反射镜对会聚度的作用（近轴、斜入射的切向功率近似）：
 *   Δv = 2·cos(incidence) / R
 * R 为镜面曲率半径：凹面（汇聚焦）R > 0 使光束更会聚；凸面 R < 0 使其发散。
 */
export function mirrorVergenceKick(
  incidenceAngleRad: number,
  radiusOfCurvature: number,
): number {
  if (!Number.isFinite(radiusOfCurvature) || Math.abs(radiusOfCurvature) < 1e-9) return 0;
  return (2 * Math.cos(incidenceAngleRad)) / radiusOfCurvature;
}

/** 两条光线（起点+方向）的夹角，度。 */
export function angleBetweenDirectionsDeg(a: Vector3, b: Vector3): number {
  const dot = Math.min(1, Math.max(-1, a.clone().normalize().dot(b.clone().normalize())));
  return (Math.acos(dot) * 180) / Math.PI;
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function degToRad(deg: number): number {
  return deg * DEG;
}

export function radToDeg(rad: number): number {
  return rad * RAD;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 沿镜面局部坐标轴做一次绕轴旋转（用于可动镜法向更新）。 */
export function rotateAroundAxis(
  vector: Vector3,
  axis: Vector3,
  angleRad: number,
): Vector3 {
  return vector.clone().applyAxisAngle(axis.clone().normalize(), angleRad);
}
