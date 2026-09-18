/**
 * 公开规格集中定义。
 *
 * 设计原则（对应计划书 §3、§19）：
 * - 本文件只放"公开可查"的数字，且每条都写明来源与可信等级。
 * - 任何教学近似系数都不写在这里，放到不同型号的 configuration 对象里，
 *   并由 UI 明确标注为"教学等效"。
 */

/** 信息可信等级：页面所有部件、参数、说明都必须挂其中之一。 */
export type TrustLevel = '公开确认' | '专利原理' | '教学等效';

export const TRUST_LABEL: Record<TrustLevel, string> = {
  公开确认: '公开确认',
  专利原理: '专利原理',
  教学等效: '教学等效',
};

export interface SourceRef {
  id: string;
  title: string;
  detail: string;
  url?: string;
  trust: TrustLevel;
}

/** 资料来源（计划书 §20 的优先级顺序）。 */
export const SOURCES: SourceRef[] = [
  {
    id: 'kb-08',
    title: '本知识库 · 设备与硬件/08-硬件架构与部件',
    detail: '标准系统 11 个组成部分、五轴定义、光路与冷却设计、可选硬件。',
    trust: '公开确认',
  },
  {
    id: 'kb-09',
    title: '本知识库 · 设备与硬件/09-型号与详细规格',
    detail: '三个光学版本的规格表、共同机械电气条件、观察口波段、外形安装信息。',
    trust: '公开确认',
  },
  {
    id: 'kb-12',
    title: '本知识库 · 工艺与应用/12-加工原理与工艺选择',
    detail: '冲击、环切、进动的差别；五轴修正锥度的机理；关键参数清单。',
    trust: '公开确认',
  },
  {
    id: 'manual-2026',
    title: 'SCANLAB precSYS 产品手册 EN 2026-02',
    detail: '规格表、机械图、系统结构图。焦距 75 mm / 有效焦距 25 mm、AOI ±7.5°、Z ±1 mm、进动 ≤650 Hz。',
    trust: '公开确认',
  },
  {
    id: 'patent-ep3932609',
    title: '专利 EP3932609B1（SCANLAB）',
    detail: '权利要求 1 的两套移束单元；[0017][0036] 的位移方向可选正交；[0039] 偏心经聚焦形成倾角。不是 precSYS 生产装配图。',
    url: 'https://patents.google.com/patent/EP3932609B1/en',
    trust: '专利原理',
  },
  {
    id: 'drillcontrol-2023',
    title: 'DrillControl Doc. Rev.1.12.0 / SW-V2.8',
    detail: '软件侧工作空间与限值：轨迹裁剪直径 5 mm、Drill AOI ±7.5°、Z ±1 mm、队列与频率边界。',
    trust: '公开确认',
  },
];

/** 2026 产品手册三个光学版本的公开数值。 */
export interface OpticsVariant {
  key: string;
  label: string;
  wavelengthNm: number;
  /** 入射净孔径（系统光束入口）mm。 */
  inputClearApertureMm: number;
  /** 典型入射光束直径 1/e²，mm。 */
  inputBeamDiameterMm: number;
  /** 聚焦光束典型全会聚角，rad。 */
  fullConeAngleRad: number;
  /** 最大 AOI（入射角），度。 */
  maxAoiDeg: number;
  /** 进动加工视场直径上限，mm。 */
  precessionFieldDiameterMm: number;
  /** 打标视场直径上限，mm。 */
  markingFieldDiameterMm: number;
  /** 视觉编码颜色（十六进制）。 */
  displayColor: string;
  /** 真实波长是否可见。 */
  visibleToEye: boolean;
}

export const OPTICS_VARIANTS: OpticsVariant[] = [
  {
    key: '1030',
    label: 'precSYS 1030',
    wavelengthNm: 1030,
    inputClearApertureMm: 4,
    inputBeamDiameterMm: 2,
    fullConeAngleRad: 0.08,
    maxAoiDeg: 7.5,
    precessionFieldDiameterMm: 2.5,
    markingFieldDiameterMm: 5,
    displayColor: '#ff5a3c',
    visibleToEye: false,
  },
  {
    key: '515-std',
    label: 'precSYS 515 Standard',
    wavelengthNm: 515,
    inputClearApertureMm: 4,
    inputBeamDiameterMm: 2,
    fullConeAngleRad: 0.08,
    maxAoiDeg: 7.5,
    precessionFieldDiameterMm: 2.5,
    markingFieldDiameterMm: 5,
    displayColor: '#4ade80',
    visibleToEye: true,
  },
  {
    key: '515-min',
    label: 'precSYS 515 min. focus',
    wavelengthNm: 515,
    inputClearApertureMm: 4,
    inputBeamDiameterMm: 2.5,
    fullConeAngleRad: 0.1,
    maxAoiDeg: 7.0,
    precessionFieldDiameterMm: 1.5,
    markingFieldDiameterMm: 5,
    displayColor: '#4ade80',
    visibleToEye: true,
  },
];

