import { BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  TorusGeometry, Vector2, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { focusLensesAt, type FocusModuleGeometry, type FocusTraceResult } from '../optics/focus-module';

/** 直线驱动外形为教学示意；不把音圈直线运动说成振镜旋转。 */
export function createFocusStage(geom: FocusModuleGeometry) {
  const group = new Group();
  group.name = 'z-linear-stage';
  group.userData.partId = 'z-module';
  group.userData.motorAxis = 'Z';
  const metal = new MeshStandardMaterial({ color: '#406b7c', metalness: 0.7, roughness: 0.35 });
  const silver = new MeshStandardMaterial({ color: '#b8d0df', metalness: 0.7, roughness: 0.3 });
  const glass = new MeshStandardMaterial({ color: '#63daf1', transparent: true, opacity: 0.3,
    metalness: 0.1, roughness: 0.15, depthWrite: false });
  const lensGroups = geom.lenses.map(lens => {
    const moving = new Group();
    moving.position.copy(lens.center);
    moving.userData.partId = lens.id;
    const radius = lens.size.u / 2;
    const profile: Vector2[] = [];
    const halfThickness = (r: number) => lens.focalLengthMm > 0
      ? 0.35 + 0.65 * (1 - r * r / radius ** 2) : 0.3 + 0.7 * r * r / radius ** 2;
    for (let i = 0; i <= 16; i++) { const r = radius * i / 16; profile.push(new Vector2(r, -halfThickness(r))); }
    for (let i = 16; i >= 0; i--) { const r = radius * i / 16; profile.push(new Vector2(r, halfThickness(r))); }
    const geometry = new LatheGeometry(profile, 48);
    geometry.rotateX(Math.PI / 2);
    const mesh = new Mesh(geometry, glass);
    mesh.userData.partId = lens.id;
    moving.add(mesh);
    const rim = new Mesh(new TorusGeometry(radius + 0.9, 0.85, 8, 48), silver);
    rim.userData.partId = lens.id;
    moving.add(rim);
    const arm = new Mesh(new BoxGeometry(8, 3, 2), metal);
    arm.position.x = -radius - 5;
    arm.userData.partId = lens.id;
    moving.add(arm);
    const carriage = new Mesh(new BoxGeometry(5, 8, 4), metal);
    carriage.position.x = -radius - 10;
    carriage.userData.partId = lens.id;
    moving.add(carriage);
    let label: HTMLDivElement | null = null;
    if (typeof document !== 'undefined') {
      label = document.createElement('div'); label.className = 'motor-label';
      const tag = new CSS2DObject(label); tag.position.set(radius + 8, 0, 0); moving.add(tag);
    }
    group.add(moving);
    return { moving, mesh, label, lens };
  });
  for (const y of [-2.5, 2.5]) {
    const railGeo = new CylinderGeometry(0.65, 0.65, 40, 12); railGeo.rotateX(Math.PI / 2);
    const rail = new Mesh(railGeo, silver);
    rail.position.copy(geom.anchor).add(new Vector3(-20, y, 0));
    group.add(rail);
  }
  const stator = new Mesh(new BoxGeometry(8, 12, 20), metal);
  stator.position.copy(geom.anchor).add(new Vector3(-27, 0, 0));
  stator.userData.partId = 'z-module'; group.add(stator);
  let previous = NaN;
  const update = (qMm: number, trace: FocusTraceResult | null) => {
    const lenses = trace?.lenses ?? focusLensesAt(geom, qMm);
    const moving = Number.isFinite(previous) && Math.abs(qMm - previous) > 1e-8;
    previous = qMm;
    group.userData.travelMm = qMm; group.userData.moving = moving;
    for (const [i, view] of lensGroups.entries()) {
      view.moving.position.copy(lenses[i].center);
      if (view.label) {
        const displacement = lenses[i].center.z - geom.lenses[i].center.z;
        view.label.textContent = `L${i + 1} ${i === 1 ? '固定凹透镜' : `移动 ${displacement.toFixed(3)} mm`} ${i !== 1 && moving ? '↕' : ''}`;
        view.label.classList.toggle('moving', i !== 1 && moving);
      }
    }
  };
  update(0, null);
  return { group, lensGroups, update };
}
