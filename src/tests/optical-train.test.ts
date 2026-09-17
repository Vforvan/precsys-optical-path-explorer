import { describe, expect, it } from 'vitest';
import {
  ACTUATOR_LIMITS,
  ZERO_ACTUATORS,
  createOpticalTrain,
  outcomeArray,
  traceTrain,
} from '../optics/optical-train';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { AXIS, BEAM_PATH } from '../config/layout';
import { educationalInverseModel, naiveInverse } from '../optics/educational-inverse-model';
import { DEG, radToDeg } from '../optics/ray';

const train = createOpticalTrain(OPTICS_VARIANTS[0]);
const deg = (v: number) => v * DEG;

describe('五轴链路总装与光线追迹', () => {
  it('零位状态下：焦点在名义原点、光束在入瞳正中、入射角为 0', () => {
    const t = traceTrain(train, ZERO_ACTUATORS);
    expect(t.ok).toBe(true);
    expect(Math.abs(t.pupil.hxMm)).toBeLessThan(1e-6);
    expect(Math.abs(t.pupil.hyMm)).toBeLessThan(1e-6);
    expect(Math.abs(t.focus.xMm)).toBeLessThan(1e-9);
    expect(Math.abs(t.focus.yMm)).toBeLessThan(1e-9);
    expect(Math.abs(t.focus.zMm)).toBeLessThan(1e-9);
    expect(Math.abs(t.focus.aoiXDeg)).toBeLessThan(1e-6);
    expect(Math.abs(t.focus.aoiYDeg)).toBeLessThan(1e-6);
  });

  it('光路按 α → β → Z → Y 振镜 → X 振镜 → 入瞳 的顺序经过各段', () => {
    const t = traceTrain(train, ZERO_ACTUATORS);
    const p = t.chiefPoints;
    // α 模块输出
    expect(p[5].x).toBeCloseTo(BEAM_PATH.afterAlpha.x, 3);
    expect(p[5].y).toBeCloseTo(BEAM_PATH.afterAlpha.y, 3);
    expect(p[5].z).toBeCloseTo(AXIS.alphaModuleOut, 3);
    // β 模块输出
    expect(p[9].x).toBeCloseTo(BEAM_PATH.afterBeta.x, 3);
    expect(p[9].y).toBeCloseTo(BEAM_PATH.afterBeta.y, 3);
    expect(p[9].z).toBeCloseTo(AXIS.betaModuleOut, 3);
    // 入瞳（X 振镜）落在机床光轴上
    const pupilPoint = p[p.length - 1];
    expect(Math.abs(pupilPoint.x)).toBeLessThan(1e-6);
    expect(Math.abs(pupilPoint.y)).toBeLessThan(1e-6);
    expect(pupilPoint.z).toBeCloseTo(AXIS.entrancePupil, 3);
  });

  it('光束不会穿过平行移束模块的任何一块可动镜片', () => {
    for (const a of [-3, -1, 0, 1, 3]) {
      const ta = traceTrain(train, { ...ZERO_ACTUATORS, alphaRad: deg(a) });
      const tb = traceTrain(train, { ...ZERO_ACTUATORS, betaRad: deg(b0(a)) });
      expect(ta.alphaTrace).not.toBeNull();
      expect(tb.betaTrace).not.toBeNull();
      for (const c of ta.alphaTrace!.crossings) expect(c.insideAperture).toBe(false);
      for (const c of tb.betaTrace!.crossings) expect(c.insideAperture).toBe(false);
    }
    function b0(v: number) {
      return v;
    }
  });

  it('X 振镜只改变焦点 X，不引入入瞳偏心', () => {
    const t = traceTrain(train, { ...ZERO_ACTUATORS, xRad: deg(-4) });
    expect(t.focus.xMm).toBeGreaterThan(3);
    expect(Math.abs(t.pupil.hxMm)).toBeLessThan(1e-6);
    expect(Math.abs(t.focus.aoiXDeg)).toBeLessThan(1e-6);
  });

  it('Y 振镜移动焦点 Y 时会把入瞳偏心（入射角）一起带偏——真实耦合', () => {
    const t = traceTrain(train, { ...ZERO_ACTUATORS, yRad: deg(-4) });
    expect(t.focus.yMm).toBeGreaterThan(2);
    expect(Math.abs(t.pupil.hyMm)).toBeGreaterThan(1);
    expect(Math.abs(t.focus.aoiYDeg)).toBeGreaterThan(1);
  });

  it('α/β 模块只改变入瞳偏心与入射角，不移动焦点（理想解耦）', () => {
    const t = traceTrain(train, { ...ZERO_ACTUATORS, alphaRad: deg(1.5) });
    expect(Math.abs(t.pupil.hxMm)).toBeGreaterThan(3);
    expect(Math.abs(t.focus.aoiXDeg)).toBeGreaterThan(6);
    expect(Math.abs(t.focus.xMm)).toBeLessThan(1e-9);
  });

  it('Z 执行器改变焦点高度，同时带来入瞳偏心的耦合（需联合补偿）', () => {
    const up = traceTrain(train, { ...ZERO_ACTUATORS, zDeg: 0.76 });
    expect(up.focus.zMm).toBeGreaterThan(0.9);
    expect(Math.abs(up.pupil.hxMm)).toBeGreaterThan(1);
  });

  it('三个型号的光锥角都符合公开规格', () => {
    for (const variant of OPTICS_VARIANTS) {
      const t = traceTrain(createOpticalTrain(variant), ZERO_ACTUATORS);
      expect(t.focus.coneHalfAngleRad * 2).toBeCloseTo(variant.fullConeAngleRad, 3);
    }
  });
});

