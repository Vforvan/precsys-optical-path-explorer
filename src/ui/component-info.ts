/**
 * 部件信息卡与资料来源（计划书 §12.3、§18.4）。
 *
 * 点击部件后只显示六件事：名称、主动/固定/可选、输入是什么、输出改变了什么、
 * 与五个工程坐标的关系、信息可信等级。文字与可信等级都来自配置与光学层，
 * 不在渲染代码里临时编造。
 */

import type { TrustLevel } from '../config/public-specs';
import { EDUCATIONAL_NOTES, SOURCES, TRUST_LABEL } from '../config/public-specs';
import type { MirrorSpec } from '../optics/mirror';
import type { OpticalTrain } from '../optics/optical-train';
import type { AppState } from '../app-state';
import { NOVANTA_BOUNDARY_NOTES } from '../config/novanta-comparison';

export interface PartInfo {
  id: string;
  name: string;
  role: '主动' | '固定' | '可选' | '外围';
  input: string;
  output: string;
  coords: string;
  trust: TrustLevel;
  note: string;
  patentRef?: string;
  /** 该部件当前的实测读数（HTML 片段）—— 直接来自本帧追迹结果。 */
  measuredHtml?: string;
}

const STATIC_PARTS: Record<string, Omit<PartInfo, 'id'>> = {
  inlet: {
    name: '激光入口 / 光束调理单元',
    role: '可选',
    input: '外部激光器，入射净孔径 4 mm、典型光束直径 2 mm。',
    output: '改变光束直径（扩束 0.25–4×）、发散度与偏振状态，不改变焦点位置。',
    coords: '与五个工程坐标无直接关系，但决定焦斑与焦深。',
    trust: '公开确认',
    note: 'λ/2、λ/4 波片只做偏振调整，本页不做电磁场仿真；焦点处经光束调理后为圆偏振。',
  },
  'beam-conditioning': {
    name: '光束调理单元（可选件）',
    role: '可选',
    input: '外部激光器输出。',
    output: '可调整入射光束直径、位置、角度和发散度；可带独立吹扫壳体与保护窗。',
    coords: '影响焦斑尺寸与焦深，不直接改变 X/Y/Z/α/β。',
    trust: '公开确认',
    note: 'SCANLAB 官方脚注说明：电动扩束镜、电动偏振片等通常不包含在 precSYS 标准供货中。',
  },
  'expander': {
    name: '扩束/缩束镜组',
    role: '可选',
    input: '入射平行光束。',
    output: '改变光束直径 0.25–4 倍，从而改变焦斑与焦深。',
    coords: '不改变焦点位置与入射角。',
    trust: '公开确认',
    note: '页面上的扩束倍率只影响光束半径显示与光锥角。',
  },
  'half-wave': {
    name: 'λ/2 波片',
    role: '可选',
    input: '线偏振光。',
    output: '旋转偏振方向。',
    coords: '与坐标无关。',
    trust: '公开确认',
    note: '页面用图标说明偏振调整，不做电磁场仿真。',
  },
  'quarter-wave': {
    name: 'λ/4 波片',
    role: '可选',
    input: '线偏振光。',
    output: '把线偏振转换为圆偏振（公开资料：焦点处为圆偏振）。',
    coords: '与坐标无关。',
    trust: '公开确认',
    note: '与 λ/2 配合可调偏振态。',
  },
  'divergence': {
    name: '发散度调整',
    role: '可选',
    input: '准直光束。',
    output: '给光束一个很小的会聚或发散度，用于补偿上游光学。',
    coords: '间接影响焦点 Z。',
    trust: '公开确认',
    note: '本模型默认不启用，以免与 Z 模块功能混淆。',
  },
  objective: {
    name: '物镜',
    role: '固定',
    input: '入瞳处的近似平行光束（可偏心、可倾斜）。',
    output: '把光束聚焦到工件上；入射偏心 → 入射角 α/β，入射坡度 → 焦点 X/Y。',
    coords: '入瞳偏心 h 与坡度 u 共同决定 X/Y/Z 与 α/β。',
    trust: '教学等效',
    note: EDUCATIONAL_NOTES.objective,
  },
  'protective-window': {
    name: '快换保护玻璃抽屉',
    role: '固定',
    input: '—',
    output: '保护内部光学元件，可快速更换。',
    coords: '不参与坐标控制。',
    trust: '公开确认',
    note: '属于维护件；污染会影响透过率。',
  },
  'gas-nozzle': {
    name: '工艺气体喷嘴',
    role: '可选',
    input: '外部工艺气体（最大 6 bar，标准开口 1 mm）。',
    output: '改善排渣与加工质量，可在 x/y/z 三方向调节。',
    coords: '不改变光路，但限制可达视场（喷嘴开口）。',
    trust: '公开确认',
    note: '电控工艺气体阀通常不在 precSYS 标准供货内。',
  },
  'monitor-splitter': {
    name: '监测分光元件',
    role: '固定',
    input: '主光路中的一小部分光。',
    output: '取样光送到光束位置测量单元。',
    coords: '用于校正光束状态，不直接产生 X/Y/Z/α/β。',
    trust: '公开确认',
    note: '与自动精调配合使用。',
  },
  'position-sensor': {
    name: '光束位置测量单元',
    role: '固定',
    input: '分光元件送来的取样光。',
    output: '测量光束位置与角度偏差，供 Automatic Fine Adjustment 使用。',
    coords: '偏差被换算成五个内部轴的补偿量。',
    trust: '公开确认',
    note: '它修正的是"进入系统后的光束状态"，不等于成品尺寸闭环测量。',
  },
  workpiece: {
    name: '工件',
    role: '外围',
    input: '激光焦点与工艺气体。',
    output: '被去除材料形成孔或轮廓。',
    coords: '工件表面定义为 z = 0，焦点坐标即相对它的位置。',
    trust: '教学等效',
    note: '采用累计体素几何去除，仅切换加工策略清空。光斑与去除速率为教学参数，未标定脉冲能量、材料阈值与热效应，不能预测实机孔形或孔深。',
  },
  housing: {
    name: '主体外壳（教学示意包络）',
    role: '固定',
    input: '—',
    output: '封闭、正压吹扫的光路环境。',
    coords: '不参与坐标控制。',
    trust: '教学等效',
    note: '实机主体参考包络约 303.5 mm × 271 mm，且不含侧向物镜/观察组件与可选光束调理单元。',
  },
  electronics: {
    name: '控制电子学与嵌入式 PC',
    role: '主动',
    input: 'Ethernet / EtherCAT / PLC / 激光触发等接口信号。',
    output: '运行 DrillServer 与实时控制，驱动五个振镜轴。',
    coords: '接收 DrillControl 的工艺数据，输出五个执行轴命令。',
    trust: '公开确认',
    note: '页面上的 educationalInverseModel() 是等效逆映射，不是此处的真实算法。',
  },
  cooling: {
    name: '水冷回路',
    role: '固定',
    input: '冷却水（参考温度 25 °C）。',
    output: '分别冷却振镜轴与控制电子学，提升热稳定性。',
    coords: '不参与坐标控制，但影响长期漂移。',
    trust: '公开确认',
    note: '安装时需预留管路与最小弯曲半径。',
  },
  purge: {
    name: '正压吹扫气入口',
    role: '固定',
    input: '符合 ISO 8573-1:2010 [1:2:1] 的合成空气。',
    output: '保持光路正压，减少粉尘与烧蚀颗粒污染。',
    coords: '不参与坐标控制。',
    trust: '公开确认',
    note: '其他气体需咨询厂家。',
  },
  interface: {
    name: '接口区',
    role: '固定',
    input: '电源 30–33 V DC、最大 6 A；Ethernet、EtherCAT、PLC、激光连接器。',
    output: '与上位系统交换工艺数据与状态。',
    coords: '不参与坐标控制。',
    trust: '公开确认',
    note: '安装需预留连接器空间。',
  },
  external: {
    name: '外部系统（激光器 / 运动平台 / 安全防护）',
    role: '外围',
    input: '—',
    output: '构成完整激光加工设备。',
    coords: '外部平台的 XY/Z 精度需要与 precSYS 坐标联合标定。',
    trust: '公开确认',
    note: '官方脚注：激光器、整机安全防护与联锁、大行程平台与夹具通常不由 SCANLAB 标配提供。',
  },
};

