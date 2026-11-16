


- full screen 3D moon rendered in the browser, no downloads
- click anywhere on the moon → camera zooms in smooth
- shows real Apollo landing site infos (coordinates, what they did there, how much they collected)
- the Time Horizon timeline drives lunar Sun illumination and the visible Sun/Earth positions
- live ISS position updating every 5 seconds (real data)
- star field with 44,000+ stars behind the moon
- bottom tab (jump between Apollo 11 through 17) 
- middle-click the Moon to add a named landing site; custom sites are saved in this browser and exported as an updated JSON download

---

## apollo sites included

The built-in Apollo landing site data is maintained in `src/data/landingSites.json`.

| mission | where | elevation | samples brought back |
|---------|-------|-----------|----------------------|
| Apollo 11 | Sea of Tranquility | −2,376 m | 21.5 kg |
| Apollo 12 | Ocean of Storms | −2,568 m | 34.3 kg |
| Apollo 14 | Fra Mauro Highlands | −2,471 m | 42.3 kg |
| Apollo 15 | Hadley–Apennine | +3,320 m | 77.3 kg |
| Apollo 16 | Descartes Highlands | +2,115 m | 95.7 kg |
| Apollo 17 | Taurus-Littrow Valley | +1,975 m | 110.5 kg |

---

## run it locally

On Windows, double-click `Enzyla.bat`. On first launch it downloads a private
Node.js runtime and installs the locked npm dependencies if needed, then starts
the app and opens it in your browser. You do not need to open VS Code or
manually install Node.js or npm. An internet connection is required for initial
setup.

On macOS or Linux, install the dependencies and start the development server:

```sh
npm install
npm run dev
```

Then open `http://localhost:5173`.

### Regenerate Moon textures

The Windows launcher can run either texture generator without starting the app:

```bat
Enzyla.bat --generate-moon-lroc
Enzyla.bat --generate-moon-textures
```

On other platforms, run the matching npm script after `npm install`:

```sh
npm run generate:moon-lroc
npm run generate:moon-textures
```

The LROC generator reads `data/lroc_color_poles_8k.tif` and writes the global
and coarse color textures into `public/`. The WAC generator reads
`data/LRO_WAC_Mosaic_Global_303ppd.tif`; this optional source TIFF is about
5.7 GiB and is not downloaded by the launcher. Place it in `data/` before
running the WAC generator.

The Moon is a procedural sphere textured with `data/lroc_color_poles_8k.tif`
and displaced at runtime from `data/ldem_16.tif` (values in kilometers). At
close zoom, Moon Trek supplies global 256ppd ClrShade tiles and LOLA elevation
patches; polar views use the higher-resolution 30 m and 5 m LOLA DEMs where
coverage allows. Terrain patches shrink as the camera zooms in and fade back
to the LDEM16 baseline at 1× elevation scale. The streamed ClrShade mosaic is
composited onto the same 3D terrain bounds shown in the synchronized 2D panel.

---

## tech stackz

- Three.js for the 3D moon
- React + Tailwind for the UI
- Vite for the build
- Procedural Three.js Moon sphere with equirectangular LROC color and LDEM16 relief
- Global Moon Trek ClrShade tiles and zoom-dependent LOLA terrain patches
- 2D LRO ClrShade map panel synchronized with the selected lunar location

---

## data sources

 mission data from NASA mission planning docs, LOLA elevation database, and Apollo flight records.

- NASA LRO / LOLA — global 256ppd elevation and polar 30 m / 5 m DEMs
- NASA Moon Trek — global 256ppd ClrShade imagery streamed on demand
- NASA SVS CGI Moon Kit — LROC color-map and LOLA displacement workflow: https://svs.gsfc.nasa.gov/4720/
- NASA History Division — mission documentation  
- wheretheiss.at — live ISS position
- Solar System Scope — star map texture (CC-BY-4.0)
