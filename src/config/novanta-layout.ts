/**
 * Novanta / ARGES —— Patent-Derived Precession Architecture 的集中配置。
 *
 * 本文件是 Novanta 模式**唯一**的数值来源：任何"教学参数"都写在这里并注明，
 * 不允许散落在光学或渲染代码里当 magic number（仓库既有约定）。
 *
 * 事实分级（与 public-specs.ts 的 TrustLevel 一致）：
 *   - 专利明文的结构与关系 ← DE102004053298B4，标 '专利原理'
 *   - 当前型号公开规格      ← PE III 官方数据表，标 '公开确认'
 *   - 为讲清原理而自选的数值 ← '教学等效'
 *
 * 依据原文（DE102004053298B4，ARGES）：
 *   - "The wobble unit is in particular made of ... an arrangement formed of
 *      two plane-parallel windows ... both ... rotatably mounted, wherein the
 *      respective axes of rotation and the propagation direction of the laser
 *      beam are orthogonal to each other."
 *   - "A closer inspection shows that when tilting the plates dependent on a
 *      sine function or a cosine function, no exact circular path of the
 *      generated beam offset is achieved. The deviation is about one percent
 *      at the used tilt angles of about 18°."
 *   - "The beam dislocations which can be generated practically with the
 *      described tumbling unit are in the range of a few millimeters. To obtain
 *      the desired angle of incidence in the focus of the sample, this
 *      displacement is not enough and must be strengthened. The beam expansion
 *      telescope serves this purpose."
 *   - "ΔX_BET = M · Δx"，"M is thus simultaneously the magnification factor of
 *      the telescope"，M = f₂/f₁。
 *   - Galilei 望远镜（凹 + 凸）因**结构更短**且**避免镜组间焦点**而被优先采用。
 *   - 凹透镜与/或准直镜组可沿光轴**毫米级**移动 → 改变数值孔径、光束不再准直，
 *     "Damit geht eine Änderung der Z-Position des Brennflecks einher."
 *   - Scanblock = 两面装在振镜上的独立反射镜。
 *
 * 明确不采用的说法：**不能**声称当前 PE III 的内部机械布局、平板尺寸、玻璃材料、
 * 镜距、透镜曲率或执行器结构与 2004 年专利一致。
 */

/**
 * 两平面板（wobble unit）的教学参数。
 * 专利明文：两块板都转动、转轴正交且都与传播方向正交、galvo 驱动、
 * 位移与折射率/板厚/入射角有关。**数值全部是教学选取。**
 */
export const NOVANTA_PLATES = {
  /** 板 A：绕 X 轴倾斜 → 横向位移沿 Y。 */
  plateA: {
    /** 转轴名称（用于 UI 文案）。 */
    rotationAxisLabel: 'X 轴（局部横向轴）',
    /** 折射导致的位移方向。 */
    shiftAxisLabel: 'Y',
  },
  /** 板 B：绕 Y 轴倾斜 → 横向位移沿 X。 */
  plateB: {
    rotationAxisLabel: 'Y 轴（局部横向轴）',
    shiftAxisLabel: 'X',
  },
  /** 板厚 mm —— 教学等效。 */
  thicknessMm: 12,
  /** 玻璃折射率 —— 教学等效（未公开材料）。 */
  refractiveIndex: 1.52,
  /** 板口径 mm —— 教学等效。 */
  apertureMm: 30,
  /**
   * 板 A 与板 B 之间的轴向间距 mm —— 教学等效。
   * 只要板 B 口径能接受板 A 造成的位移，两板先后顺序在数学上可交换（位移相加）。
   */
  spacingMm: 36,
  /**
   * 教学机械扫描上限（度）—— 教学等效，非厂商机械行程。
   * 专利举例使用"约 18°"的 Kippwinkel，本模型把上限取在它之上。
   */
  maxMechanicalTiltDeg: 20,
  /** 默认进动机械幅值（度）—— 教学等效。 */
  defaultAmplitudeDeg: 6,
  /** 默认相位差（度）：90° 得到近似圆轨迹，其它值得到椭圆/Lissajous。 */
  defaultPhaseDeg: 90,
  /** 零位机械角（度）：板面垂直于光轴，垂直入射不产生位移。 */
  neutralTiltDeg: 0,
} as const;

