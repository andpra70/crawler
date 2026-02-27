#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const imageSize = require('image-size');
const { collectPinterestImageUrls } = require('./pinterest-driver');
let gotClient = null;
let sharpLib = null;

async function getGot() {
  if (gotClient) {
    return gotClient;
  }

  const imported = await import('got');
  gotClient = imported.default || imported.got || imported;
  return gotClient;
}

async function getSharp() {
  if (sharpLib) {
    return sharpLib;
  }

  const imported = await import('sharp');
  sharpLib = imported.default || imported;
  return sharpLib;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function normalizeQuality(value, fallback = 75) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

function normalizeUrl(raw, base) {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

function extensionFromContentType(contentType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/avif': '.avif'
  };
  const clean = (contentType || '').split(';')[0].trim().toLowerCase();
  return map[clean] || '';
}

function extensionFromImageType(type) {
  const map = {
    jpg: '.jpg',
    jpeg: '.jpg',
    png: '.png',
    webp: '.webp',
    gif: '.gif',
    svg: '.svg',
    bmp: '.bmp',
    tiff: '.tiff',
    avif: '.avif'
  };
  return map[String(type || '').toLowerCase()] || '';
}

function filenameFromUrl(imageUrl, imageType, contentType, width, height) {
  const parsed = new URL(imageUrl);
  const baseName = path.basename(parsed.pathname) || 'image';
  const baseNoExt = baseName.replace(/\.[a-zA-Z0-9]{2,6}$/i, '') || 'image';
  const safeBase = sanitizeFilename(baseNoExt);
  const ext = extensionFromImageType(imageType) || extensionFromContentType(contentType) || '.img';
  const hash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 10);
  const sizeTag = `${width || 0}x${height || 0}`;
  return `${hash}-${sizeTag}-${safeBase}${ext}`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeMetadata(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createLogger(filePath) {
  return async function log(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    await fs.appendFile(filePath, `${line}\n`, 'utf8');
  };
}

function extractImageUrls($, pageUrl) {
  const set = new Set();
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
    if (!src) {
      return;
    }
    const full = normalizeUrl(src, pageUrl);
    if (!full) {
      return;
    }
    if (full.startsWith('data:')) {
      return;
    }
    set.add(full);
  });
  return [...set];
}

function extractLinks($, pageUrl, sameOriginOnly) {
  const set = new Set();
  const origin = new URL(pageUrl).origin;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) {
      return;
    }
    const full = normalizeUrl(href, pageUrl);
    if (!full) {
      return;
    }

    const parsed = new URL(full);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return;
    }

    if (sameOriginOnly && parsed.origin !== origin) {
      return;
    }

    parsed.hash = '';
    set.add(parsed.href);
  });

  return [...set];
}

async function buildClient(cookieString, startUrl) {
  const got = await getGot();
  const cookieJar = new CookieJar();

  if (cookieString) {
    const cookies = cookieString
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);

    for (const cookie of cookies) {
      await cookieJar.setCookie(cookie, startUrl);
    }
  }

  return got.extend({
    cookieJar,
    headers: {
      'user-agent': 'site-image-crawler/1.0 (+https://local)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: {
      request: 15000
    },
    throwHttpErrors: false,
    retry: {
      limit: 1
    }
  });
}

async function fetchHtml(client, pageUrl) {
  const res = await client.get(pageUrl);
  const contentType = (res.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return null;
  }
  return res.body;
}

async function fetchImage(client, imageUrl) {
  const res = await client.get(imageUrl, { responseType: 'buffer' });
  if (res.statusCode < 200 || res.statusCode >= 400) {
    return null;
  }

  const contentType = String(res.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return null;
  }

  return {
    contentType,
    buffer: res.body
  };
}

