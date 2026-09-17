/**
 * 界面上的动态说明文字（进度、慢放、工况提示）。
 * 与 ui-text.ts 的区别：这里需要读状态，所以做成函数。
 */

import type { AppSnapshot } from '../app-state';
import { TAPER_PRESETS, slowMotionFactor } from '../animation/process-modes';

/** 慢放说明：同时给出设定工艺频率与屏幕倍率。 */
export function SLOW_MOTION_NOTE(snapshot: AppSnapshot): string {
  const factor = slowMotionFactor(snapshot.process.frequencyHz, snapshot.screenRevolutionSeconds);
  return `设定工艺频率 ${snapshot.process.frequencyHz} Hz · 屏幕一圈 ${snapshot.screenRevolutionSeconds.toFixed(
    1,
  )} s · 慢放约 ×${Math.round(factor)}（浏览器帧率不是真实控制周期）`;
}

/** 当前加工模式的定性说明。 */
export function processNote(snapshot: AppSnapshot): string {
  const preset = TAPER_PRESETS.find((p) => p.key === snapshot.process.taper);
  return `${preset?.label ?? ''}：${preset?.description ?? ''}（定性演示，不作为工艺预测）`;
}

/** 工况提示：残差是否超限、是否有轴到限位。 */
export function conditionNote(snapshot: AppSnapshot): string {
  const { inverse, residual } = snapshot;
  const worst = Math.max(
    Math.abs(residual.xMm),
    Math.abs(residual.yMm),
    Math.abs(residual.zMm),
    Math.abs(residual.alphaDeg) / 10,
    Math.abs(residual.betaDeg) / 10,
  );
  if (inverse.saturated) return '有执行轴到达行程限位：当前设定超出模型行程，请降低 AOI 或视场。';
  if (worst > 0.02) {
    return inverse.compensated
      ? '联合补偿未能完全解到位（可能接近行程边界）。'
      : '当前为"一轴对应一坐标"的教科书解，未做联合补偿，因此实际入射角与设定值存在偏差。';
  }
  return inverse.compensated
    ? '五个执行轴联合求解成功：焦点与入射角均达到设定值。'
    : '教科书解：焦点达到设定值，但入射角存在耦合偏差。';
}
