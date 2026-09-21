import { Vector3 } from 'three';

export type Coordinates = [number, number, number, number, number];
export const LIMITS: Coordinates = [1.2, 1.6, 1.6, 1.5, 2.555];
export const OPTICAL_DESIGN = {
  /** 物镜（L3）焦距 mm。公开值。 */
  objectiveFocalLengthMm: 75,
  /** 物镜所在高度 mm（工件表面 z=0 之上）。 */
  objectiveHeightMm: 75,
  /** 可接受的方位角上限（度）。 */
  maxAoiDeg: 7,
  /** L1 单片移动负透镜焦距 mm（负）。 */
  l1FocalLengthMm: -60,
  /** L2 固定准直透镜焦距 mm。 */
  l2FocalLengthMm: 120,
  /** L1 与 L2 的零位间隔 mm。 */
  l1l2GapMm: 60,
  /** L2 的轴向位置 mm（固定不动，其余几何在此之上推算）。 */
  l2AxisMm: -225,
} as const;
export const RAD = Math.PI / 180;
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface Optic {
  id: string;
  label: string;
  kind: 'mirror' | 'lens';
  center: Vector3;
  normal: Vector3;
  radius: number;
  thickness: number;
  focalLength?: number;
  motor: number | null;
  axis?: Vector3;
}

export const MIRRORS: Optic[] = [
  { id: 'R1', label: 'R1 · 前级水平转向', kind: 'mirror', center: v(-160, -100, 180), normal: v(-1, 1, 0).normalize(), axis: v(0, 0, 1), radius: 20, thickness: 3, motor: 0 },
  { id: 'R2', label: 'R2 · 前级垂直转向', kind: 'mirror', center: v(-160, 50, 180), normal: v(1, -1, 0).normalize(), axis: v(1, 1, 0).normalize(), radius: 20, thickness: 3, motor: 1 },
  { id: 'R3', label: 'R3 · 后级水平转向', kind: 'mirror', center: v(20, 50, 180), normal: v(-1, 1, 0).normalize(), axis: v(0, 0, 1), radius: 23, thickness: 3, motor: 2 },
  { id: 'R4', label: 'R4 · 向下折转', kind: 'mirror', center: v(20, 170, 180), normal: v(0, -1, -1).normalize(), axis: v(1, 0, 0), radius: 20, thickness: 3, motor: 3 },
];

export function opticsAt(q: Coordinates): Optic[] {
  const { l1FocalLengthMm, l2FocalLengthMm, l1l2GapMm, l2AxisMm } = OPTICAL_DESIGN;
  // L1 在 L2 上游 gap 处；两者同一光轴高度。
  // Z 调焦灵敏度与 1/d1² 成正比（L1 不折射主光线，它只改变光线打到 L2 的高度），
  // 因此 d1 是调焦行程的主要设计自由度。
  const l1AxisMm = l2AxisMm - l1l2GapMm;
  return [
    { id: 'L1', label: 'L1 · 单片移动负透镜', kind: 'lens', center: v(l1AxisMm + q[4], -100, 180), normal: v(1, 0, 0), radius: 12, thickness: 3, focalLength: l1FocalLengthMm, motor: 4 },
    { id: 'L2', label: 'L2 · 独立固定准直透镜', kind: 'lens', center: v(l2AxisMm, -100, 180), normal: v(1, 0, 0), radius: 15, thickness: 4, focalLength: l2FocalLengthMm, motor: null },
    ...MIRRORS.map((optic, i) => ({ ...optic, center: optic.center.clone(), normal: optic.normal.clone().applyAxisAngle(optic.axis!, q[i] * RAD) })),
    { id: 'L3', label: 'L3 · 独立固定聚焦透镜', kind: 'lens', center: v(20, 170, OPTICAL_DESIGN.objectiveHeightMm), normal: v(0, 0, -1), radius: 25, thickness: 5, focalLength: OPTICAL_DESIGN.objectiveFocalLengthMm, motor: null },
  ];
}

export interface RayPath {
  points: Vector3[];
  direction: Vector3;
  margins: number[];
  error: string | null;
}

