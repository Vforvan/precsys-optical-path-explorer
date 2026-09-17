import type { ProcessCommand } from '../animation/process-modes';

export interface RemovalStats {
  removedVoxels: number;
  volumeMm3: number;
  maxDepthMm: number;
  revision: number;
  resets: number;
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

  selectSession(key: string): boolean {
    if (key === this.session) return false;
    this.session = key;
    this.solid.fill(1);
    this.dose.fill(0);
    this.count = 0;
    this.deepest = 0;
    this.revision++;
    this.resets++;
    return true;
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

  /** 仅生成实体与空气的边界，孔壁/孔底均由剩余材料计算。 */
  surface(section = false): { positions: Float32Array; normals: Float32Array } {
    const positions: number[] = [];
    const normals: number[] = [];
    const present = (x: number, y: number, z: number) => this.occupied(x,y,z) && (!section || y >= this.ny / 2);
    const face = (corners: number[][], normal: number[]) => {
      for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(...corners[i]); normals.push(...normal); }
    };
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      if (!present(x, y, z)) continue;
      const a = x * this.dx - this.width / 2, b = a + this.dx;
      const c = y * this.dx - this.width / 2, d = c + this.dx;
      const top = -z * this.dz, bottom = top - this.dz;
      if (!present(x, y, z - 1)) face([[a,c,top],[b,c,top],[b,d,top],[a,d,top]], [0,0,1]);
      if (!present(x, y, z + 1)) face([[a,d,bottom],[b,d,bottom],[b,c,bottom],[a,c,bottom]], [0,0,-1]);
      if (!present(x - 1, y, z)) face([[a,c,bottom],[a,c,top],[a,d,top],[a,d,bottom]], [-1,0,0]);
      if (!present(x + 1, y, z)) face([[b,d,bottom],[b,d,top],[b,c,top],[b,c,bottom]], [1,0,0]);
      if (!present(x, y - 1, z)) face([[b,c,bottom],[b,c,top],[a,c,top],[a,c,bottom]], [0,-1,0]);
      if (!present(x, y + 1, z)) face([[a,d,bottom],[a,d,top],[b,d,top],[b,d,bottom]], [0,1,0]);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
  }
}