/** 由镜片规格推导信息卡。 */
function infoFromMirrorSpec(spec: MirrorSpec): Omit<PartInfo, 'id'> {
  const movable = spec.kind === 'movable';
  return {
    name: spec.label,
    role: movable ? '主动' : '固定',
    input: movable ? '振镜驱动的机械转角（由控制器给出）。' : '上游光束。',
    output: movable
      ? '按反射定律改变光束方向或横向位移；本页每一帧都由镜面法向重新计算交点。'
      : '按反射定律折转光束。',
    coords: spec.id.startsWith('alpha')
      ? 'α 通道：改变入瞳 X 向偏心，主要影响入射角 α。'
      : spec.id.startsWith('beta')
        ? 'β 通道：改变入瞳 Y 向偏心，主要影响入射角 β。'
        : spec.id.startsWith('z-')
          ? 'Z 通道：改变物镜前光束会聚状态，主要影响焦点 Z。'
          : spec.id.startsWith('galvo-x')
            ? 'X 通道：改变入瞳坡度，主要影响焦点 X。'
            : 'Y 通道：改变入瞳坡度，主要影响焦点 Y。',
    trust: spec.trust,
    note: spec.note,
  };
}

/**
 * 取某个部件的信息。
 *
 * `state` 是 AppState：部件集合随技术路线变化（SCANLAB 有 α/β 反射模块与 Z 等效模块，
 * Novanta 有两块平行平板与 Galilei 望远镜），因此这里先按当前路线取链路对象。
 */
