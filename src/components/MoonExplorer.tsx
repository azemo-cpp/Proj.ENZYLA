import { useState, useEffect, useRef } from 'react';
import { APOLLO_SITES } from '../data/apolloSites';

interface MoonClickDetail {
  name: string;
  lat: number;
  lon: number;
  type: string;
  elevationMeters?: number | null;
}

interface MoonDemDetail {
  status: 'loading' | 'ready' | 'error';
  lat: number;
  lon: number;
  elevationMeters?: number;
  resolutionMeters?: number;
  message?: string;
}

interface MoonLroMapDetail {
  image: CanvasImageSource;
  west: number;
  south: number;
  east: number;
  north: number;
  lat: number;
  lon: number;
  nativeTileCount: number;
  localTileCount: number;
  nasaTileCount: number;
  totalTiles: number;
}

const LRO_WAC_TILE_DEG = 2;
const LRO_WAC_TILE_PX = 606;
const LRO_WAC_MAP_SIDE = 1;
const missingLroWacTiles = new Set<string>();
const nasaWacTileBlobs = new Map<string, Promise<Blob>>();
let globalWacImage: Promise<ImageBitmap> | null = null;

function getLroWacTileBounds(lat: number, lon: number) {
  const latSW = Math.max(-90, Math.min(90 - LRO_WAC_TILE_DEG, Math.floor(lat / LRO_WAC_TILE_DEG) * LRO_WAC_TILE_DEG));
  const lonSW = Math.max(-180, Math.min(180 - LRO_WAC_TILE_DEG, Math.floor(lon / LRO_WAC_TILE_DEG) * LRO_WAC_TILE_DEG));
  return { west: lonSW, south: latSW, east: lonSW + LRO_WAC_TILE_DEG, north: latSW + LRO_WAC_TILE_DEG };
}

function lroWacTileName(lat: number, lon: number) {
  const { south: latSW, west: lonSW } = getLroWacTileBounds(lat, lon);
  const latH = latSW >= 0 ? 'N' : 'S';
  const lonH = lonSW >= 0 ? 'E' : 'W';
  return `${latH}${String(Math.abs(latSW)).padStart(2, '0')}${lonH}${String(Math.abs(lonSW)).padStart(3, '0')}`;
}

function getLroWacMapBounds(lat: number, lon: number) {
  const centerSouth = Math.floor(lat / LRO_WAC_TILE_DEG) * LRO_WAC_TILE_DEG;
  const centerWest = Math.floor(lon / LRO_WAC_TILE_DEG) * LRO_WAC_TILE_DEG;
  const extent = LRO_WAC_MAP_SIDE * LRO_WAC_TILE_DEG;
  const west = Math.max(-180, Math.min(180 - extent, centerWest - Math.floor(LRO_WAC_MAP_SIDE / 2) * LRO_WAC_TILE_DEG));
  const south = Math.max(-90, Math.min(90 - extent, centerSouth - Math.floor(LRO_WAC_MAP_SIDE / 2) * LRO_WAC_TILE_DEG));
  return { west, south, east: west + extent, north: south + extent };
}

