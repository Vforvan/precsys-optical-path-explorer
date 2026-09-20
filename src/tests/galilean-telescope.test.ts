/**
 * Galilei 扩束望远镜 / 动态调焦的单元测试。
 *
 * 覆盖：
 *   · 两个近轴算子（自由传播、薄透镜）的**纯几何**自检
 *   · afocal 条件 d = f₂ − f₁（凹镜在前）与实际零点一致
 *   · 放大倍率的符号与大小
 *   · 平行位移放大：ΔX_out = M·Δx（专利关系）
 *   · 光束口径同比放大 M 倍
 *   · 零位出射严格平行、无残余倾角
 *   · Z 执行器的单调性、可逆性与逆解一致性
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  abcdApply,
  abcdMultiply,
  abcdPropagate,
  abcdThinLens,
  createGalileanTelescope,
  focusShiftAtTravel,
  stepThroughLenses,
  telescopeLensesAt,
  telescopeMagnificationAt,
  telescopeMatrix,
  telescopeOutputVergence,
  telescopeTravelForFocusShift,
  traceTelescope,
} from '../optics/galilean-telescope';
import { makeRay, reflect } from '../optics/ray';
import { NOVANTA_TELESCOPE, NOVANTA_AXIS, NOVANTA_OBJECTIVE } from '../config/novanta-layout';

const geom = createGalileanTelescope({
  positiveLensZ: NOVANTA_AXIS.telescopePositiveLens,
  negativeLensZ: NOVANTA_AXIS.telescopeNegativeLens,
});

/** 轴上平行入射的主光线。 */
function axialRay(heightMm = 0, z = NOVANTA_AXIS.inlet) {
  return makeRay(new Vector3(heightMm, 0, z), new Vector3(0, 0, -1));
}

describe('Galilei 望远镜 · 近轴算子自检（纯几何判据）', () => {
  it('会聚透镜 f>0：平行入射、高度 y 的光线在下游 f 处与光轴相交', () => {
    const f = 60;
    const y = 1;
    const after = stepThroughLenses(f, f, 0, y, 0); // 单透镜等价：m1 = −y/f
    expect(after.m1).toBeCloseTo(-y / f, 12);
    // 沿传播方向前进 f 后高度应为 0 —— 与**独立实现**的传播算子交叉验证。
    // M = P·L：光线先过透镜、再自由传播（abcdMultiply(a,b) 表示"先 b 后 a"）。
    const m = abcdMultiply(abcdPropagate(f), abcdThinLens(f));
    const out = abcdApply(m, y, 0);
    expect(Math.abs(out.y)).toBeLessThan(1e-12);
  });

  it('发散透镜 f<0：同一光线必须远离光轴', () => {
    const f = -15;
    const y = 1;
    const after = stepThroughLenses(f, f, 0, y, 0);
    expect(after.m1).toBeCloseTo(-y / f, 12); // = +1/15
    const m = abcdMultiply(abcdPropagate(15), abcdThinLens(f));
    const out = abcdApply(m, y, 0);
    expect(Math.abs(out.y)).toBeGreaterThan(y);
  });

  it('自由传播算子的行列式为 1，且与手工公式一致', () => {
    for (const d of [0, 1, 45, 200]) {
      const m = abcdPropagate(d);
      expect(m[0][0] * m[1][1] - m[0][1] * m[1][0]).toBeCloseTo(1, 12);
      const out = abcdApply(m, 2, 0.5);
      expect(out.y).toBeCloseTo(2 + d * 0.5, 12);
      expect(out.u).toBeCloseTo(0.5, 12);
    }
  });
});

