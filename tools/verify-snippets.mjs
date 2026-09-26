#!/usr/bin/env node
// Snippet-verification harness for the bilingual Flutter Deep Dive course.
//
// Unlike the astro/svelte/react/nextjs sibling courses (the site framework
// IS the subject), this course is ABOUT Flutter/Dart while the site itself
// is Astro + Starlight — there is no in-browser Dart/Flutter playground
// (`flutter analyze`/`flutter test` need a real Dart SDK, far heavier than
// DartPad's own WASM analyzer), so the only way to prove a lesson's `dart`
// fence actually compiles (and, for a `_test.dart` fence, actually passes)
// is a real Flutter project ("the probe", tools/probe/, gitignored) plus
// `flutter analyze` (fast, every fence) and `flutter test` (per-lesson or
// full corpus, for lessons that ship a widget/unit test fence).
//
// Modeled on astro-deep-dive/tools/verify-snippets.mjs — same shape
// (ensureProbe/buildLessonsTree/check-mode/--test/--self-test/--refresh),
// same string/bracket scanner ported verbatim from that file's own port of
// tools/check-parity.mjs (quiz-array + `<SpotTheBug code={\`...\`}>` aware),
// same "own-lesson-first, else first lesson in module/file order" owners
// map for cross-fence import resolution. Adapted where Dart/Flutter's own
// conventions differ from Astro's:
//   - ONE fence language (`dart`) instead of astro/ts/js/mjs/tsx/jsx, and a
//     single path-comment convention (no dual `<!-- -->`/frontmatter form —
//     dart has no frontmatter-fence quirk to work around).
//   - A SECOND fence language (`yaml`) is special-cased, not collected as a
//     probe file: a `# pubspec.yaml` fence contributes its
//     `dependencies:`/`dev_dependencies:` entries to a union merged into the
//     probe's real pubspec.yaml (spec §5) — conflicting version constraints
//     for the same package across two lessons is a hard error naming both.
//   - Dart's `package:<name>/...` import convention replaces Astro's `@/`
//     alias: this course's own pubspec.yaml fence example declares
//     `name: my_app` (tooling-and-production/project-and-tooling.mdx) — the
//     sample app name a lesson's own fences import via
//     `package:my_app/...`. The probe's REAL package name is `probe`
//     (`flutter create --project-name probe`), so a `package:my_app/...`
//     import is rewritten to `package:probe/lessons/<ns>/...` — a `package:`
//     import, not a relative path, exactly like a real Dart package: URIs
//     resolve to `lib/` regardless of physical file location, which sidesteps
//     the ugly `../../../../lib/...` relative climb a `test/` fence
//     importing a `lib/` fence would otherwise need. A bare/relative import
//     between two fences of the SAME lesson (e.g. `import 'cart_item.dart';`
//     from another `lib/` fence) is resolved the same way, through the same
//     owners map, and rewritten to the namespaced `package:probe/lessons/...`
//     form too (simpler than preserving relative structure, and identical
//     effect since the namespaced tree preserves each fence's original
//     sub-path under `lib/`). A resolved owner under `test/` (a test fence
//     importing another test fence's helper — package: URIs can't address
//     `test/`) falls back to a real relative path between the two
//     namespaced destinations.
//   - No `--build` mode: `flutter build web`/`apk` per lesson was assessed
//     as too slow for routine verification (a single `flutter analyze` over
//     the whole probe already costs several seconds; a per-lesson
//     `flutter build` would run a full Gradle/web build for every lesson
//     that ships one) — documented as a known, accepted gap in the README
//     and this file's own `--build` handler, which prints that instead of
//     doing it.
//   - `--all-dart`: this course's baseline corpus (Phase 1+2) predates the
//     `// lib/...dart` / `// test/..._test.dart` path-comment convention —
//     EVERY one of its 62 `dart` fences is a narrative fragment today (no
//     class/method wrapper), so default (check) mode collects zero fences
//     from it, which is the CORRECT, honest outcome (see spec §5, README).
//     `--all-dart` is a separate, coarser mode for exactly this baseline: it
//     drops every dart fence, convention or not, at
//     `lib/lessons/<ns>/fence<N>.dart` and reports `flutter analyze` issue
//     counts per lesson — useful as a sanity signal (are these fragments at
//     least free of anything that isn't explainable by "it's a fragment"?)
//     but NOT part of the pass/fail gate (`npm run verify`/default mode is).
//
// Usage:
//   node tools/verify-snippets.mjs                 flutter analyze every collected
//                                                   `// lib|test/...` fence
//   node tools/verify-snippets.mjs --refresh        wipe + rescaffold tools/probe first
//   node tools/verify-snippets.mjs --strict         also fail (exit 1) on warnings/infos
//   node tools/verify-snippets.mjs --test [module/lesson]
//                                                   `flutter test` over collected
//                                                   `_test.dart` fences (all, or one lesson)
//   node tools/verify-snippets.mjs --all-dart       dump EVERY dart fence as its own
//                                                   fragment file, report analyzer issue
//                                                   counts per lesson (baseline sanity only)
//   node tools/verify-snippets.mjs --clean          rm -rf tools/probe/{build,.dart_tool}
//   node tools/verify-snippets.mjs --build <m>/<l>  NOT IMPLEMENTED — see file-header note
//   node tools/verify-snippets.mjs --self-test      harness self-check (see selfTest())
//
// Fence convention (spec §1/§5): a `dart` fence whose FIRST line is
// `// lib/<...>.dart` or `// test/<...>_test.dart` is a real file — the path
// comment line is KEPT (inert) in the written probe file, never stripped (no
// benefit to stripping it: re-deriving line numbers for diagnostics would
// need it stripped-with-newline-preserved for zero gain, same choice the
// astro harness makes). A trailing ` — comment` after the path itself is
// tolerated, not required. A first line containing `@expect-error` is a
// deliberate-error demo and is SKIPPED entirely (never written to the probe
// — the lesson prose carries the real error/output). Anything else (no
// recognized path comment) is a fragment, skipped by default mode (still
// picked up by `--all-dart`).
//
// A `yaml` fence whose first line is exactly `# pubspec.yaml` contributes to
// the probe's dependency union (see collectPubspecUnion/applyPubspecUnion
// below); any other `yaml` fence is an ordinary skipped fragment (e.g. the
// `flutter: assets:/fonts:` snippets already in the corpus today, which
// aren't a full pubspec.yaml and aren't meant to be merged).

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PROBE_DIR = path.join(REPO_ROOT, 'tools/probe');
const LIB_LESSONS_DIR = path.join(PROBE_DIR, 'lib/lessons');
const TEST_LESSONS_DIR = path.join(PROBE_DIR, 'test/lessons');
const DOCS_EN = path.join(REPO_ROOT, 'src/content/docs/en');

