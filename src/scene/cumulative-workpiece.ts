import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { WORKPIECE } from '../config/layout';
import type { PartEntry } from './create-optics';
import { MaterialRemoval } from '../simulation/material-removal';
import { commandAtTheta, type ProcessParams } from '../animation/process-modes';

export interface WorkpieceView {
  group: Group;
  detail: Mesh;
  parts: PartEntry[];
  material: MaterialRemoval;
  selectSession(key: string): void;
  sweep(params: ProcessParams, from: number, to: number): void;
  refreshMesh(): void;
  setSection(enabled: boolean): void;
}

export function buildWorkpieceView(): WorkpieceView {
  const group = new Group();
  const material = new MaterialRemoval();
  const metal = new MeshStandardMaterial({ color: '#829baf', metalness: 0.4, roughness: 0.55 });
  const surface = new Mesh(new BufferGeometry(), metal);
  surface.userData.partId = 'workpiece';
  surface.castShadow = true;
  surface.receiveShadow = true;
  group.add(surface);
  const detail = new Mesh(surface.geometry, metal);
  detail.userData.partId = 'workpiece';
  // 大台面留出真实开口，中央嵌入可去除的实体试样。
  const half = material.width / 2;
  const outside = WORKPIECE.sizeX / 2;
  for (const [w, h, x, y] of [
    [outside-half, outside*2, -(outside+half)/2, 0],
    [outside-half, outside*2, (outside+half)/2, 0],
    [half*2, outside-half, 0, -(outside+half)/2],
    [half*2, outside-half, 0, (outside+half)/2],
  ]) {
    const rail = new Mesh(new BoxGeometry(w, h, material.depth), metal);
    rail.position.set(x, y, -material.depth / 2);
    rail.userData.partId = 'workpiece';
    group.add(rail);
  }
  let meshRevision = -1;
  let remainder = 0;
  let section = false;
  const refreshMesh = () => {
    if (meshRevision === material.stats().revision) return;
    const data = material.surface();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
    geometry.computeBoundingSphere();
    if (detail.geometry !== surface.geometry) detail.geometry.dispose();
    surface.geometry.dispose();
    surface.geometry = geometry;
    if (section) {
      const cut = material.surface(true);
      const cutGeometry = new BufferGeometry();
      cutGeometry.setAttribute('position', new Float32BufferAttribute(cut.positions, 3));
      cutGeometry.setAttribute('normal', new Float32BufferAttribute(cut.normals, 3));
      cutGeometry.computeBoundingSphere();
      detail.geometry = cutGeometry;
    } else detail.geometry = geometry;
    meshRevision = material.stats().revision;
  };
  refreshMesh();
  return {
    group, detail, material,
    parts: [{ id: 'workpiece', label: '工件 · 累积体素去除', object: group }],
    selectSession(key) {
      if (material.selectSession(key)) { remainder = 0; refreshMesh(); }
    },
    sweep(params, from, to) {
      const spacing = Math.PI * 2 / 256;
      const cycle = params.revolutions * Math.PI * 2;
      if (to <= from || !Number.isFinite(to - from)) return;
      let cursor = from;
      while (cursor + spacing - remainder <= to + 1e-10) {
        cursor += spacing - remainder;
        remainder = 0;
        material.expose(commandAtTheta(params, ((cursor % cycle) + cycle) % cycle));
      }
      remainder += Math.max(0, to - cursor);
    },
    refreshMesh,
    setSection(enabled) { section = enabled; meshRevision = -1; refreshMesh(); },
  };
}
