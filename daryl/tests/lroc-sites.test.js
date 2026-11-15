import test from "node:test";
import assert from "node:assert/strict";
import { SITES, SITES_ERROR, SITES_FILE } from "../database/sites.js";
import { loadSites } from "../database/load-sites.js";

test("the bundled LROC sites load, with the six Apollo sites first", () => {
  assert.equal(SITES_ERROR, null);
  assert.ok(/lroc-sites\.ts$/.test(SITES_FILE));
  assert.equal(SITES.length, 33);
  assert.deepEqual(SITES.slice(0, 6).map((s) => s[0]), ["Apollo 11", "Apollo 12", "Apollo 14", "Apollo 15", "Apollo 16", "Apollo 17"]);
});

test("every bundled site has a unique name and coordinates in range", () => {
  const names = new Set();
  for (const [name, lat, lon] of SITES) {
    assert.ok(!names.has(name), `duplicate: ${name}`);
    names.add(name);
    assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, name);
  }
});

test("reading the bundled file directly and as text gives the same sites", async () => {
  const a = await loadSites(SITES_FILE, { useImport: true });
  const b = await loadSites(SITES_FILE, { useImport: false });
  assert.deepEqual(a, b);
});

import { createDarylProvider } from "../providers/lunar/index.js";

test("site-list questions are answered by Daryl from the real data, never by the model", async () => {
  let calls = 0;
  const daryl = createDarylProvider({ generate: async () => { calls++; return "model"; } });
  const cases = [
    ["How many sites are there?", /33 sites/],
    ["What data do you have?", /Lunar Reconnaissance Orbiter Camera/],
    ["List the Apollo S-IVB impact sites", /There are 4 of the 33[^]*Apollo 13 S-IVB[^]*Apollo 17 S-IVB/],
    ["Tell me about the Surveyor sites", /There are 5 of the 33[^]*Surveyor 7/],
    ["Which Luna missions are there?", /There are 6 of the 33[^]*Luna 24/],
    ["How many Ranger impact sites are there?", /There are 4 of the 33/],
    ["Which Chinese missions are there?", /Chang'e 3[^]*Chang'e 4/],
    ["Which sites have a rover?", /There are 2 of the 33[^]*Lunokhod 2/],
    ["Which landing sites are in the far north?", /sorted from the most northern:\n\n- Chang'e 3 Landing Site/],
  ];
  for (const [q, re] of cases) assert.match(await daryl.run(q), re, q);
  assert.equal(calls, 0);
});

test("evaluative questions are not hijacked by the site list", async () => {
  const daryl = createDarylProvider({});
  assert.doesNotMatch(await daryl.run("Which landing site is best for a 10-day mission?"), /sites that match/);
  assert.doesNotMatch(await daryl.run("Compare Apollo 11 and Apollo 12 for 10 days"), /sites that match/);
});

test("comparisons say what kind of site each one is, and flag impact sites", async () => {
  const daryl = createDarylProvider({});
  const a = await daryl.run("Compare Apollo 11 and GRAIL A for 10 days");
  assert.match(a, /\| Type \| Landing site \| Impact site \|/);
  assert.match(a, /GRAIL A is an impact site/);
  const b = await daryl.run("Compare Apollo 17 and Luna 24 for 10 days");
  assert.match(b, /\| Type \| Landing site \| Landing site \|/);
  assert.doesNotMatch(b, /impact site, so/);
});

test("'best site' leaves out impact sites and says so when sites tie", async () => {
  const text = await createDarylProvider({}).run("Which site is best for a 10-day mission?");
  assert.match(text, /\d+ sites tie for the top score of \d+/);
  assert.match(text, /11 impact sites are left out/);
  for (const impact of ["GRAIL A", "Ranger 6", "Apollo 13 S-IVB", "LADEE"]) assert.doesNotMatch(text, new RegExp("\\| " + impact + " \\|"));
});
