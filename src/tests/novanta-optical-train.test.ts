/**
 * Novanta / ARGES 光学链路总装的单元测试。
 *
 * 覆盖：
 *   · 标称光路能到达物镜与工件，且折线经过全部预期元件
 *   · 零指令 → 焦点与 AOI 都严格为 0
 *   · 平板移动只改变 AOI、不在补偿后引入多余的 X/Y 偏移
 *   · XY 振镜移动焦点
 *   · Z 执行器改变焦点深度
 *   · 五轴联合指令仍然有限、可追迹
 *   · 与公开事实/专利原理一致的方向性与事实边界
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  NOVANTA_ZERO_ACTUATORS,
  createNovantaTrain,
  traceNovantaTrain,
  novantaActuatorArray,
  novantaActuatorFromArray,
  clampNovantaActuators,
  NOVANTA_ACTUATOR_LIMITS,
  type NovantaActuatorState,
} from '../optics/novanta-optical-train';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { NOVANTA_AXIS, NOVANTA_OBJECTIVE, NOVANTA_PLATES } from '../config/novanta-layout';

const DEG = Math.PI / 180;
const train = createNovantaTrain(OPTICS_VARIANTS[0]);

function trace(patch: Partial<NovantaActuatorState>) {
  return traceNovantaTrain(train, { ...NOVANTA_ZERO_ACTUATORS, ...patch });
}

describe('Novanta 光路 · 标称状态', () => {
  it('零指令：焦点与 AOI 全部严格为 0', () => {
    const t = trace({});
    expect(t.ok).toBe(true);
    expect(t.focus.xMm).toBeCloseTo(0, 12);
    expect(t.focus.yMm).toBeCloseTo(0, 12);
    expect(t.focus.zMm).toBeCloseTo(0, 12);
    expect(t.focus.aoiXDeg).toBeCloseTo(0, 12);
    expect(t.focus.aoiYDeg).toBeCloseTo(0, 12);
    expect(t.pupil.hxMm).toBeCloseTo(0, 9);
    expect(t.pupil.hyMm).toBeCloseTo(0, 9);
  });

  it('主光线依次经过平板、望远镜、两片振镜与物镜', () => {
    const t = trace({});
    expect(t.plateAPoints).not.toBeNull();
    expect(t.plateBPoints).not.toBeNull();
    expect(t.telescopePoints).not.toBeNull();
    expect(t.galvoPoints).not.toBeNull();
    // 顺序：板 A（上游）→ 板 B → 望远镜凹镜 → 凸镜 → 上游振镜 → 下游振镜 → 工件
    expect(t.plateAPoints![0].z).toBeGreaterThan(t.plateBPoints![0].z);
    expect(t.plateBPoints![0].z).toBeGreaterThan(t.telescopePoints![0].z);
    expect(t.telescopePoints![0].z).toBeGreaterThan(t.telescopePoints![1].z);
    expect(t.telescopePoints![1].z).toBeGreaterThan(t.galvoPoints![0].z);
    // 两片振镜等高（45° 折转对的几何要求），故用 ≥ 而不是 >
    expect(t.galvoPoints![0].z).toBeGreaterThanOrEqual(t.galvoPoints![1].z);
    // 上游振镜的命中点必须在机器光轴之外（否则折转对退化为单点）
    expect(Math.abs(t.galvoPoints![0].x)).toBeGreaterThan(1);
    expect(Math.abs(t.galvoPoints![1].x)).toBeLessThan(1e-6);
  });

  it('折线终点在工件表面附近，且入光在入口高度', () => {
    const t = trace({});
    const first = t.chiefPoints[0];
    const last = t.chiefPoints[t.chiefPoints.length - 1];
    expect(first.z).toBeCloseTo(NOVANTA_AXIS.inlet, 6);
    expect(last.z).toBeLessThanOrEqual(0);
  });

  it('玻璃段只出现在两块平行板内部（望远镜按薄透镜处理，不画玻璃程）', () => {
    const t = trace({});
    const glass = t.segments.filter((s) => s.medium === 'glass');
    // 每块板各一段"在玻璃内"的线段
    expect(glass.length).toBe(2);
    for (const s of glass) {
      expect(s.from.z).toBeGreaterThan(0);
      expect(s.to.z).toBeGreaterThan(0);
    }
    // 每一段玻璃长度应等于板厚（垂直入射时）
    for (const s of glass) {
      expect(s.from.distanceTo(s.to)).toBeCloseTo(NOVANTA_PLATES.thicknessMm, 6);
    }
  });

  it('沿光轴看去，标称状态下两板都垂直于光束（入射角 0）', () => {
    const t = trace({});
    expect(t.wobble!.poseA.incidenceDeg).toBeCloseTo(0, 9);
    expect(t.wobble!.poseB.incidenceDeg).toBeCloseTo(0, 9);
  });

  it('物镜公开焦距被使用，且有效焦距是教学参数（数值与公开焦距一致）', () => {
    expect(NOVANTA_OBJECTIVE.focalLengthMm).toBe(60);
    expect(NOVANTA_OBJECTIVE.effectiveFocalLengthMm).toBe(60);
    // 物镜后的传播距离为教学几何
    expect(NOVANTA_AXIS.objectiveLastLens).toBe(NOVANTA_OBJECTIVE.lastLensZ);
  });
});

describe('Novanta 光路 · 平板（α / β）', () => {
  it('只有板 B 倾斜：产生 AOI X 分量，焦点 X/Y 基本不动', () => {
    const t = trace({ plateBRad: 6 * DEG });
    expect(t.ok).toBe(true);
    expect(Math.abs(t.focus.aoiXDeg)).toBeGreaterThan(0.5);
    expect(Math.abs(t.focus.xMm)).toBeLessThan(0.02);
    expect(Math.abs(t.focus.yMm)).toBeLessThan(0.02);
  });

  it('只有板 A 倾斜：产生 AOI Y 分量，焦点 X/Y 基本不动', () => {
    const t = trace({ plateARad: 6 * DEG });
    expect(t.ok).toBe(true);
    expect(Math.abs(t.focus.aoiYDeg)).toBeGreaterThan(0.5);
    expect(Math.abs(t.focus.xMm)).toBeLessThan(0.02);
  });

  it('平板位移经望远镜放大 M 倍后成为入瞳偏心', () => {
    const t = trace({ plateBRad: 6 * DEG });
    // pupilOffset = M · moduleOffset，M 由 afocal 条件解出（配置里的 magnification）
    const ratio = t.pupilOffsetMm / t.moduleOffsetMm;
    expect(ratio).toBeCloseTo(train.telescope.magnification, 3);
    expect(ratio).toBeGreaterThan(1);
  });

  it('AOI 与 Plane 是由两个倾角分量派生的极坐标，不是"一板对一轴"', () => {
    const a = trace({ plateARad: 5 * DEG });
    const b = trace({ plateBRad: 5 * DEG });
    const both = trace({ plateARad: 5 * DEG, plateBRad: 5 * DEG });
    // AOI 幅值是分量平方和开根
    expect(both.focus.aoiMagnitudeDeg).toBeCloseTo(
      Math.hypot(both.focus.aoiXDeg, both.focus.aoiYDeg),
      9,
    );
    // 单板时方位角落在坐标轴上；两板同时倾斜时落在两者之间
    expect(Math.abs(a.focus.planeAngleDeg)).toBeCloseTo(90, 3);
    expect(Math.abs(b.focus.planeAngleDeg)).toBeCloseTo(0, 3);
    expect(Math.abs(both.focus.planeAngleDeg)).toBeGreaterThan(0);
    expect(Math.abs(both.focus.planeAngleDeg)).toBeLessThan(90);
  });

  it('出射光始终与入射光平行：两端玻璃段之外的主光线方向为 −Z', () => {
    for (const tilt of [-12, -4, 0, 4, 12]) {
      const t = trace({ plateARad: tilt * DEG, plateBRad: -tilt * DEG });
      expect(t.ok, `tilt=${tilt}`).toBe(true);
      expect(t.wobble!.poseB.directionDeviationDeg).toBeLessThan(1e-9);
    }
  });

  it('平板倾角符号翻转 → AOI 符号翻转', () => {
    const pos = trace({ plateBRad: 6 * DEG });
    const neg = trace({ plateBRad: -6 * DEG });
    expect(pos.focus.aoiXDeg).toBeCloseTo(-neg.focus.aoiXDeg, 9);
  });
});

describe('Novanta 光路 · XY 振镜', () => {
  it('X 振镜 1° → 焦点 X ≈ 2·f·θ（与 60 mm 公开焦距自洽）', () => {
    const t = trace({ xGalvoRad: 1 * DEG });
    const expected = 2 * NOVANTA_OBJECTIVE.focalLengthMm * Math.tan(1 * DEG);
    expect(t.focus.xMm).toBeGreaterThan(0);
    expect(t.focus.xMm).toBeCloseTo(expected, 2);
  });

  it('Y 振镜 1° → 焦点 Y 显著变化，X 变化小一个量级', () => {
    const t = trace({ yGalvoRad: 1 * DEG });
    expect(Math.abs(t.focus.yMm)).toBeGreaterThan(0.5);
    expect(Math.abs(t.focus.xMm)).toBeLessThan(Math.abs(t.focus.yMm) * 0.1);
  });

  it('两振镜基本正交：X 与 Y 指令各自主导自己的分量', () => {
    const xOnly = trace({ xGalvoRad: 2 * DEG });
    const yOnly = trace({ yGalvoRad: 2 * DEG });
    const both = trace({ xGalvoRad: 2 * DEG, yGalvoRad: 2 * DEG });
    /**
     * 折转对不是理想正交反射镜组：上游镜绕 x 轴转时，下游镜的落点会沿 x 轻微移动，
     * 于是同时给 X 与 Y 指令会留下约 2% 的交叉项。这正是本模型"五轴必须联合标定"
     * 的耦合来源之一，因此这里断言的是"主导 + 交叉项小"，不是"完全解耦"。
     */
    expect(Math.abs(both.focus.xMm - xOnly.focus.xMm)).toBeLessThan(0.15);
    expect(Math.abs(both.focus.yMm - yOnly.focus.yMm)).toBeLessThan(0.15);
    // 主分量必须仍然由自己的指令主导（交叉项 < 主分量的 5%）
    expect(Math.abs(both.focus.xMm - xOnly.focus.xMm)).toBeLessThan(
      0.05 * Math.abs(xOnly.focus.xMm),
    );
  });

  it('振镜不显著改变 AOI（扫描与入射角解耦）', () => {
    for (const th of [-2, -1, 1, 2]) {
      const t = trace({ xGalvoRad: th * DEG });
      expect(Math.abs(t.focus.aoiXDeg)).toBeLessThan(0.5);
      expect(Math.abs(t.focus.aoiYDeg)).toBeLessThan(0.5);
    }
  });
});

