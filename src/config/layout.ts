/**
 * 场景坐标与光路轴向布局（单位：mm，世界坐标 1 unit = 1 mm）。
 *
 * 坐标约定（计划书 §6）：
 *   +X 工件平面向右，+Y 工件平面向后，+Z 从工件指向扫描头；
 *   激光名义传播方向 -Z；工件表面 z = 0；名义焦点 (0,0,0)。
 *   Three.js 相机使用 camera.up = (0,0,1)。
 *
 * 光路拓扑（决定了各处光束中心的横向位置）：
 *
 *   激光入口（横向位置由 BEAM_PATH 计算）
 *        │ -Z
 *   α 平行移束模块：零位沿 +X 平移 51 + √2×11 mm
 *        │
 *   β 平行移束模块：零位沿 +Y 平移同样距离 → (-16, 0)
 *        │
 *   Z 动态调焦等效模块（折返）→ (-16, 0)
 *        │
 *   监测分光元件
 *        │
 *   Y 振镜 (-16, 0, 150)：折向 +X
 *        │ 水平段（专利未规定，本模型选取的折转拓扑）
 *   X 振镜 (0, 0, 150)：折回 -Z；名义中心高度取作入瞳参考高度
 *        │
 *   物镜（入瞳 150 → 后透镜组 75 → 工件 0）
 *
 * 入光与最终出光同向（-Z），不是反向。整条下游折转链（含教学 Z 模块）
 * 使 α 移束对应的入瞳 X 偏心反号、β 对应的 Y 偏心同号；量级不变。
 * 倾斜镜面不等于水平入瞳平面：本模型以 X 镜命中点定义等效入瞳 h/u。
 * 专利未规定，本模型选取 α 的 XZ 平面与 β 的 YZ 平面（互相垂直），
 * 输出高度为 470/330 mm；这不是两个 z=常数的平行光路平面。
 * 光束在入瞳处的高度 h 与近轴角度 u 决定了
 *   X_focus = Feff·u、AOI = atan(-h/Feff)，而 X 振镜与 Y 振镜的 16 mm 间距
 * 会带来本模型的焦点/入射角耦合，不代表实机标定矩阵。
 */

/**
 * 平行移束模块所需的入光横向偏移（相对模块输出点）。
 * = -(静态移束量 c1-c2) - √2 × 可动镜台阶，由模块几何解出。
 * 专利未规定，本模型选取此入光偏移；不是 precSYS 安装尺寸。
 */
export const SHIFT_INPUT_OFFSET_MM = -(51 + Math.SQRT2 * 11);

/** 光束中心在各段的横向位置（mm）。 */
export const BEAM_PATH = {
  /** 入光在 α 模块入口的横向位置：由模块几何决定。 */
  inlet: { x: -16 + SHIFT_INPUT_OFFSET_MM, y: SHIFT_INPUT_OFFSET_MM },
  afterAlpha: { x: -16, y: SHIFT_INPUT_OFFSET_MM },
  afterBeta: { x: -16, y: 0 },
  machineAxis: { x: 0, y: 0 },
} as const;

/** 光路各元件的轴向位置（mm）。 */
export const AXIS = {
  /** 工件表面。 */
  workpiece: 0,
  /** 保护玻璃抽屉。 */
  protectiveWindow: 12,
  /** 工艺气体喷嘴出口。 */
  gasNozzle: 20,
  /** 专利未规定，本模型选取最后透镜到工件 75 mm；公开焦距不等于工作距离。 */
  objectiveLastLens: 75,
  /** 物镜镜筒底面。 */
  objectiveBottom: 70,
  /** 物镜入瞳平面 = Y 振镜平面（= 入瞳到后透镜组正好 75 mm）。 */
  entrancePupil: 150,
  /** 物镜镜筒顶面。 */
  objectiveTop: 149,
  /** 两片振镜同高（折返结构）。 */
  galvoPlane: 150,
  /** 监测分光元件。 */
  monitoringSplitter: 176,
  /** 三透镜教学 Z 模块：L2 固定、L1/L3 移动。 */
  zLens1: 264,
  zLens2: 252,
  zLens3: 240,
  /** β 平行移束模块（沿 Y 移束）的输出高度。 */
  betaModuleOut: 330,
  /** α 平行移束模块（沿 X 移束）的输出高度。 */
  alphaModuleOut: 470,
  /** 波片与光束调理。 */
  halfWavePlate: 540,
  quarterWavePlate: 556,
  divergenceAdjust: 578,
  beamExpander: 604,
  /** 激光入口。 */
  inlet: 648,
  /** 外壳。 */
  housingTop: 690,
  housingBottom: -8,
} as const;