export function partInfo(id: string, state: AppState): PartInfo | null {
  if (state.vendor === 'novanta') return novantaPartInfo(id, state);
  return scanlabPartInfo(id, state.train);
}

/** Novanta / ARGES 路线的部件信息（含公开/专利/教学三级标签）。 */
function novantaPartInfo(id: string, state: AppState): PartInfo | null {
  const train = state.novantaTrain;
  const snapshot = state.snapshot();
  const trace = snapshot.trace.vendor === 'novanta' ? snapshot.trace.trace : null;

  // ---- 两块平行平板：按"专利原理"给出结构依据，并列出当前实测光学量
  const plate = [train.wobbleUnit.plateA, train.wobbleUnit.plateB].find((p) => p.id === id);
  if (plate) {
    const pose = plate.driveAxis === 'A' ? trace?.wobble?.poseA : trace?.wobble?.poseB;
    const tiltDeg =
      plate.driveAxis === 'A'
        ? ((state.snapshot().actuators as { actuators: { plateARad?: number } }).actuators.plateARad ?? 0) *
          (180 / Math.PI)
        : ((state.snapshot().actuators as { actuators: { plateBRad?: number } }).actuators.plateBRad ?? 0) *
          (180 / Math.PI);
    const measured = pose
      ? `<h3>当前姿态的实测光学量</h3>
         <dl class="kv">
           <dt>机械倾斜</dt><dd>${tiltDeg.toFixed(4)} °</dd>
           <dt>转轴</dt><dd>(${plate.rotationAxis.toArray().map((v) => v.toFixed(2)).join(', ')})</dd>
           <dt>板厚 / 折射率</dt><dd>${plate.thicknessMm} mm / ${plate.refractiveIndex}（教学参数）</dd>
           <dt>入射角 i</dt><dd>${pose.incidenceDeg.toFixed(4)} °</dd>
           <dt>玻璃内折射角 r</dt><dd>${pose.internalRefractionDeg.toFixed(4)} °</dd>
           <dt>出射面入射角</dt><dd>${pose.exitIncidenceDeg.toFixed(4)} °</dd>
           <dt>横向位移（带符号）</dt><dd>${pose.signedShiftMm.toFixed(5)} mm</dd>
           <dt>横向位移大小</dt><dd>${pose.shiftMagnitudeMm.toFixed(5)} mm</dd>
           <dt>出射方向误差</dt><dd class="good">${pose.directionDeviationDeg.toExponential(2)} °（应为 0）</dd>
           <dt>全内反射</dt><dd>${pose.totalInternalReflection ? '发生' : '未发生'}</dd>
         </dl>
         <p class="dim">画面上的青色短线是该面的法线；折射方向与位移都由向量 Snell 定律算出，
         与三维视口里的光线是同一次计算的结果。</p>`
      : '';
    return {
      id,
      name: plate.label,
      role: '主动',
      input: '来自上游的平行光束（名义沿 −Z 传播）。',
      output: `绕${plate.driveAxis === 'A' ? ' X ' : ' Y '}轴倾斜时，靠折射让光束产生沿 ${
        plate.driveAxis === 'A' ? 'Y' : 'X'
      } 方向的横向位移；出射光仍与入射光平行。`,
      coords:
        plate.driveAxis === 'A'
          ? '与另一块板正交：本板的位移主要贡献 AOI 的 Y 分量。'
          : '与另一块板正交：本板的位移主要贡献 AOI 的 X 分量。',
      trust: '专利原理',
      note:
        `${plate.note}\n` +
        `**AOI 与 Plane 是由两个倾角分量派生出的极坐标表达，不是"平板 A = AOI 轴、平板 B = Plane 轴"。**\n` +
        `${NOVANTA_BOUNDARY_NOTES.find((n) => n.key === 'noWedgeNoRisley')?.text ?? ''}`,
      patentRef: 'DE102004053298B4 —— Taumeleinheit：两块 planparallele Fenster，转轴正交且都垂直于传播方向；'
        + '斜入射靠折射产生平行位移；一板正弦、另一板相移正弦倾斜生成 Lissajous 轨迹。',
      measuredHtml: measured,
    };
  }

  // ---- 望远镜
  const lens = [train.telescope.negative, train.telescope.positive].find((l) => l.id === id);
  if (lens) {
    const t = trace?.telescope;
    const measured = t
      ? `<h3>当前状态的实测读数</h3>
         <dl class="kv">
           <dt>放大倍率 M</dt><dd>${t.measuredMagnification.toFixed(4)}（由 afocal 条件解出）</dd>
           <dt>位移（前 → 后）</dt><dd>${t.inputOffsetMm.toFixed(4)} → ${t.outputOffsetMm.toFixed(4)} mm</dd>
           <dt>光束直径（前 → 后）</dt><dd>${(2 * t.inputRadiusMm).toFixed(3)} → ${(2 * t.outputRadiusMm).toFixed(3)} mm</dd>
           <dt>Z 执行器行程</dt><dd>${t.travelMm.toFixed(4)} mm</dd>
           <dt>当前镜距</dt><dd>${t.separationMm.toFixed(3)} mm（零位 ${train.telescope.nominalSeparationMm} mm）</dd>
           <dt>出射会聚度</dt><dd>${t.outputVergence.toExponential(3)} /mm</dd>
           <dt>出射方向偏离</dt><dd>${t.directionDeviationDeg.toExponential(2)} °</dd>
         </dl>
         <p class="dim">"位移放大 M 倍"与"口径放大 M 倍"来自同一个 M，是同一件事的两面；
         零位镜距满足 afocal（出射严格平行），失配时才会引入会聚度 —— 那正是动态调焦的工作状态。</p>`
      : '';
    return {
      id,
      name: lens.label,
      role: '主动',
      input: '来自两块平行平板的平行光束（可带横向位移）。',
      output:
        lens.kind === 'negative'
          ? '先发散光束，使后续准直镜能在更短的轴向长度内完成扩束；同时把平行位移按 M 放大。'
          : '把发散光束重新准直，输出仍是平行光（位移已被放大 M 倍、口径也放大 M 倍）。',
      coords: 'Z 通道：本片的轴向位置改变物镜前光束的会聚度，从而移动焦点 Z。',
      trust: '教学等效',
      note:
        `焦距 ${lens.focalLengthMm} mm、口径 ${lens.apertureMm} mm、镜距与放大倍率均为**教学等效**：专利只公开"waltz 单元之后是扩束望远镜""ΔX = M·Δx""优选 Galilei 形式"以及"凹透镜与/或准直镜组可沿光轴毫米级移动"，未给出任何具体数值。\n` +
        `${NOVANTA_BOUNDARY_NOTES.find((n) => n.key === 'mAmplifiesBoth')?.text ?? ''}`,
      patentRef: 'DE102004053298B4 —— Strahl-Expander-Teleskop III：折射式；Galilei（凹＋凸）因结构更短、镜组间无实焦点而被优先采用；ΔX_BET = M·Δx。',
      measuredHtml: measured,
    };
  }

  // ---- 两片振镜
  const galvo = train.mirrors.find((m) => m.id === id);
  if (galvo) {
    const isX = id.endsWith('-x');
    const t = trace?.telescope;
    const measured = trace
      ? `<h3>当前实测读数</h3>
         <dl class="kv">
           <dt>焦点 X / Y</dt><dd>${trace.focus.xMm.toFixed(4)} / ${trace.focus.yMm.toFixed(4)} mm</dd>
           <dt>AOI α / β</dt><dd>${trace.focus.aoiXDeg.toFixed(4)} / ${trace.focus.aoiYDeg.toFixed(4)} °</dd>
           <dt>AOI 幅值 / 方位</dt><dd>${trace.focus.aoiMagnitudeDeg.toFixed(4)} ° / ${trace.focus.planeAngleDeg.toFixed(2)} °</dd>
           <dt>入瞳偏心</dt><dd>(${trace.pupil.hxMm.toFixed(4)}, ${trace.pupil.hyMm.toFixed(4)}) mm</dd>
         </dl>
         <p class="dim">AOI 幅值与方位是<b>由两个倾角分量派生的极坐标</b>，
         不是"一块平板对应一个轴"。${
           t ? `本帧望远镜把平板位移放大了 ${t.measuredMagnification.toFixed(3)} 倍。` : ''
         }</p>`
      : '';
    return {
      id,
      name: galvo.label,
      role: '主动',
      input: isX ? '来自上游振镜的水平光束。' : '来自望远镜的下行平行光束。',
      output: isX
        ? '把光束折回 −Z 并改变出射坡度，焦点沿工件 X 移动。'
        : '把 −Z 折向 +X 并改变出射坡度，焦点沿工件 Y 移动。',
      coords: isX ? 'X 通道。' : 'Y 通道（不在入瞳平面上，会带出少量入射角耦合）。',
      trust: '专利原理',
      note:
        '专利把 scanblock 描述为"两面装在振镜单元上的独立反射镜"，并把两片的角速度量级写在 90 rad/s 以上。此处位置、口径、转轴取向与通道映射为教学选取，未公开。',
      patentRef: 'DE102004053298B4 —— Scanblock IV：zwei rotierende Einzelspiegel auf Galvanometereinheiten。',
      measuredHtml: measured,
    };
  }

  // ---- 其余部件
  const novantaStatic: Record<string, Omit<PartInfo, 'id'>> = {
    objective: {
      name: '物镜 / 聚焦工作单元',
      role: '固定',
      input: '入瞳处的平行光束（带横向位移，可倾斜）。',
      output: '把光束聚焦到工件；入瞳偏心决定入射角，入瞳坡度决定焦点横向位置。',
      coords: '把入瞳状态的 (h, u) 映射到 (X, Y, AOI)。',
      trust: '公开确认',
      note:
        `公开确认：PE III 物镜焦距 **60 mm**（官方数据表）。未公开：有效焦距、内部镜组、入射净孔径与工作距离。\n` +
        '本模型为建立自洽的教学关系，令有效焦距 = 公开焦距 = 60 mm，并把它明确标为**教学选取**；不可据此推断实机内部结构。',
      patentRef: 'DE102004053298B4 —— Arbeitseinheit V：Fokussierungsoptik + Gasdüse。',
    },
    'novanta-attenuator': {
      name: '光束强度衰减单元（专利组件 I）',
      role: '可选',
      input: '外部激光器输出。',
      output: '调节入射光强。',
      coords: '与五个工程坐标无关。',
      trust: '专利原理',
      note:
        '专利摘要把"强度调节的光束衰减单元 (I)"列为光路第一级。**当前 PE III 是否仍包含该单元、其形式如何均未公开**，本页只画外形、不参与追迹。',
      patentRef: 'DE102004053298B4 —— Strahldämpfungseinheit I。',
    },
    'novanta-inlet': {
      name: '激光入口 / 光束衰减单元',
      role: '可选',
      input: '外部激光器。',
      output: '进入 wobble unit 前的准直光束。',
      coords: '不直接产生 X/Y/Z/α/β。',
      trust: '专利原理',
      note: '数据表未给出 PE III 的入射净孔径，因此页面上不标注孔径数值。',
    },
    'protective-window': {
      name: '快换保护玻璃',
      role: '固定',
      input: '—',
      output: '保护内部光学元件，可快速更换。',
      coords: '不参与坐标控制。',
      trust: '教学等效',
      note: '数据表提到镜头侧吹扫（Lens purge: Nitrogen / Any）与维护件，具体结构未公开；本页画法为教学示意。',
    },
    'gas-nozzle': {
      name: '工艺气体喷嘴',
      role: '固定',
      input: '外部工艺气体。',
      output: '改善排渣与加工质量。',
      coords: '不改变光路，但限制可达视场。',
      trust: '教学等效',
      note: '专利把工作单元描述为聚焦光学与气体喷嘴的组合；形状与尺寸未公开。',
    },
    workpiece: {
      name: '工件',
      role: '外围',
      input: '激光焦点与工艺气体。',
      output: '被去除材料形成孔或轮廓。',
      coords: '工件表面定义为 z = 0，焦点坐标即相对它的位置。',
      trust: '教学等效',
      note:
        '采用累计体素几何去除，仅切换加工策略清空。光斑与去除速率为教学参数，未标定脉冲能量、材料阈值与热效应，不能预测实机孔形或孔深。',
    },
  };
  const staticInfo = novantaStatic[id];
  if (staticInfo) return { id, ...staticInfo };

  // 模块级 id
  if (id === 'novanta-wobble-unit') {
    return {
      id,
      name: 'wobble unit（两块平行平板，整组）',
      role: '主动',
      input: '沿 −Z 传播的平行光束。',
      output: '输出仍与输入平行、但带二维横向位移的光束。',
      coords: 'α / β 两个倾角分量的来源；位移经望远镜放大后成为入瞳偏心。',
      trust: '专利原理',
      note:
        `${NOVANTA_BOUNDARY_NOTES.find((n) => n.key === 'plateNotAoiAxis')?.text ?? ''}\n` +
        `${NOVANTA_BOUNDARY_NOTES.find((n) => n.key === 'pe3IsNotPatentCad')?.text ?? ''}`,
      patentRef: 'DE102004053298B4 —— Taumeleinheit II。',
    };
  }
  return null;
}

