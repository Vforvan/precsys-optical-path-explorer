/**
 * 折射与平行平板追迹的单元测试（Novanta / ARGES 路线）。
 *
 * 覆盖：
 *   · Snell 定律（向量形式与标量形式一致）
 *   · 垂直入射不偏折、不位移
 *   · 正/负倾角位移反号
 *   · 空气 → 平行板 → 空气：输出方向与输入方向平行（数值精度级）
 *   · 解析式 Δ = t·sin(i−r)/cos r 与真实追迹结果一致
 *   · 位移随倾角单调、随折射率与厚度真实变化
 *   · 全内反射如实返回失败（不静默降级）
 *   · 数值稳定性：不产生 NaN、极角不崩
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  analyticLateralShiftMm,
  internalPathLengthMm,
  refractDirection,
  refractionAngleRad,
  tracePlaneParallelPlate,
  type ParallelPlate,
} from '../optics/refraction';
import { makeRay } from '../optics/ray';

const DEG = Math.PI / 180;

function plate(tiltRad: number, thicknessMm = 12, refractiveIndex = 1.52): ParallelPlate {
  return {
    entryPlanePoint: new Vector3(0, 0, 0),
    normal: new Vector3(0, 0, 1).applyAxisAngle(new Vector3(1, 0, 0), tiltRad),
    thicknessMm,
    refractiveIndex,
  };
}

/** 沿 -Z 入射的光线。 */
function downRay(origin = new Vector3(0, 0, 50)) {
  return makeRay(origin, new Vector3(0, 0, -1));
}

describe('refraction · Snell 定律', () => {
  it('垂直入射不偏折', () => {
    const d = refractDirection(new Vector3(0, 0, -1), new Vector3(0, 0, 1), 1, 1.52);
    expect(d).not.toBeNull();
    expect(d!.x).toBeCloseTo(0, 12);
    expect(d!.y).toBeCloseTo(0, 12);
    expect(d!.z).toBeCloseTo(-1, 12);
  });

  it('向量形式与标量 Snell 一致（n₁ sin i = n₂ sin r）', () => {
    const n1 = 1;
    const n2 = 1.52;
    const incidence = 30 * DEG;
    const incident = new Vector3(Math.sin(incidence), 0, -Math.cos(incidence));
    const normal = new Vector3(0, 0, 1);
    const out = refractDirection(incident, normal, n1, n2);
    expect(out).not.toBeNull();
    // 出射方向与法向的夹角即折射角
    const r = Math.acos(Math.min(1, Math.abs(out!.dot(normal))));
    expect(r).toBeCloseTo(refractionAngleRad(incidence, n1, n2), 12);
    expect(n1 * Math.sin(incidence)).toBeCloseTo(n2 * Math.sin(r), 12);
  });

  it('法向定向无关：n 与其反向给出同一折射方向', () => {
    const incident = new Vector3(Math.sin(25 * DEG), 0, -Math.cos(25 * DEG));
    const a = refractDirection(incident, new Vector3(0, 0, 1), 1, 1.52)!;
    const b = refractDirection(incident, new Vector3(0, 0, -1), 1, 1.52)!;
    expect(a.distanceTo(b)).toBeLessThan(1e-12);
  });

  it('折射率非法时返回 null，不产生 NaN', () => {
    expect(refractDirection(new Vector3(0, 0, -1), new Vector3(0, 0, 1), 0, 1.52)).toBeNull();
    expect(refractDirection(new Vector3(0, 0, -1), new Vector3(0, 0, 1), 1, Number.NaN)).toBeNull();
  });

  it('玻璃 → 空气超过临界角时返回 null（全内反射）', () => {
    // 从 n=1.52 到 n=1，临界角约 41.1°
    expect(refractDirection(new Vector3(Math.sin(50 * DEG), 0, -Math.cos(50 * DEG)),
      new Vector3(0, 0, 1), 1.52, 1)).toBeNull();
    const ok = refractDirection(new Vector3(Math.sin(20 * DEG), 0, -Math.cos(20 * DEG)),
      new Vector3(0, 0, 1), 1.52, 1);
    expect(ok).not.toBeNull();
  });
});

