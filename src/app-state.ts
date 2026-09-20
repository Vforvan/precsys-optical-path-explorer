/**
 * 应用状态：把"用户命令 → 五个执行轴 → 光线追迹 → 画面"这条链路集中在一处。
 *
 * 关键点（计划书 §10.5）：
 *   页面内部同时保留"五个工程量"与"五个执行轴"两层状态，
 *   两者之间由逆映射连接；补偿开关决定是用"一轴对应一坐标"的教科书解，还是用联合求解。
 *
 * 【两条技术路线】2026 增补：
 *   同一个 AppState 现在可以在 SCANLAB precSYS 与 Novanta / ARGES 之间切换。
 *   切换的是**整条光学链路与执行器语义**，不是同一套镜片的换皮：
 *     - SCANLAB：反射式平行移束（三镜四反射）+ 反射式 Z 等效模块 + 两片振镜；
 *     - Novanta ：两块**透射式**平行平板（折射移束）+ Galilei 望远镜动态调焦 + scanblock。
 *   两条路线各有自己的 trace / 逆解 / 场景，共享的是：
 *     · 五个工程量 (X, Y, Z, α, β) 的语义与限值口径；
 *     · InverseTrainAdapter 形式的求解器；
 *     · 场景与界面层的调用方式。
 *   为了不把两套类型搅在一起，快照里的 trace / actuators 用**受标签联合**表示，
 *   使用前必须按 `vendor` 收窄 —— 这样任何一处漏判都会被 TypeScript 拦下来。
 */

import { Vector3 } from 'three';
import {
  DEFAULT_CONDITIONING,
  ZERO_ACTUATORS,
  createOpticalTrain,
  traceTrain,
  type ActuatorState,
  type ConditioningState,
  type OpticalTrain,
  type TrainTrace,
} from './optics/optical-train';
import {
  NOVANTA_DEFAULT_CONDITIONING,
  NOVANTA_ZERO_ACTUATORS,
  createNovantaTrain,
  traceNovantaTrain,
  type NovantaActuatorState,
  type NovantaConditioningState,
  type NovantaOpticalTrain,
  type NovantaTrainTrace,
} from './optics/novanta-optical-train';
import {
  ZERO_COMMAND,
  educationalInverseModel,
  educationalInverseModelNovanta,
  naiveInverse,
  naiveInverseNovanta,
  novantaAdapter,
  scanlabAdapter,
  buildJacobianWith,
  normalizedFromJacobian,
  type EngineeringCommand,
  type InverseResult,
} from './optics/educational-inverse-model';
import { OPTICS_VARIANTS, type OpticsVariant } from './config/public-specs';
import {
  DEFAULT_PROCESS,
  commandAtTheta,
  type ProcessParams,
} from './animation/process-modes';
import { SOFTWARE_LIMITS } from './config/public-specs';

export type AppMode =
  | 'overview'
  | 'axes'
  | 'linked'
  | 'process'
  | 'calibration'
  | 'evidence';

/** 技术路线（厂商 / 架构）。 */
export type Vendor = 'scanlab' | 'novanta';

export const VENDORS: { key: Vendor; label: string; sub: string }[] = [
  {
    key: 'scanlab',
    label: 'SCANLAB precSYS',
    sub: '反射式平行移束 · 三镜四反射',
  },
  {
    key: 'novanta',
    label: 'Novanta / ARGES',
    sub: '基于公开专利的平行平板进动架构',
  },
];

/** 快照里按路线收窄后的追迹结果。 */
export type AnyTrainTrace =
  | { vendor: 'scanlab'; trace: TrainTrace }
  | { vendor: 'novanta'; trace: NovantaTrainTrace };

/** 快照里按路线收窄后的执行器。 */
export type AnyActuators =
  | { vendor: 'scanlab'; actuators: ActuatorState }
  | { vendor: 'novanta'; actuators: NovantaActuatorState };

/**
 * 取出快照中"两条路线共有"的那部分追迹结果 —— **只读不改**。
 *
 * 联合里的 trace 是两种不同结构（各自有自己的 ok/segments/pupil/focus/...）。
 * 因此这里**不再做转换**，而是返回原对象并声明成"共有字段都在"的接口：
 * 调用方读这些字段时的类型是准确的，也不会因为某条路线缺字段而崩。
 *
 * 如果哪天两条路线真的需要不同的字段，正确做法是**按 vendor 收窄**后再取，
 * 而不是往这个接口里加可选字段。
 */
