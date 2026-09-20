import type { ProcessCommand } from '../animation/process-modes';

export interface RemovalStats {
  removedVoxels: number;
  volumeMm3: number;
  maxDepthMm: number;
  revision: number;
  resets: number;
}

/**
 * 体素索引范围（含端点）。
 *
 * 用于把重建限制在"被去除体素所在的一小块"：新暴露的面必然紧邻被去除的体素，
 * 所以这个范围外扩一格就是**精确**的充分范围。实测遍历 368,640 个位置只为服务
 * 约 3,000 个相关体素，限定范围是本次优化的主要收益来源。
 */
export interface VoxelRegion {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * 可复用的顶点缓冲，避免每次重建几何都重新分配内存。
 *
 * 三个要点：
 *   1. `ensure()` 只在**确实不够**时按 1.5 倍扩容，正常路径下不会有任何分配 ——
 *      所以调用方应传入一次精确的顶点数（`buildSurface` 先计数再分配），
 *      不要按理论上限预分配，否则每次超限都会白写一遍大数组；
 *   2. 写入位置由调用方用整数游标推进，不做 push、不建临时数组
 *      —— 原先 6.7 万个三角面要 push 约 120 万次并新建 6.7 万个角点数组，
 *      这是 GC 压力的主要来源；
 *   3. 返回的是 `subarray` 视图，**不是拷贝**：它和内部缓冲共享同一段内存，
 *      所以必须在渲染/上传之后才可再次写入同一缓冲。
 */
export class SurfaceBuffers {
  positions: Float32Array;
  normals: Float32Array;

  constructor(initialVerts = 1 << 12) {
    this.positions = new Float32Array(initialVerts * 3);
    this.normals = new Float32Array(initialVerts * 3);
  }

  /** 确保能容纳至少 `verts` 个顶点；仅在不足时扩容（内容不保留）。 */
  ensure(verts: number): void {
    if (verts <= this.positions.length / 3) return;
    let capacity = Math.max(this.positions.length / 3, 1 << 12);
    while (capacity < verts) capacity = Math.floor(capacity * 1.5) + 1;
    this.positions = new Float32Array(capacity * 3);
    this.normals = new Float32Array(capacity * 3);
  }

  sub(vertCount: number): { positions: Float32Array; normals: Float32Array } {
    return {
      positions: this.positions.subarray(0, vertCount * 3),
      normals: this.normals.subarray(0, vertCount * 3),
    };
  }
}

/** 持久体素实体：高斯权重的曝光预算沿入射方向作用于首个未去除体素。 */
export class MaterialRemoval {
  readonly nx = 96;
  readonly ny = 96;
  readonly nz = 40;
  readonly width = 3.2;
  readonly depth = 1.2;
  readonly dx = this.width / this.nx;
  readonly dz = this.depth / this.nz;
  readonly solid = new Uint8Array(this.nx * this.ny * this.nz).fill(1);
  private dose = new Float32Array(this.solid.length);
  private session: string | null = null;
  private count = 0;
  private deepest = 0;
  private revision = 0;
  private resets = 0;
  /**
   * 本次会话中被去除体素的索引范围（含端点），初值为空。
   *
   * 用途：重建几何时只遍历这一小块外扩一格，而不是全部 368,640 个体素。
   * 正确性依据：新暴露的面必然紧邻被去除的体素，所以该范围外的面不可能变化。
   */
  private dirty: VoxelRegion | null = null;

  selectSession(key: string): boolean {
    if (key === this.session) return false;
    this.session = key;
    this.solid.fill(1);
    this.dose.fill(0);
    this.count = 0;
    this.deepest = 0;
    this.dirty = null;
    this.revision++;
    this.resets++;
    return true;
  }

  /**
   * 需要重建的体素范围：被去除体素的范围**外扩一格**。
   * 还没有任何去除时返回 null（调用方应遍历全网格，以便建立静态外壳）。
   *
   * **范围是单调累积的（只扩不缩），这不是保守，而是正确性要求。**
   * 动态面是累积集合：最浅一层的暴露面、各层的孔壁、以及深层新露出的面都要保留。
   * 若按"当前这一帧的去除位置"取范围，早先已暴露、现在落在范围外的面就会被漏掉，
   * 画面上表现为缺面。这一点由 material-surface.test.ts 的
   * "限定脏区后的动态段与全量遍历逐字节一致"锁住。
   *
   * 实测：孔深推进到 40 层后范围仍远小于整网格，遍历量相比全量扫描下降两个数量级。
   */
  dirtyRegion(): VoxelRegion | null {
    if (!this.dirty) return null;
    return {
      x0: this.dirty.x0 - 1, x1: this.dirty.x1 + 1,
      y0: this.dirty.y0 - 1, y1: this.dirty.y1 + 1,
      z0: this.dirty.z0 - 1, z1: this.dirty.z1 + 1,
    };
  }

