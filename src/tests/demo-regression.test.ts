import { describe, expect, it } from 'vitest';
import { Mesh, Raycaster } from 'three';
import { AppState } from '../app-state';
import { PROCESS_PRESETS, presetParameters } from '../ui/process-presets';
import { createMaterials } from '../scene/create-scene';
import { buildOpticsView } from '../scene/create-optics';

describe('加工演示回归', () => {
  it('播放更新快照与焦点，暂停保持不动', () => {
    const s = new AppState();
    s.setMode('process'); s.setPlaying(true);
    const before = s.snapshot();
    s.advance(0.4);
    const after = s.snapshot();
    expect(after.theta).toBeGreaterThan(before.theta);
    expect(after.trace.focusPoint.distanceTo(before.trace.focusPoint)).toBeGreaterThan(0.1);
    s.setPlaying(false);
    const paused = s.snapshot().trace.focusPoint.clone();
    s.advance(0.4);
    expect(s.snapshot().trace.focusPoint.distanceTo(paused)).toBeLessThan(1e-4);
  });

  it('循环回到起点；非循环停止于终点；冲击保持固定入射方向', () => {
    const s = new AppState();
    s.setProcess(presetParameters('percussion')!); s.setMode('process');
    s.setPlaying(true); s.advance(1);
    expect(s.command.alphaDeg).toBe(0); expect(s.command.betaDeg).toBe(0);
    s.advance(100); expect(s.theta).toBeLessThan(s.process.revolutions * Math.PI * 2);
    s.loop = false; s.advance(100);
    expect(s.playing).toBe(false);
    expect(s.theta).toBeCloseTo(s.process.revolutions * Math.PI * 2);
  });

  for (const preset of PROCESS_PRESETS) {
    it(`${preset.name}：全周期光路命中实体镜面且无非目标遮挡`, () => {
      const s = new AppState();
      s.setMode('process'); s.setProcess(presetParameters(preset.id)!);
      const view = buildOpticsView(s.train, createMaterials());
      const obstacles: Mesh[] = [];
      view.group.traverse((obj) => {
        if (obj instanceof Mesh && !Array.isArray(obj.material) && !obj.material.transparent) obstacles.push(obj);
      });
      const collisions: string[] = [];
      for (let step = 0; step <= 73; step++) {
        s.theta = step / 73 * s.process.revolutions * Math.PI * 2;
        s.advance(0);
        const snap = s.snapshot();
        expect(snap.trace.ok).toBe(true);
        expect(Math.abs(snap.residual.xMm)).toBeLessThan(0.02);
        expect(Math.abs(snap.residual.alphaDeg)).toBeLessThan(0.02);
        view.update(snap.actuators, snap.trace);
        view.group.updateMatrixWorld(true);
        expect(snap.trace.hits.length).toBe(13);
        for (const hit of snap.trace.hits) {
          const part = view.parts.find((p) => p.id === hit.mirrorId)!;
          const local = part.object.worldToLocal(hit.point.clone());
          expect(Math.abs(local.z), `${hit.mirrorId} 反射点离开表面`).toBeLessThan(1e-5);
          expect(Math.abs(local.x)).toBeLessThan(part.spec!.size.u / 2 + 1e-5);
          expect(Math.abs(local.y)).toBeLessThan(part.spec!.size.v / 2 + 1e-5);
        }
        for (let i = 0; i < snap.trace.segments.length; i++) {
          const seg = snap.trace.segments[i];
          const direction = seg.to.clone().sub(seg.from).normalize();
          const ray = new Raycaster(seg.from.clone().addScaledVector(direction, 0.05), direction, 0, seg.from.distanceTo(seg.to) - 0.1);
          for (const hit of ray.intersectObjects(obstacles, false)) {
            collisions.push(`${preset.id}: 相位${step}, 段${i}, ${hit.object.userData.partId}, 距离${hit.distance.toFixed(2)}`);
          }
        }
      }
      expect(collisions.slice(0, 12)).toEqual([]);
      view.group.traverse((obj) => { if (obj instanceof Mesh) obj.geometry.dispose(); });
    });
  }
});
