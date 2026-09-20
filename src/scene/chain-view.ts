/**
 * 场景层的"整机视图"抽象。
 *
 * 目的：让 main.ts 不必到处写 `if (vendor === ...)`。
 * 两条技术路线的链路对象、执行器字段名、高亮分组完全不同，
 * 但它们对外的**渲染接口**可以一致：
 *   更新位姿 / 更新光束 / 拾取 / 高亮 / 爆炸视图参数。
 *
 * 这里不合并两条光路 —— 各自的实现仍然在自己的文件里：
 *   SCANLAB  → scene/create-optics.ts + scene/create-beam.ts
 *   Novanta  → scene/novanta-optics.ts + scene/novanta-beam.ts
 */

import type { Group, Object3D } from 'three';
import type { AnyActuators, AnyTrainTrace, Vendor } from '../app-state';
import type { SceneMaterials } from './create-scene';
import type { PartEntry } from './create-optics';

export interface ChainView {
  vendor: Vendor;
  /** 该路线光学部件的根分组。 */
  group: Group;
  /** 可拾取部件（id / label / object）。 */
  parts: PartEntry[];
  /** 每帧更新：按本帧执行器与追迹结果刷新位姿与读数标注。 */
  update(actuators: AnyActuators, trace: AnyTrainTrace): void;
  /** 高亮/降透明度。传 null 表示全部恢复。 */
  setHighlight(ids: Set<string> | null): void;
  /** 显示/隐藏执行器与驱动外形（含它们的读数标签）。 */
  setMotorsVisible(visible: boolean): void;
  /** 爆炸视图参数（外壳与外围包络用，光学件保持原位）。 */
  explode(value: number): void;
}

/** 爆炸视图时把外壳往外挪的距离与放大倍数（教学示意）。 */
export const EXPLODE = {
  scale: 0.14,
  liftZ: 40,
  shiftX: 65,
} as const;

export interface BeamViewLike {
  group: Group;
  /**
   * 用快照里的追迹结果更新光束。
   *
   * 传入的是**带标签的联合**（AnyTrainTrace），实现内部自己按 `vendor` 收窄；
   * 这样 main.ts 不需要知道哪条路线用哪种 trace 类型。
   */
  update(trace: AnyTrainTrace, ghost: AnyTrainTrace | null, options: BeamOptions): void;
  pushTrailPoint(point: import('three').Vector3): void;
  clearTrail(): void;
}

/**
 * 把 SCANLAB 的 OpticsView 适配成 ChainView。
 *
 * 目的是**不改动已经稳定的 create-optics.ts**：它的更新逻辑、部件注册顺序与
 * 高亮实现都保持不变，只是在这里补上 vendor 标记、高亮与爆炸视图三个接口。
 */
export function adaptScanlabView(view: {
  group: Group;
  parts: PartEntry[];
  update(actuators: never, trace: never): void;
}): ChainView {
  const tinted: import('three').Mesh[] = [];
  view.group.traverse((object) => {
    const mesh = object as import('three').Mesh;
    if (mesh.isMesh) tinted.push(mesh);
  });
  return {
    vendor: 'scanlab',
    group: view.group,
    parts: view.parts,
    update: (actuators, trace) => {
      if (actuators.vendor !== 'scanlab' || trace.vendor !== 'scanlab') return;
      (view.update as unknown as (a: unknown, t: unknown) => void)(actuators.actuators, trace.trace);
    },
    /**
     * 与 create-optics.ts 里原来的 applyHighlight 完全一致：
     * 反射镜保持不透明，其余部件降低透明度。
     */
    setHighlight: (ids) => {
      for (const part of view.parts) {
        const active = !ids || ids.has(part.id);
        part.object.traverse((child) => {
          const mesh = child as import('three').Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) {
            const m = material as import('three').MeshStandardMaterial;
            if (m.userData.baseOpacity === undefined) {
              m.userData.baseOpacity = typeof m.opacity === 'number' ? m.opacity : 1;
            }
            const base = m.userData.baseOpacity as number;
            const reflective = Boolean(part.spec && part.spec.kind !== 'splitter');
            m.transparent = reflective ? false : base < 1;
            m.opacity = reflective ? 1 : active ? base : Math.max(0.14, base * 0.65);
            m.depthWrite = reflective || base > 0.95;
          }
        });
      }
    },
    /** 隐藏执行器外形（电机 + 读数标签），不影响光学与读数。 */
    setMotorsVisible: (visible: boolean) => {
      view.group.traverse((object) => {
        if (object.userData.motorAxis) object.visible = visible;
      });
    },
    // 光学件保持原位（爆炸只对外壳与外围包络生效）
    explode: () => {
      view.group.position.set(0, 0, 0);
    },
  };
}

export interface BeamOptions {
  showCenter: boolean;
  showEnvelope: boolean;
  showGhost: boolean;
  showNormals: boolean;
}

/** 部件视图公共接口（与 create-optics.ts 的 OpticsView 同形）。 */
export interface ChainPartsView {
  group: Group;
  parts: PartEntry[];
}

export type { SceneMaterials, Object3D };
