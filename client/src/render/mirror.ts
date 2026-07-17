/* The mirror's glass: a single standing figure under a bare warm bulb,
   auto-rotating (drag to spin it yourself). Deliberately tiny — its whole
   job is showing exactly what makeFigure will build from the picked
   Appearance, with the same lights-and-shadows mood as the rooms. The
   renderer only exists while the mirror screen is up; stop() parks the
   frame loop but keeps the GL context for the next look in the glass. */
import * as THREE from "three";
import type { Appearance } from "@shared/appearance";
import { lookOf, makeFigure, poseArm } from "./figure";

export class MirrorView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private figure: THREE.Group | null = null;
  /* face the glass first — the slow turn shows the back soon enough */
  private yaw = 0;
  private dragging = false;
  private raf = 0;
  private lastT = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0d0a);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    this.camera.position.set(0, 1.05, 2.55);
    this.camera.lookAt(0, 0.82, 0);

    this.scene.add(new THREE.AmbientLight(0x342b1e, 1.5));
    const bulb = new THREE.PointLight(0xffd9a0, 9, 10, 1.6);
    bulb.position.set(0.9, 2.4, 1.3);
    bulb.castShadow = true;
    this.scene.add(bulb);
    // a whisper of the bar's red neon from behind, so the silhouette pops
    const neon = new THREE.PointLight(0xe0522b, 2.5, 6, 1.8);
    neon.position.set(-1.5, 1.3, -1.2);
    this.scene.add(neon);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 40),
      new THREE.MeshStandardMaterial({ color: 0x141a15, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // drag to spin — pause the idle turn while the pointer holds the figure
    container.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener("pointermove", (e) => {
      if (this.dragging) this.yaw += e.movementX * 0.012;
    });
    const drop = () => (this.dragging = false);
    container.addEventListener("pointerup", drop);
    container.addEventListener("pointercancel", drop);
  }

  /* rebuild the figure for a new look — a dozen primitives, cheap enough
     to throw away wholesale rather than repaint */
  setLook(a: Appearance): void {
    if (this.figure) {
      this.scene.remove(this.figure);
      const mats = new Set<THREE.Material>();
      this.figure.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      });
      for (const m of mats) m.dispose();
    }
    const { group, armR, armL } = makeFigure(lookOf(a), { standing: true });
    // arms hang at the sides — the rest pose reaches for a felt that isn't here
    poseArm(armR, new THREE.Vector3(0.21, 0.58, 0.06));
    poseArm(armL, new THREE.Vector3(-0.21, 0.58, 0.06));
    group.rotation.y = this.yaw;
    this.figure = group;
    this.scene.add(group);
  }

  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const frame = (t: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      this.resize();
      if (!this.dragging) this.yaw += dt * 0.35;
      if (this.figure) this.figure.rotation.y = this.yaw;
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /* sized off the container every frame — cheap check, and it saves wiring
     a ResizeObserver for a screen that's rarely open */
  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (w > 0 && h > 0 && (size.x !== w || size.y !== h)) {
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = "100%";
      this.renderer.domElement.style.height = "100%";
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}
