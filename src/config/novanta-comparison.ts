/**
 * SCANLAB precSYS 与 Novanta / ARGES 两条架构的对比数据，以及 Novanta 模式的三级事实边界。
 *
 * 本文件只放**纯数据 + 极小的文本助手**，不含几何、不含渲染、不含算法：
 *   - ARCHITECTURE_COMPARISON  两条路线的横向对比，只陈述"公开确认"与"专利明文"两类事实，
 *                              不给优劣判断，不使用"更先进 / 更精确 / 更好"一类措辞。
 *   - NOVANTA_BOUNDARY_GROUPS  Novanta 模式的三级事实边界；items 直接展开
 *                              novanta-layout.ts 的 NOVANTA_FACT_BOUNDARY，保持**单一数据源**。
 *   - NOVANTA_KNOWN_UNKNOWNS   Novanta 路线上"公开资料查不到什么"的清单（保守表述）。
 *   - NOVANTA_BOUNDARY_NOTES   必须显式说明的边界：平板不是 Risley 棱镜、专利不是 PE III 的 CAD、
 *                              非圆度的口径、M 的双重含义、Z 由望远镜透镜实现等。
 *
 * 分级与术语沿用 public-specs.ts 的 TrustLevel：'公开确认' | '专利原理' | '教学等效'。
 *
 * 依据来源：
 *   - SCANLAB precSYS 产品手册 EN 2026-02：物镜焦距 75 mm / 有效焦距 25 mm、AOI ±7.5°、
 *     Z ±1 mm、进动 ≤650 Hz（公开确认）。
 *   - 专利 EP3932609B1（SCANLAB）：纯反射式、两套多次反射的平行偏移模块（专利原理）。
 *   - 专利 DE102004053298B4（ARGES）：两块透射式平行平面板 + 扩束望远镜 + 振镜扫描块（专利原理）。
 *   - Novanta PE III 官方数据表：五轴、物镜焦距 60 mm、进动 300–650 Hz（公开确认）。
 */

import { NOVANTA_FACT_BOUNDARY } from './novanta-layout';
import type { TrustLevel } from './public-specs';

/** 对比表的一行：一个维度 + 两条架构各自的事实陈述。 */
export interface ArchitectureComparisonRow {
  /** 维度名（中文）。 */
  dimension: string;
  /** SCANLAB precSYS 的公开 / 专利事实。 */
  scanlab: string;
  /** Novanta / ARGES 的公开 / 专利事实。 */
  novanta: string;
}

/**
 * 两条架构的逐维度对比。
 *
 * 每一格只写有出处的事实（官方数据表 / 产品手册 = 公开确认，专利明文 = 专利原理）；
 * 查不到的就不写，绝不填空，也不做"谁更好"的判断。
 */
export const ARCHITECTURE_COMPARISON: ArchitectureComparisonRow[] = [
  {
    dimension: '光学原理',
    scanlab:
      '反射式：两套多次反射的平行偏移模块改变入瞳偏心，偏心经物镜聚焦后形成光束倾角（EP3932609B1 [0039]）。',
    novanta:
      '折射式移束 + 反射式扫描：平行平面板靠折射产生横向位移，出射光与入射光保持平行；偏转由反射式振镜扫描块完成（DE102004053298B4）。',
  },
  {
    dimension: '运动元件',
    scanlab:
      '振镜驱动的反射镜；平行移束模块内有一块可动镜，首末两次反射都发生在它上面（EP3932609B1 权利要求 1）。',
    novanta:
      '两块可转动的平行平面玻璃板（分别由振镜单元驱动）、望远镜中可沿光轴移动的一片透镜，以及扫描块的两片振镜镜片（DE102004053298B4）。',
  },
  {
    dimension: '透射 / 反射',
    scanlab: '移束与扫描全部为反射；位移不靠光束穿过折射元件产生。',
    novanta: '移束元件为透射式（光束穿过两块平行板）；其后的扫描块为反射式。',
  },
  {
    dimension: '位移产生方式',
    scanlab:
      '三块平面镜、四次反射（26→28→30→26）形成平行位移，首末反射都在同一块可动镜上；两套单元的位移方向可选正交（EP3932609B1 权利要求 1、[0017][0036]）。',
    novanta:
      '板倾斜时板内两次折射使出射光平行于入射光、只产生横向位移；两板转轴互相正交且都与激光传播方向正交，可合成任意方向的位移，位移再被望远镜放大 M 倍（ΔX = M·Δx）。',
  },
  {
    dimension: 'XY 扫描',
    scanlab: '振镜驱动的反射式二维偏转（EP3932609B1 权利要求 2）；公开 AOI ±7.5°（产品手册）。',
    novanta: '两板合成的平行位移经望远镜放大后，由双镜振镜扫描块完成 X/Y 偏转（DE102004053298B4）。',
  },
  {
    dimension: 'Z 调焦',
    scanlab:
      '专利设焦点移动单元：权利要求 6 只限定其调焦功能与位置，[0043] 另举轴向移动光学元件/组件的实现；公开 Z 范围 ±1 mm（产品手册）。',
    novanta:
      '专利明文：沿光轴**毫米级**移动望远镜的凹透镜和/或准直镜组，改变数值孔径，从而改变焦点 Z 位置；公开规格中 Z 是五轴之一（PE III 数据表）。',
  },
  {
    dimension: '进动策略',
    scanlab:
      '两套移束单元的平行位移经物镜聚焦形成倾角，五轴联动生成进动；公开进动频率 ≤650 Hz（产品手册）。',
    novanta:
      '一板按正弦倾斜、另一板按相移后的正弦倾斜，合成圆 / 椭圆 / Lissajous 轨迹；公开进动频率 300–650 Hz（18000–39000 rpm，PE III 数据表）。',
  },
  {
    dimension: '公开证据等级',
    scanlab:
      '当前型号官方手册（公开确认）给出焦距 75 mm / 有效焦距 25 mm、AOI ±7.5°、Z ±1 mm、进动 ≤650 Hz；光路结构依据专利 EP3932609B1（专利原理），专利不是实机装配图。',
    novanta:
      '当前 PE III 官方数据表（公开确认）给出五轴、物镜焦距 60 mm、进动频率、波长与冷却；内部结构关系出自历史专利 DE102004053298B4（专利原理）；具体尺寸、材料与算法属教学等效。',
  },
];

