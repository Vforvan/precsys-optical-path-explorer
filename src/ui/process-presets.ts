import type { AppSnapshot } from '../app-state';
import { DEFAULT_PROCESS, type ProcessParams } from '../animation/process-modes';

export const PROCESS_PRESETS = [
  { id: 'percussion', name: '定点冲击', detail: 'XY 定位 · Z 分层进给', params: { mode: 'percussion', radiusMm: 0.12, tiltAmplitudeDeg: 0, taper: 'straight', pitchMmPerRev: 0.1 } },
  { id: 'trepann', name: '圆周环切', detail: 'XY 画圆 · 保持垂直入射', params: { mode: 'trepann', radiusMm: 0.6, tiltAmplitudeDeg: 0, taper: 'straight', pitchMmPerRev: 0.06 } },
  { id: 'spiral', name: '螺旋扩孔', detail: '半径渐增 · Z 同步下移', params: { mode: 'spiral', radiusMm: 0.8, tiltAmplitudeDeg: 0, taper: 'straight', pitchMmPerRev: 0.08 } },
  { id: 'precession-in', name: '向内进动', detail: '五轴联动 · 倾角指向孔轴', params: { mode: 'precession', radiusMm: 0.5, tiltAmplitudeDeg: 5, taper: 'positive', pitchMmPerRev: 0.08 } },
  { id: 'precession-out', name: '向外进动', detail: '五轴联动 · 倾角向外旋转', params: { mode: 'precession', radiusMm: 0.5, tiltAmplitudeDeg: 5, taper: 'negative', pitchMmPerRev: 0.08 } },
] satisfies { id: string; name: string; detail: string; params: Partial<ProcessParams> }[];

export function presetParameters(id: string): ProcessParams | null {
  const preset = PROCESS_PRESETS.find((p) => p.id === id);
  return preset ? { ...DEFAULT_PROCESS, revolutions: 8, frequencyHz: 100, ...preset.params } : null;
}

export class ProcessPresets {
  private root: HTMLElement;
  private active = '';
  private progress: HTMLProgressElement;
  private status: HTMLElement;
  private axes: HTMLElement;
  private focus: SVGElement;
  private direction: SVGElement;
  private contour: SVGElement;
  private sectionBeam: SVGElement;
  private sectionFocus: SVGElement;

