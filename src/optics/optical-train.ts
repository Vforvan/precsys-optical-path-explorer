/**
 * 五轴光学链路总装与光线追迹。
 *
 * 这里把 α 平行移束模块、β 平行移束模块、Z 动态调焦等效模块、两片振镜、
 * 监测分光元件和物镜等效模型串成一条真实光路：每一段光线都由
 * "起点 + 单位方向"表示，每一次反射都由镜面法向算出（计划书 §10.1）。
 *
 * 追迹结果同时给出：
 *   - 主光线折线（渲染"零位幽灵光路"与当前光路都用它）；
 *   - 入瞳状态 (h, u, v, 半径, 会聚度)；
 *   - 焦点状态 (X, Y, Z, AOI α/β, 光锥角)。
 * 页面上的"五个工程量"全部是追迹结果，不是动画脚本里写死的数字。
 */

import { Vector3 } from 'three';
import {
  DEG,
  clamp,
  intersectPlane,
  makeRay,
  pointAt,
  propagate,
  reflect,
  tiltFromDirection,
  type BeamEnvelope,
  type Ray,
} from './ray';
import { intersectMirror, mirrorCenter, mirrorNormal, type MirrorSpec } from './mirror';
import {
  createShiftModule,
  traceShiftModule,
  type ShiftModuleGeometry,
  type ShiftTraceResult,
} from './parallel-shift-module';
import {
  createFocusModule,
  traceFocusModule,
  type FocusModuleGeometry,
  type FocusTraceResult,
} from './focus-module';
import { evaluateObjective, type FocusState, type PupilState } from './objective-model';
import { AXIS, BEAM_PATH, GALVO, OBJECTIVE, SHIFT_MODULE } from '../config/layout';
import type { OpticsVariant } from '../config/public-specs';

/** 五个执行轴的状态：三个机械角 + 两个振镜角。 */
export interface ActuatorState {
  /** α 可动镜机械角（rad）。 */
  alphaRad: number;
  /** β 可动镜机械角（rad）。 */
  betaRad: number;
  /** Z 执行器机械角（度）。 */
  zDeg: number;
  /** X 振镜机械角（rad）。 */
  xRad: number;
  /** Y 振镜机械角（rad）。 */
  yRad: number;
}

export const ZERO_ACTUATORS: ActuatorState = {
  alphaRad: 0,
  betaRad: 0,
  zDeg: 0,
  xRad: 0,
  yRad: 0,
};

/** 光束调理单元设置（可选件，计划书 §8 第 2～4 项）。 */
export interface ConditioningState {
  /** 扩束倍率 0.25–4（公开值）。 */
  expanderMagnification: number;
  /** 发散度调整带来的附加会聚度 1/mm（正 = 会聚）。 */
  divergenceVergence: number;
}

export const DEFAULT_CONDITIONING: ConditioningState = {
  expanderMagnification: 1,
  divergenceVergence: 0,
};

export interface TraceSegment {
  from: Vector3;
  to: Vector3;
  radiusFrom: number;
  radiusTo: number;
}

/** 一次镜面命中：位置、该镜片当前姿态的法向、以及入射角。 */
export interface HitRecord {
  mirrorId: string;
  label: string;
  point: Vector3;
  /** 镜面法向（已在当前姿态下计算）。 */
  normal: Vector3;
  /** 入射角（弧度，光线与法向的夹角）。 */
  incidenceRad: number;
}

export interface TrainTrace {
  ok: boolean;
  note: string;
  /** 主光线逐段折线。 */
  segments: TraceSegment[];
  /** 主光线关键顶点。 */
  chiefPoints: Vector3[];
  /** 全部镜面命中记录（含法向与入射角），渲染"法线指示"与信息卡都用它。 */
  hits: HitRecord[];
  alphaPoints: Vector3[];
  betaPoints: Vector3[];
  zPoints: Vector3[];
  pupil: PupilState;
  focus: FocusState;
  focusPoint: Vector3;
  alphaTrace: ShiftTraceResult | null;
  betaTrace: ShiftTraceResult | null;
  zTrace: FocusTraceResult | null;
}

