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

async function collectPinterestImageUrls(options) {
  const {
    query,
    startUrl,
    maxImages,
    maxScrolls,
    headful,
    log
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
    for (const raw of batch.urls) {
      const normalized = normalizePinterestImageUrl(raw);
      if (!normalized) {
        continue;
      }
      found.add(normalized);
      if (found.size >= maxImages) {
        break;
      }
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

module.exports = {
  collectPinterestImageUrls
};