export interface CommonTrace {
  ok: boolean;
  note: string;
  segments: readonly { from: Vector3; to: Vector3; radiusFrom: number; radiusTo: number }[];
  chiefPoints: readonly Vector3[];
  hits: readonly { mirrorId: string; label: string; point: Vector3; normal: Vector3; incidenceRad: number }[];
  pupil: {
    hxMm: number;
    hyMm: number;
    u: number;
    v: number;
    radiusMm: number;
    vergence: number;
  };
  focus: {
    xMm: number;
    yMm: number;
    zMm: number;
    aoiXDeg: number;
    aoiYDeg: number;
  };
  focusPoint: Vector3;
}

/** 取通用追迹视图（两条路线共有字段）。 */
export function commonTrace(trace: AnyTrainTrace): CommonTrace {
  return trace.trace as unknown as CommonTrace;
}

/** 面板读数用的统一量纲执行器（角度用度）。 */
export interface ActuatorReadout {
  /** 五个执行轴的显示名（与路线相关）。 */
  labels: [string, string, string, string, string];
  /** 五个执行轴的数值（度 / mm）。 */
  values: [number, number, number, number, number];
  /** 各自单位。 */
  units: [string, string, string, string, string];
}

export interface AppToggles {
  /** 外壳透明度 0–1。 */
  housingOpacity: number;
  showEnvelope: boolean;
  showCenterRay: boolean;
  showGhost: boolean;
  showAxes: boolean;
  showLabels: boolean;
  /** 显示每个反射点的镜面法线（垂线）与镜面切向。 */
  showNormals: boolean;
  /**
   * 显示执行器/驱动外形与它们的读数标签。
   * 电机壳体在特写下会挡住所看的镜片/平板，因此给一个总开关。
   */
  showMotors: boolean;
  exploded: boolean;
  autoRotate: boolean;
  /** 联合补偿开关。 */
  compensation: boolean;
  /** Novanta 模式：显示平板位移轨迹（Top View 里的整圈历史）。 */
  showOffsetTrajectory: boolean;
}

export interface AppSnapshot {
  mode: AppMode;
  /** 当前技术路线。 */
  vendor: Vendor;
  variant: OpticsVariant;
  command: EngineeringCommand;
  achieved: EngineeringCommand;
  residual: EngineeringCommand;
  actuators: AnyActuators;
  trace: AnyTrainTrace;
  ghostTrace: AnyTrainTrace;
  inverse: InverseResult;
  /** 读数面板用的执行器统一量纲视图。 */
  actuatorReadout: ActuatorReadout;
  toggles: AppToggles;
  selectedPartId: string | null;
  playing: boolean;
  theta: number;
  /** 屏幕上一圈的秒数（慢放用）。 */
  screenRevolutionSeconds: number;
  process: ProcessParams;
  tourStep: number | null;
  /** 单轴演示的当前轴。 */
  axisDemo: 'none' | 'x' | 'y' | 'z' | 'alpha' | 'beta';
  conditioning: ConditioningState;
  fps: number;
  loop: boolean;
}

export const DEFAULT_TOGGLES: AppToggles = {
  housingOpacity: 0.12,
  showEnvelope: true,
  showCenterRay: true,
  showGhost: false,
  showAxes: true,
  showLabels: false,
  showNormals: false,
  showMotors: true,
  exploded: false,
  autoRotate: false,
  compensation: true,
  showOffsetTrajectory: true,
};

/** 由执行器对象取出面板读数（两条路线各自的字段名在这里收口）。 */
function readoutOf(actuators: AnyActuators): ActuatorReadout {
  const deg = 180 / Math.PI;
  if (actuators.vendor === 'novanta') {
    const a = actuators.actuators;
    return {
      labels: [
        'X 振镜（scanblock 下游）',
        'Y 振镜（scanblock 上游）',
        'Z 执行器（望远镜镜组）',
        '平板 A 机械倾角',
        '平板 B 机械倾角',
      ],
      values: [a.xGalvoRad * deg, a.yGalvoRad * deg, a.telescopeTravelMm, a.plateARad * deg, a.plateBRad * deg],
      units: ['°', '°', 'mm', '°', '°'],
    };
  }
  const a = actuators.actuators;
  return {
    labels: ['X 振镜', 'Y 振镜', 'Z 执行器', 'α 可动镜', 'β 可动镜'],
    values: [a.xRad * deg, a.yRad * deg, a.zTravelMm, a.alphaRad * deg, a.betaRad * deg],
    units: ['°', '°', 'mm', '°', '°'],
  };
}

export class AppState {
  mode: AppMode = 'overview';

  /** 当前技术路线。 */
  vendor: Vendor = 'scanlab';

  variant: OpticsVariant = OPTICS_VARIANTS[0];

