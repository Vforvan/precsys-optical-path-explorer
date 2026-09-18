import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createOpticalTrain, traceTrain, ZERO_ACTUATORS } from '../optics/optical-train';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { evaluateObjective } from '../optics/objective-model';
import { geometryStatus } from '../ui/geometry-status';
import { partInfo } from '../ui/component-info';

describe('专利事实边界与几何告警', () => {
  const train = createOpticalTrain(OPTICS_VARIANTS[0]);
  it('α/β 光路平面相互垂直；模块高度不同不代表两个平行平面', () => {
    expect(train.alphaModule.rotAxis.dot(train.betaModule.rotAxis)).toBeCloseTo(0, 12);
    expect(train.alphaModule.rotAxis).toEqual(new Vector3(0,1,0));
    expect(train.betaModule.rotAxis).toEqual(new Vector3(-1,0,0));
  });
  it('零位入口出口同向 -Z，整条折转链对 α 偏心反号、β 偏心同号', () => {
    const zero = traceTrain(train, ZERO_ACTUATORS);
    const input = zero.segments[0].to.clone().sub(zero.segments[0].from).normalize();
    expect(input.dot(zero.focus.beamDirection)).toBeCloseTo(1, 12);
    for (const key of ['alphaRad', 'betaRad'] as const) {
      const t = traceTrain(train, { ...ZERO_ACTUATORS, [key]: 0.01 });
      const displacement = key === 'alphaRad' ? t.alphaTrace!.displacementMm : t.betaTrace!.displacementMm;
      const height = key === 'alphaRad' ? t.pupil.hxMm : t.pupil.hyMm;
      const aoi = key === 'alphaRad' ? t.focus.aoiXDeg : t.focus.aoiYDeg;
      expect(height).toBeCloseTo(displacement * (key === 'alphaRad' ? -1 : 1), 9);
      expect(aoi).toBeCloseTo(Math.atan(-height / 25) * 180 / Math.PI, 9);
    }
  });
  it('AOI 参考机器轴：偏心正向对应负角，零坡度焦点不横移', () => {
    const focus = evaluateObjective({ hxMm: 1, hyMm: -1, u: 0, v: 0, radiusMm: 1, vergence: 0 });
    expect(focus.xMm).toBe(0); expect(focus.yMm).toBe(0);
    expect(focus.aoiXDeg).toBeLessThan(0); expect(focus.aoiYDeg).toBeGreaterThan(0);
  });
  it('宽光束失败与追迹失败都必须显示几何告警，不能用求解成功覆盖', () => {
    const normal = traceTrain(train, ZERO_ACTUATORS);
    expect(geometryStatus(normal).warning).toBe(false);
    const wide = traceTrain(train, ZERO_ACTUATORS, { expanderMagnification: 40, divergenceVergence: 0 });
    expect(wide.ok).toBe(true);
    expect(geometryStatus(wide).warning).toBe(true);
    expect(geometryStatus(wide).html).toContain('几何告警');
    expect(geometryStatus({ ...normal, ok: false }).warning).toBe(true);
  });
  it('具体自定镜面与模块标为教学等效，不冒充公开确认', () => {
    for (const id of ['alpha-movable-in', 'alpha-movable-out', 'beta-module', 'alpha-module',
      'z-module', 'z-fold', 'galvo-x', 'galvo-y', 'objective', 'monitor-splitter']) {
      expect(partInfo(id, train)?.trust, id).toBe('教学等效');
    }
    expect(partInfo('alpha-fixed-1', train)?.trust).toBe('专利原理');
  });
});
