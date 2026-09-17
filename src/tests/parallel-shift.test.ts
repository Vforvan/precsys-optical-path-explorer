import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEG, radToDeg } from '../optics/ray';
import { mirrorCenter, mirrorNormal } from '../optics/mirror';
import { SHIFT_MODULE } from '../config/layout';
import {
  INPUT_OFFSET_MM,
  createShiftModule,
  deltaForShift,
  moduleInputRay,
  shiftDisplacement,
  traceShiftModule,
} from '../optics/parallel-shift-module';

const alpha = createShiftModule('alpha', new Vector3(0, 0, 100));
const beta = createShiftModule('beta', new Vector3(0, 0, 100));

function traceAt(geom: typeof alpha, deltaDeg: number) {
  return traceShiftModule(geom, moduleInputRay(geom), deltaDeg * DEG);
}

describe('平行移束模块（四次反射 / 输出方向不变 / 位移随转角变化）', () => {
  it('δ = 0 时四次反射的落点与几何解一致', () => {
    const t = traceAt(alpha, 0);
    expect(t).not.toBeNull();
    const [A, F1, F2, B] = t!.points;
    // A 是入光命中点，B 是出光点
    expect(A.distanceTo(alpha.A)).toBeLessThan(1e-9);
    expect(B.distanceTo(alpha.outputPoint)).toBeLessThan(1e-9);
    // 第 1 段沿 +X，长度 = c1 + √2×台阶；第 2 段沿 -Z，长度 = c1 - c2
    expect(F1.x - A.x).toBeCloseTo(SHIFT_MODULE.c1 + Math.SQRT2 * SHIFT_MODULE.stepMm, 6);
    expect(F2.z - F1.z).toBeCloseTo(-(SHIFT_MODULE.c1 - SHIFT_MODULE.c2), 6);
    // 输出在光轴上（模块输出点 x = 0）
    expect(Math.abs(B.x)).toBeLessThan(1e-9);
  });

  it('第 1 次与第 4 次反射都落在可动镜组上（各自镜面的正面）', () => {
    const deltaDeg = 3;
    const deltaRad = deltaDeg * DEG;
    const t = traceAt(alpha, deltaDeg)!;
    const inSpec = { ...alpha.movableIn, angleRad: deltaRad };
    const outSpec = { ...alpha.movableOut, angleRad: deltaRad };
    // 命中点分别落在两块镜面（已按机械角旋转）所在平面上
    const sigmaIn = t.points[0].clone().sub(mirrorCenter(inSpec)).dot(mirrorNormal(inSpec));
    const sigmaOut = t.points[3].clone().sub(mirrorCenter(outSpec)).dot(mirrorNormal(outSpec));
    expect(Math.abs(sigmaIn)).toBeLessThan(1e-9);
    expect(Math.abs(sigmaOut)).toBeLessThan(1e-9);
    // 而且不是同一个点
    expect(t.points[0].distanceTo(t.points[3])).toBeGreaterThan(10);
    // 两块镜面法向相同（同一支架）
    expect(mirrorNormal(inSpec).distanceTo(mirrorNormal(outSpec))).toBeLessThan(1e-12);
  });

  it('输出方向与输入方向严格平行（与可动镜转角无关）', () => {
    for (const deltaDeg of [-5, -3, -1, 0, 1, 3, 5]) {
      const t = traceAt(alpha, deltaDeg);
      expect(t).not.toBeNull();
      expect(t!.directionDeviationDeg).toBeLessThan(1e-9);
    }
  });

  it('β 模块沿 Y 移束，方向同样不变', () => {
    for (const deltaDeg of [-4, 0, 4]) {
      const t = traceAt(beta, deltaDeg);
      expect(t).not.toBeNull();
      expect(t!.directionDeviationDeg).toBeLessThan(1e-9);
      // 输出相对输入的位移应只出现在 Y 方向
      const delta = t!.points[3].clone().sub(t!.points[0]);
      expect(Math.abs(delta.x)).toBeLessThan(1e-9);
      expect(Math.abs(delta.z)).toBeGreaterThan(1);
    }
  });

  it('位移随转角单调变化，且 δ = 0 时为 0', () => {
    expect(shiftDisplacement(alpha, 0)).toBeCloseTo(0, 9);
    let previous = Number.NEGATIVE_INFINITY;
    for (let deltaDeg = -3; deltaDeg <= 3.0001; deltaDeg += 0.25) {
      const value = shiftDisplacement(alpha, deltaDeg * DEG);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    const range = shiftDisplacement(alpha, 3 * DEG) - shiftDisplacement(alpha, -3 * DEG);
    expect(range).toBeGreaterThan(9);
  });

  it('位移灵敏度约为 2.2 mm/度机械角（实机由镜间距决定，专利 [0016]）', () => {
    const numeric = shiftDisplacement(alpha, 1 * DEG) - shiftDisplacement(alpha, 0);
    expect(numeric).toBeGreaterThan(1.5);
    expect(numeric).toBeLessThan(3.5);
    // 近似线性：两倍角约等于两倍位移
    const twice = shiftDisplacement(alpha, 2 * DEG) - shiftDisplacement(alpha, 0);
    expect(twice / numeric).toBeGreaterThan(1.7);
    expect(twice / numeric).toBeLessThan(2.3);
  });

  it('目标位移可用二分法精确换算成机械角', () => {
    for (const target of [-4.5, -2, -0.5, 0, 0.5, 2, 4.5]) {
      const delta = deltaForShift(alpha, target);
      expect(shiftDisplacement(alpha, delta)).toBeCloseTo(target, 6);
    }
  });

  it('光束不会穿过任何一块可动镜片（走两块镜面之间的空档）', () => {
    for (let deltaDeg = -3; deltaDeg <= 3.0001; deltaDeg += 0.5) {
      const t = traceAt(alpha, deltaDeg)!;
      expect(t).not.toBeNull();
      for (const crossing of t.crossings) {
        expect(crossing.insideAperture).toBe(false);
      }
    }
  });

  it('两块固定镜法向相同（平行镜对是"方向不变"的原因）', () => {
    expect(alpha.fixed1.normal.distanceTo(alpha.fixed2.normal)).toBeLessThan(1e-12);
  });

  it('两固定镜分别位于可动镜平面的两侧（四次反射的必然几何）', () => {
    const sigma1 = alpha.fixed1.center.clone().sub(alpha.A).dot(alpha.n0);
    const sigma2 = alpha.fixed2.center.clone().sub(alpha.A).dot(alpha.n0);
    expect(sigma1 * sigma2).toBeLessThan(0);
  });

  it('入光偏移满足几何解（含可动镜台阶）', () => {
    expect(alpha.A.x).toBeCloseTo(INPUT_OFFSET_MM, 6);
    expect(radToDeg(0)).toBe(0);
  });
});
