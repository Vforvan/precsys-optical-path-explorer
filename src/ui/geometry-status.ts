import type { TrainTrace } from '../optics/optical-train';

/** 与控制求解分开报告：中心光线可求解不代表有限口径光束能安全通过。 */
export function geometryStatus(trace: TrainTrace): { warning: boolean; message: string; valuesHtml: string; html: string } {
  const rows = [['α', trace.alphaTrace], ['β', trace.betaTrace]] as const;
  const warning = !trace.ok || rows.some(([, module]) => !module || module.crossings.length !== 2
    || module.crossings.some(c => !c.envelopeClear));
  const values = rows.map(([name, module]) => {
    if (!module || module.crossings.length !== 2) return `${name}：未完成避让校验`;
    const radius = Math.max(...module.crossings.map(c => c.beamRadiusMm));
    const margin = Math.min(...module.crossings.map(c => c.clearanceMm));
    return `${name}：缝宽 ${module.gapWidthMm.toFixed(2)} / 半径 ${radius.toFixed(2)} / 余量 ${margin.toFixed(2)} mm`;
  });
  const message = warning ? '几何告警：包络避让未通过或未完成' : '移束段包络避让通过（模型范围）';
  const valuesHtml = values.join('<br>');
  return { warning, message, valuesHtml, html: `<h2>事实边界 / 几何校验</h2>
    <p class="${warning ? 'warn' : 'good'}" role="status">${message}</p>
    <p class="dim" data-geometry-values>${valuesHtml}</p>
    <details><summary>校验范围与专利留白</summary>
      <p class="dim">仅检查 α/β 的 F1→F2 段避让两可动镜片，计入 1/e² 光束包络、斜入射足迹、2.6 mm 板厚及 0.25 mm 安全余量。缝宽沿镜面 u 轴测量，11 mm 是法向台阶；不是整机无碰撞认证，也不保证高斯光束尾部零截光。</p>
      <p class="dim">单镜 26 的分体台阶替代、转轴、尺寸、XZ/YZ 排布及 Z 光焦度均为教学等效。图中 Z 随动组件并非实机第六轴。AOI 是机器 -Z 轴参考下的角分量；专利未给出本模型换算公式。</p>
    </details>` };
}