export interface OpticalTrain {
  variant: OpticsVariant;
  alphaModule: ShiftModuleGeometry;
  betaModule: ShiftModuleGeometry;
  focusModule: FocusModuleGeometry;
  /** Y 振镜：位于 (-16,0,150)，把 -Z 折向 +X。 */
  yGalvo: MirrorSpec;
  /** X 振镜：位于 (0,0,150)，镜面平面即物镜入瞳平面，把 +X 折回 -Z。 */
  xGalvo: MirrorSpec;
  /** 监测分光元件（只画不挡主光路）。 */
  splitter: MirrorSpec;
  /** 光束位置测量单元（自动精调用）。 */
  positionSensor: { center: Vector3; label: string };
  /** 全部镜片，供渲染与拾取使用。 */
  mirrors: MirrorSpec[];
}

const MACHINE_AXIS = new Vector3(0, 0, 0);

/** 建立整条光学链路。 */
export function createOpticalTrain(variant: OpticsVariant): OpticalTrain {
  const alphaModule = createShiftModule(
    'alpha',
    new Vector3(BEAM_PATH.afterAlpha.x, BEAM_PATH.afterAlpha.y, AXIS.alphaModuleOut),
    BEAM_PATH.inlet.x - BEAM_PATH.afterAlpha.x,
  );
  const betaModule = createShiftModule(
    'beta',
    new Vector3(BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.betaModuleOut),
    BEAM_PATH.inlet.y - BEAM_PATH.afterBeta.y,
  );

  const focusModule = createFocusModule(
    new Vector3(BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.zGalvo),
    AXIS.zFoldMirror - AXIS.entrancePupil,
  );

  const yGalvo: MirrorSpec = {
    id: 'galvo-y',
    label: 'Y 振镜（上游）',
    kind: 'movable',
    center: new Vector3(BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.galvoPlane),
    normal: new Vector3(1, 0, 1).normalize(),
    u: new Vector3(1, 0, -1).normalize(),
    v: new Vector3(0, 1, 0),
    size: { u: GALVO.mirrorSizeMm, v: GALVO.mirrorSizeMm },
    rotationAxis: new Vector3(1, 0, -1).normalize(),
    angleRad: 0,
    trust: '公开确认',
    note:
      '把 -Z 光束折向 +X。镜面内的转轴使偏转主要改变光束在 Y 方向的坡度（决定焦点 Y）。因为它不在入瞳平面上，扫描时会把一部分不需要的 Y 向偏心带进入瞳 —— 这正是需要联合补偿的耦合。',
    interactive: true,
  };

  const xGalvo: MirrorSpec = {
    id: 'galvo-x',
    label: 'X 振镜（入瞳平面）',
    kind: 'movable',
    center: new Vector3(BEAM_PATH.machineAxis.x, BEAM_PATH.machineAxis.y, AXIS.galvoPlane),
    normal: new Vector3(-1, 0, -1).normalize(),
    u: new Vector3(1, 0, -1).normalize(),
    v: new Vector3(0, 1, 0),
    size: { u: GALVO.mirrorSizeMm, v: GALVO.mirrorSizeMm },
    rotationAxis: new Vector3(0, 1, 0),
    angleRad: 0,
    trust: '公开确认',
    note:
      '把 +X 光束折回 -Z。它的镜面平面与物镜入瞳平面重合，转轴落在入瞳平面上：改变的是光束在入瞳处的坡度 u（决定焦点 X），基本不产生偏心。',
    interactive: true,
  };

  const splitter: MirrorSpec = {
    id: 'monitor-splitter',
    label: '监测分光元件',
    kind: 'splitter',
    center: new Vector3(BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.monitoringSplitter),
    normal: new Vector3(1, 0, 1).normalize(),
    u: new Vector3(1, 0, -1).normalize(),
    v: new Vector3(0, 1, 0),
    size: { u: 18, v: 18 },
    trust: '公开确认',
    note: '分出一小部分光到光束位置测量单元，用于 Automatic Fine Adjustment（自动精调）。',
    interactive: true,
  };

  const positionSensor = {
    center: new Vector3(
      BEAM_PATH.afterBeta.x - 34,
      BEAM_PATH.afterBeta.y,
      AXIS.monitoringSplitter + 34,
    ),
    label: '光束位置测量单元',
  };

  return {
    variant,
    alphaModule,
    betaModule,
    focusModule,
    yGalvo,
    xGalvo,
    splitter,
    positionSensor,
    mirrors: [
      alphaModule.movableIn,
      alphaModule.movableOut,
      alphaModule.fixed1,
      alphaModule.fixed2,
      betaModule.movableIn,
      betaModule.movableOut,
      betaModule.fixed1,
      betaModule.fixed2,
      focusModule.galvo,
      focusModule.curved,
      focusModule.fold,
      yGalvo,
      xGalvo,
      splitter,
    ],
  };
}

