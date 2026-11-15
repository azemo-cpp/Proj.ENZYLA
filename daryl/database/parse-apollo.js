/* Binabasa ang sites file (lroc-sites.ts) at kinukuha ang name, lat, lon at description ng bawat site.
Regex lang ito, hindi totoong TypeScript parser, kaya may malinaw na error kapag nag-iba ang format. */

const QUOTED = String.raw`'((?:[^'\\]|\\.)*)'`;
const unescape = s => s.replace(/\\(.)/g, "$1");

export function parseApolloSites(source) {
  const start = source.indexOf("APOLLO_SITES");
  if (start === -1) throw new Error("Can't find APOLLO_SITES in the file.");

  const body = source.slice(start);
  const chunks = body.split(/\bid:\s*'/).slice(1); // isang chunk bawat site
  if (chunks.length === 0) throw new Error("No sites found after APOLLO_SITES (each site needs an id: '...' field for the text reader).");

  return chunks.map((chunk, i) => {
    const label = `site #${i + 1}`;
    const name = chunk.match(new RegExp(String.raw`\bname:\s*${QUOTED}`))?.[1];
    const lat = chunk.match(/\blat:\s*(-?\d+(?:\.\d+)?)/)?.[1];
    const lon = chunk.match(/\blon:\s*(-?\d+(?:\.\d+)?)/)?.[1];
    const description = chunk.match(new RegExp(String.raw`\bdescription:\s*${QUOTED}`))?.[1];

    if (name === undefined) throw new Error(`${label}: no name found.`);
    if (lat === undefined || lon === undefined) throw new Error(`${name}: lat or lon not found.`);

    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) {
      throw new Error(`${name}: coordinates are out of range.`);
    }

    const site = [unescape(name), latitude, longitude];
    if (description !== undefined) site.push(unescape(description));
    return site;
  });
}