export function traceRay(q: Coordinates, offsetY = 0, offsetZ = 0): RayPath {
  const points = [v(-350, -100 + offsetY, 180 + offsetZ)];
  const margins: number[] = [];
  let direction = v(1, 0, 0);
  for (const optic of opticsAt(q)) {
    const origin = points[points.length - 1];
    const dot = direction.dot(optic.normal);
    if (Math.abs(dot) < 1e-9) return { points, direction, margins, error: `${optic.id}：光线平行于作用面` };
    const distance = optic.center.clone().sub(origin).dot(optic.normal) / dot;
    if (distance <= 1e-6) return { points, direction, margins, error: `${optic.id}：交点不在传播前方` };
    const hit = origin.clone().addScaledVector(direction, distance);
    const offset = hit.clone().sub(optic.center);
    const margin = optic.radius - offset.length() - 0.5;
    margins.push(margin);
    points.push(hit);
    if (margin < 0) return { points, direction, margins, error: `${optic.id}：超出净口径（含 0.5 mm 余量）` };
    if (optic.kind === 'mirror') {
      if (dot >= 0) return { points, direction, margins, error: `${optic.id}：背面入射` };
      direction = direction.clone().addScaledVector(optic.normal, -2 * dot).normalize();
    } else {
      if (dot <= 0) return { points, direction, margins, error: `${optic.id}：透镜传播方向错误` };
      // 以光轴方向坡度施加薄透镜光焦度；真实厚透镜像差需后续处方验证。
      direction = direction.clone().divideScalar(dot).addScaledVector(offset, -1 / optic.focalLength!).normalize();
    }
  }
  return { points, direction, margins, error: null };
}

export interface Evaluation {
  q: Coordinates;
  chief: RayPath;
  rays: RayPath[];
  output: Coordinates | null;
  focus: Vector3 | null;
  rms: number;
  apertureMargin: number;
  errors: string[];
}

export function aoiFromDirection(direction: Vector3): number {
  return Math.atan2(Math.hypot(direction.x, direction.y), -direction.z) / RAD;
}

export function aoiTarget(signedAoiDeg: number, azimuthDeg: number, position: readonly [number, number, number] = [0, 0, 0]): Coordinates {
  const slope = Math.tan(signedAoiDeg * RAD);
  return [...position, Math.atan(slope * Math.cos(azimuthDeg * RAD)) / RAD, Math.atan(slope * Math.sin(azimuthDeg * RAD)) / RAD];
}

export function evaluate(q: Coordinates, samples = 16): Evaluation {
  const errors: string[] = [];
  q.forEach((n, i) => { if (!Number.isFinite(n) || Math.abs(n) > LIMITS[i] + 1e-10) errors.push(`M${i + 1} 超出建模行程`); });
  const chief = traceRay(q);
  const rays: RayPath[] = [];
  for (const radius of [0.75, 1.5]) {
    for (let i = 0; i < samples; i++) {
      const phase = i * 2 * Math.PI / samples;
      rays.push(traceRay(q, radius * Math.cos(phase), radius * Math.sin(phase)));
    }
  }
  for (const ray of [chief, ...rays]) if (ray.error) errors.push(ray.error);
  const apertureMargin = Math.min(...[chief, ...rays].flatMap(ray => ray.margins));
  const failed = (): Evaluation => ({ q, chief, rays, output: null, focus: null, rms: Infinity, apertureMargin, errors: [...new Set(errors)] });
  if (errors.length) return failed();
  if ([chief, ...rays].some(ray => ray.direction.z >= -1e-6)) {
    errors.push('物镜后光线未朝向工件');
    return failed();
  }
  const intercepts = rays.map(ray => ray.points[ray.points.length - 1]);
  const slopes = rays.map(ray => ray.direction.clone().divideScalar(-ray.direction.z));
  const meanP = intercepts.reduce((sum, p) => sum.add(p), v(0, 0, 0)).divideScalar(rays.length);
  const meanS = slopes.reduce((sum, s) => sum.add(s), v(0, 0, 0)).divideScalar(rays.length);
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < rays.length; i++) {
    const p = intercepts[i].clone().sub(meanP);
    const s = slopes[i].clone().sub(meanS);
    covariance += p.x * s.x + p.y * s.y;
    variance += s.x * s.x + s.y * s.y;
  }
  const distance = -covariance / variance;
  if (!Number.isFinite(distance) || distance <= 0 || distance > 300) {
    errors.push('在物镜下游 300 mm 内没有有效最小弥散面');
    return failed();
  }
  const focus = meanP.clone().addScaledVector(meanS, distance);
  const rms = Math.sqrt(intercepts.reduce((sum, p, i) => sum + p.clone().addScaledVector(slopes[i], distance).distanceToSquared(focus), 0) / rays.length);
  const output: Coordinates = [focus.x - 20, focus.y - 170, focus.z, Math.atan2(chief.direction.x, -chief.direction.z) / RAD, Math.atan2(chief.direction.y, -chief.direction.z) / RAD];
  return { q, chief, rays, output, focus, rms, apertureMargin, errors: [] };
}

