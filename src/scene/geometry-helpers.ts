/**
 * 几何朝向助手。
 *
 * three.js 的 `CylinderGeometry` 默认轴沿 **Y**，而本项目的光轴是 **Z**
 * （工件表面 z = 0、扫描头在上方、激光沿 -Z 传播）。
 * 凡是"套在光路上、应与光路同轴"的圆柱 —— 波片、扩束镜、物镜镜筒、喷嘴、工件孔 ——
 * 都必须先绕 X 转 90°，否则会横躺 90°、看起来"和光路不垂直"。
 *
 * 把旋转烘进几何体（而不是每个 mesh 单独设 rotation），
 * 这样调用点不可能再漏掉朝向。
 */

import { CylinderGeometry } from 'three';

export function beamAlignedCylinder(
  radiusTop: number,
  radiusBottom: number,
  length: number,
  radialSegments = 32,
  openEnded = false,
): CylinderGeometry {
  const geometry = new CylinderGeometry(
    radiusTop,
    radiusBottom,
    length,
    radialSegments,
    1,
    openEnded,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
