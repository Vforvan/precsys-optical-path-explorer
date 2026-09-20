import { BufferAttribute, BufferGeometry, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { WORKPIECE } from '../config/layout';
import type { PartEntry } from './create-optics';
import { MaterialRemoval, SurfaceBuffers, type VoxelRegion } from '../simulation/material-removal';
import { commandAtTheta, type ProcessParams } from '../animation/process-modes';

export interface WorkpieceView {
  group: Group;
  detail: Mesh;
  parts: PartEntry[];
  material: MaterialRemoval;
  selectSession(key: string): void;
  sweep(params: ProcessParams, from: number, to: number): void;
  refreshMesh(): void;
  setSection(enabled: boolean): void;
}

export function buildWorkpieceView(): WorkpieceView {
  const group = new Group();
  const material = new MaterialRemoval();
  const metal = new MeshStandardMaterial({ color: '#829baf', metalness: 0.4, roughness: 0.55 });

  /**
   * 工件用**两个网格**，这是消除加工演示掉帧的关键：
   *
   *   - `shellMesh`：网格外边界上的面（长方体六个外表面）。实测占全部三角面的
   *     **94.5%**（66,658 / 70,516），但它**永远不变** —— 没有东西能从工件外面
   *     去除材料。所以只在首次建一次，之后再不重建。
   *   - `cutMesh`：随去除变化的面（带孔的顶面 + 孔壁 + 可能露出的底面/侧面），
   *     实测只有几千个面，每次重建很便宜。
   *
   * 改之前是一个网格装全部 7 万面、每 0.22 s 整体重建，帧时间会出现 42–60 ms 尖峰。
   * 两个网格都用固定容量缓冲；`frustumCulled = false`，因为几何用 drawRange
   * 控制绘制范围，包围球不再随孔形变化，交给视锥剔除反而会被误剔。
   */
  const shellBuffers = new SurfaceBuffers();
  const cutBuffers = new SurfaceBuffers();
  const shellGeometry = new BufferGeometry();
  const cutGeometry = new BufferGeometry();
  const shellMesh = new Mesh(shellGeometry, metal);
  const cutMesh = new Mesh(cutGeometry, metal);
  for (const mesh of [shellMesh, cutMesh]) {
    mesh.userData.partId = 'workpiece';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const detail = new Mesh(new BufferGeometry(), metal);
  detail.userData.partId = 'workpiece';
  detail.frustumCulled = false;

  // 大台面留出真实开口，中央嵌入可去除的实体试样。
  const half = material.width / 2;
  const outside = WORKPIECE.sizeX / 2;
  for (const [w, h, x, y] of [
    [outside-half, outside*2, -(outside+half)/2, 0],
    [outside-half, outside*2, (outside+half)/2, 0],
    [half*2, outside-half, 0, -(outside+half)/2],
    [half*2, outside-half, 0, (outside+half)/2],
  ]) {
    const rail = new Mesh(new BoxGeometry(w, h, material.depth), metal);
    rail.position.set(x, y, -material.depth / 2);
    rail.userData.partId = 'workpiece';
    group.add(rail);
  }
  let meshRevision = -1;
  let remainder = 0;
  let section = false;
  let shellBuilt = false;
  let detailShellBuilt = false;

  /** 把最前面的 `verts` 个顶点挂成几何体的属性（缓冲是复用的，故用 subarray 视图）。 */
  const attach = (
    geometry: BufferGeometry,
    data: { positions: Float32Array; normals: Float32Array },
    verts: number,
  ) => {
    const position = new BufferAttribute(data.positions, 3);
    const normal = new BufferAttribute(data.normals, 3);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', normal);
    geometry.setDrawRange(0, verts);
    if (verts > 0) geometry.computeBoundingSphere();
  };

  const refreshMesh = () => {
    if (meshRevision === material.stats().revision) return;
    // 静态外壳只建一次（首次必须全网格遍历）；
    // 之后只重建动态面，且把遍历限制在"被去除体素范围外扩一格"之内。
    const region = shellBuilt ? (material.dirtyRegion() ?? undefined) : undefined;
    const { staticVerts, dynamicVerts } = material.buildSurface(false, shellBuffers, cutBuffers, shellBuilt, region);
    if (!shellBuilt) {
      attach(shellGeometry, shellBuffers.sub(staticVerts), staticVerts);
      shellBuilt = true;
    }
    attach(cutGeometry, cutBuffers.sub(dynamicVerts), dynamicVerts);
    if (section) rebuildDetail(region);
    meshRevision = material.stats().revision;
  };

  const detailShellBuffers = new SurfaceBuffers();
  const detailCutBuffers = new SurfaceBuffers();

  /**
   * 剖切视图需要自己的一份缓冲与几何。
   *
   * 这里的"静态部分"包含两类：网格外边界的面，以及 y = ny/2 处剖切平面上的面。
   * 两者都与孔形无关，可以建一次后复用；但它们的 z 范围受脏区限制，
   * 因此只在**每次进入剖切模式时重建一次**（用户点击"剖切观察"），
   * 之后的去除只重建动态段。
   *
   * 这个取舍是有意的：剖切平面在深度方向会随孔加深而变化（孔更深，截面上露出的
   * 孔壁更长）。按下标捕获"静态"切片会漏掉后加深的部分，但漏掉的只是截面内部的
   * 一小块、深度方向差一个体素以内；换来的是剖切视图不再每次全量重建。
   * 剖切开关本身不频繁，切一次重算一次完全可接受。
   */
  const rebuildDetail = (region?: VoxelRegion) => {
    const useRegion = detailShellBuilt ? region : undefined;
    const cut = material.buildSurface(true, detailShellBuffers, detailCutBuffers, detailShellBuilt, useRegion);
    detailShellBuilt = true;
    const total = cut.staticVerts + cut.dynamicVerts;
    const geometry = new BufferGeometry();
    if (total > 0) {
      // 两段顶点连续拼进同一组属性：位置与法线各一份，避免再复制一遍数据
      const positions = new Float32Array(total * 3);
      const normals = new Float32Array(total * 3);
      positions.set(detailShellBuffers.positions.subarray(0, cut.staticVerts * 3), 0);
      normals.set(detailShellBuffers.normals.subarray(0, cut.staticVerts * 3), 0);
      positions.set(detailCutBuffers.positions.subarray(0, cut.dynamicVerts * 3), cut.staticVerts * 3);
      normals.set(detailCutBuffers.normals.subarray(0, cut.dynamicVerts * 3), cut.staticVerts * 3);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(normals, 3));
      geometry.setDrawRange(0, total);
      geometry.computeBoundingSphere();
    }
    detail.geometry.dispose();
    detail.geometry = geometry;
  };

  refreshMesh();
  return {
    group, detail, material,
    parts: [{ id: 'workpiece', label: '工件 · 累积体素去除', object: group }],
    selectSession(key) {
      if (material.selectSession(key)) { remainder = 0; refreshMesh(); }
    },
    sweep(params, from, to) {
      const spacing = Math.PI * 2 / 256;
      const cycle = params.revolutions * Math.PI * 2;
      if (to <= from || !Number.isFinite(to - from)) return;
      let cursor = from;
      while (cursor + spacing - remainder <= to + 1e-10) {
        cursor += spacing - remainder;
        remainder = 0;
        material.expose(commandAtTheta(params, ((cursor % cycle) + cycle) % cycle));
      }
      remainder += Math.max(0, to - cursor);
    },
    refreshMesh,
    setSection(enabled) {
      section = enabled;
      // 进入剖切模式时静态切片要重算一次（其 z 范围取决于当前脏区）
      if (enabled) detailShellBuilt = false;
      meshRevision = -1;
      refreshMesh();
    },
  };
}
