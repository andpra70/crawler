const { URL } = require('node:url');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value).toLowerCase() === 'true';
}

function normalizePinterestImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.includes('pinimg.com')) {
      return parsed.href;
    }

    // Tries to move from thumbnail variants (236x/474x/736x) to originals when possible.
    parsed.pathname = parsed.pathname.replace(/\/(\d+x)\//, '/originals/');
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeGoogleImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    if (host.includes('google.') || host.includes('gstatic.com') || host.includes('googleusercontent.com')) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

async function collectPinterestImageUrls(options) {
  const {
    query,
    startUrl,
    maxImages,
    maxScrolls,
    headful,
    log,
    onBatch
  } = options;

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: !parseBool(headful, false)
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const targetUrl = startUrl || `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
  await log(`PINTEREST open ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  // Cookie/consent banner best effort.
  try {
    const consent = page.locator('button:has-text("Accept"), button:has-text("Accetta"), button:has-text("I agree")').first();
    if (await consent.isVisible({ timeout: 2500 })) {
      await consent.click({ timeout: 2500 });
      await log('PINTEREST consent accepted');
    }
  } catch {
    // Ignore.
  }

  const found = new Set();
  let adsSkipped = 0;
  let scroll = 0;
  while (scroll < maxScrolls && found.size < maxImages) {
    const batch = await page.evaluate(() => {
      const adKeywords = ['sponsored', 'promoted', 'ad', 'ads', 'sponsorizzato', 'pubblicita'];
      const imgs = Array.from(document.querySelectorAll('img'));
      const urls = [];
      let localAdsSkipped = 0;

      for (const img of imgs) {
        const container = img.closest('[data-grid-item], [data-test-id], [role="listitem"], article, div');
        const text = (container?.textContent || '').toLowerCase();
        if (adKeywords.some((k) => text.includes(k))) {
          localAdsSkipped += 1;
          continue;
        }

        const srcset = img.getAttribute('srcset') || '';
        let candidate = img.currentSrc || img.getAttribute('src') || '';

        if (srcset.trim()) {
          const parts = srcset
            .split(',')
            .map((item) => item.trim().split(/\s+/)[0])
            .filter(Boolean);
          if (parts.length > 0) {
            candidate = parts[parts.length - 1];
          }
        }

        if (!candidate.startsWith('http')) {
          continue;
        }

        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (w > 120 && h > 120) {
          urls.push(candidate);
        }
      }

      return {
        urls,
        adsSkipped: localAdsSkipped
      };
    });

    adsSkipped += batch.adsSkipped;
    const discoveredNow = [];
    for (const raw of batch.urls) {
      const normalized = normalizePinterestImageUrl(raw);
      if (!normalized) {
        continue;
      }
      if (found.has(normalized)) {
        continue;
      }
      found.add(normalized);
      discoveredNow.push(normalized);
      if (found.size >= maxImages) {
        break;
      }
    }

    if (discoveredNow.length > 0 && typeof onBatch === 'function') {
      await onBatch(discoveredNow);
    }

    await log(`PINTEREST scroll=${scroll + 1} collected=${found.size} adsSkipped=${adsSkipped}`);
    await page.mouse.wheel(0, 2200);
    await sleep(900 + Math.floor(Math.random() * 500));
    scroll += 1;
  }

  await context.close();
  await browser.close();

  return {
    imageUrls: [...found],
    stats: {
      scrolls: scroll,
      collected: found.size,
      adsSkipped,
      maxImages,
      maxScrolls
    }
  };
}

async function collectGoogleImageUrls(options) {
  const {
    query,
    startUrl,
    maxImages,
    maxScrolls,
    headful,
    log,
    onBatch
  } = options;

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: !parseBool(headful, false)
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const targetUrl = startUrl || `https://www.google.com/search?tbm=isch&safe=off&hl=en&q=${encodeURIComponent(query)}`;
  await log(`GOOGLE open ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  try {
    const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Accetta tutto")').first();
    if (await consent.isVisible({ timeout: 3500 })) {
      await consent.click({ timeout: 3500 });
      await log('GOOGLE consent accepted');
      await sleep(800);
    }
  } catch {
    // Ignore.
  }

  const found = new Set();
  let scroll = 0;

  while (scroll < maxScrolls && found.size < maxImages) {
    const batch = await page.evaluate(() => {
      const urls = [];

      for (const anchor of document.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href') || '';
        if (!href) {
          continue;
        }

        try {
          const parsed = new URL(href, window.location.href);
          const imgurl = parsed.searchParams.get('imgurl');
          if (imgurl) {
            urls.push(imgurl);
          }
        } catch {
          // Ignore.
        }
      }

      for (const img of document.querySelectorAll('img')) {
        const srcset = img.getAttribute('srcset') || '';
        const currentSrc = img.currentSrc || img.getAttribute('src') || '';
        if (currentSrc.startsWith('http')) {
          urls.push(currentSrc);
        }

        if (srcset.trim()) {
          const parts = srcset
            .split(',')
            .map((item) => item.trim().split(/\s+/)[0])
            .filter((item) => item.startsWith('http'));
          urls.push(...parts);
        }
      }

      return { urls };
    });

    const discoveredNow = [];
    for (const raw of batch.urls) {
      const normalized = normalizeGoogleImageUrl(raw);
      if (!normalized || found.has(normalized)) {
        continue;
      }
      found.add(normalized);
      discoveredNow.push(normalized);
      if (found.size >= maxImages) {
        break;
      }
    }

    if (discoveredNow.length > 0 && typeof onBatch === 'function') {
      await onBatch(discoveredNow);
    }

    await log(`GOOGLE scroll=${scroll + 1} collected=${found.size}`);
    await page.mouse.wheel(0, 2200);
    await sleep(900 + Math.floor(Math.random() * 500));
    scroll += 1;
  }

  await context.close();
  await browser.close();

  return {
    imageUrls: [...found],
    stats: {
      scrolls: scroll,
      collected: found.size,
      maxImages,
      maxScrolls,
      safeSearch: 'off'
    }
  };
}

module.exports = {
  collectPinterestImageUrls,
  collectGoogleImageUrls
};
