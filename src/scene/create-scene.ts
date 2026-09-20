/**
 * 场景核心：渲染器、相机、控制器、灯光与材质库。
 *
 * 坐标约定与计划书 §6 一致：+X 右、+Y 后、+Z 从工件指向扫描头，
 * 相机 camera.up = (0,0,1)，避免屏幕"上方"与机床 Z 轴概念冲突。
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLORS } from '../config/visual-scale';

export interface SceneMaterials {
  beamCore: MeshStandardMaterial;
  beamGlow: MeshStandardMaterial;
  ghost: MeshStandardMaterial;
  focus: MeshStandardMaterial;
  mirrorFixed: MeshPhysicalMaterial;
  mirrorMovable: MeshPhysicalMaterial;
  optic: MeshPhysicalMaterial;
  housing: MeshPhysicalMaterial;
  electronics: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  sensor: MeshStandardMaterial;
  cooling: MeshStandardMaterial;
  gas: MeshStandardMaterial;
  workpiece: MeshPhysicalMaterial;
  ablation: MeshStandardMaterial;
  frame: MeshStandardMaterial;
  dimmed: MeshStandardMaterial;
  highlight: MeshStandardMaterial;
}

export function createMaterials(): SceneMaterials {
  /**
   * 镜面材质。关键点：金属材质在 three.js 里没有环境贴图会渲染成纯黑，
   * 所以这里把 metalness 降到 0.65 左右并提高环境反射强度，
   * 保证"每块镜片都看得清"，同时保留金属反射感。
   */
  const mirror = (color: string, emissive = 0x000000, transparent = false) =>
    new MeshPhysicalMaterial({
      color: new Color(color),
      emissive: new Color(emissive),
      emissiveIntensity: 0.18,
      metalness: 0.72,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 2.2,
      transparent,
      opacity: transparent ? 0.95 : 1,
      side: 2,
    });

  return {
    beamCore: new MeshStandardMaterial({
      color: new Color(COLORS.beamMain),
      emissive: new Color(COLORS.beamMain),
      emissiveIntensity: 1.5,
      roughness: 0.4,
      metalness: 0,
      transparent: true,
      opacity: 0.92,
    }),
    beamGlow: new MeshStandardMaterial({
      color: new Color(COLORS.beamMain),
      emissive: new Color(COLORS.beamMain),
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    }),
    ghost: new MeshStandardMaterial({
      color: new Color(COLORS.beamGhost),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
    focus: new MeshStandardMaterial({
      color: new Color(COLORS.focus),
      emissive: new Color(COLORS.focus),
      emissiveIntensity: 3,
    }),
    // 固定镜：银灰；可动镜：偏青（与"主动振镜 = 青色"的语义一致）
    mirrorFixed: mirror(COLORS.fixedMirror),
    mirrorMovable: mirror(COLORS.movableMirror, 0x0e3b4a),
    // 透镜/镜筒：中性淡蓝灰玻璃。
    // 之前用饱和紫蓝（#8b8cf0）画物镜镜筒，看起来像"悬在光路上的紫色胶囊"，很违和。
    optic: new MeshPhysicalMaterial({
      color: new Color('#9fb6d6'),
      metalness: 0.02,
      roughness: 0.16,
      transmission: 0.9,
      thickness: 3,
      ior: 1.55,
      transparent: true,
      opacity: 0.38,
      side: 2,
      depthWrite: false,
    }),
    // 外壳：偏亮的玻璃灰蓝。太暗会在暗背景上变成"黑墙"。
    housing: new MeshPhysicalMaterial({
      color: new Color('#93a6c0'),
      metalness: 0.2,
      roughness: 0.35,
      transparent: true,
      opacity: 0.16,
      side: 2,
      depthWrite: false,
    }),
    electronics: new MeshStandardMaterial({
      color: new Color('#2f3a4a'),
      metalness: 0.4,
      roughness: 0.6,
    }),
    metal: new MeshStandardMaterial({ color: new Color('#9aa6b5'), metalness: 0.85, roughness: 0.3 }),
    sensor: new MeshStandardMaterial({
      color: new Color(COLORS.sensor),
      emissive: new Color(COLORS.sensor),
      emissiveIntensity: 0.35,
      metalness: 0.2,
      roughness: 0.5,
    }),
    cooling: new MeshStandardMaterial({ color: new Color(COLORS.cooling), metalness: 0.5, roughness: 0.35 }),
    gas: new MeshStandardMaterial({ color: new Color(COLORS.gas), metalness: 0.5, roughness: 0.4 }),
    workpiece: new MeshPhysicalMaterial({
      color: new Color(COLORS.workpiece),
      metalness: 0.25,
      roughness: 0.55,
      transparent: true,
      opacity: 0.55,
      side: 2,
    }),
    ablation: new MeshStandardMaterial({
      color: new Color(COLORS.ablation),
      emissive: new Color(COLORS.ablation),
      emissiveIntensity: 0.6,
      roughness: 0.7,
    }),
    frame: new MeshStandardMaterial({ color: new Color('#586374'), metalness: 0.6, roughness: 0.5 }),
    dimmed: new MeshStandardMaterial({
      color: new Color(COLORS.dimmed),
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
    highlight: new MeshStandardMaterial({
      color: new Color(COLORS.activeGalvo),
      emissive: new Color(COLORS.activeGalvo),
      emissiveIntensity: 1.1,
      metalness: 0.4,
      roughness: 0.35,
    }),
  };
}

export interface SceneViewOptions {
  container: HTMLElement;
  onPick: (objectId: string | null) => void;
}

export class SceneView {
  readonly scene = new Scene();

  readonly camera: PerspectiveCamera;

  readonly renderer: WebGLRenderer;

  /** HTML 标签渲染器（CSS2D），提供清晰可缩放的部件名。 */
  readonly labelRenderer: CSS2DRenderer;

  readonly controls: OrbitControls;

  readonly materials = createMaterials();

  /** 所有可拾取对象的根。 */
  readonly pickables: Object3D[] = [];

  /** 参与"爆炸视图"的对象及其爆炸方向。 */
  readonly explosive = new Map<Object3D, Vector3>();

  private readonly raycaster = new Raycaster();

  private readonly pointer = new Vector2();

  private readonly container: HTMLElement;

  private readonly onPick: (objectId: string | null) => void;

  private width = 1;

  private height = 1;

  private frame = 0;

  /** 每帧回调（由 main.ts 注入）。 */
  onFrame: ((elapsedSeconds: number) => void) | null = null;

  private lastTime = 0;

  private running = false;
  private resizeObserver: ResizeObserver;

  constructor(options: SceneViewOptions) {
    this.container = options.container;
    this.onPick = options.onPick;

    this.scene.background = new Color('#16202e');
    // 不用雾：之前的 Fog(900,2400) 会把远处的部件"吃掉"，
    // 换个观察角度就像少了半个机器（那是雾，不是遮挡）。
    this.scene.fog = null;

    this.camera = new PerspectiveCamera(42, 1, 1, 6000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(430, -520, 420);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    this.container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(-8, -6, 300);
    this.controls.minDistance = 40;
    this.controls.maxDistance = 3200;
    this.controls.autoRotateSpeed = 0.9;

    this.addLights();
    this.addGround();

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
  }

  private addLights(): void {
    // 环境贴图：金属镜面没有它就会渲染成纯黑（这是"看不清镜片"的根因）
    const pmrem = new PMREMGenerator(this.renderer);
    // sigma 取 0.04：再大就会触发 PMREM 的采样上限告警
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;

    this.scene.add(new HemisphereLight(0xe8f1ff, 0x2a3140, 1.15));
    this.scene.add(new AmbientLight(0xffffff, 0.32));

    const key = new DirectionalLight(0xffffff, 2.0);
    key.position.set(320, -420, 620);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 50;
    key.shadow.camera.far = 2000;
    key.shadow.camera.left = -420;
    key.shadow.camera.right = 420;
    key.shadow.camera.top = 520;
    key.shadow.camera.bottom = -220;
    this.scene.add(key);

    const fill = new DirectionalLight(0x9fc2ff, 1.0);
    fill.position.set(-420, 380, 260);
    this.scene.add(fill);

    // 侧面补光：让竖直方向的光路和镜片边缘不至于全黑
    const side = new DirectionalLight(0xbfe4ff, 0.85);
    side.position.set(260, 420, 120);
    this.scene.add(side);

    const rim = new PointLight(0xffb27a, 120, 1200, 2);
    rim.position.set(-120, -60, 120);
    this.scene.add(rim);
  }

  /** 工件台面参考网格（仅作空间参照，不代表实机底座）。 */
  private addGround(): void {
    const grid = new Group();
    /**
     * 注意坐标系：本项目 Z 轴是竖直方向（工件表面 z = 0，扫描头在上方）。
     * PlaneGeometry 默认躺在 XY 平面、法向 +Z —— 这正好就是"水平地面"，
     * **不需要任何旋转**。
     *
     * 早期版本照搬了"Y 向上"的习惯写了 rotation.x = π/2，
     * 结果把地面转成了一面 900 mm × 900 mm 的**竖直墙**，正好穿过机器中轴，
     * 从默认视角看就是"机器中间有一块黑墙把整机截断"。
     */
    const plane = new Mesh(
      new PlaneGeometry(900, 900),
      new MeshStandardMaterial({
        color: new Color('#2a3648'),
        metalness: 0.05,
        roughness: 0.95,
        transparent: true,
        opacity: 0.3,
        side: 2,
      }),
    );
    plane.position.set(-8, -6, -140);
    plane.receiveShadow = true;
    grid.add(plane);

    // 中心圈：给一个明确的空间参照（同样躺在水平面上）
    const ring = new Mesh(
      new RingGeometry(58, 60, 64),
      new MeshBasicMaterial({ color: new Color('#4a6484'), transparent: true, opacity: 0.55, side: 2 }),
    );
    ring.position.set(0, 0, plane.position.z + 0.3);
    grid.add(ring);
    this.scene.add(grid);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits: Intersection<Object3D>[] = this.raycaster.intersectObjects(this.pickables, true);
    const first = hits.find((h) => h.object.visible);
    const id = (first?.object.userData?.partId as string | undefined) ?? null;
    this.onPick(id);
  };

  private handleResize = (): void => {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.labelRenderer.setSize(this.width, this.height);
  };

  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
  }

  /** 平滑移动到指定观察位（部件特写 / 重置视图）。 */
  focusOn(target: Vector3, distance: number, height = 0.45): void {
    const dir = new Vector3(0.55, -0.75, height).normalize();
    this.camera.position.copy(target.clone().addScaledVector(dir, distance));
    this.controls.target.copy(target);
    this.controls.update();
  }

  /**
   * 沿机器光轴俯视（Top View）。
   *
   * 与 focusOn 的区别是**视线方向固定为 −Z**（不再用固定斜角）：
   * Novanta 模式的 Dual-Plate Top View 要让人正对光束横截面看，
   * 才能看清"两块板只做正交倾斜、但合成的位移向量在绕光轴旋转"。
   *
   * @param offset 相对正俯视的小偏移量（0 = 严格俯视）。
   *        留一点偏移是为了不丢深度感，但保持接近正交投影的观感。
   */
  lookAlongOpticalAxis(target: Vector3, distance: number, offset = 0): void {
    const dir = new Vector3(offset, -offset, 1).normalize();
    this.camera.position.copy(target.clone().addScaledVector(dir, distance));
    this.controls.target.copy(target);
    this.controls.update();
  }

  resetView(): void {
    // 距离 1150：整机（约 700 mm 高）能填满视口大部分，又不会切到上下两端
    this.focusOn(new Vector3(-8, -6, 300), 1150, 0.42);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    let reportedError = false;
    const loop = (time: number) => {
      if (!this.running) return;
      const elapsed = (time - this.lastTime) / 1000;
      this.lastTime = time;
      this.frame += 1;
      // 单帧异常不允许中断渲染循环（否则画面会整块停住）
      try {
        this.onFrame?.(elapsed);
      } catch (error) {
        if (!reportedError) {
          reportedError = true;
          console.error('[precSYS] 每帧更新出错（已跳过该帧并继续渲染）：', error);
        }
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}

/** 便于构建细小零件（销、管、箭头杆等）。 */
export function makeRod(
  material: MeshStandardMaterial | MeshPhysicalMaterial,
  radius: number,
  length: number,
): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 12), material);
  mesh.castShadow = true;
  return mesh;
}
