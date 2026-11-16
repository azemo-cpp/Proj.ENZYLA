import * as THREE from 'three';
import { fromArrayBuffer } from 'geotiff';
import ldem16Url from '../data/ldem_16.tif?url';
import earthTextureUrl from '../data/earth.200406.3x5400x2700?url';
import { APOLLO_SITES } from './data/apolloSites';
import { skyAt, type SiteCoords } from './lib/ephemeris';
import { simClock } from './lib/simClock';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { MoonCameraController } from './components/moonCameraController';

// --- Renderer ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled   = false;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
document.getElementById('three-canvas')!.appendChild(renderer.domElement);

// --- Scene / Camera -----------------------------------------------------------
const scene = new THREE.Scene();
let moonGroup: THREE.Group | null = null;
const moonCamera = new MoonCameraController(
  renderer.domElement,
  () => moonGroup,
  (siteName, lat, lon) => updateSunForSite(siteName, lat, lon),
);
const camera = moonCamera.camera;

interface MoonClrShadeMapDetail {
  image:CanvasImageSource;
  west:number;
  south:number;
  east:number;
  north:number;
  lat:number;
  lon:number;
  localTileCount:number;
  nasaTileCount:number;
  totalTiles:number;
}

function clearLocalClrShadeTexture(){
  localOverlayRequestId++;
  const previous=localClrShadeTexture;
  localClrShadeTexture=null;
  localClrShadeMapUniform.value=globalColorPlaceholder;
  localClrShadeMixUniform.value=0;
  if(previous?.userData.clrShadeAtlas===true)previous.dispose();
  window.dispatchEvent(new CustomEvent<MoonClrShadeMapDetail|null>('moonclrshademap',{detail:null}));
}

function installLocalClrShadeTexture(
  texture:THREE.Texture,
  west:number,
  south:number,
  east:number,
  north:number,
  lat:number,
  lon:number,
  tileCounts?:{local:number;nasa:number;total:number},
  overlaySource:'clrshade'|'wac'='clrshade',
){
  const previous=localClrShadeTexture;
  localClrShadeTexture=texture;
  localClrShadeMapUniform.value=texture;
  localClrShadeBoundsUniform.value.set(west,south,east,north);
  const overlayEnabled=overlaySource==='clrshade'?localClrShadeEnabled:!localClrShadeEnabled;
  const overlayMix=overlayEnabled?1:0;
  localClrShadeMixUniform.value=overlayMix;
  localClrShadeColorMixUniform.value=overlayMix;
  const source=texture.userData.clrShadeSource as 'local'|'nasa'|undefined;
  const counts=tileCounts??{
    local:source==='local'?1:0,
    nasa:source==='nasa'?1:0,
    total:1,
  };
  window.dispatchEvent(new CustomEvent<MoonClrShadeMapDetail>('moonclrshademap',{
    detail:{
      image:texture.image as CanvasImageSource,
      west,south,east,north,lat,lon,
      localTileCount:counts.local,
      nasaTileCount:counts.nasa,
      totalTiles:counts.total,
    },
  }));
  if(previous!==texture&&previous?.userData.clrShadeAtlas===true)previous.dispose();
}

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

// --- Lighting ----------------------------------------------------------------
// Ambient fill softens the terminator while keeping the sun directional.
const sun = new THREE.DirectionalLight(0xffffff, 5.5);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.38));

function createCelestialMarker(
  label: string,
  material: THREE.Material,
  radius: number,
  labelWidth: number,
  labelHeight: number,
) {
  const marker = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    material,
  );
  marker.add(sphere);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Could not create the ${label} marker label`);
  context.font = '700 32px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  }));
  sprite.position.y = radius + labelHeight * 0.6;
  sprite.scale.set(labelWidth, labelHeight, 1);
  marker.add(sprite);
  scene.add(marker);
  return { marker, sphere };
}

const MOON_RADIUS_KM = 1737.4;
const EARTH_DISTANCE = 384400 / MOON_RADIUS_KM;
const SUN_DISTANCE = 149_597_870.7 / MOON_RADIUS_KM;
const EARTH_RADIUS = 6371 / MOON_RADIUS_KM;
const SUN_RADIUS = 696_340 / MOON_RADIUS_KM;
const SIDEREAL_DAY_MS = 86_164_090;
const earthTexture = new THREE.TextureLoader().load(
  earthTextureUrl,
  undefined,
  undefined,
  error => console.error('Could not load the Earth texture:', error),
);
earthTexture.colorSpace = THREE.SRGBColorSpace;
const sunMarker = createCelestialMarker(
  'SUN',
  new THREE.MeshBasicMaterial({ color: '#ffe8a3', toneMapped: false }),
  SUN_RADIUS,
  1600,
  400,
).marker;
const earthCelestialMarker = createCelestialMarker(
  'EARTH',
  new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 1, metalness: 0 }),
  EARTH_RADIUS,
  16,
  4,
);
const earthMarker = earthCelestialMarker.marker;
const earthSphere = earthCelestialMarker.sphere;
let activeSunSite:SiteCoords=APOLLO_SITES[0];

function updateEarthRotation() {
  const phase = ((simClock.get().ms % SIDEREAL_DAY_MS) + SIDEREAL_DAY_MS) % SIDEREAL_DAY_MS;
  earthSphere.rotation.y = phase / SIDEREAL_DAY_MS * Math.PI * 2;
}

function directionAtSite(azimuth:number,elevation:number){
  const az=THREE.MathUtils.degToRad(azimuth);
  const el=THREE.MathUtils.degToRad(elevation);
  const latR=THREE.MathUtils.degToRad(activeSunSite.lat);
  const lonR=THREE.MathUtils.degToRad(activeSunSite.lon);
  const up=new THREE.Vector3(Math.cos(latR)*Math.sin(lonR),Math.sin(latR),Math.cos(latR)*Math.cos(lonR));
  const east=new THREE.Vector3(Math.cos(lonR),0,-Math.sin(lonR));
  const north=new THREE.Vector3(-Math.sin(latR)*Math.sin(lonR),Math.cos(latR),-Math.sin(latR)*Math.cos(lonR));
  return new THREE.Vector3()
    .addScaledVector(up,Math.sin(el))
    .addScaledVector(east,Math.cos(el)*Math.sin(az))
    .addScaledVector(north,Math.cos(el)*Math.cos(az))
    .applyQuaternion(moonGroup?.quaternion??new THREE.Quaternion())
    .normalize();
}

function updateSunForCurrentTime(){
  const sky=skyAt(activeSunSite,simClock.get().ms);
  const sunDirection=directionAtSite(sky.sunAz,sky.sunEl);
  const earthDirection=directionAtSite(sky.earthAz,sky.earthEl);
  sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
  sunMarker.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
  earthMarker.position.copy(earthDirection).multiplyScalar(EARTH_DISTANCE);
  sun.intensity=5.5;
}

function updateSunForSite(siteName:string,lat:number,lon:number){
  activeSunSite={name:siteName,lat,lon};
  updateSunForCurrentTime();
}
function updateCelestialBodies() {
  updateSunForCurrentTime();
  updateEarthRotation();
}
simClock.subscribe(updateCelestialBodies);
updateCelestialBodies();
(window as any).updateSunForSite = updateSunForSite;

// --- Star helpers -------------------------------------------------------------
const starMaskMaterials: THREE.ShaderMaterial[] = [];
const moonStarDirection = new THREE.Vector3(0, 0, 1);
const lastMoonMaskCameraPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
let moonStarMaskCos = Math.cos(Math.asin(1 / camera.position.length()) + THREE.MathUtils.degToRad(2));

function updateMoonStarMask() {
  if(camera.position.distanceToSquared(lastMoonMaskCameraPosition)<1e-10)return;
  lastMoonMaskCameraPosition.copy(camera.position);
  const distance = camera.position.length();
  const angularRadius = Math.asin(Math.min(1, 1 / distance)) + THREE.MathUtils.degToRad(2);
  moonStarDirection.copy(camera.position).normalize();
  moonStarMaskCos = Math.cos(angularRadius);
  starMaskMaterials.forEach(material => {
    material.uniforms.uMoonMaskCos.value = moonStarMaskCos;
  });
}

function spherePt(pos:Float32Array,i:number,r:number){
  const t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);
  pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.sin(p)*Math.sin(t); pos[i*3+2]=r*Math.cos(p);
}

// --- Layer 1: 6k micro stars (static 1px) ------------------------------------
(()=>{
  const n=6000,pos=new Float32Array(n*3),col=new Float32Array(n*3);
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
  const mat=new THREE.ShaderMaterial({
    uniforms:{uMoonDirection:{value:moonStarDirection},uMoonMaskCos:{value:moonStarMaskCos}},
    vertexShader:`attribute vec3 starColor;varying vec3 vC;varying vec3 vStarDirection;void main(){vC=starColor;vStarDirection=normalize(position);gl_PointSize=1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;varying vec3 vStarDirection;uniform vec3 uMoonDirection;uniform float uMoonMaskCos;void main(){float d=dot(normalize(vStarDirection),normalize(uMoonDirection));float visible=1.0-smoothstep(uMoonMaskCos,uMoonMaskCos+0.004,d);if(visible<0.01)discard;gl_FragColor=vec4(vC,visible);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  starMaskMaterials.push(mat);
  scene.add(new THREE.Points(geo,mat));
})();

