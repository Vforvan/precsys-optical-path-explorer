/**
 * 侧栏"事实边界 / 几何校验"卡片的数据源。
 *
 * 两条路线的校验内容**本来就不一样**，因此这里按 vendor 分开产出：
 *   SCANLAB：α/β 移束模块 F1→F2 段对两可动镜片的包络避让；
 *   Novanta ：两块平行板的通光口径 + 望远镜镜片口径 + 追迹是否成功。
 * 共用的是"控制求解成功 ≠ 有限口径光束能安全通过"这条原则。
 */

import type { TrainTrace } from '../optics/optical-train';
import type { NovantaTrainTrace } from '../optics/novanta-optical-train';
import type { Vendor } from '../app-state';
import { NOVANTA_PLATES } from '../config/novanta-layout';
import { renderInlineMarkup } from './component-info';

export interface GeometryStatus {
  warning: boolean;
  message: string;
  valuesHtml: string;
  html: string;
}

function shell(warning: boolean, message: string, valuesHtml: string, details: string[]): GeometryStatus {
  return {
    warning,
    message,
    valuesHtml,
    html: `<h2>事实边界 / 几何校验</h2>
    <p class="${warning ? 'warn' : 'good'}" role="status">${message}</p>
    <p class="dim" data-geometry-values>${valuesHtml}</p>
    <details><summary>校验范围与留白</summary>
      ${details.map((d) => `<p class="dim">${renderInlineMarkup(d)}</p>`).join('\n      ')}
    </details>`,
  };
}

/** SCANLAB：α/β 移束段包络避让。 */
export function scanlabGeometryStatus(trace: TrainTrace): GeometryStatus {
  const rows = [
    ['α', trace.alphaTrace],
    ['β', trace.betaTrace],
  ] as const;
  const warning =
    !trace.ok ||
    rows.some(
      ([, module]) =>
        !module || module.crossings.length !== 2 || module.crossings.some((c) => !c.envelopeClear),
    );
  const values = rows.map(([name, module]) => {
    if (!module || module.crossings.length !== 2) return `${name}：未完成避让校验`;
    const radius = Math.max(...module.crossings.map((c) => c.beamRadiusMm));
    const margin = Math.min(...module.crossings.map((c) => c.clearanceMm));
    return `${name}：缝宽 ${module.gapWidthMm.toFixed(2)} / 半径 ${radius.toFixed(2)} / 余量 ${margin.toFixed(2)} mm`;
  });
  return shell(
    warning,
    warning ? '几何告警：包络避让未通过或未完成' : '移束段包络避让通过（模型范围）',
    values.join('<br>'),
    [
      '仅检查 α/β 的 F1→F2 段避让两可动镜片，计入 1/e² 光束包络、斜入射足迹、2.6 mm 板厚及 0.25 mm 安全余量。缝宽沿镜面 u 轴测量，11 mm 是法向台阶；不是整机无碰撞认证，也不保证高斯光束尾部零截光。',
      '单镜 26 的分体台阶替代、转轴、尺寸、XZ/YZ 排布及 Z 光焦度均为教学等效。图中 Z 随动组件并非实机第六轴。AOI 是机器 -Z 轴参考下的角分量；专利未给出本模型换算公式。',
    ],
  );
}

/**
 * Novanta：平板与望远镜镜片的通光口径校验。
 *
 * 口径本身是**教学参数**（专利未给出板与镜片的尺寸），因此这里只报告
 * "在当前倾角/位移下光束包络是否落在本模型画出的口径内"，
 * 不能当作实机的通光孔径结论。
 */
export function novantaGeometryStatus(trace: NovantaTrainTrace): GeometryStatus {
  const wobble = trace.wobble;
  const lens = trace.telescope;
  const warning = !trace.ok || !trace.apertureClear;
  const parts: string[] = [];
  if (wobble) {
    parts.push(
      `平板 A：入射角 ${wobble.poseA.incidenceDeg.toFixed(2)}° / 位移 ${wobble.poseA.signedShiftMm.toFixed(3)} mm`,
    );
    parts.push(
      `平板 B：入射角 ${wobble.poseB.incidenceDeg.toFixed(2)}° / 位移 ${wobble.poseB.signedShiftMm.toFixed(3)} mm`,
    );
    parts.push(`合位移 ${wobble.offsetRadiusMm.toFixed(3)} mm / 方位 ${wobble.offsetAzimuthDeg.toFixed(1)}°`);
  } else {
    parts.push('平板追迹未完成');
  }
  if (lens) {
    parts.push(
      `望远镜：入射位移 ${lens.inputOffsetMm.toFixed(3)} → 出射 ${lens.outputOffsetMm.toFixed(3)} mm（M=${lens.measuredMagnification.toFixed(3)}）`,
    );
    parts.push(`出射半径 ${lens.outputRadiusMm.toFixed(3)} mm / 会聚度 ${lens.outputVergence.toExponential(2)} /mm`);
  }
  const failure = !trace.ok ? `追迹失败：${trace.note}` : '口径校验未通过';
  return shell(
    warning,
    warning ? `几何告警：${failure}` : '平板与望远镜口径校验通过（模型范围）',
    parts.join('<br>'),
    [
      `校验对象：两块平行板（口径 ${NOVANTA_PLATES.apertureMm} mm，教学参数）与望远镜两片镜片。计入 1/e² 光束包络与放大后的位移，斜入射足迹按实际追迹的入射角计算；不是整机无碰撞认证，也不保证高斯光束尾部零截光。`,
      '**口径数值是教学参数**：专利未给出平板与镜片的尺寸、厚度与间距，因此"通过"只说明在**本模型画出的口径**下没有被截光，不能推断实机孔径。',
      '追迹包含向量 Snell 折射与全内反射判据；若出现全内反射或求交失败，本卡片会如实告警而不是静默沿用上一次结果。',
    ],
  );
}

/** 按路线分派。 */
export function geometryStatus(trace: TrainTrace | NovantaTrainTrace, vendor: Vendor): GeometryStatus {
  return vendor === 'novanta'
    ? novantaGeometryStatus(trace as NovantaTrainTrace)
    : scanlabGeometryStatus(trace as TrainTrace);
}
