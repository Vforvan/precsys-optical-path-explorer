import { describe, expect, it } from 'vitest';
import { createProcess, RemovalPreview, solveProcessPoint, type ProcessFrame } from '../engineering/process';
import { aoiFromDirection, evaluate, type Coordinates } from '../engineering/model';
import { buildAssembly, mechanicalObstructions } from '../engineering/assembly';

describe('五轴加工示例', () => {
  for (const kind of ['spiral', 'square'] as const) {
    it(`${kind} 全部轨迹点可逆解、保持AOI范围并完成分层去除`, () => {
      const program = createProcess(kind);
      const removal = new RemovalPreview();
      let previous: Coordinates = [0, 0, 0, 0, 0];
      const phases = new Set<string>();
      const layers = new Set<number>();
      for (let i = 0; i < program.length; i++) {
        const frame = solveProcessPoint(program[i], previous); previous = frame.q;
        frame.actual.forEach((n, j) => expect(Math.abs(n - frame.target[j])).toBeLessThan(1e-5));
        const trace = evaluate(frame.q, 8);
        expect(aoiFromDirection(trace.chief.direction)).toBeLessThanOrEqual(kind === 'spiral' ? 3.00001 : 0.00001);
        if (i % 16 === 0 || i === program.length - 1 || frame.laserOn !== program[i - 1]?.laserOn) {
          const assembly = buildAssembly(frame.q);
          expect(mechanicalObstructions(assembly, trace)).toEqual([]);
          assembly.root.traverse(object => { (object as { geometry?: { dispose(): void } }).geometry?.dispose(); });
        }
        removal.apply(frame); phases.add(frame.phase); if (frame.laserOn) layers.add(frame.layer);
      }
      expect([...layers]).toEqual([1, 2, 3]);
      expect(program.at(-1)!.laserOn).toBe(false);
      expect(program.at(-1)!.target[2]).toBeCloseTo(0.1, 10);
      expect(removal.stats().maxDepth).toBeCloseTo(0.3, 5);
      expect(removal.stats().areaMm2).toBeGreaterThan(kind === 'spiral' ? 0.9 : 1.3);
      expect(removal.stats().areaMm2).toBeLessThan(kind === 'spiral' ? 1.16 : 1.46);
      expect(phases.has(kind === 'spiral' ? '圆孔外圈精修' : '方孔第 4 边精修')).toBe(true);
      const center = Math.floor(removal.size / 2);
      expect(removal.depth[center * removal.size + center]).toBeCloseTo(0.3, 5);
      expect(removal.depth[0]).toBe(0);
    }, 30000);
  }

  it('关光运动不去除材料、不在两次曝光之间划出假沟槽，重置清空', () => {
    const removal = new RemovalPreview();
    const frame = (x: number, laserOn: boolean): ProcessFrame => ({ target: [x, 0, -0.1, 0, 0], actual: [x, 0, -0.1, 0, 0], q: [0, 0, 0, 0, 0], laserOn, layer: 1, phase: '测试' });
    removal.apply(frame(-0.5, true));
    const first = removal.stats();
    removal.apply(frame(0, false));
    expect(removal.stats()).toEqual(first);
    removal.apply(frame(0.5, true));
    const center = Math.floor(removal.size / 2);
    expect(removal.depth[center * removal.size + center]).toBe(0);
    removal.reset(); expect(removal.stats().removedCells).toBe(0);
  });
});
