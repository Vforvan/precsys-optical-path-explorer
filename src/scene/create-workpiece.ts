/**
 * 工件、加工孔与去除痕迹。
 *
 * 工件表面位于 z = 0（计划书 §6 的坐标约定）。孔、孔壁趋势与去除环都只是
 * "定性演示"：网页不做材料去除仿真，也不会给出真实工艺预测。
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { AXIS, WORKPIECE } from '../config/layout';
import { beamAlignedCylinder } from './geometry-helpers';
import { COLORS } from '../config/visual-scale';
import type { SceneMaterials } from './create-scene';
import type { PartEntry } from './create-optics';
import type { TaperPreset } from '../animation/process-modes';

export interface WorkpieceView {
  group: Group;
  parts: PartEntry[];
  /** 更新孔的几何（半径、深度、锥度趋势）。 */
  updateHole(radiusMm: number, depthMm: number, taper: TaperPreset): void;
  /** 高亮焦点落点处的去除环。 */
  setFocusRadius(radiusMm: number): void;
  setVisible(visible: boolean): void;
}

export function buildWorkpieceView(materials: SceneMaterials): WorkpieceView {
  const group = new Group();
  const parts: PartEntry[] = [];

  const body = new Mesh(
    new BoxGeometry(WORKPIECE.sizeX, WORKPIECE.sizeY, WORKPIECE.thickness),
    materials.workpiece,
  );
  body.position.set(0, 0, AXIS.workpiece - WORKPIECE.thickness / 2);
  body.receiveShadow = true;
  body.castShadow = true;
  body.userData.partId = 'workpiece';
  group.add(body);
  parts.push({ id: 'workpiece', label: '工件（材料未指定，仅示意）', object: body });

  // 孔：用深色内腔表示（不做布尔运算）
  const holeMaterial = new MeshBasicMaterial({
    color: '#05070a',
    transparent: true,
    opacity: 0.9,
  });
  const hole = new Mesh(beamAlignedCylinder(1, 1, 1, 40, true), holeMaterial);
  hole.userData.partId = 'workpiece';
  group.add(hole);

  // 孔口环
  const rim = new Mesh(
    new RingGeometry(0.9, 1, 48),
    new MeshBasicMaterial({ color: COLORS.ablation, transparent: true, opacity: 0.75 }),
  );
  rim.userData.partId = 'workpiece';
  group.add(rim);

  // 焦点处的去除环
  const removal = new Mesh(new TorusGeometry(1, 0.35, 10, 48), materials.ablation);
  removal.userData.partId = 'workpiece';
  group.add(removal);

  let lastHole = '';
  let lastRadius = NaN;
  const updateHole = (radiusMm: number, depthMm: number, taper: TaperPreset) => {
    const key = `${radiusMm}/${depthMm}/${taper}`;
    if (key === lastHole) return;
    lastHole = key;
    const top = Math.max(0.05, radiusMm);
    const bottom = taper === 'positive'
      ? Math.max(0.02, radiusMm * 0.55)
      : taper === 'negative'
        ? radiusMm * 1.45
        : radiusMm;
    const depth = Math.max(0.5, depthMm);
    hole.geometry.dispose();
    hole.geometry = beamAlignedCylinder(top, bottom, depth, 40, true);
    hole.position.set(0, 0, AXIS.workpiece - depth / 2);
    rim.geometry.dispose();
    rim.geometry = new RingGeometry(top * 0.92, top * 1.12, 48);
    rim.position.set(0, 0, AXIS.workpiece + 0.05);
  };

  const setFocusRadius = (radiusMm: number) => {
    if (radiusMm === lastRadius) return;
    lastRadius = radiusMm;
    const r = Math.max(0.12, radiusMm);
    removal.geometry.dispose();
    removal.geometry = new TorusGeometry(r, Math.min(0.12, r * 0.25 + 0.05), 10, 48);
    removal.position.set(0, 0, AXIS.workpiece + 0.2);
  };

  updateHole(0.4, 6, 'negative');
  setFocusRadius(0.5);

  return {
    group,
    parts,
    updateHole,
    setFocusRadius,
    setVisible: (visible: boolean) => {
      group.visible = visible;
    },
  };
}

/** 工件坐标轴指示（+X 右、+Y 后、+Z 指向扫描头）。 */
export function createWorkpieceAxes(length = 26): Object3D {
  const g = new Group();
  const axis = (dir: Vector3, color: string) => {
    const mesh = new Mesh(
      new CylinderGeometry(0.4, 0.4, length, 8),
      new MeshBasicMaterial({ color }),
    );
    mesh.position.copy(dir.clone().multiplyScalar(length / 2));
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    g.add(mesh);
  };
  axis(new Vector3(1, 0, 0), '#ff6b6b');
  axis(new Vector3(0, 1, 0), '#6bff9b');
  axis(new Vector3(0, 0, 1), '#6bb8ff');
  g.position.set(0, 0, AXIS.workpiece + 0.4);
  return g;
}
