# Flutter Deep Dive

Bilingual (EN/TH) Flutter 3.47 / Dart 3.13 course, built with Astro + Starlight.

## Harness

`tools/verify-snippets.mjs` proves lesson `dart` fences actually compile
(and, where a `_test.dart` fence exists, actually pass) against a real
Flutter 3.47.5 project — a real probe (`tools/probe/`, gitignored) plus
`flutter analyze` / `flutter test` is the only way to catch a snippet that's
subtly wrong; there's no in-browser Dart/Flutter playground for this (DartPad
runs a WASM analyzer, not `flutter test`).

```sh
npm run verify                                       # flutter analyze every collected fence
node tools/verify-snippets.mjs --refresh              # wipe + rescaffold tools/probe first
node tools/verify-snippets.mjs --strict               # also fail on warnings/infos
node tools/verify-snippets.mjs --test [module/lesson]  # flutter test over collected _test.dart fences
node tools/verify-snippets.mjs --all-dart             # baseline sanity: every dart fence, no convention
node tools/verify-snippets.mjs --clean                # rm -rf tools/probe/{build,.dart_tool}
node tools/verify-snippets.mjs --self-test            # harness self-check
```

### Fence convention

A collectible `dart` fence's first line is a path comment naming the real
file it represents; the line is kept (inert) in the written probe file.

- `` ```dart `` — first line `// lib/<...>.dart` or
  `// test/<...>_test.dart`. A trailing ` — comment` after the path itself
  is tolerated.
- A first line containing `@expect-error` is a deliberate-error demo and is
  **skipped entirely** — never written to the probe, never analyzed. The
  lesson prose carries the real error/output.
- Anything else (no recognized path comment) is a **fragment** — skipped by
  default mode, still picked up by `--all-dart`.