// Hard rule: use the SDK at ~/flutter/bin (3.47.5 stable) — never `flutter
// upgrade`/`flutter channel`. Falls back to PATH if that install ever moves.
function resolveBin(name) {
  const candidate = path.join(os.homedir(), 'flutter/bin', name);
  return existsSync(candidate) ? candidate : name;
}
const FLUTTER_BIN = resolveBin('flutter');
const DART_BIN = resolveBin('dart');

const FENCE_LANGS = new Set(['dart', 'yaml']);

// This course's own pubspec.yaml fence examples declare `name: my_app` (see
// tooling-and-production/project-and-tooling.mdx) — the sample app name a
// lesson's `package:my_app/...` import refers to. Checked against the real
// corpus (spec's own request): zero lessons use a different app name today.
// ponytail: hardcoded from the one example found — if a future lesson uses a
// different sample app name, add it here rather than trying to infer it
// from every pubspec fence's own `name:` field (adds real complexity for a
// case that doesn't exist in the corpus yet).
const APP_NAME = 'my_app';

const DART_LIB_TOKEN = String.raw`lib\/[\w\-./]+\.dart`;
const DART_TEST_TOKEN = String.raw`test\/[\w\-./]+_test\.dart`;
const DART_PATH_RE = new RegExp(`^\\/\\/ (${DART_LIB_TOKEN}|${DART_TEST_TOKEN})(?:\\s+\\S.*)?$`);

// ---------------------------------------------------------------------------
// String/bracket scanning helpers, ported VERBATIM from
// astro-deep-dive/tools/verify-snippets.mjs (itself ported from this
// course's own tools/check-parity.mjs) — walks the source honoring string
// literals so a quiz array's or `<SpotTheBug code={\`...\`}>`'s embedded
// ``` sequence never looks like a real fence to the scanner below.
// ---------------------------------------------------------------------------

function parseStringAt(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      j++;
      break;
    }
    j++;
  }
  return { end: j };
}

function scanBalanced(text, start, open, close) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = parseStringAt(text, i).end;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  return i;
}