describe('refraction · 平行平板追迹', () => {
  it('零倾角：无折射、无位移', () => {
    const r = tracePlaneParallelPlate(downRay(), plate(0));
    expect(r).not.toBeNull();
    expect(r!.lateralShiftMm).toBeCloseTo(0, 12);
    expect(r!.diagnostics.entryIncidenceDeg).toBeCloseTo(0, 10);
    expect(r!.diagnostics.totalInternalReflection).toBe(false);
  });

  it('性质 1：空气→平行板→空气，输出方向与输入方向平行（< 1e-9 度）', () => {
    for (const tiltDeg of [-25, -18, -12, -6, -1, 1, 6, 12, 18, 25]) {
      const r = tracePlaneParallelPlate(downRay(), plate(tiltDeg * DEG));
      expect(r, `倾角 ${tiltDeg}° 追迹失败`).not.toBeNull();
      expect(r!.directionDeviationDeg, `倾角 ${tiltDeg}° 方向偏差`).toBeLessThan(1e-9);
    }
  });

  it('出入口折射角：出射面入射角等于玻璃内折射角，出射角等于原入射角', () => {
    const tiltDeg = 17;
    const r = tracePlaneParallelPlate(downRay(), plate(tiltDeg * DEG))!;
    expect(r.diagnostics.exitIncidenceDeg).toBeCloseTo(r.diagnostics.internalRefractionDeg, 10);
    // 玻璃内传播方向与法向夹角 = 折射角
    const n = plate(tiltDeg * DEG).normal.clone().normalize();
    const internal = Math.acos(Math.min(1, Math.abs(r.internalDirection.dot(n)))) / DEG;
    expect(internal).toBeCloseTo(r.diagnostics.internalRefractionDeg, 8);
  });

  it('玻璃内程长 = 厚度 / cos r', () => {
    const tiltDeg = 14;
    const tiltRad = tiltDeg * DEG;
    const r = tracePlaneParallelPlate(downRay(), plate(tiltRad))!;
    const actual = r.entryHit.distanceTo(r.exitHit);
    const expected = internalPathLengthMm(12, r.diagnostics.internalRefractionDeg * DEG);
    expect(actual).toBeCloseTo(expected, 10);
  });

  it('解析式 Δ = t·sin(i−r)/cos r 与真实追迹位移一致', () => {
    const n = 1.52;
    for (const tiltDeg of [-16, -9, -3, 0, 3, 9, 16]) {
      const i = tiltDeg * DEG;
      const traced = tracePlaneParallelPlate(downRay(), plate(i, 12, n))!;
      const r = refractionAngleRad(Math.abs(i), 1, n);
      const analytic = analyticLateralShiftMm(Math.abs(i), r, 12);
      expect(traced.lateralShiftMm).toBeCloseTo(analytic, 9);
    }
  });

  it('性质 2：横向位移随倾角单调增加', () => {
    let previous = -1;
    for (let tiltDeg = 0; tiltDeg <= 20; tiltDeg += 2) {
      const r = tracePlaneParallelPlate(downRay(), plate(tiltDeg * DEG))!;
      expect(r.lateralShiftMm).toBeGreaterThan(previous);
      previous = r.lateralShiftMm;
    }
  });

  it('性质 3：倾角符号翻转时位移向量反号', () => {
    const pos = tracePlaneParallelPlate(downRay(), plate(12 * DEG))!;
    const neg = tracePlaneParallelPlate(downRay(), plate(-12 * DEG))!;
    expect(pos.lateralShiftVector.x).toBeCloseTo(-neg.lateralShiftVector.x, 10);
    expect(pos.lateralShiftVector.y).toBeCloseTo(-neg.lateralShiftVector.y, 10);
    expect(pos.lateralShiftMm).toBeCloseTo(neg.lateralShiftMm, 10);
  });

  it('性质 4：厚度与折射率真实影响位移', () => {
    const a = tracePlaneParallelPlate(downRay(), plate(12 * DEG, 12, 1.52))!;
    const b = tracePlaneParallelPlate(downRay(), plate(12 * DEG, 24, 1.52))!;
    expect(b.lateralShiftMm / a.lateralShiftMm).toBeCloseTo(2, 6);

    const c = tracePlaneParallelPlate(downRay(), plate(12 * DEG, 12, 1.8))!;
    expect(c.lateralShiftMm).toBeGreaterThan(a.lateralShiftMm);
  });

  it('位移向量严格垂直于光线方向', () => {
    for (const tiltDeg of [-18, -7, 5, 18]) {
      const r = tracePlaneParallelPlate(downRay(), plate(tiltDeg * DEG))!;
      expect(Math.abs(r.lateralShiftVector.dot(r.outputRay.direction))).toBeLessThan(1e-12);
    }
  });

  it('倾角超过 90° 时按背面入射仍成立，不产生 NaN', () => {
    const r = tracePlaneParallelPlate(downRay(), plate(100 * DEG));
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.lateralShiftMm)).toBe(true);
    expect(r!.directionDeviationDeg).toBeLessThan(1e-9);
  });

  it('掠入射（接近 89.9°）不崩，且仍保持出射平行', () => {
    const r = tracePlaneParallelPlate(downRay(), plate(89.9 * DEG));
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.lateralShiftMm)).toBe(true);
    expect(r!.directionDeviationDeg).toBeLessThan(1e-8);
  });

  it('厚度非法时返回 null（不静默给出结果）', () => {
    expect(tracePlaneParallelPlate(downRay(), plate(10 * DEG, 0))).toBeNull();
    expect(tracePlaneParallelPlate(downRay(), plate(10 * DEG, Number.NaN))).toBeNull();
  });

  it('光线起点沿光轴平移不改变横向位移（位移只与倾角、厚度、折射率有关）', () => {
    const a = tracePlaneParallelPlate(downRay(new Vector3(0, 0, 50)), plate(11 * DEG))!;
    const b = tracePlaneParallelPlate(downRay(new Vector3(0, 0, 120)), plate(11 * DEG))!;
    expect(a.lateralShiftVector.distanceTo(b.lateralShiftVector)).toBeLessThan(1e-12);
  });
});
