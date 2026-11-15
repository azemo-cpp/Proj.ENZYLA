import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Landmark {
  name: string;
  lat: number;
  lon: number;
  type: string;
  desc: string;
}

const LANDMARKS: Landmark[] = [
  { name: 'Apollo 11', lat: 0.67, lon: 23.47, type: 'Landing Site', desc: 'First crewed lunar landing, July 20 1969, Sea of Tranquility.' },
  { name: 'Apollo 12', lat: -3.01, lon: -23.42, type: 'Landing Site', desc: 'Second crewed lunar landing, Nov 1969, Ocean of Storms.' },
  { name: 'Apollo 14', lat: -3.65, lon: -17.47, type: 'Landing Site', desc: 'Fra Mauro Highlands, Feb 1971. Alan Shepard and Edgar Mitchell.' },
  { name: 'Apollo 15', lat: 26.13, lon: 3.63, type: 'Landing Site', desc: 'Hadley-Apennine, Jul 1971. First mission to use the lunar rover.' },
  { name: 'Apollo 16', lat: -8.97, lon: 15.50, type: 'Landing Site', desc: 'Descartes Highlands, Apr 1972. John Young and Charles Duke.' },
  { name: 'Apollo 17', lat: 20.19, lon: 30.77, type: 'Landing Site', desc: 'Taurus-Littrow valley, Dec 1972. Last crewed Moon landing to date.' },
  { name: 'Tycho', lat: -43.31, lon: -11.22, type: 'Crater', desc: 'Prominent ray crater 85 km wide, ~108 million years old.' },
  { name: 'Copernicus', lat: 9.62, lon: -20.08, type: 'Crater', desc: '93 km diameter impact crater, formed ~800 million years ago.' },
  { name: 'Aristarchus', lat: 23.73, lon: -47.40, type: 'Crater', desc: 'Brightest crater on the near side, highly reflective walls.' },
  { name: 'Plato', lat: 51.62, lon: -9.38, type: 'Crater', desc: '100 km walled plain with flat dark lava-flooded floor.' },
  { name: 'Clavius', lat: -58.40, lon: -14.36, type: 'Crater', desc: 'One of the largest craters, 225 km across, southern highlands.' },
  { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, type: 'Mare', desc: 'Sea of Tranquility. Dark basaltic plain, Apollo 11 landing site.' },
  { name: 'Mare Imbrium', lat: 32.8, lon: -15.6, type: 'Mare', desc: 'Sea of Showers. One of the largest impact basins, ~3.9 Ga.' },
  { name: 'Oceanus Procellarum', lat: 2.5, lon: -46.0, type: 'Mare', desc: 'Ocean of Storms. Largest lunar mare, ~2.5 million km².' },
  { name: 'Mare Serenitatis', lat: 28.0, lon: 17.5, type: 'Mare', desc: 'Sea of Serenity. Circular lava-flooded basin, near-side.' },
  { name: 'Mare Crisium', lat: 17.0, lon: 59.1, type: 'Mare', desc: 'Sea of Crises. Isolated circular basin near the eastern limb.' },
  { name: 'Montes Apenninus', lat: 18.9, lon: 3.7, type: 'Mountains', desc: '600 km range forming the southeastern border of Mare Imbrium.' },
  { name: 'Montes Alps', lat: 48.5, lon: 0.5, type: 'Mountains', desc: 'Lunar Alps bordering Mare Imbrium to the north.' },
];

const GLOBAL_MIN_DISTANCE = 1.35;
const SURFACE_CLEARANCE = 0.02;
const ZOOM_IN_DISTANCE = 1.45;
const ZOOM_ORBIT_TANGENT = 0.18;
const ZOOM_OUT_POSITION = new THREE.Vector3(0, 0.5, 5);
const SITE_EXIT_DISTANCE = 1.0;