// --- Layer 2: 2.5k small twinkling stars ------------------------------------
const layer2=(()=>{
  const n=2500,pos=new Float32Array(n*3),col=new Float32Array(n*3),
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
    uniforms:{uTime:{value:0},uMoonDirection:{value:moonStarDirection},uMoonMaskCos:{value:moonStarMaskCos}},
    vertexShader:`attribute float size,phase,freq;attribute vec3 starColor;uniform float uTime;varying vec3 vC;varying vec3 vStarDirection;void main(){vC=starColor;vStarDirection=normalize(position);gl_PointSize=size*(1.0+0.12*sin(uTime*freq+phase));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;varying vec3 vStarDirection;uniform vec3 uMoonDirection;uniform float uMoonMaskCos;void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.1,d);float moonDot=dot(normalize(vStarDirection),normalize(uMoonDirection));a*=1.0-smoothstep(uMoonMaskCos,uMoonMaskCos+0.004,moonDot);if(a<0.01)discard;gl_FragColor=vec4(vC,a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  starMaskMaterials.push(mat);
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Layer 3: 400 medium stars with halo ------------------------------------
const layer3=(()=>{
  const n=400,pos=new Float32Array(n*3),col=new Float32Array(n*3),
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
    uniforms:{uTime:{value:0},uMoonDirection:{value:moonStarDirection},uMoonMaskCos:{value:moonStarMaskCos}},
    vertexShader:`attribute float size,phase;attribute vec3 starColor;uniform float uTime;varying vec3 vC;varying float vP;varying vec3 vStarDirection;void main(){vC=starColor;vP=phase;vStarDirection=normalize(position);float sh=1.0+0.18*sin(uTime*(1.1+phase*1.3)+phase)+0.09*sin(uTime*(2.7+phase*0.9)+phase*2.0);gl_PointSize=size*sh;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vC;varying float vP;varying vec3 vStarDirection;uniform float uTime;uniform vec3 uMoonDirection;uniform float uMoonMaskCos;void main(){float d=length(gl_PointCoord-0.5);float core=smoothstep(0.18,0.0,d);float halo=smoothstep(0.45,0.0,d)*0.25;float a=clamp((core+halo)*(1.0+0.15*sin(uTime*(1.9+vP*1.4)+vP*3.14)),0.0,1.0);float moonDot=dot(normalize(vStarDirection),normalize(uMoonDirection));a*=1.0-smoothstep(uMoonMaskCos,uMoonMaskCos+0.004,moonDot);if(a<0.01)discard;gl_FragColor=vec4(vC,a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  starMaskMaterials.push(mat);
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Layer 4: 80 bright stars with diffraction spikes -----------------------
const layer4=(()=>{
  const n=80,pos=new Float32Array(n*3),sz=new Float32Array(n),
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
    uniforms:{uTime:{value:0},uMoonDirection:{value:moonStarDirection},uMoonMaskCos:{value:moonStarMaskCos}},
    vertexShader:`attribute float size,phase;attribute vec3 starColor;varying float vP;varying vec3 vC;varying vec3 vStarDirection;uniform float uTime;void main(){vP=phase;vC=starColor;vStarDirection=normalize(position);float f1=1.3+phase*0.5,f2=3.1+phase*1.7;gl_PointSize=size*(1.0+0.28*sin(uTime*f1+phase)+0.12*sin(uTime*f2+phase*2.0));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying float vP;varying vec3 vC;varying vec3 vStarDirection;uniform float uTime;uniform vec3 uMoonDirection;uniform float uMoonMaskCos;void main(){vec2 uv=gl_PointCoord-0.5;float d=length(uv);float core=smoothstep(0.12,0.0,d);float halo=smoothstep(0.42,0.0,d)*0.15;float s1=smoothstep(0.035,0.0,abs(uv.x))*smoothstep(0.5,0.0,abs(uv.y));float s2=smoothstep(0.035,0.0,abs(uv.y))*smoothstep(0.5,0.0,abs(uv.x));vec2 r45=vec2(uv.x+uv.y,uv.x-uv.y)*0.7071;float s3=smoothstep(0.025,0.0,abs(r45.x))*smoothstep(0.5,0.0,abs(r45.y))*0.35;float s4=smoothstep(0.025,0.0,abs(r45.y))*smoothstep(0.5,0.0,abs(r45.x))*0.35;float sp=clamp(s1+s2+s3+s4,0.0,1.0);float sh=1.0+0.30*sin(uTime*(2.1+vP*2.3)+vP*6.28)+0.15*sin(uTime*(4.7+vP*1.1)+vP*3.14);float a=clamp((core+halo+sp*0.65)*sh,0.0,1.0);float moonDot=dot(normalize(vStarDirection),normalize(uMoonDirection));a*=1.0-smoothstep(uMoonMaskCos,uMoonMaskCos+0.004,moonDot);if(a<0.01)discard;float cs=0.5+0.5*sin(uTime*(1.8+vP)+vP*2.0);vec3 sc=mix(vC,mix(vC,vec3(0.9,0.95,1.0),0.3),cs*0.4);gl_FragColor=vec4(mix(mix(sc,vec3(0.8,0.9,1.0),0.35),sc,core/max(core+sp*0.5,0.001)),a);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  starMaskMaterials.push(mat);
  const pts=new THREE.Points(geo,mat); scene.add(pts); return pts;
})();

// --- Zoom state ---------------------------------------------------------------
let moonReferenceRadius=0;
const MOON_RADIUS_METERS=1_737_400;
interface GlobalLdemGrid {
  width:number;
  height:number;
  values:Float32Array;
}
let globalLdemGrid:GlobalLdemGrid|null=null;
let demPatch:THREE.Mesh|null=null;
let demRequest:AbortController|null=null;
let demRequestId=0;
let demRefreshTimer:number|null=null;
let lastDemRequest:{lat:number;lon:number;span:number;terrainTileSide:number;imageryTileSide:number;west:number;south:number;east:number;north:number}|null=null;
let localClrShadeTexture:THREE.Texture|null=null;
let localOverlayRequestId=0;

const MOON_TREK_SERVICES=`${import.meta.env.DEV?'/nasa-moon':'https://trek.nasa.gov/moon'}/trekarcgis/rest/services`;
const DEM_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer`;
const DEM_NORTH_30M_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_DEM_NPole75_30mp_v04_EQ/ImageServer`;
const DEM_SOUTH_30M_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_DEM_SPole75_30mp_v04_EQ/ImageServer`;
const DEM_NORTH_5M_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_DEM_NPole875_5mp_v04_EQ/ImageServer`;
const DEM_SOUTH_5M_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_DEM_SPole875_5mp_v04_EQ/ImageServer`;
const CLRSHADE_SERVICE=`${MOON_TREK_SERVICES}/LRO_LOLA_ClrShade_Global_256ppd_v06/ImageServer`;
const DEM_GRID_MIN=256;
const DEM_GRID_MAX=1280;
const DEM_TARGET_SAMPLE_METERS=30;
const TERRAIN_VERTICAL_EXAGGERATION=1.3;
const MOON_METERS_PER_DEGREE=MOON_RADIUS_METERS*Math.PI/180;
const DEM_PATCH_FADE_FRACTION=0.42;
const DEM_REQUEST_DEBOUNCE_MS=250;
// Network timeout for each Moon Trek request. The service can be slow on cold
// start; 25 s covers normal latency while still failing fast when offline.
const DEM_FETCH_TIMEOUT_MS=25_000;
// Local ClrShade tiles generated by scripts/generateClrShadeTiles.mjs.
// Each tile is a 512×512 PNG covering a 2°×2° patch, named by its SW corner.
const CLRSHADE_TILE_DEG=2;
const CLRSHADE_TILE_PX=512;
const clrShadeTileMisses=new Set<string>();
const WAC_TILE_DEG=2;
const WAC_TILE_PX=606;
const wacTileMisses=new Set<string>();
const CLRSHADE_NORTH_30M_LAT=68.906;
const CLRSHADE_NORTH_5M_LAT=86.464;

// Convert a lat/lon to the SW-corner tile name used by generateClrShadeTiles.mjs.
function clrShadeTileOrigin(lat:number,lon:number){
  const latSW=THREE.MathUtils.clamp(Math.floor(lat/CLRSHADE_TILE_DEG)*CLRSHADE_TILE_DEG,-90,90-CLRSHADE_TILE_DEG);
  const lonSW=THREE.MathUtils.clamp(Math.floor(lon/CLRSHADE_TILE_DEG)*CLRSHADE_TILE_DEG,-180,180-CLRSHADE_TILE_DEG);
  return {latSW,lonSW};
}

function clrShadeTileName(lat:number,lon:number):string{
  const {latSW,lonSW}=clrShadeTileOrigin(lat,lon);
  const latAbs=Math.abs(latSW), lonAbs=Math.abs(lonSW);
  const latH=latSW>=0?'N':'S', lonH=lonSW>=0?'E':'W';
  return `${latH}${String(latAbs).padStart(2,'0')}${lonH}${String(lonAbs).padStart(3,'0')}`;
}

async function fetchClrShadeTile(lat:number,lon:number):Promise<{blob:Blob;source:'local'|'nasa'}|null>{
  const name=clrShadeTileName(lat,lon);
  if(!clrShadeTileMisses.has(name)){
    try{
      const localResponse=await fetch(`/clrshade-tiles/${name}.png`);
      if(localResponse.status===404){
        clrShadeTileMisses.add(name);
      }else if(localResponse.ok&&localResponse.headers.get('content-type')?.toLowerCase().startsWith('image/png')){
        return {blob:await localResponse.blob(),source:'local'};
      }
    }catch{
      // Fall through to the global Moon Trek service when the local cache is unavailable.
    }
  }
  const {latSW:south,lonSW:west}=clrShadeTileOrigin(lat,lon);
  const params=new URLSearchParams({
    bbox:`${west},${south},${west+CLRSHADE_TILE_DEG},${south+CLRSHADE_TILE_DEG}`,
    bboxSR:'104903',
    size:`${CLRSHADE_TILE_PX},${CLRSHADE_TILE_PX}`,
    imageSR:'104903',
    format:'png32',
    f:'image',
  });
  try{
    const response=await fetch(`${CLRSHADE_SERVICE}/exportImage?${params}`);
    if(!response.ok)return null;
    if(!response.headers.get('content-type')?.toLowerCase().startsWith('image/png'))return null;
    return {blob:await response.blob(),source:'nasa'};
  }catch{
    return null;
  }
}
const clrShadeTextureCache=new Map<string,THREE.Texture>();
const clrShadeTextureLoads=new Map<string,Promise<THREE.Texture|null>>();
const clrShadeTexturePins=new Map<string,number>();
const CLRSHADE_TEXTURE_CACHE_SIZE=40;

function disposeClrShadeTexture(texture:THREE.Texture){
  const image=texture.image;
  texture.dispose();
  if(image instanceof ImageBitmap)image.close();
}

function trimClrShadeTextureCache(){
  while(clrShadeTextureCache.size>CLRSHADE_TEXTURE_CACHE_SIZE){
    const oldest=Array.from(clrShadeTextureCache.entries()).find(([name,candidate])=>!clrShadeTexturePins.has(name)&&candidate!==localClrShadeTexture);
    if(!oldest)return;
    clrShadeTextureCache.delete(oldest[0]);
    disposeClrShadeTexture(oldest[1]);
  }
}

async function getClrShadeTexture(lat:number,lon:number):Promise<THREE.Texture|null>{
  const name=clrShadeTileName(lat,lon);
  const cached=clrShadeTextureCache.get(name);
  if(cached){
    clrShadeTextureCache.delete(name);
    clrShadeTextureCache.set(name,cached);
    return cached;
  }
  let pending=clrShadeTextureLoads.get(name);
  if(!pending){
    pending=(async()=>{
      const tile=await fetchClrShadeTile(lat,lon);
      if(!tile)return null;
      const bitmap=await createImageBitmap(tile.blob);
      const texture=new THREE.Texture(bitmap);
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.flipY=false;
      texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      texture.userData.clrShadeSource=tile.source;
      texture.needsUpdate=true;
      clrShadeTextureCache.set(name,texture);
      trimClrShadeTextureCache();
      return texture;
    })();
    clrShadeTextureLoads.set(name,pending);
  }
  try{
    return await pending;
  }finally{
    if(clrShadeTextureLoads.get(name)===pending)clrShadeTextureLoads.delete(name);
  }
}

function getClrShadeMosaicBounds(lat:number,lon:number,side:number){
  const centerSouth=Math.floor(lat/CLRSHADE_TILE_DEG)*CLRSHADE_TILE_DEG;
  const centerWest=Math.floor(lon/CLRSHADE_TILE_DEG)*CLRSHADE_TILE_DEG;
  const extent=side*CLRSHADE_TILE_DEG;
  const west=THREE.MathUtils.clamp(centerWest-Math.floor(side/2)*CLRSHADE_TILE_DEG,-180,180-extent);
  const south=THREE.MathUtils.clamp(centerSouth-Math.floor(side/2)*CLRSHADE_TILE_DEG,-90,90-extent);
  return {west,south,east:west+extent,north:south+extent};
}

function getDemPatchBounds(lat:number,lon:number,side:number){
  const extent=side*CLRSHADE_TILE_DEG;
  const west=THREE.MathUtils.clamp(lon-extent/2,-180,180-extent);
  const south=THREE.MathUtils.clamp(lat-extent/2,-90,90-extent);
  return {west,south,east:west+extent,north:south+extent};
}

function getDemSource(bounds:{south:number;north:number}){
  if(bounds.south>=CLRSHADE_NORTH_5M_LAT)return {url:DEM_NORTH_5M_SERVICE,label:'LOLA 5 m polar DEM'};
  if(bounds.north<=-CLRSHADE_NORTH_5M_LAT)return {url:DEM_SOUTH_5M_SERVICE,label:'LOLA 5 m polar DEM'};
  if(bounds.south>=CLRSHADE_NORTH_30M_LAT)return {url:DEM_NORTH_30M_SERVICE,label:'LOLA 30 m polar DEM'};
  if(bounds.north<=-CLRSHADE_NORTH_30M_LAT)return {url:DEM_SOUTH_30M_SERVICE,label:'LOLA 30 m polar DEM'};
  return {url:DEM_SERVICE,label:'LOLA global 256ppd DEM'};
}

async function getClrShadeTileMosaic(lat:number,lon:number,side:number):Promise<{
  texture:THREE.Texture;
  west:number;
  south:number;
  east:number;
  north:number;
  localTileCount:number;
  nasaTileCount:number;
  totalTiles:number;
}|null>{
  const {west,south,east,north}=getClrShadeMosaicBounds(lat,lon,side);
  if(side>5){
    const size=Math.min(side*CLRSHADE_TILE_PX,2048,renderer.capabilities.maxTextureSize);
    if(size<1)throw new Error('WebGL texture limit is too small for global ClrShade imagery');
    const params=new URLSearchParams({
      bbox:`${west},${south},${east},${north}`,
      bboxSR:'104903',
      size:`${size},${size}`,
      imageSR:'104903',
      format:'png32',
      f:'image',
    });
    const response=await fetch(`${CLRSHADE_SERVICE}/exportImage?${params}`);
    if(!response.ok)throw new Error(`NASA ClrShade service returned HTTP ${response.status}`);
    if(!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')){
      throw new Error('NASA ClrShade service returned an unexpected image format');
    }
    const bitmap=await createImageBitmap(await response.blob());
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=size;
    const context=canvas.getContext('2d');
    if(!context){
      bitmap.close();
      throw new Error('Could not create a canvas for streamed ClrShade imagery');
    }
    try{
      context.drawImage(bitmap,0,0,size,size);
    }finally{
      bitmap.close();
    }
    const texture=new THREE.Texture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.flipY=false;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.generateMipmaps=false;
    texture.minFilter=THREE.LinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    texture.userData.clrShadeAtlas=true;
    texture.needsUpdate=true;
    const totalTiles=side*side;
    return {texture,west,south,east,north,localTileCount:0,nasaTileCount:totalTiles,totalTiles};
  }

  const cells:{name:string;lat:number;lon:number;column:number;row:number}[]=[];
  for(let row=0;row<side;row++){
    for(let column=0;column<side;column++){
      const tileSouth=south+(side-row-1)*CLRSHADE_TILE_DEG;
      const tileWest=west+column*CLRSHADE_TILE_DEG;
      const tileLat=tileSouth+1;
      const tileLon=tileWest+1;
      const name=clrShadeTileName(tileLat,tileLon);
      cells.push({name,lat:tileLat,lon:tileLon,column,row});
    }
  }

  cells.forEach(({name})=>clrShadeTexturePins.set(name,(clrShadeTexturePins.get(name)??0)+1));
  try{
    const loaded=await Promise.all(cells.map(async cell=>({cell,texture:await getClrShadeTexture(cell.lat,cell.lon)})));
    if(!loaded.some(item=>item.texture))return null;
    const tilePixels=Math.min(CLRSHADE_TILE_PX,Math.floor(renderer.capabilities.maxTextureSize/side));
    if(tilePixels<1)throw new Error('WebGL texture limit is too small for local ClrShade tiles');
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=tilePixels*side;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Could not create a canvas for the local ClrShade tiles');
    context.clearRect(0,0,canvas.width,canvas.height);
    let localTileCount=0;
    let nasaTileCount=0;
    loaded.forEach(({cell,texture})=>{
      const image=texture?.image;
      if(texture&&image instanceof ImageBitmap){
        context.drawImage(image,cell.column*tilePixels,cell.row*tilePixels,tilePixels,tilePixels);
        if(texture.userData.clrShadeSource==='local')localTileCount++;
        if(texture.userData.clrShadeSource==='nasa')nasaTileCount++;
      }
    });
    const totalTiles=localTileCount+nasaTileCount;
    if(totalTiles<cells.length)console.warn(`LRO ClrShade tile coverage is incomplete: ${totalTiles}/${cells.length} tiles loaded`);
    const texture=new THREE.Texture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.flipY=false;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.generateMipmaps=false;
    texture.minFilter=THREE.LinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    texture.userData.clrShadeAtlas=true;
    texture.needsUpdate=true;
    return {texture,west,south,east,north,localTileCount,nasaTileCount,totalTiles};
  }finally{
    cells.forEach(({name})=>{
      const count=clrShadeTexturePins.get(name)??0;
      if(count<=1)clrShadeTexturePins.delete(name);
      else clrShadeTexturePins.set(name,count-1);
    });
    trimClrShadeTextureCache();
  }
}

function wacTileName(lat:number,lon:number){
  const latSW=THREE.MathUtils.clamp(Math.floor(lat/WAC_TILE_DEG)*WAC_TILE_DEG,-90,90-WAC_TILE_DEG);
  const lonSW=THREE.MathUtils.clamp(Math.floor(lon/WAC_TILE_DEG)*WAC_TILE_DEG,-180,180-WAC_TILE_DEG);
  const latH=latSW>=0?'N':'S';
  const lonH=lonSW>=0?'E':'W';
  return `${latH}${String(Math.abs(latSW)).padStart(2,'0')}${lonH}${String(Math.abs(lonSW)).padStart(3,'0')}`;
}

async function loadWacTile(lat:number,lon:number):Promise<ImageBitmap|null>{
  const name=wacTileName(lat,lon);
  if(wacTileMisses.has(name))return null;
  const response=await fetch(`/lro-wac-tiles/${name}.png`,{cache:'force-cache'});
  if(response.status===404){
    wacTileMisses.add(name);
    return null;
  }
  if(!response.ok)throw new Error(`LRO WAC detail tile ${name} returned HTTP ${response.status}`);
  if(!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')){
    wacTileMisses.add(name);
    return null;
  }
  return createImageBitmap(await response.blob());
}

function getWacTileMosaicBounds(lat:number,lon:number,side:number){
  const centerSouth=Math.floor(lat/WAC_TILE_DEG)*WAC_TILE_DEG;
  const centerWest=Math.floor(lon/WAC_TILE_DEG)*WAC_TILE_DEG;
  const extent=side*WAC_TILE_DEG;
  const west=THREE.MathUtils.clamp(centerWest-Math.floor(side/2)*WAC_TILE_DEG,-180,180-extent);
  const south=THREE.MathUtils.clamp(centerSouth-Math.floor(side/2)*WAC_TILE_DEG,-90,90-extent);
  return {west,south,east:west+extent,north:south+extent};
}

async function getWacTileMosaic(lat:number,lon:number,side:number):Promise<{
  texture:THREE.Texture;
  west:number;
  south:number;
  east:number;
  north:number;
  localTileCount:number;
  totalTiles:number;
}|null>{
  const centerTile=await loadWacTile(lat,lon);
  if(!centerTile)return null;
  const bounds=getWacTileMosaicBounds(lat,lon,side);
  const cells=Array.from({length:side*side},(_,index)=>{
    const row=Math.floor(index/side);
    const column=index%side;
    const tileSouth=bounds.south+(side-row-1)*WAC_TILE_DEG;
    const tileWest=bounds.west+column*WAC_TILE_DEG;
    const tileLat=tileSouth+1;
    const tileLon=tileWest+1;
    return {row,column,lat:tileLat,lon:tileLon,name:wacTileName(tileLat,tileLon)};
  });
  const centerName=wacTileName(lat,lon);
  const failures:string[]=[];
  const loaded=await Promise.all(cells.map(async cell=>{
    if(cell.name===centerName)return {cell,image:centerTile};
    try{
      return {cell,image:await loadWacTile(cell.lat,cell.lon)};
    }catch(error){
      failures.push(cell.name);
      console.warn(`LRO WAC detail tile ${cell.name} could not be loaded:`,error);
      return {cell,image:null};
    }
  }));
  const localTileCount=loaded.filter(item=>item.image).length;
  const tilePixels=Math.min(WAC_TILE_PX,Math.floor(renderer.capabilities.maxTextureSize/side));
  if(tilePixels<1){
    loaded.forEach(item=>item.image?.close());
    throw new Error('WebGL texture limit is too small for local LRO WAC tiles');
  }
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=tilePixels*side;
  const context=canvas.getContext('2d');
  if(!context){
    loaded.forEach(item=>item.image?.close());
    throw new Error('Could not create a canvas for the local LRO WAC detail tiles');
  }
  try{
    context.clearRect(0,0,canvas.width,canvas.height);
    loaded.forEach(({cell,image})=>{
      if(image)context.drawImage(image,cell.column*tilePixels,cell.row*tilePixels,tilePixels,tilePixels);
    });
  }finally{
    loaded.forEach(item=>item.image?.close());
  }
  if(failures.length)console.warn(`LRO WAC LOD coverage is incomplete: ${localTileCount}/${cells.length} tiles loaded`);
  const texture=new THREE.Texture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.flipY=false;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.generateMipmaps=false;
  texture.minFilter=THREE.LinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  texture.userData.clrShadeAtlas=true;
  texture.needsUpdate=true;
  return {texture,...bounds,localTileCount,totalTiles:cells.length};
}

const globalColorPlaceholder=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat);
globalColorPlaceholder.colorSpace=THREE.SRGBColorSpace;
globalColorPlaceholder.flipY=false;
globalColorPlaceholder.needsUpdate=true;
const globalColorMapUniform:{value:THREE.Texture}={value:globalColorPlaceholder};
const globalColorMixUniform={value:0};
let globalColorTexture:THREE.Texture|null=null;
const localClrShadeMapUniform:{value:THREE.Texture}={value:globalColorPlaceholder};
const localClrShadeBoundsUniform={value:new THREE.Vector4()};
const localClrShadeMixUniform={value:1};
const localClrShadeColorMixUniform={value:1};
let localClrShadeEnabled=true;
function makeSharedGlobalColorTexture(){
  const texture=globalColorMapUniform.value.clone();
  texture.userData.sharedImage=true;
  return texture;
}

function installGlobalSurfaceTexture(texture:THREE.Texture|null){
  globalColorMapUniform.value=texture??globalColorPlaceholder;
  globalColorMixUniform.value=texture?1:0;
  if(demPatch){
    const materials=Array.isArray(demPatch.material)?demPatch.material:[demPatch.material];
    materials.forEach(material=>{
      if(material instanceof THREE.MeshStandardMaterial){
        const previousMap=material.map;
        material.map=makeSharedGlobalColorTexture();
        material.needsUpdate=true;
        previousMap?.dispose();
      }
    });
  }
}

function updateGlobalSurfaceTexture(){
  installGlobalSurfaceTexture(globalColorTexture);
}

async function loadLocalSurfaceOverlay(lat:number,lon:number,terrainTileSide:number,imageryTileSide:number){
  const requestId=++localOverlayRequestId;
  const useClrShade=localClrShadeEnabled;
  let hasCenterImagery=false;
  try{
    if(!useClrShade){
      const mosaic=await getWacTileMosaic(lat,lon,terrainTileSide);
      if(!mosaic)return false;
      if(requestId!==localOverlayRequestId||localClrShadeEnabled){
        mosaic.texture.dispose();
        return false;
      }
      installLocalClrShadeTexture(
        mosaic.texture,
        mosaic.west,mosaic.south,mosaic.east,mosaic.north,
        lat,lon,
        {local:mosaic.localTileCount,nasa:0,total:mosaic.totalTiles},
        'wac',
      );
      return true;
    }

    const {latSW:centerTileSouth,lonSW:centerTileWest}=clrShadeTileOrigin(lat,lon);
    const centerTile=await getClrShadeTexture(centerTileSouth+1,centerTileWest+1);
    if(centerTile&&requestId===localOverlayRequestId&&localClrShadeEnabled){
      installLocalClrShadeTexture(
        centerTile,
        centerTileWest,
        centerTileSouth,
        centerTileWest+CLRSHADE_TILE_DEG,
        centerTileSouth+CLRSHADE_TILE_DEG,
        lat,
        lon,
      );
      hasCenterImagery=true;
    }

    const mosaic=await getClrShadeTileMosaic(lat,lon,imageryTileSide);
    if(!mosaic)return hasCenterImagery;
    if(requestId!==localOverlayRequestId||!localClrShadeEnabled){
      mosaic.texture.dispose();
      return hasCenterImagery;
    }
    installLocalClrShadeTexture(
      mosaic.texture,
      mosaic.west,mosaic.south,mosaic.east,mosaic.north,
      lat,lon,
      {local:mosaic.localTileCount,nasa:mosaic.nasaTileCount,total:mosaic.totalTiles},
    );
    return true;
  }catch(error){
    console.warn(`Local ${useClrShade?'ClrShade':'WAC'} LOD imagery could not be loaded:`,error);
    return hasCenterImagery;
  }
}

window.addEventListener('moonclrshadevisibilitychange',(event:Event)=>{
  const {enabled}=(event as CustomEvent<{enabled:boolean}>).detail;
  localClrShadeEnabled=enabled;
  // When turning relief OFF: keep uMoonClrShadeMix=1 so the WAC overlay that
  // loadLocalSurfaceOverlay is about to load stays visible.
  // uMoonClrShadeColorMix drives colour vs greyscale — 0 = greyscale WAC, 1 = colour ClrShade.
  localClrShadeColorMixUniform.value=enabled?1:0;
  updateGlobalSurfaceTexture();
  clearLocalClrShadeTexture();
  if(lastDemRequest){
    void loadLocalSurfaceOverlay(
      lastDemRequest.lat,
      lastDemRequest.lon,
      lastDemRequest.terrainTileSide,
      lastDemRequest.imageryTileSide,
    );
  }
});

function emitDemStatus(detail:{status:'loading'|'ready'|'error';lat:number;lon:number;elevationMeters?:number;resolutionMeters?:number;message?:string}){
  window.dispatchEvent(new CustomEvent('moondem',{detail}));
}

function disposeDemMesh(mesh:THREE.Mesh){
  moonGroup?.remove(mesh);
  mesh.geometry.dispose();
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  materials.forEach(material=>{
    if(material instanceof THREE.MeshStandardMaterial&&material.map){
      const image=material.map.image;
      const sharedImage=material.map.userData.sharedImage===true;
      material.map.dispose();
      if(!sharedImage&&image instanceof ImageBitmap)image.close();
    }
    material.dispose();
  });
}

function clearDemPatch(){
  demRequest?.abort();
  demRequest=null;
  demRequestId++;
  if(demRefreshTimer!==null){
    window.clearTimeout(demRefreshTimer);
    demRefreshTimer=null;
  }
  lastDemRequest=null;
  if(demPatch){
    disposeDemMesh(demPatch);
    demPatch=null;
  }
  clearLocalClrShadeTexture();
}

function configureMoonSurfaceMaterial(material:THREE.MeshStandardMaterial,useGlobalColor=false){
  material.roughness=0.9;
  material.metalness=0;
  material.envMapIntensity=0;
  material.onBeforeCompile=shader=>{
    if(useGlobalColor){
      shader.uniforms.uMoonGlobalMap=globalColorMapUniform;
      shader.uniforms.uMoonGlobalMix=globalColorMixUniform;
      shader.uniforms.uMoonClrShadeMap=localClrShadeMapUniform;
      shader.uniforms.uMoonClrShadeBounds=localClrShadeBoundsUniform;
      shader.uniforms.uMoonClrShadeMix=localClrShadeMixUniform;
      shader.uniforms.uMoonClrShadeColorMix=localClrShadeColorMixUniform;
      shader.vertexShader=shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 moonGlobalUv;\nvarying vec2 vMoonGlobalUv;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvMoonGlobalUv=moonGlobalUv;'
        );
      shader.fragmentShader=shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uMoonGlobalMap;\nuniform float uMoonGlobalMix;\nuniform sampler2D uMoonClrShadeMap;\nuniform vec4 uMoonClrShadeBounds;\nuniform float uMoonClrShadeMix;\nuniform float uMoonClrShadeColorMix;\nvarying vec2 vMoonGlobalUv;'
      );
    }
    const globalMapFragment=useGlobalColor
      ? [
        'float moonLatitude=90.0-vMoonGlobalUv.y*180.0;',
        'float moonLongitude=vMoonGlobalUv.x*360.0-180.0;',
        'vec3 moonGlobalColor=texture2D(uMoonGlobalMap,vMoonGlobalUv).rgb;',
        'diffuseColor.rgb=mix(diffuseColor.rgb,moonGlobalColor,uMoonGlobalMix);',
        'float clrShadeInside=step(uMoonClrShadeBounds.x,moonLongitude)*step(moonLongitude,uMoonClrShadeBounds.z)*step(uMoonClrShadeBounds.y,moonLatitude)*step(moonLatitude,uMoonClrShadeBounds.w);',
        'float clrShadeEdge=min(min(moonLongitude-uMoonClrShadeBounds.x,uMoonClrShadeBounds.z-moonLongitude),min(moonLatitude-uMoonClrShadeBounds.y,uMoonClrShadeBounds.w-moonLatitude));',
        'vec2 clrShadeSpan=max(uMoonClrShadeBounds.zw-uMoonClrShadeBounds.xy,vec2(0.0001));',
        `float clrShadeFadeWidth=max(min(clrShadeSpan.x,clrShadeSpan.y)*${DEM_PATCH_FADE_FRACTION.toFixed(2)},0.1);`,
        'float clrShadeFade=smoothstep(0.0,clrShadeFadeWidth,clrShadeEdge);',
        'vec2 clrShadeUv=vec2((moonLongitude-uMoonClrShadeBounds.x)/clrShadeSpan.x,(uMoonClrShadeBounds.w-moonLatitude)/clrShadeSpan.y);',
        `vec2 clrShadeTileCount=max(floor(clrShadeSpan/${CLRSHADE_TILE_DEG.toFixed(1)}+0.5),vec2(1.0));`,
        'vec2 clrShadeTilePosition=min(clrShadeUv*clrShadeTileCount,clrShadeTileCount-vec2(0.00001));',
        'vec2 clrShadeTileIndex=floor(clrShadeTilePosition);',
        'vec2 clrShadeTileLocal=fract(clrShadeTilePosition);',
        'vec2 clrShadeNeighborXUv=clrShadeUv;',
        'vec2 clrShadeNeighborYUv=clrShadeUv;',
        'float clrShadeBlendX=0.0;',
        'float clrShadeBlendY=0.0;',
        'if(clrShadeTileLocal.x<0.5&&clrShadeTileIndex.x>0.0){clrShadeNeighborXUv.x=(clrShadeTileIndex.x-clrShadeTileLocal.x)/clrShadeTileCount.x;clrShadeBlendX=0.5*(1.0-smoothstep(0.0,0.08,clrShadeTileLocal.x));}else if(clrShadeTileLocal.x>=0.5&&clrShadeTileIndex.x<clrShadeTileCount.x-1.0){clrShadeNeighborXUv.x=(clrShadeTileIndex.x+2.0-clrShadeTileLocal.x)/clrShadeTileCount.x;clrShadeBlendX=0.5*(1.0-smoothstep(0.0,0.08,1.0-clrShadeTileLocal.x));}',
        'if(clrShadeTileLocal.y<0.5&&clrShadeTileIndex.y>0.0){clrShadeNeighborYUv.y=(clrShadeTileIndex.y-clrShadeTileLocal.y)/clrShadeTileCount.y;clrShadeBlendY=0.5*(1.0-smoothstep(0.0,0.08,clrShadeTileLocal.y));}else if(clrShadeTileLocal.y>=0.5&&clrShadeTileIndex.y<clrShadeTileCount.y-1.0){clrShadeNeighborYUv.y=(clrShadeTileIndex.y+2.0-clrShadeTileLocal.y)/clrShadeTileCount.y;clrShadeBlendY=0.5*(1.0-smoothstep(0.0,0.08,1.0-clrShadeTileLocal.y));}',
        'vec2 clrShadeNeighborXYUv=vec2(clrShadeNeighborXUv.x,clrShadeNeighborYUv.y);',
        'vec4 clrShadeCenter=texture2D(uMoonClrShadeMap,clrShadeUv);',
        'vec4 clrShadeBlendXOnly=mix(clrShadeCenter,texture2D(uMoonClrShadeMap,clrShadeNeighborXUv),clrShadeBlendX);',
        'vec4 clrShadeBlendYOnly=mix(texture2D(uMoonClrShadeMap,clrShadeNeighborYUv),texture2D(uMoonClrShadeMap,clrShadeNeighborXYUv),clrShadeBlendX);',
        'vec4 clrShadeTexel=mix(clrShadeBlendXOnly,clrShadeBlendYOnly,clrShadeBlendY);',
        'float clrShadeLuminance=dot(clrShadeTexel.rgb,vec3(0.2126,0.7152,0.0722));',
        'vec3 tileColor=mix(vec3(clrShadeLuminance),clrShadeTexel.rgb,uMoonClrShadeColorMix);',
        'vec3 matchedTileColor=mix(tileColor,diffuseColor.rgb,0.25);',
        'diffuseColor.rgb=mix(diffuseColor.rgb,matchedTileColor,clrShadeInside*clrShadeFade*uMoonClrShadeMix*clrShadeTexel.a);',
      ].join('\n')
      : '';
    shader.fragmentShader=shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n${globalMapFragment}`
    );
  };
  material.customProgramCacheKey=()=>`moon-surface-color-v15-${useGlobalColor?'global':'local'}`;
  material.needsUpdate=true;
}

async function fetchGlobalColorTexture(assetPath:string){
  const response=await fetch(assetPath);
  if(!response.ok)throw new Error(`Lunar surface texture returned HTTP ${response.status}`);
  const bitmap=await createImageBitmap(await response.blob());
  const texture=new THREE.Texture(bitmap);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.flipY=false;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate=true;
  return texture;
}

function installGlobalColorTexture(texture:THREE.Texture){
  const previous=globalColorTexture;
  globalColorTexture=texture;
  updateGlobalSurfaceTexture();
  if(previous){
    const image=previous.image;
    previous.dispose();
    if(image instanceof ImageBitmap)image.close();
  }
}

async function loadGlobalColorTexture(){
  window.dispatchEvent(new CustomEvent('moonglobalimagery',{detail:{status:'loading'}}));
  try{
    installGlobalColorTexture(await fetchGlobalColorTexture('/moon-lroc-coarse.png'));
    window.dispatchEvent(new CustomEvent('moonglobalimagery',{detail:{status:'coarse'}}));
    installGlobalColorTexture(await fetchGlobalColorTexture('/moon-lroc-color-8k.png'));
    window.dispatchEvent(new CustomEvent('moonglobalimagery',{detail:{status:'ready'}}));
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown NASA LROC texture error';
    console.error('Local LRO global texture could not be loaded:',error);
    window.dispatchEvent(new CustomEvent('moonglobalimagery',{detail:{status:'error',message}}));
  }
}

function sampleGlobalLdemMeters(lat:number,lon:number,grid=globalLdemGrid){
  if(!grid)return null;
  const x=THREE.MathUtils.euclideanModulo((lon+180)/360,1)*grid.width;
  const y=THREE.MathUtils.clamp((90-lat)/180*(grid.height-1),0,grid.height-1);
  const x0=Math.floor(x)%grid.width;
  const x1=(x0+1)%grid.width;
  const y0=Math.floor(y);
  const y1=Math.min(grid.height-1,y0+1);
  const tx=x-Math.floor(x);
  const ty=y-y0;
  const top=THREE.MathUtils.lerp(grid.values[y0*grid.width+x0],grid.values[y0*grid.width+x1],tx);
  const bottom=THREE.MathUtils.lerp(grid.values[y1*grid.width+x0],grid.values[y1*grid.width+x1],tx);
  return THREE.MathUtils.lerp(top,bottom,ty)*1000;
}

async function loadGlobalLdem16():Promise<GlobalLdemGrid>{
  window.dispatchEvent(new CustomEvent('moonglobalterrain',{detail:{status:'loading'}}));
  const response=await fetch(ldem16Url);
  if(!response.ok)throw new Error(`LDEM16 returned HTTP ${response.status}`);
  const tiff=await fromArrayBuffer(await response.arrayBuffer());
  const image=await tiff.getImage();
  if(image.getWidth()!==5760||image.getHeight()!==2880){
    throw new Error(`LDEM16 has unexpected dimensions ${image.getWidth()}x${image.getHeight()}`);
  }
  if(image.getSamplesPerPixel()!==1)throw new Error('LDEM16 is not a single-band elevation raster');
  const raster=await image.readRasters({interleave:true});
  if(!(raster instanceof Float32Array)){
    throw new Error('LDEM16 is not a Float32 elevation raster');
  }
  for(const heightKm of raster){
    if(!Number.isFinite(heightKm)||Math.abs(heightKm)>50){
      throw new Error('LDEM16 contains missing or invalid elevation samples');
    }
  }
  const grid={width:image.getWidth(),height:image.getHeight(),values:raster};
  return grid;
}

const globalLdemPromise=loadGlobalLdem16().catch(error=>{
  const message=error instanceof Error?error.message:'Unknown LDEM16 loading error';
  console.error('Global LDEM16 terrain could not be loaded:',error);
  window.dispatchEvent(new CustomEvent('moonglobalterrain',{detail:{status:'error',message}}));
  return null;
});

async function applyGlobalLdemToSphere(geometry:THREE.BufferGeometry,grid:GlobalLdemGrid){
  const position=geometry.getAttribute('position');
  if(!position)throw new Error('Procedural Moon has no position attribute');
  for(let start=0;start<position.count;start+=131072){
    const end=Math.min(start+131072,position.count);
    for(let index=start;index<end;index++){
      const x=position.getX(index);
      const y=position.getY(index);
      const z=position.getZ(index);
      const sourceRadius=Math.hypot(x,y,z);
      if(!Number.isFinite(sourceRadius)||sourceRadius===0){
        throw new Error('Procedural Moon contains an invalid vertex');
      }
      const latitude=Math.asin(THREE.MathUtils.clamp(y/sourceRadius,-1,1));
      const longitude=Math.atan2(x,z);
      const latDegrees=THREE.MathUtils.radToDeg(latitude);
      const lonDegrees=THREE.MathUtils.radToDeg(longitude);
      const elevationMeters=sampleGlobalLdemMeters(latDegrees,lonDegrees,grid);
      if(elevationMeters===null)throw new Error('LDEM16 elevation sample is unavailable');
      const radius=1+elevationMeters*TERRAIN_VERTICAL_EXAGGERATION/MOON_RADIUS_METERS;
      position.setXYZ(index,x/sourceRadius*radius,y/sourceRadius*radius,z/sourceRadius*radius);
    }
    if(end<position.count)await new Promise<void>(resolve=>window.setTimeout(resolve,0));
  }
  position.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

void loadGlobalColorTexture();

function makeDemPatch(values:ArrayLike<number>,width:number,height:number,west:number,south:number,east:number,north:number,texture:THREE.Texture){
  if(!moonGroup||!moonReferenceRadius)throw new Error('Moon model is not ready for terrain data');
  if(!globalLdemGrid)throw new Error('LDEM16 baseline is not ready for terrain data');
  const positions=new Float32Array(width*height*3);
  const uvs=new Float32Array(width*height*2);
  const terrainWeights=new Float32Array(width*height);
  const longitudeSpan=east-west;
  const latitudeSpan=north-south;
  let validSamples=0;
  for(let row=0;row<height;row++){
    const lat=north-row/(height-1)*latitudeSpan;
    const latR=THREE.MathUtils.degToRad(lat);
    const cosLat=Math.cos(latR);
    for(let col=0;col<width;col++){
      const sample=values[row*width+col];
      if(!Number.isFinite(sample)||Math.abs(sample)>50_000){
        throw new Error('NASA elevation image contains missing or invalid samples');
      }
      validSamples++;
      const lon=west+col/(width-1)*longitudeSpan;
      const lonR=THREE.MathUtils.degToRad(lon);
      const u=col/(width-1);
      const v=row/(height-1);
      const edgeFade=THREE.MathUtils.smoothstep(Math.min(u,1-u,v,1-v),0,DEM_PATCH_FADE_FRACTION);
      const baselineElevation=sampleGlobalLdemMeters(lat,lon);
      if(baselineElevation===null)throw new Error('LDEM16 baseline is not ready for terrain data');
      const blendedElevation=(baselineElevation+(sample-baselineElevation)*edgeFade)*TERRAIN_VERTICAL_EXAGGERATION;
      const radius=moonReferenceRadius*(1+blendedElevation/MOON_RADIUS_METERS);
      const index=row*width+col;
      terrainWeights[index]=edgeFade;
      positions[index*3]=radius*cosLat*Math.sin(lonR);
      positions[index*3+1]=radius*Math.sin(latR);
      positions[index*3+2]=radius*cosLat*Math.cos(lonR);
      uvs[index*2]=(lon+180)/360;
      uvs[index*2+1]=(90-lat)/180;
    }
  }
  if(validSamples!==values.length)throw new Error('NASA elevation image is incomplete');

  const indices=new Uint32Array((width-1)*(height-1)*6);
  let offset=0;
  for(let row=0;row<height-1;row++){
    for(let col=0;col<width-1;col++){
      const topLeft=row*width+col;
      const bottomLeft=topLeft+width;
      const topRight=topLeft+1;
      const bottomRight=bottomLeft+1;
      indices[offset++]=topLeft;
      indices[offset++]=bottomLeft;
      indices[offset++]=topRight;
      indices[offset++]=topRight;
      indices[offset++]=bottomLeft;
      indices[offset++]=bottomRight;
    }
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geometry.setAttribute('moonGlobalUv',new THREE.BufferAttribute(uvs,2));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.computeVertexNormals();
  const normalAttribute=geometry.getAttribute('normal');
  for(let index=0;index<width*height;index++){
    const positionIndex=index*3;
    const radius=Math.hypot(positions[positionIndex],positions[positionIndex+1],positions[positionIndex+2]);
    const terrainWeight=terrainWeights[index];
    let nx=normalAttribute.getX(index)*terrainWeight+positions[positionIndex]/radius*(1-terrainWeight);
    let ny=normalAttribute.getY(index)*terrainWeight+positions[positionIndex+1]/radius*(1-terrainWeight);
    let nz=normalAttribute.getZ(index)*terrainWeight+positions[positionIndex+2]/radius*(1-terrainWeight);
    const normalLength=Math.hypot(nx,ny,nz);
    nx/=normalLength;
    ny/=normalLength;
    nz/=normalLength;
    normalAttribute.setXYZ(index,nx,ny,nz);
  }
  normalAttribute.needsUpdate=true;
  // Blend relief and normals into the procedural sphere at patch edges.
  const material=new THREE.MeshStandardMaterial({
    map:texture,
    transparent:false,
    depthWrite:true,
    // Let negative relief render over the smooth base sphere.
    depthTest:false,
  });
  configureMoonSurfaceMaterial(material,true);
  const patch=new THREE.Mesh(geometry,material);
  patch.renderOrder=1;
  patch.castShadow=false;
  patch.receiveShadow=false;
  return patch;
}

async function loadDemPatch(
  lat:number,
  lon:number,
  bounds:{west:number;south:number;east:number;north:number},
  imageryTileSide:number,
){
  if(!moonGroup||!moonReferenceRadius)return;
  const {west,south,east,north}=bounds;
  const span=east-west;
  const requestId=++demRequestId;
  demRequest?.abort();
  const controller=new AbortController();
  demRequest=controller;
  const timeoutId=window.setTimeout(()=>controller.abort(),DEM_FETCH_TIMEOUT_MS);
  let texture:THREE.Texture|null=null;
  emitDemStatus({status:'loading',lat,lon});
  try{
    if(east-west<=0||north-south<=0)throw new Error('Terrain area outside map bounds');

    clearLocalClrShadeTexture();
    const terrainTileSide=Math.max(1,Math.round(span/WAC_TILE_DEG));
    const localTexturePromise=loadLocalSurfaceOverlay(lat,lon,terrainTileSide,imageryTileSide);
    const demSource=getDemSource(bounds);
    const gridSize=THREE.MathUtils.clamp(
      Math.round(span*MOON_METERS_PER_DEGREE/DEM_TARGET_SAMPLE_METERS)+1,
      DEM_GRID_MIN,
      DEM_GRID_MAX,
    );
    const params=new URLSearchParams({
      bbox:`${west},${south},${east},${north}`,
      bboxSR:'104903',
      size:`${gridSize},${gridSize}`,
      imageSR:'104903',
      format:'tiff',
      pixelType:'F32',
      f:'image',
    });
    const response=await fetch(`${demSource.url}/exportImage?${params}`,{signal:controller.signal});
    if(!response.ok)throw new Error(`NASA elevation service returned HTTP ${response.status}`);
    const tiff=await fromArrayBuffer(await response.arrayBuffer());
    const image=await tiff.getImage();
    const raster=await image.readRasters({interleave:true});
    if(image.getWidth()!==gridSize||image.getHeight()!==gridSize){
      throw new Error('NASA elevation service returned an unexpected image size');
    }
    const sampleColumn=Math.round((lon-west)/(east-west)*(image.getWidth()-1));
    const sampleRow=Math.round((north-lat)/(north-south)*(image.getHeight()-1));
    const elevationMeters=Number(raster[sampleRow*image.getWidth()+sampleColumn]);
    if(!Number.isFinite(elevationMeters)){
      throw new Error('NASA elevation raster has no valid sample at the selected point');
    }
    if(requestId!==demRequestId||controller.signal.aborted)return;
    texture=makeSharedGlobalColorTexture();
    const patch=makeDemPatch(raster,image.getWidth(),image.getHeight(),west,south,east,north,texture);
    texture=null;
    if(requestId!==demRequestId||controller.signal.aborted){ disposeDemMesh(patch); return; }
    if(demPatch) disposeDemMesh(demPatch);
    demPatch=patch;
    moonGroup.add(patch);
    const resolutionMeters=span/(gridSize-1)*MOON_METERS_PER_DEGREE;
    emitDemStatus({
      status:'ready',
      lat,lon,elevationMeters,resolutionMeters,
      message:`${demSource.label} · ${localClrShadeEnabled?'LRO ClrShade':'LRO WAC'} detail imagery loading`,
    });
    const hasDetailImagery=await localTexturePromise;
    if(requestId!==demRequestId||controller.signal.aborted)return;
    emitDemStatus({
      status:'ready',
      lat,lon,elevationMeters,resolutionMeters,
      message:`${hasDetailImagery
        ?localClrShadeEnabled?`LRO ClrShade ${imageryTileSide}x${imageryTileSide} tiles`:`LRO WAC ${terrainTileSide}x${terrainTileSide} detail tiles`
        :localClrShadeEnabled?'LROC global color':'LRO WAC global surface'} + ${demSource.label}`,
    });
  }catch(error){
    if(controller.signal.aborted||requestId!==demRequestId)return;
    controller.abort();
    if(texture){
      const image=texture.image;
      const sharedImage=texture.userData.sharedImage===true;
      texture.dispose();
      if(!sharedImage&&image instanceof ImageBitmap)image.close();
    }
    const isTimeout=(error instanceof Error)&&error.name==='AbortError';
    const message=isTimeout
      ?`NASA Moon Trek timed out — no elevation data available offline`
      :(error instanceof Error?error.message:'Unknown error');
    console.warn('LOLA terrain unavailable:',error);
    emitDemStatus({status:'error',lat,lon,message});
  }finally{
    window.clearTimeout(timeoutId);
  }
}

function scheduleDemPatchUpdate(center?:{lat:number;lon:number}){
  if(!moonGroup)return;
  const localView=moonGroup.worldToLocal(camera.position.clone()).normalize();
  const lat=center?.lat??THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(localView.y,-1,1)));
  const lon=center?.lon??THREE.MathUtils.radToDeg(Math.atan2(localView.x,localView.z));
  const cameraDistance=moonCamera.distanceToTarget;
  // Keep larger overlapping DEM patches around the camera to reduce LOD edge swaps.
  const terrainTileSide=cameraDistance<0.25?3:cameraDistance<0.85?5:7;
  const imageryTileSide=cameraDistance<0.25?7:cameraDistance<0.85?11:21;
  const bounds=getDemPatchBounds(lat,lon,terrainTileSide);
  const span=bounds.east-bounds.west;
  const previous=lastDemRequest;
  if(previous){
    const longitudeDelta=THREE.MathUtils.euclideanModulo(lon-previous.lon+180,360)-180;
    const moved=Math.hypot(lat-previous.lat,longitudeDelta*Math.cos(THREE.MathUtils.degToRad(lat)));
    if(
      previous.terrainTileSide===terrainTileSide
      &&previous.imageryTileSide===imageryTileSide
      &&previous.west===bounds.west
      &&previous.south===bounds.south
      &&moved<span*0.2
    )return;
  }
  lastDemRequest={lat,lon,span,terrainTileSide,imageryTileSide,...bounds};
  if(demRefreshTimer!==null)window.clearTimeout(demRefreshTimer);
  demRefreshTimer=window.setTimeout(()=>{
    demRefreshTimer=null;
    void loadDemPatch(lat,lon,bounds,imageryTileSide);
  },DEM_REQUEST_DEBOUNCE_MS);
}

window.addEventListener('moonclick',(event:Event)=>{
  const detail=(event as CustomEvent<{name?:string;lat:number;lon:number}>).detail;
  if(Number.isFinite(detail?.lat)&&Number.isFinite(detail?.lon)){
    updateSunForSite(detail.name??'Lunar Surface',detail.lat,detail.lon);
  }
  scheduleDemPatchUpdate({lat:detail.lat,lon:detail.lon});
});
window.addEventListener('moonmove',(event:Event)=>{
  const detail=(event as CustomEvent<{lat:number;lon:number}>).detail;
  scheduleDemPatchUpdate(detail?{lat:detail.lat,lon:detail.lon}:undefined);
});
window.addEventListener('moonexit',clearDemPatch);
// --- Procedural Moon ---------------------------------------------------------
const moonGeometry=new THREE.SphereGeometry(1,2048,1024);
const spherePositions=moonGeometry.getAttribute('position');
const moonGlobalUvs=new Float32Array(spherePositions.count*2);
const spherePoint=new THREE.Vector3();
for(let i=0;i<spherePositions.count;i++){
  spherePoint.fromBufferAttribute(spherePositions,i);
  const radius=spherePoint.length();
  const latitude=Math.asin(THREE.MathUtils.clamp(spherePoint.y/radius,-1,1));
  const longitude=Math.atan2(spherePoint.x,spherePoint.z);
  moonGlobalUvs[i*2]=(longitude+Math.PI)/(Math.PI*2);
  moonGlobalUvs[i*2+1]=(Math.PI/2-latitude)/Math.PI;
}
moonGeometry.setAttribute('moonGlobalUv',new THREE.BufferAttribute(moonGlobalUvs,2));
const moonMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.9,metalness:0});
configureMoonSurfaceMaterial(moonMaterial,true);
const moon=new THREE.Mesh(moonGeometry,moonMaterial);
moon.castShadow=false;
moon.receiveShadow=false;
const moonPivot=new THREE.Group();
moonPivot.add(moon);
scene.add(moonPivot);
moonGroup=moonPivot;
moonReferenceRadius=1;
updateSunForCurrentTime();
void globalLdemPromise.then(async grid=>{
  if(!grid)return;
  try{
    await applyGlobalLdemToSphere(moonGeometry,grid);
    globalLdemGrid=grid;
    console.info('Global LDEM16 terrain applied to the procedural Moon');
    window.dispatchEvent(new CustomEvent('moonglobalterrain',{detail:{status:'ready'}}));
    if(moonCamera.distanceToTarget<2.5){
      lastDemRequest=null;
      scheduleDemPatchUpdate();
    }
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown LDEM16 displacement error';
    console.error('Global LDEM16 relief could not be applied:',error);
    window.dispatchEvent(new CustomEvent('moonglobalterrain',{detail:{status:'error',message}}));
  }
});
const loadingBar=document.getElementById('loading-bar');
const loadingLabel=document.getElementById('loading-label');
if(loadingBar)loadingBar.style.width='100%';
if(loadingLabel)loadingLabel.textContent='Lunar surface ready';
const loadingScreen=document.getElementById('loading-screen');
if(loadingScreen){
  loadingScreen.style.opacity='0';
  setTimeout(()=>{loadingScreen.style.display='none';},650);
}

// --- Post-processing ----------------------------------------------------------
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.15,0.4,0.8));
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
  const now=performance.now();
  const delta=Math.min((now-last)/1000,0.1);
  t+=delta;
  last=now;
  if(!simClock.get().playing)earthSphere.rotation.y+=delta*0.035;
  moonCamera.update();
  updateMoonStarMask();
  (layer2.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  (layer3.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  (layer4.material as THREE.ShaderMaterial).uniforms.uTime.value=t;
  composer.render();
}
animate();