/**
 * 两板在本模型教学参数下可产生的位移范围（由 plateShiftCurve 解出，非专利数值）：
 *   ±20° 机械角 → 约 ±1.50 mm（单板）。
 * 注意位移对倾角是**非线性**的，因此不能用"mm/度"的线性灵敏度外推。
 */
export const NOVANTA_PLATE_SHIFT_AT_LIMIT_MM = 1.5;

/**
 * Beam-expander telescope（同时承担动态调焦）的教学参数。
 *
 * 公开依据：专利明文"两块板之后是 beam-expander telescope"、放大关系 ΔX = M·Δx、
 * 优选 Galilei（凹+凸）、凹透镜与/或准直镜组可沿光轴毫米级移动以改变
 * 数值孔径与焦点 Z 位置。
 *
 * 未公开：真实焦距、镜距、曲率、通光口径与执行器行程。
 * 因此下面每一个数字都标 '教学等效'，只在 UI 的"教学等效"层级出现。
 */
export const NOVANTA_TELESCOPE = {
  /** 第一片：凹（负）透镜焦距 mm —— 教学等效。 */
  negativeFocalLengthMm: -15,
  /** 第二片：凸（正）准直透镜焦距 mm —— 教学等效。 */
  positiveFocalLengthMm: 60,
  /**
   * 零位镜距 mm —— 满足"两镜组焦点重合"（afocal）条件。
   *
   * 【推导】平行光在高度 δ 入射凹镜（f₁ < 0）后以坡度 δ/|f₁| 发散，
   * 该发散光线的反向延长线汇聚于凹镜下游 **|f₁|** 处的虚点（与 δ 无关）。
   * 凸镜（f₂ > 0）要把这个虚点当作自己的**物方焦点**才能输出准直光，
   * 即虚点须落在凸镜上游 f₂ 处：
   *     d = |f₁| + f₂ + |f₁| = f₂ + 2|f₁|
   * 例：f₁ = −15、f₂ = +60 → d = 90 mm。
   *
   * 【踩过的坑】曾误写 d = f₂ + |f₁|（相当于把虚点当成落在凹镜自身焦点上），
   * 结果望远镜既不共焦也不准直：出射光带着 −δ·(1/f₁ + 1/f₂) 的残余倾角，
   * 实测倍率与口径放大倍率也会互相矛盾。
   * galilean-telescope.test.ts 对"afocal 时出射严格平行、实测倍率 = 矩阵 A 元、
   * C = 0"写了硬断言，就是为了钉死这个条件。
   *
   * Kepler 形式（两片正透镜、中间有实焦点）是 d = f₁ + f₂；专利正文只写
   * "两镜组的焦点重合（zusammenfallen）"，未给 d 的表达式。
   */
  get nominalSeparationMm(): number {
    return this.negativeFocalLengthMm + this.positiveFocalLengthMm;
  },
  /**
   * 望远镜横向放大倍率 —— **由 afocal 条件解出**，不是 f₂/|f₁|。
   * 本配置 d = 90、f₂ = 60 ⇒ M = d/f₂ = 1 + 2|f₁|/f₂ = 3。
   * 实测值见 telescopeMagnificationAt()，测试断言两者一致。
   */
  get magnification(): number {
    return this.positiveFocalLengthMm / Math.abs(this.negativeFocalLengthMm);
  },
  /** 镜片绘制口径 mm —— 教学等效（需容纳放大后的光束与位移）。 */
  apertureMm: 25,
  /** 镜片绘制厚度 mm —— 教学等效。 */
  lensThicknessMm: 2.4,
  /**
   * Z 执行器行程 ±mm —— 教学等效。
   * 专利只说"毫米级（im Millimeterbereich）"移动镜组，未给行程数值。
   * 本模型取 ±1.5 mm，在本路线物镜等效参数下对应约 ±0.26 mm 的焦点 Z 范围。
   */
  maxAxialTravelMm: 1.5,
  /** 移动哪一片：专利写"凹透镜与/或准直镜组可沿光轴移动"。 */
  movedElement: 'negative' as 'negative' | 'positive',
} as const;

