import { describe, expect, it } from 'vitest';
import { createOpticalTrain, type ActuatorState } from '../optics/optical-train';
import { mirrorAxes, mirrorCenter, mirrorNormal, type MirrorSpec } from '../optics/mirror';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { DEG } from '../optics/ray';
import { FOCUS_MODULE, GALVO, SHIFT_MODULE } from '../config/layout';
import { focusLensesAt } from '../optics/focus-module';

/**
 * 实体镜片不得互相穿插。
 *
 * 背景：Z 模块的折转镜与折返镜原来只隔 16 mm，而两片 20 mm 的 45° 镜片各自的
 * Z 向半投影约 14 mm —— 屏幕上就是"两块镜片粘在一起/穿模"。
 * 这里用 OBB 判定（把一块镜片的 8 个角点变换到另一块的局部坐标里）做回归保护，
 * 纯几何计算，不依赖渲染。
 */

const HALF_EPS = 1e-6;

/** 镜片厚度按类型取（厚度是建模常量，不在 MirrorSpec 上）。 */
function plateThickness(spec: MirrorSpec): number {
  if (spec.kind === 'lens') return FOCUS_MODULE.lensThicknessMm;
  if (spec.id.startsWith('galvo-')) return GALVO.mirrorThicknessMm;
  return SHIFT_MODULE.plateThickness;
}

/** 把镜片看成一个 OBB：中心 + (u,v,n) 基 + 三向半尺寸。 */
function obb(spec: MirrorSpec, angleRad: number) {
  const rotated: MirrorSpec = { ...spec, angleRad };
  const axes = mirrorAxes(rotated);
  return {
    center: mirrorCenter(rotated),
    u: axes.u.clone().normalize(),
    v: axes.v.clone().normalize(),
    n: mirrorNormal(rotated),
    halfU: spec.size.u / 2,
    halfV: spec.size.v / 2,
    halfN: plateThickness(spec) / 2,
  };
}

/** 点是否落在该 OBB 内部（含极小容差）。 */
function contains(box: ReturnType<typeof obb>, point: { x: number; y: number; z: number }): boolean {
  const d = { x: point.x - box.center.x, y: point.y - box.center.y, z: point.z - box.center.z };
  const along = (axis: { x: number; y: number; z: number }) => d.x * axis.x + d.y * axis.y + d.z * axis.z;
  return (
    Math.abs(along(box.u)) < box.halfU - HALF_EPS &&
    Math.abs(along(box.v)) < box.halfV - HALF_EPS &&
    Math.abs(along(box.n)) < box.halfN - HALF_EPS
  );
}

/** 两片镜片是否实质相交：任一方的角点落入对方体内即判定相交。 */
function intersects(a: ReturnType<typeof obb>, b: ReturnType<typeof obb>): boolean {
  const corners = (box: ReturnType<typeof obb>) => {
    const out: { x: number; y: number; z: number }[] = [];
    for (const su of [-1, 1]) for (const sv of [-1, 1]) for (const sn of [-1, 1]) {
      out.push({
        x: box.center.x + su * box.halfU * box.u.x + sv * box.halfV * box.v.x + sn * box.halfN * box.n.x,
        y: box.center.y + su * box.halfU * box.u.y + sv * box.halfV * box.v.y + sn * box.halfN * box.n.y,
        z: box.center.z + su * box.halfU * box.u.z + sv * box.halfV * box.v.z + sn * box.halfN * box.n.z,
      });
    }
    return out;
  };
  return corners(a).some((p) => contains(b, p)) || corners(b).some((p) => contains(a, p));
}

const train = createOpticalTrain(OPTICS_VARIANTS[0]);

/** 采样若干执行器状态（可动件在两个极端也要检查）。 */
const states: ActuatorState[] = [
  { alphaRad: 0, betaRad: 0, zTravelMm: 0, xRad: 0, yRad: 0 },
  { alphaRad: SHIFT_MODULE.mechanicalRangeDeg * DEG, betaRad: -SHIFT_MODULE.mechanicalRangeDeg * DEG, zTravelMm: 1.4, xRad: 0.05, yRad: -0.05 },
  { alphaRad: -SHIFT_MODULE.mechanicalRangeDeg * DEG, betaRad: SHIFT_MODULE.mechanicalRangeDeg * DEG, zTravelMm: -1.4, xRad: -0.05, yRad: 0.05 },
];

/** 同一模块内的镜片组合（不同模块之间本来就可能隔着很远或共面，不做要求）。 */
const pairs: [string, MirrorSpec, MirrorSpec][] = [
  ['Z 模块：L1 / L2', train.focusModule.lenses[0], train.focusModule.lenses[1]],
  ['Z 模块：L2 / L3', train.focusModule.lenses[1], train.focusModule.lenses[2]],
  ['Z 模块：L1 / L3', train.focusModule.lenses[0], train.focusModule.lenses[2]],
  ['α 模块：可动入光 / 可动出光', train.alphaModule.movableIn, train.alphaModule.movableOut],
  ['α 模块：可动入光 / 固定镜 1', train.alphaModule.movableIn, train.alphaModule.fixed1],
  ['α 模块：可动出光 / 固定镜 2', train.alphaModule.movableOut, train.alphaModule.fixed2],
  ['β 模块：可动入光 / 可动出光', train.betaModule.movableIn, train.betaModule.movableOut],
  ['β 模块：可动入光 / 固定镜 1', train.betaModule.movableIn, train.betaModule.fixed1],
  ['β 模块：可动出光 / 固定镜 2', train.betaModule.movableOut, train.betaModule.fixed2],
];

describe('镜片实体互不穿插', () => {
  for (const [label, a, b] of pairs) {
    it(`${label}`, () => {
      for (const state of states) {
        const angleFor = (spec: MirrorSpec): number => {
          if (spec.id.startsWith('alpha')) return state.alphaRad;
          if (spec.id.startsWith('beta')) return state.betaRad;
          return 0;
        };
        const lensAt = (spec: MirrorSpec) => focusLensesAt(train.focusModule, state.zTravelMm).find(l => l.id === spec.id) ?? spec;
        const boxA = obb(lensAt(a), angleFor(a));
        const boxB = obb(lensAt(b), angleFor(b));
        expect(
          intersects(boxA, boxB),
          `${label} 在 zTravelMm=${state.zTravelMm}°、α=${(state.alphaRad / DEG).toFixed(1)}° 时相交`,
        ).toBe(false);
      }
    });
  }

  it('Z 全行程内，三片透镜轴向间距大于玻璃厚度', () => {
    for (const q of [-2, 0, 2]) {
      const lenses = focusLensesAt(train.focusModule, q);
      expect(lenses[0].center.z - lenses[1].center.z).toBeGreaterThan(FOCUS_MODULE.lensThicknessMm);
      expect(lenses[1].center.z - lenses[2].center.z).toBeGreaterThan(FOCUS_MODULE.lensThicknessMm);
    }
  });
});