export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < rhs.length; col++) {
    let pivot = col;
    for (let row = col + 1; row < rhs.length; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
    const scale = rows[col][col];
    for (let k = col; k <= rhs.length; k++) rows[col][k] /= scale;
    for (let row = 0; row < rhs.length; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let k = col; k <= rhs.length; k++) rows[row][k] -= factor * rows[col][k];
    }
  }
  return rows.map(row => row[rhs.length]);
}

export function jacobian(q: Coordinates): number[][] | null {
  const matrix = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  for (let col = 0; col < 5; col++) {
    const h = 1e-4;
    const a = [...q] as Coordinates;
    const b = [...q] as Coordinates;
    a[col] = Math.min(LIMITS[col], q[col] + h);
    b[col] = Math.max(-LIMITS[col], q[col] - h);
    const pa = evaluate(a, 8).output;
    const pb = evaluate(b, 8).output;
    if (!pa || !pb) return null;
    for (let row = 0; row < 5; row++) matrix[row][col] = (pa[row] - pb[row]) / (a[col] - b[col]);
  }
  return matrix;
}

export function controllability(q: Coordinates): { rank: number; condition: number } {
  const raw = jacobian(q);
  if (!raw) return { rank: 0, condition: Infinity };
  const outputScales = [1, 1, 1, 1, 1]; // 输出按 1 mm / 1° 归一化，输入按各轴半行程归一化。
  const matrix = raw.map((row, i) => row.map((n, j) => n * LIMITS[j] / outputScales[i]));
  const inverseColumns = Array.from({ length: 5 }, (_, i) => solveLinear(matrix, Array.from({ length: 5 }, (_, j) => i === j ? 1 : 0)));
  const echelon = matrix.map(row => [...row]);
  let rank = 0;
  for (let col = 0; col < 5; col++) {
    let pivot = rank;
    for (let row = rank; row < 5; row++) if (Math.abs(echelon[row][col]) > Math.abs(echelon[pivot]?.[col] ?? 0)) pivot = row;
    if (rank >= 5 || Math.abs(echelon[pivot][col]) < 1e-8) continue;
    [echelon[rank], echelon[pivot]] = [echelon[pivot], echelon[rank]];
    for (let row = rank + 1; row < 5; row++) {
      const factor = echelon[row][col] / echelon[rank][col];
      for (let k = col; k < 5; k++) echelon[row][k] -= factor * echelon[rank][k];
    }
    rank++;
  }
  if (inverseColumns.some(column => column === null)) return { rank, condition: Infinity };
  const norm = Math.max(...matrix.map(row => row.reduce((sum, n) => sum + Math.abs(n), 0)));
  const inverseNorm = Math.max(...matrix.map((_, row) => inverseColumns.reduce((sum, column) => sum + Math.abs(column![row]), 0)));
  return { rank, condition: norm * inverseNorm };
}

export function inverse(target: Coordinates, initial: Coordinates = [0, 0, 0, 0, 0]): { q: Coordinates; ok: boolean; residual: number } {
  let q = [...initial] as Coordinates;
  let residual = Infinity;
  for (let iteration = 0; iteration < 16; iteration++) {
    const result = evaluate(q, 8);
    if (!result.output) break;
    const error = target.map((n, i) => n - result.output![i]);
    residual = Math.max(...error.map(Math.abs));
    if (residual < 1e-6) return { q, ok: true, residual };
    const matrix = jacobian(q);
    const delta = matrix && solveLinear(matrix, error);
    if (!delta) break;
    let accepted = false;
    for (let scale = 1; scale >= 1 / 128; scale /= 2) {
      const candidate = q.map((n, i) => n + delta[i] * scale) as Coordinates;
      if (candidate.some((n, i) => Math.abs(n) > LIMITS[i])) continue;
      const trial = evaluate(candidate, 8).output;
      if (trial && Math.max(...target.map((n, i) => Math.abs(n - trial[i]))) < residual) {
        q = candidate;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  return { q, ok: false, residual };
}
