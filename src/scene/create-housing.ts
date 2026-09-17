/**
 * 外壳、电子学、水冷/气路接口与"外部系统"边界（计划书 §14）。
 *
 * 明确区分两件事：
 *   - precSYS 子系统内部：五轴扫描单元、控制电子学与嵌入式 PC、接口区、
 *     两路水冷、吹扫气、光束位置测量、保护玻璃抽屉、工艺气喷嘴、物镜；
 *   - 完整激光机床外围：激光器、运动平台、夹具、安全防护 —— 用灰色外部系统表示，
 *     并标注"不属于 precSYS 标准供货"。
 *
 * 外壳尺寸为教学示意包络，非实机安装图（实机主体参考约 303.5 mm × 271 mm）。
 */

import {
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  TorusGeometry,
} from 'three';
import { AXIS, BEAM_PATH, HOUSING } from '../config/layout';
import { COLORS } from '../config/visual-scale';
import type { SceneMaterials } from './create-scene';
import type { PartEntry } from './create-optics';

export interface HousingView {
  group: Group;
  parts: PartEntry[];
  /** 0 = 完全透明（隐藏外壳），1 = 最不透明。 */
  setOpacity(value: number): void;
}

export function buildHousingView(materials: SceneMaterials): HousingView {
  const group = new Group();
  const parts: PartEntry[] = [];

  const height = AXIS.housingTop - AXIS.housingBottom;
  const centerZ = (AXIS.housingTop + AXIS.housingBottom) / 2;

  // 主外壳
  const shell = new Mesh(
    new BoxGeometry(HOUSING.widthMm, HOUSING.depthMm, height),
    materials.housing,
  );
  shell.position.set(HOUSING.centerX, HOUSING.centerY, centerZ);
  shell.userData.partId = 'housing';
  group.add(shell);

  const edges = new LineSegments(
    new EdgesGeometry(new BoxGeometry(HOUSING.widthMm, HOUSING.depthMm, height)),
    new LineBasicMaterial({ color: COLORS.housing, transparent: true, opacity: 0.85 }),
  );
  edges.position.copy(shell.position);
  group.add(edges);

  parts.push({ id: 'housing', label: '主体外壳（教学示意包络）', object: shell });

  // 控制电子学与嵌入式 PC（DrillServer 运行处）
  const bay = new Mesh(
    new BoxGeometry(
      HOUSING.electronicsBay.w,
      HOUSING.electronicsBay.d,
      HOUSING.electronicsBay.h,
    ),
    materials.electronics,
  );
  bay.position.set(HOUSING.centerX, HOUSING.centerY - 6, HOUSING.electronicsBay.centerZ);
  bay.userData.partId = 'electronics';
  group.add(bay);
  parts.push({ id: 'electronics', label: '控制电子学与嵌入式 PC', object: bay });

  // 接口区（Ethernet / EtherCAT / PLC / 激光触发）
  const interfaceLabels = ['Ethernet', 'EtherCAT', 'PLC', 'Laser'];
  interfaceLabels.forEach((name, i) => {
    const box = new Mesh(new BoxGeometry(14, 10, 8), materials.metal);
    box.position.set(
      HOUSING.centerX - HOUSING.widthMm / 2 - 6,
      HOUSING.centerY + HOUSING.depthMm / 2 - 16 - i * 16,
      AXIS.housingBottom + 40,
    );
    box.userData.partId = 'interface';
    box.userData.interfaceName = name;
    group.add(box);
  });

  // 水冷接口与管路（振镜与电子学分别冷却）
  for (const offsetY of [-26, -46]) {
    const port = new Mesh(new CylinderGeometry(4, 4, 14, 16), materials.cooling);
    port.rotation.z = Math.PI / 2;
    port.position.set(
      HOUSING.centerX - HOUSING.widthMm / 2 - 8,
      HOUSING.centerY + offsetY,
      HOUSING.coolingPortZ,
    );
    port.userData.partId = 'cooling';
    group.add(port);

    const hose = new Mesh(new TorusGeometry(26, 3, 10, 28, Math.PI * 0.9), materials.cooling);
    hose.position.set(port.position.x - 22, port.position.y, port.position.z - 6);
    hose.rotation.set(Math.PI / 2, 0, 0.4);
    hose.userData.partId = 'cooling';
    group.add(hose);
  }
  parts.push({
    id: 'cooling',
    label: '水冷接口（振镜轴与电子学分别冷却）',
    object: group.children[group.children.length - 1],
  });

  // 正压吹扫气入口
  const purge = new Mesh(new CylinderGeometry(3.5, 3.5, 16, 14), materials.gas);
  purge.rotation.z = Math.PI / 2;
  purge.position.set(
    HOUSING.centerX - HOUSING.widthMm / 2 - 8,
    HOUSING.centerY,
    HOUSING.purgePortZ,
  );
  purge.userData.partId = 'purge';
  group.add(purge);

  const purgeLine = new Mesh(new CylinderGeometry(2, 2, 120, 12), materials.gas);
  purgeLine.position.set(purge.position.x - 46, purge.position.y, purge.position.z - 60);
  purgeLine.rotation.x = Math.PI / 2;
  purgeLine.userData.partId = 'purge';
  group.add(purgeLine);
  parts.push({ id: 'purge', label: '正压吹扫气入口（光路封闭吹扫）', object: purge });

  // ------------------- 外部系统（不属于 precSYS 标准供货） -------------------
  const external = new Group();
  external.userData.partId = 'external';

  const laser = new Mesh(new BoxGeometry(160, 120, 96), materials.electronics);
  laser.position.set(BEAM_PATH.inlet.x + 40, BEAM_PATH.inlet.y - 240, AXIS.inlet - 40);
  external.add(laser);

  const platform = new Mesh(new BoxGeometry(300, 300, 20), materials.electronics);
  platform.position.set(0, 0, AXIS.workpiece - 120);
  platform.receiveShadow = true;
  external.add(platform);

  const safety = new LineSegments(
    new EdgesGeometry(new BoxGeometry(820, 700, 980)),
    new LineBasicMaterial({ color: '#5a6474', transparent: true, opacity: 0.45 }),
  );
  safety.position.set(-30, -20, 400);
  external.add(safety);

  group.add(external);
  parts.push({ id: 'external', label: '外部系统：激光器 / 运动平台 / 安全防护（不属 precSYS）', object: external });

  const setOpacity = (value: number) => {
    // 0 = 几乎完全隐藏外壳，1 = 最清晰。默认 0.62 能看清内部又保留包络感。
    materials.housing.opacity = 0.03 + value * 0.42;
    shell.visible = value > 0;
    materials.housing.depthWrite = false;
    edges.visible = value > 0.03;
    (edges.material as LineBasicMaterial).opacity = 0.25 + value * 0.55;
  };

  return { group, parts, setOpacity };
}

/** 外部系统的说明文字（页面"整机边界"用）。 */
export const EXTERNAL_SYSTEM_NOTE =
  '灰色部分为完整激光加工设备的外围系统（激光器、运动平台、夹具、安全防护、抽排），通常不由 SCANLAB 标配提供。';