/**
 * 物镜等效参数。
 *
 * 公开确认：PE III 物镜焦距 **60 mm**（官方数据表）。
 * 未公开：有效焦距、内部镜组、入射净孔径与工作距离。
 *
 * 教学选取：令有效焦距与公开焦距一致（Feff = f = 60 mm）。
 * 这样两个公开事实——60 mm 物镜 + 放大后的平行位移——互相自洽：
 *   AOI = atan(h / Feff)，h = M·Δx，正好给出量级合适的光束倾角。
 * 【教学等效】不可据此推断 PE III 的有效焦距或内部结构。
 */
export const NOVANTA_OBJECTIVE = {
  /** 公开物镜焦距 mm（PE III 数据表）。 */
  focalLengthMm: 60,
  /** 有效焦距 mm —— **教学选取**，未公开；本模型取与焦距相同。 */
  effectiveFocalLengthMm: 60,
  /**
   * 物镜内部等效扩束比 —— **教学等效**，未公开。
   *
   * 作用：把望远镜输出的会聚度折算到物镜入瞳（按 M_obj² 缩小），
   * 从而让"执行器毫米级行程 → 毫米级焦点 Z 位移"量级自洽。
   * 它不是 PE III 的公开参数，也不能据此推断实机镜组数量或曲率。
   */
  internalMagnification: 1,
  /**
   * 物镜入瞳的**绘制**直径 mm —— 教学等效。
   *
   * 必须容纳放大后的位移 2·M·δmax（M 为望远镜放大率、δmax 为单板最大位移）
   * 与光束口径；数据表未给出 PE III 的入射净孔径，因此这是本模型自选值，
   * 不代表实机孔径。
   */
  drawnPupilDiameterMm: 32,
  /** 镜筒绘制半径 mm —— 教学等效。 */
  barrelRadiusMm: 16,
  /** 镜筒下端（聚焦镜）z mm。 */
  lastLensZ: 60,
  /** 物镜机械筒底/顶 z mm —— 教学等效。 */
  barrelBottomZ: 62,
  /**
   * 物镜筒顶 z mm —— 教学等效。
   *
   * **必须低于两片振镜**：45° 折转对的镜心正好落在竖直光路上
   * （见 NOVANTA_AXIS.scanBlock 的推导），镜片宽 32 mm，
   * 若镜心落在筒身区间内，镜片就会横穿镜筒（穿模）。
   * 因此把筒顶压到振镜之下，让 scanblock 坐在物镜上方。
   */
  barrelTopZ: 133,
  /** 保护玻璃与喷嘴 z mm —— 教学等效。 */
  protectiveWindowZ: 24,
  gasNozzleZ: 14,
  /** 入射光束典型直径 mm —— 教学等效（数据表未给净孔径）。 */
  nominalInputBeamDiameterMm: 2,
} as const;

/**
 * 光路轴向布局（mm，世界坐标；+Z 由工件指向扫描头，名义传播方向 -Z）。
 * 拓扑顺序来自专利摘要："beam attenuation unit (I) → wobble unit (II) →
 * beam expander telescope (III) → scan block (IV) → work unit (V)"。
 * 各元件之间的**具体距离**为教学选取。
 *
 * 【scanblock 的 45° 折转对，几何是唯一确定的】
 * 设上游竖直光束位于 x = X₀、机器光轴为 x = 0，两片 45° 镜等高、命中高度 H：
 *
 *   Y 振镜（上游）法向 n₁ ∝ d_out − d_in = (1,0,0) − (0,0,−1) = (1,0,1)
 *     → 平面 x + z = X₀ + H，**镜心正好落在入射光路上**：(−run, 0, H)
 *   X 振镜（下游）法向 n₂ ∝ (0,0,−1) − (1,0,0) = (−1,0,−1)
 *     → 平面 x + z = H，**镜心正好落在出射光路上**：(0, 0, H)
 *   水平段长 run = X₀（两命中点的横向差）
 *
 * 【两条硬约束，改任一条都会出问题】
 *  1. **镜心必须在它自己那条竖直光路的正上方/正下方。**
 *     折转对是"竖直进 → 水平走 → 竖直出"，镜心一旦横向错开，
 *     入射光就打不到镜面中心 —— 现象是"光路偏心打镜"。
 *     电机只能挂在**镜面平面内**、沿各自的转轴方向伸出去，不能把镜片整体搬走。
 *  2. **命中高度 H 必须在物镜筒顶之上。** 镜片宽 32 mm，
 *     若 H 落在筒身区间（62…133 mm）内，镜片会横穿镜筒（穿模）。
 *     因此 scanblock 整体坐在物镜上方，由镜筒上方的竖直段进入。
 */