/** SCANLAB 路线的部件信息（原有实现，未改动逻辑）。 */
function scanlabPartInfo(id: string, train: OpticalTrain): PartInfo | null {
  const spec = train.mirrors.find((m) => m.id === id);
  if (spec) return { id, ...infoFromMirrorSpec(spec) };

  const staticInfo = STATIC_PARTS[id];
  if (staticInfo) return { id, ...staticInfo };

  // 模块级 id（整组高亮）
  const moduleMap: Record<string, string> = {
    'alpha-module': 'alpha',
    'alpha-mount': 'alpha',
    'beta-module': 'beta',
    'beta-mount': 'beta',
    'z-module': 'z',
  };
  const key = moduleMap[id];
  if (key === 'alpha' || key === 'beta') {
    return {
      id,
      name: key === 'alpha' ? 'α 平行移束模块（整组）' : 'β 平行移束模块（整组）',
      role: '主动',
      input: '沿 -Z 传播的平行光束。',
      output: `沿 ${key === 'alpha' ? 'X' : 'Y'} 方向平行移束，输出方向与输入严格平行。`,
      coords: key === 'alpha' ? 'α 通道。' : 'β 通道。',
      trust: '教学等效',
      note: EDUCATIONAL_NOTES.shiftModuleInner,
      patentRef: 'EP3932609B1 Claim 1/4/5、[0015][0030][0032]',
    };
  }
  if (key === 'z') {
    return {
      id,
      name: 'Z 动态调焦等效模块（整组）',
      role: '主动',
      input: '平行光束。',
      output: '输出光束带轻微会聚或发散，使物镜焦点沿 Z 移动。',
      coords: 'Z 通道。',
      trust: '教学等效',
      note: EDUCATIONAL_NOTES.zModule,
    };
  }
  if (id === 'galvo-x' || id === 'galvo-y') {
    const isX = id === 'galvo-x';
    return {
      id,
      name: isX ? 'X 振镜' : 'Y 振镜',
      role: '主动',
      input: '来自 Z 模块的下行光束。',
      output: isX
        ? '在物镜入瞳平面上改变光束坡度 u，焦点沿工件 X 移动。'
        : '把光束折向 +X 并改变 Y 向坡度，焦点沿工件 Y 移动。',
      coords: isX ? 'X 通道（入瞳平面上，基本不产生偏心）。' : 'Y 通道（不在入瞳平面上，会带出少量入射角耦合）。',
      trust: '公开确认',
      note: '小镜片转角、低运动质量、数字编码器闭环，是 650 Hz 动态的基础。',
    };
  }
  return null;
}

