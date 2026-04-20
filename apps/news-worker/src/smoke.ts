// Standalone smoke script — NOT wired into the worker's main boot path.
// Invoked explicitly inside the production image to prove Playwright launches
// headless Chromium end-to-end:
//
//   docker run --rm news-worker:local bun run dist/smoke.js
//
// Expected output (single-line JSON): { ok: true, ua: "...HeadlessChrome/...", title: "", chromiumVersion: "..." }

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
// Read the version while the browser is still live — `Browser.version()` is a method.
const chromiumVersion = browser.version();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('about:blank');
const ua = await page.evaluate(() => navigator.userAgent);
const title = await page.title();
await browser.close();

console.log(
  JSON.stringify({
    ok: true,
    ua,
    title,
    chromiumVersion,
  }),
);
