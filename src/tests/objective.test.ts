import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  effectiveFocalLengthMm,
  evaluateObjective,
  idealPupilState,
  type PupilState,
} from '../optics/objective-model';
import {
  focusZFromPupilVergence,
  pupilVergenceForFocusZ,
} from '../optics/focus-module';
import { OBJECTIVE } from '../config/layout';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { DEG, radToDeg } from '../optics/ray';

const basePupil = (over: Partial<PupilState> = {}): PupilState => ({
  hxMm: 0,
  hyMm: 0,
  u: 0,
  v: 0,
  radiusMm: 1,
  vergence: 0,
  ...over,
});

describe('物镜等效模型与公开规格自洽性', () => {
  it('光锥角与公开的"典型全会聚角"一致（1030/515 标准版 0.08 rad）', () => {
    for (const variant of OPTICS_VARIANTS) {
      const focus = evaluateObjective(basePupil({ radiusMm: variant.inputBeamDiameterMm / 2 }));
      const fullCone = focus.coneHalfAngleRad * 2;
      expect(fullCone).toBeCloseTo(variant.fullConeAngleRad, 3);
    }
  });

  it('有效焦距 25 mm 与 0.08 rad 全会聚角互为倒数关系', () => {
    const feff = effectiveFocalLengthMm();
    expect(feff).toBe(OBJECTIVE.effectiveFocalLengthMm);
    // 入瞳半径 1 mm（2 mm 光束）经有效焦距 25 mm 聚焦：半角 atan(1/25)，全角 ≈ 0.08 rad
    const fullCone = 2 * Math.atan(1 / feff);
    expect(fullCone).toBeCloseTo(0.08, 3);
    // 反过来说：1/0.04 = 25 mm 就是"有效焦距"
    expect(1 / feff).toBeCloseTo(0.04, 6);
  });

  it('有效焦距同时是"入瞳坡度 → 焦点位置"与"入瞳偏心 → AOI"的换算基准', () => {
    const feff = effectiveFocalLengthMm();
    const focus = evaluateObjective(basePupil({ u: 0.05, hxMm: -feff * Math.tan(7.5 * DEG) }));
    expect(focus.xMm).toBeCloseTo(feff * 0.05, 9);
    expect(focus.aoiXDeg).toBeCloseTo(7.5, 6);
    // 偏心改变入射角但不移动焦点
    expect(focus.xMm).toBeCloseTo(1.25, 9);
  });

  it('α/β 只改变入射角、X/Y 只改变焦点（理想解耦）', () => {
    const feff = effectiveFocalLengthMm();
    const pureShift = evaluateObjective(basePupil({ hxMm: -3.29 }));
    expect(pureShift.xMm).toBeCloseTo(0, 12);
    expect(pureShift.aoiXDeg).toBeGreaterThan(7.4);

    const pureTilt = evaluateObjective(basePupil({ u: 0.08 }));
    expect(pureTilt.aoiXDeg).toBeCloseTo(0, 12);
    expect(pureTilt.xMm).toBeCloseTo(feff * 0.08, 9);
  });

  it('焦点方向与计划书的 direction = normalize([tanα, tanβ, -1]) 一致', () => {
    const focus = evaluateObjective(
      basePupil({ hxMm: -25 * Math.tan(-4 * DEG), hyMm: -25 * Math.tan(3 * DEG) }),
    );
    const expected = new Vector3(Math.tan(-4 * DEG), Math.tan(3 * DEG), -1).normalize();
    expect(focus.beamDirection.distanceTo(expected)).toBeLessThan(1e-9);
    expect(focus.aoiXDeg).toBeCloseTo(-4, 6);
    expect(focus.aoiYDeg).toBeCloseTo(3, 6);
  });

  it('Z 会聚度与 ±1 mm 焦点范围的换算可逆', () => {
    for (const z of [-1, -0.5, 0, 0.5, 1]) {
      const vergence = pupilVergenceForFocusZ(z);
      expect(focusZFromPupilVergence(vergence)).toBeCloseTo(z, 9);
    }
    // 公开范围 ±1 mm 需要约 ±1.6e-3 /mm 的会聚度
    expect(pupilVergenceForFocusZ(1)).toBeCloseTo(1.62e-3, 5);
    expect(pupilVergenceForFocusZ(-1)).toBeCloseTo(-1.58e-3, 5);
  });

  it('理想逆关系能精确还原目标工况', () => {
    const pupil = idealPupilState(1.25, -1.25, 5, -6, 1, 1.4e-3);
    const focus = evaluateObjective(pupil);
    expect(focus.xMm).toBeCloseTo(1.25, 9);
    expect(focus.yMm).toBeCloseTo(-1.25, 9);
    expect(focus.aoiXDeg).toBeCloseTo(5, 9);
    expect(focus.aoiYDeg).toBeCloseTo(-6, 9);
    expect(focus.zMm).toBeCloseTo(focusZFromPupilVergence(1.4e-3), 9);
  });

  it('入瞳偏心 ±3.29 mm 对应公开的 ±7.5° AOI', () => {
    const feff = effectiveFocalLengthMm();
    const shift = feff * Math.tan(7.5 * DEG);
    expect(shift).toBeCloseTo(3.29, 2);
    expect(radToDeg(Math.atan(shift / feff))).toBeCloseTo(7.5, 9);
  });
});
