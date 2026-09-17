/**
 * 反射镜抽象。
 *
 * 一块镜片由"平面上一点 + 法向 + 局部 u/v 轴 + 尺寸"定义。
 * 可动镜额外带一个旋转轴：转动时只更新法向与局部轴，交点和反射方向
 * 由光学层重新计算（计划书 §10.1 的硬性要求）。
 */

import { Vector3 } from 'three';
import { rotateAroundAxis, type Ray, intersectPlane, reflect, makeRay } from './ray';
import type { TrustLevel } from '../config/public-specs';

export type MirrorKind = 'fixed' | 'movable' | 'curved' | 'splitter' | 'lens';

export interface MirrorSpec {
  id: string;
  label: string;
  kind: MirrorKind;
  /** 镜面中心（世界坐标 mm）。 */
  center: Vector3;
  /** 名义法向（单位向量）。 */
  normal: Vector3;
  /** 镜面局部第一轴（沿镜面）。 */
  u: Vector3;
  /** 镜面局部第二轴（沿镜面）。 */
  v: Vector3;
  /** 镜面尺寸（沿 u、v），mm。 */
  size: { u: number; v: number };
  /** 可动镜旋转轴（世界坐标）。 */
  rotationAxis?: Vector3;
  /**
   * 旋转支点：转动时镜面中心绕该点旋转（刚体转动）。
   * 不填则视为绕自身中心旋转。
   */
  rotationPivot?: Vector3;
  /** 当前机械角（弧度）。 */
  angleRad?: number;
  /** 曲率半径 mm（仅 curved）。 */
  radiusOfCurvature?: number;
  trust: TrustLevel;
  note: string;
  /** 是否参与光线求交（分光镜只画不挡光）。 */
  interactive: boolean;
}

export interface MirrorIntersection {
  hit: boolean;
  point: Vector3;
  distance: number;
  /** 入射角（弧度）。 */
  incidenceAngleRad: number;
  /** 命中点相对镜面中心的局部坐标，用于判断是否落在镜片范围内。 */
  local: { u: number; v: number };
}

/** 当前姿态下的法向（可动镜按机械角旋转）。 */
export function mirrorNormal(spec: MirrorSpec): Vector3 {
  if (!spec.rotationAxis || !spec.angleRad) return spec.normal.clone().normalize();
  return rotateAroundAxis(spec.normal, spec.rotationAxis, spec.angleRad).normalize();
}

/** 当前姿态下的镜面中心（刚体转动：绕 rotationPivot 旋转）。 */
export function mirrorCenter(spec: MirrorSpec): Vector3 {
  if (!spec.rotationAxis || !spec.angleRad) return spec.center.clone();
  const pivot = spec.rotationPivot;
  if (!pivot) return spec.center.clone();
  const arm = spec.center.clone().sub(pivot);
  return pivot.clone().add(rotateAroundAxis(arm, spec.rotationAxis, spec.angleRad));
}

/** 当前姿态下的局部轴。 */
export function mirrorAxes(spec: MirrorSpec): { u: Vector3; v: Vector3 } {
  if (!spec.rotationAxis || !spec.angleRad) {
    return { u: spec.u.clone(), v: spec.v.clone() };
  }
  return {
    u: rotateAroundAxis(spec.u, spec.rotationAxis, spec.angleRad),
    v: rotateAroundAxis(spec.v, spec.rotationAxis, spec.angleRad),
  };
}

/** 与镜面所在无限平面求交（按当前姿态，含刚体转动）。 */
export function intersectMirror(spec: MirrorSpec, ray: Ray): MirrorIntersection | null {
  const normal = mirrorNormal(spec);
  const center = mirrorCenter(spec);
  const t = intersectPlane(ray, center, normal);
  if (t === null || t <= 1e-6) return null;
  const point = ray.origin.clone().addScaledVector(ray.direction, t);
  const offset = point.clone().sub(center);
  const { u, v } = mirrorAxes(spec);
  const local = { u: offset.dot(u), v: offset.dot(v) };
  const incidenceAngleRad = Math.acos(
    Math.min(1, Math.abs(ray.direction.clone().normalize().dot(normal))),
  );
  return { hit: true, point, distance: t, incidenceAngleRad, local };
}

/** 命中点是否落在镜片有效口径内（略放宽，允许边缘 10% 余量）。 */
export function isWithinAperture(
  spec: MirrorSpec,
  intersection: MirrorIntersection,
  margin = 1.1,
): boolean {
  const halfU = (spec.size.u * margin) / 2;
  const halfV = (spec.size.v * margin) / 2;
  return (
    Math.abs(intersection.local.u) <= halfU && Math.abs(intersection.local.v) <= halfV
  );
}

/** 在镜面上反射一条光线。 */
export function reflectOffMirror(spec: MirrorSpec, ray: Ray, point: Vector3): Ray {
  return makeRay(point, reflect(ray.direction, mirrorNormal(spec)));
}

/** 生成以 center 为基准、沿 normal 偏移 distance 的镜面副本（用于平行镜组）。 */
export function offsetMirror(spec: MirrorSpec, distance: number): MirrorSpec {
  const normal = mirrorNormal(spec);
  return {
    ...spec,
    center: spec.center.clone().addScaledVector(normal, distance),
  };
}

/** 半球/球冠几何用的曲率符号：凹面（正面会聚）R > 0。 */
export function isConcave(spec: MirrorSpec): boolean {
  return (spec.radiusOfCurvature ?? 0) > 0;
}