/** 按传播顺序累积光束包络，同时记录折线。 */
class BeamBuilder {
  envelope: BeamEnvelope;

  segments: TraceSegment[] = [];

  points: Vector3[] = [];

  constructor(envelope: BeamEnvelope) {
    this.envelope = envelope;
  }

  start(point: Vector3): void {
    this.points.push(point.clone());
  }

  travel(from: Vector3, to: Vector3): void {
    const distance = from.distanceTo(to);
    const radiusFrom = this.envelope.radius;
    this.envelope = propagate(this.envelope, distance);
    this.segments.push({
      from: from.clone(),
      to: to.clone(),
      radiusFrom,
      radiusTo: this.envelope.radius,
    });
    this.points.push(to.clone());
  }

  /** 变焦反射镜等有光焦度的元件对会聚度的作用。 */
  kick(deltaVergence: number): void {
    this.envelope = {
      radius: this.envelope.radius,
      vergence: this.envelope.vergence + deltaVergence,
    };
  }
}

/** 追迹整条链路。 */
export function traceTrain(
  train: OpticalTrain,
  actuators: ActuatorState,
  conditioning: ConditioningState = DEFAULT_CONDITIONING,
): TrainTrace {
  const notes: string[] = [];
  const halfInput = train.variant.inputBeamDiameterMm / 2;
  const startRadius = halfInput * conditioning.expanderMagnification;
  const builder = new BeamBuilder({
    radius: startRadius,
    vergence: conditioning.divergenceVergence,
  });

  const inlet = new Vector3(BEAM_PATH.inlet.x, BEAM_PATH.inlet.y, AXIS.inlet);
  builder.start(inlet);
  let ray: Ray = makeRay(inlet, new Vector3(0, 0, -1));

  // 1) 光束调理段（扩束、发散度调整、波片）
  const alphaInputZ = train.alphaModule.A.z + 40;
  const condEnd = new Vector3(BEAM_PATH.inlet.x, BEAM_PATH.inlet.y, alphaInputZ);
  builder.travel(ray.origin, condEnd);
  ray = makeRay(condEnd, new Vector3(0, 0, -1));

  // 2) α 平行移束模块（沿 X 移束）
  const alphaTrace = traceShiftModule(train.alphaModule, ray, actuators.alphaRad);
  if (!alphaTrace) {
    return failedTrace(builder, 'α 平行移束模块求交失败（角度超限或几何异常）');
  }
  builder.travel(ray.origin, alphaTrace.points[0]);
  builder.travel(alphaTrace.points[0], alphaTrace.points[1]);
  builder.travel(alphaTrace.points[1], alphaTrace.points[2]);
  builder.travel(alphaTrace.points[2], alphaTrace.points[3]);
  ray = alphaTrace.output;

  // 3) β 平行移束模块（沿 Y 移束）
  const betaTrace = traceShiftModule(train.betaModule, ray, actuators.betaRad);
  if (!betaTrace) {
    return failedTrace(builder, 'β 平行移束模块求交失败（角度超限或几何异常）');
  }
  builder.travel(ray.origin, betaTrace.points[0]);
  builder.travel(betaTrace.points[0], betaTrace.points[1]);
  builder.travel(betaTrace.points[1], betaTrace.points[2]);
  builder.travel(betaTrace.points[2], betaTrace.points[3]);
  ray = betaTrace.output;

  // 4) Z 动态调焦等效模块
  const zTrace = traceFocusModule(train.focusModule, ray, actuators.zDeg);
  if (!zTrace) {
    return failedTrace(builder, 'Z 动态调焦模块求交失败（执行器角度超限）');
  }
  builder.travel(ray.origin, zTrace.points[0]);
  builder.travel(zTrace.points[0], zTrace.points[1]);
  builder.kick(zTrace.vergence);
  builder.travel(zTrace.points[1], zTrace.points[2]);
  ray = zTrace.output;

  // 5) 监测分光元件（透射主光束）
  const tSplit = intersectPlane(ray, train.splitter.center, mirrorNormal(train.splitter));
  if (tSplit !== null && tSplit > 0) {
    const hit = pointAt(ray, tSplit);
    builder.travel(ray.origin, hit);
    ray = makeRay(hit, ray.direction);
    notes.push('监测分光元件透射主光束，取样光送往光束位置测量单元。');
  }

  // 6) Y 振镜（上游，折向 +X）
  const ySpec: MirrorSpec = { ...train.yGalvo, angleRad: actuators.yRad };
  const hitY = intersectMirror(ySpec, ray);
  if (!hitY) return failedTrace(builder, 'Y 振镜未接到光束');
  builder.travel(ray.origin, hitY.point);
  ray = makeRay(hitY.point, reflect(ray.direction, mirrorNormal(ySpec)));

  // 7) X 振镜（入瞳平面，折回 -Z）
  const xSpec: MirrorSpec = { ...train.xGalvo, angleRad: actuators.xRad };
  const hitX = intersectMirror(xSpec, ray);
  if (!hitX) return failedTrace(builder, 'X 振镜未接到光束');
  builder.travel(ray.origin, hitX.point);
  ray = makeRay(hitX.point, reflect(ray.direction, mirrorNormal(xSpec)));

  // 8) 入瞳状态：位置取 X 振镜命中点，坡度取反射后主光线
  const tilt = tiltFromDirection(ray.direction);
  const pupil: PupilState = {
    hxMm: hitX.point.x - MACHINE_AXIS.x,
    hyMm: hitX.point.y - MACHINE_AXIS.y,
    u: tilt.alphaRad,
    v: tilt.betaRad,
    radiusMm: builder.envelope.radius,
    vergence: builder.envelope.vergence,
  };
  const focus = evaluateObjective(pupil);
  const focusPoint = new Vector3(focus.xMm, focus.yMm, focus.zMm);
  const foldDirection = zTrace.points[2].clone().sub(zTrace.points[1]).normalize();
  const currentMirrors: MirrorSpec[] = [
    { ...train.alphaModule.movableIn, angleRad: actuators.alphaRad },
    train.alphaModule.fixed1, train.alphaModule.fixed2,
    { ...train.alphaModule.movableOut, angleRad: actuators.alphaRad },
    { ...train.betaModule.movableIn, angleRad: actuators.betaRad },
    train.betaModule.fixed1, train.betaModule.fixed2,
    { ...train.betaModule.movableOut, angleRad: actuators.betaRad },
    { ...train.focusModule.galvo, angleRad: actuators.zDeg * DEG },
    train.focusModule.curved,
    { ...train.focusModule.fold, angleRad: 0,
      normal: foldDirection.sub(new Vector3(0, 0, -1)).normalize() },
    ySpec, xSpec,
  ];
  const hits = collectHits(currentMirrors, builder.points);

  if (Math.abs(conditioning.expanderMagnification - 1) > 1e-6) {
    notes.push(
      `光束调理扩束 ×${conditioning.expanderMagnification.toFixed(2)}：入瞳光束半径 ${pupil.radiusMm.toFixed(2)} mm，光锥角随之变化。`,
    );
  }

  return {
    ok: true,
    note: notes.join(' '),
    segments: builder.segments,
    chiefPoints: builder.points,
    hits,
    alphaPoints: alphaTrace.points,
    betaPoints: betaTrace.points,
    zPoints: zTrace.points,
    pupil,
    focus,
    focusPoint,
    alphaTrace,
    betaTrace,
    zTrace,
  };
}

