import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  TorusGeometry, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MirrorSpec } from '../optics/mirror';

export interface GalvoMotor {
  group: Group;
  update(angle: number): void;
}

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
      signal.emissiveIntensity = moving ? 1.8 : 0.1;
      group.userData.angleRad = angle;
      group.userData.moving = moving;
      if (label) {
        label.classList.toggle('moving', moving);
        label.textContent = `${name} 电机 ${(angle*180/Math.PI).toFixed(2)}° ${moving ? '↔' : '·'}`;
      }
    },
  };
}
