/**
 * Novanta / ARGES 光学链路总装与光线追迹。
 *
 * 【光路拓扑】——来自 DE102004053298B4 摘要原文的顺序：
 *
 *   激光  →  光束衰减单元 (I)  →  wobble unit (II)：两块平行平板
 *         →  Galilei 扩束望远镜 / 动态调焦 (III)
 *         →  scanblock (IV)：Y 振镜 + X 振镜
 *         →  物镜 / 聚焦工作单元 (V)  →  工件
 *
 * 这与 SCANLAB 路线**不是同一条光路**：SCANLAB 用三镜四反射的反射式平行移束模块，
 * 本路线用两块**透射式**平行玻璃板靠折射移束。两条链路各自独立追迹，
 * 只在对外数据结构上保持兼容，以便场景与界面复用。
 *
 * 【五轴如何产生】
 *   X / Y  ← 下游 X 振镜、上游 Y 振镜的机械角（改变焦点横向位置）
 *   Z      ← 望远镜一片透镜的轴向位移（改变物镜前光束会聚度 → 焦点 Z）
 *   α / β  ← 两块平行平板的机械倾角（产生平行位移 → 物镜入瞳偏心 → 焦点入射角）
 *
 * 【解耦为什么成立】
 *   平板产生的是**平行位移**：光束中心平移、方向不变。折转对（Y 镜把 −Z 折向 +X、
 *   X 镜把 +X 折回 −Z）把该平移带到机器光轴上，但出射方向仍严格是 −Z。
 *   于是一阶意义下：
 *     平板转角 → 只改变入瞳偏心 h → 只改变 AOI；
 *     振镜转角 → 只改变出射坡度 u → 只改变焦点 X/Y。
 *   这正是专利要讲的东西："光束平行于光轴位移后仍聚焦在同一焦点，
 *   但以一定角度穿过光轴"。
 *
 * 与仓库 ray.ts / mirror.ts 的关系：光线仍由"起点 + 单位方向"表示，
 * 反射仍由镜面法向算出；只有平板一段用 refraction.ts 的真实折射追迹。
 * 画面上的折线、读数面板上的每个数字都来自本文件的同一次追迹。
 */