export const NOVANTA_AXIS = {
  /** 工件表面。 */
  workpiece: 0,
  /** 保护玻璃 / 工艺气体喷嘴。 */
  gasNozzle: NOVANTA_OBJECTIVE.gasNozzleZ,
  protectiveWindow: NOVANTA_OBJECTIVE.protectiveWindowZ,
  /** 聚焦镜（物镜后端）。 */
  objectiveLastLens: NOVANTA_OBJECTIVE.lastLensZ,
  objectiveBottom: NOVANTA_OBJECTIVE.barrelBottomZ,
  objectiveTop: NOVANTA_OBJECTIVE.barrelTopZ,
  /**
   * 物镜入瞳参考高度 = 下游 X 振镜的**命中高度**，取在物镜筒顶之上。
   *
   * 该命中点同时是"最后一片振镜"与"等效入瞳参考"，
   * 因此平板位移到达焦点时的耦合项 (1 − L/f) 中 L = 0。
   * 取在筒顶之上的原因见 NOVANTA_AXIS 顶部注释（否则镜片会横穿镜筒）。
   */
  entrancePupil: 180,
  /** 下游 X 振镜：镜心就在出射光路上（x = 机器光轴 0, y = 0, z = 命中高度）。 */
  xGalvo: 180,
  /** 上游 Y 振镜：镜心就在入射光路上（x = −run, y = 0, z = 命中高度）。 */
  yGalvo: 180,
  /**
   * 两振镜之间的水平段长度 mm —— 等于上游竖直光路到机器光轴的横向距离。
   * 同时决定两片镜心的横向位置：Y 镜心在 x = −run，X 镜心在 x = 0。
   */
  scanBlockRunMm: 28,
  /**
   * 望远镜：凸（准直）镜与凹（负）镜。
   * 两者间距必须等于 |f₁| + f₂ = 75 mm 才是 afocal（专利：两镜组焦点重合）；
   * 该间距由配置常量保证，不在这里手写。
   */
  telescopePositiveLens: 307,
  telescopeNegativeLens: 307 + NOVANTA_TELESCOPE.nominalSeparationMm,
  /** 两块平行板：板 B 在下游，板 A 在上游。 */
  plateB: 407,
  plateA: 443,
  /** 光束衰减单元（专利摘要中的 I，只画不参与追迹）。 */
  beamAttenuator: 487,
  /** 激光入口。 */
  inlet: 536,
  /** 外壳上/下边界（参考官方外形图总体高度 549 mm 的量级，教学示意）。 */
  housingTop: 560,
  housingBottom: -10,
} as const;

/**
 * 光束横向布局（mm）。
 *
 * scanblock 的 45° 折转对有一个**确定的几何后果**：竖直下行光束在两片 45° 镜之间
 * 横移 run，因此"入光竖直线"与"出光竖直线"必然相差 run。
 * 本模型选择让**折转之后的出射段落在机器光轴 x = 0 上**（物镜、工件都以它为基准），
 * 于是一整段上游竖直线（激光入口 → 两块平板 → 望远镜 → 上游振镜）位于 x = run。
 *
 * 这与 SCANLAB 模式的处理方向相反（那边把 X 振镜的命中点当等效入瞳参考），
 * 但两条路线都在自己的文件里把这件事写清楚，不共用同一个拓扑假设。
 * 【教学等效】具体取哪一段落在光轴上，专利未规定。
 */
export const NOVANTA_BEAM_PATH = {
  /** 上游竖直段（激光入口 → 平板 → 望远镜 → 上游振镜）的横向位置。 */
  upstreamAxis: { x: -28, y: 0 },
  /** 折转之后的机器光轴：物镜与工件以此为准。 */
  machineAxis: { x: 0, y: 0 },
} as const;