async function recompressImage(buffer, imageType, quality) {
  const type = String(imageType || '').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff'].includes(type)) {
    return { buffer, recompressed: false };
  }

  const sharp = await getSharp();
  const instance = sharp(buffer, { failOn: 'none' }).rotate();
  const q = normalizeQuality(quality, 75);

  if (type === 'jpg' || type === 'jpeg') {
    return { buffer: await instance.jpeg({ quality: q, mozjpeg: true }).toBuffer(), recompressed: true };
  }
  if (type === 'png') {
    return { buffer: await instance.png({ quality: q, compressionLevel: 9, effort: 10, palette: true }).toBuffer(), recompressed: true };
  }
  if (type === 'webp') {
    return { buffer: await instance.webp({ quality: q, effort: 6 }).toBuffer(), recompressed: true };
  }
  if (type === 'avif') {
    return { buffer: await instance.avif({ quality: q, effort: 9 }).toBuffer(), recompressed: true };
  }
  if (type === 'tiff') {
    return { buffer: await instance.tiff({ quality: q, compression: 'jpeg' }).toBuffer(), recompressed: true };
  }

  return { buffer, recompressed: false };
}

async function downloadImages(imageUrls, client, outputDir, minWidth, quality, log) {
  const downloadedImages = new Set();
  const stats = {
    imagesFound: imageUrls.length,
    imagesSaved: 0,
    imagesSkippedSmall: 0,
    imagesFailed: 0,
    imagesRecompressed: 0,
    bytesBefore: 0,
    bytesAfter: 0
  };

  for (const imageUrl of imageUrls) {
    if (downloadedImages.has(imageUrl)) {
      continue;
    }
    downloadedImages.add(imageUrl);

    try {
      const imageData = await fetchImage(client, imageUrl);
      if (!imageData) {
        stats.imagesFailed += 1;
        await log(`IMG failed_non_image_or_status url=${imageUrl}`);
        continue;
      }

      const size = imageSize(imageData.buffer);
      if (!size.width || size.width < minWidth) {
        stats.imagesSkippedSmall += 1;
        await log(`IMG skipped_small url=${imageUrl} width=${size.width || 0} minWidth=${minWidth}`);
        continue;
      }

      stats.bytesBefore += imageData.buffer.length;
      const optimized = await recompressImage(imageData.buffer, size.type, quality);
      const outputBuffer = optimized.buffer;
      stats.bytesAfter += outputBuffer.length;
      if (optimized.recompressed) {
        stats.imagesRecompressed += 1;
      }

      const filename = filenameFromUrl(imageUrl, size.type, imageData.contentType, size.width, size.height);
      const filePath = path.join(outputDir, filename);
      await fs.writeFile(filePath, outputBuffer);
      stats.imagesSaved += 1;
      await log(`IMG saved path=${filePath} width=${size.width} height=${size.height || '?'} bytesBefore=${imageData.buffer.length} bytesAfter=${outputBuffer.length} recompressed=${optimized.recompressed}`);
    } catch (err) {
      stats.imagesFailed += 1;
      await log(`IMG error url=${imageUrl} err=${err.message}`);
    }
  }

  return stats;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'site').toLowerCase();
  const startUrl = args.url ? String(args.url) : '';
  const query = args.query ? String(args.query) : '';

  if (mode === 'site' && !startUrl) {
    console.error('Uso site: node src/crawler.js --mode site --url https://example.com --depth 2 --min-width 200 [--cookie "a=b; c=d"] [--same-origin true|false]');
    process.exit(1);
  }

  if (mode === 'pinterest' && !startUrl && !query) {
    console.error('Uso pinterest: node src/crawler.js --mode pinterest --query \"interior design\" [--max-images 80] [--headful true]');
    process.exit(1);
  }

  const maxDepth = Number(args.depth || 2);
  const minWidth = Number(args['min-width'] || process.env.W_MIN || 200);
  const quality = normalizeQuality(args.q || args.quality || process.env.QUALITY || 75, 75);
  const maxImages = Number(args['max-images'] || 120);
  const maxScrolls = Number(args['max-scrolls'] || 50);
  const headful = args.headful;
  const cookieString = args.cookie ? String(args.cookie) : '';
  const sameOriginOnly = args['same-origin'] === undefined ? true : String(args['same-origin']).toLowerCase() !== 'false';

  const outputDir = path.join(process.cwd(), 'data', 'site', 'images');
  const reportPath = path.join(process.cwd(), 'data', 'site', 'crawl-report.json');
  const logPath = path.join(process.cwd(), 'data', 'site', 'activity.log');
  await ensureDir(outputDir);
  await ensureDir(path.dirname(logPath));
  const log = createLogger(logPath);

  const client = await buildClient(cookieString, startUrl || 'https://www.pinterest.com');
  const commonStats = {
    pagesVisited: 0,
    imagesSaved: 0,
    imagesSkippedSmall: 0,
    imagesFailed: 0,
    imagesRecompressed: 0,
    bytesBefore: 0,
    bytesAfter: 0
  };

  let imagesFound = 0;
  let pinterestStats = null;
  await log(`RUN start mode=${mode} minWidth=${minWidth} quality=${quality}`);

  if (mode === 'pinterest') {
    const collected = await collectPinterestImageUrls({
      query,
      startUrl: startUrl || null,
      maxImages,
      maxScrolls,
      headful,
      log
    });
    pinterestStats = collected.stats;
    imagesFound = collected.imageUrls.length;
    commonStats.pagesVisited = 1;
    await log(`PINTEREST collected_total=${imagesFound}`);
    const downloadStats = await downloadImages(collected.imageUrls, client, outputDir, minWidth, quality, log);
    commonStats.imagesSaved = downloadStats.imagesSaved;
    commonStats.imagesSkippedSmall = downloadStats.imagesSkippedSmall;
    commonStats.imagesFailed = downloadStats.imagesFailed;
    commonStats.imagesRecompressed = downloadStats.imagesRecompressed;
    commonStats.bytesBefore = downloadStats.bytesBefore;
    commonStats.bytesAfter = downloadStats.bytesAfter;
  } else {
    const queue = [{ url: startUrl, depth: 0 }];
    const visitedPages = new Set();
    const discoveredImages = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visitedPages.has(current.url) || current.depth > maxDepth) {
        continue;
      }
      visitedPages.add(current.url);
      await log(`SITE visit depth=${current.depth} url=${current.url}`);

      let html;
      try {
        html = await fetchHtml(client, current.url);
      } catch (err) {
        await log(`SITE page_error url=${current.url} err=${err.message}`);
        continue;
      }

      if (!html) {
        await log(`SITE skipped_non_html url=${current.url}`);
        continue;
      }

      commonStats.pagesVisited += 1;
      const $ = cheerio.load(html);
      const imageUrls = extractImageUrls($, current.url);
      for (const imgUrl of imageUrls) {
        discoveredImages.push(imgUrl);
      }
      await log(`SITE discovered page=${current.url} images=${imageUrls.length}`);

      if (current.depth < maxDepth) {
        const links = extractLinks($, current.url, sameOriginOnly);
        for (const link of links) {
          if (!visitedPages.has(link)) {
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }
    }

    imagesFound = discoveredImages.length;
    const downloadStats = await downloadImages(discoveredImages, client, outputDir, minWidth, quality, log);
    commonStats.imagesSaved = downloadStats.imagesSaved;
    commonStats.imagesSkippedSmall = downloadStats.imagesSkippedSmall;
    commonStats.imagesFailed = downloadStats.imagesFailed;
    commonStats.imagesRecompressed = downloadStats.imagesRecompressed;
    commonStats.bytesBefore = downloadStats.bytesBefore;
    commonStats.bytesAfter = downloadStats.bytesAfter;
  }

  await writeMetadata(reportPath, {
    mode,
    startUrl,
    query,
    maxDepth,
    maxImages,
    maxScrolls,
    minWidth,
    quality,
    sameOriginOnly,
    finishedAt: new Date().toISOString(),
    pinterestStats,
    stats: {
      ...commonStats,
      imagesFound
    }
  });

  await log(`RUN end pagesVisited=${commonStats.pagesVisited} imagesFound=${imagesFound} imagesSaved=${commonStats.imagesSaved}`);
  console.log('\n=== Crawl completato ===');
  console.log(`Pagine visitate: ${commonStats.pagesVisited}`);
  console.log(`Immagini trovate: ${imagesFound}`);
  console.log(`Immagini salvate: ${commonStats.imagesSaved}`);
  console.log(`Immagini scartate (troppo piccole): ${commonStats.imagesSkippedSmall}`);
  console.log(`Immagini fallite: ${commonStats.imagesFailed}`);
  console.log(`Immagini ricomprese: ${commonStats.imagesRecompressed || 0}`);
  console.log(`Dimensione totale prima: ${commonStats.bytesBefore || 0} bytes`);
  console.log(`Dimensione totale dopo: ${commonStats.bytesAfter || 0} bytes`);
  console.log(`Output: ${outputDir}`);
  console.log(`Log: ${logPath}`);
}

run().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
