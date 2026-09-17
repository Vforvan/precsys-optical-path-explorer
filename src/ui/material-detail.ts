import { AmbientLight, Color, DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera,
  Scene, SphereGeometry, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WorkpieceView } from '../scene/cumulative-workpiece';
import type { AppSnapshot } from '../app-state';

export class MaterialDetail {
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, 1, 0.01, 100);
  private renderer = new WebGLRenderer({ antialias: true });
  private controls: OrbitControls;
  private dot = new Mesh(new SphereGeometry(0.045, 12, 8), new MeshBasicMaterial({ color: '#ff9f55' }));
  private stats: HTMLElement;
  private elapsed = 0;

  constructor(private workpiece: WorkpieceView) {
    const root = document.getElementById('material-detail')!;
    root.innerHTML = `<div class="material-title"><strong>材料去除 · 三维局部</strong><button type="button" class="ctl" aria-pressed="false">剖切观察</button></div>
      <div class="material-canvas"></div><div class="material-stats" aria-live="polite"></div>
      <div class="material-note">结果持续累积，仅切换加工方式时换新试样。几何去除模型；有效光斑半径 80 μm，体素约 33 × 33 × 30 μm，曝光参数未做材料标定。</div>`;
    const container = root.querySelector<HTMLElement>('.material-canvas')!;
    const button = root.querySelector<HTMLButtonElement>('button')!;
    button.onclick = () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      workpiece.setSection(enabled);
    };
    this.stats = root.querySelector('.material-stats')!;
    container.appendChild(this.renderer.domElement);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new Color('#101e2a');
    this.scene.add(workpiece.detail, this.dot, new AmbientLight('#c8dff2', 1.6));
    const light = new DirectionalLight('#ffffff', 2.5);
    light.position.set(2, -3, 6);
    this.scene.add(light);
    this.camera.up.set(0,0,1);
    this.camera.position.set(3.4, -4.3, 5.3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0,0,-0.4);
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 12;
    this.controls.enableDamping = true;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
  }

  update(snapshot: AppSnapshot, seconds: number): void {
    this.elapsed += seconds;
    if (this.elapsed > 0.22) {
      this.workpiece.refreshMesh();
      const stats = this.workpiece.material.stats();
      this.stats.textContent = `已去除 ${stats.volumeMm3.toFixed(4)} mm³ · 最大深度 ${stats.maxDepthMm.toFixed(2)} mm`;
      this.elapsed = 0;
    }
    this.dot.position.copy(snapshot.trace.focusPoint);
    this.dot.visible = snapshot.mode === 'process' && snapshot.playing;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
