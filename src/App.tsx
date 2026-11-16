import { useState, useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import Navbar from './components/Navbar';
import MoonExplorer from './components/MoonExplorer';
import SiteTimeline from './components/SiteTimeline';
import DarylChat from './components/DarylChat';
import TemporalPanel from './components/TemporalPanel';
import ComparePanel from './components/ComparePanel';
import { APOLLO_SITES, type SiteLocation } from './data/apolloSites';
import {
  downloadLandingSite,
  loadCustomLandingSites,
  parseImportedLandingSites,
  saveCustomLandingSites,
  type CustomLandingSite,
} from './data/customSites';
import type { SiteCoords } from './lib/ephemeris';

interface MoonClickDetail { name: string; lat: number; lon: number; type: string; }
interface AddSiteDetail { lat: number; lon: number; }
interface MoonSceneActions {
  zoomToSite?: (lat: number, lon: number, name: string) => void;
  zoomOut?: () => void;
  updateSunForSite?: (name: string, lat: number, lon: number) => void;
}

export default function App() {
  const [activeSite, setActiveSite] = useState('Apollo 11');
  const [isZoomed, setIsZoomed] = useState(false);
  const [customSites, setCustomSites] = useState<CustomLandingSite[]>([]);
  const [pendingSite, setPendingSite] = useState<AddSiteDetail | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteLat, setNewSiteLat] = useState('');
  const [newSiteLon, setNewSiteLon] = useState('');
  const [siteManagerOpen, setSiteManagerOpen] = useState(false);
  const [siteNotice, setSiteNotice] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);
  const importFileInput = useRef<HTMLInputElement>(null);
  const [temporalSite, setTemporalSite] = useState<SiteCoords | null>(() => {
    const site = APOLLO_SITES.find(item => item.name === 'Apollo 11');
    return site ? { name: site.name, lat: site.lat, lon: site.lon } : null;
  });
  const sites: SiteLocation[] = [...APOLLO_SITES, ...customSites];

  useEffect(() => {
    try {
      setCustomSites(loadCustomLandingSites());
    } catch (error) {
      console.error('Could not load saved lunar landing sites:', error);
      setSiteNotice(`Could not load saved landing sites: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mooncustomsiteschange', { detail: customSites }));
  }, [customSites]);

  // Keep the selected site and horizon coordinates in sync with scene zoom.
  useEffect(() => {
    function onZoomIn(e: Event) {
      const d = (e as CustomEvent<MoonClickDetail>).detail;
      if (d?.name && d.name !== 'Lunar Surface') {
        setIsZoomed(true);
        setActiveSite(d.name);
        setTemporalSite({ name: d.name, lat: d.lat, lon: d.lon });
      }
    }
    function onZoomOut() {
      setIsZoomed(false);
    }
    window.addEventListener('moonclick', onZoomIn);
    window.addEventListener('moonexit', onZoomOut);
    return () => {
      window.removeEventListener('moonclick', onZoomIn);
      window.removeEventListener('moonexit', onZoomOut);
    };
  }, []);

  useEffect(() => {
    function onAddSite(event: Event) {
      const detail = (event as CustomEvent<AddSiteDetail>).detail;
      if (!detail || !Number.isFinite(detail.lat) || !Number.isFinite(detail.lon)) return;
      setPendingSite({ lat: detail.lat, lon: detail.lon });
      setNewSiteName('');
      setNewSiteLat(detail.lat.toFixed(4));
      setNewSiteLon(detail.lon.toFixed(4));
      setSiteManagerOpen(false);
      setSiteNotice('');
    }
    window.addEventListener('moonaddsite', onAddSite);
    return () => window.removeEventListener('moonaddsite', onAddSite);
  }, []);

  function handleTimelineSelect(name: string, lat: number, lon: number) {
    setActiveSite(name);
    setTemporalSite({ name, lat, lon });
    (window as Window & MoonSceneActions).zoomToSite?.(lat, lon, name);
  }

  function handleAddSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingSite) return;

    const name = newSiteName.trim();
    if (!name) {
      setSiteNotice('Enter a name for this landing site.');
      return;
    }
    const lat = Number(newSiteLat);
    const lon = Number(newSiteLon);
    if (!newSiteLat.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      setSiteNotice('Latitude must be between -90 and 90.');
      return;
    }
    if (!newSiteLon.trim() || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setSiteNotice('Longitude must be between -180 and 180.');
      return;
    }
    if (sites.some(site => site.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setSiteNotice('A landing site with that name already exists.');
      return;
    }

    const site: CustomLandingSite = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      lat,
      lon,
    };
    const nextCustomSites = [...customSites, site];

    try {
      saveCustomLandingSites(nextCustomSites);
    } catch (error) {
      console.error('Could not save the custom lunar landing site in this browser:', error);
      setSiteNotice(`Could not save this site in browser storage: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setCustomSites(nextCustomSites);
    setPendingSite(null);
    setNewSiteName('');
    setNewSiteLat('');
    setNewSiteLon('');
    setSiteNotice(`Added ${name}.`);
    const actions = window as Window & MoonSceneActions;
    actions.updateSunForSite?.(name, site.lat, site.lon);
    actions.zoomToSite?.(site.lat, site.lon, name);
  }

  function handleOpenAddSite() {
    setSiteManagerOpen(false);
    setPendingSite({ lat: 0, lon: 0 });
    setNewSiteName('');
    setNewSiteLat('');
    setNewSiteLon('');
    setSiteNotice('');
  }

  function handleRemoveCustomSite(site: CustomLandingSite) {
    if (!window.confirm(`Remove "${site.name}" from your saved landing sites?`)) return;
    const nextCustomSites = customSites.filter(item => item.id !== site.id);
    try {
      saveCustomLandingSites(nextCustomSites);
    } catch (error) {
      console.error('Could not remove the custom lunar landing site from browser storage:', error);
      setSiteNotice(`Could not remove ${site.name}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setCustomSites(nextCustomSites);
    setSiteNotice(`Removed ${site.name}.`);
    if (activeSite === site.name) {
      const defaultSite = APOLLO_SITES[0];
      setActiveSite(defaultSite.name);
      setTemporalSite({ name: defaultSite.name, lat: defaultSite.lat, lon: defaultSite.lon });
      const actions = window as Window & MoonSceneActions;
      actions.updateSunForSite?.(defaultSite.name, defaultSite.lat, defaultSite.lon);
      actions.zoomOut?.();
    }
  }

  async function handleImportSites(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    try {
      const imported = [];
      for (const file of files) {
        imported.push(...parseImportedLandingSites(await file.text()));
      }

      const knownNames = new Set(
        [...APOLLO_SITES, ...customSites].map(site => site.name.toLocaleLowerCase()),
      );
      const additions: CustomLandingSite[] = [];
      let duplicates = 0;
      for (const site of imported) {
        const key = site.name.toLocaleLowerCase();
        if (knownNames.has(key)) {
          duplicates += 1;
          continue;
        }
        knownNames.add(key);
        additions.push({ ...site, id: `custom-${crypto.randomUUID()}` });
      }

      if (additions.length > 0) {
        const nextCustomSites = [...customSites, ...additions];
        saveCustomLandingSites(nextCustomSites);
        setCustomSites(nextCustomSites);
      }
      setSiteNotice(
        `Imported ${additions.length} site${additions.length === 1 ? '' : 's'}`
        + (duplicates > 0 ? `; skipped ${duplicates} duplicate${duplicates === 1 ? '' : 's'}.` : '.'),
      );
    } catch (error) {
      console.error('Could not import landing site JSON:', error);
      setSiteNotice(`Could not import JSON: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = '';
    }
  }

  function handleDownloadSite(site: SiteLocation) {
    try {
      downloadLandingSite(site);
    } catch (error) {
      console.error(`Could not download the JSON for ${site.name}:`, error);
      setSiteNotice(`Could not download ${site.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <Navbar />
      <MoonExplorer />
      <TemporalPanel site={temporalSite} hidden={compareOpen} />
      <ComparePanel activeSite={activeSite} open={compareOpen} onOpenChange={setCompareOpen} />
      <SiteTimeline
        activeSite={activeSite}
        sites={sites}
        showDashboard={!isZoomed}
        onSelect={handleTimelineSelect}
        onManage={() => {
          setSiteNotice('');
          setSiteManagerOpen(true);
        }}
      />
      <DarylChat activeSite={activeSite} />
      {siteManagerOpen && (
        <div className="site-manager-backdrop" style={{
          position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'auto',
          display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.72)',
          padding: 16,
        }}>
          <section
            className="site-manager-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-manager-title"
            onKeyDown={event => {
              if (event.key === 'Escape') setSiteManagerOpen(false);
            }}
            style={{
              width: 'min(94vw, 620px)', maxHeight: '85vh', overflow: 'auto',
              padding: 22, color: '#fff', background: '#090b10',
              border: '1px solid rgba(255,255,255,0.25)', display: 'grid', gap: 16,
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div id="site-manager-title" style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Manage landing sites
                </div>
                <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                  Built-in sites are protected; you can remove your custom sites.
                </div>
              </div>
              <button type="button" className="tp-pill" onClick={() => setSiteManagerOpen(false)}>Close</button>
            </header>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="tp-pill" onClick={handleOpenAddSite}>Add site</button>
              <button type="button" className="tp-pill" onClick={() => importFileInput.current?.click()}>
                Import JSON
              </button>
              <input
                ref={importFileInput}
                type="file"
                accept=".json,application/json"
                multiple
                onChange={handleImportSites}
                style={{ display: 'none' }}
              />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
                Built-in sites
              </div>
              {APOLLO_SITES.map(site => (
                <div key={site.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  padding: '9px 10px', background: 'rgba(255,255,255,0.04)',
                }}>
                  <span>{site.name}</span>
                  <button type="button" className="tp-pill" onClick={() => handleDownloadSite(site)}>
                    Download {site.name} JSON
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
                Custom sites
              </div>
              {customSites.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>No custom sites saved yet.</div>
              )}
              {customSites.map(site => (
                <div key={site.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  padding: '9px 10px', background: 'rgba(255,255,255,0.04)',
                }}>
                  <span>{site.name} <small style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°
                  </small></span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
                    <button type="button" className="tp-pill" onClick={() => handleDownloadSite(site)}>
                      Download {site.name} JSON
                    </button>
                    <button
                      type="button"
                      className="tp-pill"
                      aria-label={`Remove ${site.name}`}
                      onClick={() => handleRemoveCustomSite(site)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {siteNotice && <div role="status" style={{ color: '#ffcf9b', fontSize: 12 }}>{siteNotice}</div>}
          </section>
        </div>
      )}
      {pendingSite && (
        <div className="add-site-backdrop" style={{
          position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'auto',
          display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.72)',
        }}>
          <form
            className="add-site-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-site-title"
            onSubmit={handleAddSite}
            onKeyDown={event => {
              if (event.key === 'Escape') setPendingSite(null);
            }}
            style={{
              width: 'min(92vw, 380px)', padding: 22, color: '#fff',
              background: '#090b10', border: '1px solid rgba(255,255,255,0.25)',
              display: 'grid', gap: 14,
            }}
          >
            <div>
              <div id="add-site-title" style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Add landing site
              </div>
              <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.6)', font: '12px "Courier New", monospace' }}>
                Coordinates are editable; middle-clicked locations are prefilled.
              </div>
            </div>
            <label style={{ display: 'grid', gap: 6, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Site name
              <input
                autoFocus
                maxLength={60}
                value={newSiteName}
                onChange={event => setNewSiteName(event.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', color: '#fff', background: '#000',
                  border: '1px solid rgba(255,255,255,0.3)', fontSize: 14,
                }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Latitude
                <input
                  type="number"
                  step="0.0001"
                  min="-90"
                  max="90"
                  value={newSiteLat}
                  onChange={event => setNewSiteLat(event.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', color: '#fff', background: '#000',
                    border: '1px solid rgba(255,255,255,0.3)', fontSize: 14,
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Longitude
                <input
                  type="number"
                  step="0.0001"
                  min="-180"
                  max="180"
                  value={newSiteLon}
                  onChange={event => setNewSiteLon(event.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', color: '#fff', background: '#000',
                    border: '1px solid rgba(255,255,255,0.3)', fontSize: 14,
                  }}
                />
              </label>
            </div>
            {siteNotice && <div role="alert" style={{ color: '#ffb8a8', fontSize: 12 }}>{siteNotice}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="tp-pill" onClick={() => setPendingSite(null)}>Cancel</button>
              <button type="submit" className="tp-pill">Add site</button>
            </div>
          </form>
        </div>
      )}
      {!pendingSite && !siteManagerOpen && siteNotice && (
        <div className="site-notice" role="status" style={{
          position: 'fixed', top: 66, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1001, pointerEvents: 'auto', padding: '10px 14px',
          background: 'rgba(0,0,0,0.94)', border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', fontSize: 12,
        }}>
          {siteNotice}
          <button type="button" aria-label="Dismiss message" onClick={() => setSiteNotice('')}
            style={{ marginLeft: 12, border: 0, background: 'transparent', color: '#fff', cursor: 'pointer' }}>×</button>
        </div>
      )}
    </div>
  );
}
