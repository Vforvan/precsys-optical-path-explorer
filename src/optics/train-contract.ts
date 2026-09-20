/**
 * 两条技术路线的公共光学接口。
 *
 * 目的：让**已经存在的**逆映射与场景/界面代码不用关心"这次跑的是哪一家"，
 * 同时又**不把两条不同的光路拓扑合并成一条**。
 *
 * 设计原则：
 *   - 这里只声明"外部看到什么"，不声明"内部怎么折转"；
 *   - SCANLAB 与 Novanta 各自的 trace 函数本来就是同形的结构类型，
 *     因此不需要给其中任何一方加适配层、更不需要重写既有实现；
 *   - 五个执行轴的**语义顺序固定为 X, Y, Z, α, β**，两条路线一致，
 *     这是页面滑杆、读数面板与耦合矩阵能复用的前提。
 */

import type { BeamEnvelope, Ray } from './ray';
import type { Vector3 } from 'three';

/** 五个执行轴的通用形状（角度用弧度、Z 用 mm）。 */
export interface GenericActuators {
  xRad: number;
  yRad: number;
  zTravelMm: number;
  alphaRad: number;
  betaRad: number;
}

/** 通用工程量结果。 */
export interface GenericOutcome {
  xMm: number;
  yMm: number;
  zMm: number;
  alphaDeg: number;
  betaDeg: number;
}

/** 通用光束段。 */
export interface GenericSegment {
  from: Vector3;
  to: Vector3;
  radiusFrom: number;
  radiusTo: number;
}

/** 通用入瞳状态。 */
export interface GenericPupil {
  hxMm: number;
  hyMm: number;
  u: number;
  v: number;
  radiusMm: number;
  vergence: number;
}

/** 通用焦点状态（两条路线共有的字段）。 */
export interface GenericFocus {
  xMm: number;
  yMm: number;
  zMm: number;
  aoiXDeg: number;
  aoiYDeg: number;
}

/** 通用命中记录。 */
export interface GenericHit {
  mirrorId: string;
  label: string;
  point: Vector3;
  normal: Vector3;
  incidenceRad: number;
}

/**
 * 逆映射求解器需要的最小接口。
 *
 * 注意 `train` 故意写成 `unknown`：不同路线的链路对象结构完全不同，
 * 求解器只把它当作不透明句柄传回给同一路线的 trace/outcome 函数。
 */
export interface TraceableTrain {
  trace(actuators: GenericActuators, conditioning: unknown): GenericTraceLike;
  outcome(trace: GenericTraceLike): GenericOutcome;
  actuatorArray(a: GenericActuators): number[];
  actuatorFromArray(values: number[]): GenericActuators;
  clamp(a: GenericActuators): GenericActuators;
}

export interface GenericTraceLike {
  ok: boolean;
  note: string;
  segments: GenericSegment[];
  pupil: GenericPupil;
  focus: GenericFocus;
  focusPoint: Vector3;
}

/** 通用追迹结果的完整形状（两条路线的 trace 都满足它）。 */
export interface GenericTrainTrace extends GenericTraceLike {
  chiefPoints: Vector3[];
  hits: GenericHit[];
  readonly [extra: string]: unknown;
}

/** 一条技术路线的绑定束：把该路线自己的类型收敛到通用形状。 */
export interface TrainBinding<Train, Actuators, Conditioning, Trace> {
  id: 'scanlab' | 'novanta';
  createTrain(variant: unknown): Train;
  zeroActuators: Actuators;
  defaultConditioning: Conditioning;
  trace(train: Train, actuators: Actuators, conditioning: Conditioning): Trace;
  outcome(trace: Trace): GenericOutcome;
  outcomeArray(trace: Trace): number[];
  actuatorArray(actuators: Actuators): number[];
  actuatorFromArray(values: number[]): Actuators;
  clampActuators(actuators: Actuators): Actuators;
  /** 焦点处的光束会聚度（用于读数）。 */
  internalRadius?(trace: Trace): number;
  envelopeOf?(trace: Trace): BeamEnvelope | null;
  chiefRay?(trace: Trace): Ray | null;
}