  constructor(onSelect: (id: string) => void) {
    this.root = document.getElementById('process-presets')!;
    this.root.innerHTML = `
      <div class="section-eyebrow">PROCESS LIBRARY / 加工库</div>
      <h2>选择工艺，观察整机联动</h2>
      <p class="preset-intro">点击即从起点播放。主视图观察光路，局部图跟随实际计算的焦点。</p>
      <div class="preset-grid">${PROCESS_PRESETS.map((p, i) => `
        <button type="button" class="preset" data-preset="${p.id}" aria-pressed="false">
          <span class="preset-number">0${i + 1}</span><span><strong>${p.name}</strong><small>${p.detail}</small></span>
        </button>`).join('')}</div>
      <div class="process-status" aria-live="polite">待选择加工演示</div>
      <progress max="1" value="0" aria-label="加工进度"></progress>
      <div class="axis-live" aria-label="执行轴实时角度"></div>
      <svg class="process-detail" viewBox="0 0 360 150" role="img" aria-label="焦点轨迹俯视和入射光束剖面局部放大图">
        <text x="12" y="18">焦点俯视 · mm</text><text x="202" y="18">光束剖面 · XZ</text>
        <path d="M22 85H154 M88 28V142 M202 65H348" class="detail-grid"/>
        <path id="preset-contour" class="detail-contour"/>
        <line id="preset-direction" class="detail-beam"/><circle id="preset-focus" r="4" class="detail-focus"/>
        <path d="M206 69V140H344V69" class="detail-material"/>
        <line id="preset-section-beam" class="detail-beam"/><circle id="preset-section-focus" r="4" class="detail-focus"/>
        <text x="208" y="148">深度与倾角放大示意</text>
      </svg>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
      button.onclick = () => { this.active = button.dataset.preset!; onSelect(this.active); };
    });
    this.progress = this.root.querySelector('progress')!;
    this.status = this.root.querySelector('.process-status')!;
    this.axes = this.root.querySelector('.axis-live')!;
    this.axes.innerHTML = ['X', 'Y', 'Z', 'α', 'β'].map((axis) =>
      `<div><span>${axis}</span><i><b></b></i><output>0°</output></div>`).join('');
    this.focus = this.root.querySelector('#preset-focus')!;
    this.direction = this.root.querySelector('#preset-direction')!;
    this.contour = this.root.querySelector('#preset-contour')!;
    this.sectionBeam = this.root.querySelector('#preset-section-beam')!;
    this.sectionFocus = this.root.querySelector('#preset-section-focus')!;
  }

  update(s: AppSnapshot): void {
    const preset = PROCESS_PRESETS.find((p) => p.id === this.active);
    const matches = s.mode === 'process' && preset && Object.entries(preset.params)
      .every(([key, value]) => s.process[key as keyof ProcessParams] === value);
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Boolean(matches) && b.dataset.preset === this.active)));
    const fraction = Math.min(1, s.theta / (s.process.revolutions * Math.PI * 2));
    this.progress.value = s.mode === 'process' ? fraction : 0;
    this.status.textContent = s.mode === 'process'
      ? `${s.playing ? '● 演示中' : fraction >= 1 ? '✓ 已完成' : 'Ⅱ 已暂停'} · ${matches ? preset.name : '自定义加工'} · ${(fraction * 100).toFixed(0)}%`
      : '选择上方工艺，开始整机联动';
    const values = [s.actuators.xRad * 180 / Math.PI, s.actuators.yRad * 180 / Math.PI,
      s.actuators.zDeg, s.actuators.alphaRad * 180 / Math.PI, s.actuators.betaRad * 180 / Math.PI];
    Array.from(this.axes.children).forEach((node, i) => {
      node.querySelector('output')!.textContent = `${values[i].toFixed(2)}°`;
      const bar = node.querySelector('b') as HTMLElement;
      bar.style.width = `${Math.min(50, Math.abs(values[i]) / 3.5 * 50)}%`;
      bar.style.left = values[i] < 0 ? 'auto' : '50%';
      bar.style.right = values[i] < 0 ? '50%' : 'auto';
    });
    const set = (el: SVGElement, attrs: Record<string, number | string>) => {
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    };
    const scale = 56 / Math.max(0.8, s.process.radiusMm);
    const x = 88 + (s.achieved.xMm - s.process.centerXMm) * scale;
    const y = 85 - (s.achieved.yMm - s.process.centerYMm) * scale;
    set(this.focus, { cx: x, cy: y });
    set(this.direction, { x1: x, y1: y, x2: x + s.achieved.alphaDeg * 4, y2: y - s.achieved.betaDeg * 4 });
    const points = Array.from({ length: 161 }, (_, i) => {
      const theta = i / 160 * Math.PI * 2 * (s.process.mode === 'spiral' ? 4 : 1);
      const radius = s.process.mode === 'percussion' ? 0 : s.process.radiusMm * scale * (s.process.mode === 'spiral' ? i / 160 : 1);
      return `${i ? 'L' : 'M'}${88 + radius * Math.cos(theta)},${85 - radius * Math.sin(theta)}`;
    });
    set(this.contour, { d: points.join(' ') });
    const sx = 275 + s.achieved.xMm * 25;
    const sy = 65 - s.achieved.zMm * 60;
    set(this.sectionFocus, { cx: sx, cy: sy });
    set(this.sectionBeam, { x1: sx - Math.tan(s.achieved.alphaDeg * Math.PI / 180) * 350,
      y1: 30, x2: sx, y2: sy });
  }
}
