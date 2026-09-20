/**
 * Galilei 光束扩束望远镜 / 动态调焦 —— 教学模型（Novanta / ARGES 路线）。
 *
 * 公开依据（DE102004053298B4）：
 *   · wobble unit 之后是 beam-expander telescope，它是**折射式**镜组；
 *   · 两镜组的焦点重合（afocal），放大倍率 M = f₂/f₁；
 *   · 出射光束尺寸 D_BET = M · d；
 *   · 平行位移被放大：**ΔX_BET = M · Δx**；
 *   · Galilei（凹 + 凸）因**结构更短**、且**镜组之间没有焦点**而被优先采用；
 *   · 凹透镜与/或准直镜组可沿光轴作**毫米级**移动 → 改变数值孔径、光束不再准直，
 *     并因此改变"焦点 Z 位置"。
 *
 * 明确未公开（全部标"教学等效"，数值集中在 config/novanta-layout.ts）：
 *   真实焦距、镜距、曲率、通光口径、执行器行程，
 *   以及"望远镜输出会聚度 → 焦点 Z 平移"的真实比例。
 *
 * 模型做法（一个来源，多处复用）：
 *   1. 主光线与边缘光线都走同一套近轴 ABCD 矩阵，
 *      因此"位移放大 M 倍"与"光束直径放大 M 倍"来自同一次计算；
 *   2. 输出会聚度由系统矩阵的 C 项给出（afocal 时为 0，即仍准直）；
 *   3. 焦点 Z 平移用**与 SCANLAB 模式同一套**的物镜等效关系
 *      （focus-module.ts 的 focusZFromPupilVergence），只是换成本路线的公开焦距
 *      与教学内部扩束比，避免两条路线各有一套互相矛盾的 Z 模型。
 */

import { Vector3 } from 'three';
import { clamp, makeRay, type Ray } from './ray';
import { focusZFromPupilVergence, pupilVergenceForFocusZ } from './focus-module';
import { NOVANTA_OBJECTIVE, NOVANTA_TELESCOPE } from '../config/novanta-layout';

/** 望远镜中的一片透镜（近轴薄透镜 + 绘制用几何）。 */
export interface TelescopeLens {
  id: string;
  label: string;
  kind: 'negative' | 'positive';
  /** 焦距 mm（凹透镜为负）。 */
  focalLengthMm: number;
  /** 零位光心（世界坐标）。 */
  center: Vector3;
  /** 绘制口径 mm —— 教学等效。 */
  apertureMm: number;
  /** 绘制厚度 mm —— 教学等效。 */
  thicknessMm: number;
}

export interface TelescopeGeometry {
  id: string;
  label: string;
  negative: TelescopeLens;
  positive: TelescopeLens;
  /** 零位镜距 mm。 */
  nominalSeparationMm: number;
  /** 放大倍率 M = f₂/|f₁|。 */
  magnification: number;
  /** Z 执行器行程 ±mm（教学参数）。 */
  maxTravelMm: number;
  /** 移动哪一片。 */
  movedElement: 'negative' | 'positive';
}

/**
 * 近轴 2×2 光线矩阵 [y, m]。
 *
 * 【符号约定，必须与仓库坐标系一致】本项目 Z 轴由工件指向扫描头，
 * 激光名义传播方向是 **−Z**。取**自然坡度**
 *     y = 光线在某个 z 平面上的横向坐标
 *     m = dy/dz
 * 沿传播方向前进 d 时 z 减小 d，于是
 *     传播： y' = y + d·m,   m' = m        ← 因为 dy = m·dz = m·(−d)… 见下方说明
 *     薄透镜：m' = m − y/f                 ← f > 0 会聚、f < 0 发散
 *
 * 【两个式子的由来，别再各改一个】把"沿传播方向前进 d"写成参数式：
 * 起点 (y, z)，终点 z−d。用 z 作自变量时 y(z−d) = y(z) − d·(dy/dz)，
 * 但本项目把"沿传播方向前进"记作正的 d，因此 **必须整体取反一次**，
 * 得到 y' = y + d·m。薄透镜冲量同理取反，得到 m' = m − y/f。
 * 两者是一对；只改其中一个就会出现"afocal 时出射光不平行"这类自相矛盾的结果。
 *
 * 出射方向向量由坡度还原：direction = normalize((m_x, m_y, −1))。
 *
 * 纯几何自检（galilean-telescope.test.ts 逐条断言）：
 *   · 会聚透镜 f>0：平行入射、高度 y 的光线必须在下游 f 处与光轴相交；
 *   · 发散透镜 f<0：同一光线必须**远离**光轴；
 *   · afocal 条件解出 d = f₂ − f₁（f₁ < 0），此时平行入射仍平行出射、位移放大 M = d/f₂ − 1；
 *   · afocal 时 C = 0。
 */