  /** 记录一个被去除体素，**只扩大**脏区（见 dirtyRegion 的说明）。 */
  private markDirty(ix: number, iy: number, iz: number): void {
    const d = this.dirty;
    if (!d) {
      this.dirty = { x0: ix, x1: ix, y0: iy, y1: iy, z0: iz, z1: iz };
      return;
    }
    if (ix < d.x0) d.x0 = ix;
    if (ix > d.x1) d.x1 = ix;
    if (iy < d.y0) d.y0 = iy;
    if (iy > d.y1) d.y1 = iy;
    if (iz < d.z0) d.z0 = iz;
    if (iz > d.z1) d.z1 = iz;
  }

  index(x: number, y: number, z: number): number { return (z * this.ny + y) * this.nx + x; }

  occupied(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz
      && this.solid[this.index(x, y, z)] === 1;
  }

  expose(pose: ProcessCommand, exposure = 0.7): void {
    if (!Number.isFinite(exposure) || exposure <= 0) return;
    if (![pose.xMm, pose.yMm, pose.zMm, pose.alphaDeg, pose.betaDeg].every(Number.isFinite)) return;
    const tx = Math.tan(pose.alphaDeg * Math.PI / 180);
    const ty = Math.tan(pose.betaDeg * Math.PI / 180);
    // 有效光斑为演示配置（半径 80 μm），并非 precSYS 标称焦斑或材料标定值。
    const radius = 0.08;
    const extent = Math.ceil(radius * 1.4 / this.dx);
    let changed = false;
    for (let v = -extent; v <= extent; v++) for (let u = -extent; u <= extent; u++) {
      const r2 = (u * u + v * v) * this.dx * this.dx;
      let budget = exposure * Math.exp(-2 * r2 / (radius * radius));
      if (budget < 0.015) continue;
      for (let layer = 0; layer < this.nz; layer++) {
        const z = -(layer + 0.5) * this.dz;
        const x = pose.xMm + tx * (pose.zMm - z) + u * this.dx;
        const y = pose.yMm + ty * (pose.zMm - z) + v * this.dx;
        const ix = Math.floor((x + this.width / 2) / this.dx);
        const iy = Math.floor((y + this.width / 2) / this.dx);
        if (ix < 0 || iy < 0 || ix >= this.nx || iy >= this.ny) continue;
        const idx = this.index(ix, iy, layer);
        if (!this.solid[idx]) continue;
        const focusWeight = 1 / (1 + ((z - pose.zMm) / 0.45) ** 2);
        const cost = (1 - this.dose[idx]) / focusWeight;
        if (budget < cost) {
          this.dose[idx] += budget * focusWeight;
          break;
        }
        this.solid[idx] = 0;
        this.dose[idx] = 0;
        this.markDirty(ix, iy, layer);
        budget -= cost;
        this.count++;
        this.deepest = Math.max(this.deepest, (layer + 1) * this.dz);
        changed = true;
        if (budget < 0.015) break;
      }
    }
    if (changed) this.revision++;
  }

  stats(): RemovalStats {
    return { removedVoxels: this.count, volumeMm3: this.count * this.dx * this.dx * this.dz,
      maxDepthMm: this.deepest, revision: this.revision, resets: this.resets };
  }

  /**
   * 判断某个面是否要发出。
   *
   * 判据与旧实现严格等价：当且仅当该方向的相邻体素**不可见**（越界，或
   * 已被去除，或处于剖切时被切掉的前半）时，这个面才是表面。
   * 单独抽出来是为了让计数扫描与填充扫描共用同一套判定，避免两处逻辑漂移。
   */
  private faceVisible(x: number, y: number, z: number, face: number, section: boolean): boolean {
    const { nx, ny, nz, solid } = this;
    const rowBase = (z * ny + y) * nx;
    switch (face) {
      case 0: // +z 顶面
        return z === 0 || solid[rowBase - nx * ny + x] === 0;
      case 1: // −z 底面
        return z === nz - 1 || solid[rowBase + nx * ny + x] === 0;
      case 2: // −x
        return x === 0 || solid[rowBase + x - 1] === 0;
      case 3: // +x
        return x === nx - 1 || solid[rowBase + x + 1] === 0;
      case 4: // −y；剖切时 y = ny/2 那一层的前方被切掉，故该层的 −y 面要显示
        if (section && y === ny / 2) return true;
        if (y === 0) return true;
        if (section && y - 1 < ny / 2) return true;
        return solid[rowBase - nx + x] === 0;
      default: // +y
        return y === ny - 1 || solid[rowBase + nx + x] === 0;
    }
  }

