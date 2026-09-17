/**
 * 加工模式与进动轨迹。
 *
 * 计划书 §11：
 *   X(θ) = X0 + R·cos θ
 *   Y(θ) = Y0 + R·sin θ
 *   Z(θ) = Z0 − pitch·θ/2π
 *   α(θ) = −A·cos(θ + phaseOffset)
 *   β(θ) = −A·sin(θ + phaseOffset)
 *
 * 本文件把 θ 作为唯一相位驱动，输出的是"五个工程量"（工件坐标命令），
 * 再由 educationalInverseModel 解成五个执行轴 —— 动画里没有写死的角度。
 *
 * 关于频率：公开的进动频率上限是 650 Hz，浏览器根本画不出来，
 * 因此动画是慢动作；页面同时显示"设定工艺频率"与"屏幕慢放倍率"，
 * 并明确说明浏览器帧率不是真实控制周期（计划书 §11.2）。
 */

import { DEG, clamp } from '../optics/ray';

export type ProcessMode = 'percussion' | 'trepann' | 'spiral' | 'precession';

export interface ProcessModeInfo {
  key: ProcessMode;
  label: string;
  /** 一句话说明。 */
  summary: string;
  /** X/Y 行为。 */
  xy: string;
  /** Z 行为。 */
  z: string;
  /** α/β 行为。 */
  ab: string;
}

export const PROCESS_MODES: ProcessModeInfo[] = [
  {
    key: 'percussion',
    label: '冲击钻孔',
    summary: '焦点基本不动，靠脉冲逐层去除材料。',
    xy: '固定',
    z: '可分层推进',
    ab: '固定',
  },
  {
    key: 'trepann',
    label: '环切钻孔',
    summary: '焦点沿圆周走轮廓，光束方向不随路径倾斜。',
    xy: '圆周',
    z: '可推进',
    ab: '0 或固定',
  },
  {
    key: 'spiral',
    label: '螺旋钻孔',
    summary: '焦点沿螺旋线向外/向内扩展，用于扩孔与轮廓修整。',
    xy: '螺旋',
    z: '可推进',
    ab: '0 或固定',
  },
  {
    key: 'precession',
    label: '五轴进动',
    summary: '焦点绕圆周运动，同时 α/β 同步旋转，使光束始终以设定方向作用于侧壁。',
    xy: '圆周或螺旋',
    z: '可推进',
    ab: '同步旋转',
  },
];

/** 孔壁趋势预设。 */
export type TaperPreset = 'positive' | 'straight' | 'negative';

export interface TaperPresetInfo {
  key: TaperPreset;
  label: string;
  /** 光束相对孔轴的倾向。 */
  description: string;
  /** 倾斜向量符号：+1 指向孔壁（向外），-1 指向孔轴（向内），0 垂直。 */
  sign: number;
}

export const TAPER_PRESETS: TaperPresetInfo[] = [
  {
    key: 'positive',
    label: '正锥（入口大、底部小）',
    description: '倾斜向量指向孔轴（向内），光束随深度向轴心收敛。',
    sign: -1,
  },
  {
    key: 'straight',
    label: '近似直壁',
    description: '光束保持与孔轴平行（AOI≈0），焦点绕圆周去除材料。',
    sign: 0,
  },
  {
    key: 'negative',
    label: '负锥（底部外扩）',
    description: '倾斜向量指向孔壁（向外），光束随深度向外扩展。',
    sign: 1,
  },
];

export interface ProcessParams {
  mode: ProcessMode;
  /** 焦点绕孔轴的半径 mm。 */
  radiusMm: number;
  /** 孔中心位置 mm。 */
  centerXMm: number;
  centerYMm: number;
  /** 焦点名义高度 mm（相对工件表面）。 */
  focusZMm: number;
  /** 每圈 Z 推进量 mm/圈。 */
  pitchMmPerRev: number;
  /** 入射角幅值 ±度。 */
  tiltAmplitudeDeg: number;
  /** 孔壁趋势预设。 */
  taper: TaperPreset;
  /** 总圈数。 */
  revolutions: number;
  /** 设定工艺频率 Hz（仅用于显示与慢放倍率换算）。 */
  frequencyHz: number;
}

export const DEFAULT_PROCESS: ProcessParams = {
  mode: 'precession',
  radiusMm: 0.5,
  centerXMm: 0,
  centerYMm: 0,
  focusZMm: 0,
  pitchMmPerRev: 0.05,
  tiltAmplitudeDeg: 6,
  taper: 'negative',
  revolutions: 12,
  frequencyHz: 650,
};

