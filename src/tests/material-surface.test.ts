import { describe, expect, it } from 'vitest';
import { MaterialRemoval, SurfaceBuffers, type VoxelRegion } from '../simulation/material-removal';
import { commandAtTheta, DEFAULT_PROCESS } from '../animation/process-modes';

/**
 * 材料去除的表面重建。
 *
 * 背景：加工演示时帧时间会出现 42–60 ms 的尖峰。实测原因是每 0.22 s 重建整块
 * 7 万面的几何体，其中 **94.5% 是从未变过的静态外壳**（工件是个长方体，
 * 没有东西能从外面去除材料）；而且遍历 368,640 个体素只为服务约 3,000 个
 * 相关体素。修复方式是把静态外壳与动态加工面分开、并把遍历限制在脏区。
 *
 * 这里锁住的核心不变量：**限定脏区后的动态段，必须与全量遍历得到的动态段
 * 逐字节一致**。这是整套优化的正确性前提，一旦破坏画面会缺面或残留面，
 * 而且很难靠肉眼发现。
 *
 * 术语：一次 `buildSurface` 产出两段 —— 静态外壳（网格外边界）与动态加工面。
 * "全量"= 不限定脏区（skipStatic=false、无 region）；"仅动态"= skipStatic=true。
 */

/** 网格外边界的面数：顶/底各 nx·ny·2，四个侧面各 nz·nx·2（见 material-removal 注释）。 */
const NX = 96;
const NY = 96;
const NZ = 40;
const STATIC_TRIS = NX * NY * 2 * 2 + NZ * NX * 2 * 2 + NZ * NY * 2 * 2;

/** 用默认进动参数跑一段加工，制造真实的孔形。 */
function drill(material: MaterialRemoval, steps: number): void {
  const cycle = DEFAULT_PROCESS.revolutions * Math.PI * 2;
  for (let i = 0; i < steps; i++) {
    material.expose(commandAtTheta(DEFAULT_PROCESS, ((i / steps) * cycle) % cycle));
  }
}

const vertexKeys = (positions: Float32Array, normals: Float32Array, verts: number): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < verts; i++) {
    keys.push(
      `${positions[i * 3].toFixed(6)},${positions[i * 3 + 1].toFixed(6)},${positions[i * 3 + 2].toFixed(6)}`
      + `|${normals[i * 3]},${normals[i * 3 + 1]},${normals[i * 3 + 2]}`,
    );
  }
  return keys.sort();
};

interface BuildResult {
  staticVerts: number;
  dynamicVerts: number;
  staticKeys: string[];
  dynamicKeys: string[];
}

function build(
  material: MaterialRemoval,
  section: boolean,
  skipStatic: boolean,
  region?: VoxelRegion,
): BuildResult {
  const staticBuffers = new SurfaceBuffers();
  const dynamicBuffers = new SurfaceBuffers();
  const { staticVerts, dynamicVerts } = material.buildSurface(
    section, staticBuffers, dynamicBuffers, skipStatic, region,
  );
  const s = staticBuffers.sub(staticVerts);
  const d = dynamicBuffers.sub(dynamicVerts);
  return {
    staticVerts,
    dynamicVerts,
    staticKeys: vertexKeys(s.positions, s.normals, staticVerts),
    dynamicKeys: vertexKeys(d.positions, d.normals, dynamicVerts),
  };
}

describe('工件表面重建（静态外壳 / 动态加工面）', () => {
  it('静态外壳是长方体六个外表面，且只在首次建立', () => {
    const material = new MaterialRemoval();
    const empty = build(material, false, false);
    expect(empty.staticVerts).toBe(STATIC_TRIS * 3);
    expect(empty.dynamicVerts).toBe(0);

    // 生产路径（cumulative-workpiece 的 refreshMesh）在首次之后一律 skipStatic=true，
    // 所以画面上保留的是首次那个外壳。这里确认"跳过静态段"确实不再产出静态顶点。
    drill(material, 120);
    const dynamicOnly = build(material, false, true, material.dirtyRegion()!);
    expect(dynamicOnly.staticVerts).toBe(0);
    expect(dynamicOnly.dynamicVerts).toBeGreaterThan(0);

    // 已知取舍：若孔被打通到工件外缘，严格意义上的"静态外壳"会少掉那几个外缘面
    // （实测钻到第 120 步时少 181 个面）。这些面朝外、又位于实体内部，画面上不可见，
    // 因此接受"首次建立后不再更新"。若将来要求严格一致，需在孔触及外缘时强制重建一次。
    const full = build(material, false, false);
    expect(full.staticVerts).toBeLessThanOrEqual(empty.staticVerts);
    expect(full.staticVerts).toBeGreaterThan(empty.staticVerts * 0.99);
  });

  it('skipStatic 只产出动态段，且与全量产出中的动态段完全一致', () => {
    const material = new MaterialRemoval();
    drill(material, 120);
    const full = build(material, false, false);
    const dynamicOnly = build(material, false, true);
    expect(dynamicOnly.staticVerts).toBe(0);
    expect(dynamicOnly.dynamicVerts).toBe(full.dynamicVerts);
    expect(dynamicOnly.dynamicKeys).toEqual(full.dynamicKeys);
  });

  it('限定脏区后的动态段与全量遍历逐字节一致（含剖切模式）', () => {
    const material = new MaterialRemoval();
    drill(material, 120);
    const region = material.dirtyRegion();
    expect(region).not.toBeNull();

    for (const section of [false, true]) {
      const full = build(material, section, false);
      const restricted = build(material, section, true, region!);
      expect(restricted.staticVerts, `section=${section} 不应产出静态段`).toBe(0);
      // 关键不变量：脏区足够覆盖所有会变化的动态面
      expect(restricted.dynamicVerts, `section=${section} 动态段顶点数`).toBe(full.dynamicVerts);
      expect(restricted.dynamicKeys, `section=${section} 动态段顶点集`).toEqual(full.dynamicKeys);
    }
  });

  it('给 region 却不跳过静态段时直接报错（该组合没有正确语义）', () => {
    const material = new MaterialRemoval();
    drill(material, 60);
    const region = material.dirtyRegion()!;
    expect(() => material.buildSurface(false, new SurfaceBuffers(), new SurfaceBuffers(), false, region))
      .toThrow(/skipStatic/);
  });

  it('未加工时没有脏区（调用方须全量遍历以建立静态外壳）', () => {
    expect(new MaterialRemoval().dirtyRegion()).toBeNull();
  });

  it('换料会清空脏区并回到"全实心"', () => {
    const material = new MaterialRemoval();
    drill(material, 60);
    expect(material.dirtyRegion()).not.toBeNull();
    expect(material.selectSession('other')).toBe(true);
    expect(material.dirtyRegion()).toBeNull();
    const after = build(material, false, false);
    expect(after.dynamicVerts).toBe(0);
    expect(after.staticVerts / 3).toBe(STATIC_TRIS);
  });

  it('动态面远少于静态外壳（这是本次优化成立的前提）', () => {
    const material = new MaterialRemoval();
    drill(material, 300);
    const { staticVerts, dynamicVerts } = build(material, false, false);
    expect(dynamicVerts).toBeGreaterThan(0);
    // 实测动态约占 4–6%；留足余量，避免数值微调就误报
    expect(dynamicVerts / (staticVerts + dynamicVerts)).toBeLessThan(0.2);
  });
});