export class MoonCameraController {
  readonly camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 10000);

  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private isZoomed = false;
  private isAnimating = false;
  private currentAnimFrame: number | null = null;
  private activeSurfaceNormal: THREE.Vector3 | null = null;
  private activeSurfaceRadius = 1;

  constructor(
    private readonly element: HTMLElement,
    private readonly getMoon: () => THREE.Object3D | null,
    private readonly updateSunForSite: (siteName: string) => void,
  ) {
    this.camera.position.set(0, 0.5, 5);
    this.controls = this.createOverviewControls();

    this.element.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('dblclick', this.handleDoubleClick);
    (window as any).zoomToSite = (lat: number, lon: number, name: string) => this.zoomToSite(lat, lon, name);
    (window as any).zoomOut = () => this.zoomOut();
  }

  update() {
    if (this.isAnimating) return;
    this.controls.update();
    this.constrainCameraAboveSelectedSurface();
  }

  resize(width = innerWidth, height = innerHeight) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.currentAnimFrame !== null) cancelAnimationFrame(this.currentAnimFrame);
    this.element.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('dblclick', this.handleDoubleClick);
    this.controls.dispose();
  }

  zoomToSite(lat: number, lon: number, name: string) {
    if (!this.getMoon()) return;
    if (this.isZoomed) window.dispatchEvent(new CustomEvent('moonexit'));

    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const direction = new THREE.Vector3(
      Math.cos(latR) * Math.sin(lonR),
      Math.sin(latR),
      Math.cos(latR) * Math.cos(lonR),
    );
    const landmark: Landmark = { name, type: 'Landing Site', desc: '', lat, lon };
    this.zoomTo(direction, landmark, this.surfacePointForDirection(direction));
  }

  zoomOut() {
    if (!this.isZoomed) return;
    if (this.currentAnimFrame !== null) {
      cancelAnimationFrame(this.currentAnimFrame);
      this.currentAnimFrame = null;
    }

    this.isAnimating = true;
    this.isZoomed = false;
    this.activeSurfaceNormal = null;
    this.controls.autoRotate = false;
    this.controls.enabled = false;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 9999;
    window.dispatchEvent(new CustomEvent('moonexit'));

    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startUp = this.camera.up.clone();
    const origin = new THREE.Vector3(0, 0, 0);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const startDirection = startPosition.clone().normalize();
    const endDirection = ZOOM_OUT_POSITION.clone().normalize();
    const rotationAxis = new THREE.Vector3().crossVectors(startDirection, endDirection);
    if (rotationAxis.lengthSq() < 1e-8) {
      rotationAxis.crossVectors(
        startDirection,
        Math.abs(startDirection.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : worldUp,
      );
    }
    rotationAxis.normalize();

    const rotationAngle = startDirection.angleTo(endDirection);
    const startRadius = Math.max(startPosition.length(), GLOBAL_MIN_DISTANCE);
    startPosition.copy(startDirection).multiplyScalar(startRadius);
    const endRadius = ZOOM_OUT_POSITION.length();
    const duration = Math.min(Math.max(startPosition.distanceTo(ZOOM_OUT_POSITION) * 250, 900), 1500);
    const startTime = performance.now();

    const tick = () => {
      const progress = Math.min((performance.now() - startTime) / duration, 1);
      const eased = progress < 0.5
        ? 16 * progress ** 5
        : 1 - Math.pow(-2 * progress + 2, 5) / 2;
      const direction = startDirection.clone().applyAxisAngle(rotationAxis, rotationAngle * eased);
      const radius = THREE.MathUtils.lerp(startRadius, endRadius, eased);
      this.camera.position.copy(direction.multiplyScalar(radius));
      const lookTarget = startTarget.clone().lerp(origin, eased);
      this.camera.up.copy(startUp).lerp(worldUp, eased);
      if (this.camera.up.lengthSq() < 1e-8) this.camera.up.copy(worldUp);
      this.camera.up.normalize();
      this.camera.lookAt(lookTarget);

      if (progress < 1) {
        this.currentAnimFrame = requestAnimationFrame(tick);
        return;
      }

      this.currentAnimFrame = null;
      this.camera.position.copy(ZOOM_OUT_POSITION);
      this.camera.up.copy(worldUp);
      this.camera.lookAt(origin);
      this.isAnimating = false;
      this.controls.dispose();
      this.controls = this.createOverviewControls();
      this.controls.update();
    };

    this.currentAnimFrame = requestAnimationFrame(tick);
  }

  private configureControls(controls: OrbitControls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.enablePan = false;
  }

  private createOverviewControls() {
    const controls = new OrbitControls(this.camera, this.element);
    this.configureControls(controls);
    controls.minDistance = GLOBAL_MIN_DISTANCE;
    controls.maxDistance = 30;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.target.set(0, 0, 0);
    return controls;
  }

  private maxSafeSurfacePolarAngle(distance: number, radius: number) {
    const denominator = 2 * radius * distance;
    if (denominator <= 1e-8) return 0.05;
    const minCos = (
      (radius + SURFACE_CLEARANCE) ** 2 - radius ** 2 - distance ** 2
    ) / denominator;
    return Math.min(
      Math.PI / 2 - 0.02,
      Math.acos(THREE.MathUtils.clamp(minCos, -1, 1)),
    );
  }

  private constrainCameraAboveSelectedSurface() {
    if (!this.activeSurfaceNormal) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length();
    if (distance <= 1e-8) return;

    const maxPolar = this.maxSafeSurfacePolarAngle(distance, this.activeSurfaceRadius);
    this.controls.maxPolarAngle = maxPolar;
    const direction = offset.multiplyScalar(1 / distance);
    const polar = Math.acos(THREE.MathUtils.clamp(direction.dot(this.activeSurfaceNormal), -1, 1));
    if (polar <= maxPolar) return;

    const tangent = direction.addScaledVector(this.activeSurfaceNormal, -Math.cos(polar));
    if (tangent.lengthSq() <= 1e-8) {
      tangent.crossVectors(
        this.activeSurfaceNormal,
        Math.abs(this.activeSurfaceNormal.y) > 0.95
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0),
      );
    }
    tangent.normalize();
    const constrainedOffset = this.activeSurfaceNormal.clone()
      .multiplyScalar(Math.cos(maxPolar))
      .addScaledVector(tangent, Math.sin(maxPolar))
      .multiplyScalar(distance);
    this.camera.position.copy(this.controls.target).add(constrainedOffset);
    this.camera.lookAt(this.controls.target);
  }

  private zoomTo(
    direction: THREE.Vector3,
    landmark: Landmark | null,
    selectedPoint?: THREE.Vector3,
  ) {
    if (this.currentAnimFrame !== null) {
      cancelAnimationFrame(this.currentAnimFrame);
      this.currentAnimFrame = null;
    }

    this.isAnimating = true;
    this.isZoomed = true;
    this.controls.enabled = false;
    this.controls.autoRotate = false;

    const startPosition = this.camera.position.clone();
    const sitePoint = selectedPoint?.clone() ?? direction.clone().normalize();
    const siteNormal = sitePoint.clone().normalize();
    const tangentReference = Math.abs(siteNormal.y) > 0.95
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(tangentReference, siteNormal).normalize();
    const radialDistance = Math.sqrt(ZOOM_IN_DISTANCE ** 2 - ZOOM_ORBIT_TANGENT ** 2);
    const height = Math.max(0.05, radialDistance - sitePoint.length());
    const targetPosition = sitePoint.clone()
      .addScaledVector(siteNormal, height)
      .addScaledVector(tangent, ZOOM_ORBIT_TANGENT);
    const startTarget = this.controls.target.clone();
    const startUp = this.camera.up.clone();
    const distance = startPosition.distanceTo(targetPosition);
    const duration = Math.min(Math.max(distance * 300, 800), 1600);
    const startTime = performance.now();

    const tick = () => {
      const progress = Math.min((performance.now() - startTime) / duration, 1);
      const eased = progress < 0.5
        ? 16 * progress ** 5
        : 1 - Math.pow(-2 * progress + 2, 5) / 2;
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);
      const lookTarget = startTarget.clone().lerp(sitePoint, eased);
      this.camera.up.copy(startUp).lerp(siteNormal, eased);
      if (this.camera.up.lengthSq() < 1e-8) this.camera.up.copy(siteNormal);
      this.camera.up.normalize();
      this.camera.lookAt(lookTarget);

      if (progress < 1) {
        this.currentAnimFrame = requestAnimationFrame(tick);
        return;
      }

      this.currentAnimFrame = null;
      this.camera.up.copy(siteNormal);
      this.controls.dispose();
      this.controls = new OrbitControls(this.camera, this.element);
      this.configureControls(this.controls);
      this.controls.target.copy(sitePoint);
      this.controls.minDistance = 0.05;
      this.controls.maxDistance = 1.2;
      this.activeSurfaceNormal = siteNormal.clone();
      this.activeSurfaceRadius = sitePoint.length();
      const currentPolar = Math.acos(THREE.MathUtils.clamp(
        this.camera.position.clone().sub(sitePoint).normalize().dot(siteNormal),
        -1,
        1,
      ));
      this.controls.minPolarAngle = Math.max(0.1, currentPolar - Math.PI / 6);
      this.controls.maxPolarAngle = this.maxSafeSurfacePolarAngle(
        this.camera.position.distanceTo(sitePoint),
        this.activeSurfaceRadius,
      );
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.autoRotate = false;
      this.controls.autoRotateSpeed = 0.3;
      this.isAnimating = false;
      this.controls.enabled = true;
      this.controls.update();
      this.constrainCameraAboveSelectedSurface();
      window.dispatchEvent(new CustomEvent('moonclick', {
        detail: {
          name: landmark?.name || 'Lunar Surface',
          lat: landmark?.lat ?? 0,
          lon: landmark?.lon ?? 0,
          type: landmark?.type || 'Surface',
        },
      }));
      if (landmark?.name) this.updateSunForSite(landmark.name);
    };

    this.currentAnimFrame = requestAnimationFrame(tick);
  }

  private surfacePointForDirection(direction: THREE.Vector3) {
    const normal = direction.clone().normalize();
    const moon = this.getMoon();
    if (!moon) return normal;
    const meshes: THREE.Object3D[] = [];
    moon.traverse(child => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    this.raycaster.set(normal.clone().multiplyScalar(3), normal.clone().negate());
    return this.raycaster.intersectObjects(meshes, true)[0]?.point ?? normal;
  }

  private handleWheel = (event: WheelEvent) => {
    if (!this.isZoomed || this.isAnimating || event.deltaY <= 0) return;
    requestAnimationFrame(() => {
      if (
        this.isZoomed
        && !this.isAnimating
        && this.camera.position.distanceTo(this.controls.target) >= SITE_EXIT_DISTANCE
      ) {
        this.zoomOut();
      }
    });
  };

  private handlePointerUp = (event: PointerEvent) => {
    const moon = this.getMoon();
    if (event.button !== 0 || !moon || this.isAnimating || event.target !== this.element) return;

    const pointer = new THREE.Vector2(
      (event.clientX / innerWidth) * 2 - 1,
      -(event.clientY / innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const meshes: THREE.Mesh[] = [];
    moon.traverse(child => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    const hit = this.raycaster.intersectObjects(meshes, true)[0];
    if (!hit) return;

    const hitPoint = hit.point.clone();
    const hitDirection = hitPoint.clone().normalize();
    const cosineEightDegrees = Math.cos(8 * Math.PI / 180);
    let bestLandmark: Landmark | null = null;
    let bestDot = cosineEightDegrees;
    for (const landmark of LANDMARKS) {
      const latitude = landmark.lat * Math.PI / 180;
      const longitude = landmark.lon * Math.PI / 180;
      const landmarkDirection = new THREE.Vector3(
        Math.cos(latitude) * Math.sin(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.cos(longitude),
      );
      const dot = hitDirection.dot(landmarkDirection);
      if (dot > bestDot) {
        bestDot = dot;
        bestLandmark = landmark;
      }
    }

    if (this.isZoomed) {
      window.dispatchEvent(new CustomEvent('moonexit'));
      this.isZoomed = false;
    }
    this.zoomTo(hitDirection, bestLandmark, hitPoint);
  };

  private handleDoubleClick = () => {
    if (this.isZoomed && !this.isAnimating) this.zoomOut();
  };
}