/**
 * 由主光线折线反推"每个拐点打在哪块镜片上"，并给出该镜片当前姿态的法向与入射角。
 * 画面上的法线指示与部件信息卡里的入射角都用这份数据，
 * 因此它必然与光线追迹结果一致（不是另外算一套）。
 */
function collectHits(mirrors: MirrorSpec[], points: Vector3[]): HitRecord[] {
  const hits: HitRecord[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const previous = points[i - 1];
    const incoming = point.clone().sub(previous);
    if (incoming.lengthSq() < 1e-12) continue;
    incoming.normalize();
    for (const spec of mirrors) {
      if (spec.kind === 'splitter') continue; // 分光元件透射主光束，不算反射命中
      const normal = mirrorNormal(spec);
      const center = mirrorCenter(spec);
      const distance = Math.abs(point.clone().sub(center).dot(normal));
      if (distance > 1e-6) continue;
      hits.push({
        mirrorId: spec.id,
        label: spec.label,
        point: point.clone(),
        normal,
        incidenceRad: Math.acos(Math.min(1, Math.abs(incoming.dot(normal)))),
      });
      break;
    }
  }
  return hits;
}

function emptyPupil(): PupilState {
  return { hxMm: 0, hyMm: 0, u: 0, v: 0, radiusMm: 1, vergence: 0 };
}

