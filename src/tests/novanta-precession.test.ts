/**
 * 进动轨迹与控制策略的单元测试。
 *
 * 覆盖：
 *   · sin/cos 驱动生成闭合轨迹
 *   · 相位差 90° 生成近似圆轨迹
 *   · **非圆度确实大于 0**（因为平行平板的位移对倾角是非线性的）
 *   · 相位差变化生成椭圆 / Lissajous（相位 0° 退化为直线）
 *   · "精确圆补偿"模式显著改善圆度
 *   · 两种模式下两板都只做绕各自正交轴的倾斜，位移向量绕光轴旋转
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRECESSION,
  createWobbleUnit,
  plateTiltsForPhase,
  precessionSampleAt,
  samplePrecessionTrajectory,
  type PrecessionParams,
} from '../optics/dual-plate-precession';

const DEG = Math.PI / 180;
const unit = createWobbleUnit();

describe('进动 · sin/cos 驱动', () => {
  it('相位 90° 生成闭合的近似圆轨迹', () => {
    const t = samplePrecessionTrajectory(unit, {
      ...DEFAULT_PRECESSION,
      amplitudeDeg: 6,
      phaseDeg: 90,
    });
    expect(t.ok).toBe(true);
    expect(t.sampleCount).toBeGreaterThan(100);
    // 闭合：相位 2π 与相位 0 的点必须重合
    expect(t.closureErrorMm).toBeLessThan(1e-9);
    // 近似圆：半径的极差远小于半径本身
    expect(t.nonCircularity).toBeGreaterThan(0);
    expect(t.nonCircularity).toBeLessThan(0.02);
  });

  it('非圆度必然大于 0：位移对倾角非线性，简单 sin/cos 不是精确圆', () => {
    const small = samplePrecessionTrajectory(unit, {
      ...DEFAULT_PRECESSION,
      amplitudeDeg: 3,
      phaseDeg: 90,
    });
    const large = samplePrecessionTrajectory(unit, {
      ...DEFAULT_PRECESSION,
      amplitudeDeg: 15,
      phaseDeg: 90,
    });
    expect(small.nonCircularity).toBeGreaterThan(0);
    expect(large.nonCircularity).toBeGreaterThan(small.nonCircularity);
    // 幅值越大越偏离圆（tan 型非线性随角度加剧）
    expect(large.nonCircularity).toBeGreaterThan(0.005);
  });

  it('相位 0° 退化为直线（Lissajous 的退化情形）', () => {
    const t = samplePrecessionTrajectory(unit, {
      ...DEFAULT_PRECESSION,
      amplitudeDeg: 6,
      phaseDeg: 0,
    });
    expect(t.ok).toBe(true);
    // 直线轨迹的半径最小值接近 0
    expect(t.minRadiusMm).toBeLessThan(0.05 * t.maxRadiusMm);
    expect(t.nonCircularity).toBeGreaterThan(1);
  });

  it('相位 45°/135° 生成椭圆，且两者半径极差相同（镜像）', () => {
    const a = samplePrecessionTrajectory(unit, { ...DEFAULT_PRECESSION, phaseDeg: 45 });
    const b = samplePrecessionTrajectory(unit, { ...DEFAULT_PRECESSION, phaseDeg: 135 });
    expect(a.meanRadiusMm).toBeCloseTo(b.meanRadiusMm, 6);
    expect(a.maxRadiusMm).toBeCloseTo(b.maxRadiusMm, 6);
    expect(a.nonCircularity).toBeGreaterThan(0.2);
  });

  it('两板只做各自正交轴的倾斜：位移向量绕光轴旋转、板本身不自转', () => {
    const samples = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) =>
      precessionSampleAt(unit, deg * DEG, { ...DEFAULT_PRECESSION, amplitudeDeg: 8 })!,
    );
    // 板 A 只绕 X 转、板 B 只绕 Y 转（法向始终落在对应平面内）
    for (const s of samples) {
      expect(Math.abs(s.poseA.normal.x)).toBeLessThan(1e-12);
      expect(Math.abs(s.poseB.normal.y)).toBeLessThan(1e-12);
    }
    // 位移方位角覆盖整圈
    const azimuths = samples.map((s) => s.offsetAzimuthDeg);
    const spread = Math.max(...azimuths) - Math.min(...azimuths);
    expect(spread).toBeGreaterThan(180);
    // 半径基本不变（这就是"点绕光轴转、板不转"）
    const radii = samples.map((s) => s.offsetRadiusMm);
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05 * Math.max(...radii));
  });

  it('每个采样点出射光都与入射光平行（折射不改变方向）', () => {
    const t = samplePrecessionTrajectory(unit, { ...DEFAULT_PRECESSION, amplitudeDeg: 10 });
    for (let i = 0; i < 24; i += 1) {
      const s = precessionSampleAt(unit, (i / 24) * 2 * Math.PI, {
        ...DEFAULT_PRECESSION,
        amplitudeDeg: 10,
      })!;
      expect(s.poseB.directionDeviationDeg).toBeLessThan(1e-9);
    }
    expect(t.ok).toBe(true);
  });
});

describe('进动 · 精确圆补偿模式', () => {
  const compensated: PrecessionParams = {
    amplitudeDeg: DEFAULT_PRECESSION.amplitudeDeg,
    phaseDeg: 90,
    driveMode: 'compensated-circle',
    targetRadiusMm: 0.6,
  };

  it('补偿模式把非圆度从千分之几降到数值精度级', () => {
    const simple = samplePrecessionTrajectory(unit, {
      ...DEFAULT_PRECESSION,
      amplitudeDeg: 6,
      phaseDeg: 90,
      targetRadiusMm: 0.6,
    });
    const comp = samplePrecessionTrajectory(unit, compensated);
    expect(comp.ok).toBe(true);
    expect(simple.nonCircularity).toBeGreaterThan(1e-4);
    // 补偿后应好两到三个数量级
    expect(comp.nonCircularity).toBeLessThan(simple.nonCircularity / 100);
    expect(comp.nonCircularity).toBeLessThan(1e-6);
  });

  it('补偿模式的轨迹半径等于目标半径', () => {
    const comp = samplePrecessionTrajectory(unit, compensated);
    expect(comp.meanRadiusMm).toBeCloseTo(compensated.targetRadiusMm, 6);
  });

  it('补偿模式各点位移的方位角均匀分布（真正的圆）', () => {
    /**
     * 补偿模式的目标是"沿两块板各自的位移轴取 R·cosφ 与 R·sinφ"。
     * 板 B 的位移轴沿 −X、板 A 沿 +Y，因此轨迹相对于 +X 轴是镜像的（方向反转），
     * 但**半径与方位角的均匀性不受影响**——按轨迹自身的方位角序列检查即可。
     */
    const azimuths: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const phase = (i / 12) * 2 * Math.PI;
      const s = precessionSampleAt(unit, phase, compensated)!;
      azimuths.push(s.offsetAzimuthDeg);
      expect(s.offsetRadiusMm).toBeCloseTo(compensated.targetRadiusMm, 6);
    }
    // 方位角必须严格等间隔 30°，且不是全部相同（也就是真的在绕圈）
    const sorted = [...azimuths].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(30, 4);
    }
    const unique = new Set(azimuths.map((a) => a.toFixed(3)));
    expect(unique.size).toBe(azimuths.length);
  });

  it('补偿模式的机械角恰好逆解出目标位移（逐板核对）', () => {
    for (const phase of [0, Math.PI / 3, Math.PI, (3 * Math.PI) / 2]) {
      const s = precessionSampleAt(unit, phase, compensated)!;
      const targetX = compensated.targetRadiusMm * Math.cos(phase);
      const targetY = compensated.targetRadiusMm * Math.sin(phase);
      // 板 B 的带符号位移 = 目标 X 分量；板 A = 目标 Y 分量
      expect(s.shiftBMm).toBeCloseTo(targetX, 8);
      expect(s.shiftAMm).toBeCloseTo(targetY, 8);
    }
  });

  it('超过教学机械行程的目标半径会如实饱和，而不是谎报成功', () => {
    const tooBig = samplePrecessionTrajectory(unit, {
      ...compensated,
      targetRadiusMm: 99,
    });
    // "转不到"必须与"装不下"一样被报出来：ok = false 且 tiltSaturated = true
    expect(tooBig.tiltSaturated).toBe(true);
    expect(tooBig.ok).toBe(false);
    expect(tooBig.meanRadiusMm).toBeLessThan(99);
    expect(tooBig.maxTiltDeg).toBeLessThanOrEqual(20 + 1e-6);
  });

  it('行程内的目标半径不报饱和（对照）', () => {
    const fine = samplePrecessionTrajectory(unit, { ...compensated, targetRadiusMm: 1.0 });
    expect(fine.tiltSaturated).toBe(false);
    expect(fine.ok).toBe(true);
    expect(fine.meanRadiusMm).toBeCloseTo(1.0, 6);
  });

  it('两种模式的机械角都在教学行程内（默认参数）', () => {
    for (const params of [
      { ...DEFAULT_PRECESSION, amplitudeDeg: 6, phaseDeg: 90 },
      compensated,
    ]) {
      const t = samplePrecessionTrajectory(unit, params);
      expect(t.maxTiltDeg).toBeLessThanOrEqual(20 + 1e-6);
    }
  });
});

