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

/** 取某个部件的信息。 */
export function partInfo(id: string, train: OpticalTrain): PartInfo | null {
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

/** 渲染部件信息卡。（snapshot 可选：给了就显示该镜片当前的入射角/偏转角） */
export function renderPartCard(
  container: HTMLElement,
  info: PartInfo | null,
  snapshot?: { trace: { hits: { mirrorId: string; incidenceRad: number }[] } },
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
    ${angleBlock}
    <div class="note ${trustClass}">${info.note}${
      info.patentRef ? `<br /><b>专利依据：</b>${info.patentRef}` : ''
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
