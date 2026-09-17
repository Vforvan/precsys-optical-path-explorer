import { describe, it } from 'vitest';
import { RAD } from '../optics/ray';
import { ZERO_ACTUATORS, createOpticalTrain, traceTrain } from '../optics/optical-train';
import { OPTICS_VARIANTS } from '../config/public-specs';

describe('probe-hits', () => {
  it('打印每个反射点的实际入射角与入射/出射方向', () => {
    const train = createOpticalTrain(OPTICS_VARIANTS[0]);
    const trace = traceTrain(train, ZERO_ACTUATORS);
    const pts = trace.chiefPoints;

    console.log('=== 每个拐点的实际几何 ===');
    for (const hit of trace.hits) {
      // 找到该命中点在折线中的位置，取入射方向与出射方向
      const idx = pts.findIndex((p) => p.distanceTo(hit.point) < 1e-9);
      const incoming = idx > 0 ? hit.point.clone().sub(pts[idx - 1]).normalize() : null;
      const outgoing =
        idx >= 0 && idx < pts.length - 1 ? pts[idx + 1].clone().sub(hit.point).normalize() : null;
      const fmt = (v: typeof incoming) =>
        v ? `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})` : '—';
      console.log(
        `${hit.mirrorId.padEnd(18)} 入射角=${(hit.incidenceRad * RAD).toFixed(2).padStart(6)}°  ` +
          `法向=(${hit.normal.x.toFixed(3)}, ${hit.normal.y.toFixed(3)}, ${hit.normal.z.toFixed(3)})  ` +
          `入射=${fmt(incoming)}  出射=${fmt(outgoing)}`,
      );
    }

    console.log('\n=== 平面镜应有的关系 ===');
    console.log('入射方向与法向夹角 = 出射方向与法向夹角 = 入射角；三者共面。');
  });
});