- A `` ```yaml `` fence whose first line is exactly `# pubspec.yaml`
  contributes its `dependencies:`/`dev_dependencies:` entries to a union
  merged into the probe's real pubspec.yaml (see below); any other yaml
  fence (e.g. this course's existing `flutter: assets:/fonts:` snippets) is
  an ordinary skipped fragment.
- Fences inside a quiz `export const ... = [...]` array or a
  `<SpotTheBug code={\`...\`}>` prop are excluded before fence-scanning even
  starts (same string/bracket-scanning technique as `tools/check-parity.mjs`
  and the astro-deep-dive sibling harness — ported, not reinvented).

### Baseline status (Phase 1+2 corpus, before Phase 3 adds path comments)

The current 62 `dart` fences across the corpus are all narrative fragments
(no path comment — this course teaches with in-context snippets, not
DartPad-runnable files). Default mode therefore collects **0** fences today
— `npm run verify` exits 0 with `0 / 62 / 0 / 0` (collected / skipped-no-path
/ expect-error / tests), which is the correct, honest outcome, not a harness
bug. Phase 3 agents add the path comments as they deepen each lesson.

`--all-dart` gives a real signal on that baseline anyway, by dumping every
fence regardless of convention:

```
TOTAL: 747 issue(s) across 26 lesson(s) with dart fences
```

Traced every distinct analyzer/lint code this produces (`missing_function_body`,
`named_parameter_outside_group`, `undefined_function`/`undefined_class`/
`undefined_method`, `extends_non_class`, `strict_top_level_inference` +
`inference_failure_on_*` from this probe's own strict analysis options,
`non_constant_identifier_names`, `avoid_print`, etc.) against the actual
fences that produce them: every one is explained by a fragment sitting
outside any class/method wrapper (e.g. `Navigator.of(context).push(...)` as
a bare top-level statement reads to the analyzer as an attempted function
declaration named `Navigator`) or by this probe's own strict-mode/lint
settings flagging a snippet that was never meant to compile standalone —
**not** a real content bug. This number is higher than an earlier informal
pass (~190, done with a plainer, non-strict `analysis_options.yaml` and SDK
3.44.4) precisely because this probe turns on `flutter_lints` +
`strict-casts`/`strict-raw-types`/`strict-inference` per spec — a stricter
analyzer surfaces more per-fragment noise, not more real bugs. `--all-dart`
is a sanity signal only; it is **not** part of the pass/fail gate.

### Where fences land

- `// lib/<rest>.dart` → `tools/probe/lib/lessons/<module>__<lesson>/<rest>`
- `// test/<rest>_test.dart` → `tools/probe/test/lessons/<module>__<lesson>/<rest>`
- `--all-dart` → every fence (any/no convention) at
  `tools/probe/lib/lessons/<module>__<lesson>/fence<N>.dart`

### Imports

- `import 'package:probe/lessons/...'` (already fully namespaced) — left as-is.
- A relative/bare import between two fences of the **same lesson**
  (`import 'cart_item.dart';`, `import '../models/x.dart';`) is resolved
  through an owners map (own lesson first, else the first lesson in
  module/file order that defines that exact `lib/...`/`test/...` path) and
  rewritten to the namespaced form.
- `import 'package:my_app/...'` — `my_app` is this course's own sample app
  name (`name: my_app` in the `# pubspec.yaml` fence in
  `tooling-and-production/project-and-tooling.mdx`; checked, no lesson uses
  a different name today) — rewritten the same way.
- Either rewrite target lands as a `package:probe/lessons/<ns>/...` import
  when the resolved file is under `lib/` (a Dart `package:` URI addresses
  `lib/` regardless of physical location — this is what lets a `test/`
  fence import a `lib/` fence without an ugly `../../../../lib/...` climb),
  or a real relative path when the target is under `test/` (package: URIs
  can't address `test/`).
- An unresolved specifier is left untouched, so `flutter analyze`'s own
  "target of URI doesn't exist" surfaces — the honest outcome for a snippet
  that doesn't spell out what it imports.

### pubspec.yaml dependency union

Every `# pubspec.yaml` fence's `dependencies:`/`dev_dependencies:` entries
are unioned across the whole corpus and merged into the probe's real
pubspec.yaml via `dart pub add <name>[:<constraint>]` (each package's
**current pub.dev version** — never hand-pinned). Two lessons declaring a
different, non-null constraint for the same package is a hard error naming
both lessons. Always present regardless of any lesson's own fence, at
current pub.dev versions:

| package | resolved (2026-09-26) |
| --- | --- |
| `flutter_riverpod` | 3.4.3 |
| `go_router` | 18.0.1 |
| `mocktail` | 1.0.5 |
| `flutter_test` | already a default dev dependency from `flutter create` |

`analysis_options.yaml` is regenerated every run:
`package:flutter_lints/flutter.yaml` + `strict-casts`/`strict-raw-types`/
`strict-inference` (all default `false`, enabled here per spec).

### Timing (measured, not estimated)

- `flutter create --empty` scaffold: ~2s. First `dart pub add`/`flutter pub
  get` pass (cold): a few seconds of network resolution.
- `flutter analyze --no-pub .` over the whole probe: **~4-5s** warm (spec
  guessed ~30s — the real, current-SDK number is well under that).
- `--refresh` (full wipe + rescaffold + deps + analyze): **~6s** total on
  this machine/network.
- `flutter test` (JSON reporter, line-delimited protocol events, not one
  blob): sub-second for the self-test's one widget test.

### Known, accepted gaps

- **`--build <module>/<lesson>` is not implemented.** A per-lesson
  `flutter build web`/`apk` was assessed as too slow for routine
  verification (a single whole-probe `flutter analyze` already costs several
  seconds; a full Gradle/web build per lesson that ships one would dominate
  the harness's run time). Run `flutter build` by hand in `tools/probe/`
  for a lesson that makes a build-specific claim (e.g. `build-and-release`'s
  `--wasm` output). The flag is accepted and prints this same gap message
  rather than failing.
- `--all-dart` is a coarse baseline signal (see above), not a substitute for
  the real per-fence check once Phase 3 adds path comments — it reports
  counts, not fence-mapped diagnostics.
- A relative import to a file type this harness doesn't collect (only
  `dart`/`yaml` fences are in scope) correctly surfaces as an unresolved
  module — a real, reportable gap in the lesson, not a harness bug.
- If a lesson defines two fences at the identical destination path, the
  later one in document order wins.
