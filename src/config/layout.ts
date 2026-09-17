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
 *   激光入口 (-44,-28)
 *        │ -Z
 *   α 平行移束模块   ：把光束沿 +X 平移 28 mm（δ_α = 0 时）→ (-16,-28)
 *        │
 *   β 平行移束模块   ：把光束沿 +Y 平移 28 mm（δ_β = 0 时）→ (-16,  0)
 *        │
 *   Z 动态调焦等效模块（折返）→ (-16, 0)
 *        │
 *   监测分光元件
 *        │
 *   X 振镜 (-16, 0, 150)：折向 +X
 *        │ 水平段（两振镜同高，这是真实扫描头的折返结构）
 *   Y 振镜 (  0, 0, 150)：折回 -Z，同时它所在平面就是物镜入瞳平面
 *        │
 *   物镜（入瞳 150 → 后透镜组 75 → 工件 0）
 *
 * 因为 Y 振镜平面 = 物镜入瞳平面，光束在入瞳处的高度 h 与坡度 u 决定了
 *   X_focus = Feff·u、AOI = atan(-h/Feff)，而 X 振镜与 Y 振镜的 16 mm 间距
 * 会自然带来"移动焦点时把入射角也带偏"的真实耦合 —— 这正是五轴必须联合标定的原因。
 */

/**
 * 平行移束模块所需的入光横向偏移（相对模块输出点）。
 * = -(静态移束量 c1-c2) - √2 × 可动镜台阶，由模块几何解出。
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
  /** 物镜最后一片透镜（工作距离基准，公开值 75 mm）。 */
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
  /** Z 模块：可动折转镜 / 变焦反射镜 / 随动折返镜。 */
  zGalvo: 240,
  zCurvedMirror: 240,
  zFoldMirror: 218,
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
 *   三面平面镜，一面可转（26，振镜驱动）、两面固定（28、30），三镜法向共面，
 *   光束反射四次，第 1 次与第 4 次都落在可转镜上。
 *
 * 本模型内部结构（局部坐标，输出点即第 4 次命中点 B）：
 *   入光沿 -Z 打到可动镜组第 1 块镜面的 A 点；
 *   A → F1（平面 x+z = c1）→ F2（同法向，平面 x+z = c2）→ 回到可动镜组第 4 点 B → 沿 -Z 出射。
 *
 * 三条可验证的结论（tests/parallel-shift.test.ts）：
 *   1. 两固定镜法向相同 → 两次反射对方向的作用互相抵消
 *      （等价于专利的 φ_out = φ_in + 2(θ28 − θ30)，θ26 被消掉）；
 *   2. 因此输出方向与输入方向严格平行、与可动镜转角无关，
 *      转角只改变横向位移量 ≈ 2Δ mm/rad（Δ = c1 − c2）；
 *   3. 第 4 次反射的入射点在 A→B 连线上严格位于两点之间（几何必然），
 *      所以光束一定会穿过 A、B 之间的那块镜面区域，且第 4 次是从镜面另一侧入射。
 *      单块单面镜无法同时满足这两次反射 —— 模型据此把可动镜做成
 *      "同一振镜支架上的两块平行镜面、带一个法向小台阶"，
 *      使第 1 次与第 4 次都落在镜面正面。专利未描述可动镜的具体形式，
 *      此为教学等效处理（页面会标注）。
 *
 * 实测灵敏度（tests/parallel-shift.test.ts 会断言区间）：
 *   本组几何下约 2.2 mm/度机械角，因此 ±4.5 mm 的移束行程只需约 ±2° 机械角，
 *   机械角范围取 ±3°（约 ±6.7 mm）留出余量。实机灵敏度由镜间距决定（专利 [0016]）。
 */
export const SHIFT_MODULE = {
  /** 固定镜 1 所在平面 x + z = c1。 */
  c1: 23.5,
  /** 固定镜 2 所在平面 x + z = c2。 */
  c2: -27.5,
  /** c1 - c2：δ = 0 时两固定镜平面间距，决定位移灵敏度量级。 */
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
  /** 折转镜到变焦反射镜的水平距离（越小，"Z 变化带出的入瞳偏心"耦合越小）。 */
  armMm: 26,
  /** 折返镜相对折转镜的高度差。
   *  必须大于两片镜面各自的 Z 向半投影（20 mm 的 45° 镜片 ≈ 14 mm），
   *  否则两块镜片会互相重叠 —— 早期取 16 mm 时确实重叠了。 */
  dropMm: 34,
  /** 镜片边长。 */
  mirrorSizeMm: 20,
  /** 输出会聚度标定：每度执行器角对应的镜面功率（1/mm）。
   *  取值使 ±1 mm 焦点范围只需约 ±0.8° 执行器角，从而把
   *  "Z 变化 → 光束在折返镜上落点移动 → 入瞳偏心" 的耦合限制在
   *  可控范围内（实机同样由控制器联合补偿）。 */
  powerPerDeg: 1.0e-3,
} as const;

/** 物镜内部等效结构（对应公开的"焦距 75 mm / 有效焦距 25 mm"）。 */
export const OBJECTIVE = {
  /** 内部等效扩束倍率：2 mm 输入 → 6 mm，配合 75 mm 透镜得到 0.08 rad 全会聚角。 */
  internalMagnification: 3,
  /** 后透镜组焦距 mm（= 工作距离）。 */
  backFocalLengthMm: 75,
  /** 有效焦距 mm：X = Feff·u，AOI = atan(h/Feff)。 */
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
