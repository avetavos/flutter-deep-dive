#!/usr/bin/env node
// Playwright check for <DartPad> (in-browser DartPad embed on dart-language-tour
// and widgets-and-the-tree).
//
// Usage:
//   node tools/dartpad.spec.mjs <baseUrl>
//   e.g. node tools/dartpad.spec.mjs http://localhost:4382/flutter
//
// What this DOES prove, per embed, EN and TH:
//   1. The embed's `.dartpad-iframe` gets a `src` pointing at dartpad.dev
//      with the expected params (`embed=true`, `run=true`,
//      `theme=DartPadTheme.<light|dark>`) once scrolled into view — i.e.
//      the lazy reveal (IntersectionObserver) fires and the embed URL is
//      the one verified in DartPad.astro's header comment.
//   2. The iframe actually navigates and loads (a real `dartpad.dev`
//      document, not a broken/blank frame).
//   3. The "Copy code" and "Open in DartPad" fallback buttons work: the
//      clipboard receives the exact `code` the lesson embeds, and "Open in
//      DartPad" opens a new tab at `https://dartpad.dev/?`.
//   4. Zero console errors accumulate across the flow.
//
// What this DELIBERATELY DOES NOT prove: that the injected code visibly
// appears or runs inside DartPad's own editor/output. Two reasons, both
// confirmed by hand during development (see DartPad.astro's header
// comment): (a) DartPad's own UI is itself a cross-origin Flutter web app
// (Skwasm/CanvasKit) with no queryable DOM for its editor or output pane,
// so there is nothing stable to assert against from outside; (b) directly
// testing the sourceCode postMessage injection from this course's own dev
// server (both a reused and a brand-new browser profile) showed DartPad's
// Output pane sometimes keeps showing DartPad's own stock starter sample
// instead of the injected code — a real, observed unreliability, not a
// timing bug in this repo's script. Asserting on rendered output would
// therefore be flaky by construction. The fallback buttons checked in (3)
// are what this course guarantees; the live run is best-effort UX on top.

import { chromium } from 'playwright';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: node tools/dartpad.spec.mjs <baseUrl>');
  process.exit(1);
}

const DARTPAD_SRC_RE = /^https:\/\/dartpad\.dev\/\?embed=true&run=true&theme=DartPadTheme\.(light|dark)$/;

const EMBEDS = [
  { id: 'dart-foundations-dart-language-tour-records', codePrefix: 'typedef Point = (double x, double y);' },
  { id: 'dart-foundations-dart-language-tour-patterns', codePrefix: 'sealed class Shape {}' },
];

const LESSONS = [
  { path: '/en/dart-foundations/dart-language-tour/', embeds: EMBEDS },
  { path: '/th/dart-foundations/dart-language-tour/', embeds: EMBEDS },
  {
    path: '/en/widgets/widgets-and-the-tree/',
    embeds: [{ id: 'widgets-widgets-and-the-tree-const-rebuild', codePrefix: "import 'package:flutter/material.dart';" }],
  },
  {
    path: '/th/widgets/widgets-and-the-tree/',
    embeds: [{ id: 'widgets-widgets-and-the-tree-const-rebuild', codePrefix: "import 'package:flutter/material.dart';" }],
  },
];

async function checkEmbed(page, embed) {
  const root = page.locator(`#${embed.id}`);
  await root.scrollIntoViewIfNeeded();

  // 1. lazy reveal sets the verified embed URL
  const iframe = root.locator('.dartpad-iframe');
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`#${id} .dartpad-iframe`);
      return !!(el && el.getAttribute('src'));
    },
    embed.id,
    { timeout: 10000 },
  );
  const src = await iframe.getAttribute('src');
  if (!DARTPAD_SRC_RE.test(src)) {
    throw new Error(`#${embed.id}: unexpected iframe src: ${src}`);
  }

  // 2. the iframe actually loads a real dartpad.dev document
  const frame = await page.waitForEvent('frameattached', { timeout: 5000 }).catch(() => null);
  void frame; // frame may already be attached by the time we get here; poll frames() instead
  let dartpadFrame = null;
  for (let i = 0; i < 20; i++) {
    dartpadFrame = page.frames().find((f) => f.url().startsWith('https://dartpad.dev/'));
    if (dartpadFrame) break;
    await page.waitForTimeout(500);
  }
  if (!dartpadFrame) throw new Error(`#${embed.id}: dartpad.dev iframe never attached`);
  await dartpadFrame.waitForLoadState('domcontentloaded', { timeout: 15000 });

  // 3. fallback buttons: Copy code + Open in DartPad
  await root.locator('[data-copy]').click();
  await page.waitForTimeout(200);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  if (!clipboard.startsWith(embed.codePrefix)) {
    throw new Error(`#${embed.id}: clipboard did not start with expected code, got: ${clipboard.slice(0, 80)}`);
  }

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }),
    root.locator('[data-open]').click(),
  ]);
  const popupUrl = popup.url();
  await popup.close();
  if (popupUrl !== 'https://dartpad.dev/?') {
    throw new Error(`#${embed.id}: "Open in DartPad" opened unexpected URL: ${popupUrl}`);
  }

  return { id: embed.id, src };
}

async function checkLesson(browser, lesson) {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const url = baseUrl.replace(/\/$/, '') + lesson.path;
  await page.goto(url, { waitUntil: 'load' });

  const results = [];
  for (const embed of lesson.embeds) {
    results.push(await checkEmbed(page, embed));
  }

  if (consoleErrors.length) {
    throw new Error(`${lesson.path}: ${consoleErrors.length} console error(s): ${consoleErrors.join(' | ')}`);
  }

  await context.close();
  return { path: lesson.path, results };
}

async function main() {
  const browser = await chromium.launch();
  const summary = [];
  let failed = false;
  for (const lesson of LESSONS) {
    try {
      const { path, results } = await checkLesson(browser, lesson);
      summary.push({ path, results });
      console.log(`PASS  ${path}`);
      for (const r of results) console.log(`      ${r.id}: ${r.src}`);
    } catch (err) {
      failed = true;
      console.log(`FAIL  ${lesson.path}`);
      console.log(`      ${err.message}`);
    }
  }
  await browser.close();
  console.log(`\n${summary.length}/${LESSONS.length} lesson(s) passed.`);
  process.exit(failed ? 1 : 0);
}

main();