describe('五轴联合逆映射（educationalInverseModel）', () => {
  const commands = [
    { xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 },
    { xMm: 1.25, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 },
    { xMm: 0, yMm: 0, zMm: 0, alphaDeg: 7.5, betaDeg: 0 },
    { xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: -7.5 },
    { xMm: 1.25, yMm: -1.25, zMm: 1, alphaDeg: 5, betaDeg: -5 },
    { xMm: -1.25, yMm: 1.25, zMm: -1, alphaDeg: -7, betaDeg: 7 },
  ];

  it('补偿开启后，全部设定工况都被解到位（残差远小于公开分辨率要求）', () => {
    for (const cmd of commands) {
      const result = educationalInverseModel(train, cmd);
      expect(result.compensated).toBe(true);
      expect(result.saturated).toBe(false);
      const target = [cmd.xMm, cmd.yMm, cmd.zMm, cmd.alphaDeg, cmd.betaDeg];
      const achieved = outcomeArray(traceTrain(train, result.actuators));
      achieved.forEach((value, i) => {
        expect(Math.abs(value - target[i])).toBeLessThan(0.01);
      });
    }
  });

  it('补偿关闭时（一轴对应一坐标）会留下明显的入射角偏差', () => {
    const cmd = { xMm: 1.25, yMm: -1.25, zMm: 1, alphaDeg: 5, betaDeg: -5 };
    const naive = naiveInverse(train, cmd);
    const achieved = outcomeArray(traceTrain(train, naive.actuators));
    const aoiError = Math.abs(achieved[3] - cmd.alphaDeg) + Math.abs(achieved[4] - cmd.betaDeg);
    expect(aoiError).toBeGreaterThan(1);
    expect(naive.compensated).toBe(false);
  });

  it('所有执行轴都留在安全行程内', () => {
    for (const cmd of commands) {
      const { actuators } = educationalInverseModel(train, cmd);
      expect(Math.abs(actuators.xRad)).toBeLessThanOrEqual(ACTUATOR_LIMITS.xRad + 1e-9);
      expect(Math.abs(actuators.yRad)).toBeLessThanOrEqual(ACTUATOR_LIMITS.yRad + 1e-9);
      expect(Math.abs(actuators.zDeg)).toBeLessThanOrEqual(ACTUATOR_LIMITS.zDeg + 1e-9);
      expect(Math.abs(actuators.alphaRad)).toBeLessThanOrEqual(ACTUATOR_LIMITS.alphaRad + 1e-9);
      expect(Math.abs(actuators.betaRad)).toBeLessThanOrEqual(ACTUATOR_LIMITS.betaRad + 1e-9);
    }
  });

  it('公开指标 ±7.5° AOI 与 ±1 mm 焦点 Z 都在行程内可达', () => {
    const maxAoi = educationalInverseModel(train, {
      xMm: 0,
      yMm: 0,
      zMm: 0,
      alphaDeg: OPTICS_VARIANTS[0].maxAoiDeg,
      betaDeg: OPTICS_VARIANTS[0].maxAoiDeg,
    });
    expect(maxAoi.saturated).toBe(false);
    expect(maxAoi.achieved.alphaDeg).toBeCloseTo(7.5, 2);
    expect(maxAoi.achieved.betaDeg).toBeCloseTo(7.5, 2);

    const zPlus = educationalInverseModel(train, {
      xMm: 0,
      yMm: 0,
      zMm: 1,
      alphaDeg: 0,
      betaDeg: 0,
    });
    expect(zPlus.achieved.zMm).toBeCloseTo(1, 2);
    expect(zPlus.actuators.zDeg).toBeLessThan(ACTUATOR_LIMITS.zDeg);
    expect(zPlus.actuators.zDeg).toBeGreaterThan(0.3);
  });

  it('可动镜机械角很小：±7.5° 入射角只需约 1.5° 机械角', () => {
    const result = educationalInverseModel(train, {
      xMm: 0,
      yMm: 0,
      zMm: 0,
      alphaDeg: 7.5,
      betaDeg: 0,
    });
    const mechanicalDeg = radToDeg(result.actuators.alphaRad);
    expect(mechanicalDeg).toBeGreaterThan(0.5);
    expect(mechanicalDeg).toBeLessThan(2.5);
  });
});

describe('场景几何自洽性', () => {
  it('两片振镜同高、X 振镜位于物镜光轴上、Y 振镜偏置一个镜间距', () => {
    expect(train.xGalvo.center.z).toBeCloseTo(train.yGalvo.center.z, 9);
    expect(train.xGalvo.center.x).toBeCloseTo(0, 9);
    expect(train.yGalvo.center.x).toBeCloseTo(-Math.abs(BEAM_PATH.afterBeta.x), 9);
  });

  it('物镜入瞳平面与 X 振镜平面重合（决定 X = Feff·u 与 AOI = −h/Feff）', () => {
    expect(train.xGalvo.center.z).toBeCloseTo(AXIS.entrancePupil, 9);
  });

  it('Z 模块输出点位于模块下游光轴上', () => {
    expect(train.focusModule.fold.center.x).toBeCloseTo(BEAM_PATH.afterBeta.x, 6);
    expect(train.focusModule.fold.center.y).toBeCloseTo(BEAM_PATH.afterBeta.y, 6);
  });
});