describe('进动 · 驱动曲线与专利描述一致', () => {
  it('专利模式：一板正弦、另一板相移正弦（机械角而非位移）', () => {
    const amplitudeDeg = 6;
    for (const phase of [0, 30, 90, 200]) {
      for (const phi of [0, 0.7, 1.9, 4.4]) {
        const { tiltARad, tiltBRad } = plateTiltsForPhase(unit, phi, {
          ...DEFAULT_PRECESSION,
          amplitudeDeg,
          phaseDeg: phase,
        });
        expect(tiltARad).toBeCloseTo(amplitudeDeg * DEG * Math.sin(phi), 12);
        expect(tiltBRad).toBeCloseTo(
          amplitudeDeg * DEG * Math.sin(phi + phase * DEG),
          12,
        );
      }
    }
  });

  it('幅值变化会改变轨迹半径（专利：改变幅值即改变轨迹）', () => {
    const r4 = samplePrecessionTrajectory(unit, { ...DEFAULT_PRECESSION, amplitudeDeg: 4 });
    const r8 = samplePrecessionTrajectory(unit, { ...DEFAULT_PRECESSION, amplitudeDeg: 8 });
    expect(r8.meanRadiusMm).toBeGreaterThan(r4.meanRadiusMm * 1.8);
  });
});