async function loadGlobalWacImage() {
  if (!globalWacImage) {
    globalWacImage = fetch('/moon-wac-global.png', { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`LRO WAC base map returned HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => createImageBitmap(blob))
      .catch(error => {
        globalWacImage = null;
        throw error;
      });
  }
  return globalWacImage;
}

async function loadLocalWacTile(lat: number, lon: number) {
  const name = lroWacTileName(lat, lon);
  if (missingLroWacTiles.has(name)) return null;
  const response = await fetch(`/lro-wac-tiles/${name}.png`, { cache: 'force-cache' });
  if (response.status === 404) {
    missingLroWacTiles.add(name);
    return null;
  }
  if (!response.ok) throw new Error(`LRO WAC tile ${name} returned HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
    missingLroWacTiles.add(name);
    return null;
  }
  return createImageBitmap(await response.blob());
}

async function loadNasaWacTile(lat: number, lon: number) {
  const name = lroWacTileName(lat, lon);
  let blobPromise = nasaWacTileBlobs.get(name);
  if (!blobPromise) {
    const bounds = getLroWacTileBounds(lat, lon);
    const params = new URLSearchParams({
      bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
      bboxSR: '104903',
      imageSR: '104903',
      size: `${LRO_WAC_TILE_PX},${LRO_WAC_TILE_PX}`,
      format: 'png',
      f: 'image',
    });
    blobPromise = fetch(
      `/nasa-moon/trekarcgis/rest/services/LRO_WAC_Mosaic_Global_303ppd_v02/ImageServer/exportImage?${params}`,
      { cache: 'force-cache' },
    )
      .then(response => {
        if (!response.ok) throw new Error(`NASA LRO WAC tile ${name} returned HTTP ${response.status}`);
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
          throw new Error(`NASA LRO WAC tile ${name} was not returned as a PNG image`);
        }
        return response.blob();
      })
      .catch(error => {
        nasaWacTileBlobs.delete(name);
        throw error;
      });
    nasaWacTileBlobs.set(name, blobPromise);
  }
  return createImageBitmap(await blobPromise);
}

async function createLroWacMap(lat: number, lon: number): Promise<MoonLroMapDetail> {
  const bounds = getLroWacMapBounds(lat, lon);
  const cells = Array.from({ length: LRO_WAC_MAP_SIDE * LRO_WAC_MAP_SIDE }, (_, index) => {
    const row = Math.floor(index / LRO_WAC_MAP_SIDE);
    const column = index % LRO_WAC_MAP_SIDE;
    const tileSouth = bounds.south + (LRO_WAC_MAP_SIDE - row - 1) * LRO_WAC_TILE_DEG;
    const tileWest = bounds.west + column * LRO_WAC_TILE_DEG;
    return { row, column, lat: tileSouth + 1, lon: tileWest + 1 };
  });
  const loaded = await Promise.all(cells.map(async cell => {
    try {
      const localImage = await loadLocalWacTile(cell.lat, cell.lon);
      if (localImage) return { cell, image: localImage, source: 'local' as const };
    } catch (error) {
      console.warn('Could not load the local LRO WAC tile; trying NASA imagery.', error);
    }
    try {
      return { cell, image: await loadNasaWacTile(cell.lat, cell.lon), source: 'nasa' as const };
    } catch (error) {
      console.warn('Could not load the native-resolution NASA LRO WAC tile.', error);
      return { cell, image: null, source: null };
    }
  }));
  const localTileCount = loaded.filter(item => item.source === 'local').length;
  const nasaTileCount = loaded.filter(item => item.source === 'nasa').length;
  const nativeTileCount = localTileCount + nasaTileCount;
  let baseImage: ImageBitmap | null = null;
  if (nativeTileCount < cells.length) {
    try {
      baseImage = await loadGlobalWacImage();
    } catch (error) {
      if (nativeTileCount === 0) throw error;
      console.warn('LRO WAC global fallback unavailable; displaying native-resolution tiles only.', error);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = LRO_WAC_MAP_SIDE * LRO_WAC_TILE_PX;
  const context = canvas.getContext('2d');
  if (!context) {
    loaded.forEach(item => item.image?.close());
    throw new Error('Could not create a canvas for the LRO WAC detail map');
  }
  try {
    if (baseImage) {
      const sourceX = ((bounds.west + 180) / 360) * baseImage.width;
      const sourceY = ((90 - bounds.north) / 180) * baseImage.height;
      const sourceWidth = ((bounds.east - bounds.west) / 360) * baseImage.width;
      const sourceHeight = ((bounds.north - bounds.south) / 180) * baseImage.height;
      context.drawImage(baseImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    loaded.forEach(({ cell, image }) => {
      if (image) context.drawImage(image, cell.column * LRO_WAC_TILE_PX, cell.row * LRO_WAC_TILE_PX, LRO_WAC_TILE_PX, LRO_WAC_TILE_PX);
    });
  } finally {
    loaded.forEach(item => item.image?.close());
  }
  if (nativeTileCount === 0 && !baseImage) throw new Error('No LRO WAC imagery is available for this location');
  return { image: canvas, ...bounds, lat, lon, nativeTileCount, localTileCount, nasaTileCount, totalTiles: cells.length };
}

interface MoonGlobalImageryDetail {
  status: 'loading' | 'coarse' | 'ready' | 'error';
  message?: string;
}

interface MoonGlobalTerrainDetail {
  status: 'loading' | 'ready' | 'error';
  message?: string;
}

// Real NASA documentation text per Apollo site — sourced from NASA History Division
const SITE_DOCS: Record<string, {
  summary: string;
  coordinates: string;
  significance: string;
  geology: string;
  activities: { title: string; desc: string }[];
}> = {
  'Apollo 11': {
    summary: 'First crewed lunar landing. The Eagle lunar module touched down on July 20, 1969 at 20:17 UTC. Neil Armstrong and Buzz Aldrin spent 2 hours 31 minutes on the surface.',
    coordinates: '0.6741° N, 23.4723° E · Mare Tranquillitatis',
    significance: 'First human footsteps on another world. The site demonstrated that the lunar surface could support a spacecraft and crew.',
    geology: 'Relatively flat mare basalt plain with a thin regolith layer. Low crater density. Basalt samples dated at 3.7 billion years.',
    activities: [
      { title: 'Solar Wind Composition', desc: 'Aluminum foil sheet deployed to capture solar wind particles for isotopic analysis back on Earth.' },
      { title: 'Passive Seismometer', desc: 'First seismic instrument on the Moon — recorded moonquakes and meteorite impacts until 1971.' },
      { title: 'Laser Ranging', desc: 'Retroreflector array still used today to measure the Moon\'s distance to millimeter precision.' },
      { title: 'Sample Collection', desc: '21.5 kg of basalt and regolith returned — including Sample 10003, the first documented lunar rock.' },
    ],
  },
  'Apollo 12': {
    summary: 'Second crewed lunar landing and first precision landing. Pete Conrad and Alan Bean landed November 19, 1969, within 163 m of the unmanned Surveyor 3 probe.',
    coordinates: '3.0128° S, 23.4219° W · Oceanus Procellarum',
    significance: 'Demonstrated pinpoint landing capability. Retrieval of Surveyor 3 hardware revealed effects of 31 months of lunar exposure.',
    geology: 'Younger mare basalt than Apollo 11 — samples dated 3.15–3.2 Ga. Higher titanium content than expected.',
    activities: [
      { title: 'Surveyor 3 Retrieval', desc: 'Camera and soil sampler retrieved from the Surveyor 3 probe — 31 months of lunar exposure studied.' },
      { title: 'ALSEP Package', desc: 'Apollo Lunar Surface Experiments Package — 5 instruments returned data for 8 years after landing.' },
      { title: 'Dual EVAs', desc: 'Two surface traversals covering the Snowman crater region and the ALSEP deployment site.' },
      { title: 'Core Sampling', desc: 'First deep core samples — 4 cores to 60 cm depth revealing stratigraphy of the regolith.' },
    ],
  },
  'Apollo 14': {
    summary: 'Third crewed lunar landing at Fra Mauro highlands — ejecta blanket from the Imbrium basin impact. Alan Shepard and Edgar Mitchell landed February 5, 1971.',
    coordinates: '3.6453° S, 17.4714° W · Fra Mauro Formation',
    significance: 'First landing in the lunar highlands. Fra Mauro breccias are fragments of the giant Imbrium impact — among the oldest sampled lunar material.',
    geology: 'Fra Mauro Formation: impact melt breccia from the Imbrium basin. Some samples date to 3.9 Ga — near the Late Heavy Bombardment period.',
    activities: [
      { title: 'Cone Crater Traverse', desc: 'Crew reached the rim of 340 m Cone Crater, sampling Imbrium ejecta excavated from depth.' },
      { title: 'Active Seismic', desc: 'Explosive charges detonated to profile the lunar subsurface structure — revealed 8.5 m regolith layer.' },
      { title: 'Golf Shot', desc: 'Alan Shepard hit two golf balls with a makeshift 6-iron. Estimated distance: several hundred meters.' },
      { title: 'Sample 14321', desc: '"Big Bertha" — a 9 kg breccia containing Earth-origin material, the oldest lunar sample at ~4.0 Ga.' },
    ],
  },
  'Apollo 15': {
    summary: 'First J-class long-duration mission. David Scott and James Irwin landed at Hadley-Apennine July 30, 1971. First use of the Lunar Roving Vehicle.',
    coordinates: '26.1322° N, 3.6339° E · Hadley–Apennine',
    significance: 'Most scientifically productive landing to that date. The Genesis Rock — pristine anorthosite from the original lunar crust — changed understanding of lunar formation.',
    geology: 'Valley floor of mare basalt adjacent to 3.5 km tall Apennine mountains and the 1.5 km wide Hadley Rille sinuous lava channel.',
    activities: [
      { title: 'Genesis Rock', desc: 'Sample 15415: pure anorthosite, 4.1 billion years old — a piece of the original lunar crust from the magma ocean era.' },
      { title: 'Hadley Rille', desc: 'Ancient sinuous lava channel 1.5 km wide and 300 m deep — explored by rover to the rim, revealing layered basalt walls.' },
      { title: 'Deep Drill Core', desc: '2.4 m core revealed 57 distinct layers of regolith — a record of impacts spanning 500 million years.' },
      { title: 'Rover Traverse', desc: 'LRV covered 27.9 km across three EVAs — enabling exploration far beyond walking range.' },
    ],
  },
  'Apollo 16': {
    summary: 'Only mission to sample ancient highland crust. John Young and Charles Duke landed April 21, 1972 in the Descartes Highlands — the highest-altitude Apollo landing.',
    coordinates: '8.9730° S, 15.4986° E · Descartes Highlands',
    significance: 'Disproved the pre-mission theory that the highlands were volcanic. The terrain proved to be ancient impact breccia, not lava flows.',
    geology: 'Ancient anorthosite highland crust, heavily cratered. Cayley Plains and Descartes Formation are both impact-generated, not volcanic as predicted.',
    activities: [
      { title: 'House Rock', desc: 'Largest boulder sampled in Apollo program — a 4×7 m breccia block at Station 11, containing 7 rock types.' },
      { title: 'North Ray Crater', desc: 'Youngest crater visited in Apollo program — ~50 million years old. Crew sampled pristine highland material from its walls.' },
      { title: 'ALSEP Magnetometer', desc: 'Measured a strong local magnetic anomaly — evidence of ancient lunar magnetic field captured in crust.' },
      { title: 'Rover Distance Record', desc: '26.7 km total traverse — the longest Apollo rover distance record at the time.' },
    ],
  },
  'Apollo 17': {
    summary: 'Final crewed Moon landing and only mission with a professional geologist. Gene Cernan and Harrison Schmitt landed December 11, 1972 in Taurus-Littrow valley.',
    coordinates: '20.1908° N, 30.7717° E · Taurus-Littrow Valley',
    significance: 'Returned the most diverse and most mass of any Apollo mission. Discovery of orange volcanic glass proved a recent pyroclastic event at 3.7 Ga.',
    geology: 'Valley floor of mare basalt flanked by massifs of ancient highland material. Orange volcanic glass at Shorty Crater is the only confirmed pyroclastic deposit in Apollo samples.',
    activities: [
      { title: 'Orange Soil Discovery', desc: 'Harrison Schmitt spotted orange glass beads at Shorty Crater — volcanic fire-fountain glass from 3.7 Ga pyroclastic eruption.' },
      { title: 'South Massif', desc: 'Crew sampled the massif flank — ancient highland anorthosite older than 4 Ga, contrasting with the young valley basalt.' },
      { title: 'TAN Gravimeter', desc: 'Traverse Gravimeter measured subsurface density variations — revealed structure of lava flows beneath the valley.' },
      { title: 'Final Footsteps', desc: 'Cernan\'s last words: "We leave as we came, and God willing, as we shall return, with peace and hope for all mankind."' },
    ],
  },
};

export default function MoonExplorer() {
  const [visible, setVisible]     = useState(false);
  const [siteName, setSiteName]   = useState('');
  const [siteType, setSiteType]   = useState('');
  const [siteLocation, setSiteLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [selectedAct, setAct]     = useState<number | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [demStatus, setDemStatus] = useState<MoonDemDetail['status'] | 'idle'>('idle');
  const [demElevation, setDemElevation] = useState<number | null>(null);
  const [demResolution, setDemResolution] = useState<number | null>(null);
  const [demMessage, setDemMessage] = useState('');
  const [globalImageryStatus, setGlobalImageryStatus] = useState<MoonGlobalImageryDetail['status']>('loading');
  const [globalImageryMessage, setGlobalImageryMessage] = useState('');
  const [globalTerrainStatus, setGlobalTerrainStatus] = useState<MoonGlobalTerrainDetail['status']>('loading');
  const [globalTerrainMessage, setGlobalTerrainMessage] = useState('');
  const [showClrShade, setShowClrShade] = useState(true);
  const [show2DMap, setShow2DMap] = useState(false);
  const [lroMapCenter, setLroMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [lroMap, setLroMap] = useState<MoonLroMapDetail | null>(null);
  const [lroMapLoading, setLroMapLoading] = useState(false);
  const [lroMapError, setLroMapError] = useState('');
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    function onIn(e: Event) {
      const d = (e as CustomEvent<MoonClickDetail>).detail;
      const name = d?.name ?? '';
      setSiteName(name);
      setSiteType(d?.type ?? '');
      setSiteLocation(d ? { lat: d.lat, lon: d.lon } : null);
      setVisible(true);
      setShowPanel(true);
      setShow2DMap(true);
      setLroMapCenter({ lat: d.lat, lon: d.lon });
      setLroMap(null);
      setLroMapError('');
      setAct(null);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    }
    function onOut() {
      setVisible(false);
      setShowPanel(false);
      setShow2DMap(false);
      setLroMapCenter(null);
      setLroMap(null);
      setLroMapLoading(false);
      setLroMapError('');
      setAct(null);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    }
    function onDem(e: Event) {
      const d = (e as CustomEvent<MoonDemDetail>).detail;
      if (!d) return;
      setDemStatus(d.status);
      setDemElevation(d.elevationMeters ?? null);
      setDemResolution(d.resolutionMeters ?? null);
      setDemMessage(d.message ?? '');
    }
    function onGlobalImagery(e: Event) {
      const d = (e as CustomEvent<MoonGlobalImageryDetail>).detail;
      if (!d) return;
      setGlobalImageryStatus(d.status);
      setGlobalImageryMessage(d.message ?? '');
    }
    function onGlobalTerrain(e: Event) {
      const d = (e as CustomEvent<MoonGlobalTerrainDetail>).detail;
      if (!d) return;
      setGlobalTerrainStatus(d.status);
      setGlobalTerrainMessage(d.message ?? '');
    }
    window.addEventListener('moonclick', onIn);
    window.addEventListener('moonexit',  onOut);
    window.addEventListener('moondem', onDem);
    window.addEventListener('moonglobalimagery', onGlobalImagery);
    window.addEventListener('moonglobalterrain', onGlobalTerrain);
    return () => {
      window.removeEventListener('moonclick', onIn);
      window.removeEventListener('moonexit',  onOut);
      window.removeEventListener('moondem', onDem);
      window.removeEventListener('moonglobalimagery', onGlobalImagery);
      window.removeEventListener('moonglobalterrain', onGlobalTerrain);
    };
  }, []);

  useEffect(() => {
    if (!visible || !show2DMap || !lroMapCenter) return;
    let active = true;
    setLroMapLoading(true);
    setLroMapError('');
    createLroWacMap(lroMapCenter.lat, lroMapCenter.lon)
      .then(map => {
        if (active) setLroMap(map);
      })
      .catch(error => {
        if (!active) return;
        console.error('Could not load the local LRO WAC detail map:', error);
        setLroMapError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLroMapLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lroMapCenter, show2DMap, visible]);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (lroMap) {
      context.imageSmoothingEnabled = true;
      context.drawImage(lroMap.image, 0, 0, canvas.width, canvas.height);
    }
  }, [lroMap, show2DMap, visible]);

  const doc = SITE_DOCS[siteName];
  const apolloSite = APOLLO_SITES.find(s => s.name === siteName);
  const coordinates = doc?.coordinates ?? (siteLocation
    ? `${Math.abs(siteLocation.lat).toFixed(4)}° ${siteLocation.lat < 0 ? 'S' : 'N'}, ${Math.abs(siteLocation.lon).toFixed(4)}° ${siteLocation.lon < 0 ? 'W' : 'E'}`
    : null);

  return (
    <>
      {/* ── Site name — centered bottom, above timeline ── */}
      <div className="moon-site-title" style={{
        position: 'fixed', bottom: 72, left: '50%',
        transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s, transform 0.5s',
        pointerEvents: 'none', zIndex: 11,
        textAlign: 'center',
        width: 'min(92vw, 640px)',
      }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
          {doc || apolloSite ? 'Apollo Landing Site' : siteType || 'Lunar Surface'}
        </div>
        <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: '0.03em', textTransform: 'uppercase', lineHeight: 1, color: '#fff' }}>
          {siteName || 'Lunar Surface'}
        </div>
        {coordinates && (
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.45)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {coordinates}
          </div>
        )}
        {visible && (
          <div aria-live="polite" style={{ fontSize: 10, lineHeight: 1.5, color: 'rgba(255,255,255,0.7)', marginTop: 7 }}>
            {demStatus === 'loading'
              ? 'Loading NASA LOLA elevation...'
              : demStatus === 'ready'
                ? `NASA LOLA ${demElevation != null ? `${demElevation >= 0 ? '+' : ''}${Math.round(demElevation).toLocaleString()} m · ` : ''}${demResolution != null ? `${Math.round(demResolution).toLocaleString()} m spacing · ` : ''}LROC base texture · ${demMessage || 'active'}`
                : demStatus === 'error'
                  ? `NASA Moon Trek terrain unavailable: ${demMessage}`
                  : globalImageryStatus === 'error'
                    ? `LROC color map unavailable: ${globalImageryMessage}`
                    : globalTerrainStatus === 'error'
                      ? `LDEM16 terrain unavailable: ${globalTerrainMessage}`
                      : globalTerrainStatus === 'loading'
                        ? 'Loading LDEM16 global relief...'
                        : globalImageryStatus === 'loading'
                          ? 'Loading LROC global color...'
                          : globalImageryStatus === 'coarse'
                            ? 'LROC base loaded; refining 8K color...'
                            : `LROC base texture · Color Relief ${showClrShade ? 'On' : 'Off'} · LDEM16 terrain; Moon Trek LOLA detail on zoom`}
          </div>
        )}
        {visible && (
          <>
            <button
              type="button"
              aria-label="Toggle LRO ClrShade color overlay"
              aria-pressed={showClrShade}
              onClick={() => {
                const enabled = !showClrShade;
                setShowClrShade(enabled);
                window.dispatchEvent(new CustomEvent('moonclrshadevisibilitychange', { detail: { enabled } }));
              }}
              style={{
                pointerEvents: 'auto',
                marginTop: 8,
                padding: '6px 12px',
                border: '1px solid rgba(255,255,255,0.3)',
                background: showClrShade ? 'rgba(30,120,125,0.65)' : 'rgba(0,0,0,0.65)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              LRO Color Relief · {showClrShade ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              aria-label="Toggle 2D LRO detail map"
              aria-pressed={show2DMap}
              onClick={() => setShow2DMap(!show2DMap)}
              style={{
                pointerEvents: 'auto',
                marginTop: 8,
                marginLeft: 6,
                padding: '6px 12px',
                border: '1px solid rgba(255,255,255,0.3)',
                background: show2DMap ? 'rgba(30,120,125,0.65)' : 'rgba(0,0,0,0.65)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              2D LRO Tiles · {show2DMap ? 'On' : 'Off'}
            </button>
          </>
        )}
      </div>

      {visible && show2DMap && (
        <aside
          className="lro-wac-map-window"
          aria-label="2D LRO WAC detail map"
          style={{
            position: 'fixed',
            top: 72,
            right: 18,
            width: 'min(320px, 42vw)',
            zIndex: 21,
            padding: 10,
            background: 'rgba(0,0,0,0.86)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff',
            pointerEvents: 'auto',
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
            LRO WAC Detail Map · {lroMap
              ? lroMap.nativeTileCount === lroMap.totalTiles ? 'Native Resolution' : 'Global fallback'
              : 'Loading'}
          </div>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: 'rgba(255,255,255,0.06)' }}>
            <canvas
              ref={mapCanvasRef}
              width={606}
              height={606}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
            {lroMap && (
              <span
                aria-label="Selected lunar location"
                style={{
                  position: 'absolute',
                  left: `${((lroMap.lon - lroMap.west) / (lroMap.east - lroMap.west)) * 100}%`,
                  top: `${((lroMap.north - lroMap.lat) / (lroMap.north - lroMap.south)) * 100}%`,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  border: '1px solid #fff',
                  background: '#ff5d3d',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}
            {!lroMap && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                {lroMapLoading ? 'Loading native-resolution LRO WAC imagery…' : lroMapError || 'No LRO WAC image loaded'}
              </div>
            )}
          </div>
          {lroMap && (
            <div style={{ fontSize: 10, lineHeight: 1.55, color: 'rgba(255,255,255,0.75)', marginTop: 7 }}>
              {lroMap.south.toFixed(1)}° to {lroMap.north.toFixed(1)}° · {lroMap.west.toFixed(1)}° to {lroMap.east.toFixed(1)}°
              <br />
              {lroMap.nativeTileCount}/{lroMap.totalTiles} native-resolution LRO WAC tiles · {lroMap.localTileCount} local, {lroMap.nasaTileCount} NASA · 2°×2° focus
            </div>
          )}
        </aside>
      )}

      {/* ── Left info panel ── */}
      {showPanel && doc && (
        <div className="moon-mission-panel" style={{
          position: 'fixed', left: 24, top: '50%',
          transform: 'translateY(-50%)',
          width: 300, zIndex: 20, pointerEvents: 'auto',
          animation: 'fadeSlideIn 0.4s ease',
        }}>
          {/* Mission summary */}
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '16px 18px',
            marginBottom: 2,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
              Mission Summary
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,0.75)', margin: 0 }}>
              {doc.summary}
            </p>
          </div>

          {/* Geology */}
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderTop: 'none',
            padding: '12px 18px',
            marginBottom: 2,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              Geology
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.65, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
              {doc.geology}
            </p>
          </div>

          {/* Activities — clickable rows */}
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderTop: 'none',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', padding: '10px 18px 6px' }}>
              Key Activities
            </div>
            {doc.activities.map((a, i) => (
              <button
                key={a.title}
                type="button"
                onClick={() => setAct(selectedAct === i ? null : i)}
                style={{
                  width: '100%', textAlign: 'left',
                  background: selectedAct === i ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                  padding: '10px 18px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (selectedAct !== i) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (selectedAct !== i) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                aria-expanded={selectedAct === i}
                aria-label={a.title}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff' }}>
                    {a.title}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginLeft: 8, transition: 'transform 0.15s', transform: selectedAct === i ? 'rotate(180deg)' : 'none' }}>
                    ↓
                  </span>
                </div>
                {selectedAct === i && (
                  <p style={{ fontSize: 12, lineHeight: 1.65, color: 'rgba(255,255,255,0.65)', margin: '8px 0 0', animation: 'fadeIn 0.2s ease' }}>
                    {a.desc}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Mission metrics */}
          {apolloSite && (
            <div style={{
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderTop: 'none',
              padding: '12px 18px',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px',
            }}>
              {[
                { l: 'Year',     v: apolloSite.year },
                { l: 'Samples',  v: apolloSite.samples },
                { l: 'EVA',      v: apolloSite.duration },
                { l: 'Elev.',    v: apolloSite.elevStr },
              ].map(m => (
                <div key={m.l}>
                  <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 3 }}>{m.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Non-Apollo location — minimal overlay */}
      {showPanel && !show2DMap && !doc && siteName && (
        <div className="moon-feature-panel" style={{
          position: 'fixed', left: 24, top: '50%',
          transform: 'translateY(-50%)',
          width: 260, zIndex: 20, pointerEvents: 'auto',
          background: 'rgba(0,0,0,0.85)',
          border: '1px solid rgba(255,255,255,0.12)',
          padding: '16px 18px',
          animation: 'fadeSlideIn 0.4s ease',
        }}>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
            Lunar Feature
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, textTransform: 'uppercase', color: '#fff', marginBottom: 10 }}>
            {siteName}
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
            Click an Apollo landing site from the timeline below to view mission documentation and surface data.
          </p>
        </div>
      )}

      <style>{`
        @media (max-width: 700px) {
          .lro-wac-map-window {
            top: 64px !important;
            right: 12px !important;
            width: min(220px, 35vw) !important;
            padding: 8px !important;
          }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-50%) translateX(-12px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}
