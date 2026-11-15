import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { MoonCameraController } from './components/moonCameraController';
import { simClock } from './lib/simClock';
import { subSolarPoint } from './lib/ephemeris';

// --- Renderer ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
document.getElementById('three-canvas')!.appendChild(renderer.domElement);

// --- Scene / Camera -----------------------------------------------------------
const scene = new THREE.Scene();
let moonGroup: THREE.Group | null = null;

// --- Sky sphere ---------------------------------------------------------------
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: null }, uLoaded: { value: false } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform bool uLoaded; varying vec2 vUv;
    void main(){
      if(!uLoaded){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
      vec3 c = texture2D(uMap,vUv).rgb;
      vec3 s = 1.0-(1.0-c)*(1.0-c*0.5);
      c = mix(c,s,0.4) * 0.15;
      float lum = dot(c,vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(lum),c,0.9);
      gl_FragColor = vec4(clamp(c,0.0,1.0),1.0);
    }`,
  side: THREE.BackSide, depthWrite: false,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(5000,64,32), skyMat));
new THREE.TextureLoader().load('/starmap-bg.jpg',(tex)=>{
  tex.colorSpace=THREE.SRGBColorSpace;
  skyMat.uniforms.uMap.value=tex;
  skyMat.uniforms.uLoaded.value=true;
});

// --- Lighting � 21hrs.space style: harsh single sun, no fill -----------------
// Real lunar lighting: Sun is the only light source in space.
// No atmosphere = pure directional light, ink-black shadows.
const sun = new THREE.DirectionalLight(0xFFFAF0, 5.5); // slightly warm, like solar spectrum
sun.position.set(8, 3, 6); // from upper-right, creates visible terminator line
sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);
sun.shadow.camera.near=0.1; sun.shadow.camera.far=40;
sun.shadow.camera.left=sun.shadow.camera.bottom=-3;
sun.shadow.camera.right=sun.shadow.camera.top=3;
sun.shadow.bias=-0.0003;
scene.add(sun);
// Earthshine: faint cool fill from Earth's reflected light on the dark side
// Very subtle � 21hrs.space has near-black shadows
scene.add(new THREE.AmbientLight(0x050508, 0.04)); // almost zero ambient

// The Sun now follows the shared simulation clock: the light points at the real sub-solar point
// (selenographic lat/lon) for the simulated time, in the same lat/lon -> xyz frame used by zoomToSite.
function sunDirection(ms: number) {
  const { lat, lon } = subSolarPoint(ms);
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  sun.position.set(10 * Math.cos(phi) * Math.sin(lam), 10 * Math.sin(phi), 10 * Math.cos(phi) * Math.cos(lam));
}
sunDirection(simClock.get().ms);
simClock.subscribe(() => sunDirection(simClock.get().ms));

// Kept so the camera controller's callback signature still works; lighting no longer depends on the site.
function updateSunForSite(_siteName: string) { /* light follows simClock */ }

const moonCamera = new MoonCameraController(
  renderer.domElement,
  () => moonGroup,
  updateSunForSite,
);
const camera = moonCamera.camera;

(window as any).updateSunForSite = updateSunForSite;

// --- Star helpers -------------------------------------------------------------
function spherePt(pos:Float32Array,i:number,r:number){
  const t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);
  pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.sin(p)*Math.sin(t); pos[i*3+2]=r*Math.cos(p);
}

// --- Layer 1: 30k micro stars (static 1px) -----------------------------------
(()=>{
  const n=30000,pos=new Float32Array(n*3),col=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    spherePt(pos,i,4900);
    const r=Math.random(),a=0.35+Math.random()*0.55;
    let cr,cg,cb;
    if(r<0.65){cr=1.0;cg=0.97;cb=0.88;}
    else if(r<0.80){cr=0.75;cg=0.88;cb=1.0;}
    else if(r<0.90){cr=1.0;cg=0.75;cb=0.45;}
    else if(r<0.97){cr=1.0;cg=0.55;cb=0.30;}
    else{cr=0.55;cg=0.70;cb=1.0;}
    col[i*3]=cr*a;col[i*3+1]=cg*a;col[i*3+2]=cb*a;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('starColor',new THREE.BufferAttribute(col,3));
  scene.add(new THREE.Points(geo,new THREE.ShaderMaterial({
    vertexShader:`attribute vec3 starColor;varying vec3 vC;void main(){vC=starColor;gl_PointSize=1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;void main(){gl_FragColor=vec4(vC,1.0);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  })));
})();

