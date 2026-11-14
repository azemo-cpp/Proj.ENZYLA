import { useState, useEffect } from 'react';
import Navbar from './components/navbar';
import HUD from './components/hud';
import MoonExplorer from './components/moonExplorer';
import SiteTimeline from './components/siteTimeline';
import DarylChat from './components/darylChat';

interface MoonClickDetail { name: string; lat: number; lon: number; type: string; }

export default function App() {
  const [activeSite, setActiveSite] = useState('Apollo 11');

  // Sync activeSite with whatever the user zoomed into
  useEffect(() => {
    function onZoomIn(e: Event) {
      const d = (e as CustomEvent<MoonClickDetail>).detail;
      if (d?.name && d.name !== 'Lunar Surface') setActiveSite(d.name);
    }
    function onZoomOut() {
      setActiveSite('');
    }
    window.addEventListener('moonclick', onZoomIn);
    window.addEventListener('moonexit', onZoomOut);
    return () => {
      window.removeEventListener('moonclick', onZoomIn);
      window.removeEventListener('moonexit', onZoomOut);
    };
  }, []);

  function handleTimelineSelect(name: string, lat: number, lon: number) {
    setActiveSite(name);
    (window as any).zoomToSite?.(lat, lon, name);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <Navbar />
      <HUD />
      <MoonExplorer />
      <SiteTimeline activeSite={activeSite} onSelect={handleTimelineSelect} />
      <DarylChat activeSite={activeSite} />
    </div>
  );
}
