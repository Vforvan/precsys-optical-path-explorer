/**
 * 控制区与读数面板。
 *
 * 所有数字都来自 AppState 的快照（快照内部是真实光线追迹结果），
 * 控件只负责把用户输入写回状态，不在 UI 里做任何光学计算。
 */

import type { AppMode, AppSnapshot, AppState, AppToggles } from '../app-state';
import type { EngineeringCommand } from '../optics/educational-inverse-model';
import { PROCESS_MODES, TAPER_PRESETS, type ProcessParams } from '../animation/process-modes';
import { OPTICS_VARIANTS, PUBLIC_SPECS_UI } from '../config/ui-text';

export interface ControlsHandlers {
  onPlayToggle(): void;
  onStep(): void;
  onReset(): void;
  onModeChange(mode: AppMode): void;
  onCommandChange(patch: Partial<EngineeringCommand>): void;
  onToggleChange(patch: Partial<AppToggles>): void;
  onProcessChange(patch: Partial<ProcessParams>): void;
  onAxisDemo(axis: AppSnapshot['axisDemo']): void;
  onCameraPreset(preset: CameraPreset): void;
  onVariantChange(key: string): void;
  onCompensationToggle(on: boolean): void;
  /** 引导流程：跳到第 index 步（null = 退出）。 */
  onTourStep(index: number | null): void;
}

export type CameraPreset = 'overview' | 'alpha' | 'z' | 'objective' | 'workpiece';

