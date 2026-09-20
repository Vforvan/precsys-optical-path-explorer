import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROCESS,
  PROCESS_MODES,
  TAPER_PRESETS,
  commandAtTheta,
  hasRotatingTilt,
  slowMotionFactor,
  thetaForScreenTime,
  totalDepthMm,
  type ProcessParams,
} from '../animation/process-modes';
import { radToDeg } from '../optics/ray';
import { createOpticalTrain, traceTrain } from '../optics/optical-train';
import { educationalInverseModel } from '../optics/educational-inverse-model';
import { OPTICS_VARIANTS } from '../config/public-specs';

const precession: ProcessParams = { ...DEFAULT_PROCESS, mode: 'precession', revolutions: 10 };

describe('加工模式与进动轨迹', () => {
  it('四种模式都有说明，且进动是唯一让倾斜向量旋转的模式', () => {
    expect(PROCESS_MODES.map((m) => m.key)).toEqual([
      'percussion',
      'trepann',
      'spiral',
      'precession',
    ]);
    expect(hasRotatingTilt('precession', 'negative')).toBe(true);
    expect(hasRotatingTilt('precession', 'positive')).toBe(true);
    expect(hasRotatingTilt('precession', 'straight')).toBe(false);
    expect(hasRotatingTilt('trepann', 'negative')).toBe(false);
    expect(hasRotatingTilt('spiral', 'positive')).toBe(false);
  });

  it('进动轨迹：焦点走圆、半径正确、Z 随圈数线性推进', () => {
    for (const theta of [0, Math.PI / 3, Math.PI, (3 * Math.PI) / 2]) {
      const cmd = commandAtTheta(precession, theta);
      const r = Math.hypot(cmd.xMm - precession.centerXMm, cmd.yMm - precession.centerYMm);
      expect(r).toBeCloseTo(precession.radiusMm, 9);
      const expectedZ = precession.focusZMm - precession.pitchMmPerRev * (theta / (2 * Math.PI));
      expect(cmd.zMm).toBeCloseTo(expectedZ, 9);
    }
  });

  it('倾斜向量的方位角与焦点方位角同步（相位锁定的核心）', () => {
    for (const theta of [0, 0.7, 2.2, 4.1, 5.9]) {
      const cmd = commandAtTheta(precession, theta);
      const focusAzimuth = Math.atan2(
        cmd.yMm - precession.centerYMm,
        cmd.xMm - precession.centerXMm,
      );
      const tiltAzimuth = Math.atan2(cmd.betaDeg, cmd.alphaDeg);
      const diff = Math.abs(((tiltAzimuth - focusAzimuth + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      // 同一方位或相差 180°（向内/向外两种预设）
      expect(Math.min(diff, Math.abs(diff - Math.PI))).toBeLessThan(1e-9);
    }
  });

  it('倾斜幅值等于设定值，直壁预设为 0', () => {
    const cmd = commandAtTheta({ ...precession, taper: 'negative' }, 1.234);
    expect(Math.hypot(cmd.alphaDeg, cmd.betaDeg)).toBeCloseTo(precession.tiltAmplitudeDeg, 9);
    const straight = commandAtTheta({ ...precession, taper: 'straight' }, 1.234);
    expect(straight.alphaDeg).toBeCloseTo(0, 12);
    expect(straight.betaDeg).toBeCloseTo(0, 12);
    const positive = commandAtTheta({ ...precession, taper: 'positive' }, 0);
    const negative = commandAtTheta({ ...precession, taper: 'negative' }, 0);
    expect(positive.alphaDeg).toBeCloseTo(-negative.alphaDeg, 9);
  });

  it('一圈恰好推进一个螺距，总深度 = 螺距 × 圈数', () => {
    const a = commandAtTheta(precession, 0);
    const b = commandAtTheta(precession, 2 * Math.PI);
    expect(a.zMm - b.zMm).toBeCloseTo(precession.pitchMmPerRev, 9);
    expect(totalDepthMm(precession)).toBeCloseTo(
      precession.pitchMmPerRev * precession.revolutions,
      9,
    );
  });

  it('环切与冲击模式的对比符合计划书表格', () => {
    const trepann = commandAtTheta({ ...precession, mode: 'trepann' }, 0.9);
    expect(Math.hypot(trepann.xMm, trepann.yMm)).toBeCloseTo(precession.radiusMm, 9);
    expect(trepann.alphaDeg).toBe(0);
    expect(trepann.betaDeg).toBe(0);

    const percussion = commandAtTheta({ ...precession, mode: 'percussion' }, 3.1);
    expect(percussion.xMm).toBe(precession.centerXMm);
    expect(percussion.yMm).toBe(precession.centerYMm);
  });

  it('慢放倍率换算：650 Hz 的真实一圈远小于屏幕一圈', () => {
    const factor = slowMotionFactor(650, 3.2);
    expect(factor).toBeGreaterThan(1000);
    const { theta, realSecondsElapsed } = thetaForScreenTime(precession, 1.6, 3.2);
    expect(theta).toBeCloseTo(Math.PI, 9);
    expect(realSecondsElapsed).toBeCloseTo(0.5 / 650, 9);
  });
});

describe('进动工况能被五轴模型解出来（倾斜向量随相位旋转）', () => {
  const train = createOpticalTrain(OPTICS_VARIANTS[0]);
  const params: ProcessParams = {
    ...DEFAULT_PROCESS,
    mode: 'precession',
    radiusMm: 0.5,
    tiltAmplitudeDeg: 6,
    taper: 'negative',
    pitchMmPerRev: 0.05,
    revolutions: 8,
  };

  it('一个圆周上的多个相位都能解到位，且焦点方位与倾斜方位同步旋转', () => {
    for (const theta of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const cmd = commandAtTheta(params, theta);
      const solved = educationalInverseModel(train, cmd);
      expect(solved.saturated).toBe(false);
      const traced = traceTrain(train, solved.actuators);
      // 焦点仍在设定位置
      expect(traced.focus.xMm).toBeCloseTo(cmd.xMm, 2);
      expect(traced.focus.yMm).toBeCloseTo(cmd.yMm, 2);
      // 实际入射角与设定 AOI 一致
      expect(traced.focus.aoiXDeg).toBeCloseTo(cmd.alphaDeg, 1);
      expect(traced.focus.aoiYDeg).toBeCloseTo(cmd.betaDeg, 1);
      // 倾斜向量的方位角跟随相位
      const tiltAzimuth = radToDeg(Math.atan2(traced.focus.aoiYDeg, traced.focus.aoiXDeg));
      const expected = radToDeg(Math.atan2(Math.sin(theta), Math.cos(theta)));
      const diff = Math.abs(((tiltAzimuth - expected + 540) % 360) - 180);
      expect(diff).toBeLessThan(3);
    }
  });

  it('整个加工头与物镜不随进动旋转（模型里没有整体旋转自由度）', () => {
    const solved = educationalInverseModel(train, commandAtTheta(params, 1.1));
    // 五个执行轴都是"小角度摆动"，没有整周旋转量
    expect(Math.abs(solved.actuators.xRad)).toBeLessThan(0.2);
    expect(Math.abs(solved.actuators.yRad)).toBeLessThan(0.2);
    expect(Math.abs(solved.actuators.zTravelMm)).toBeLessThan(2);
    expect(Math.abs(solved.actuators.alphaRad)).toBeLessThan(0.1);
    expect(Math.abs(solved.actuators.betaRad)).toBeLessThan(0.1);
    // 物镜与振镜中心固定不动
    expect(train.xGalvo.center.x).toBeCloseTo(0, 9);
    expect(train.yGalvo.center.z).toBeCloseTo(train.xGalvo.center.z, 9);
  });

  it('三种孔壁预设给出不同符号的入射角（定性演示）', () => {
    const outward = commandAtTheta({ ...params, taper: 'negative' }, 0);
    const inward = commandAtTheta({ ...params, taper: 'positive' }, 0);
    const straight = commandAtTheta({ ...params, taper: 'straight' }, 0);
    expect(Math.sign(outward.alphaDeg)).toBe(-Math.sign(inward.alphaDeg));
    expect(straight.alphaDeg).toBe(0);
    expect(TAPER_PRESETS.map((t) => t.key)).toEqual(['positive', 'straight', 'negative']);
  });
});