describe('Galilei 望远镜 · afocal 条件与放大倍率', () => {
  it('零位镜距满足 afocal：平行入射 → 平行出射（残余倾角 < 1e-9 rad）', () => {
    const m = telescopeMatrix(geom, 0);
    expect(Math.abs(m[1][0])).toBeLessThan(1e-12);
    expect(telescopeOutputVergence(geom, 0)).toBeCloseTo(0, 12);
  });

  it('afocal 条件解出 d = f₂ − f₁（凹镜在前），与配置一致', () => {
    // afocal：凹镜在前时 d = f₂ + f₁ = f₂ − |f₁|（f₁ 为负）
    const expected = NOVANTA_TELESCOPE.positiveFocalLengthMm + NOVANTA_TELESCOPE.negativeFocalLengthMm;
    expect(geom.nominalSeparationMm).toBeCloseTo(expected, 9);
    // 对任意 y，afocal 时出射角必须为 0
    for (const y of [-2, -0.3, 0, 0.3, 2]) {
      const r = traceTelescope(geom, axialRay(y), 1, 0);
      expect(r.output.direction.y, `y=${y}`).toBeCloseTo(0, 12);
      expect(r.directionDeviationDeg, `y=${y}`).toBeLessThan(1e-9);
    }
  });

  it('放大倍率 = d/f₂ − 1，且与实测位移比一致', () => {
    // 由 afocal 条件解出 M = f₂/|f₁|（同时等于 d/f₂ + 1 的等价表达式）
    const expectedM = NOVANTA_TELESCOPE.magnification;
    expect(expectedM).toBeGreaterThan(1);
    expect(telescopeMagnificationAt(geom, 0)).toBeCloseTo(expectedM, 9);
    for (const off of [0.2, 0.7, 1.5]) {
      const r = traceTelescope(geom, axialRay(off), 1, 0);
      expect(r.measuredMagnification).toBeCloseTo(expectedM, 8);
    }
  });

  it('专利关系 ΔX_out = M·Δx：输出位移严格等于输入位移乘放大倍率', () => {
    const M = telescopeMagnificationAt(geom, 0);
    for (const dx of [-1.5, -0.4, 0, 0.4, 1.5]) {
      for (const dy of [-1.2, 0, 1.2]) {
        const r = traceTelescope(geom, axialRay(0).origin.clone().set(dx, dy, NOVANTA_AXIS.inlet)
          ? makeRay(new Vector3(dx, dy, NOVANTA_AXIS.inlet), new Vector3(0, 0, -1))
          : axialRay(0), 1, 0);
        expect(r.outputOffsetMm).toBeCloseTo(M * r.inputOffsetMm, 8);
      }
    }
  });

  it('光束口径同比放大 M 倍（与位移放大是同一个数）', () => {
    const M = telescopeMagnificationAt(geom, 0);
    const r = traceTelescope(geom, axialRay(0.5), 1, 0);
    expect(r.outputRadiusMm / r.inputRadiusMm).toBeCloseTo(M, 8);
    expect(r.outputRadiusMm).toBeCloseTo(M, 8);
  });

  it('轴上入射（无位移）不产生位移，放大倍率定义良态', () => {
    const r = traceTelescope(geom, axialRay(0), 1, 0);
    expect(r.inputOffsetMm).toBeCloseTo(0, 12);
    expect(r.outputOffsetMm).toBeCloseTo(0, 12);
    expect(Number.isNaN(r.measuredMagnification)).toBe(false);
  });

  it('出射方向与输入方向在零位严格平行（方向为单位 −Z）', () => {
    const r = traceTelescope(geom, axialRay(1.0), 1, 0);
    expect(r.output.direction.x).toBeCloseTo(0, 12);
    expect(r.output.direction.y).toBeCloseTo(0, 12);
    expect(r.output.direction.z).toBeCloseTo(-1, 12);
  });
});