  // ---------------- 两条路线各自的链路对象（互不影响） ----------------
  scanlabTrain: OpticalTrain = createOpticalTrain(this.variant);

  novantaTrain: NovantaOpticalTrain = createNovantaTrain(this.variant);

  command: EngineeringCommand = { ...ZERO_COMMAND };

  toggles: AppToggles = { ...DEFAULT_TOGGLES };

  selectedPartId: string | null = null;

  playing = false;

  theta = 0;

  screenRevolutionSeconds = 3.2;

  process: ProcessParams = { ...DEFAULT_PROCESS };

  tourStep: number | null = null;

  axisDemo: AppSnapshot['axisDemo'] = 'none';

  conditioning: ConditioningState = { ...DEFAULT_CONDITIONING };

  novantaConditioning: NovantaConditioningState = { ...NOVANTA_DEFAULT_CONDITIONING };

  fps = 0;
  loop = true;
  processSpan: { from: number; to: number } | null = null;

  private listeners = new Set<(snapshot: AppSnapshot) => void>();

  private cache: AppSnapshot | null = null;

  /** 上一帧执行轴（热启动用），按路线分开保存。 */
  private lastScanlabActuators: ActuatorState = { ...ZERO_ACTUATORS };

  private lastNovantaActuators: NovantaActuatorState = { ...NOVANTA_ZERO_ACTUATORS };

  /** 当前路线的链路对象（供场景与部件信息卡取用）。 */
  get train(): OpticalTrain {
    return this.scanlabTrain;
  }

