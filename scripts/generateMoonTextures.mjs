import { fromFile } from 'geotiff';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'data');
const outputRoot = path.join(projectRoot, 'public');
const width = 4096;
const height = 2048;
const channels = 3;

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const content = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, checksum]);
}

function encodePng(rgb, imageWidth, imageHeight) {
  const rowLength = imageWidth * channels;
  const scanlines = Buffer.alloc((rowLength + 1) * imageHeight);
  for (let row = 0; row < imageHeight; row++) {
    const destination = row * (rowLength + 1);
    scanlines[destination] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + row * rowLength, rowLength)
      .copy(scanlines, destination + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(imageWidth, 0);
  header.writeUInt32BE(imageHeight, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function readRaster(name, targetWidth, requestedHeight, expectedBands) {
  const sourcePath = path.join(sourceRoot, name);
  const tiff = await fromFile(sourcePath);
  const image = await tiff.getImage();
  const bands = image.getSamplesPerPixel();
  if (bands !== expectedBands) {
    throw new Error(`${name} has ${bands} bands; expected ${expectedBands}`);
  }

  const targetHeight = requestedHeight ?? Math.max(2, Math.round(targetWidth * image.getHeight() / image.getWidth()));
  const pixels = new Uint8Array(targetWidth * targetHeight * bands);
  for (let row = 0; row < targetHeight; row++) {
    const sourceRow = Math.round(row * (image.getHeight() - 1) / (targetHeight - 1));
    const rowPixels = await image.readRasters({
      window: [0, sourceRow, image.getWidth(), sourceRow + 1],
      width: targetWidth,
      height: 1,
      interleave: true,
      resampleMethod: 'bilinear',
    });
    if (!(rowPixels instanceof Uint8Array)) {
      throw new Error(`${name} is not an 8-bit image`);
    }
    pixels.set(rowPixels, row * targetWidth * bands);
    if (row > 0 && row % 512 === 0) console.log(`  ${name}: ${row}/${targetHeight} rows`);
  }

  return {
    name,
    pixels,
    width: targetWidth,
    height: targetHeight,
    sourceWidth: image.getWidth(),
    sourceHeight: image.getHeight(),
  };
}

function softenPolarTexture(image) {
  const rowValues = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const latitude = Math.abs(90 - y / (height - 1) * 180);
    const cosineLatitude = Math.max(Math.cos(latitude * Math.PI / 180), 1 / width);
    const radius = Math.min(
      Math.floor(width / 2),
      Math.round((1 / cosineLatitude - 1) / 2),
    );
    if (radius === 0) continue;

    const rowStart = y * width * channels;
    for (let x = 0; x < width; x++) {
      rowValues[x] = image[rowStart + x * channels];
    }

    if (radius >= width / 2) {
      let sum = 0;
      for (const value of rowValues) sum += value;
      const average = Math.round(sum / width);
      for (let x = 0; x < width; x++) {
        const index = rowStart + x * channels;
        image[index] = average;
        image[index + 1] = average;
        image[index + 2] = average;
      }
      continue;
    }

    const windowSize = radius * 2 + 1;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      sum += rowValues[(offset + width) % width];
    }
    for (let x = 0; x < width; x++) {
      const value = Math.round(sum / windowSize);
      const index = rowStart + x * channels;
      image[index] = value;
      image[index + 1] = value;
      image[index + 2] = value;
      const outgoing = (x - radius + width) % width;
      const incoming = (x + radius + 1) % width;
      sum += rowValues[incoming] - rowValues[outgoing];
    }
  }
}

function makeCoarseTexture(source, sourceWidth = width, sourceHeight = height) {
  const coarseWidth = 1024;
  const coarseHeight = 512;
  const coarse = new Uint8Array(coarseWidth * coarseHeight * channels);
  for (let y = 0; y < coarseHeight; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / coarseHeight));
    for (let x = 0; x < coarseWidth; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / coarseWidth));
      const sourceIndex = (sourceY * sourceWidth + sourceX) * channels;
      const destinationIndex = (y * coarseWidth + x) * channels;
      coarse[destinationIndex] = source[sourceIndex];
      coarse[destinationIndex + 1] = source[sourceIndex + 1];
      coarse[destinationIndex + 2] = source[sourceIndex + 2];
    }
  }
  return { data: coarse, width: coarseWidth, height: coarseHeight };
}

async function generateWacTextures() {
  // The WAC mosaic is the global surface image. ClrShade files are colorized
  // relief imagery and must not be interpreted as elevation or global color.
  const wacName = 'LRO_WAC_Mosaic_Global_303ppd.tif';
  console.log(`Reading ${wacName} as the global WAC base map...`);
  const wac = await readRaster(wacName, width, height, 1);
  const global = new Uint8Array(width * height * channels);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const value = wac.pixels[pixel];
    const index = pixel * channels;
    global[index] = value;
    global[index + 1] = value;
    global[index + 2] = value;
  }
  softenPolarTexture(global);

  // ── Write outputs ─────────────────────────────────────────────────────────
  await mkdir(outputRoot, { recursive: true });
  const coarse = makeCoarseTexture(global);
  await writeFile(path.join(outputRoot, 'moon-wac-coarse.png'), encodePng(coarse.data, coarse.width, coarse.height));
  console.log('Written public/moon-wac-coarse.png');
  await writeFile(path.join(outputRoot, 'moon-wac-global.png'), encodePng(global, width, height));
  console.log('Written public/moon-wac-global.png');
  console.log('Done. Global texture is the WAC mosaic; use numeric LOLA DEM data for height.');
}

async function generateLrocColorTextures() {
  const lrocName = 'lroc_color_poles_8k.tif';
  const lrocWidth = 8192;
  console.log(`Reading ${lrocName} as the global LROC color map...`);
  const lroc = await readRaster(lrocName, lrocWidth, undefined, channels);
  const coarse = makeCoarseTexture(lroc.pixels, lroc.width, lroc.height);

  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, 'moon-lroc-coarse.png'), encodePng(coarse.data, coarse.width, coarse.height));
  console.log('Written public/moon-lroc-coarse.png');
  await writeFile(path.join(outputRoot, 'moon-lroc-color-8k.png'), encodePng(lroc.pixels, lroc.width, lroc.height));
  console.log('Written public/moon-lroc-color-8k.png');
  console.log('Done. LROC color is equirectangular; use ldem_16.tif for global relief.');
}

async function main() {
  if (process.argv.includes('--lroc-color')) {
    await generateLrocColorTextures();
    return;
  }
  await generateWacTextures();
}

main().catch(error => {
  console.error('Moon TIFF texture generation failed:', error);
  process.exitCode = 1;
});