const MODE_LABELS: { key: AppMode; label: string }[] = [
  { key: 'overview', label: '整机总览' },
  { key: 'axes', label: '五轴拆解' },
  { key: 'linked', label: '硬件联动' },
  { key: 'process', label: '加工演示' },
  { key: 'calibration', label: '校准与监控' },
  { key: 'evidence', label: '结构依据' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

interface SliderHandle {
  input: HTMLInputElement;
  value: HTMLElement;
}

export class Controls {
  private readonly state: AppState;

  private readonly handlers: ControlsHandlers;

  private readonly sliders = new Map<string, SliderHandle>();

  private readonly toggles = new Map<string, HTMLInputElement>();

  private modeButtons = new Map<AppMode, HTMLButtonElement>();

  private readoutCard!: HTMLElement;

  private moduleCard!: HTMLElement;

  private tourBubble!: HTMLElement;

  private processRow!: HTMLElement;

  private axisRow!: HTMLElement;

  private playButton!: HTMLButtonElement;

  private stepButton!: HTMLButtonElement;

  constructor(state: AppState, handlers: ControlsHandlers) {
    this.state = state;
    this.handlers = handlers;
    this.build();
  }

  private build(): void {
    this.buildModeTabs();
    this.buildControlBar();
  }

  private buildModeTabs(): void {
    const tabs = document.getElementById('mode-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    for (const { key, label } of MODE_LABELS) {
      const button = el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': 'false',
        text: label,
        onclick: () => this.handlers.onModeChange(key),
      }) as HTMLButtonElement;
      this.modeButtons.set(key, button);
      tabs.appendChild(button);
    }
  }

  private slider(
    id: string,
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (value: number) => void,
  ): HTMLElement {
    const input = el('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: '0',
      'aria-label': label,
      oninput: (event: Event) => onChange(Number((event.target as HTMLInputElement).value)),
    }) as HTMLInputElement;
    const value = el('b', { text: `0.000 ${unit}` });
    this.sliders.set(id, { input, value });
    return el('div', { class: 'slider-block' }, [
      el('div', { class: 'slider-label' }, [el('span', { text: label }), value]),
      input,
    ]);
  }

  private toggle(id: string, label: string, initial: boolean, onChange: (on: boolean) => void): HTMLElement {
    const input = el('input', {
      type: 'checkbox',
      checked: initial ? 'checked' : undefined,
      onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
    }) as HTMLInputElement;
    this.toggles.set(id, input);
    return el('label', { class: 'toggle' }, [input, label]);
  }

  private buildControlBar(): void {
    const bar = document.getElementById('controlbar');
    if (!bar) return;
    bar.innerHTML = '';

    // ---------- 第 1 行：播放与全局开关 ----------
    this.playButton = el('button', {
      class: 'ctl primary',
      type: 'button',
      text: '▶ 播放',
      onclick: () => this.handlers.onPlayToggle(),
    }) as HTMLButtonElement;

    this.stepButton = el('button', {
      class: 'ctl',
      type: 'button',
      text: '⏭ 单步',
      onclick: () => this.handlers.onStep(),
    }) as HTMLButtonElement;

    const variantSelect = el('select', {
      class: 'ctl',
      'aria-label': '光学版本',
      onchange: (event: Event) =>
        this.handlers.onVariantChange((event.target as HTMLSelectElement).value),
    }) as HTMLSelectElement;
    for (const variant of OPTICS_VARIANTS) {
      variantSelect.appendChild(
        el('option', { value: variant.key, text: variant.label }),
      );
    }

    const row1 = el('div', { class: 'control-row' }, [
      el('div', { class: 'control-group' }, [
        this.playButton,
        this.stepButton,
        el('button', {
          class: 'ctl',
          type: 'button',
          text: '⟲ 重置',
          onclick: () => this.handlers.onReset(),
        }),
      ]),
      el('div', { class: 'control-group' }, [
        el('label', { text: '型号' }),
        variantSelect,
      ]),
      el('div', { class: 'control-group' }, [
        this.slider('theta', '相位 θ', 0, 360, 1, '°', (v) => {
          this.state.theta = (v / 180) * Math.PI;
        }),
        this.slider('slow', '一圈用时', 0.4, 10, 0.1, 's', (v) => {
          this.state.screenRevolutionSeconds = v;
        }),
      ]),
      el('div', { class: 'control-group' }, [
        el('label', { text: '进动/加工' }),
        (() => {
          const select = el('select', {
            class: 'ctl',
            'aria-label': '加工模式',
            onchange: (event: Event) =>
              this.handlers.onProcessChange({
                mode: (event.target as HTMLSelectElement).value as ProcessParams['mode'],
              }),
          }) as HTMLSelectElement;
          for (const mode of PROCESS_MODES) {
            select.appendChild(el('option', { value: mode.key, text: mode.label }));
          }
          select.value = 'precession';
          return select;
        })(),
      ]),
      this.toggle('compensation', '联合补偿', true, (on) => this.handlers.onCompensationToggle(on)),
      this.toggle('play-loop', '循环播放', true, (on) => { this.state.loop = on; }),
    ]);
    bar.appendChild(row1);

    // ---------- 第 2 行：五个工程量 ----------
    const row2 = el('div', { class: 'control-row' }, [
      this.slider('x', 'X 焦点', -2.5, 2.5, 0.01, 'mm', (v) =>
        this.handlers.onCommandChange({ xMm: v }),
      ),
      this.slider('y', 'Y 焦点', -2.5, 2.5, 0.01, 'mm', (v) =>
        this.handlers.onCommandChange({ yMm: v }),
      ),
      this.slider('z', 'Z 焦点', -1, 1, 0.01, 'mm', (v) =>
        this.handlers.onCommandChange({ zMm: v }),
      ),
      this.slider('alpha', 'AOI α', -7.5, 7.5, 0.05, '°', (v) =>
        this.handlers.onCommandChange({ alphaDeg: v }),
      ),
      this.slider('beta', 'AOI β', -7.5, 7.5, 0.05, '°', (v) =>
        this.handlers.onCommandChange({ betaDeg: v }),
      ),
    ]);
    const advanced = el('details', { class: 'advanced-controls' }, [
      el('summary', { text: '精细控制 · 五轴参数 / 视图 / 加工设置' }), row2,
    ]);
    bar.appendChild(advanced);

    // ---------- 第 3 行：单轴演示与视角 ----------
    const axisButtons: { key: AppSnapshot['axisDemo']; label: string }[] = [
      { key: 'none', label: '不演示' },
      { key: 'x', label: 'X 轴' },
      { key: 'y', label: 'Y 轴' },
      { key: 'z', label: 'Z 轴' },
      { key: 'alpha', label: 'α 轴' },
      { key: 'beta', label: 'β 轴' },
    ];
    const axisGroup = el('div', { class: 'control-group' }, [
      el('label', { text: '逐轴演示' }),
      ...axisButtons.map((b) =>
        el('button', {
          class: 'ctl',
          type: 'button',
          text: b.label,
          'data-axis': b.key,
          onclick: () => this.handlers.onAxisDemo(b.key),
        }),
      ),
    ]);
    this.axisRow = axisGroup;

    const presetGroup = el('div', { class: 'control-group' }, [
      el('label', { text: '视角' }),
      ...(
        [
          ['overview', '整机'],
          ['alpha', 'α/β 模块'],
          ['z', 'Z 模块'],
          ['objective', '物镜与振镜'],
          ['workpiece', '工件焦点'],
        ] as [CameraPreset, string][]
      ).map(([key, label]) =>
        el('button', {
          class: 'ctl',
          type: 'button',
          text: label,
          onclick: () => this.handlers.onCameraPreset(key),
        }),
      ),
    ]);

    const toggleGroup = el('div', { class: 'control-group' }, [
      el('label', { text: '显示' }),
      this.toggle('showEnvelope', '光束包络', true, (v) =>
        this.handlers.onToggleChange({ showEnvelope: v }),
      ),
      this.toggle('showCenterRay', '中心光线', true, (v) =>
        this.handlers.onToggleChange({ showCenterRay: v }),
      ),
      this.toggle('showGhost', '零位幽灵光路', true, (v) =>
        this.handlers.onToggleChange({ showGhost: v }),
      ),
      this.toggle('showAxes', '坐标系', true, (v) =>
        this.handlers.onToggleChange({ showAxes: v }),
      ),
      this.toggle('showLabels', '部件标签', true, (v) =>
        this.handlers.onToggleChange({ showLabels: v }),
      ),
      this.toggle('showNormals', '镜面法线', true, (v) =>
        this.handlers.onToggleChange({ showNormals: v }),
      ),
      this.toggle('exploded', '爆炸视图', false, (v) =>
        this.handlers.onToggleChange({ exploded: v }),
      ),
      this.toggle('autoRotate', '自动旋转', false, (v) =>
        this.handlers.onToggleChange({ autoRotate: v }),
      ),
      this.slider('housing', '外壳透明度', 0, 1, 0.02, '', (v) => {
        this.handlers.onToggleChange({ housingOpacity: v });
      }),
    ]);

    bar.insertBefore(presetGroup, advanced);
    advanced.appendChild(el('div', { class: 'control-row' }, [axisGroup, toggleGroup]));

    // ---------- 第 4 行：加工参数（仅加工模式显示） ----------
    this.processRow = el('div', { class: 'control-row' }, [
      this.slider('radius', '进动半径', 0.05, 1.25, 0.01, 'mm', (v) =>
        this.handlers.onProcessChange({ radiusMm: v }),
      ),
      this.slider('pitch', 'Z 螺距', 0, 0.2, 0.005, 'mm/圈', (v) =>
        this.handlers.onProcessChange({ pitchMmPerRev: v }),
      ),
      this.slider('revolutions', '圈数', 1, 40, 1, '圈', (v) =>
        this.handlers.onProcessChange({ revolutions: v }),
      ),
      this.slider('frequency', '工艺频率', 10, 650, 10, 'Hz', (v) =>
        this.handlers.onProcessChange({ frequencyHz: v }),
      ),
      el('div', { class: 'control-group' }, [
        el('label', { text: '孔壁趋势' }),
        (() => {
          const select = el('select', {
            class: 'ctl',
            'aria-label': '孔壁趋势',
            onchange: (event: Event) =>
              this.handlers.onProcessChange({
                taper: (event.target as HTMLSelectElement).value as ProcessParams['taper'],
              }),
          }) as HTMLSelectElement;
          for (const preset of TAPER_PRESETS) {
            select.appendChild(el('option', { value: preset.key, text: preset.label }));
          }
          select.value = 'negative';
          return select;
        })(),
      ]),
    ]);
    advanced.appendChild(this.processRow);

    // 侧栏卡片
    this.moduleCard = document.getElementById('module-card') as HTMLElement;
    this.readoutCard = document.getElementById('readout-card') as HTMLElement;
    this.tourBubble = document.getElementById('tour-bubble') as HTMLElement;
  }

  /** 快照 → 界面。 */
  update(snapshot: AppSnapshot): void {
    document.body.dataset.mode = snapshot.mode;
    for (const [key, input] of this.toggles) {
      input.checked = key === 'play-loop' ? snapshot.loop : Boolean(snapshot.toggles[key as keyof AppToggles]);
    }
    const processSelect = document.querySelector<HTMLSelectElement>('[aria-label="加工模式"]');
    if (processSelect) processSelect.value = snapshot.process.mode;
    const taperSelect = document.querySelector<HTMLSelectElement>('[aria-label="孔壁趋势"]');
    if (taperSelect) taperSelect.value = snapshot.process.taper;
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-selected', String(mode === snapshot.mode));
    }

    const setSlider = (id: string, value: number, digits = 3, unit = '') => {
      const handle = this.sliders.get(id);
      if (!handle) return;
      if (document.activeElement !== handle.input) handle.input.value = String(value);
      handle.value.textContent = `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
    };

    setSlider('x', snapshot.command.xMm, 3, 'mm');
    setSlider('y', snapshot.command.yMm, 3, 'mm');
    setSlider('z', snapshot.command.zMm, 3, 'mm');
    setSlider('alpha', snapshot.command.alphaDeg, 2, '°');
    setSlider('beta', snapshot.command.betaDeg, 2, '°');
    setSlider('theta', (((snapshot.theta * 180) / Math.PI) % 360 + 360) % 360, 0, '°');
    setSlider('slow', snapshot.screenRevolutionSeconds, 1, 's');
    setSlider('radius', snapshot.process.radiusMm, 2, 'mm');
    setSlider('pitch', snapshot.process.pitchMmPerRev, 3, 'mm/圈');
    setSlider('revolutions', snapshot.process.revolutions, 0, '圈');
    setSlider('frequency', snapshot.process.frequencyHz, 0, 'Hz');
    setSlider('housing', snapshot.toggles.housingOpacity, 2, '');

    this.playButton.textContent = snapshot.playing ? '⏸ 暂停' : '▶ 播放';
    this.axisRow.querySelectorAll('button').forEach((button) => {
      const key = button.getAttribute('data-axis');
      button.setAttribute('aria-pressed', String(key === snapshot.axisDemo));
    });
    this.processRow.style.display = snapshot.mode === 'process' ? 'flex' : 'none';

    this.renderModuleCard(snapshot);
    this.renderReadout(snapshot);
  }

  private renderModuleCard(snapshot: AppSnapshot): void {
    const mode = MODE_LABELS.find((m) => m.key === snapshot.mode)?.label ?? '';
    const modeIntro: Record<AppMode, { summary: string; parts: string[] }> = {
      overview: {
        summary:
          '从激光入口到工件的完整光路，加上控制电子学、水冷、吹扫、监测与外围系统。先建立"这套东西在哪、由什么组成"的整体印象。',
        parts: ['激光入口与光束调理', 'α/β 平行移束模块', 'Z 调焦等效模块', '两片振镜', '物镜与工件'],
      },
      axes: {
        summary:
          '逐个执行轴单独演示：拖动或播放任一轴，观察它到底改变了光束的哪一个量。',
        parts: ['X 振镜→焦点 X', 'Y 振镜→焦点 Y', 'Z 模块→焦点 Z', 'α 模块→入射角 α', 'β 模块→入射角 β'],
      },
      linked: {
        summary:
          '五个轴同时工作。关掉联合补偿可以看到真实的耦合误差，打开后五个执行轴一起把目标解到位。',
        parts: ['耦合矩阵', '残差', '五个执行轴'],
      },
      process: {
        summary:
          '冲击、环切、螺旋、五轴进动四种策略对比。进动时焦点绕圆周运动、入射角同步旋转。',
        parts: ['焦点轨迹', '倾斜向量', '孔壁趋势', '慢放倍率'],
      },
      calibration: {
        summary:
          '监测分光元件与光束位置测量单元检测光束状态，Automatic Fine Adjustment 用五轴做小量补偿。',
        parts: ['分光元件', '光束位置测量单元', '补偿前后的入瞳偏心'],
      },
      evidence: {
        summary: '把页面里每一条信息的来源、可信等级和已知的未知项列出来。',
        parts: ['公开确认', '专利原理', '教学等效', '未公开结构'],
      },
    };
    const intro = modeIntro[snapshot.mode];

    this.moduleCard.innerHTML = `
      <h2>${mode}</h2>
      <p>${intro.summary}</p>
      <h3>本模式关注</h3>
      <p class="dim">${intro.parts.join(' · ')}</p>
      <h3>固定说明</h3>
      <p class="dim">${PUBLIC_SPECS_UI.disclaimer}</p>
    `;
  }

  private renderReadout(snapshot: AppSnapshot): void {
    const { command, achieved, residual, actuators, trace, inverse } = snapshot;
    const pupil = trace.pupil;
    const fmt = (v: number, digits = 3) => v.toFixed(digits);
    const err = (v: number) => Math.abs(v) > 0.02;

    const actuatorRows = `
      <dt>q₁ X 振镜</dt><dd>${fmt((actuators.xRad * 180) / Math.PI, 3)} °</dd>
      <dt>q₂ Y 振镜</dt><dd>${fmt((actuators.yRad * 180) / Math.PI, 3)} °</dd>
      <dt>q₃ Z 执行器</dt><dd>${fmt(actuators.zDeg, 3)} °</dd>
      <dt>q₄ α 可动镜</dt><dd>${fmt((actuators.alphaRad * 180) / Math.PI, 3)} °</dd>
      <dt>q₅ β 可动镜</dt><dd>${fmt((actuators.betaRad * 180) / Math.PI, 3)} °</dd>
    `;

    const matrix =
      snapshot.mode === 'linked' || snapshot.mode === 'axes'
        ? this.renderCouplingMatrix(snapshot)
        : '';

    this.readoutCard.innerHTML = `
      <h2>工程量 / 执行器量</h2>
      <dl class="kv">
        <dt>设定 X / Y / Z</dt><dd>${fmt(command.xMm, 3)} / ${fmt(command.yMm, 3)} / ${fmt(command.zMm, 3)} mm</dd>
        <dt>设定 AOI α / β</dt><dd>${fmt(command.alphaDeg, 2)} / ${fmt(command.betaDeg, 2)} °</dd>
        <dt>实际 X / Y / Z</dt><dd class="${err(residual.xMm) || err(residual.yMm) || err(residual.zMm) ? 'warn' : 'good'}">${fmt(achieved.xMm, 3)} / ${fmt(achieved.yMm, 3)} / ${fmt(achieved.zMm, 3)} mm</dd>
        <dt>实际 AOI α / β</dt><dd class="${err(residual.alphaDeg) || err(residual.betaDeg) ? 'warn' : 'good'}">${fmt(achieved.alphaDeg, 2)} / ${fmt(achieved.betaDeg, 2)} °</dd>
        <dt>残差（实际−设定）</dt><dd class="${err(residual.xMm) || err(residual.alphaDeg) ? 'warn' : 'good'}">(${fmt(residual.xMm, 3)}, ${fmt(residual.yMm, 3)}, ${fmt(residual.zMm, 3)}, ${fmt(residual.alphaDeg, 2)}, ${fmt(residual.betaDeg, 2)})</dd>
      </dl>
      <h3>五个执行轴</h3>
      <dl class="kv">${actuatorRows}</dl>
      <h3>物镜入瞳状态</h3>
      <dl class="kv">
        <dt>入瞳偏心 h</dt><dd>(${fmt(pupil.hxMm, 3)}, ${fmt(pupil.hyMm, 3)}) mm</dd>
        <dt>入瞳坡度 u / v</dt><dd>${fmt(pupil.u, 5)} / ${fmt(pupil.v, 5)}</dd>
        <dt>光束半径</dt><dd>${fmt(pupil.radiusMm, 3)} mm</dd>
        <dt>会聚度</dt><dd>${pupil.vergence.toExponential(2)} /mm</dd>
        <dt>光锥全角</dt><dd>${fmt(trace.focus.coneHalfAngleRad * 2, 4)} rad</dd>
        <dt>求解方式</dt><dd>${inverse.compensated ? `联合补偿（${inverse.iterations} 次迭代）` : '一轴对应一坐标'}</dd>
        ${inverse.saturated ? '<dt>行程</dt><dd class="warn">有执行轴到限位</dd>' : ''}
      </dl>
      ${matrix}
      <h3>视觉放大说明</h3>
      <p class="dim">三维光路与镜片共用同一坐标；侧栏局部图放大焦点运动与倾角。Z 模块使用平面反射与等效光焦度表示，不将曲面放大变形当作实机结构。</p>
      <p class="dim">${PUBLIC_SPECS_UI.inverseNote}</p>
    `;
  }

  private renderCouplingMatrix(snapshot: AppSnapshot): string {
    const j = snapshot.inverse.coupling;
    if (!j) return '';
    const header = ['', 'X', 'Y', 'Z', 'α', 'β']
      .map((h) => `<th>${h}</th>`)
      .join('');
    const rows = j
      .map((row, i) => {
        const cells = row
          .map(
            (value, k) =>
              `<td class="${i === k ? 'diag' : ''}">${value === 0 ? '0' : value.toFixed(2)}</td>`,
          )
          .join('');
        return `<tr><th>${['q₁', 'q₂', 'q₃', 'q₄', 'q₅'][i]}</th>${cells}</tr>`;
      })
      .join('');
    return `
      <h3>耦合矩阵（归一化）</h3>
      <table class="matrix"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>
      <p class="dim">对角线为各执行轴对自身工程量的灵敏度（归一为 1）；非对角线就是"一轴对应一坐标"会漏掉的耦合项。数值由本模型有限差分求得，不是 SCANLAB 的真实标定数据。</p>
    `;
  }

  /** 引导流程气泡。 */
  renderTour(
    stepIndex: number | null,
    total: number,
    step: { title: string; lines: string[] } | null,
  ): void {
    if (stepIndex === null || !step) {
      this.tourBubble.hidden = true;
      this.tourBubble.innerHTML = '';
      return;
    }
    this.tourBubble.hidden = false;
    this.tourBubble.innerHTML = '';
    this.tourBubble.appendChild(el('h3', { text: step.title }));
    const list = el('ul');
    for (const line of step.lines) list.appendChild(el('li', { text: line }));
    this.tourBubble.appendChild(list);
    const actions = el('div', { class: 'tour-actions' }, [
      el('button', {
        class: 'ctl',
        type: 'button',
        text: '上一步',
        onclick: () => this.handlers.onTourStep(Math.max(0, stepIndex - 1)),
      }),
      el('button', {
        class: 'ctl primary',
        type: 'button',
        text: stepIndex + 1 >= total ? '结束' : '下一步 →',
        onclick: () =>
          this.handlers.onTourStep(stepIndex + 1 >= total ? null : stepIndex + 1),
      }),
      el('button', {
        class: 'ctl',
        type: 'button',
        text: '退出',
        onclick: () => this.handlers.onTourStep(null),
      }),
    ]);
    this.tourBubble.appendChild(actions);
  }

  setPlayState(playing: boolean): void {
    this.playButton.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  }
}
