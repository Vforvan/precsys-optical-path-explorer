/**
 * Novanta 路线的三维标签（CSS2D）。
 *
 * 与 SCANLAB 的标签分开写：两条路线的部件集合完全不同，
 * 而且这里的标签必须把"哪部分是公开确认、哪部分是历史专利原理、哪部分是教学等效"
 * 直接标在部件旁边（页面固定要求：三类信息用色标区分）。
 */

import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Group, Vector3 } from 'three';
import { NOVANTA_AXIS, NOVANTA_BEAM_PATH, NOVANTA_OBJECTIVE, NOVANTA_PLATES, NOVANTA_TELESCOPE } from '../config/novanta-layout';
import type { NovantaOpticalTrain } from '../optics/novanta-optical-train';
import type { TrustLevel } from '../config/public-specs';

export interface LabelEntry {
  id: string;
  text: string;
  object: CSS2DObject;
  trust: TrustLevel;
}

function makeElement(text: string, trust: TrustLevel, detail?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `scene-label trust-${
    trust === '公开确认' ? 'public' : trust === '专利原理' ? 'patent' : 'edu'
  }`;
  const title = document.createElement('span');
  title.className = 'scene-label-text';
  title.textContent = text;
  el.appendChild(title);
  if (detail) {
    const sub = document.createElement('span');
    sub.className = 'scene-label-detail';
    sub.textContent = detail;
    el.appendChild(sub);
  }
  return el;
}

export function createNovantaLabels(train: NovantaOpticalTrain): {
  group: Group;
  items: LabelEntry[];
} {
  const group = new Group();
  const items: LabelEntry[] = [];
  const axisX = NOVANTA_BEAM_PATH.upstreamAxis.x;
  const axisY = NOVANTA_BEAM_PATH.upstreamAxis.y;

  const add = (
    id: string,
    text: string,
    trust: TrustLevel,
    position: Vector3,
    detail?: string,
  ) => {
    const el = makeElement(text, trust, detail);
    const object = new CSS2DObject(el);
    object.position.copy(position);
    object.userData.partId = id;
    group.add(object);
    items.push({ id, text, object, trust });
  };

  add(
    'novanta-inlet',
    '激光入口 / 光束衰减单元',
    '专利原理',
    new Vector3(axisX + 20, axisY - 14, NOVANTA_AXIS.inlet),
    '专利摘要中的组件 I；本页只画不追迹',
  );

  add(
    train.wobbleUnit.plateA.id,
    '平行平板 A · 绕 X 轴倾斜',
    '专利原理',
    new Vector3(axisX - 34, axisY + 26, NOVANTA_AXIS.plateA),
    `位移沿 Y · 教学参数：厚 ${NOVANTA_PLATES.thicknessMm} mm、n = ${NOVANTA_PLATES.refractiveIndex}`,
  );

  add(
    train.wobbleUnit.plateB.id,
    '平行平板 B · 绕 Y 轴倾斜',
    '专利原理',
    new Vector3(axisX + 36, axisY - 28, NOVANTA_AXIS.plateB),
    '位移沿 X · 两板转轴正交且都垂直于光轴（DE102004053298B4）',
  );

  add(
    train.telescope.negative.id,
    'Galilei 望远镜 · 凹透镜',
    '专利原理',
    new Vector3(axisX - 34, axisY + 20, NOVANTA_AXIS.telescopeNegativeLens),
    `Z 执行器沿光轴移动此片 · 焦距 ${NOVANTA_TELESCOPE.negativeFocalLengthMm} mm 为教学等效`,
  );

  add(
    train.telescope.positive.id,
    'Galilei 望远镜 · 凸（准直）镜',
    '专利原理',
    new Vector3(axisX + 34, axisY - 18, NOVANTA_AXIS.telescopePositiveLens),
    `位移放大 M·Δx 与口径放大由同一个 M 决定 · 焦距 ${NOVANTA_TELESCOPE.positiveFocalLengthMm} mm 为教学等效`,
  );

  add(
    train.yGalvo.id,
    'Y 振镜（scanblock 上游）',
    '专利原理',
    new Vector3(-56, -34, NOVANTA_AXIS.yGalvo),
    '专利：scanblock 由两面装在振镜上的独立反射镜组成',
  );

  add(
    train.xGalvo.id,
    'X 振镜（scanblock 下游 · 等效入瞳参考）',
    '专利原理',
    new Vector3(30, 34, NOVANTA_AXIS.xGalvo),
    '该镜命中点用作等效入瞳参考；倾斜镜面不等于水平入瞳面',
  );

  add(
    'objective',
    `物镜 · 焦距 ${NOVANTA_OBJECTIVE.focalLengthMm} mm`,
    '公开确认',
    new Vector3(34, -10, NOVANTA_OBJECTIVE.barrelTopZ + 22),
    '焦距为 PE III 官方数据表公开值；内部镜组、有效焦距与工作距离未公开',
  );

  add(
    'protective-window',
    '快换保护玻璃',
    '教学等效',
    new Vector3(48, 12, NOVANTA_AXIS.protectiveWindow - 8),
    '数据表提到 Lens purge 与更换件，具体结构未公开',
  );

  add(
    'gas-nozzle',
    '工艺气体喷嘴',
    '教学等效',
    new Vector3(52, -16, NOVANTA_AXIS.gasNozzle - 20),
    '专利把工作单元描述为"聚焦光学 + 气体喷嘴"的组合',
  );

  add('workpiece', '工件表面 z = 0', '教学等效', new Vector3(-14, 60, NOVANTA_AXIS.workpiece - 4));

  return { group, items };
}