export type ABCD = readonly [readonly [number, number], readonly [number, number]];

const IDENTITY: ABCD = [
  [1, 0],
  [0, 1],
];

/**
 * 自由传播 d（>0 表示沿传播方向前进 d）。y' = y + d·m、m' = m。
 * 推导与自检见本文件顶部 ABCD 的说明。
 */
export function abcdPropagate(dMm: number): ABCD {
  return [
    [1, dMm],
    [0, 1],
  ];
}

/**
 * 薄透镜的角冲量：m' = m − y/f（f > 0 会聚、f < 0 发散）。
 * 与上面的传播算子是一对，符号必须同时成立；推导见本文件顶部说明。
 */
export function abcdThinLens(focalLengthMm: number): ABCD {
  if (!Number.isFinite(focalLengthMm) || Math.abs(focalLengthMm) < 1e-9) return IDENTITY;
  return [
    [1, 0],
    [-1 / focalLengthMm, 1],
  ];
}

/** 矩阵相乘：先 a 后 b。 */
export function abcdMultiply(a: ABCD, b: ABCD): ABCD {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
    ],
  ];
}

/** 对近轴光线 [y, u] 施加矩阵。 */
export function abcdApply(m: ABCD, y: number, u: number): { y: number; u: number } {
  return { y: m[0][0] * y + m[0][1] * u, u: m[1][0] * y + m[1][1] * u };
}

/** 建立望远镜。凹（负）镜在上游（z 更大），凸（准直）镜在下游。 */
export function createGalileanTelescope(params: {
  positiveLensZ: number;
  negativeLensZ: number;
  axisX?: number;
  axisY?: number;
}): TelescopeGeometry {
  const x = params.axisX ?? 0;
  const y = params.axisY ?? 0;
  return {
    id: 'novanta-telescope',
    label: 'Galilei 光束扩束望远镜 / 动态调焦',
    negative: {
      id: 'novanta-telescope-negative',
      label: '望远镜 · 凹（负）透镜',
      kind: 'negative',
      focalLengthMm: NOVANTA_TELESCOPE.negativeFocalLengthMm,
      center: new Vector3(x, y, params.negativeLensZ),
      apertureMm: NOVANTA_TELESCOPE.apertureMm,
      thicknessMm: NOVANTA_TELESCOPE.lensThicknessMm,
    },
    positive: {
      id: 'novanta-telescope-positive',
      label: '望远镜 · 凸（准直）透镜',
      kind: 'positive',
      focalLengthMm: NOVANTA_TELESCOPE.positiveFocalLengthMm,
      center: new Vector3(x, y, params.positiveLensZ),
      apertureMm: NOVANTA_TELESCOPE.apertureMm,
      thicknessMm: NOVANTA_TELESCOPE.lensThicknessMm,
    },
    nominalSeparationMm: Math.abs(params.negativeLensZ - params.positiveLensZ),
    magnification: NOVANTA_TELESCOPE.magnification,
    maxTravelMm: NOVANTA_TELESCOPE.maxAxialTravelMm,
    movedElement: NOVANTA_TELESCOPE.movedElement,
  };
}

/**
 * Z 执行器行程下的两片透镜位置。
 * travelMm > 0 表示**增大镜距**（凹镜往上游移动）→ 输出光束更会聚、焦点上移。
 */