import { Vector3 } from 'three';
import {
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
import { intersectMirror, mirrorNormal, type MirrorSpec } from './mirror';
import {
  createWobbleUnit,
  traceWobbleUnit,
  type PrecessionSample,
  type WobbleUnitGeometry,
} from './dual-plate-precession';import {
  createGalileanTelescope,
  pupilVergenceFromTelescope,
  traceTelescope,
  type TelescopeGeometry,
  type TelescopeLens,
  type TelescopeTrace,
} from './galilean-telescope';
import {
  evaluateNovantaObjective,
  novantaFocalLengthMm,
  pupilFromLastGalvo,
  type NovantaFocusState,
  type NovantaPupilState,
} from './novanta-objective';
import { NOVANTA_AXIS, NOVANTA_BEAM_PATH, NOVANTA_OBJECTIVE } from '../config/novanta-layout';
import type { OpticsVariant } from '../config/public-specs';

/** Novanta 链路的五个执行量。 */
export interface NovantaActuatorState {
  /** 平行平板 A（绕 X 轴）机械倾角 rad。 */
  plateARad: number;
  /** 平行平板 B（绕 Y 轴）机械倾角 rad。 */
  plateBRad: number;
  /** Z 执行器：望远镜镜组轴向行程 mm（正 = 增大镜距）。 */
  telescopeTravelMm: number;
  /** X 振镜（下游）机械角 rad。 */
  xGalvoRad: number;
  /** Y 振镜（上游）机械角 rad。 */
  yGalvoRad: number;
}

export const NOVANTA_ZERO_ACTUATORS: NovantaActuatorState = {
  plateARad: 0,
  plateBRad: 0,
  telescopeTravelMm: 0,
  xGalvoRad: 0,
  yGalvoRad: 0,
};

/** 与 SCANLAB 模式同名同形的光束调理状态（本路线默认不启用）。 */
export interface NovantaConditioningState {
  expanderMagnification: number;
  divergenceVergence: number;
}

export const NOVANTA_DEFAULT_CONDITIONING: NovantaConditioningState = {
  expanderMagnification: 1,
  divergenceVergence: 0,
};

export interface NovantaTraceSegment {
  from: Vector3;
  to: Vector3;
  radiusFrom: number;
  radiusTo: number;
  /** 这一段是"在玻璃里"还是"在空气中"，渲染据此区分。 */
  medium: 'air' | 'glass';
}

/** 一次光学面命中（用于法线指示与部件信息卡）。 */
export interface NovantaHitRecord {
  mirrorId: string;
  label: string;
  point: Vector3;
  normal: Vector3;
  /** 光线与该面法向的夹角（弧度）。 */
  incidenceRad: number;
  /** 命中类型：反射面 / 折射界面。 */
  kind: 'reflect' | 'refract-front' | 'refract-back' | 'lens';
}

export interface NovantaTrainTrace {
  ok: boolean;
  note: string;
  segments: NovantaTraceSegment[];
  /** 主光线关键顶点（含平板入射/出射点）。 */
  chiefPoints: Vector3[];
  hits: NovantaHitRecord[];
  /** 平板 A 的入射/出射命中点。 */
  plateAPoints: [Vector3, Vector3] | null;
  /** 平板 B 的入射/出射命中点。 */
  plateBPoints: [Vector3, Vector3] | null;
  /** 望远镜两片透镜上的命中点。 */
  telescopePoints: [Vector3, Vector3] | null;
  /** 振镜命中点（Y 上游、X 下游）。 */
  galvoPoints: [Vector3, Vector3] | null;
  /** wobble unit 在该时刻的完整状态（含板姿态与位移）。 */
  wobble: PrecessionSample | null;
  telescope: TelescopeTrace | null;
  pupil: NovantaPupilState;
  focus: NovantaFocusState;
  focusPoint: Vector3;
  /** 模块输出（望远镜入口前）的合成平行位移 mm。 */
  moduleOffsetMm: number;
  /** 望远镜放大后的平行位移 mm。 */
  pupilOffsetMm: number;
  /** 两块板各自造成的位移（mm，带符号）。 */
  plateShiftAMm: number;
  plateShiftBMm: number;
  /** 全部光学面是否都在有效口径内。 */
  apertureClear: boolean;
}

export interface NovantaOpticalTrain {
  variant: OpticsVariant;
  wobbleUnit: WobbleUnitGeometry;
  telescope: TelescopeGeometry;
  /** 上游 Y 振镜：位于 (−run, 0, yGalvo)，把 −Z 折向 +X。 */
  yGalvo: MirrorSpec;
  /** 下游 X 振镜：位于机器光轴上、入瞳高度，把 +X 折回 −Z。 */
  xGalvo: MirrorSpec;
  /** 光束衰减单元（专利摘要 I，只画不追迹）。 */
  attenuator: { center: Vector3; label: string };
  /** 全部反射式可交互元件（振镜）。 */
  mirrors: MirrorSpec[];
  /** 望远镜两片透镜（折射式，几何与 MirrorSpec 不同，单独列）。 */
  lenses: [TelescopeLens, TelescopeLens];
  /** 全部折射界面 id（渲染与拾取用）。 */
  refractiveIds: string[];
}

const MACHINE_AXIS = new Vector3(0, 0, 0);

/**
 * 建立整条 Novanta 光学链路。
 *
 * 【scanblock 的 45° 折转对为什么这样摆】这一节是纯几何，值得写清楚，
 * 因为"随手写一个 45° 法向"会让光路整条跑偏（本文件历史上发生过两次）：
 *
 *   设竖直下行光在 x = x₁ 处打到上游镜、命中高度 H；两片 45° 镜的法向分别取
 *       n₁ = (1,0,1)/√2   把 −Z 折成 +X
 *       n₂ = (−1,0,−1)/√2 把 +X 折回 −Z
 *   上游镜所在平面为 x + z = x₁ + H，故其**镜心**在 (x₁ − run/2, 0, H + run/2)；
 *   反射光沿 +X 走 run 后打到下游镜，命中点 (x₁ + run, 0, H)，
 *   下游镜平面为 x + z = x₁ + run + H，镜心在 (x₁ + run/2, 0, H + run/2)。
 *   ⇒ 出射竖直线位于 **x = x₁ + run**（折转对必然带来的横移）。
 *
 *   本模型令出射段落在机器光轴 x = 0 上（物镜与工件以此为基准），
 *   因此上游竖直段位于 x = run（见 NOVANTA_BEAM_PATH.upstreamAxis），
 *   且 x₁ = run。于是：
 *       上游镜心 = (run/2, 0, H + run/2)  —— 注意这是"镜心"，命中点在 (run,0,H)
 *       下游镜心 = (0, 0, H + run/2)
 *   命中点由 intersectMirror 按平面方程解出，不需要人工对齐。
 */
export function createNovantaTrain(variant: OpticsVariant): NovantaOpticalTrain {
  const wobbleUnit = createWobbleUnit();
  const telescope = createGalileanTelescope({
    positiveLensZ: NOVANTA_AXIS.telescopePositiveLens,
    negativeLensZ: NOVANTA_AXIS.telescopeNegativeLens,
    axisX: NOVANTA_BEAM_PATH.upstreamAxis.x,
    axisY: NOVANTA_BEAM_PATH.upstreamAxis.y,
  });

  const run = NOVANTA_AXIS.scanBlockRunMm;
  const machineX = NOVANTA_BEAM_PATH.machineAxis.x;
  /** 竖直入射/出射的**命中高度**（在物镜筒顶之上，见 config 里的硬约束）。 */
  const hitZ = NOVANTA_AXIS.entrancePupil;

  /**
   * 两片 45° 折转镜 —— 镜心坐标由**三条约束联立解出**，不要再靠试错挪。
   *
   * 记上游竖直光路 x = −run、机器光轴 x = 0、水平段高度 H、镜心到命中点的
   * 面内偏移为 run（这是 45° 折转对的固有几何）：
   *
   *   上游镜 法向 n₁ = (1,0,1)/√2（验算：reflect((0,0,−1), n₁) = (1,0,0) ✔）
   *     平面 x + z = 常数；竖直入射在 x = −run、命中高度 H
   *     ⇒ 常数 = H − run；镜心在平面上且沿 +u 方向（u ∝ (1,0,−1)）偏移 run
   *     ⇒ **镜心 = (0, 0, H)**
   *   下游镜 法向 n₂ = (−1,0,−1)/√2（验算：reflect((1,0,0), n₂) = (0,0,−1) ✔）
   *     水平段位于 z = H；镜心沿 +u 偏移 run ⇒ **镜心 = (0, 0, H)**
   *
   * 于是**两片镜心重合于 (0, 0, H)**（与 SCANLAB 参考拓扑一致：两镜心同位、
   * 各偏开自己的光路 Δ = 镜片中心与入射光的偏移量），水平段 z = H，
   * 出射沿机器光轴 x = 0 下行到焦点 —— "平行位移只改偏心、不改方向"成立。
   *
   * **【踩过的坑】**
   *  ① 曾把镜心沿法向平移去"给电机腾位置"：平面方程随之改变，
   *     竖直光路不再打在镜心（现象是"光路偏心打镜"）。
   *  ② 镜心 z 曾落在物镜筒区间内：30/32 mm 宽的镜片横穿镜筒（穿模）。
   *     现在命中高度取在筒顶之上，水平段也在筒顶之上。
   *  ③ 法向符号曾写成 (−1,0,1)：与水平段**平行**，求交得 t = 0，
   *     现象是"下游 X 振镜未接到光束"。法向必须用反射公式验算，不能心算。
   *  ④ 上游竖直段曾在 x = +run（右侧）：则水平段是 −X 方向，永远到不了 x = 0 的
   *     下游镜。入光必须在 −run 一侧，水平段才是 +X 方向。
   *
   * 电机**不能靠移动镜片来让位** —— 只能沿镜面内的转轴方向伸出去（见 scene 层）。
   *
   * 【转轴】转轴必须落在**镜面内**、与法向正交：
   *   上游镜绕 x 轴 → 出射方向在 y 向摆动 → 焦点沿 Y 扫描；
   *   下游镜绕 y 轴 → 出射方向在 x 向摆动 → 焦点沿 X 扫描。
   * 转轴取向是教学选取，专利未规定。
   */
  const mirrorZ = hitZ;
  const yGalvo: MirrorSpec = {
    id: 'novanta-galvo-y',
    label: 'Y 振镜（scanblock 上游）',
    kind: 'movable',
    center: new Vector3(-run, 0, mirrorZ),
    normal: new Vector3(1, 0, 1).normalize(),
    u: new Vector3(1, 0, -1).normalize(),
    v: new Vector3(0, 1, 0),
    size: { u: 30, v: 30 },
    rotationAxis: new Vector3(1, 0, 0),
    rotationPivot: new Vector3(-run, 0, mirrorZ),
    angleRad: 0,
    trust: '专利原理',
    note:
      'scanblock 的两面独立反射镜装在振镜单元上（DE102004053298B4）。此处位置、口径、转轴与折转方向为教学选取。',
    interactive: true,
  };

  const xGalvo: MirrorSpec = {
    id: 'novanta-galvo-x',
    label: 'X 振镜（scanblock 下游 · 等效入瞳参考）',
    kind: 'movable',
    center: new Vector3(machineX, 0, mirrorZ),
    /**
     * 法向 n₂ = (−1,0,−1)/√2。
     *
     * **必须用反射公式直接验算，不能凭"d_out − d_in"心算**（本文件在这上面错过两次）：
     *   水平段实际方向 d_in = (1,0,0)，目标出射 d_out = (0,0,−1)
     *   reflect((1,0,0), (−1,0,−1)/√2) = (0,0,−1) ✔
     *   reflect((1,0,0), (−1,0, 1)/√2) = (0,0, 1) ✘（折回向上，光路反向）
     * 用错法向时镜面平面与水平段**平行**，求交得到 t = 0，
     * 现象是"下游 X 振镜未接到光束"。
     */
    normal: new Vector3(-1, 0, -1).normalize(),
    u: new Vector3(1, 0, -1).normalize(),
    v: new Vector3(0, 1, 0),
    size: { u: 32, v: 32 },
    // 转轴必须在镜面内（与法向正交）：(0,1,0)·(−1,0,−1) = 0 ✔
    // 绕 y 转 1° → 出射主要在 x 向摆动 → 焦点沿 X 扫描
    rotationAxis: new Vector3(0, 1, 0),
    rotationPivot: new Vector3(machineX, 0, mirrorZ),
    angleRad: 0,
    trust: '专利原理',
    note:
      '该镜命中点同时用作"最后一片振镜"与等效入瞳参考；倾斜面不等于水平入瞳面。位置、口径、转轴与通道映射未公开。',
    interactive: true,
  };

  return {
    variant,
    wobbleUnit,
    telescope,
    yGalvo,
    xGalvo,
    attenuator: {
      center: new Vector3(
        NOVANTA_BEAM_PATH.upstreamAxis.x,
        NOVANTA_BEAM_PATH.upstreamAxis.y,
        NOVANTA_AXIS.beamAttenuator,
      ),
      label: '光束强度衰减单元（专利 I）',
    },
    mirrors: [yGalvo, xGalvo],
    lenses: [telescope.positive, telescope.negative],
    refractiveIds: [
      wobbleUnit.plateA.id,
      wobbleUnit.plateB.id,
      telescope.negative.id,
      telescope.positive.id,
    ],
  };
}

/** 按传播顺序累积光束包络并记录折线。 */
class NovantaBeamBuilder {
  envelope: BeamEnvelope;

  segments: NovantaTraceSegment[] = [];

  points: Vector3[] = [];

  constructor(envelope: BeamEnvelope) {
    this.envelope = envelope;
  }

  start(point: Vector3): void {
    // 避免重复起点的零长线段
    if (this.points.length === 0) this.points.push(point.clone());
  }

  travel(from: Vector3, to: Vector3, medium: 'air' | 'glass' = 'air'): void {
    const distance = from.distanceTo(to);
    const radiusFrom = this.envelope.radius;
    this.envelope = propagate(this.envelope, distance);
    this.segments.push({
      from: from.clone(),
      to: to.clone(),
      radiusFrom,
      radiusTo: this.envelope.radius,
      medium,
    });
    this.points.push(to.clone());
  }

  /** 记录一点但不产生线段（折射界面内部点用）。 */
  vertex(point: Vector3): void {
    this.points.push(point.clone());
  }
}

/** 追迹整条 Novanta 链路。 */
export function traceNovantaTrain(
  train: NovantaOpticalTrain,
  actuators: NovantaActuatorState,
  conditioning: NovantaConditioningState = NOVANTA_DEFAULT_CONDITIONING,
): NovantaTrainTrace {
  const notes: string[] = [];
  const halfInput = train.variant.inputBeamDiameterMm / 2;
  const startRadius = halfInput * conditioning.expanderMagnification;
  const builder = new NovantaBeamBuilder({
    radius: startRadius,
    vergence: conditioning.divergenceVergence,
  });

  const inlet = new Vector3(NOVANTA_BEAM_PATH.upstreamAxis.x, NOVANTA_BEAM_PATH.upstreamAxis.y, NOVANTA_AXIS.inlet);
  builder.start(inlet);
  builder.points[0] = inlet.clone();

  // ---------------------------------------------------------------- 1) 入光段
  const plateAEntryZ = NOVANTA_AXIS.plateA + train.wobbleUnit.plateA.thicknessMm / 2 + 6;
  builder.travel(inlet, new Vector3(inlet.x, inlet.y, plateAEntryZ));

  // ---------------------------------------------------------------- 2) wobble unit
  const wobble = traceWobbleUnit(
    train.wobbleUnit,
    actuators.plateARad,
    actuators.plateBRad,
    builder.envelope.radius,
  );
  if (!wobble) {
    return failedNovantaTrace(builder, '平行平板追迹失败（倾角超限、全内反射或几何异常）');
  }

  // 板 A：入射面 → 玻璃内 → 出射面
  builder.travel(builder.points[builder.points.length - 1], wobble.poseA.entryHit);
  builder.travel(wobble.poseA.entryHit, wobble.poseA.exitHit, 'glass');
  builder.vertex(wobble.poseA.exitHit);
  // 板 A → 板 B
  builder.travel(wobble.poseA.exitHit, wobble.poseB.entryHit);
  builder.travel(wobble.poseB.entryHit, wobble.poseB.exitHit, 'glass');
  builder.vertex(wobble.poseB.exitHit);

  let ray: Ray = wobble.outputRay;

  // ---------------------------------------------------------------- 3) 望远镜 / 动态调焦
  // 光束先到凹（负）镜、再到凸（准直）镜，因此 points[1] 是凹镜、points[0] 是凸镜。
  const telescopeTrace = traceTelescope(
    train.telescope,
    ray,
    builder.envelope.radius,
    actuators.telescopeTravelMm,
  );
  builder.travel(ray.origin, telescopeTrace.points[0]);
  builder.travel(telescopeTrace.points[0], telescopeTrace.points[1]);
  /**
   * 镜片对**光束半径**的作用：望远镜把口径放大 M 倍（专利 D_BET = M·d）。
   * 注意半径与"平行位移"是两个量：位移由 wobble unit 决定、再被同一个 M 放大，
   * 它们会一起进入入瞳偏心，但不会互相叠加到同一个数字上。
   */
  builder.envelope = {
    radius: telescopeTrace.outputRadiusMm,
    vergence: telescopeTrace.outputVergence,
  };
  ray = telescopeTrace.output;

  // ---------------------------------------------------------------- 4) scanblock
  const ySpec: MirrorSpec = { ...train.yGalvo, angleRad: actuators.yGalvoRad };
  const hitY = intersectMirror(ySpec, ray);
  if (!hitY) return failedNovantaTrace(builder, '上游 Y 振镜未接到光束');
  builder.travel(ray.origin, hitY.point);
  ray = makeRay(hitY.point, reflect(ray.direction, mirrorNormal(ySpec)));

  const xSpec: MirrorSpec = { ...train.xGalvo, angleRad: actuators.xGalvoRad };
  const hitX = intersectMirror(xSpec, ray);
  if (!hitX) return failedNovantaTrace(builder, '下游 X 振镜未接到光束');
  builder.travel(hitY.point, hitX.point);
  ray = makeRay(hitX.point, reflect(ray.direction, mirrorNormal(xSpec)));

  // 衰减单元只画不挡光；此处仅记录它所在高度，便于场景标注。
  const monitorZ = train.attenuator.center.z;
  void monitorZ;

  // ---------------------------------------------------------------- 5) 入瞳与物镜
  const pupilOffset = new Vector3(wobble.offsetVector.x, wobble.offsetVector.y, 0).multiplyScalar(
    telescopeTrace.measuredMagnification,
  );
  const pupilVergence = pupilVergenceFromTelescope(telescopeTrace.outputVergence);
  const pupil = pupilFromLastGalvo({
    lastGalvoPoint: hitX.point,
    // 命中点即入瞳参考：L = 0，平板位移不串到焦点 X/Y，只产生 AOI。
    lastGalvoToPupilMm: 0,
    outputDirection: ray.direction,
    pupilVergence,
    radiusMm: builder.envelope.radius,
  });
  const focus = evaluateNovantaObjective(pupil);

  // 物镜内部到焦点：入瞳 → 内部扩束 → 聚焦镜 → 焦点
  const focusPoint = new Vector3(focus.xMm, focus.yMm, focus.zMm);
  const lensPoint = new Vector3(
    focus.xMm - Math.tan((focus.aoiXDeg * Math.PI) / 180) * (NOVANTA_AXIS.objectiveLastLens - focus.zMm),
    focus.yMm - Math.tan((focus.aoiYDeg * Math.PI) / 180) * (NOVANTA_AXIS.objectiveLastLens - focus.zMm),
    NOVANTA_AXIS.objectiveLastLens,
  );
  const lastVertex = builder.points[builder.points.length - 1];
  builder.travel(lastVertex, lensPoint);
  builder.travel(lensPoint, focusPoint);
  // 焦点之后补一小段，便于看到出射光锥
  const after = focusPoint
    .clone()
    .addScaledVector(new Vector3(0, 0, -1), 6);
  builder.travel(focusPoint, after);

  const hits = collectNovantaHits(train, wobble, telescopeTrace, hitY, hitX, ySpec, xSpec);

  if (!wobble.apertureClear) notes.push('平行平板处光束包络超出教学口径。');
  if (!telescopeTrace.apertureClear) notes.push('望远镜镜片口径不足（放大后的位移或光束超出口径）。');
  if (Math.abs(actuators.telescopeTravelMm) > 1e-9) {
    notes.push(
      `Z 执行器移动 ${actuators.telescopeTravelMm.toFixed(3)} mm：望远镜输出会聚度 ${telescopeTrace.outputVergence.toExponential(2)} /mm，焦点 Z ${focus.zMm.toFixed(3)} mm。`,
    );
  }
  if (Math.abs(telescopeTrace.directionDeviationDeg) > 1e-6) {
    notes.push('望远镜偏离 afocal：出射光束不再与光轴平行（这正是动态调焦的工作状态）。');
  }

  return {
    ok: true,
    note: notes.join(' '),
    segments: builder.segments,
    chiefPoints: builder.points,
    hits,
    plateAPoints: [wobble.poseA.entryHit.clone(), wobble.poseA.exitHit.clone()],
    plateBPoints: [wobble.poseB.entryHit.clone(), wobble.poseB.exitHit.clone()],
    telescopePoints: [telescopeTrace.points[0].clone(), telescopeTrace.points[1].clone()],
    galvoPoints: [hitY.point.clone(), hitX.point.clone()],
    wobble,
    telescope: telescopeTrace,
    pupil,
    focus,
    focusPoint,
    moduleOffsetMm: wobble.offsetRadiusMm,
    pupilOffsetMm: pupilOffset.length(),
    plateShiftAMm: wobble.shiftAMm,
    plateShiftBMm: wobble.shiftBMm,
    apertureClear: wobble.apertureClear && telescopeTrace.apertureClear,
  };
}

/** 收集全部光学面命中，供法线指示与部件信息卡使用。 */
function collectNovantaHits(
  train: NovantaOpticalTrain,
  wobble: PrecessionSample,
  telescopeTrace: TelescopeTrace,
  hitY: { point: Vector3; incidenceAngleRad: number },
  hitX: { point: Vector3; incidenceAngleRad: number },
  ySpec: MirrorSpec,
  xSpec: MirrorSpec,
): NovantaHitRecord[] {
  const hits: NovantaHitRecord[] = [
    {
      mirrorId: train.wobbleUnit.plateA.id,
      label: train.wobbleUnit.plateA.label,
      point: wobble.poseA.entryHit.clone(),
      normal: wobble.poseA.normal.clone(),
      incidenceRad: (wobble.poseA.incidenceDeg * Math.PI) / 180,
      kind: 'refract-front',
    },
    {
      mirrorId: `${train.wobbleUnit.plateA.id}-exit`,
      label: `${train.wobbleUnit.plateA.label} · 出射面`,
      point: wobble.poseA.exitHit.clone(),
      normal: wobble.poseA.normal.clone().negate(),
      incidenceRad: (wobble.poseA.exitIncidenceDeg * Math.PI) / 180,
      kind: 'refract-back',
    },
    {
      mirrorId: train.wobbleUnit.plateB.id,
      label: train.wobbleUnit.plateB.label,
      point: wobble.poseB.entryHit.clone(),
      normal: wobble.poseB.normal.clone(),
      incidenceRad: (wobble.poseB.incidenceDeg * Math.PI) / 180,
      kind: 'refract-front',
    },
    {
      mirrorId: `${train.wobbleUnit.plateB.id}-exit`,
      label: `${train.wobbleUnit.plateB.label} · 出射面`,
      point: wobble.poseB.exitHit.clone(),
      normal: wobble.poseB.normal.clone().negate(),
      incidenceRad: (wobble.poseB.exitIncidenceDeg * Math.PI) / 180,
      kind: 'refract-back',
    },
    {
      mirrorId: train.telescope.negative.id,
      label: train.telescope.negative.label,
      point: telescopeTrace.points[1].clone(),
      normal: new Vector3(0, 0, 1),
      incidenceRad: 0,
      kind: 'lens',
    },
    {
      mirrorId: train.telescope.positive.id,
      label: train.telescope.positive.label,
      point: telescopeTrace.points[0].clone(),
      normal: new Vector3(0, 0, 1),
      incidenceRad: 0,
      kind: 'lens',
    },
    {
      mirrorId: ySpec.id,
      label: ySpec.label,
      point: hitY.point.clone(),
      normal: mirrorNormal(ySpec),
      incidenceRad: hitY.incidenceAngleRad,
      kind: 'reflect',
    },
    {
      mirrorId: xSpec.id,
      label: xSpec.label,
      point: hitX.point.clone(),
      normal: mirrorNormal(xSpec),
      incidenceRad: hitX.incidenceAngleRad,
      kind: 'reflect',
    },
  ];
  return hits;
}

function emptyNovantaPupil(): NovantaPupilState {
  return { hxMm: 0, hyMm: 0, u: 0, v: 0, vergence: 0, radiusMm: 1 };
}

function failedNovantaTrace(builder: NovantaBeamBuilder, note: string): NovantaTrainTrace {
  const pupil = emptyNovantaPupil();
  return {
    ok: false,
    note,
    segments: builder.segments,
    chiefPoints: builder.points,
    hits: [],
    plateAPoints: null,
    plateBPoints: null,
    telescopePoints: null,
    galvoPoints: null,
    wobble: null,
    telescope: null,
    pupil,
    focus: evaluateNovantaObjective(pupil),
    focusPoint: new Vector3(0, 0, 0),
    moduleOffsetMm: 0,
    pupilOffsetMm: 0,
    plateShiftAMm: 0,
    plateShiftBMm: 0,
    apertureClear: false,
  };
}

/* ------------------------------------------------------------------ *
 * 与仓库既有光学层同形的对外接口
 * （让 educational-inverse-model.ts 与场景层可以直接复用）
 * ------------------------------------------------------------------ */

export interface NovantaOutcomeVector {
  xMm: number;
  yMm: number;
  zMm: number;
  alphaDeg: number;
  betaDeg: number;
}

export function novantaOutcomeOf(trace: NovantaTrainTrace): NovantaOutcomeVector {
  return {
    xMm: trace.focus.xMm,
    yMm: trace.focus.yMm,
    zMm: trace.focus.zMm,
    alphaDeg: trace.focus.aoiXDeg,
    betaDeg: trace.focus.aoiYDeg,
  };
}

export function novantaOutcomeArray(trace: NovantaTrainTrace): number[] {
  const o = novantaOutcomeOf(trace);
  return [o.xMm, o.yMm, o.zMm, o.alphaDeg, o.betaDeg];
}

/** 执行器统一量纲（角度用度），顺序与 SCANLAB 模式一致：X, Y, Z, α, β。 */
export function novantaActuatorArray(a: NovantaActuatorState): number[] {
  return [
    (a.xGalvoRad * 180) / Math.PI,
    (a.yGalvoRad * 180) / Math.PI,
    a.telescopeTravelMm,
    (a.plateARad * 180) / Math.PI,
    (a.plateBRad * 180) / Math.PI,
  ];
}

export function novantaActuatorFromArray(values: number[]): NovantaActuatorState {
  const deg = Math.PI / 180;
  return {
    xGalvoRad: values[0] * deg,
    yGalvoRad: values[1] * deg,
    telescopeTravelMm: values[2],
    plateARad: values[3] * deg,
    plateBRad: values[4] * deg,
  };
}

/** 执行器安全范围。 */
export const NOVANTA_ACTUATOR_LIMITS = {
  /** 振镜机械角上限（rad）—— 教学行程。 */
  galvoRad: 0.105,
  /** Z 执行器行程 ±mm（与望远镜配置一致）。 */
  telescopeTravelMm: 1.5,
  /** 平行平板机械倾角上限（rad）—— 教学行程。 */
  plateRad: (20 * Math.PI) / 180,
};

export function clampNovantaActuators(a: NovantaActuatorState): NovantaActuatorState {
  return {
    xGalvoRad: clamp(a.xGalvoRad, -NOVANTA_ACTUATOR_LIMITS.galvoRad, NOVANTA_ACTUATOR_LIMITS.galvoRad),
    yGalvoRad: clamp(a.yGalvoRad, -NOVANTA_ACTUATOR_LIMITS.galvoRad, NOVANTA_ACTUATOR_LIMITS.galvoRad),
    telescopeTravelMm: clamp(
      a.telescopeTravelMm,
      -NOVANTA_ACTUATOR_LIMITS.telescopeTravelMm,
      NOVANTA_ACTUATOR_LIMITS.telescopeTravelMm,
    ),
    plateARad: clamp(a.plateARad, -NOVANTA_ACTUATOR_LIMITS.plateRad, NOVANTA_ACTUATOR_LIMITS.plateRad),
    plateBRad: clamp(a.plateBRad, -NOVANTA_ACTUATOR_LIMITS.plateRad, NOVANTA_ACTUATOR_LIMITS.plateRad),
  };
}

/** AOI 与 Plane 的极坐标表达（由两个倾角分量派生，不是一板对一轴）。 */
export function novantaAoiPolar(focus: NovantaFocusState): {
  aoiDeg: number;
  planeDeg: number;
} {
  return { aoiDeg: focus.aoiMagnitudeDeg, planeDeg: focus.planeAngleDeg };
}

/** 由焦点方向反查 α、β（供读数一致性检查）。 */
export function novantaTiltFromDirection(direction: Vector3): { alphaRad: number; betaRad: number } {
  return tiltFromDirection(direction);
}

/** 焦点处的名义半锥角（rad）。 */
export function novantaConeHalfAngle(focus: NovantaFocusState): number {
  return focus.coneHalfAngleRad;
}

/** 物镜公开焦距（页面文案直接用）。 */
export function novantaObjectiveFocalLengthMm(): number {
  return novantaFocalLengthMm();
}

/** 物镜后段传播距离（教学几何；公开的是焦距，不是工作距离）。 */
export function novantaObjectiveBackDistanceMm(): number {
  return NOVANTA_OBJECTIVE.lastLensZ;
}

export { MACHINE_AXIS as NOVANTA_MACHINE_AXIS };

/** 诊断辅助：给定执行器下，主光线在某平面的交点（排查用）。 */
export function novantaRayPointAtZ(ray: Ray, z: number): Vector3 | null {
  const t = intersectPlane(ray, new Vector3(0, 0, z), new Vector3(0, 0, 1));
  if (t === null) return null;
  return pointAt(ray, t);
}