/** 相位 θ（弧度）对应的五轴工程量命令。 */
export interface ProcessCommand {
  xMm: number;
  yMm: number;
  zMm: number;
  alphaDeg: number;
  betaDeg: number;
}

/** 单圈参数：把"每圈推进"和"总圈数"换算成进给速度与总行程。 */
export function feedPerRevolution(params: ProcessParams): number {
  return params.pitchMmPerRev;
}

export function totalDepthMm(params: ProcessParams): number {
  return params.pitchMmPerRev * params.revolutions;
}

/** 由相位求工程量命令。theta 单调递增，0 对应起始点。 */
export function commandAtTheta(params: ProcessParams, theta: number): ProcessCommand {
  const revolutionsDone = theta / (2 * Math.PI);
  const taper = TAPER_PRESETS.find((t) => t.key === params.taper) ?? TAPER_PRESETS[1];
  const tiltAmplitude = params.tiltAmplitudeDeg * taper.sign;

  switch (params.mode) {
    case 'percussion':
      // 焦点不动，Z 分层推进（按整圈离散推进）
      return {
        xMm: params.centerXMm,
        yMm: params.centerYMm,
        zMm: params.focusZMm - params.pitchMmPerRev * Math.floor(revolutionsDone),
        alphaDeg: 0,
        betaDeg: 0,
      };
    case 'trepann':
      return {
        xMm: params.centerXMm + params.radiusMm * Math.cos(theta),
        yMm: params.centerYMm + params.radiusMm * Math.sin(theta),
        zMm: params.focusZMm - params.pitchMmPerRev * revolutionsDone,
        alphaDeg: 0,
        betaDeg: 0,
      };
    case 'spiral': {
      // 螺旋：半径随圈数增长，直到达到设定半径
      const grow = clamp(revolutionsDone / Math.max(1e-6, params.revolutions), 0, 1);
      const r = params.radiusMm * grow;
      return {
        xMm: params.centerXMm + r * Math.cos(theta),
        yMm: params.centerYMm + r * Math.sin(theta),
        zMm: params.focusZMm - params.pitchMmPerRev * revolutionsDone,
        alphaDeg: 0,
        betaDeg: 0,
      };
    }
    case 'precession':
    default:
      return {
        xMm: params.centerXMm + params.radiusMm * Math.cos(theta),
        yMm: params.centerYMm + params.radiusMm * Math.sin(theta),
        zMm: params.focusZMm - params.pitchMmPerRev * revolutionsDone,
        // 倾斜向量与焦点方位同步旋转：sign > 0 指向孔壁（向外），< 0 指向孔轴
        alphaDeg: tiltAmplitude * Math.cos(theta),
        betaDeg: tiltAmplitude * Math.sin(theta),
      };
  }
}

/** 该模式下是否存在旋转的倾斜向量。 */
export function hasRotatingTilt(mode: ProcessMode, taper: TaperPreset): boolean {
  if (mode !== 'precession') return false;
  const preset = TAPER_PRESETS.find((t) => t.key === taper);
  return (preset?.sign ?? 0) !== 0;
}

/** 慢放倍率：屏幕上一圈用时 vs 真实一圈用时。 */
export function slowMotionFactor(frequencyHz: number, screenRevolutionSeconds: number): number {
  const realSeconds = 1 / Math.max(1e-9, frequencyHz);
  return screenRevolutionSeconds / realSeconds;
}

/**
 * 由屏幕时间求相位：屏幕上一圈固定用 screenRevolutionSeconds 秒，
 * 这样不同工艺频率在屏幕上都能看清，同时面板显示真实时间尺度。
 */
export function thetaForScreenTime(
  params: ProcessParams,
  screenSeconds: number,
  screenRevolutionSeconds: number,
): { theta: number; realSecondsElapsed: number } {
  const theta = (screenSeconds / screenRevolutionSeconds) * 2 * Math.PI;
  return {
    theta,
    realSecondsElapsed: (theta / (2 * Math.PI)) / Math.max(1e-9, params.frequencyHz),
  };
}

/** 加工过程的"孔深—半径"定性趋势，用于图例文字（不是工艺预测）。 */
export function qualitativeTaperHint(taper: TaperPreset): string {
  switch (taper) {
    case 'positive':
      return '定性演示：入口大于底部（正锥趋势）';
    case 'negative':
      return '定性演示：底部外扩（负锥趋势）';
    default:
      return '定性演示：壁面近似平行（直壁趋势）';
  }
}

/** 把角度制的 AOI 幅值换算成需要的入瞳偏心（公开有效焦距 25 mm）。 */
export function tiltToPupilShiftMm(tiltDeg: number): number {
  return 25 * Math.tan(tiltDeg * DEG);
}