export function telescopeLensesAt(
  geom: TelescopeGeometry,
  travelMm: number,
): { negative: TelescopeLens; positive: TelescopeLens; separationMm: number } {
  const t = clamp(travelMm, -geom.maxTravelMm, geom.maxTravelMm);
  const negativeCenter = geom.negative.center
    .clone()
    .add(new Vector3(0, 0, geom.movedElement === 'negative' ? t : 0));
  const positiveCenter = geom.positive.center
    .clone()
    .add(new Vector3(0, 0, geom.movedElement === 'positive' ? -t : 0));
  return {
    negative: { ...geom.negative, center: negativeCenter },
    positive: { ...geom.positive, center: positiveCenter },
    separationMm: Math.abs(negativeCenter.z - positiveCenter.z),
  };
}

/**
 * 望远镜在给定执行器行程下的系统矩阵（按光束实际经过的顺序：凹镜 → 间距 → 凸镜）。
 *
 * abcdMultiply(a, b) 表示"先 b 后 a"，因此对依次经过 L₁、P、L₂ 的光线，
 * 系统矩阵是 **M = L₂ · (P · L₁)**。
 * 【踩坑记录】写成 ((L₁·P)·L₂) 时，矩阵乘法本身仍合法、结果也"看着像矩阵"，
 * 但会把两片透镜的次序颠倒：afocal 判据失效（C = −1/60 而不是 0）、
 * 横向放大倍率变成 1/M，于是望远镜"永远失准直"。
 * galilean-telescope.test.ts 里对 C = 0、A = M 的硬断言就是为了钉住这一条。
 */
export function telescopeMatrix(geom: TelescopeGeometry, travelMm: number): ABCD {
  const lenses = telescopeLensesAt(geom, travelMm);
  return abcdMultiply(
    abcdThinLens(lenses.positive.focalLengthMm),
    abcdMultiply(abcdPropagate(lenses.separationMm), abcdThinLens(lenses.negative.focalLengthMm)),
  );
}

/** 实际横向放大倍率：轴上平行入射光线的出射高度比。afocal 时等于 f₂/|f₁|。 */
export function telescopeMagnificationAt(geom: TelescopeGeometry, travelMm = 0): number {
  return Math.abs(telescopeMatrix(geom, travelMm)[0][0]);
}

/**
 * 望远镜输出光束的会聚度（1/mm，正 = 会聚）。
 *
 * 由系统矩阵给出：入射为准直光束（边缘光线 y = ρ、m = 0），
 * 出射边缘光线坡度 m_out = C·ρ、高度 y_out = A·ρ。
 * 会聚光束沿传播方向逐步靠近光轴，即 m_out 与 y_out 异号；
 * 由 |m/y| = 1/|R| 且会聚为正，得
 *     v_out = −m_out / y_out = −C / A。
 * afocal（镜距 = f₂ + |f₁|）时 C = 0 → v_out = 0，光束仍准直。
 */
export function telescopeOutputVergence(geom: TelescopeGeometry, travelMm = 0): number {
  const m = telescopeMatrix(geom, travelMm);
  const a = m[0][0];
  if (Math.abs(a) < 1e-12) return 0;
  return -m[1][0] / a;
}

/**
 * 逐面近轴追迹一条光线通过望远镜（自然坡度 m = dy/dz）。
 *
 * **唯一**的薄透镜/传播实现：系统矩阵与主光线追迹都调用它，
 * 因此"放大倍率"与"出射方向"不可能各写一套符号约定而互相矛盾。
 *   y₁ = yIn
 *   m₁ = mIn − y₁/f₁            （凹镜 f₁ < 0 → 光线向外偏）
 *   y₂ = y₁ − gap·m₁
 *   m₂ = m₁ − y₂/f₂
 */
export function stepThroughLenses(
  f1: number,
  f2: number,
  gap: number,
  yIn: number,
  mIn: number,
): { y1: number; m1: number; y2: number; m2: number } {
  const y1 = yIn;
  const m1 = mIn - y1 / f1;
  const y2 = y1 + gap * m1;
  const m2 = m1 - y2 / f2;
  return { y1, m1, y2, m2 };
}