  /** 该体素在剖切模式下是否属于保留（后半）部分。 */
  private inSection(y: number, section: boolean): boolean {
    return !section || y >= this.ny / 2;
  }

  /**
   * 这个面是否属于"与孔形无关的部分"（可由调用方只建一次后复用）。
   *
   * 两类都算：
   *   1. **网格外边界**：顶面（z=0）、底面（z=nz−1）、四个侧面。工件是个长方体，
   *      没有东西能从外面去除材料。
   *   2. **剖切平面**：section 模式下 y = ny/2 那一层朝 −y 的面。它只取决于 y，
   *      与孔形无关。
   *
   * 注意两类都必须**只在全量遍历时**产出：它们跨整个 x-y 平面，若与 `region`
   * 一起用会被裁掉。因此 `buildSurface` 禁止 region 与静态段同时出现。
   */
  private isStaticBoundary(x: number, y: number, z: number, face: number, section: boolean): boolean {
    switch (face) {
      case 0: return z === 0;                 // 顶面
      case 1: return z === this.nz - 1;       // 底面
      case 2: return x === 0;
      case 3: return x === this.nx - 1;
      case 4: return y === 0 || (section && y === this.ny / 2); // 侧面 + 剖切平面
      default: return y === this.ny - 1;
    }
  }

  /**
   * 生成实体与空气的边界，并把结果**分成两个缓冲**：
   *   - `staticBuffers`：网格外边界上的面。工件是个长方体，这些面只需要一次，
   *     之后永远不变 —— 实测占全部三角面的 **94.5%**（66,658 / 70,516）。
   *   - `dynamicBuffers`：真正随材料去除变化的面（带孔的顶面 + 孔壁 + 可能露出的
   *     底面/侧面），实测只有几千个面。
   *
   * 为什么要拆开：原实现每 0.22 s 重建整块 7 万面的几何体，其中 94.5% 是从未变过的
   * 外壳，帧时间因此出现 42–60 ms 的尖峰。
   *
   * 两道优化叠加（都是实测驱动，不是猜测）：
   *   1. **两阶段**：先做一次廉价计数扫描求出精确顶点数，再按需分配并填充。
   *      早期版本按 `nx*ny*nz*36` 上限预分配，正好踩坑（单次重建反而涨到 70 ms）。
   *   2. **脏区限制**：`region` 给定时只遍历那一小块。新暴露的面必然紧邻被去除的
   *      体素，所以"被去除体素的范围外扩一格"就是精确的充分范围。
   *      实测遍历 368,640 个位置只服务约 3,000 个相关体素，这一项是主要开销。
   *
   * @param skipStatic 静态外壳已在别处建好时为 true，只产出动态面。**给 `region`
   *                   时必须为 true**：静态外壳跨整个长方体，不属于脏区。
   * @param region     只遍历这个体素范围；省略则遍历全网格。
   */
  buildSurface(
    section: boolean,
    staticBuffers: SurfaceBuffers,
    dynamicBuffers: SurfaceBuffers,
    skipStatic = false,
    region?: VoxelRegion,
  ): { staticVerts: number; dynamicVerts: number } {
    if (region && !skipStatic) {
      // 这个组合没有正确语义：脏区只覆盖孔附近，而静态外壳铺满整个长方体。
      // 真这么做会返回残缺的静态外壳、画面上缺一大块面，且很难察觉。
      throw new Error('buildSurface: 指定 region 时必须同时 skipStatic=true');
    }
    const { nx, ny, nz, dx, dz, solid } = this;
    const halfWidth = this.width / 2;
    const x0 = region ? Math.max(0, region.x0) : 0;
    const x1 = region ? Math.min(nx - 1, region.x1) : nx - 1;
    const y0 = region ? Math.max(0, region.y0) : 0;
    const y1 = region ? Math.min(ny - 1, region.y1) : ny - 1;
    const z0 = region ? Math.max(0, region.z0) : 0;
    const z1 = region ? Math.min(nz - 1, region.z1) : nz - 1;

    // 第一遍：只计数，不产出几何
    let staticCount = 0;
    let dynamicCount = 0;
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        if (!this.inSection(y, section)) continue;
        const rowBase = (z * ny + y) * nx;
        for (let x = x0; x <= x1; x++) {
          if (solid[rowBase + x] !== 1) continue;
          for (let face = 0; face < 6; face++) {
            if (!this.faceVisible(x, y, z, face, section)) continue;
            if (this.isStaticBoundary(x, y, z, face, section)) {
              if (!skipStatic) staticCount += 6;
            } else dynamicCount += 6;
          }
        }
      }
    }

