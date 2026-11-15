import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import HUD from './components/HUD';
import MoonExplorer from './components/MoonExplorer';
import SiteTimeline from './components/SiteTimeline';
import TemporalPanel from './components/TemporalPanel';
import DarylChat from './components/DarylChat';
import { APOLLO_SITES } from './data/apolloSites';
import type { SiteCoords } from './lib/ephemeris';

interface MoonClickDetail { name: string; lat: number; lon: number; type: string; }

const coordsFor = (name: string, lat: number, lon: number): SiteCoords => {
  const a = APOLLO_SITES.find(s => s.name === name); // prefer the precise catalogue coordinates
  return a ? { name, lat: a.lat, lon: a.lon } : { name, lat, lon };
};

export default function App() {
  const [activeSite, setActiveSite] = useState('Apollo 11');
  const [site, setSite] = useState<SiteCoords | null>(() => coordsFor('Apollo 11', 0, 0));

  // Sync with whatever the user zoomed into
  useEffect(() => {
    function onZoomIn(e: Event) {
      const d = (e as CustomEvent<MoonClickDetail>).detail;
      if (d?.name && d.name !== 'Lunar Surface') { setActiveSite(d.name); setSite(coordsFor(d.name, d.lat, d.lon)); }
    }
    function onZoomOut() { setActiveSite(''); setSite(null); }
    window.addEventListener('moonclick', onZoomIn);
    window.addEventListener('moonexit', onZoomOut);
    return () => { window.removeEventListener('moonclick', onZoomIn); window.removeEventListener('moonexit', onZoomOut); };
  }, []);

  function handleTimelineSelect(name: string, lat: number, lon: number) {
    setActiveSite(name);
    setSite(coordsFor(name, lat, lon));
    (window as any).zoomToSite?.(lat, lon, name);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <Navbar />
      <HUD />
      <MoonExplorer />
      <SiteTimeline activeSite={activeSite} site={site} onSelect={handleTimelineSelect} />
      <TemporalPanel site={site} />
      <DarylChat activeSite={activeSite} />
    </div>
  );
}
