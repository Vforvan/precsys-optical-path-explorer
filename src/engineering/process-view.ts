import type { Coordinates } from './model';
import { createProcess, RemovalPreview, solveProcessPoint, type ProcessFrame, type ProcessKind } from './process';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class ProcessPlayer {
  private kind: ProcessKind | null = null;
  private frames: ProcessFrame[] = [];
  private index = -1;
  private running = false;
  private preparing = false;
  private generation = 0;
  private lastTime = 0;
  private removal = new RemovalPreview();
  private bitmap = document.createElement('canvas');

  constructor(private readonly takeControl: () => void, private readonly applyPose: (q: Coordinates) => boolean) {
    this.bitmap.width = this.removal.size; this.bitmap.height = this.removal.size;
    for (const kind of ['spiral', 'square'] as const) $(`process-${kind}`).onclick = () => { void this.start(kind); };
    $('process-play').onclick = () => {
      if (!this.kind || this.preparing) return;
      if (this.index >= this.frames.length - 1) { void this.start(this.kind); return; }
      const start = !this.running; this.takeControl(); this.running = start; this.lastTime = performance.now(); this.refresh();
    };
    $('process-restart').onclick = () => { if (this.kind) void this.start(this.kind); };
    $<HTMLInputElement>('process-progress').oninput = event => { this.pause(); this.seek(Number((event.target as HTMLInputElement).value)); };
    this.refresh(); this.draw();
  }

  pause(): void {
    this.running = false;
    if (this.preparing) { this.generation++; this.preparing = false; $('process-status').textContent = '预求解已取消，可重新选择示例'; }
    this.refresh();
  }

  async start(kind: ProcessKind): Promise<void> {
    this.takeControl();
    const token = ++this.generation;
    const cached = this.kind === kind && this.frames.length > 0;
    this.kind = kind; this.index = -1; this.removal.reset(); this.running = false;
    $('process-inset-box').hidden = false;
    $('process-inset-title').textContent = kind === 'spiral' ? '螺旋钻孔 · 局部放大' : '正方形孔 · 局部放大';
    $('process-title').textContent = kind === 'spiral' ? '螺旋钻孔 · 分层向外清孔' : '正方形孔 · 填充与轮廓精修';
    $('process-description').textContent = kind === 'spiral'
      ? '每层 6 圈向外螺旋，再精修外圈；共 3 层，示意深度 0.30 mm。总 AOI 从中心渐增至 3°，α/β 随方位变化。'
      : '每层 13 行往复填充，再精修四边；共 3 层，示意深度 0.30 mm。保持 α=β=0°，靠多电机联动保持垂直入射。';
    document.querySelectorAll<HTMLButtonElement>('[data-process]').forEach(button => button.classList.toggle('active', button.dataset.process === kind));
    if (!cached) {
      this.frames = []; this.preparing = true; this.refresh(); this.draw();
      const program = createProcess(kind);
      const compiled: ProcessFrame[] = [];
      let previous: Coordinates = [0, 0, 0, 0, 0];
      try {
        for (let i = 0; i < program.length; i++) {
          if (token !== this.generation) return;
          const frame = solveProcessPoint(program[i], previous); compiled.push(frame); previous = frame.q;
          if (i % 40 === 0) {
            $('process-status').textContent = `五轴预求解 ${Math.round(i / program.length * 100)}%`;
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      } catch (error) {
        if (token === this.generation) { this.preparing = false; this.running = false; this.refresh(); $('process-status').textContent = String(error); }
        return;
      }
      if (token !== this.generation) return;
      this.frames = compiled; this.preparing = false;
    }
    if (token !== this.generation) return;
    this.seek(0); this.running = this.index === 0; this.lastTime = performance.now(); this.refresh();
  }

  seek(progress: number): void {
    if (!this.frames.length || this.preparing) return;
    this.takeControl();
    const index = Math.max(0, Math.min(this.frames.length - 1, Math.round(progress * (this.frames.length - 1))));
    if (!this.applyPose(this.frames[index].q)) { $('process-status').textContent = '当前姿态校验失败，示例已暂停'; return; }
    this.removal.reset();
    for (let i = 0; i <= index; i++) this.removal.apply(this.frames[i]);
    this.index = index; this.refresh(); this.draw();
  }

  tick(time: number): void {
    if (!this.running || this.preparing || !this.frames.length || time - this.lastTime < 160) return;
    const count = Math.max(1, Math.min(24, Math.floor((time - this.lastTime) * this.frames.length / 30000)));
    this.lastTime = time;
    const end = Math.min(this.frames.length - 1, this.index + count);
    if (!this.applyPose(this.frames[end].q)) { this.running = false; this.refresh(); $('process-status').textContent = '当前姿态校验失败，示例已暂停'; return; }
    for (let i = this.index + 1; i <= end; i++) this.removal.apply(this.frames[i]);
    this.index = end; if (end === this.frames.length - 1) this.running = false;
    this.refresh(); this.draw();
  }

  state(): Record<string, unknown> {
    return { kind: this.kind, running: this.running, preparing: this.preparing, index: this.index, frameCount: this.frames.length, frame: this.frames[this.index] ?? null, removal: this.removal.stats() };
  }

  private refresh(): void {
    const ready = this.frames.length > 0 && !this.preparing;
    $<HTMLButtonElement>('process-play').disabled = !ready;
    $<HTMLButtonElement>('process-restart').disabled = !this.kind || this.preparing;
    $<HTMLInputElement>('process-progress').disabled = !ready;
    $('process-play').textContent = this.running ? 'Ⅱ 暂停' : this.index === this.frames.length - 1 && ready ? '↻ 再加工' : '▶ 继续';
    const progress = ready ? Math.max(0, this.index) / (this.frames.length - 1) : 0;
    $<HTMLInputElement>('process-progress').value = String(progress);
    $('process-percent').textContent = `${(progress * 100).toFixed(0)}%`;
    const frame = this.frames[this.index];
    if (frame) $('process-status').textContent = this.index === this.frames.length - 1
      ? '示例完成 · 已关光并抬焦 · 几何去除结果保留'
      : `第 ${frame.layer}/3 层 · ${frame.phase} · ${frame.laserOn ? '激光开' : '激光关'}${this.running ? '' : ' · 暂停'}`;
    $('process-depth').textContent = `${this.removal.stats().maxDepth.toFixed(2)} mm`;
  }

  private draw(): void {
    const canvas = $<HTMLCanvasElement>('process-canvas');
    const ctx = canvas.getContext('2d')!;
    const bitmapContext = this.bitmap.getContext('2d')!;
    const size = this.removal.size;
    const image = bitmapContext.createImageData(size, size);
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const depth = this.removal.depth[row * size + col];
      const offset = ((size - 1 - row) * size + col) * 4;
      const rgb = depth > 0.25 ? [12, 27, 38] : depth > 0.15 ? [60, 93, 105] : depth > 0.01 ? [127, 137, 126] : [47, 66, 85];
      image.data.set([...rgb, 255], offset);
    }
    bitmapContext.putImageData(image, 0, 0);
    ctx.fillStyle = '#0d1925'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const left = 40, top = 36, width = 300;
    const px = (x: number) => left + width * (x + this.removal.extent) / (2 * this.removal.extent);
    const py = (y: number) => top + width * (this.removal.extent - y) / (2 * this.removal.extent);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(this.bitmap, left, top, width, width);
    ctx.lineWidth = 1; ctx.strokeStyle = '#7b9bb455'; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(left, py(0)); ctx.lineTo(left + width, py(0)); ctx.moveTo(px(0), top); ctx.lineTo(px(0), top + width); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = '#4faab777'; ctx.lineWidth = 1;
    if (this.kind) {
      ctx.beginPath();
      if (this.kind === 'spiral') ctx.arc(px(0), py(0), 0.6 * width / 1.8, 0, Math.PI * 2);
      else ctx.rect(px(-0.6), py(0.6), 1.2 * width / 1.8, 1.2 * width / 1.8);
      ctx.stroke();
    }
    const frame = this.frames[this.index];
    if (frame) {
      ctx.fillStyle = frame.laserOn ? '#ffd697' : '#70dfdd'; ctx.beginPath(); ctx.arc(px(frame.actual[0]), py(frame.actual[1]), 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffa785'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px(frame.actual[0]), py(frame.actual[1]));
      ctx.lineTo(px(frame.actual[0]) + Math.tan(frame.actual[3] * Math.PI / 180) * 400, py(frame.actual[1]) - Math.tan(frame.actual[4] * Math.PI / 180) * 400); ctx.stroke();
    }
    ctx.font = '13px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#afc8d9';
    ctx.fillText('XY 俯视 · 橙点为开光，青点为关光', 40, 21);
    ctx.fillText('+Y', px(0) + 7, top + 15); ctx.fillText('+X', left + width - 25, py(0) - 9);
    ctx.fillText('−0.9', left - 10, top + width + 20); ctx.fillText('+0.9 mm', left + width - 46, top + width + 20);
    ctx.fillStyle = '#7895aa'; ctx.fillText('橙短线：倾斜方位示意', 375, 56);
    ctx.fillText('层深 0.10 / 0.20 / 0.30 mm', 375, 83);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#7f897e', '#3c5d69', '#0c1b26'][i]; ctx.fillRect(375, 111 + 39 * i, 24, 23); ctx.fillStyle = '#91adbf'; ctx.fillText(`去除至 ${(i + 1) / 10} mm`, 411, 128 + 39 * i); }
    ctx.fillStyle = '#7895aa'; ctx.fillText('孔径 / 边长约 1.20 mm', 375, 263);
    ctx.fillText('几何作用半径 0.06 mm', 375, 291); ctx.fillText('不是实际焦斑或烧蚀预测', 375, 319);
    ctx.fillStyle = '#314357'; ctx.fillRect(left, 390, width, 46);
    for (let col = 0; col < size; col++) {
      const depth = this.removal.depth[Math.floor(size / 2) * size + col];
      ctx.fillStyle = '#0d1925'; ctx.fillRect(left + width * col / size, 390, width / size + 0.5, depth / 0.3 * 42);
    }
    ctx.fillStyle = '#89a9bc'; ctx.fillText('Y = 0 截面 · 深度单独放大', 40, 380); ctx.fillText('0.30 mm', 375, 422);
    const inset = $<HTMLCanvasElement>('process-inset');
    inset.getContext('2d')!.drawImage(canvas, 20, 0, 340, 362, 0, 0, inset.width, inset.height);
  }
}