    // 第二遍：按精确尺寸分配并填充
    if (!skipStatic) staticBuffers.ensure(staticCount);
    dynamicBuffers.ensure(dynamicCount);
    const sp = staticBuffers.positions;
    const sn = staticBuffers.normals;
    const dp = dynamicBuffers.positions;
    const dn = dynamicBuffers.normals;
    let sc = 0;
    let dc = 0;

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        if (!this.inSection(y, section)) continue;
        const rowBase = (z * ny + y) * nx;
        for (let x = x0; x <= x1; x++) {
          if (solid[rowBase + x] !== 1) continue;
          const a = x * dx - halfWidth;
          const b = a + dx;
          const c = y * dx - halfWidth;
          const d = c + dx;
          const top = -z * dz;
          const bottom = top - dz;

          for (let face = 0; face < 6; face++) {
            if (!this.faceVisible(x, y, z, face, section)) continue;
            const isStatic = this.isStaticBoundary(x, y, z, face, section);
            // skipStatic 时静态面已经建好，这里直接跳过，不再产出
            if (skipStatic && isStatic) continue;
            const useStatic = !skipStatic && isStatic;

            const target = useStatic ? sp : dp;
            const targetN = useStatic ? sn : dn;
            let write = useStatic ? sc : dc;
            const nxv = face === 2 ? -1 : face === 3 ? 1 : 0;
            const nyv = face === 4 ? -1 : face === 5 ? 1 : 0;
            const nzv = face === 0 ? 1 : face === 1 ? -1 : 0;
            const put = (px: number, py: number, pz: number) => {
              target[write * 3] = px;
              target[write * 3 + 1] = py;
              target[write * 3 + 2] = pz;
              targetN[write * 3] = nxv;
              targetN[write * 3 + 1] = nyv;
              targetN[write * 3 + 2] = nzv;
              write++;
            };
            // 每个面两个三角形，对角线与绕序与原实现逐字一致
            switch (face) {
              case 0:
                put(a, c, top); put(b, c, top); put(b, d, top);
                put(a, c, top); put(b, d, top); put(a, d, top);
                break;
              case 1:
                put(a, d, bottom); put(b, d, bottom); put(b, c, bottom);
                put(a, d, bottom); put(b, c, bottom); put(a, c, bottom);
                break;
              case 2:
                put(a, c, bottom); put(a, c, top); put(a, d, top);
                put(a, c, bottom); put(a, d, top); put(a, d, bottom);
                break;
              case 3:
                put(b, d, bottom); put(b, d, top); put(b, c, top);
                put(b, d, bottom); put(b, c, top); put(b, c, bottom);
                break;
              case 4:
                put(b, c, bottom); put(b, c, top); put(a, c, top);
                put(b, c, bottom); put(a, c, top); put(a, c, bottom);
                break;
              default:
                put(a, d, bottom); put(a, d, top); put(b, d, top);
                put(a, d, bottom); put(b, d, top); put(b, d, bottom);
                break;
            }
            if (useStatic) sc = write; else dc = write;
          }
        }
      }
    }
    return { staticVerts: sc, dynamicVerts: dc };
  }

  /** 兼容入口：一次性返回合并后的几何数据（每次调用都新分配）。 */
  surface(section = false): { positions: Float32Array; normals: Float32Array } {
    const staticBuffers = new SurfaceBuffers();
    const dynamicBuffers = new SurfaceBuffers();
    const { staticVerts, dynamicVerts } = this.buildSurface(section, staticBuffers, dynamicBuffers);
    const total = staticVerts + dynamicVerts;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    positions.set(staticBuffers.positions.subarray(0, staticVerts * 3), 0);
    normals.set(staticBuffers.normals.subarray(0, staticVerts * 3), 0);
    positions.set(dynamicBuffers.positions.subarray(0, dynamicVerts * 3), staticVerts * 3);
    normals.set(dynamicBuffers.normals.subarray(0, dynamicVerts * 3), staticVerts * 3);
    return { positions, normals };
  }
}
