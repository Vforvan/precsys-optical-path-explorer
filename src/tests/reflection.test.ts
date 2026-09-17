import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  DEG,
  directionFromTilt,
  intersectPlane,
  makeRay,
  propagate,
  radToDeg,
  reflect,
  tiltFromDirection,
} from '../optics/ray';

describe('反射与光线基础数学', () => {
  it('反射定律：45° 镜把竖直光束折成水平', () => {
    const d = new Vector3(0, 0, -1);
    const n = new Vector3(1, 0, 1).normalize();
    const out = reflect(d, n);
    expect(out.x).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it('反射方向与法向定向无关（n 与 -n 结果相同）', () => {
    const d = new Vector3(0.2, -0.1, -1).normalize();
    const n = new Vector3(0.3, 0.4, 0.866).normalize();
    const a = reflect(d, n);
    const b = reflect(d, n.clone().negate());
    expect(a.distanceTo(b)).toBeLessThan(1e-12);
  });

  it('镜面转 δ，反射光方向变化 2δ（经典两倍角关系）', () => {
    const d = new Vector3(0, 0, -1);
    const delta = 1.5 * DEG;
    const n0 = new Vector3(1, 0, 1).normalize();
    const n1 = n0.clone().applyAxisAngle(new Vector3(0, 1, 0), delta);
    const a = reflect(d, n0);
    const b = reflect(d, n1);
    expect(radToDeg(a.angleTo(b))).toBeCloseTo(2 * radToDeg(delta), 6);
  });

  it('光线与平面求交：交点确实在平面与光线上', () => {
    const ray = makeRay(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    const t = intersectPlane(ray, new Vector3(0, 0, 0), new Vector3(1, 0, 1).normalize());
    expect(t).not.toBeNull();
    const p = ray.origin.clone().addScaledVector(ray.direction, t as number);
    expect(p.z).toBeCloseTo(0, 12);
  });

  it('平行于平面的光线没有交点', () => {
    const ray = makeRay(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    expect(intersectPlane(ray, new Vector3(0, 0, 0), new Vector3(0, 0, 1))).toBeNull();
  });

  it('α/β 与方向向量互为逆变换（与计划书 §6 的 tan 定义一致）', () => {
    const alpha = 5.5;
    const beta = -3.2;
    const dir = directionFromTilt(alpha * DEG, beta * DEG);
    const back = tiltFromDirection(dir);
    expect(radToDeg(back.alphaRad)).toBeCloseTo(alpha, 9);
    expect(radToDeg(back.betaRad)).toBeCloseTo(beta, 9);
  });

  it('光束包络传播：会聚光束半径按预期收缩，焦点处半径趋零', () => {
    // 半径 1 mm、会聚到 75 mm 后
    const envelope = { radius: 1, vergence: 1 / 75 };
    const atFocus = propagate(envelope, 75);
    expect(atFocus.radius).toBeLessThanOrEqual(1.0000001e-6);
    const half = propagate(envelope, 37.5);
    expect(half.radius).toBeCloseTo(0.5, 9);
  });
});