// --- Layer 2: 12k small twinkling stars --------------------------------------
const layer2=(()=>{
  const n=12000,pos=new Float32Array(n*3),col=new Float32Array(n*3),
        sz=new Float32Array(n),ph=new Float32Array(n),fq=new Float32Array(n);
  for(let i=0;i<n;i++){
    spherePt(pos,i,4900);
    const r=Math.random();
    if(r<0.65){col[i*3]=1.0;col[i*3+1]=0.97;col[i*3+2]=0.88;}
    else if(r<0.80){col[i*3]=0.75;col[i*3+1]=0.88;col[i*3+2]=1.0;}
    else if(r<0.90){col[i*3]=1.0;col[i*3+1]=0.75;col[i*3+2]=0.45;}
    else if(r<0.97){col[i*3]=1.0;col[i*3+1]=0.55;col[i*3+2]=0.30;}
    else{col[i*3]=0.55;col[i*3+1]=0.70;col[i*3+2]=1.0;}
    sz[i]=1.2+Math.random()*2.2; ph[i]=Math.random()*Math.PI*2; fq[i]=0.6+Math.random()*1.8;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('starColor',new THREE.BufferAttribute(col,3));
  geo.setAttribute('size',new THREE.BufferAttribute(sz,1));
  geo.setAttribute('phase',new THREE.BufferAttribute(ph,1));
  geo.setAttribute('freq',new THREE.BufferAttribute(fq,1));
  const mat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}},
    vertexShader:`attribute float size,phase,freq;attribute vec3 starColor;uniform float uTime;varying vec3 vC;void main(){vC=starColor;gl_PointSize=size*(1.0+0.12*sin(uTime*freq+phase));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.1,d);if(a<0.01)discard;gl_FragColor=vec4(vC,a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Layer 3: 2k medium stars with halo --------------------------------------
const layer3=(()=>{
  const n=2000,pos=new Float32Array(n*3),col=new Float32Array(n*3),
        sz=new Float32Array(n),ph=new Float32Array(n);
  for(let i=0;i<n;i++){
    spherePt(pos,i,4900);
    const r=Math.random();
    if(r<0.40){col[i*3]=0.75;col[i*3+1]=0.88;col[i*3+2]=1.0;}
    else if(r<0.75){col[i*3]=1.0;col[i*3+1]=0.97;col[i*3+2]=0.88;}
    else if(r<0.90){col[i*3]=1.0;col[i*3+1]=0.75;col[i*3+2]=0.45;}
    else{col[i*3]=1.0;col[i*3+1]=0.55;col[i*3+2]=0.30;}
    sz[i]=3.0+Math.random()*6.0; ph[i]=Math.random()*Math.PI*2;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('starColor',new THREE.BufferAttribute(col,3));
  geo.setAttribute('size',new THREE.BufferAttribute(sz,1));
  geo.setAttribute('phase',new THREE.BufferAttribute(ph,1));
  const mat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}},
    vertexShader:`attribute float size,phase;attribute vec3 starColor;uniform float uTime;varying vec3 vC;varying float vP;void main(){vC=starColor;vP=phase;float sh=1.0+0.18*sin(uTime*(1.1+phase*1.3)+phase)+0.09*sin(uTime*(2.7+phase*0.9)+phase*2.0);gl_PointSize=size*sh;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;varying float vP;uniform float uTime;void main(){float d=length(gl_PointCoord-0.5);float core=smoothstep(0.18,0.0,d);float halo=smoothstep(0.45,0.0,d)*0.25;float a=clamp((core+halo)*(1.0+0.15*sin(uTime*(1.9+vP*1.4)+vP*3.14)),0.0,1.0);if(a<0.01)discard;gl_FragColor=vec4(vC,a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Layer 4: 400 bright stars with diffraction spikes -----------------------
const layer4=(()=>{
  const n=400,pos=new Float32Array(n*3),sz=new Float32Array(n),
        ph=new Float32Array(n),col=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    spherePt(pos,i,4900);
    sz[i]=5+Math.random()*12; ph[i]=Math.random()*Math.PI*2;
    const r=Math.random();
    if(r<0.35){col[i*3]=0.72;col[i*3+1]=0.85;col[i*3+2]=1.0;}
    else if(r<0.65){col[i*3]=1.0;col[i*3+1]=1.0;col[i*3+2]=0.95;}
    else if(r<0.85){col[i*3]=1.0;col[i*3+1]=0.94;col[i*3+2]=0.76;}
    else{col[i*3]=1.0;col[i*3+1]=0.82;col[i*3+2]=0.50;}
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('size',new THREE.BufferAttribute(sz,1));
  geo.setAttribute('phase',new THREE.BufferAttribute(ph,1));
  geo.setAttribute('starColor',new THREE.BufferAttribute(col,3));
  const mat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}},
    vertexShader:`attribute float size,phase;attribute vec3 starColor;varying float vP;varying vec3 vC;uniform float uTime;void main(){vP=phase;vC=starColor;float f1=1.3+phase*0.5,f2=3.1+phase*1.7;gl_PointSize=size*(1.0+0.28*sin(uTime*f1+phase)+0.12*sin(uTime*f2+phase*2.0));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying float vP;varying vec3 vC;uniform float uTime;void main(){vec2 uv=gl_PointCoord-0.5;float d=length(uv);float core=smoothstep(0.12,0.0,d);float halo=smoothstep(0.42,0.0,d)*0.15;float s1=smoothstep(0.035,0.0,abs(uv.x))*smoothstep(0.5,0.0,abs(uv.y));float s2=smoothstep(0.035,0.0,abs(uv.y))*smoothstep(0.5,0.0,abs(uv.x));vec2 r45=vec2(uv.x+uv.y,uv.x-uv.y)*0.7071;float s3=smoothstep(0.025,0.0,abs(r45.x))*smoothstep(0.5,0.0,abs(r45.y))*0.35;float s4=smoothstep(0.025,0.0,abs(r45.y))*smoothstep(0.5,0.0,abs(r45.x))*0.35;float sp=clamp(s1+s2+s3+s4,0.0,1.0);float sh=1.0+0.30*sin(uTime*(2.1+vP*2.3)+vP*6.28)+0.15*sin(uTime*(4.7+vP*1.1)+vP*3.14);float a=clamp((core+halo+sp*0.65)*sh,0.0,1.0);if(a<0.01)discard;float cs=0.5+0.5*sin(uTime*(1.8+vP)+vP*2.0);vec3 sc=mix(vC,mix(vC,vec3(0.9,0.95,1.0),0.3),cs*0.4);gl_FragColor=vec4(mix(mix(sc,vec3(0.8,0.9,1.0),0.35),sc,core/max(core+sp*0.5,0.001)),a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Moon GLB ----------------------------------------------------------------
const moonTexture = new THREE.TextureLoader().load('/moon-texture.jpg');
moonTexture.colorSpace = THREE.SRGBColorSpace;

function attachMoonMesh(moon: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(moon);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 2.0 / Math.max(size.x, size.y, size.z);
  moon.scale.setScalar(scale);
  moon.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

  moon.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = child.receiveShadow = true;
    const m = child.material as THREE.MeshStandardMaterial;
    if (m && 'roughness' in m) {
      m.roughness = 0.90;
      m.metalness = 0.0;
      m.envMapIntensity = 0.0;
      if (m.normalMap) m.normalScale.set(3.5, 3.5);
      if (m.bumpMap) m.bumpScale = 0.12;
      m.needsUpdate = true;
    }
  });

  scene.add(moon);
  moonGroup = moon as THREE.Group;
}

function buildMoonFallback() {
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 128),
    new THREE.MeshStandardMaterial({
      map: moonTexture,
      roughness: 0.9,
      metalness: 0,
    })
  );
  moon.rotation.y = Math.PI * 0.35;
  attachMoonMesh(moon);
  console.log('Moon fallback loaded');
}

const MOON_MODEL_URL = '/Moon_NASA_LRO_8k_Topo.glb';

fetch(MOON_MODEL_URL, { method: 'HEAD' })
  .then(res => {
    if (!res.ok) throw new Error(`Missing NASA Moon model (${res.status})`);
    return new Promise<THREE.Group>((resolve, reject) => {
      new GLTFLoader().load(
        MOON_MODEL_URL,
        (gltf) => resolve(gltf.scene as THREE.Group),
        ({ loaded, total }) => console.log(`Moon: ${Math.round((loaded / total) * 100)}%`),
        (err) => reject(err)
      );
    });
  })
  .then((moon) => {
    attachMoonMesh(moon);
    console.log('? Moon loaded');
  })
  .catch((err) => {
    console.warn('Moon asset unavailable; using fallback.', err);
    buildMoonFallback();
  });

// --- Post-processing ----------------------------------------------------------
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.7,1.2,0.60));
composer.addPass(new ShaderPass({
  uniforms:{tDiffuse:{value:null}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec3 x=texture2D(tDiffuse,vUv).rgb;x=(x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14);x=clamp(x,0.0,1.0);vec2 uv=vUv-0.5;x*=1.0-dot(uv,uv)*0.9;gl_FragColor=vec4(x,1.0);}`,
}));

// --- Resize -------------------------------------------------------------------
window.addEventListener('resize',()=>{
  moonCamera.resize();
  renderer.setSize(innerWidth,innerHeight);
  composer.setSize(innerWidth,innerHeight);
});

// --- Animate -----------------------------------------------------------------
let t=0,last=performance.now();
function animate(){
  requestAnimationFrame(animate);
  const now=performance.now(); t+=(now-last)/1000; last=now;
  moonCamera.update();
  (layer2.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  (layer3.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  (layer4.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  composer.render();
}
animate();