export interface TelescopeTrace {
  input: Ray;
  /** 主光线在两片透镜上的命中点。 */
  points: [Vector3, Vector3];
  /** 输出主光线（起点在第二片透镜上）。 */
  output: Ray;
  inputRadiusMm: number;
  outputRadiusMm: number;
  /** 实测放大倍率（出射位移 / 入射位移）。 */
  measuredMagnification: number;
  inputOffsetMm: number;
  outputOffsetMm: number;
  /** 输出方向与输入方向的夹角（度）；afocal 且平行入射时应为 0。 */
  directionDeviationDeg: number;
  /** 输出光束会聚度（1/mm，正 = 会聚）。 */
  outputVergence: number;
  separationMm: number;
  travelMm: number;
  lenses: { negative: TelescopeLens; positive: TelescopeLens };
  apertureClear: boolean;
}

/**
 * 追迹一条平行于光轴、带横向位移 δ 的光线通过望远镜。
 *
 * 输出应为平行于光轴、位移为 M·δ 的光线（专利 ΔX_BET = M·Δx），
 * 光束半径同比放大 M 倍。执行器使镜距偏离 afocal 时输出不再平行 —— 这正是调焦来源。
 */
export function traceTelescope(
  geom: TelescopeGeometry,
  input: Ray,
  inputRadiusMm: number,
  travelMm = 0,
): TelescopeTrace {
  const lenses = telescopeLensesAt(geom, travelMm);
  const axis = new Vector3(lenses.negative.center.x, lenses.negative.center.y, 0);
  const f1 = lenses.negative.focalLengthMm;
  const f2 = lenses.positive.focalLengthMm;
  const gap = lenses.separationMm;

  // 与第一片（凹）透镜所在平面的交点
  const dz = Math.abs(input.direction.z) < 1e-12 ? -1e-12 : input.direction.z;
  const tIn = (lenses.negative.center.z - input.origin.z) / dz;
  const pointIn = input.origin.clone().addScaledVector(input.direction, tIn);

  // 逐面近轴追迹（自然坡度 m = dy/dz）。两个横截面各自独立、用同一组公式。
  //   1) 凹镜给的角冲量
  //   2) 自由传播 gap
  //   3) 凸镜给的角冲量
  const inX = pointIn.x - axis.x;
  const inY = pointIn.y - axis.y;
  const mInX = input.direction.x / dz;
  const mInY = input.direction.y / dz;

  // 用与系统矩阵完全相同的薄透镜/传播算子逐步追迹，避免两处各写一套符号约定。
  const stepX = stepThroughLenses(f1, f2, gap, inX, mInX);
  const stepY = stepThroughLenses(f1, f2, gap, inY, mInY);

  const pointOut = new Vector3(axis.x + stepX.y2, axis.y + stepY.y2, lenses.positive.center.z);
  // direction = normalize((m_x, m_y, −1))
  const outputDirection = new Vector3(stepX.m2, stepY.m2, -1).normalize();

  const inputOffsetMm = Math.hypot(inX, inY);
  const outputOffsetMm = Math.hypot(stepX.y2, stepY.y2);

  /**
   * 输出光束半径 = (gap/f₂ + 1)·输入半径。
   *
   * 【为什么是这个式子】平行入射、高度 r 的边缘光线，经凹镜后坡度 m₁ = r/|f₁|，
   * 传播 gap 后高度 y₂ = r + gap·m₁ = r·(1 + gap/|f₁|)，
   * 再经凸镜改坡度但不改高度，故出射高度比 = 1 + gap/|f₁|。
   * 位移 δ 走的是同一组线性关系，比值相同。
   * afocal（gap = f₂ − f₁ = f₂ + |f₁|）时该比值化为 1 + (f₂+|f₁|)/|f₁| = f₂/|f₁| = M
   * —— 于是"口径放大 M 倍"与"位移放大 M 倍（专利 ΔX_BET = M·Δx）"是同一个数。
   */
  const lateralScale = 1 + gap / Math.abs(f1);
  const outputRadiusMm = Math.abs(inputRadiusMm * lateralScale);

  const deviationRad = Math.acos(
    clamp(input.direction.clone().normalize().dot(outputDirection), -1, 1),
  );

  return {
    input,
    points: [pointIn, pointOut],
    output: makeRay(pointOut, outputDirection),
    inputRadiusMm,
    outputRadiusMm,
    measuredMagnification: outputOffsetMm / Math.max(1e-12, inputOffsetMm),
    inputOffsetMm,
    outputOffsetMm,
    directionDeviationDeg: (deviationRad * 180) / Math.PI,
    outputVergence: telescopeOutputVergence(geom, travelMm),
    separationMm: gap,
    travelMm,
    lenses,
    apertureClear:
      inputOffsetMm + inputRadiusMm <= lenses.negative.apertureMm / 2 &&
      outputOffsetMm + outputRadiusMm <= lenses.positive.apertureMm / 2,
  };
}

