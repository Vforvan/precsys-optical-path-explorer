/**
 * 应用状态：把"用户命令 → 五个执行轴 → 光线追迹 → 画面"这条链路集中在一处。
 *
 * 关键点（计划书 §10.5）：
 *   页面内部同时保留"五个工程量"与"五个执行轴"两层状态，
 *   两者之间由 educationalInverseModel() 连接；
 *   补偿开关决定是用"一轴对应一坐标"的教科书解，还是用联合求解。
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
  ZERO_COMMAND,
  educationalInverseModel,
  naiveInverse,
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
  exploded: boolean;
  autoRotate: boolean;
  /** 联合补偿开关。 */
  compensation: boolean;
}

export interface AppSnapshot {
  mode: AppMode;
  variant: OpticsVariant;
  command: EngineeringCommand;
  achieved: EngineeringCommand;
  residual: EngineeringCommand;
  actuators: ActuatorState;
  trace: TrainTrace;
  ghostTrace: TrainTrace;
  inverse: InverseResult;
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
  exploded: false,
  autoRotate: false,
  compensation: true,
};

export class AppState {
  mode: AppMode = 'overview';

  variant: OpticsVariant = OPTICS_VARIANTS[0];

  train: OpticalTrain = createOpticalTrain(this.variant);

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

  fps = 0;
  loop = true;
  processSpan: { from: number; to: number } | null = null;

  private listeners = new Set<(snapshot: AppSnapshot) => void>();

  private cache: AppSnapshot | null = null;

  /** 上一帧执行轴（热启动用）。 */
  private lastActuators: ActuatorState = { ...ZERO_ACTUATORS };

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
    // 播放动画时用上一帧的执行轴做热启动，省掉一次教科书解与雅可比求解
    const warm = this.playing ? this.lastActuators : undefined;
    const inverse = this.toggles.compensation
      ? educationalInverseModel(this.train, this.command, this.conditioning, 4, warm)
      : naiveInverse(this.train, this.command, this.conditioning);
    this.lastActuators = inverse.actuators;
    const trace = traceTrain(this.train, inverse.actuators, this.conditioning);
    const ghostTrace = traceTrain(this.train, ZERO_ACTUATORS, this.conditioning);
    this.cache = {
      mode: this.mode,
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
      actuators: inverse.actuators,
      trace,
      ghostTrace,
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
    return this.cache;
  }

  setMode(mode: AppMode): void {
    this.mode = mode;
    this.emit();
  }

  setVariant(key: string): void {
    const variant = OPTICS_VARIANTS.find((v) => v.key === key);
    if (!variant) return;
    this.variant = variant;
    this.train = createOpticalTrain(variant);
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
    this.process.pitchMmPerRev = Math.min(Math.max(0, this.process.pitchMmPerRev),
      (Math.max(-1, Math.min(1, this.process.focusZMm)) + 1) / this.process.revolutions);
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
        this.processSpan = { from, to: this.loop ? this.theta
          : Math.min(this.theta, this.process.revolutions * 2 * Math.PI) };
      }
    }
    if (this.mode === 'process') {
      const end = this.process.revolutions * 2 * Math.PI;
      if (this.theta >= end) {
        if (this.loop) this.theta %= end;
        else { this.theta = end; this.playing = false; }
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
      switch (this.axisDemo) {
        case 'x':
          return { ...base, xMm: amplitudeX * Math.sin(t) };
        case 'y':
          return { ...base, yMm: amplitudeX * Math.cos(t) };
        case 'z':
          return { ...base, zMm: SOFTWARE_LIMITS.offsetZMm * Math.sin(t) };
        case 'alpha':
          return { ...base, alphaDeg: 7.5 * Math.sin(t) };
        case 'beta':
        default:
          return { ...base, betaDeg: 7.5 * Math.cos(t) };
      }
    }

    if (this.mode === 'process') {
      return commandAtTheta(this.process, this.theta);
    }
    return this.command;
  }

  /** 把命令夹在公开/软件限值内。 */
  clampCommand(): void {
    const maxAoi = this.variant.maxAoiDeg;
    const c = this.command;
    this.command = {
      xMm: clamp(c.xMm, -SOFTWARE_LIMITS.drillPointXyMm, SOFTWARE_LIMITS.drillPointXyMm),
      yMm: clamp(c.yMm, -SOFTWARE_LIMITS.drillPointXyMm, SOFTWARE_LIMITS.drillPointXyMm),
      zMm: clamp(c.zMm, -SOFTWARE_LIMITS.traceZMm, SOFTWARE_LIMITS.traceZMm),
      alphaDeg: clamp(c.alphaDeg, -maxAoi, maxAoi),
      betaDeg: clamp(c.betaDeg, -maxAoi, maxAoi),
    };
  }

  /** 焦点轨迹（用于工件上的尾迹）。 */
  focusTrailPoint(): Vector3 {
    const s = this.snapshot();
    return new Vector3(s.trace.focus.xMm, s.trace.focus.yMm, 0.2);
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