/**
 * α/β 平行移束模块的等效几何。
 *
 * 与专利 EP3932609B1 的对应关系（权利要求 1/3/4/5、说明书 [0015][0030][0032]）：
 *   至少三镜，一镜可转（26）、两镜固定（28、30）；可选法向共面，
 *   光束反射四次，第 1 次与第 4 次都落在可转镜上。
 *
 * 本模型内部结构（局部坐标，输出点即第 4 次命中点 B）：
 *   入光沿 -Z 打到可动镜组第 1 块镜面的 A 点；
 *   A → F1（平面 x+z = c1）→ F2（同法向，平面 x+z = c2）→ 回到可动镜组第 4 点 B → 沿 -Z 出射。
 *
 * 三条可验证的结论（tests/parallel-shift.test.ts）：
 *   1. 两固定镜法向相同 → 两次反射对方向的作用互相抵消
 *      （本模型反射定律推导 φ_out = φ_in + 2(θ28 − θ30)，不是专利给出的公式）；
 *   2. 因此输出方向与输入方向严格平行、与可动镜转角无关，
 *      转角只改变横向位移量 ≈ 2Δ mm/rad（Δ = c1 − c2）；
 *   3. F1→F2 穿过可动镜面所在平面，须按光束包络验证边缘避让。
 *      专利未规定，本模型选取同一支架上的两平行镜面与法向台阶；
 *      分体镜面并非专利单镜 26 的实物复原，不能推断实机背面入射或开孔。
 *
 * 实测灵敏度（tests/parallel-shift.test.ts 会断言区间）：
 *   本组几何下约 2.2 mm/度机械角，因此 ±4.5 mm 的移束行程只需约 ±2° 机械角，
 *   专利未规定，本模型选取 ±3.5°机械角；约 2.2 mm/°是模型结果，非实机指标。
 *   [0016] 仅定性讨论镜间距与位移灵敏度，不给出尺寸或公式。
 *   以下 c1/c2/step、22/30/38 mm 口径及 30 mm 固定镜尺寸，
 *   均为专利未规定、本模型选取的教学几何，本轮保持不变。
 */
export const SHIFT_MODULE = {
  /** 固定镜 1 所在平面 x + z = c1。 */
  c1: 23.5,
  /** 固定镜 2 所在平面 x + z = c2。 */
  c2: -27.5,
  /** c1 - c2 是平面方程常数差；实际法向间距为 delta/√2。 */
  delta: 51,
  /** 可动镜组两块镜面之间的法向小台阶 mm（让两次反射都落在镜面正面）。 */
  stepMm: 11,
  /** 第 1 块镜面（A 点）边长；第 1 次命中点固定不动，故只需覆盖光斑。 */
  inTileSizeMm: 22,
  /** 第 4 块镜面（B 点）沿镜面方向的边长；B 点随转角平移，需要更长。 */
  outTileSizeMm: 30,
  /** 镜面宽度。 */
  plateWidth: 38,
  /** 镜片厚度（画厚一点，便于看清镜面朝向）。 */
  plateThickness: 2.6,
  /** 固定镜边长（需覆盖全行程命中点漂移）。 */
  fixedMirrorSize: 30,
  /** 可动镜机械角工作范围 ±度。 */
  mechanicalRangeDeg: 3.5,
  /** 模块所需入光横向偏移（= -(静态移束量 + 台阶的 √2 倍)）。 */
  inputOffsetMm: SHIFT_INPUT_OFFSET_MM,
} as const;

/** Z 动态调焦等效模块的几何。 */
export const FOCUS_MODULE = {
  /** 凸/凹/凸方案有专利依据；以下焦距、间距、尺寸及联动规律为教学选取。 */
  focalLengthsMm: [36, -12, 36] as const,
  spacingMm: 12,
  lensDiameterMm: 20,
  lensThicknessMm: 2,
  maxTravelMm: 2,
  l1TravelRatio: 0.25,
} as const;

/** 物镜内部等效结构（对应公开的"焦距 75 mm / 有效焦距 25 mm"）。 */
export const OBJECTIVE = {
  /** 内部等效扩束倍率：2 mm 输入 → 6 mm，配合 75 mm 透镜得到 0.08 rad 全会聚角。 */
  internalMagnification: 3,
  /** 教学后透镜焦距；该模型将焦距取作传播距离，不是实机工作距离声明。 */
  backFocalLengthMm: 75,
  /** 有效焦距 mm：X = Feff·u，AOI = atan(-h/Feff)。 */
  effectiveFocalLengthMm: 25,
  /** 画出的入瞳半径 mm（教学等效，需容纳 ±4.5 mm 移束 + 1 mm 光束半径）。 */
  drawnPupilRadiusMm: 6.4,
  /** 镜筒上部半径（避开 X 振镜）。 */
  barrelTopRadiusMm: 7,
  /** 镜筒下部半径。 */
  barrelBottomRadiusMm: 12,
  /** 内部光束半径。 */
  internalBeamRadiusMm: 3,
  /** 内部后透镜画出的口径半径（示意值）。 */
  internalLensRadiusMm: 11,
} as const;

/** 振镜几何。 */
export const GALVO = {
  /** X 振镜横向偏移（相对光轴，-X 方向）：也是两振镜的间距。 */
  separationMm: 16,
  mirrorSizeMm: 17,
  mirrorThicknessMm: 3,
  /** 运动箭头视觉放大（光线仍按真实角度计算）。 */
  visualAngleGain: 2.2,
} as const;

/** 外壳（教学示意包络）。 */
export const HOUSING = {
  /** 中心位置。 */
  centerX: -32,
  centerY: -24,
  widthMm: 150,
  depthMm: 130,
  wallMm: 2,
  electronicsBay: { w: 120, d: 54, h: 160, centerZ: -100 },
  coolingPortZ: 40,
  purgePortZ: 620,
} as const;

/** 工件尺寸。 */
export const WORKPIECE = {
  sizeX: 96,
  sizeY: 96,
  thickness: 16,
} as const;