/**
 * 把文案里的极简标记渲染成 HTML。
 *
 * 只支持两件事：`\n` → `<br />`、`**强调**` → `<b>强调</b>`。
 * 之所以要处理 `**`：配置里的说明文字为了可读性用了这种写法，
 * 如果直接塞进 innerHTML，读者看到的是满屏星号（本页历史上出现过）。
 */
export function renderInlineMarkup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br />');
}

/** 渲染部件信息卡。（snapshot 可选：给了就显示该部件当前实测的光学量） */
export function renderPartCard(
  container: HTMLElement,
  info: PartInfo | null,
  snapshot?: { trace: { hits: readonly { mirrorId: string; incidenceRad: number }[] } },
): void {
  if (!info) {
    container.innerHTML = `
      <h2>部件信息</h2>
      <p class="dim">点击三维视口中的镜片、模块、物镜或工件，这里会显示该部件的名称、作用、
      与五个工程坐标的关系，以及信息可信等级。</p>
      <h3>页面固定说明</h3>
      <p class="dim">${EDUCATIONAL_NOTES.axialScale}</p>
      <p class="dim">${EDUCATIONAL_NOTES.pupilAperture}</p>
      <p class="dim">${EDUCATIONAL_NOTES.inverseModel}</p>
    `;
    return;
  }

  // 当前光线在这块镜片上的实测角度（直接来自追迹结果，不是另外算的）
  const hit = snapshot?.trace.hits.find((h) => h.mirrorId === info.id);
  const angleBlock = hit
    ? `<h3>当前光线的实际角度</h3>
       <dl class="kv">
         <dt>入射角（光线与镜面法线夹角）</dt><dd>${((hit.incidenceRad * 180) / Math.PI).toFixed(2)} °</dd>
         <dt>入射到出射的方向转角</dt><dd>${(180 - (hit.incidenceRad * 2 * 180) / Math.PI).toFixed(2)} °</dd>
       </dl>
       <p class="dim">画面上的青色短线就是该点的镜面法线，白色横线是镜面方向；
       两条光线关于法线对称 —— 这就是模型的反射计算依据（d′ = d − 2(d·n)n）。</p>`
    : '';

  const trustClass =
    info.trust === '公开确认' ? 'public' : info.trust === '专利原理' ? 'patent' : '';
  container.innerHTML = `
    <h2>${info.name}<span class="badge badge-${
      info.trust === '公开确认' ? 'public' : info.trust === '专利原理' ? 'patent' : 'edu'
    }">${TRUST_LABEL[info.trust]}</span></h2>
    <dl class="kv">
      <dt>类型</dt><dd>${info.role}</dd>
      <dt>输入</dt><dd style="text-align:left">${info.input}</dd>
      <dt>输出改变</dt><dd style="text-align:left">${info.output}</dd>
      <dt>与坐标关系</dt><dd style="text-align:left">${info.coords}</dd>
    </dl>
    ${info.measuredHtml ?? ''}
    ${angleBlock}
    <div class="note ${trustClass}">${renderInlineMarkup(info.note)}${
      info.patentRef ? `<br /><b>依据：</b>${info.patentRef}` : ''
    }</div>
  `;
}

/** 资料来源列表（页面可直接查阅）。 */
export function renderSources(container: HTMLElement, sources = SOURCES): void {
  const items = sources
    .map(
      (s) => `<li><b>${s.title}</b>${s.url ? ` · <a href="${s.url}" target="_blank" rel="noreferrer">链接</a>` : ''}
        <br /><span class="dim">${s.detail}</span></li>`,
    )
    .join('');
  container.innerHTML = `
    <h2>资料来源与优先级</h2>
    <h3>专利原理 ≠ 实机装配图</h3>
    <p>${EDUCATIONAL_NOTES.shiftModuleInner}</p>
    <p>${EDUCATIONAL_NOTES.zModule}</p>
    <p>${EDUCATIONAL_NOTES.objective}</p>
    <p class="dim">资料冲突时采用：当前型号正式技术文件 &gt; 当前官方产品手册 &gt; SCANLAB 专利的功能结构 &gt; 历史应用文章 &gt; 教学近似模型。</p>
    <ul class="source-list">${items}</ul>
  `;
}