/**
 * 进动 / 轨迹演示的教学参数。
 * 专利明文：一板按正弦、另一板按相移后的正弦倾斜 → Lissajous（圆或椭圆）；
 * 改变幅值或相位差即改变轨迹。数值为教学选取。
 */
export const NOVANTA_PRECESSION = {
  /** 默认机械幅值（度）。 */
  amplitudeDeg: NOVANTA_PLATES.defaultAmplitudeDeg,
  /** 默认相位差（度），90° 对应近似圆。 */
  phaseDeg: NOVANTA_PLATES.defaultPhaseDeg,
  /** 轨迹采样点数（一圈）。 */
  samplesPerRevolution: 360,
  /**
   * 补偿模式的目标合成位移半径 mm —— 教学等效。
   * 取 0.8 mm：本模型参数下逆解出的机械角约 ±11°，既在行程内、又能看清轨迹。
   * 更大的半径会先把机械角顶到教学行程上限（±1.50 mm 对应 ±20°）。
   */
  targetRadiusMm: 0.8,
} as const;

/**
 * 事实边界清单：Novanta 模式必须能在界面上直接查到这三类内容。
 * 与 SCANLAB 模式的 public-specs.ts 分级体系一致。
 */
export const NOVANTA_FACT_BOUNDARY = {
  publiclyConfirmed: [
    '五轴：X / Y / Z 坐标 + 两个光束倾角（PE III 官方数据表）',
    '物镜焦距 60 mm（PE III 官方数据表）',
    '进动频率 300–650 Hz（18000–39000 rpm，官方数据表）',
    '波长：VIS 515–540 nm / NIR 1020–1080 nm（官方数据表）',
    '水冷；吹扫气 N₂ 或其它；输入线偏振 / 输出圆偏振（官方数据表）',
    '外形参考尺寸量级 549 × 381.1 × 216 mm（官方外形图）',
  ],
  patentPrinciples: [
    'wobble unit 由两块 plane-parallel window（平行平面窗/板）组成',
    '两块板都可转动，且分别由振镜单元驱动',
    '两块板的转轴互相正交，且都与激光传播方向正交',
    '斜入射时平板靠折射产生平行于传播方向的横向位移',
    '出射光保持与原光束平行（只位移、不改变方向）',
    '两块板联合可实现任意方向的平行位移',
    '一板正弦倾斜 + 另一板相移正弦倾斜 → 圆 / 椭圆 / Lissajous 轨迹',
    'wobble unit 之后是 beam-expander telescope',
    '位移放大关系 ΔX_BET = M · Δx，M = f₂/f₁ 同时是望远镜放大率',
    '望远镜优先采用 Galilei 形式（结构更短、镜组之间无焦点）',
    '移动望远镜中一片透镜可改变数值孔径与焦点 Z 位置',
    '望远镜之后是 scanblock（两面振镜反射镜），最后是聚焦工作单元',
    '光路前端还有强度调节的光束衰减单元 (I)',
  ],
  educationalEquivalent: [
    '两块平行板的具体尺寸、口径与两板间距',
    '板厚默认值与玻璃折射率默认值',
    '板的零位定义与机械倾斜扫描上限',
    'Galilei 望远镜的具体焦距 f₁ / f₂、镜距与放大倍率 M',
    'Z 执行器的具体行程数值（专利只说"毫米级"）',
    '物镜的有效焦距、内部镜组、入射净孔径与工作距离',
    '"精确圆补偿"逆解算法（**控制器实际算法未公开**）',
    '伺服增益、标定矩阵与查找表',
    '当前 PE III 的内部机械布局与真实镜片参数',
    '本页的光路轴向距离与外壳包络',
  ],
} as const;

/** UI 文案：Novanta 模式正式名称与副标题。 */
export const NOVANTA_TITLE = {
  name: 'Novanta / ARGES — Patent-Derived Precession Architecture',
  subtitle:
    'Educational reconstruction from public ARGES patent principles; not an internal CAD reproduction of PE III.',
  nameZh: 'Novanta / ARGES — 基于公开专利的进动架构',
  subtitleZh:
    '依据公开 ARGES 专利原理建立的教学重建；不是 PE III 实机内部结构的 CAD 复刻。',
} as const;