  onChange(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.cache = null;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  snapshot(): AppSnapshot {
    if (this.cache) return this.cache;
    const warm = this.playing;
    if (this.vendor === 'novanta') {
      const inverse = this.toggles.compensation
        ? educationalInverseModelNovanta(
            this.novantaTrain,
            this.command,
            this.novantaConditioning,
            // Novanta 的 Z 通道灵敏度极高（约 0.17 mm 焦点/mm 行程，且本身是 1/(a+bv) 型非线性），
            // 4 次牛顿迭代偶有超调把执行器顶到端点，因此给这条路线多留几次迭代。
            6,
            warm ? this.lastNovantaActuators : undefined,
          )
        : naiveInverseNovanta(this.novantaTrain, this.command, this.novantaConditioning);
      const actuators = inverse.actuators as NovantaActuatorState;
      this.lastNovantaActuators = actuators;
      this.cache = this.buildSnapshot({
        vendor: 'novanta',
        inverse,
        actuators: { vendor: 'novanta', actuators },
        trace: { vendor: 'novanta', trace: traceNovantaTrain(this.novantaTrain, actuators, this.novantaConditioning) },
        ghostTrace: {
          vendor: 'novanta',
          trace: traceNovantaTrain(this.novantaTrain, NOVANTA_ZERO_ACTUATORS, this.novantaConditioning),
        },
      });
      return this.cache;
    }

    const inverse = this.toggles.compensation
      ? educationalInverseModel(
          this.scanlabTrain,
          this.command,
          this.conditioning,
          4,
          warm ? this.lastScanlabActuators : undefined,
        )
      : naiveInverse(this.scanlabTrain, this.command, this.conditioning);
    const actuators = inverse.actuators as ActuatorState;
    this.lastScanlabActuators = actuators;
    this.cache = this.buildSnapshot({
      vendor: 'scanlab',
      inverse,
      actuators: { vendor: 'scanlab', actuators },
      trace: { vendor: 'scanlab', trace: traceTrain(this.scanlabTrain, actuators, this.conditioning) },
      ghostTrace: {
        vendor: 'scanlab',
        trace: traceTrain(this.scanlabTrain, ZERO_ACTUATORS, this.conditioning),
      },
    });
    return this.cache;
  }

  private buildSnapshot(input: {
    vendor: Vendor;
    inverse: InverseResult;
    actuators: AnyActuators;
    trace: AnyTrainTrace;
    ghostTrace: AnyTrainTrace;
  }): AppSnapshot {
    const { inverse } = input;
    return {
      mode: this.mode,
      vendor: input.vendor,
      variant: this.variant,
      command: this.command,
      achieved: {
        xMm: inverse.achieved.xMm,
        yMm: inverse.achieved.yMm,
        zMm: inverse.achieved.zMm,
        alphaDeg: inverse.achieved.alphaDeg,
        betaDeg: inverse.achieved.betaDeg,
      },
      residual: {
        xMm: inverse.residual.xMm,
        yMm: inverse.residual.yMm,
        zMm: inverse.residual.zMm,
        alphaDeg: inverse.residual.alphaDeg,
        betaDeg: inverse.residual.betaDeg,
      },
      actuators: input.actuators,
      actuatorReadout: readoutOf(input.actuators),
      trace: input.trace,
      ghostTrace: input.ghostTrace,
      inverse,
      toggles: this.toggles,
      selectedPartId: this.selectedPartId,
      playing: this.playing,
      theta: this.theta,
      screenRevolutionSeconds: this.screenRevolutionSeconds,
      process: this.process,
      tourStep: this.tourStep,
      axisDemo: this.axisDemo,
      conditioning: this.conditioning,
      fps: this.fps,
      loop: this.loop,
    };
  }

  setMode(mode: AppMode): void {
    this.mode = mode;
    this.emit();
  }

  /** 切换技术路线。切换后焦点命令保持（两条路线的工程量语义一致），执行器重解。 */
  setVendor(vendor: Vendor): void {
    if (vendor === this.vendor) return;
    this.vendor = vendor;
    this.clampCommand();
    this.emit();
  }

  setVariant(key: string): void {
    const variant = OPTICS_VARIANTS.find((v) => v.key === key);
    if (!variant) return;
    this.variant = variant;
    this.scanlabTrain = createOpticalTrain(variant);
    this.novantaTrain = createNovantaTrain(variant);
    this.clampCommand();
    this.emit();
  }

  setCommand(patch: Partial<EngineeringCommand>, silent = false): void {
    this.command = { ...this.command, ...patch };
    this.clampCommand();
    if (!silent) this.emit();
  }

  setToggles(patch: Partial<AppToggles>): void {
    this.toggles = { ...this.toggles, ...patch };
    this.emit();
  }

  setProcess(patch: Partial<ProcessParams>): void {
    this.process = { ...this.process, ...patch };
    this.process.revolutions = Math.max(1, this.process.revolutions);
    this.process.pitchMmPerRev = Math.min(
      Math.max(0, this.process.pitchMmPerRev),
      (Math.max(-1, Math.min(1, this.process.focusZMm)) + 1) / this.process.revolutions,
    );
    this.process.tiltAmplitudeDeg = Math.min(this.variant.maxAoiDeg, this.process.tiltAmplitudeDeg);
    this.cache = null;
    this.advance(0);
    this.emit();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit();
  }

  setSelectedPart(id: string | null): void {
    this.selectedPartId = id;
    this.emit();
  }

  setTourStep(step: number | null): void {
    this.tourStep = step;
    this.emit();
  }

  setAxisDemo(axis: AppSnapshot['axisDemo']): void {
    this.axisDemo = axis;
    this.emit();
  }

  setConditioning(patch: Partial<ConditioningState>): void {
    this.conditioning = { ...this.conditioning, ...patch };
    this.emit();
  }

  /** 推进动画相位（由渲染循环调用）。 */
  advance(deltaSeconds: number): void {
    this.processSpan = null;
    const from = this.theta;
    if (this.playing) {
      this.theta += (deltaSeconds / this.screenRevolutionSeconds) * 2 * Math.PI;
      if (this.mode === 'process' && this.axisDemo === 'none' && deltaSeconds > 0) {
        this.processSpan = {
          from,
          to: this.loop ? this.theta : Math.min(this.theta, this.process.revolutions * 2 * Math.PI),
        };
      }
    }
    if (this.mode === 'process') {
      const end = this.process.revolutions * 2 * Math.PI;
      if (this.theta >= end) {
        if (this.loop) this.theta %= end;
        else {
          this.theta = end;
          this.playing = false;
        }
      }
      this.theta = Math.max(0, this.theta);
    }
    const command = this.computeCommand();
    this.command = command;
    this.clampCommand();
    this.cache = null;
  }

  /** 当前应由哪条规则决定工程量：单轴演示 / 加工模式 / 手动。 */
  private computeCommand(): EngineeringCommand {
    if (this.axisDemo !== 'none') {
      const t = this.theta;
      const base: EngineeringCommand = { ...ZERO_COMMAND };
      const amplitudeX = SOFTWARE_LIMITS.offsetXyMm;
      /** Novanta 的平板机械行程更窄，AOI 演示幅值取小一档。 */
      const amplitudeAoi = this.vendor === 'novanta' ? 3 : 7.5;
      /**
       * Z 演示幅值必须**落在本路线的行程内**：
       * Novanta 的可达焦点 Z 只有约 ±0.27 mm（Z 执行器 ±1.5 mm），
       * 若沿用 SCANLAB 的 ±1 mm，命令会被 clampCommand() 压到 ±0.25 mm，
       * 曲线削顶 → 求解器长期顶在行程端点 → 表现为"Z 轴演示时镜片不动"。
       */
      const amplitudeZ =
        this.vendor === 'novanta' ? 0.2 : SOFTWARE_LIMITS.offsetZMm;
      switch (this.axisDemo) {
        case 'x':
          return { ...base, xMm: amplitudeX * Math.sin(t) };
        case 'y':
          return { ...base, yMm: amplitudeX * Math.cos(t) };
        case 'z':
          return { ...base, zMm: amplitudeZ * Math.sin(t) };
        case 'alpha':
          return { ...base, alphaDeg: amplitudeAoi * Math.sin(t) };
        case 'beta':
        default:
          return { ...base, betaDeg: amplitudeAoi * Math.cos(t) };
      }
    }

    if (this.mode === 'process') {
      return commandAtTheta(this.process, this.theta);
    }
    return this.command;
  }

  /** 把命令夹在公开/软件限值内。Novanta 路线的机械倾角行程更窄，单独收口。 */
  clampCommand(): void {
    const maxAoi = this.variant.maxAoiDeg;
    const aoiLimit = this.vendor === 'novanta' ? Math.min(maxAoi, 7) : maxAoi;
    /**
     * Novanta 的焦点 Z 行程：由 Z 执行器 ±1.5 mm 经望远镜 → 物镜换算而来，
     * 实测约 ±0.269 mm。这里取 **90%** 作为命令上限，留出反解迭代的余量 ——
     * 若把上限取成理论上限（±0.25 已经贴着端点），牛顿迭代略有超调就会
     * 把执行器顶到行程端点，表现为"Z 轴演示时镜片不动"。
     */
    const zLimit = this.vendor === 'novanta' ? 0.24 : SOFTWARE_LIMITS.traceZMm;
    const c = this.command;
    this.command = {
      xMm: clamp(c.xMm, -SOFTWARE_LIMITS.drillPointXyMm, SOFTWARE_LIMITS.drillPointXyMm),
      yMm: clamp(c.yMm, -SOFTWARE_LIMITS.drillPointXyMm, SOFTWARE_LIMITS.drillPointXyMm),
      zMm: clamp(c.zMm, -zLimit, zLimit),
      alphaDeg: clamp(c.alphaDeg, -aoiLimit, aoiLimit),
      betaDeg: clamp(c.betaDeg, -aoiLimit, aoiLimit),
    };
  }

  /**
   * 当前工况下的耦合矩阵，用于"为什么必须联合标定"的展示。
   *
   * 注意：在**零位**对 Novanta 路线求雅可比会得到近似对角矩阵 ——
   * 因为平板在零倾角处的位移对倾角的一阶导数为 0（tan 型非线性），
   * 于是 α/β 两行全是 0。那会误导读者。因此在当前执行器工作点上求，
   * 并把步长放大到 0.25° 以避开零导数点。
   */
  couplingAtOperatingPoint(): number[][] {
    if (this.vendor === 'novanta') {
      const values = [
        (this.lastNovantaActuators.xGalvoRad * 180) / Math.PI,
        (this.lastNovantaActuators.yGalvoRad * 180) / Math.PI,
        this.lastNovantaActuators.telescopeTravelMm,
        (this.lastNovantaActuators.plateARad * 180) / Math.PI,
        (this.lastNovantaActuators.plateBRad * 180) / Math.PI,
      ];
      const at = values.some((v) => Math.abs(v) > 1e-3) ? values : [0, 0, 0, 3, 3];
      return normalizedFromJacobian(
        buildJacobianWith(novantaAdapter(this.novantaTrain, this.novantaConditioning), at, 0.25),
      );
    }
    const values = [
      (this.lastScanlabActuators.xRad * 180) / Math.PI,
      (this.lastScanlabActuators.yRad * 180) / Math.PI,
      this.lastScanlabActuators.zTravelMm,
      (this.lastScanlabActuators.alphaRad * 180) / Math.PI,
      (this.lastScanlabActuators.betaRad * 180) / Math.PI,
    ];
    return normalizedFromJacobian(
      buildJacobianWith(scanlabAdapter(this.scanlabTrain, this.conditioning), values),
    );
  }

  /** 焦点轨迹（用于工件上的尾迹）。 */
  focusTrailPoint(): Vector3 {
    const s = this.snapshot();
    const focus = s.trace.trace.focus;
    return new Vector3(focus.xMm, focus.yMm, 0.2);
  }

  reset(): void {
    this.command = { ...ZERO_COMMAND };
    this.theta = 0;
    this.playing = false;
    this.axisDemo = 'none';
    this.tourStep = null;
    this.emit();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