/** 三个型号共同的公开机械/电气/介质条件。 */
export const COMMON_SPECS = {
  /** 5 个工厂标定轴。 */
  factoryAxes: ['x', 'y', 'z', 'α', 'β'] as const,
  /** 物镜焦距 mm（公开值）。 */
  objectiveFocalLengthMm: 75,
  /** 有效焦距 mm（公开值，同时是"入瞳位移 → AOI"的换算基准）。 */
  objectiveEffectiveFocalLengthMm: 25,
  supplyVoltageDc: '30–33 V DC',
  supplyCurrentMaxA: 6,
  coolingWaterReferenceTempC: 25,
  purgeGas: 'ISO 8573-1:2010 [1:2:1] 合成空气',
  processGasMaxBar: 6,
  nozzleOpeningMm: 1,
  protectiveWindowReplaceable: true,
  /** 主体参考包络（非完整安装包络）。 */
  bodyWidthMm: 303.5,
  bodyHeightMm: 271,
  weightKg: 30,
} as const;

/** 软件侧（DrillControl）公开限值，用于 UI 滑杆范围。 */
export const SOFTWARE_LIMITS = {
  /** Job / Drill X、Y offset 上限 mm。 */
  offsetXyMm: 1.25,
  /** Job / Drill Z offset 上限 mm。 */
  offsetZMm: 1,
  /** Drill 点坐标通常范围 mm。 */
  drillPointXyMm: 2.5,
  /** 轨迹裁剪空间直径 mm。 */
  clipSpaceDiameterMm: 5,
  /** 焦点轨迹工作空间 Z，±mm。 */
  traceZMm: 1,
  /** 最大 Z 焦点速度 mm/s。 */
  maxZSpeedMmPerSec: 10,
  /** 最大进动频率 Hz。 */
  maxPrecessionHz: 650,
  /** RotZ 范围 ±度。 */
  rotZDeg: 180,
  /** Production 队列上限。 */
  productionQueueMax: 50,
} as const;

/** 演示中所有"教学等效"系数的集中说明，UI 直接引用，避免散落在动画代码里。 */
export const EDUCATIONAL_NOTES = {
  axialScale:
    '光路轴向长度按教学需要拉开，非等比例。实机主体参考包络约 303.5 mm × 271 mm。',
  shiftModuleInner:
    '权利要求 1 / [0030][0032]：26→28→30→26，首末反射同一可动镜。页面改用共用支架的两块平行镜面与台阶，属于教学等效，不能认定为单镜 26 的实物结构。转轴取向为模型选取（垂直于单元光路平面），专利未规定。镜间距、口径、机械角与 XZ/YZ 空间排布也均为自定。',
  zModule:
    'Z 模块是功能等效：模型用等效光焦度与随动折返演示焦点移动。[0043] 另举轴向移动光学元件/组件的实现，权利要求 6 仅限定调焦功能与位置，不能据此断言实机 Z 轴不是振镜。图中的 Z 随动组件无独立控制自由度，也不是实机第六轴。',
  objective:
    '公开焦距 75 mm、有效焦距 25 mm；模型选取扩束 ×3 和 75 mm 后段传播距离，并不能由此证实实机工作距离或内部镜组。移束先改变入瞳偏心，再经聚焦形成入射角。AOI 为相对机器 -Z 轴的两个有符号分量；专利 Fig.3 的 α/β 表示出光倾角/工件入射角，不是这里的两个坐标分量。',
  pupilAperture:
    '物镜入口孔径按教学需要画出（实机内部孔径未公开）。系统"入射净孔径 4 mm"指的是激光进入 precSYS 的入口，不是物镜入瞳。',
  inverseModel:
    'educationalInverseModel() 是等效逆映射，不是 SCANLAB 控制器算法，也不代表实机标定矩阵。',
} as const;