function findExcludedRanges(src) {
  const ranges = [];
  {
    const re = /export\s+const\s+\w+\s*=\s*\[/g;
    let m;
    while ((m = re.exec(src))) {
      const end = scanBalanced(src, re.lastIndex, '[', ']');
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  {
    const re = /<SpotTheBug\s+code=\{\s*`/g;
    let m;
    while ((m = re.exec(src))) {
      const backtickIdx = m.index + m[0].length - 1;
      const { end } = parseStringAt(src, backtickIdx);
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  return ranges;
}

function stripExcluded(src, ranges) {
  if (!ranges.length) return src;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out += src.slice(cursor, start);
    out += src.slice(start, end).replace(/[^\n]/g, '');
    cursor = end;
  }
  out += src.slice(cursor);
  return out;
}

function countNewlinesBefore(s, upto) {
  let n = 0;
  for (let i = 0; i < upto; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// Collect every fenced code block in one MDX file's source.
// Returns [{ fenceNum, lang, line, category, path?, body? }]. `body` is kept
// for every category (even skipped ones) so --all-dart and --self-test can
// reuse a single scan. `category` is one of:
//   'collected'       — dart fence with a recognized `// lib|test/...` path,
//                        or yaml fence with first line `# pubspec.yaml`
//   'skipped-no-path' — fence in scope (dart/yaml) with no recognized marker
//   'expect-error'    — dart fence whose first line has `@expect-error`
function collectFences(rawSrc) {
  const src = stripExcluded(rawSrc, findExcludedRanges(rawSrc));
  const fenceRe = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;
  const results = [];
  let fenceNum = 0;
  let m;
  while ((m = fenceRe.exec(src))) {
    fenceNum++;
    const lang = m[1];
    if (!FENCE_LANGS.has(lang)) continue;
    const body = m[2];
    const line = countNewlinesBefore(src, m.index) + 1;
    const firstLine = body.split('\n')[0].trim();

    if (lang === 'yaml') {
      if (firstLine === '# pubspec.yaml') {
        results.push({ fenceNum, lang, line, category: 'collected', body });
      } else {
        results.push({ fenceNum, lang, line, category: 'skipped-no-path', body });
      }
      continue;
    }

    // lang === 'dart'
    if (firstLine.includes('@expect-error')) {
      results.push({ fenceNum, lang, line, category: 'expect-error', body });
      continue;
    }
    const pm = DART_PATH_RE.exec(firstLine);
    if (pm) {
      results.push({ fenceNum, lang, line, category: 'collected', path: pm[1], body });
    } else {
      results.push({ fenceNum, lang, line, category: 'skipped-no-path', body });
    }
  }
  return results;
}

// Where a collected dart fence's `lib/...` or `test/..._test.dart` path
// lands inside the probe.
function destRelPath(ns, srcPath) {
  if (srcPath.startsWith('lib/')) return path.posix.join('lib/lessons', ns, srcPath.slice('lib/'.length));
  if (srcPath.startsWith('test/')) return path.posix.join('test/lessons', ns, srcPath.slice('test/'.length));
  return path.posix.join('lib/lessons', ns, srcPath); // unreachable given DART_PATH_RE, kept defensive
}

// Resolve a bare/relative (`foo.dart`, `./foo.dart`, `../foo.dart`) or
// `package:my_app/...` specifier (found inside a fence originally at
// `fenceSrcPath`) to the `lib/...`/`test/...`-rooted key it names — the
// exact string used as the fence's own `path` / owners-map key. Any other
// `package:...` import (flutter, flutter_test, flutter_riverpod, go_router,
// mocktail, test, ...) is a real external package and is left alone (`null`).
function resolveDartKey(spec, fenceSrcPath) {
  if (spec.startsWith(`package:${APP_NAME}/`)) return 'lib/' + spec.slice(`package:${APP_NAME}/`.length);
  if (spec.startsWith('package:')) return null;
  const dir = path.posix.dirname(fenceSrcPath);
  return path.posix.normalize(path.posix.join(dir, spec));
}

// Rewrite every `import`/`export` specifier that resolves (via
// resolveDartKey) to another collected fence's key, to that fence's real
// probe location: a `package:probe/lessons/<ownerNs>/...` import when the
// target lands under `lib/` (package: URIs address `lib/` regardless of
// physical location — sidesteps an ugly relative climb for a `test/` fence
// importing a `lib/` fence), or a real relative path when the target lands
// under `test/` (package: URIs can't address `test/`). Already-namespaced
// `package:probe/lessons/...` imports are left as-is. An unresolvable
// specifier is left untouched, so `flutter analyze`'s own "target of URI
// doesn't exist" error surfaces for it — the honest outcome for a snippet
// that doesn't spell out what it imports (same policy as the astro harness).
function rewriteDartImports(body, fenceSrcPath, ns, owners, ownKeys) {
  const hereDir = path.posix.dirname(destRelPath(ns, fenceSrcPath));
  return body.replace(
    /\b(import|export)(\s+)(['"])((?:package:[\w.]+\/[^'"]*\.dart)|(?:\.\.?\/)?[\w\-./]+\.dart)\3/g,
    (whole, kw, ws, q, spec) => {
      if (spec.startsWith('package:probe/lessons/')) return whole;
      const key = resolveDartKey(spec, fenceSrcPath);
      if (!key) return whole;
      const ownerNs = ownKeys.has(key) ? ns : owners.get(key)?.[0];
      if (!ownerNs) return whole;
      const rewritten = key.startsWith('lib/')
        ? `package:probe/lessons/${ownerNs}/${key.slice('lib/'.length)}`
        : path.posix.relative(hereDir, destRelPath(ownerNs, key));
      return `${kw}${ws}${q}${rewritten}${q}`;
    },
  );
}

// ---------------------------------------------------------------------------
// pubspec.yaml dependency union (spec §5)
// ---------------------------------------------------------------------------

// Minimal line-based parser for the one YAML shape a `# pubspec.yaml` fence
// actually needs: top-level `dependencies:`/`dev_dependencies:` maps of
// `name: ^1.2.3` (a real semver constraint, recorded) or `name:` followed by
// a nested block (`sdk: flutter`/`hosted: ...` — recorded with a `null`
// constraint, since there's nothing to compare for conflicts). Anything
// deeper than one indent level under a package name is ignored.
// ponytail: no YAML library — pubspec dependency blocks are a tiny, fixed
// subset of YAML; a real parser would be a new dependency for three lines
// of indentation logic.
function parseDepsBody(body) {
  const sections = { dependencies: new Map(), devDependencies: new Map() };
  let section = null;
  for (const raw of body.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    if (indent === 0) {
      section = line === 'dependencies:' ? 'dependencies' : line === 'dev_dependencies:' ? 'devDependencies' : null;
      continue;
    }
    if (!section || indent !== 2) continue;
    const m = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, rest] = m;
    sections[section].set(name, rest.trim() || null);
  }
  return sections;
}

// Union every `# pubspec.yaml` fence's dependencies/devDependencies across
// ALL lessons. A real conflict is two lessons declaring a DIFFERENT,
// non-null constraint string for the same package name.
function collectPubspecUnion(descriptors) {
  const dependencies = new Map(); // name -> { constraint, mdxRelPath }
  const devDependencies = new Map();
  const conflicts = [];
  for (const d of descriptors) {
    const src = readFileSync(d.absPath, 'utf8');
    for (const f of collectFences(src)) {
      if (f.lang !== 'yaml' || f.category !== 'collected') continue;
      const parsed = parseDepsBody(f.body);
      for (const [target, map] of [
        ['dependencies', dependencies],
        ['devDependencies', devDependencies],
      ]) {
        for (const [name, constraint] of parsed[target]) {
          const existing = map.get(name);
          if (existing?.constraint && constraint && existing.constraint !== constraint) {
            conflicts.push({ name, a: existing, b: { constraint, mdxRelPath: d.mdxRelPath } });
            continue;
          }
          if (!existing || (!existing.constraint && constraint)) map.set(name, { constraint, mdxRelPath: d.mdxRelPath });
        }
      }
    }
  }
  return { dependencies, devDependencies, conflicts };
}

// Merge a pubspec union into the probe's REAL pubspec.yaml via `dart pub
// add` (resolves each package's current pub.dev version — never
// hand-pinned). Fatal on a real conflict (names both lessons).
function applyPubspecUnion(descriptors) {
  const { dependencies, devDependencies, conflicts } = collectPubspecUnion(descriptors);
  if (conflicts.length) {
    console.error('pubspec.yaml fence dependency conflicts:');
    for (const c of conflicts) {
      console.error(`  ${c.name}: ${c.a.constraint} (${c.a.mdxRelPath}) vs ${c.b.constraint} (${c.b.mdxRelPath})`);
    }
    process.exit(1);
  }
  const pubspecPath = path.join(PROBE_DIR, 'pubspec.yaml');
  const currentPubspec = readFileSync(pubspecPath, 'utf8');
  const addArgs = [];
  const addDevArgs = [];
  for (const [name, info] of dependencies) {
    if (name === 'flutter' || currentPubspec.includes(`\n  ${name}:`)) continue;
    addArgs.push(info.constraint ? `${name}:${info.constraint}` : name);
  }
  for (const [name, info] of devDependencies) {
    if (['flutter', 'flutter_test', 'flutter_lints'].includes(name) || currentPubspec.includes(`\n  ${name}:`)) continue;
    addDevArgs.push(info.constraint ? `${name}:${info.constraint}` : name);
  }
  if (addArgs.length) {
    const r = spawnSync(DART_BIN, ['pub', 'add', ...addArgs], { cwd: PROBE_DIR, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('dart pub add (pubspec-fence dependencies) failed');
      process.exit(1);
    }
  }
  if (addDevArgs.length) {
    const r = spawnSync(DART_BIN, ['pub', 'add', '--dev', ...addDevArgs], { cwd: PROBE_DIR, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('dart pub add --dev (pubspec-fence devDependencies) failed');
      process.exit(1);
    }
  }
}

// Always present regardless of what any lesson's own pubspec fence
// declares, at whatever pub.dev resolves as current (spec §5).
// `flutter_test` is already a default dev dependency from `flutter create`.
const MANDATORY_DEPS = ['flutter_riverpod', 'go_router'];
const MANDATORY_DEV_DEPS = ['mocktail'];

function ensureDependencies() {
  applyPubspecUnion(discoverLessons());
  const pubspecPath = path.join(PROBE_DIR, 'pubspec.yaml');
  const currentPubspec = readFileSync(pubspecPath, 'utf8');
  const missingDeps = MANDATORY_DEPS.filter((n) => !currentPubspec.includes(`\n  ${n}:`));
  const missingDevDeps = MANDATORY_DEV_DEPS.filter((n) => !currentPubspec.includes(`\n  ${n}:`));
  if (missingDeps.length) {
    const r = spawnSync(DART_BIN, ['pub', 'add', ...missingDeps], { cwd: PROBE_DIR, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('dart pub add (mandatory deps) failed');
      process.exit(1);
    }
  }
  if (missingDevDeps.length) {
    const r = spawnSync(DART_BIN, ['pub', 'add', '--dev', ...missingDevDeps], { cwd: PROBE_DIR, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('dart pub add --dev (mandatory dev deps) failed');
      process.exit(1);
    }
  }
  const get = spawnSync(FLUTTER_BIN, ['pub', 'get'], { cwd: PROBE_DIR, stdio: 'inherit' });
  if (get.status !== 0) {
    console.error('flutter pub get failed');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Probe lifecycle
// ---------------------------------------------------------------------------

// Strict analysis: flutter_lints + the three stricter type-check language
// modes (verified against dart.dev/tools/analysis — all default false,
// usable together). Regenerated every run (safe — no hand-editing expected).
function writeAnalysisOptions() {
  const src = `include: package:flutter_lints/flutter.yaml

analyzer:
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true
  exclude:
    - build/**
    - android/**
    - ios/**
    - web/**
    - windows/**
    - macos/**
    - linux/**
`;
  writeFileSync(path.join(PROBE_DIR, 'analysis_options.yaml'), src);
}

function ensureProbe(refresh) {
  if (refresh && existsSync(PROBE_DIR)) rmSync(PROBE_DIR, { recursive: true, force: true });
  if (!existsSync(PROBE_DIR)) {
    console.log('tools/probe missing — scaffolding with `flutter create --empty`...');
    const create = spawnSync(FLUTTER_BIN, ['create', '--empty', '--project-name', 'probe', 'probe'], {
      cwd: path.join(REPO_ROOT, 'tools'),
      stdio: 'inherit',
    });
    if (create.status !== 0) {
      console.error('probe scaffold failed');
      process.exit(1);
    }
  }
  writeAnalysisOptions();
  ensureDependencies();
}

// ---------------------------------------------------------------------------
// Lesson discovery
// ---------------------------------------------------------------------------

function discoverLessons() {
  const rels = globSync('**/*.mdx', { cwd: DOCS_EN }).sort();
  return rels.map((rel) => {
    const posixRel = rel.replaceAll('\\', '/');
    return {
      absPath: path.join(DOCS_EN, rel),
      mdxRelPath: `src/content/docs/en/${posixRel}`,
      module: posixRel.split('/')[0],
      lesson: path.basename(posixRel, '.mdx'),
    };
  });
}

// ---------------------------------------------------------------------------
// Default/--test mode: collect ONLY convention-following (`collected`) dart
// fences and write the probe's namespaced lib/test trees.
// ---------------------------------------------------------------------------

function buildLessonsTree(descriptors) {
  rmSync(LIB_LESSONS_DIR, { recursive: true, force: true });
  rmSync(TEST_LESSONS_DIR, { recursive: true, force: true });
  mkdirSync(LIB_LESSONS_DIR, { recursive: true });

  const fenceMap = new Map(); // ns -> { mdxRelPath, module, lesson, fences: Map(destRelPath -> fenceNum) }
  const stats = new Map(); // module -> { collected, skippedNoPath, expectError, tests }
  const owners = new Map(); // lib|test-rooted path -> [ns, ...] in module/file order
  const nsKeys = new Map(); // ns -> Set(own keys)
  const pending = []; // [ns, fence]

  for (const d of descriptors) {
    const counters = stats.get(d.module) ?? { collected: 0, skippedNoPath: 0, expectError: 0, tests: 0 };
    stats.set(d.module, counters);

    const ns = `${d.module}__${d.lesson}`;
    const nsFences = new Map();
    const keys = new Set();
    const src = readFileSync(d.absPath, 'utf8');

    for (const f of collectFences(src)) {
      if (f.lang !== 'dart') continue; // yaml/pubspec handled separately by ensureDependencies
      if (f.category === 'collected') {
        counters.collected++;
        if (f.path.endsWith('_test.dart')) counters.tests++;
        nsFences.set(destRelPath(ns, f.path), f.fenceNum);
        keys.add(f.path);
        const list = owners.get(f.path) ?? [];
        if (!list.includes(ns)) list.push(ns);
        owners.set(f.path, list);
        pending.push([ns, f]);
      } else if (f.category === 'skipped-no-path') {
        counters.skippedNoPath++;
      } else if (f.category === 'expect-error') {
        counters.expectError++;
      }
    }
    fenceMap.set(ns, { mdxRelPath: d.mdxRelPath, module: d.module, lesson: d.lesson, fences: nsFences });
    nsKeys.set(ns, keys);
  }

  for (const [ns, f] of pending) {
    const destAbs = path.join(PROBE_DIR, destRelPath(ns, f.path));
    mkdirSync(path.dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, rewriteDartImports(f.body, f.path, ns, owners, nsKeys.get(ns)));
  }

  return { fenceMap, stats };
}

function printStats(stats) {
  console.log('\nPer-module fence summary (collected / skipped-no-path / expect-error / tests):');
  const totals = { collected: 0, skippedNoPath: 0, expectError: 0, tests: 0 };
  for (const [module, c] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${module}: ${c.collected} / ${c.skippedNoPath} / ${c.expectError} / ${c.tests}`);
    totals.collected += c.collected;
    totals.skippedNoPath += c.skippedNoPath;
    totals.expectError += c.expectError;
    totals.tests += c.tests;
  }
  console.log(`  TOTAL: ${totals.collected} / ${totals.skippedNoPath} / ${totals.expectError} / ${totals.tests}`);
}

// ---------------------------------------------------------------------------
// `flutter analyze` output parsing, shared by check mode and --all-dart.
//
// Verified directly against the installed flutter@3.47.5's own output (not
// assumed): one line per diagnostic, ANSI-colored,
//   `<severity> • <message> • <relative/path.dart>:<line>:<col> • <lint_code>`
// where severity is `error`/`warning`/`info`. Crucially, `flutter analyze`
// exits 1 for warnings-only too — this harness never trusts the exit code
// for pass/fail, only the parsed severities (verified: a warning-only run
// exits 1 same as an error run).
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DIAG_LINE_RE = /^(error|warning|info)\s*•\s*(.+?)\s*•\s*(.+):(\d+):(\d+)\s*•\s*(\S+)$/;

function parseAnalyzeOutput(stdout) {
  const clean = stdout.replace(ANSI_RE, '');
  const diagnostics = [];
  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim();
    const m = DIAG_LINE_RE.exec(line);
    if (!m) continue;
    const [, severity, message, file, lineNum, col, code] = m;
    diagnostics.push({ severity, message, file: file.trim(), line: Number(lineNum), col: Number(col), code });
  }
  return diagnostics;
}

// `relPath` is already probe-relative (`flutter analyze` runs with cwd=PROBE_DIR).
function mapDiagnosticFile(fenceMap, relPath) {
  const norm = relPath.replaceAll('\\', '/');
  const m = /^(?:lib|test)\/lessons\/([^/]+)\/(.+)$/.exec(norm);
  if (!m) return null;
  const info = fenceMap.get(m[1]);
  if (!info) return null;
  return { mdxRelPath: info.mdxRelPath, module: info.module, lesson: info.lesson, relPath: norm, fenceNum: info.fences.get(norm) };
}

// ---------------------------------------------------------------------------
// Check mode (default): `flutter analyze --no-pub` once over the whole probe.
// ---------------------------------------------------------------------------

function runAnalyze(descriptors, { strict = false } = {}) {
  const { fenceMap, stats } = buildLessonsTree(descriptors);

  const res = spawnSync(FLUTTER_BIN, ['analyze', '--no-pub', '.'], { cwd: PROBE_DIR, encoding: 'utf8' });
  if (res.error) {
    console.error('failed to run flutter analyze in the probe:', res.error.message);
    process.exit(1);
  }

  const diagnostics = parseAnalyzeOutput(res.stdout ?? '').map((d) => ({ ...d, mapped: mapDiagnosticFile(fenceMap, d.file) }));
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning' || d.severity === 'info');

  if (diagnostics.length) {
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s):\n`);
    for (const d of diagnostics) {
      const where = d.mapped
        ? `${d.mapped.mdxRelPath}:fence #${d.mapped.fenceNum} (${d.mapped.relPath})`
        : `[unmapped] ${d.file}`;
      console.log(`${d.severity} ${where} — probe:${d.file}:${d.line}:${d.col} (${d.code}): ${d.message}`);
    }
  } else if (!/No issues found/.test(res.stdout ?? '')) {
    console.log('\nflutter analyze produced no parseable diagnostics; raw output:\n');
    console.log((res.stdout ?? '') + (res.stderr ?? ''));
  } else {
    console.log('\nno errors, no warnings.');
  }

  printStats(stats);

  const fail = errors.length > 0 || (strict && warnings.length > 0);
  return { errorCount: errors.length, warningCount: warnings.length, diagnostics, stats, fail };
}

// ---------------------------------------------------------------------------
// --all-dart: baseline sanity mode (see file-header note) — every dart fence,
// convention or not, dropped as its own fragment file.
// ---------------------------------------------------------------------------

function allDartMode() {
  const descriptors = discoverLessons();
  rmSync(LIB_LESSONS_DIR, { recursive: true, force: true });
  mkdirSync(LIB_LESSONS_DIR, { recursive: true });

  const fenceMap = new Map();
  let lessonsWithDart = 0;
  for (const d of descriptors) {
    const ns = `${d.module}__${d.lesson}`;
    const src = readFileSync(d.absPath, 'utf8');
    const fences = collectFences(src).filter((f) => f.lang === 'dart');
    if (!fences.length) continue;
    lessonsWithDart++;
    const nsFences = new Map();
    for (const f of fences) {
      const relPath = path.posix.join('lib/lessons', ns, `fence${f.fenceNum}.dart`);
      mkdirSync(path.dirname(path.join(PROBE_DIR, relPath)), { recursive: true });
      writeFileSync(path.join(PROBE_DIR, relPath), f.body ?? '');
      nsFences.set(relPath, f.fenceNum);
    }
    fenceMap.set(ns, { mdxRelPath: d.mdxRelPath, module: d.module, lesson: d.lesson, fences: nsFences });
  }

  const res = spawnSync(FLUTTER_BIN, ['analyze', '--no-pub', '.'], { cwd: PROBE_DIR, encoding: 'utf8' });
  const diagnostics = parseAnalyzeOutput(res.stdout ?? '');

  const perLesson = new Map();
  for (const d of diagnostics) {
    const mapped = mapDiagnosticFile(fenceMap, d.file);
    const key = mapped ? `${mapped.module}/${mapped.lesson}` : '[unmapped]';
    perLesson.set(key, (perLesson.get(key) ?? 0) + 1);
  }

  console.log('\n--all-dart: every dart fence dumped as its own fragment file (no path-comment');
  console.log('convention applied) — baseline sanity signal only, NOT part of the pass/fail gate.');
  console.log('Per-lesson flutter-analyze issue counts (errors+warnings+infos):');
  let total = 0;
  for (const [lesson, count] of [...perLesson.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${lesson}: ${count}`);
    total += count;
  }
  console.log(`  TOTAL: ${total} issue(s) across ${lessonsWithDart} lesson(s) with dart fences`);

  rmSync(LIB_LESSONS_DIR, { recursive: true, force: true });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --test [module/lesson]: `flutter test` over collected `_test.dart` fences.
//
// `flutter test --reporter=silent --file-reporter=json:<file>` writes
// newline-delimited JSON test-runner protocol events (verified directly:
// this is NOT one JSON blob like vitest's --reporter=json, it's one JSON
// object per line — `suite`/`testStart`/`testDone`/`error`/`done`).
// ---------------------------------------------------------------------------

function testMode(target) {
  const descriptors = discoverLessons();
  const { fenceMap } = buildLessonsTree(descriptors);

  let testDir = 'test/lessons';
  if (target) {
    const parts = target.split('/');
    const lesson = parts.pop();
    const module = parts.join('/');
    const ns = `${module}__${lesson}`;
    if (!fenceMap.has(ns)) {
      console.error(`no such lesson: ${target}`);
      process.exit(1);
    }
    testDir = `test/lessons/${ns}`;
  }

  if (!existsSync(path.join(PROBE_DIR, testDir))) {
    console.log(`${target ?? 'corpus'}: no test fences collected yet (${testDir} is empty) — nothing to run.`);
    process.exit(0);
  }

  const outFile = path.join(os.tmpdir(), `verify-snippets-flutter-test-${process.pid}-${Date.now()}.json`);
  const res = spawnSync(FLUTTER_BIN, ['test', '--reporter=silent', `--file-reporter=json:${outFile}`, testDir], {
    cwd: PROBE_DIR,
    encoding: 'utf8',
  });

  const events = [];
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip an unparsable line rather than crash the whole report
      }
    }
    rmSync(outFile, { force: true });
  }

  if (!events.length) {
    console.log((res.stdout ?? '') + (res.stderr ?? ''));
    process.exit(res.status ?? 1);
  }

  const suites = new Map(); // id -> path
  const tests = new Map(); // id -> { name, suiteID }
  const hidden = new Set();
  const results = new Map(); // testID -> result
  for (const e of events) {
    if (e.type === 'suite') suites.set(e.suite.id, e.suite.path);
    else if (e.type === 'testStart') tests.set(e.test.id, { name: e.test.name, suiteID: e.test.suiteID });
    else if (e.type === 'testDone') {
      if (e.hidden) hidden.add(e.testID); // synthetic "loading ..." entries
      results.set(e.testID, e.result);
    }
  }

  const byLesson = new Map();
  for (const [id, t] of tests) {
    if (hidden.has(id)) continue;
    const suitePath = (suites.get(t.suiteID) ?? '').replaceAll('\\', '/');
    const m = /(?:^|\/)test\/lessons\/([^/]+)\//.exec(suitePath);
    const info = m && fenceMap.get(m[1]);
    const label = info ? `${info.module}/${info.lesson}` : (m ? m[1] : '[unmapped]');
    const list = byLesson.get(label) ?? [];
    list.push({ name: t.name, result: results.get(id) });
    byLesson.set(label, list);
  }

  let passedTotal = 0;
  let totalTotal = 0;
  for (const [label, list] of [...byLesson.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const passed = list.filter((t) => t.result === 'success').length;
    console.log(`${label}: ${passed}/${list.length} passed`);
    for (const t of list.filter((t) => t.result !== 'success')) console.log(`  FAIL ${t.name}`);
    passedTotal += passed;
    totalTotal += list.length;
  }
  console.log(`\n${passedTotal}/${totalTotal} test(s) passed across ${suites.size} file(s).`);
  process.exit(passedTotal === totalTotal ? 0 : 1);
}

// ---------------------------------------------------------------------------
// --clean
// ---------------------------------------------------------------------------

function cleanMode() {
  rmSync(path.join(PROBE_DIR, 'build'), { recursive: true, force: true });
  rmSync(path.join(PROBE_DIR, '.dart_tool'), { recursive: true, force: true });
  console.log('cleaned tools/probe/build and tools/probe/.dart_tool');
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'verify-snippets-flutter-selftest-'));
  const mdxPath = path.join(tmpDir, 'self.mdx');

  writeFileSync(
    mdxPath,
    [
      '---',
      'title: selftest',
      '---',
      '',
      '```dart',
      '// lib/widgets/good.dart',
      "import 'package:flutter/material.dart';",
      '',
      'class GoodWidget extends StatelessWidget {',
      '  const GoodWidget({super.key});',
      '  @override',
      "  Widget build(BuildContext context) => const Text('hello');",
      '}',
      '```',
      '',
      '```dart',
      '// lib/widgets/bad.dart — real analyzer error on purpose',
      'int compute() {',
      '  return undefinedThing;',
      '}',
      '```',
      '',
      '```dart',
      "// @expect-error Undefined name 'reallyUndefined'",
      'int broken() {',
      '  return reallyUndefined;',
      '}',
      '```',
      '',
      '```yaml',
      '# pubspec.yaml',
      'dependencies:',
      '  characters: ^1.3.0',
      '```',
      '',
      '```dart',
      '// test/widgets/good_test.dart',
      "import 'package:flutter/material.dart';",
      "import 'package:flutter_test/flutter_test.dart';",
      "import 'package:my_app/widgets/good.dart';",
      '',
      'void main() {',
      "  testWidgets('GoodWidget shows hello', (tester) async {",
      '    await tester.pumpWidget(const MaterialApp(home: GoodWidget()));',
      "    expect(find.text('hello'), findsOneWidget);",
      '  });',
      '}',
      '```',
      '',
    ].join('\n'),
  );

  const descriptors = [{ absPath: mdxPath, mdxRelPath: 'selftest/self.mdx', module: '__selftest__', lesson: 'self' }];
  const ns = '__selftest____self';

  // Exercises the pubspec-fence union against the REAL shared probe.
  applyPubspecUnion(descriptors);
  const pubspecApplied = readFileSync(path.join(PROBE_DIR, 'pubspec.yaml'), 'utf8').includes('\n  characters:');

  const parsed = collectFences(readFileSync(mdxPath, 'utf8'));
  const expectErrorSkipped =
    parsed.filter((f) => f.category === 'expect-error').length === 1 &&
    parsed.filter((f) => f.lang === 'dart' && f.category === 'collected').length === 3;

  const { diagnostics } = runAnalyze(descriptors);
  const badFailed = diagnostics.some(
    (d) => d.severity === 'error' && d.mapped?.relPath === `lib/lessons/${ns}/widgets/bad.dart`,
  );
  const goodPassed = !diagnostics.some(
    (d) => d.severity === 'error' && d.mapped?.relPath === `lib/lessons/${ns}/widgets/good.dart`,
  );

  const outFile = path.join(os.tmpdir(), `verify-snippets-flutter-selftest-test-${process.pid}.json`);
  spawnSync(FLUTTER_BIN, ['test', '--reporter=silent', `--file-reporter=json:${outFile}`, `test/lessons/${ns}`], {
    cwd: PROBE_DIR,
    encoding: 'utf8',
  });
  let testPassed = false;
  if (existsSync(outFile)) {
    const events = readFileSync(outFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    testPassed = events.some((e) => e.type === 'done' && e.success === true);
    rmSync(outFile, { force: true });
  }

  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(LIB_LESSONS_DIR, { recursive: true, force: true });
  rmSync(TEST_LESSONS_DIR, { recursive: true, force: true });

  const detail = { badFailed, goodPassed, expectErrorSkipped, pubspecApplied, testPassed };
  const ok = Object.values(detail).every(Boolean);
  if (ok) {
    console.log(
      '\nself-test: PASS (bad-widget fence failed flutter analyze, good widget + its ' +
        'package:my_app-rewritten widget test passed, @expect-error fence skipped entirely, ' +
        'pubspec.yaml fence dependency applied)',
      detail,
    );
    process.exit(0);
  }
  console.error('\nself-test: FAIL', detail);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clean')) return cleanMode();

  if (args.includes('--build')) {
    console.log(
      '--build <module>/<lesson>: not implemented — a per-lesson `flutter build web`/`apk` was ' +
        'assessed as too slow for routine verification (see README "Known gaps"). Run it by hand ' +
        'for a lesson that makes a build-specific claim.',
    );
    process.exit(0);
  }

  ensureProbe(args.includes('--refresh'));

  if (args.includes('--self-test')) return selfTest();
  if (args.includes('--all-dart')) return allDartMode();

  const testIdx = args.indexOf('--test');
  if (testIdx !== -1) {
    const maybeTarget = args[testIdx + 1];
    return testMode(maybeTarget && !maybeTarget.startsWith('--') ? maybeTarget : undefined);
  }

  const { fail } = runAnalyze(discoverLessons(), { strict: args.includes('--strict') });
  process.exit(fail ? 1 : 0);
}

main();
