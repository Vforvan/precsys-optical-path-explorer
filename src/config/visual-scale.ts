/**
 * 视觉比例与视觉放大系数。
 *
 * 计划书 §18.2 要求：所有超出公开资料的比例，都必须在页面上标记为"视觉放大"。
 * 因此本文件集中管理"放大倍数"，UI 会读取这里并把标记显示在参数旁边。
 */

/** 各量的视觉放大倍数（1 = 等比）。 */
export const VISUAL_GAIN = {
  /**
   * Z 焦点位移：公开范围只有 ±1 mm，若等比绘制肉眼几乎看不出，
   * 因此屏幕上放大显示；面板同时给出真实值与放大倍数。
   */
  zFocus: 6,
  /**
   * 光束会聚度：真实 ±1.6e-3 /mm 的波前曲率在屏幕上不可见，
   * 放大后用于表达"轻微会聚 / 准直 / 轻微发散"。
   */
  vergence: 60,
  /**
   * 可动镜机械角：真实工作角只有几度，运动箭头按此倍数加长绘制，
   * 但镜片位姿与光线方向仍按真实角度计算。
   */
  actuatorArrow: 2.2,
  /**
   * Novanta 望远镜镜组的**轴向行程绘制放大**。
   *
   * 真实行程只有 ±1.5 mm（对应焦点 Z ±0.27 mm），等比绘制在屏幕上不到 10 px，
   * 读者会以为"Z 轴演示时镜片没动"。因此绘制时把相对零位的轴向位移放大这么多倍，
   * 并在页面上标注为视觉放大。
   * **只放大绘制位置**：透镜在光学模型里的位置仍由 telescopeLensesAt() 按真实行程给出，
   * 因此光线、焦点 Z 与所有读数不受影响。
   */
  novantaLensTravel: 8,
  /** 焦点轨迹尾迹的线宽放大。 */
  traceWidth: 1,
} as const;

/** 每一处视觉放大对应的说明文字，供 UI 直接显示。 */
export const VISUAL_GAIN_LABEL: Record<keyof typeof VISUAL_GAIN, string> = {
  zFocus: `焦点 Z 位移视觉放大 ×${VISUAL_GAIN.zFocus}（公开范围仅 ±1 mm）`,
  vergence: `光束会聚度视觉放大 ×${VISUAL_GAIN.vergence}`,
  actuatorArrow: `执行器转角箭头放大 ×${VISUAL_GAIN.actuatorArrow}（光线仍按真实角度计算）`,
  novantaLensTravel: `望远镜镜组轴向行程绘制放大 ×${VISUAL_GAIN.novantaLensTravel}（真实 ±1.5 mm；光线与焦点仍按真实行程计算）`,
  traceWidth: '轨迹线宽为视觉表达',
};

/** 颜色语义（计划书 §13）。 */
export const COLORS = {
  beamMain: '#ff6a3d',
  beamGhost: '#9aa4b2',
  beamEnvelope: 'rgba(255,138,79,0.16)',
  activeGalvo: '#22d3ee',
  fixedMirror: '#c3cbd6',
  movableMirror: '#8fd6ff',
  optic: '#8b8cf0',
  focus: '#fff27a',
  workpiece: '#4a5160',
  ablation: '#ff9d5c',
  motionArrow: '#22d3ee',
  sensor: '#a3e635',
  cooling: '#38bdf8',
  gas: '#f59e0b',
  electricity: '#facc15',
  housing: '#5b6b82',
  dimmed: '#38414f',
} as const;