function failedTrace(builder: BeamBuilder, note: string): TrainTrace {
  const pupil = emptyPupil();
  return {
    ok: false,
    note,
    segments: builder.segments,
    chiefPoints: builder.points,
    hits: [],
    alphaPoints: [],
    betaPoints: [],
    zPoints: [],
    pupil,
    focus: evaluateObjective(pupil),
    focusPoint: new Vector3(0, 0, 0),
    alphaTrace: null,
    betaTrace: null,
    zTrace: null,
  };
}

/** 页面需要的"五个工程量"。 */
export interface OutcomeVector {
  xMm: number;
  yMm: number;
  zMm: number;
  alphaDeg: number;
  betaDeg: number;
}

export function outcomeOf(trace: TrainTrace): OutcomeVector {
  return {
    xMm: trace.focus.xMm,
    yMm: trace.focus.yMm,
    zMm: trace.focus.zMm,
    alphaDeg: trace.focus.aoiXDeg,
    betaDeg: trace.focus.aoiYDeg,
  };
}

export function outcomeArray(trace: TrainTrace): number[] {
  const o = outcomeOf(trace);
  return [o.xMm, o.yMm, o.zMm, o.alphaDeg, o.betaDeg];
}

/** 执行器统一量纲（角度用度），便于求耦合矩阵。 */
export function actuatorArray(a: ActuatorState): number[] {
  return [a.xRad / DEG, a.yRad / DEG, a.zDeg, a.alphaRad / DEG, a.betaRad / DEG];
}

export function actuatorFromArray(values: number[]): ActuatorState {
  return {
    xRad: values[0] * DEG,
    yRad: values[1] * DEG,
    zDeg: values[2],
    alphaRad: values[3] * DEG,
    betaRad: values[4] * DEG,
  };
}

/** 执行器安全范围（超出会提示并按边界裁剪）。 */
export const ACTUATOR_LIMITS = {
  /** X 振镜 ±6.9°。 */
  xRad: 0.12,
  yRad: 0.12,
  /** Z 执行器 ±1.4°（对应公开的焦点 Z 范围 ±1 mm）。 */
  zDeg: 1.4,
  /** α/β 可动镜：与模块机械行程一致。 */
  alphaRad: SHIFT_MODULE.mechanicalRangeDeg * DEG,
  betaRad: SHIFT_MODULE.mechanicalRangeDeg * DEG,
};

export function clampActuators(a: ActuatorState): ActuatorState {
  return {
    xRad: clamp(a.xRad, -ACTUATOR_LIMITS.xRad, ACTUATOR_LIMITS.xRad),
    yRad: clamp(a.yRad, -ACTUATOR_LIMITS.yRad, ACTUATOR_LIMITS.yRad),
    zDeg: clamp(a.zDeg, -ACTUATOR_LIMITS.zDeg, ACTUATOR_LIMITS.zDeg),
    alphaRad: clamp(a.alphaRad, -ACTUATOR_LIMITS.alphaRad, ACTUATOR_LIMITS.alphaRad),
    betaRad: clamp(a.betaRad, -ACTUATOR_LIMITS.betaRad, ACTUATOR_LIMITS.betaRad),
  };
}

/** 物镜内部等效扩束后的光束半径（画物镜内部光锥用）。 */
export function internalRadius(trace: TrainTrace): number {
  return trace.pupil.radiusMm * OBJECTIVE.internalMagnification;
}
