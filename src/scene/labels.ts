/**
 * 三维标签（CSS2D）。
 *
 * 标签用 HTML 元素贴在三维位置上，因此可以带字号、背景与"可信等级"色标，
 * 缩放时保持清晰。标签内容全部来自配置，不写死数字。
 */

import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Group, Vector3 } from 'three';
import { AXIS, BEAM_PATH } from '../config/layout';
import type { OpticalTrain } from '../optics/optical-train';
import type { TrustLevel } from '../config/public-specs';

export interface LabelEntry {
  id: string;
  text: string;
  object: CSS2DObject;
  trust: TrustLevel;
}

function makeElement(text: string, trust: TrustLevel, detail?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `scene-label trust-${trust === '公开确认' ? 'public' : trust === '专利原理' ? 'patent' : 'edu'}`;
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

export function createLabels(train: OpticalTrain): { group: Group; items: LabelEntry[] } {
  const group = new Group();
  const items: LabelEntry[] = [];

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

  const inletOffset = new Vector3(16, -14, 0);

  add('inlet', '激光入口 · 入射净孔径 4 mm', '公开确认', new Vector3(
    BEAM_PATH.inlet.x + 18,
    BEAM_PATH.inlet.y - 12,
    AXIS.inlet,
  ));

  add('beam-conditioning', '光束调理单元（可选）', '公开确认', new Vector3(
    BEAM_PATH.inlet.x + 20,
    BEAM_PATH.inlet.y + 16,
    AXIS.beamExpander,
  ), 'λ/2、λ/4 波片 · 扩束 0.25–4');

  add('alpha-module', 'α 平行移束模块（教学结构）', '教学等效', train.alphaModule.A.clone().add(
    new Vector3(-32, 42, 8),
  ), '4 次反射 · 单镜 26 在此用分体镜面等效');

  add('beta-module', 'β 平行移束模块（教学结构）', '教学等效', train.betaModule.A.clone().add(
    new Vector3(-32, -50, 8),
  ), '本模型选择正交排布 · 专利的位移方向可选正交');

  add('z-module', 'Z 动态调焦等效模块', '教学等效', new Vector3(
    BEAM_PATH.afterBeta.x - 46,
    BEAM_PATH.afterBeta.y - 16,
    AXIS.zGalvo,
  ), '改变物镜前光束会聚状态 → 移动焦点 Z');

  add('galvo-y', 'Y 振镜（教学排布）', '教学等效', new Vector3(
    train.yGalvo.center.x - 2,
    train.yGalvo.center.y - 46,
    AXIS.galvoPlane + 4,
  ));

  add('galvo-x', 'X 振镜（等效入瞳参考）', '教学等效', new Vector3(
    train.xGalvo.center.x + 14,
    train.xGalvo.center.y + 48,
    AXIS.galvoPlane + 2,
  ));

  add('monitor-splitter', '监测分光元件 + 光束位置测量单元', '教学等效', new Vector3(
    BEAM_PATH.afterBeta.x - 72,
    BEAM_PATH.afterBeta.y - 48,
    AXIS.monitoringSplitter - 6,
  ), '用于 Automatic Fine Adjustment');

  add('objective', '物镜 · 焦距 75 mm / 有效焦距 25 mm', '公开确认', new Vector3(
    40,
    -6,
    AXIS.objectiveLastLens + 44,
  ), '焦距为公开值 · 内部镜组及后段距离为教学等效');

  add('protective-window', '快换保护玻璃抽屉', '公开确认', new Vector3(
    54,
    8,
    AXIS.protectiveWindow - 10,
  ));

  add('gas-nozzle', '工艺气体喷嘴（标准开口 1 mm）', '公开确认', new Vector3(
    62,
    -14,
    AXIS.gasNozzle - 22,
  ));

  add('workpiece', '工件表面 z = 0', '教学等效', new Vector3(-14, 62, AXIS.workpiece - 4));

  void inletOffset;

  return { group, items };
}
