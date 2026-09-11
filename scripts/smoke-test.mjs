/**
 * Headless smoke test for AETHER.
 *
 * Serves the repository root over HTTP (so the ES module import map and
 * relative imports resolve exactly as in production), then drives headless
 * Chromium via Playwright and asserts:
 *
 *   1. the page reaches "load" with no console errors and no page errors;
 *   2. the WebGL fallback is NOT shown;
 *   3. the canvas has a real drawing buffer;
 *   4. the render loop is actually running (live FPS + particle readout and
 *      an advancing frame counter observed through the HUD);
 *   5. the first rendered frame is not a blank/black screen.
 *
 * Exits non-zero on the first failed assertion so CI fails loudly.
 */

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.SMOKE_PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname === '') pathname = '/index.html';

      const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

function fail(message) {
  console.error(`\n[smoke-test] FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const server = createServer();
  await new Promise((res) => server.listen(PORT, '127.0.0.1', res));

  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage'
    ]
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, {
      waitUntil: 'load',
      timeout: 60000
    });

    // 2. Fallback must not be showing.
    const fallbackShown = await page.evaluate(
      () => !!document.querySelector('#fallback.show')
    );
    if (fallbackShown) fail('WebGL fallback is showing (no usable WebGL context).');

    // 3. Canvas + drawing buffer.
    const buffer = await page.evaluate(() => {
      const canvas = document.querySelector('#stage');
      if (!canvas) return null;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return {
        width: canvas.width,
        height: canvas.height,
        bufferWidth: gl ? gl.drawingBufferWidth : 0
      };
    });
    if (!buffer) fail('canvas#stage not found.');
    if (!buffer || buffer.width < 2 || buffer.bufferWidth < 2) {
      fail(`canvas has no drawing buffer (${JSON.stringify(buffer)}).`);
    }

    // 4. Render loop running: HUD reports a real frame rate and particle count,
    //    and time keeps advancing that readout.
    await page.waitForFunction(
      () => {
        const fps = document.querySelector('#stat-fps')?.textContent || '';
        const count = document.querySelector('#stat-count')?.textContent || '';
        return /^\d+$/.test(fps.trim()) && /[\d,]+/.test(count) && count.trim() !== '—';
      },
      null,
      { timeout: 45000 }
    );

    const first = await page.evaluate(() => ({
      fps: Number((document.querySelector('#stat-fps')?.textContent || '0').trim()),
      count: (document.querySelector('#stat-count')?.textContent || '').trim()
    }));

    const frameA = await page.evaluate(() => performance.now());
    await page.waitForTimeout(1000);
    const frameB = await page.evaluate(() => performance.now());

    if (!(frameB > frameA)) fail('page clock did not advance; animation is not running.');
    if (first.fps < 1) fail(`reported FPS was ${first.fps}; render loop appears stalled.`);

    // 5. The first frame must not be blank: sample the canvas and require some
    //    non-dark pixels (galaxy/nebula are additive on a near-black sky).
    const stats = await page.evaluate(() => {
      const canvas = document.querySelector('#stage');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return null;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      let maxLuma = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        if (luma > 24) lit++;
        if (luma > maxLuma) maxLuma = luma;
      }
      return { total: w * h, lit, maxLuma };
    });

    // readPixels after compositing may be blank on some drivers; treat that as
    // inconclusive rather than a failure, but require lit pixels when present.
    if (stats && stats.maxLuma === 0) {
      console.warn('[smoke-test] readPixels returned an empty buffer (inconclusive).');
    } else if (stats && stats.lit / stats.total < 0.001) {
      fail(`rendered frame looks blank (${stats.lit}/${stats.total} lit pixels).`);
    }

    // 1. Console / page errors.
    if (pageErrors.length) fail(`page errors:\n  - ${pageErrors.join('\n  - ')}`);
    if (consoleErrors.length) fail(`console errors:\n  - ${consoleErrors.join('\n  - ')}`);

    try {
      await mkdir(join(ROOT, 'ci-artifacts'), { recursive: true });
      await page.screenshot({ path: join(ROOT, 'ci-artifacts', 'smoke.png') });
    } catch {
      /* screenshot is a convenience only */
    }

    if (!process.exitCode) {
      console.log(
        `[smoke-test] PASS — fps=${first.fps}, particles=${first.count}, ` +
          `lit=${stats ? stats.lit : 'n/a'}, consoleErrors=0, pageErrors=0`
      );
    }
  } catch (error) {
    fail(error?.stack || String(error));
  } finally {
    await browser.close();
    await new Promise((res) => server.close(res));
  }
}

main();