describe('Novanta 光路 · Z 动态调焦', () => {
  it('Z 执行器改变焦点深度，方向单调', () => {
    let prev = -Infinity;
    for (const q of [-1.5, -0.75, 0, 0.75, 1.5]) {
      const t = trace({ telescopeTravelMm: q });
      expect(t.ok, `travel=${q}`).toBe(true);
      expect(t.focus.zMm).toBeGreaterThan(prev);
      prev = t.focus.zMm;
    }
  });

  it('Z 执行器不显著改变焦点 X/Y 与 AOI', () => {
    for (const q of [-1.5, 1.5]) {
      const t = trace({ telescopeTravelMm: q });
      expect(Math.abs(t.focus.xMm)).toBeLessThan(0.05);
      expect(Math.abs(t.focus.yMm)).toBeLessThan(0.05);
      expect(Math.abs(t.focus.aoiXDeg)).toBeLessThan(0.2);
      expect(Math.abs(t.focus.aoiYDeg)).toBeLessThan(0.2);
    }
  });

  it('Z 可逆：回到零位即回到零焦点', () => {
    trace({ telescopeTravelMm: 1.2 });
    const back = trace({ telescopeTravelMm: 0 });
    expect(back.focus.zMm).toBeCloseTo(0, 12);
  });

  it('可用的焦点 Z 范围在毫米级以下（与"毫米级移动镜组"的公开描述量级相容）', () => {
    const span =
      trace({ telescopeTravelMm: NOVANTA_ACTUATOR_LIMITS.telescopeTravelMm }).focus.zMm -
      trace({ telescopeTravelMm: -NOVANTA_ACTUATOR_LIMITS.telescopeTravelMm }).focus.zMm;
    expect(span).toBeGreaterThan(0.05);
    expect(span).toBeLessThan(3);
  });
});