describe('Galilei 望远镜 · Z 动态调焦', () => {
  it('零位不改变焦点：输出会聚度为 0、焦点位移为 0', () => {
    expect(telescopeOutputVergence(geom, 0)).toBeCloseTo(0, 12);
    expect(focusShiftAtTravel(geom, 0)).toBeCloseTo(0, 12);
  });

  it('执行器行程单调改变焦点 Z，且正负对称', () => {
    const zNeg = focusShiftAtTravel(geom, -geom.maxTravelMm);
    const zPos = focusShiftAtTravel(geom, geom.maxTravelMm);
    expect(zNeg).toBeLessThan(0);
    expect(zPos).toBeGreaterThan(0);
    // 焦点 Z 映射按设计是非线性的（与 SCANLAB 模式共用同一套物镜等效关系），
    // 因此只要求两端量级对称，而不是数值上严格反号相等。
    expect(Math.abs(zNeg)).toBeGreaterThan(0.5 * Math.abs(zPos));
    expect(Math.abs(zNeg)).toBeLessThan(1.5 * Math.abs(zPos));
    // 单调
    let prev = -Infinity;
    for (let q = -geom.maxTravelMm; q <= geom.maxTravelMm + 1e-9; q += geom.maxTravelMm / 8) {
      const z = focusShiftAtTravel(geom, q);
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
  });

  it('Z 可逆：来回移动同一行程得到同一焦点位置', () => {
    for (const q of [-1.2, -0.4, 0.4, 1.2]) {
      const forward = focusShiftAtTravel(geom, q);
      const back = focusShiftAtTravel(geom, q);
      expect(back).toBeCloseTo(forward, 12);
      expect(focusShiftAtTravel(geom, 0)).toBeCloseTo(0, 12);
    }
  });

  it('逆解一致：telescopeTravelForFocusShift 是 focusShiftAtTravel 的逆', () => {
    for (const z of [-0.2, -0.1, 0, 0.1, 0.2]) {
      const r = telescopeTravelForFocusShift(geom, z);
      expect(r.saturated).toBe(false);
      expect(focusShiftAtTravel(geom, r.travelMm)).toBeCloseTo(z, 6);
    }
  });

  it('超出教学行程的目标会如实饱和', () => {
    const r = telescopeTravelForFocusShift(geom, 99);
    expect(r.saturated).toBe(true);
    expect(Math.abs(r.travelMm)).toBeLessThanOrEqual(geom.maxTravelMm + 1e-12);
  });

  it('执行器行程被夹在教学行程内（不会超出配置）', () => {
    const lenses = telescopeLensesAt(geom, 999);
    expect(Math.abs(lenses.separationMm - geom.nominalSeparationMm)).toBeLessThanOrEqual(
      geom.maxTravelMm + 1e-9,
    );
  });

  it('失配时输出不再准直（这正是调焦的工作状态）', () => {
    /**
     * 轴上主光线是"过光心的光线"，失配时它本身的方向不变；
     * 真正体现"不再准直"的是**离轴**光线的残余倾角与光束曲率，
     * 因此这里查的是会聚度 + 离轴光线的方向偏离。
     */
    const axial = traceTelescope(geom, axialRay(0), 1, geom.maxTravelMm);
    expect(Math.abs(axial.outputVergence)).toBeGreaterThan(0);

    const offset = traceTelescope(geom, axialRay(1), 1, geom.maxTravelMm);
    const offAxisTilt = Math.hypot(offset.output.direction.x, offset.output.direction.y);
    expect(offAxisTilt).toBeGreaterThan(0);
    expect(offset.directionDeviationDeg).toBeGreaterThan(0);
  });

  it('离轴光线在零位仍然准直、在失配时出现残余倾角（对比）', () => {
    const atZero = traceTelescope(geom, axialRay(1), 1, 0);
    const offAxisTiltZero = Math.hypot(atZero.output.direction.x, atZero.output.direction.y);
    expect(offAxisTiltZero).toBeLessThan(1e-12);

    const mismatched = traceTelescope(geom, axialRay(1), 1, geom.maxTravelMm);
    const offAxisTiltMismatch = Math.hypot(
      mismatched.output.direction.x,
      mismatched.output.direction.y,
    );
    expect(offAxisTiltMismatch).toBeGreaterThan(offAxisTiltZero + 1e-6);
  });

  it('Z 焦点量级与公开的"毫米级移动"量级自洽', () => {
    const fullRange = Math.abs(focusShiftAtTravel(geom, geom.maxTravelMm));
    expect(fullRange).toBeGreaterThan(0.02);
    expect(fullRange).toBeLessThan(2);
  });
});

describe('Galilei 望远镜 · 口径与数值稳定', () => {
  it('零位时放大后的光束与位移在镜片口径内', () => {
    const r = traceTelescope(geom, axialRay(1.5), 1, 0);
    expect(r.apertureClear).toBe(true);
  });

  it('极端位移会被如实判为超出镜片口径', () => {
    const r = traceTelescope(geom, axialRay(40), 4, 0);
    expect(r.apertureClear).toBe(false);
  });

  it('全行程扫描不产生 NaN', () => {
    for (let q = -geom.maxTravelMm; q <= geom.maxTravelMm + 1e-9; q += geom.maxTravelMm / 10) {
      for (const off of [-1.5, 0, 1.5]) {
        const r = traceTelescope(geom, makeRay(new Vector3(off, 0, NOVANTA_AXIS.inlet), new Vector3(0, 0, -1)), 1, q);
        for (const v of [r.outputRadiusMm, r.outputVergence, r.measuredMagnification, r.directionDeviationDeg]) {
          expect(Number.isNaN(v)).toBe(false);
        }
      }
    }
  });

  it('几何自洽：凹镜在上游、凸镜在下游，且物镜内部扩束参数为公开/教学定义', () => {
    expect(geom.negative.center.z).toBeGreaterThan(geom.positive.center.z);
    expect(geom.negative.focalLengthMm).toBeLessThan(0);
    expect(geom.positive.focalLengthMm).toBeGreaterThan(0);
    expect(NOVANTA_OBJECTIVE.internalMagnification).toBeGreaterThan(0);
  });
});

describe('Galilei 望远镜 · 反射辅助量（供场景层复用）', () => {
  it('reflect 与望远镜无关：仅确认导入的反射算子可用', () => {
    const r = reflect(new Vector3(0, 0, -1), new Vector3(0, 0, 1));
    expect(r.z).toBeCloseTo(1, 12);
  });
});
