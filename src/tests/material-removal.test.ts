import { describe, expect, it } from 'vitest';
import { MaterialRemoval } from '../simulation/material-removal';
import { buildWorkpieceView } from '../scene/cumulative-workpiece';
import { DEFAULT_PROCESS } from '../animation/process-modes';
import { createGalvoMotor } from '../scene/galvo-motor';
import { createOpticalTrain } from '../optics/optical-train';
import { OPTICS_VARIANTS } from '../config/public-specs';
import { AppState } from '../app-state';

const pose = { xMm: 0, yMm: 0, zMm: 0, alphaDeg: 0, betaDeg: 0 };
describe('累积材料去除', () => {
  it('初始完整实体，曝光后移除体素，空腔不能重新长回', () => {
    const material = new MaterialRemoval();
    expect(material.stats().removedVoxels).toBe(0);
    material.expose(pose, 4);
    const before = material.solid.slice();
    expect(material.stats().removedVoxels).toBeGreaterThan(0);
    material.expose({ ...pose, xMm: 0.1 }, 4);
    before.forEach((value, i) => { if (!value) expect(material.solid[i]).toBe(0); });
    const stats = material.stats();
    expect(stats.volumeMm3).toBeCloseTo(stats.removedVoxels * material.dx ** 2 * material.dz, 10);
    expect(stats.maxDepthMm).toBeLessThanOrEqual(material.depth);
  });
  it('相同策略不清空，只有新策略清空；空曝光、非法值不改变工件', () => {
    const material = new MaterialRemoval();
    material.selectSession('precession:positive');
    material.expose(pose, 5);
    const stats = material.stats();
    expect(material.selectSession('precession:positive')).toBe(false);
    material.expose(pose, 0);
    material.expose({ ...pose, xMm: NaN });
    expect(material.stats()).toEqual(stats);
    expect(material.selectSession('precession:negative')).toBe(true);
    expect(material.stats().removedVoxels).toBe(0);
  });
  it('垂直照射只从暴露表面向下去除，不能在完整表皮下挖暗孔', () => {
    const m = new MaterialRemoval();
    for (let i = 0; i < 8; i++) m.expose({ ...pose, zMm: -0.5 });
    for (let x = 0; x < m.nx; x++) for (let y = 0; y < m.ny; y++) {
      let foundSolid = false;
      for (let z = 0; z < m.nz; z++) {
        if (m.occupied(x,y,z)) foundSolid = true;
        else expect(foundSolid).toBe(false);
      }
    }
  });
  it('不同帧划分得到相同切削轨迹，循环保留旧去除结果', () => {
    const a = buildWorkpieceView(), b = buildWorkpieceView();
    a.selectSession('test'); b.selectSession('test');
    const p = { ...DEFAULT_PROCESS, mode: 'trepann' as const };
    a.sweep(p, 0, Math.PI*2);
    for (let i = 0; i < 100; i++) b.sweep(p, i/100*Math.PI*2, (i+1)/100*Math.PI*2);
    expect(a.material.stats().removedVoxels).toBe(b.material.stats().removedVoxels);
    expect(a.material.solid).toEqual(b.material.solid);
    const count = a.material.stats().removedVoxels;
    a.sweep(p, 0, Math.PI*2);
    expect(a.material.stats().removedVoxels).toBeGreaterThan(count);
  });
  it('暂停、视角切换与状态复位不会产生加工跨度；循环末尾仍记录完整跨度', () => {
    const s = new AppState();
    s.setMode('process'); s.setPlaying(false); s.advance(1);
    expect(s.processSpan).toBeNull();
    s.setPlaying(true); s.theta = s.process.revolutions*Math.PI*2-0.01;
    s.advance(0.1);
    expect(s.processSpan!.to).toBeGreaterThan(s.process.revolutions*Math.PI*2);
    s.reset(); s.advance(1);
    expect(s.processSpan).toBeNull();
  });
});

describe('主动镜片电机', () => {
  it('定子位置不随角度移动，转子跟随机械角，状态可辨识', () => {
    const train = createOpticalTrain(OPTICS_VARIANTS[0]);
    const motor = createGalvoMotor(train.xGalvo, 'X');
    const initial = motor.group.position.clone();
    motor.update(0.02);
    expect(motor.group.position.equals(initial)).toBe(true);
    expect(motor.group.getObjectByName('rotor')!.rotation.z).toBeCloseTo(0.02);
    expect(motor.group.userData.moving).toBe(true);
    motor.update(0.02);
    expect(motor.group.userData.moving).toBe(false);
  });
});
