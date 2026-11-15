import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseApolloSites } from "../database/parse-apollo.js";
import { loadSites } from "../database/load-sites.js";
import { SITES, SITES_FILE, SITES_ERROR } from "../database/sites.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const canSpawn = process.permission ? process.permission.has("child") : true;

const sample = `
export const APOLLO_SITES: ApolloSite[] = [
  {
    id: 'X1', num: '1', name: 'Test One', year: 2000,
    lat: -1.5, lon: 20,
    description: 'It\\'s a test site — with a dash.',
  },
  {
    id: 'X2', num: '2', name: 'Test Two', year: 2001,
    lat: 10.25, lon: -30.5,
  },
];`;

async function tempFile(text, name = "sites.ts") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sites-"));
  const file = path.join(dir, name);
  await writeFile(file, text);
  return file;
}

test("the parser reads names, coordinates, and descriptions", () => {
  assert.deepEqual(parseApolloSites(sample), [
    ["Test One", -1.5, 20, "It's a test site — with a dash."],
    ["Test Two", 10.25, -30.5]
  ]);
});

test("the parser gives clear errors for a changed format", () => {
  assert.throws(() => parseApolloSites("nothing here"), /APOLLO_SITES/);
  assert.throws(() => parseApolloSites("APOLLO_SITES = [ { id: 'A', lat: 1, lon: 2 } ]"), /no name/);
  assert.throws(() => parseApolloSites("APOLLO_SITES = [ { id: 'A', name: 'A', lat: 1 } ]"), /lat or lon/);
  assert.throws(() => parseApolloSites("APOLLO_SITES = [ { id: 'A', name: 'A', lat: 95, lon: 2 } ]"), /out of range/);
});

test("the site data was loaded from the bundled LROC sites", () => {
  assert.ok(SITES.length > 0, SITES_ERROR ?? "the site list is empty");
  assert.equal(SITES_ERROR, null);
  for (const [name, lat, lon] of SITES) {
    assert.equal(typeof name, "string");
    assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, name);
  }
});

test("reading the file directly and reading its text give the same sites", { skip: SITES.length === 0 }, async () => {
  const direct = await loadSites(SITES_FILE, { useImport: true });
  const text = await loadSites(SITES_FILE, { useImport: false });
  assert.deepEqual(direct, text);
  assert.deepEqual(direct, SITES);
});

test("a plain data file loads either way", async () => {
  const file = await tempFile(
    "export interface S { name: string }\nexport const APOLLO_SITES: S[] = [\n  { id: 'a', name: 'A', lat: 1, lon: 2, description: 'x' },\n  { id: 'b', name: 'B', lat: -3, lon: 4 },\n];\n"
  );
  const expected = [["A", 1, 2, "x"], ["B", -3, 4]];
  assert.deepEqual(await loadSites(file, { useImport: true }), expected);
  assert.deepEqual(await loadSites(file, { useImport: false }), expected);
});

test("if Node can't run the file, the text reader takes over", async () => {
  // may import na hindi kayang sundan ng Node, kaya babalik sa pagbasa ng text
  const file = await tempFile(
    "import { helper } from './not-there';\nexport const APOLLO_SITES = [\n  { id: 'f', name: 'Fallback', lat: 5, lon: 6 },\n];\n"
  );
  assert.deepEqual(await loadSites(file), [["Fallback", 5, 6]]);
});

test("a missing or unusable file is an error, not an empty list", async () => {
  await assert.rejects(loadSites(path.join(os.tmpdir(), "nope", "missing.ts")));
  await assert.rejects(loadSites(await tempFile("export const OTHER = [];")), /APOLLO_SITES/);
});

test("DARYL_SITES_FILE picks another file, and a bad one gives an empty list with the reason", { skip: !canSpawn }, async () => {
  const { execFile } = await import("node:child_process");
  const run = env => new Promise(resolve => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", "const m = await import('./database/sites.js'); console.log(JSON.stringify({ n: m.SITES.map(s => s[0]), e: m.SITES_ERROR }))"],
      { cwd: path.resolve(here, ".."), env: { ...process.env, ...env } },
      (error, stdout) => resolve(JSON.parse(stdout))
    );
  });

  const file = await tempFile("export const APOLLO_SITES = [{ id: 'e', name: 'Elsewhere', lat: 1, lon: 2 }];");
  assert.deepEqual((await run({ DARYL_SITES_FILE: file })).n, ["Elsewhere"]);

  const bad = await run({ DARYL_SITES_FILE: path.join(os.tmpdir(), "nope", "missing.ts") });
  assert.deepEqual(bad.n, []);
  assert.match(bad.e, /Couldn't read the sites from .*missing\.ts/);
});
