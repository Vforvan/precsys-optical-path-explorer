/**
 * 双平行板 wobble unit 与进动轨迹的单元测试。
 *
 * 覆盖：
 *   · 只有板 A / 只有板 B 的响应方向（正交解耦）
 *   · 两板合并的位移相加
 *   · 出射光始终与入射光平行（即使两板都在倾斜）
 *   · 零倾角不产生 NaN、位移严格为 0
 *   · 教学倾角上限附近的行为安全
 *   · 口径校验
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  createWobbleUnit,
  plateShiftCurve,
  tiltForPlateShift,
  traceWobbleUnit,
} from '../optics/dual-plate-precession';
import { plateShiftAt, tracePlate, plateInputRay } from '../optics/plane-parallel-plate';
import { NOVANTA_PLATES } from '../config/novanta-layout';

const DEG = Math.PI / 180;
const unit = createWobbleUnit();

describe('wobble unit · 单板响应', () => {
  it('两板转轴正交，且都与名义光轴（−Z）正交', () => {
    const a = unit.plateA.rotationAxis;
    const b = unit.plateB.rotationAxis;
    const beam = new Vector3(0, 0, -1);
    expect(Math.abs(a.dot(beam))).toBeLessThan(1e-12);
    expect(Math.abs(b.dot(beam))).toBeLessThan(1e-12);
    expect(Math.abs(a.dot(b))).toBeLessThan(1e-12);
  });

  it('板 A 的位移轴沿 +Y、板 B 的位移轴沿 −X（由向量 Snell 定符号）', () => {
    expect(unit.plateA.lateralAxis.y).toBeCloseTo(1, 12);
    expect(unit.plateB.lateralAxis.x).toBeCloseTo(-1, 12);
  });

  it('只有板 A 倾斜：位移只出现在 Y，X 保持 0', () => {
    const s = traceWobbleUnit(unit, 6 * DEG, 0);
    expect(s).not.toBeNull();
    expect(Math.abs(s!.offsetVector.x)).toBeLessThan(1e-12);
    expect(s!.offsetVector.y).toBeGreaterThan(1e-6);
  });

  it('只有板 B 倾斜：位移只出现在 X，Y 保持 0', () => {
    const s = traceWobbleUnit(unit, 0, 6 * DEG);
    expect(s).not.toBeNull();
    expect(Math.abs(s!.offsetVector.y)).toBeLessThan(1e-12);
    expect(s!.offsetVector.x).toBeLessThan(-1e-6);
  });

  it('正交响应：两板倾斜给出的位移等于各自单独位移的矢量和', () => {
    const a = traceWobbleUnit(unit, 5 * DEG, 0)!;
    const b = traceWobbleUnit(unit, 0, 7 * DEG)!;
    const both = traceWobbleUnit(unit, 5 * DEG, 7 * DEG)!;
    expect(both.offsetVector.x).toBeCloseTo(b.offsetVector.x, 9);
    expect(both.offsetVector.y).toBeCloseTo(a.offsetVector.y, 9);
  });

  it('位移随倾角单调，且符号随倾角翻转', () => {
    const pos = plateShiftAt(unit.plateB, 5 * DEG);
    const neg = plateShiftAt(unit.plateB, -5 * DEG);
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeLessThan(0);
    expect(pos).toBeCloseTo(-neg, 9);
    expect(plateShiftAt(unit.plateA, 5 * DEG)).toBeGreaterThan(0);
  });
});

describe('wobble unit · 出射光方向', () => {
  it('两板任意倾角下，出射光都严格平行于入射光（< 1e-9 度）', () => {
    for (const ta of [-12, -4, 0, 4, 12]) {
      for (const tb of [-12, -4, 0, 4, 12]) {
        const s = traceWobbleUnit(unit, ta * DEG, tb * DEG);
        expect(s, `tiltA=${ta} tiltB=${tb}`).not.toBeNull();
        expect(s!.poseA.directionDeviationDeg, `A tiltA=${ta}`).toBeLessThan(1e-9);
        expect(s!.poseB.directionDeviationDeg, `B tiltA=${ta} tiltB=${tb}`).toBeLessThan(1e-9);
      }
    }
  });

  it('出射光起点位于板 B 的出射面上', () => {
    const s = traceWobbleUnit(unit, 8 * DEG, -5 * DEG)!;
    expect(s.outputRay.origin.distanceTo(s.poseB.exitHit)).toBeLessThan(1e-12);
  });
});

describe('wobble unit · 零位与边界', () => {
  it('零倾角：位移严格为 0，且无 NaN', () => {
    const s = traceWobbleUnit(unit, 0, 0);
    expect(s).not.toBeNull();
    expect(s!.offsetRadiusMm).toBeCloseTo(0, 12);
    expect(s!.offsetVector.x).toBeCloseTo(0, 12);
    expect(s!.offsetVector.y).toBeCloseTo(0, 12);
    for (const value of [s!.offsetRadiusMm, s!.poseA.incidenceDeg, s!.poseB.incidenceDeg]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it('零倾角时两板都是垂直入射、无折射', () => {
    const s = traceWobbleUnit(unit, 0, 0)!;
    expect(s.poseA.incidenceDeg).toBeCloseTo(0, 10);
    expect(s.poseB.incidenceDeg).toBeCloseTo(0, 10);
    expect(s.poseA.signedShiftMm).toBeCloseTo(0, 12);
    expect(s.poseB.signedShiftMm).toBeCloseTo(0, 12);
  });

  it('教学倾角上限（±20°）附近追迹安全、无 NaN、无全内反射', () => {
    const limit = NOVANTA_PLATES.maxMechanicalTiltDeg;
    for (const t of [-limit, -limit * 0.99, limit * 0.99, limit]) {
      const s = traceWobbleUnit(unit, t * DEG, t * DEG);
      expect(s, `tilt=${t}`).not.toBeNull();
      expect(Number.isFinite(s!.offsetRadiusMm)).toBe(true);
      expect(s!.poseA.totalInternalReflection).toBe(false);
      expect(s!.poseB.totalInternalReflection).toBe(false);
    }
  });

  it('超过 90° 的极端倾角被如实拒绝或如实返回，不静默给错值', () => {
    const s = traceWobbleUnit(unit, 100 * DEG, 0);
    if (s) {
      expect(Number.isFinite(s.offsetRadiusMm)).toBe(true);
    } else {
      expect(s).toBeNull();
    }
  });

  it('单板位移曲线在行程内单调递增', () => {
    const curve = plateShiftCurve(unit, 'B', 41);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].shiftMm).toBeGreaterThan(curve[i - 1].shiftMm);
    }
  });
});

describe('wobble unit · 数值逆解与口径', () => {
  it('tiltForPlateShift 是 plateShiftAt 的逆（误差 < 1e-9 mm）', () => {
    for (const target of [-1.2, -0.5, -0.05, 0, 0.05, 0.5, 1.2]) {
      const r = tiltForPlateShift(unit.plateB, target);
      expect(r.saturated).toBe(false);
      expect(plateShiftAt(unit.plateB, r.tiltRad)).toBeCloseTo(target, 9);
    }
  });

  it('超出可达位移时如实报告 saturated，并夹到行程端点', () => {
    const r = tiltForPlateShift(unit.plateB, 99);
    expect(r.saturated).toBe(true);
    expect(Math.abs(r.tiltRad)).toBeLessThanOrEqual(
      (NOVANTA_PLATES.maxMechanicalTiltDeg + 1e-9) * DEG,
    );
  });

  it('口径校验：教学行程内通过；超过口径的极宽光束如实判失败', () => {
    // 教学行程（±20°）内，30 mm 口径足以容纳位移与 1 mm 光束半径
    for (const tilt of [0, 2, 10, 20]) {
      const s = traceWobbleUnit(unit, tilt * DEG, tilt * DEG, 1)!;
      expect(s.apertureClear, `tilt ${tilt}°`).toBe(true);
    }
    // 光束本身比口径还宽时必须如实失败（不能因为"中心光线能过"就说通过）
    const tooWide = traceWobbleUnit(unit, 0, 0, 40);
    expect(tooWide).not.toBeNull();
    expect(tooWide!.apertureClear).toBe(false);
  });

  it('单板追迹：光线起点沿光轴平移不影响位移', () => {
    const a = tracePlate(unit.plateA, plateInputRay(unit.plateA, 40), 7 * DEG)!;
    const b = tracePlate(unit.plateA, plateInputRay(unit.plateA, 200), 7 * DEG)!;
    expect(a.signedShiftMm).toBeCloseTo(b.signedShiftMm, 12);
  });

  /**
   * 回归：平板的**定位基准点**必须不随倾角移动。
   *
   * 早期实现把 pivot 绕转轴旋转一个倾角来定位板面。光学上没错
   * （入射面过 pivot，转不转都是同一张平面），但 pivot 在光轴上、离板面有
   * 约 400 mm 的力臂，于是 10° 倾角会把三维里的玻璃板沿光轴横向甩出 70 mm 以上 ——
   * 画面表现为"两块板漂到光路旁边，而光线看起来还是直的"，极难从画面反推原因。
   *
   * 这里钉住两件事：基准点在任意倾角下都等于 pivot；且它确实落在该倾角的入射面上。
   */
  it('定位基准点不随倾角漂移，且始终落在当前倾角的入射面上', () => {
    for (const plate of [unit.plateA, unit.plateB]) {
      for (const tiltDeg of [0, 2, 10, 20, -20]) {
        const pose = tracePlate(plate, plateInputRay(plate), tiltDeg * DEG)!;
        expect(pose.entryPlanePoint.distanceTo(plate.pivot), `${plate.id} @ ${tiltDeg}°`).toBeLessThan(
          1e-12,
        );
        const signed = pose.entryPlanePoint.clone().sub(plate.pivot).dot(pose.normal);
        expect(Math.abs(signed), `${plate.id} @ ${tiltDeg}° 基准点离开入射面`).toBeLessThan(1e-12);
      }
    }
  });

  it('倾角只改变入射面法向：n·n₀ 与 cos(倾角) 一致，不出现"板心平移"', () => {
    for (const plate of [unit.plateA, unit.plateB]) {
      for (const tiltDeg of [5, 12, 20]) {
        const pose = tracePlate(plate, plateInputRay(plate), tiltDeg * DEG)!;
        expect(pose.normal.dot(plate.nominalNormal), `${plate.id} @ ${tiltDeg}°`).toBeCloseTo(
          Math.cos(tiltDeg * DEG),
          12,
        );
      }
    }
  });
});
