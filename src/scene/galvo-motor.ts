import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  TorusGeometry, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MirrorSpec } from '../optics/mirror';

export interface GalvoMotor {
  group: Group;
  update(angle: number): void;
}

/**
 * 角度指示弧的视觉放大倍数。
 * 真实机械角常常只有零点几度（Z 轴 ±1 mm 焦点范围 ≈ ±0.76°），
 * 放大后才能在屏幕上看出"哪个轴在动、往哪边动"。
 * 只影响这段指示弧，镜片姿态与光线仍按真实角度计算。
 */
export const MOTOR_ARC_GAIN = 12;

/** 定子固定在旋转轴上；转轴与转子按真实机械角转动，外置读数帮助辨认小角度摆动。 */
export function createGalvoMotor(spec: MirrorSpec, name: string): GalvoMotor {
  const group = new Group();
  group.name = `motor-${name}`;
  group.userData.partId = spec.id;
  group.userData.motorAxis = name;
  const axis = (spec.rotationAxis ?? spec.v).clone().normalize();
  const directionSign = name === 'Y' ? -1 : 1;
  axis.multiplyScalar(directionSign);
  group.position.copy(spec.rotationPivot ?? spec.center);
  group.quaternion.setFromUnitVectors(new Vector3(0,0,1), axis);
  const reach = spec.size.v / 2 + 8;
  const casing = new MeshStandardMaterial({ color: '#315966', metalness: 0.7, roughness: 0.35 });
  const silver = new MeshStandardMaterial({ color: '#bacbd4', metalness: 0.75, roughness: 0.28 });
  const signal = new MeshStandardMaterial({ color: '#ffaa55', emissive: '#ff8c35', emissiveIntensity: 0.1 });
  const cylinder = (r: number, length: number, z: number, mat: MeshStandardMaterial) => {
    const geo = new CylinderGeometry(r,r,length,24);
    geo.rotateX(Math.PI / 2);
    const mesh = new Mesh(geo, mat);
    mesh.position.z = z;
    mesh.userData.partId = spec.id;
    return mesh;
  };
  group.add(cylinder(6.4,18,reach+9,casing));
  group.add(cylinder(7.1,2,reach,silver), cylinder(6.8,2,reach+18,silver));
  const rotor = new Group();
  rotor.name = 'rotor';
  const shaftStart = spec.size.v / 2 + 1;
  rotor.add(cylinder(1.3, reach-shaftStart, (reach+shaftStart)/2, silver));
  const key = new Mesh(new BoxGeometry(2, 5.4, 1.2), signal);
  key.position.set(0,2,reach+19.5);
  rotor.add(key);
  group.add(rotor);
  const dial = new Mesh(new TorusGeometry(5.5,0.35,8,32), signal);
  dial.position.z = reach+19.7;
  group.add(dial);

  /**
   * 角度指示弧：真实机械角往往只有零点几度（例如 Z 轴 ±1 mm 焦点范围仅需 ±0.76°），
   * 转子上的键位在这种量级下肉眼等于静止。这里额外画一段**放大显示**的弧，
   * 长度 = |真实角| × MOTOR_ARC_GAIN，方向与转向一致；
   * 它只是读数指示，不参与任何光学计算，也不会影响镜片姿态与光线。
   */
  const arc = new Mesh(
    new TorusGeometry(6.9, 0.9, 8, 24, 0.001),
    new MeshStandardMaterial({ color: '#7ff6ff', emissive: '#2fd4e8', emissiveIntensity: 1.4 }),
  );
  arc.position.z = reach + 19.7;
  arc.visible = false;
  group.add(arc);
  let arcShown = 0;
  const updateArc = (angle: number) => {
    const shown = Math.min(Math.PI * 0.9, Math.abs(angle) * MOTOR_ARC_GAIN);
    if (Math.abs(shown - arcShown) < 0.01) return;
    arcShown = shown;
    arc.geometry.dispose();
    arc.geometry = new TorusGeometry(6.9, 0.9, 8, Math.max(3, Math.ceil(shown / 0.05) + 2), Math.max(0.001, shown));
    arc.rotation.z = angle < 0 ? -shown : 0;
    arc.visible = shown > 0.01;
  };

  const connector = new Mesh(new BoxGeometry(4,5,6), casing);
  connector.position.set(7,0,reach+10);
  group.add(connector);
  let label: HTMLElement | null = null;
  if (typeof document !== 'undefined') {
    label = document.createElement('div');
    label.className = 'motor-label';
    const object = new CSS2DObject(label);
    object.position.set(13,0,reach+20);
    group.add(object);
  }
  let previous = 0;
  return {
    group,
    update(angle) {
      const moving = Math.abs(angle - previous) > 1e-8;
      previous = angle;
      rotor.rotation.z = angle * directionSign;
      updateArc(angle);
      signal.emissiveIntensity = moving ? 1.8 : 0.1;
      group.userData.angleRad = angle;
      group.userData.moving = moving;
      if (label) {
        label.classList.toggle('moving', moving);
        // 括号里注明指示弧已放大，避免读者把弧长当成真实角度
        label.textContent = `${name} 电机 ${(angle * 180 / Math.PI).toFixed(2)}° ${moving ? '↔' : '·'} ×${MOTOR_ARC_GAIN}`;
      }
    },
  };
}