/** 事实边界中的一组（一个可信等级 + 该等级下的条目）。 */
export interface FactBoundaryGroup {
  /** 可信等级，与 public-specs.ts 的 TrustLevel 一致。 */
  level: TrustLevel;
  /** 界面标题。 */
  title: string;
  /**
   * 颜色提示（UI 映射到仓库既有的色标类）：
   *   'good'   → 公开确认（绿色）
   *   'patent' → 专利原理（紫色）
   *   'edu'    → 教学等效（橙色）
   */
  colorHint: string;
  /** 该等级下的条目；直接来自 NOVANTA_FACT_BOUNDARY，不在此处重写文案。 */
  items: string[];
}

/**
 * Novanta 模式的三级事实边界，按"公开确认 → 专利原理 → 教学等效"排列。
 *
 * items 由 novanta-layout.ts 的 NOVANTA_FACT_BOUNDARY 展开，保证**只有一个文案来源**：
 * 修改事实清单时只改 novanta-layout.ts，本文件不需要同步。
 */
export const NOVANTA_BOUNDARY_GROUPS: FactBoundaryGroup[] = [
  {
    level: '公开确认',
    title: '公开确认（当前 Novanta PE III 官方资料）',
    colorHint: 'good',
    items: [...NOVANTA_FACT_BOUNDARY.publiclyConfirmed],
  },
  {
    level: '专利原理',
    title: '历史 ARGES 专利原理（DE102004053298B4）',
    colorHint: 'patent',
    items: [...NOVANTA_FACT_BOUNDARY.patentPrinciples],
  },
  {
    level: '教学等效',
    title: '教学等效（本模型自选参数）',
    colorHint: 'edu',
    items: [...NOVANTA_FACT_BOUNDARY.educationalEquivalent],
  },
];

/**
 * Novanta 路线上"已知的未知"：公开资料明确查不到、本页也不去猜的内容。
 *
 * 保守表述：只写"未公开 / 无法确认"，不写推测值；教学默认值一律标为教学选取。
 * UI 建议整块显示，不要裁掉条目——这些条目本身就是事实边界的一部分。
 */
