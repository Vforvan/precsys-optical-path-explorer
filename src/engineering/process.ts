import { aoiTarget, evaluate, inverse, type Coordinates } from './model';

export type ProcessKind = 'spiral' | 'square';
export const PROCESS_FOOTPRINT_MM = 0.06;
export const PROCESS_DEPTH_MM = 0.3;
export interface ProcessPoint {
  target: Coordinates;
  laserOn: boolean;
  layer: number;
  phase: string;
}
export interface ProcessFrame extends ProcessPoint {
  q: Coordinates;
  actual: Coordinates;
}

export function createProcess(kind: ProcessKind): ProcessPoint[] {
  const points: ProcessPoint[] = [];
  const append = (x: number, y: number, z: number, laserOn: boolean, layer: number, phase: string, angle = 0, azimuth = 0): void => {
    points.push({ target: aoiTarget(angle, azimuth, [x, y, z]), laserOn, layer, phase });
  };
  const transfer = (x: number, y: number, z: number, layer: number): void => {
    const last = points.at(-1)?.target ?? [0, 0, 0.1, 0, 0];
    for (let i = 1; i <= 5; i++) {
      append(last[0], last[1], last[2] + (0.1 - last[2]) * i / 5, false, layer, '关光抬焦');
      points.at(-1)!.target[3] = last[3] * (1 - i / 5);
      points.at(-1)!.target[4] = last[4] * (1 - i / 5);
    }
    for (let i = 1; i <= 6; i++) append(last[0] + (x - last[0]) * i / 6, last[1] + (y - last[1]) * i / 6, 0.1, false, layer, '关光换位');
    for (let i = 1; i <= 6; i++) append(x, y, 0.1 + (z - 0.1) * i / 6, false, layer, '关光下移焦点');
  };
  for (let layer = 1; layer <= 3; layer++) {
    const z = -layer * PROCESS_DEPTH_MM / 3;
    if (kind === 'spiral') {
      transfer(0, 0, z, layer);
      for (let i = 0; i <= 288; i++) {
        const phase = i / 288 * 6 * 2 * Math.PI;
        const radius = 0.54 * i / 288;
        append(radius * Math.cos(phase), radius * Math.sin(phase), z, true, layer, '向外螺旋清孔', 3 * Math.min(1, radius / 0.12), phase * 180 / Math.PI);
      }
      for (let i = 1; i <= 48; i++) {
        const phase = i / 48 * 2 * Math.PI;
        append(0.54 * Math.cos(phase), 0.54 * Math.sin(phase), z, true, layer, '圆孔外圈精修', 3, phase * 180 / Math.PI);
      }
    } else {
      transfer(-0.54, -0.54, z, layer);
      for (let row = 0; row <= 12; row++) {
        const y = -0.54 + 1.08 * row / 12;
        for (let i = 0; i <= 24; i++) {
          const x = (row % 2 === 0 ? 1 : -1) * (-0.54 + 1.08 * i / 24);
          append(x, y, z, true, layer, '方孔往复填充');
        }
      }
      const corners = [[0.54, 0.54], [-0.54, 0.54], [-0.54, -0.54], [0.54, -0.54], [0.54, 0.54]];
      for (let side = 0; side < 4; side++) for (let i = 1; i <= 24; i++) {
        const start = corners[side], end = corners[side + 1];
        append(start[0] + (end[0] - start[0]) * i / 24, start[1] + (end[1] - start[1]) * i / 24, z, true, layer, `方孔第 ${side + 1} 边精修`);
      }
    }
  }
  const last = points.at(-1)!.target;
  transfer(last[0], last[1], 0.1, 3);
  return points;
}

export function solveProcessPoint(point: ProcessPoint, previous: Coordinates): ProcessFrame {
  const solution = inverse(point.target, previous);
  const result = solution.ok ? evaluate(solution.q, 8) : null;
  if (!solution.ok || !result?.output || result.errors.length) throw new Error(`示例轨迹不可达：${point.phase}`);
  return { ...point, q: solution.q, actual: result.output };
}

export class RemovalPreview {
  readonly size = 128;
  readonly extent = 0.9;
  readonly depth = new Float32Array(this.size * this.size);
  private previous: ProcessFrame | null = null;

  reset(): void { this.depth.fill(0); this.previous = null; }

  apply(frame: ProcessFrame): void {
    if (!frame.laserOn) { this.previous = null; return; }
    const end = frame.actual;
    const start = this.previous?.actual ?? end;
    const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.008));
    for (let i = 0; i <= steps; i++) this.stamp(start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps, Math.max(0, -end[2]));
    this.previous = frame;
  }

  private stamp(x: number, y: number, depth: number): void {
    const pitch = this.extent * 2 / this.size;
    const minX = Math.max(0, Math.floor((x - PROCESS_FOOTPRINT_MM + this.extent) / pitch));
    const maxX = Math.min(this.size - 1, Math.ceil((x + PROCESS_FOOTPRINT_MM + this.extent) / pitch));
    const minY = Math.max(0, Math.floor((y - PROCESS_FOOTPRINT_MM + this.extent) / pitch));
    const maxY = Math.min(this.size - 1, Math.ceil((y + PROCESS_FOOTPRINT_MM + this.extent) / pitch));
    for (let row = minY; row <= maxY; row++) for (let col = minX; col <= maxX; col++) {
      if (Math.hypot((col + 0.5) * pitch - this.extent - x, (row + 0.5) * pitch - this.extent - y) <= PROCESS_FOOTPRINT_MM) {
        const index = row * this.size + col;
        this.depth[index] = Math.max(this.depth[index], Math.min(PROCESS_DEPTH_MM, depth));
      }
    }
  }

  stats(): { removedCells: number; maxDepth: number; areaMm2: number } {
    let removedCells = 0, maxDepth = 0;
    for (const depth of this.depth) { if (depth > 1e-6) removedCells++; maxDepth = Math.max(maxDepth, depth); }
    return { removedCells, maxDepth, areaMm2: removedCells * (this.extent * 2 / this.size) ** 2 };
  }
}
