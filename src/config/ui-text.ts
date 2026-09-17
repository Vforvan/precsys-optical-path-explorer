/**
 * 面向界面的固定文案。
 *
 * 集中放这里，避免同一句"教学等效/免责"说明在多个文件里各写一遍、
 * 久而久之互相矛盾（计划书 §18.4 要求页面显著标明边界）。
 */

export { OPTICS_VARIANTS, SOFTWARE_LIMITS, COMMON_SPECS } from './public-specs';

export const PUBLIC_SPECS_UI = {
  disclaimer:
    '内部光路采用公开专利和官方资料建立的教学型等效模型。模块功能和光学关系可信，具体封装、尺寸及部分 Z 轴结构不代表生产设备内部实物。',
  inverseNote:
    'educationalInverseModel() 是等效逆映射，不是 SCANLAB 控制器算法，也不代表实机标定矩阵。',
  scaleNote: '光路轴向长度按教学需要拉开（非等比例）；实机主体参考包络约 303.5 mm × 271 mm。',
  noProcessPrediction: '孔型、锥度与去除效果均为定性演示，不作为真实加工参数或安全边界。',
  noSimulation: '本页不做衍射、像差、热漂移或材料去除的精确仿真。',
  frequencyNote: '公开进动频率可达 650 Hz，浏览器无法按真实速度显示，动画为慢动作。',
} as const;

/** 一级模式的标题与说明（供侧栏与无障碍属性使用）。 */
export const MODE_DESCRIPTIONS = {
  overview: '整机总览：完整光路与外围硬件边界。',
  axes: '五轴拆解：逐轴显示 X、Y、Z、α、β 的硬件作用。',
  linked: '硬件联动：五轴同步补偿与耦合矩阵。',
  process: '加工演示：冲击、环切、螺旋与五轴进动对比。',
  calibration: '校准与监控：光束位置传感器、零位漂移与自动精调。',
  evidence: '结构依据：公开资料、专利结构与不确定部分。',
} as const;
