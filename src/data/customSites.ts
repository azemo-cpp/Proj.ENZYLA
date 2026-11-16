import type { SiteLocation } from './apolloSites';

const STORAGE_KEY = 'enzyla.customLandingSites.v1';

export type CustomLandingSite = SiteLocation;
export type ImportedLandingSite = Pick<SiteLocation, 'name' | 'lat' | 'lon'>;

function isCustomLandingSite(value: unknown): value is CustomLandingSite {
  if (!value || typeof value !== 'object') return false;
  const site = value as Record<string, unknown>;
  return typeof site.id === 'string'
    && typeof site.name === 'string'
    && site.name.trim().length > 0
    && typeof site.lat === 'number'
    && Number.isFinite(site.lat)
    && site.lat >= -90
    && site.lat <= 90
    && typeof site.lon === 'number'
    && Number.isFinite(site.lon)
    && site.lon >= -180
    && site.lon <= 180;
}

function isImportedLandingSite(value: unknown): value is ImportedLandingSite {
  if (!value || typeof value !== 'object') return false;
  const site = value as Record<string, unknown>;
  return typeof site.name === 'string'
    && site.name.trim().length > 0
    && typeof site.lat === 'number'
    && Number.isFinite(site.lat)
    && site.lat >= -90
    && site.lat <= 90
    && typeof site.lon === 'number'
    && Number.isFinite(site.lon)
    && site.lon >= -180
    && site.lon <= 180;
}

export function loadCustomLandingSites(): CustomLandingSite[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isCustomLandingSite)) {
    throw new Error('Saved custom landing sites have an invalid format.');
  }
  return parsed;
}

export function saveCustomLandingSites(sites: CustomLandingSite[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
}

export function parseImportedLandingSites(json: string): ImportedLandingSite[] {
  const parsed: unknown = JSON.parse(json);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length === 0 || !records.every(isImportedLandingSite)) {
    throw new Error('JSON must contain a site or an array of sites with a name and valid latitude/longitude.');
  }
  return records.map(site => ({
    name: site.name.trim(),
    lat: site.lat,
    lon: site.lon,
  }));
}

export function downloadLandingSite(site: SiteLocation) {
  const file = new Blob([JSON.stringify(site, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  const name = site.name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  link.download = `${name || 'landing-site'}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