/** 轴上准直输入光线的标准追迹（供 Z 换算与测试使用）。 */
export function traceAxialTelescope(
  geom: TelescopeGeometry,
  inputRadiusMm: number,
  travelMm: number,
  fromAboveMm = 40,
): TelescopeTrace {
  return traceTelescope(
    geom,
    makeRay(
      new Vector3(geom.negative.center.x, geom.negative.center.y, geom.negative.center.z + fromAboveMm),
      new Vector3(0, 0, -1),
    ),
    inputRadiusMm,
    travelMm,
  );
}

/* ------------------------------------------------------------------ *
 * Z 动态调焦：与 SCANLAB 模式共用同一套物镜等效关系
 * ------------------------------------------------------------------ */

/**
 * 物镜内部等效扩束比（**教学参数**，未公开）。
 *
 * 它的作用是把"望远镜输出的会聚度"折算成"物镜入瞳处的会聚度"：
 * 物镜内部先扩束 M_obj 倍，波前曲率随之按 M_obj² 缩小。
 * 取 4 使执行器毫米级行程正好对应毫米级焦点位移量级。
 */
export function objectiveInternalMagnification(): number {
  return NOVANTA_OBJECTIVE.internalMagnification;
}

/** 物镜入瞳处的会聚度 ← 望远镜输出会聚度。 */
export function pupilVergenceFromTelescope(telescopeVergence: number): number {
  const m2 = objectiveInternalMagnification() ** 2;
  return telescopeVergence / m2;
}

/** 望远镜输出会聚度 ← 物镜入瞳处应有的会聚度。 */
export function telescopeVergenceFromPupil(pupilVergence: number): number {
  const m2 = objectiveInternalMagnification() ** 2;
  return pupilVergence * m2;
}

/** 焦点 Z 平移 mm ← 望远镜输出会聚度。 */
export function focusShiftFromTelescopeVergence(telescopeVergence: number): number {
  return focusZFromPupilVergence(pupilVergenceFromTelescope(telescopeVergence));
}

/** 望远镜输出会聚度 ← 目标焦点 Z 平移 mm。 */
export function telescopeVergenceForFocusShift(zMm: number): number {
  return telescopeVergenceFromPupil(pupilVergenceForFocusZ(zMm));
}

/** 给定执行器行程下的焦点 Z 平移 mm。 */
export function focusShiftAtTravel(geom: TelescopeGeometry, travelMm: number): number {
  return focusShiftFromTelescopeVergence(telescopeOutputVergence(geom, travelMm));
}

/**
 * 目标焦点 Z 平移 → Z 执行器行程（二分法）。
 * 映射在本模型参数下单调；超出教学行程时夹到端点并置 saturated。
 */
export function telescopeTravelForFocusShift(
  geom: TelescopeGeometry,
  zMm: number,
): { travelMm: number; saturated: boolean } {
  const evaluate = (travel: number) => focusShiftAtTravel(geom, travel) - zMm;
  let lo = -geom.maxTravelMm;
  let hi = geom.maxTravelMm;
  const fLo = evaluate(lo);
  const fHi = evaluate(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return { travelMm: 0, saturated: true };
  if (fLo > 0) return { travelMm: lo, saturated: true };
  if (fHi < 0) return { travelMm: hi, saturated: true };
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid) > 0) hi = mid;
    else lo = mid;
  }
  return { travelMm: (lo + hi) / 2, saturated: false };
}

/** 该执行器行程下，经望远镜后的光束半径增量（专利：不再准直 → NA 变化）。 */
export function outputBeamRadiusAt(
  geom: TelescopeGeometry,
  travelMm: number,
  inputRadiusMm = 1,
): number {
  return traceAxialTelescope(geom, inputRadiusMm, travelMm).outputRadiusMm;
}