export const NOVANTA_KNOWN_UNKNOWNS: string[] = [
  '当前 PE III 的内部机械布局未公开；2004 年专利 DE102004053298B4 不是 PE III 的 CAD 图纸，不能据此反推实机的元件位置、间距或装配方式。',
  '两块平行板的实际尺寸、通光口径与两板之间的轴向间距未公开，本页数值为教学选取。',
  '板的厚度与玻璃折射率未公开（材料与镀膜同样未公开），本页使用教学默认值。',
  'Galilei 望远镜的实际焦距 f₁ / f₂、真实放大倍率 M 与镜距未公开，本页数值为教学选取。',
  '当前 Z 轴是否真的通过轴向移动望远镜透镜实现、以及它的真实行程（专利只说"毫米级"）未公开，无法由公开资料确认。',
  '物镜只有焦距 60 mm 是公开的；有效焦距、内部镜组构成、入射净孔径与工作距离均未公开，本页取 Feff = f = 60 mm 属教学等效。',
  '控制器实际使用的补偿算法未公开：本页的"补偿圆"逆解是教学模型，不是厂商算法。',
  '真实的伺服增益、标定矩阵与查找表未公开，本页不模拟它们。',
  '实机的五个控制通道（X / Y / Z + 两个光束倾角）与本页五个执行器之间的映射关系未公开，页面映射为教学选取。',
  '真实的热效应、像差与衍射行为未公开定量数据，本页不做这些仿真。',
  '实机自身对两个光束倾角（α / β）的符号与轴向定义未公开，其与本页两个倾斜分量的对应关系不能确认。',
  '专利中的光束衰减单元 (I) 是否仍存在于当前产品、以何种形式存在，公开资料未说明。',
  '两块板的真实转轴取向与零位标定方式未公开；本页"面垂直于光轴即零位"是教学定义。',
  '专利举例使用的"约 18°"倾角在当前型号上是否仍然适用、实机机械倾斜上限是多少，未公开。',
  '当前型号进动轨迹的真实圆度与偏差量未公开；本页只报告本模型自身测得的非圆度。',
];

/**
 * 必须显式说明的边界（key → 中文说明）。
 *
 * key 供 UI 直接引用，避免同一句话在多个面板里各写一遍而互相矛盾。
 */
export const NOVANTA_BOUNDARY_NOTES: { key: string; text: string }[] = [
  {
    key: 'pe3IsNotPatentCad',
    text: '本页的 Novanta 模式是依据公开历史专利（DE102004053298B4）建立的教学重建，**不是**对 PE III 实机内部装配的逆向工程，也不是 PE III 的内部 CAD 复刻。2004 年专利描述的是原理与结构关系，不含 PE III 的尺寸、位置或执行器型号；页面上的几何与间距均为教学选取。',
  },
  {
    key: 'noWedgeNoRisley',
    text: '两个移束元件是平行平面板（plane-parallel windows）：两面平行、厚度均匀，倾斜时靠折射产生平行位移。它们**不是**楔形棱镜，**不得**称为 Risley 棱镜（Risley prism pair）；它们也**不绕光轴自转**——专利只规定两板各自绕互相正交、且都与激光传播方向正交的转轴倾斜。',
  },
  {
    key: 'plateNotAoiAxis',
    text: '不能把平板 A 等同于 AOI 轴，也不能把平板 B 等同于 Plane（RotZ）轴。两板是两个正交的**倾斜/位移**执行器；AOI 与 Plane 是由这两个倾斜分量导出的极坐标表达（幅值 + 方向），不是独立的物理轴，也不与某一板一一对应。',
  },
  {
    key: 'nonCircularity',
    text: '专利指出：按正弦 / 余弦函数驱动倾斜时，得到的位移轨迹并不是精确的圆——"the deviation is about one percent at the used tilt angles of about 18°"。该偏差的实际大小取决于板厚、玻璃折射率与角度约定，因此本页只报告**本模型自身实测**的非圆度，不声称复现专利给出的那个百分比，也不声称厂商控制器存在同样的偏差。',
  },
  {
    key: 'mAmplifiesBoth',
    text: '望远镜的倍率 M 同时放大两件事：平行位移 ΔX = M·Δx，以及光束直径。二者是**同一个** M，不是两个可以独立调节的旋钮——想放大位移就必然同时放大光束口径，反之亦然。',
  },
  {
    key: 'zIsTelescopeLens',
    text: '专利公开的 Z 调焦方式：把凹透镜和/或准直镜组沿光轴作**毫米级**轴向位移，改变数值孔径（出射光不再严格准直），从而使焦点 Z 位置改变。具体位移量与焦点位移的换算关系取决于整机光学参数，专利未给；本页使用的是教学等效参数，不代表实机行程或传动结构。',
  },
];

/**
 * 按维度名取对比行。
 * 找不到时返回 undefined（UI 自行处理），不抛异常、不返回占位文案。
 */
export function findComparisonRow(dimension: string): ArchitectureComparisonRow | undefined {
  return ARCHITECTURE_COMPARISON.find((row) => row.dimension === dimension);
}

/** 按可信等级取事实边界分组；找不到返回 undefined。 */
export function findBoundaryGroup(level: TrustLevel): FactBoundaryGroup | undefined {
  return NOVANTA_BOUNDARY_GROUPS.find((group) => group.level === level);
}

/** 按 key 取边界说明文字；找不到返回 undefined，不要用猜的内容补位。 */
export function boundaryNoteText(key: string): string | undefined {
  return NOVANTA_BOUNDARY_NOTES.find((note) => note.key === key)?.text;
}
