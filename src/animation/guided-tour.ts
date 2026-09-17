/**
 * 引导式学习流程（计划书 §12.2）。
 *
 * 每一步只突出一个概念：其余部件降低不透明度，说明文字控制在 2～4 行，
 * 并且可以带一个"示范命令"，让用户看到这一步对应的五轴状态。
 */

import { Vector3 } from 'three';
import { AXIS, BEAM_PATH } from '../config/layout';
import type { EngineeringCommand } from '../optics/educational-inverse-model';
import type { AppMode } from '../app-state';

export interface TourStep {
  id: string;
  title: string;
  /** 2～4 行说明。 */
  lines: string[];
  /** 本步需要高亮的部件 id（其余降透明度）。 */
  highlight: string[];
  /** 相机对准点与距离。 */
  camera: { target: [number, number, number]; distance: number };
  /** 本步示范的工程量命令（可选）。 */
  command?: Partial<EngineeringCommand>;
  /** 是否自动播放动画。 */
  play?: boolean;
  /** 该步使用的轴演示（可选）。 */
  axisDemo?: 'x' | 'y' | 'z' | 'alpha' | 'beta';
  /** 该步建议的模式（用于侧栏标题与读数区）。 */
  mode?: AppMode;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'inlet',
    title: '1 · 激光从哪里进入',
    lines: [
      '激光从顶部入口进入 precSYS，入射净孔径 4 mm、典型光束直径 2 mm。',
      '可选的光束调理单元负责扩束（0.25–4×）、发散度调整和 λ/2、λ/4 波片偏振调整。',
      '这一段不发生扫描，只是把光束"喂"成系统需要的样子。',
    ],
    highlight: ['inlet', 'beam-conditioning', 'half-wave', 'quarter-wave', 'expander'],
    camera: { target: [BEAM_PATH.inlet.x, BEAM_PATH.inlet.y, AXIS.beamExpander], distance: 320 },
  },
  {
    id: 'galvo-principle',
    title: '2 · 振镜如何工作',
    lines: [
      '振镜电机只转一个很小的角度，反射光方向却变化约两倍角度 —— 这正是"小镜片转角、低运动质量"能做出 650 Hz 动态的原因。',
      '镜片位置和姿态由数字编码器闭环控制，因此不同速度下轮廓保持一致。',
      '注意：这里发生的是"方向"变化，不是"位置"变化。',
    ],
    highlight: ['galvo-x', 'galvo-y'],
    camera: { target: [0, 0, AXIS.galvoPlane + 40], distance: 260 },
  },
  {
    id: 'axis-x',
    title: '3 · X 轴移动焦点',
    lines: [
      'X 振镜改变的是光束在物镜入瞳处的坡度 u。',
      '在近轴等效下 X_focus = 有效焦距 × u = 25 mm × u，所以焦点沿工件 X 方向平移。',
      '打开"幽灵光路"可以看到零位光路，方便对比焦点移动了多少。',
    ],
    highlight: ['galvo-x', 'objective'],
    camera: { target: [0, 0, AXIS.galvoPlane - 30], distance: 220 },
    axisDemo: 'x',
    play: true,
  },
  {
    id: 'axis-y',
    title: '4 · Y 轴组成二维路径',
    lines: [
      'Y 振镜与 X 振镜正交，负责另一个方向。',
      '两个轴同时输入正弦/余弦时，焦点就在工件面上走圆、椭圆或任意二维路径。',
      '注意 Y 振镜不在入瞳平面上，所以它移动焦点的同时会把一点不需要的 Y 向偏心带进入瞳 —— 这正是后面要联合补偿的耦合。',
    ],
    highlight: ['galvo-y', 'galvo-x', 'objective'],
    camera: { target: [0, 0, AXIS.galvoPlane - 30], distance: 220 },
    axisDemo: 'y',
    play: true,
  },
  {
    id: 'axis-alpha',
    title: '5 · α 模块平移光束',
    lines: [
      'α 平行移束模块内部反射四次，第一束和最后一束都打在同一个可动镜上。',
      '两块固定镜法向相同，两次反射对方向的作用互相抵消，所以输出方向与输入严格平行 —— 与可动镜转角无关。',
      '转角改变的是"横向位移"：拖动 α 时请观察光束方向基本不变、位置发生偏移。',
    ],
    highlight: ['alpha-movable-in', 'alpha-movable-out', 'alpha-fixed-1', 'alpha-fixed-2', 'alpha-mount'],
    camera: { target: [BEAM_PATH.afterAlpha.x, BEAM_PATH.afterAlpha.y, AXIS.alphaModuleOut + 30], distance: 320 },
    axisDemo: 'alpha',
    play: true,
  },
  {
    id: 'axis-beta',
    title: '6 · β 模块完成二维偏心',
    lines: [
      'β 模块与 α 模块结构相同，但空间方向正交，沿 Y 移束。',
      '二者串联后，物镜入口处的光束中心可以在二维孔径平面内任意移动。',
      '物镜入口画出的半透明圆环就是"入瞳"，光束中心点在其中移动。',
    ],
    highlight: ['beta-movable-in', 'beta-movable-out', 'beta-fixed-1', 'beta-fixed-2', 'beta-mount'],
    camera: { target: [BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.betaModuleOut + 30], distance: 320 },
    axisDemo: 'beta',
    play: true,
  },
  {
    id: 'axis-z',
    title: '7 · Z 轴移动焦点深度',
    lines: [
      'Z 模块改变的是"物镜前光束的会聚状态"：从轻微发散到准直再到轻微会聚。',
      '物镜把不同会聚度的光束聚焦到不同深度，于是焦点沿 Z 上下移动，公开范围 ±1 mm。',
      '此处的镜组结构是教学等效模型，不代表 precSYS 内部真实排布。',
    ],
    highlight: ['z-galvo', 'z-curved', 'z-fold', 'objective'],
    camera: { target: [BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.zGalvo], distance: 260 },
    axisDemo: 'z',
    play: true,
  },
  {
    id: 'linked',
    title: '8 · 五轴联合补偿',
    lines: [
      'X/Y 移动焦点时会带出多余的入射角，Z 变化也会让光束在入瞳上偏移。',
      '关掉"联合补偿"能看到这些偏差；打开后，五个执行轴一起小量修正，把焦点与入射角同时解到位。',
      '这就是"五个执行轴必须联合标定，而不是一轴对应一个坐标"的原因。',
    ],
    highlight: ['galvo-x', 'galvo-y', 'alpha-movable-out', 'beta-movable-out', 'z-curved', 'objective'],
    camera: { target: [0, 0, AXIS.galvoPlane + 30], distance: 420 },
    command: { xMm: 1.25, yMm: -1.25, zMm: 0.6, alphaDeg: 5, betaDeg: -5 },
  },
  {
    id: 'process',
    title: '9 · 进动加工完整动画',
    lines: [
      '焦点绕孔轴做圆周运动，同时 α/β 同步旋转，使光束始终以设定方向作用于侧壁。',
      '倾斜向量与焦点方位保持固定相位关系：指向孔壁得到负锥趋势，指向孔轴得到正锥趋势，垂直则接近直壁。',
      '屏幕是慢动作：公开的进动频率可达 650 Hz，真实一圈只要约 1.5 ms，肉眼无法分辨。',
    ],
    highlight: ['alpha-movable-out', 'beta-movable-out', 'galvo-x', 'galvo-y', 'objective', 'workpiece'],
    camera: { target: [0, 0, 60], distance: 320 },
    play: true,
  },
  {
    id: 'calibration',
    title: '10 · 自动精调与长期稳定性',
    lines: [
      '监测分光元件把一小部分光送到光束位置测量单元，检测光束位置/角度偏差。',
      'Automatic Fine Adjustment 用内部五振镜轴做小量补偿，把光束状态拉回预设零位。',
      '它修正的是"进入系统后的光束状态"，不等于成品孔径的闭环检测。',
    ],
    highlight: ['monitor-splitter', 'position-sensor', 'alpha-movable-in', 'beta-movable-in'],
    camera: { target: [BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.monitoringSplitter], distance: 300 },
  },
];

export function tourCameraTarget(step: TourStep): Vector3 {
  return new Vector3(step.camera.target[0], step.camera.target[1], step.camera.target[2]);
}