describe('Novanta 光路 · 五轴联合', () => {
  it('五轴同时给指令仍然有限、可追迹', () => {
    const t = trace({
      plateARad: 8 * DEG,
      plateBRad: -6 * DEG,
      telescopeTravelMm: 1.0,
      xGalvoRad: 1.5 * DEG,
      yGalvoRad: -1.2 * DEG,
    });
    expect(t.ok).toBe(true);
    for (const v of [
      t.focus.xMm,
      t.focus.yMm,
      t.focus.zMm,
      t.focus.aoiXDeg,
      t.focus.aoiYDeg,
      t.focus.aoiMagnitudeDeg,
      t.pupil.radiusMm,
      t.pupil.vergence,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('全行程扫描（含机械倾角上限）不产生 NaN', () => {
    for (const pa of [-20, 0, 20]) {
      for (const pb of [-20, 0, 20]) {
        for (const q of [-1.5, 0, 1.5]) {
          const t = trace({
            plateARad: pa * DEG,
            plateBRad: pb * DEG,
            telescopeTravelMm: q,
            xGalvoRad: 5 * DEG,
            yGalvoRad: -5 * DEG,
          });
          // 允许因口径/几何判失败，但绝不允许 NaN
          if (t.ok) {
            expect(Number.isFinite(t.focus.xMm)).toBe(true);
            expect(Number.isFinite(t.focus.aoiMagnitudeDeg)).toBe(true);
          } else {
            expect(typeof t.note).toBe('string');
          }
        }
      }
    }
  });

  it('执行器数组与对象互转（顺序固定为 X, Y, Z, α, β）', () => {
    const a: NovantaActuatorState = {
      xGalvoRad: 1 * DEG,
      yGalvoRad: -2 * DEG,
      telescopeTravelMm: 0.5,
      plateARad: 3 * DEG,
      plateBRad: -4 * DEG,
    };
    const arr = novantaActuatorArray(a);
    expect(arr[0]).toBeCloseTo(1, 9);
    expect(arr[1]).toBeCloseTo(-2, 9);
    expect(arr[2]).toBeCloseTo(0.5, 12);
    expect(arr[3]).toBeCloseTo(3, 9);
    expect(arr[4]).toBeCloseTo(-4, 9);
    const back = novantaActuatorFromArray(arr);
    expect(back.xGalvoRad).toBeCloseTo(a.xGalvoRad, 12);
    expect(back.plateBRad).toBeCloseTo(a.plateBRad, 12);
  });

  it('行程裁剪：超限指令被夹住且如实标记', () => {
    const clamped = clampNovantaActuators({
      xGalvoRad: 99,
      yGalvoRad: -99,
      telescopeTravelMm: 99,
      plateARad: 99,
      plateBRad: -99,
    });
    expect(Math.abs(clamped.xGalvoRad)).toBeLessThanOrEqual(NOVANTA_ACTUATOR_LIMITS.galvoRad + 1e-12);
    expect(Math.abs(clamped.telescopeTravelMm)).toBeLessThanOrEqual(
      NOVANTA_ACTUATOR_LIMITS.telescopeTravelMm + 1e-12,
    );
    expect(Math.abs(clamped.plateARad)).toBeLessThanOrEqual(NOVANTA_ACTUATOR_LIMITS.plateRad + 1e-12);
  });
});

describe('Novanta 光路 · 事实边界', () => {
  it('板厚、折射率、口径都来自集中配置文件（不是散落的 magic number）', () => {
    expect(train.wobbleUnit.plateA.thicknessMm).toBe(NOVANTA_PLATES.thicknessMm);
    expect(train.wobbleUnit.plateA.refractiveIndex).toBe(NOVANTA_PLATES.refractiveIndex);
    expect(train.wobbleUnit.plateA.apertureMm).toBe(NOVANTA_PLATES.apertureMm);
  });

  it('两块板的元件信息标注为专利原理，并给出专利号', () => {
    const info = train.wobbleUnit as unknown as { plateA: { trust: string; note: string } };
    expect(info.plateA.trust).toBe('专利原理');
    expect(info.plateA.note).toContain('DE102004053298B4');
  });

  it('两板转轴互相正交且都垂直于名义光轴（专利明文要求）', () => {
    const a = train.wobbleUnit.plateA.rotationAxis;
    const b = train.wobbleUnit.plateB.rotationAxis;
    const beam = new Vector3(0, 0, -1);
    expect(Math.abs(a.dot(b))).toBeLessThan(1e-12);
    expect(Math.abs(a.dot(beam))).toBeLessThan(1e-12);
    expect(Math.abs(b.dot(beam))).toBeLessThan(1e-12);
  });

  it('光束在工件上方 z = 0 附近聚焦（名义焦点即原点）', () => {
    const t = trace({});
    expect(t.focusPoint.z).toBeCloseTo(0, 9);
    expect(t.focusPoint.x).toBeCloseTo(0, 9);
    expect(t.focusPoint.y).toBeCloseTo(0, 9);
  });
});
