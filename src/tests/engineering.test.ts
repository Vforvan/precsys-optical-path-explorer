import { describe, expect, it } from 'vitest';
import { buildAssembly, mechanicalObstructions } from '../engineering/assembly';
import { aoiFromDirection, aoiTarget, controllability, evaluate, inverse, LIMITS, opticsAt, type Coordinates } from '../engineering/model';

describe('五轴独立镜片工程候选', () => {
  it('零位准直扩束后在工件原点聚焦，且没有支座挡光', () => {
    const q: Coordinates = [0, 0, 0, 0, 0];
    const result = evaluate(q);
    expect(result.errors).toEqual([]);
    for (const n of result.output!) expect(n).toBeCloseTo(0, 8);
    expect(result.rms).toBeLessThan(1e-8);
    expect(result.apertureMargin).toBeGreaterThan(8);
    expect(mechanicalObstructions(buildAssembly(q), result)).toEqual([]);
    expect(controllability(q).rank).toBe(5);
  });

  it('每个电机只对应一片运动光学件，并且只有五个电机', () => {
    const q: Coordinates = [0, 0, 0, 0, 0];
    const optics = opticsAt(q);
    expect(optics).toHaveLength(7);
    expect(optics.filter(optic => optic.motor !== null)).toHaveLength(5);
    expect(new Set(optics.filter(optic => optic.motor !== null).map(optic => optic.motor)).size).toBe(5);
    const assembly = buildAssembly(q);
    expect(assembly.parts.filter(part => /^M[1-5]$/.test(part.id))).toHaveLength(5);
    const translated = opticsAt([0, 0, 0, 0, 0.5]);
    expect(translated[0].center.x - optics[0].center.x).toBeCloseTo(0.5, 10);
    for (let i = 1; i < optics.length; i++) expect(translated[i].center.distanceTo(optics[i].center)).toBe(0);
  });

  it('第五轴从实际光束会聚改变Z，不是直接设置焦点', () => {
    const a = evaluate([0, 0, 0, 0, -0.8]);
    const b = evaluate([0, 0, 0, 0, 0.8]);
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
    expect(a.output![2] * b.output![2]).toBeLessThan(0);
    expect(Math.abs(a.output![2] - b.output![2])).toBeGreaterThan(0.5);
    expect(a.rms).toBeLessThan(1e-8); expect(b.rms).toBeLessThan(1e-8);
  });

  it('保留原有小行程的32个组合角点通光能力', () => {
    const issues: unknown[] = [];
    for (let mask = 0; mask < 32; mask++) {
      const q = [0.3, 0.3, 0.3, 0.3, 0.8].map((limit, i) => (mask & (1 << i) ? 1 : -1) * limit) as Coordinates;
      const result = evaluate(q, 8);
      const blocked = mechanicalObstructions(buildAssembly(q), result);
      const capability = controllability(q);
      if (result.errors.length || blocked.length || capability.rank !== 5) issues.push({ q, errors: result.errors, blocked, capability });
    }
    expect(issues).toEqual([]);
  });

  it('可达目标由逆解恢复，不可达目标如实失败', () => {
    const original: Coordinates = [0.12, -0.1, 0.07, 0.08, 0.35];
    const target = evaluate(original).output!;
    const solution = inverse(target);
    expect(solution.ok).toBe(true);
    solution.q.forEach((n, i) => expect(n).toBeCloseTo(original[i], 4));
    expect(inverse([100, 100, 100, 80, 80]).ok).toBe(false);
    expect(evaluate([LIMITS[0] + 1, 0, 0, 0, 0]).errors).toContain('M1 超出建模行程');
  });

  it('真实总AOI与方向分量严格区分，正负子午方向均可达7度', () => {
    for (const signed of [-7, 7]) for (const azimuth of [0, 45, 90, 135]) {
      const solution = inverse(aoiTarget(signed, azimuth));
      expect(solution.ok).toBe(true);
      const result = evaluate(solution.q);
      expect(aoiFromDirection(result.chief.direction)).toBeCloseTo(7, 5);
      result.output!.slice(0, 3).forEach(n => expect(n).toBeCloseTo(0, 5));
      expect(mechanicalObstructions(buildAssembly(solution.q), result)).toEqual([]);
    }
    const diagonal = aoiTarget(7, 45);
    expect(diagonal[3]).toBeCloseTo(4.962069, 4);
    expect(diagonal[4]).toBeCloseTo(diagonal[3], 8);
  });

  it('7度倾角可与偏心焦点和Z调焦组合，扩大R3后仍通过实体遮挡检查', () => {
    for (const z of [-0.4, 0.4]) for (let phase = 0; phase < 360; phase += 30) {
      const target = aoiTarget(7, phase, [1.25 * Math.cos(phase * Math.PI / 180), 1.25 * Math.sin(phase * Math.PI / 180), z]);
      const solution = inverse(target);
      expect(solution.ok).toBe(true);
      const result = evaluate(solution.q, 32);
      result.output!.forEach((n, i) => expect(n).toBeCloseTo(target[i], 5));
      expect(aoiFromDirection(result.chief.direction)).toBeCloseTo(7, 5);
      expect(result.apertureMargin).toBeGreaterThan(1);
      expect(controllability(solution.q).rank).toBe(5);
      expect(mechanicalObstructions(buildAssembly(solution.q), result)).toEqual([]);
    }
  });
});
