# Blurt — Revision App

## Purpose

Blurt is a personal **flashcard and "blurting" revision workspace** — an
installable web app (PWA) for studying by writing out everything you remember
about a topic ("blurting") and then checking it against a saved model answer,
rating your recall confidence each time.

It is designed for exam revision: organise material into subjects → topics →
subtopics → cards, then run timed study sessions that track how well you know
each card over time.

## Tech stack

This is a **single-page, zero-build, static web app**. There is no bundler,
package manager, or server-side code — everything runs in the browser from
plain files.

- **UI / logic** — one hand-written `index.html` (~3200 lines) containing all
  HTML, CSS, and vanilla JavaScript. No framework.
- **Rich text** — [Quill 1.3.7](https://quilljs.com/), loaded from a CDN, for
  editing card answers and blurt notes.
- **Local storage** — the entire app state is persisted to IndexedDB
  (database `blurt`, store `kv`, keys `state` / `meta` / `backup`), with a
  localStorage fallback (`blurt:*` keys). Older versions used the
  localStorage key `blurt3`; `load()` migrates it once and removes it. The
  app works fully offline.
- **Cloud sync (optional)** — Firebase v10 (Auth + Firestore), loaded as ES
  modules from the CDN. Google sign-in syncs state to the `users/{uid}` doc
  (`{state, rev, savedAt, device}`) and study sessions to the
  `users/{uid}/sessions` subcollection.
- **Offline / installability** — `sw.js` (service worker) + `manifest.json`
  make it an installable PWA. The page is network-first (so deploys show up on
  the next load), icons/manifest are stale-while-revalidate, the versioned
  Quill and Firebase CDN files are cache-first, and everything else (Firestore,
  sign-in) is never intercepted.

## Repository structure

The repo is **flat** — there are no source subfolders. Every file lives at the
root:

| File | Purpose |
|------|---------|
| `index.html` | The entire application: markup, styles, and all JavaScript. This is the only file you edit for features. |
| `sw.js` | Service worker (`CACHE = 'blurt-v8'`). Bump the cache name when the shell file list changes. |
| `manifest.json` | PWA manifest (name, icons, theme colours, standalone display). |
| `android-chrome-192x192.png`, `android-chrome-512x512.png` | App / installer icons referenced by the manifest and service worker. |
| `.git/` | Git repository metadata. |

## Data model

All data hangs off a single `state` object (persisted to IndexedDB and
mirrored to Firestore). The content hierarchy is:

```
state
├─ subjects[]              ← top-level study areas
│   ├─ id, name, color
│   └─ topics[]
│       ├─ id, name
│       ├─ cards[]         ← "general" cards directly under a topic
│       └─ subtopics[]
│           ├─ id, name
│           └─ cards[]
├─ deleted{id: ms}         ← tombstones so merges don't resurrect deletions
├─ theme, sortOrder, hotkeys      ← synced preferences
└─ activeSubId / activeTopicId / activeSpFilter / activeSubtopicSpFilters /
   openSubtopics / sidebarOpen    ← LOCAL_ONLY: device UI state, never synced
```

Subjects, topics, subtopics and cards carry `updatedAt` (ms) — set it whenever
you change an item's own fields, and call `markDeleted(id)` when removing one,
or merges will get it wrong. Use `save()` for content/preference changes
(persists and syncs) and `saveUI()` for device-only UI state.

A **card** holds:
- `q` / `answer` / `hint` — the prompt, the model answer (may be Quill HTML) and an optional hint.
- `sp` — an optional "spec point" tag used to group/filter cards within a topic.
- `myNote` (+ `noteAt`) — the user's saved blurt (Quill HTML), stamped separately from content.
- `confidence` — recall tracking: `{ lastRating, history[], timesGot, timesAlmost, timesMissed }`,
  where each rating is one of `got` / `almost` / `missed`. `history` is capped
  at the last 50 entries (`HISTORY_CAP`); the `times*` totals are not.

## How the app works (feature map)

Key functions in `index.html`, grouped by area:

- **Persistence** — `Store` (IndexedDB wrapper), `load()` (async; resolves
  `_ready`), `save()` / `saveUI()`, `persistNow()`, `normalizeState()`
  (defaults + repairs ids/colours for old saves and imports).
- **Cloud sync** — the `<script type="module">` is only a Firebase adapter
  (`window.blurtCloud`: `watch`, `push`, `addSession`, `signIn`/`signOut`).
  All decisions live in `Sync`: each cloud write gets a new `rev`; the device
  stores the rev it is based on (`syncMeta.baseRev`, valid once
  `syncMeta.synced`) and whether it has unsynced edits (`syncMeta.dirty`).
  `push()` runs a transaction that only writes if the cloud is still at
  `baseRev`. A live `onSnapshot` listener drives `Sync.onCloud`: clean device →
  `adoptCloud`; device with edits → `mergeWithCloud` (`mergeStates`: per-item
  newest `updatedAt`/`noteAt` wins, histories combine, tombstones respected).
  Whatever gets replaced is saved via `saveBackup` and can be restored
  (`restoreBackup`, toast "Undo", Settings). Failed writes retry with backoff;
  `renderSyncStatus` drives the sidebar indicator and the top banner. Session
  summaries queue in `syncMeta.pendingSessions` until they upload. Writes over
  `CLOUD_LIMIT` (~1 MB, Firestore's per-doc cap) are refused with a visible
  "too large" status.
- **Several tabs** — `Tabs`: tabs announce every storage write over a
  BroadcastChannel and the others pull it (`Tabs.pull`). Every write goes
  through `Store.tx` and bumps the stored `ver`; if another tab wrote since this
  tab last read (`_storeVer`), the write merges (`mergeStates`) instead of
  replacing, so storage only ever grows a superset and a tab with no unsaved
  changes can just take it. Only the leader tab (holder of the `blurt-sync` Web
  Lock) talks to the cloud; it pushes edits made in any tab, broadcasts its sync
  status, and the next tab takes over when it closes (`Tabs.takeOver`). Other
  tabs only add queued sessions (deduped by id, `uploadedSessions`) and a dirty
  flag to `meta` (`Tabs.mergeMeta`).
- **Backups** — `exportData()`, `onImportFile` → `applyImport` (merge or
  replace), `restoreBackup`; all in Settings › Data & sync
  (`renderSettingsData`, which also shows the size meter).
- **Images** — `attachImageSupport` (paste/drop) and the toolbar's
  `pickImages` downscale to 1400px and re-encode as WebP via
  `compressImage`; `shrinkImages` recompresses existing oversized images.
- **Sanitizing** — `renderAnswer` passes stored HTML through `sanitizeRich`
  (tag/attribute/URL allowlist). Values interpolated into inline `onclick`
  strings must go through `escAttr(jsStr(...))`.
- **Displaying rich text** — Quill stores nested lists flat (`<li class="ql-indent-N">`);
  `sanitizeRich` calls `nestQuillLists` to rebuild real nested `<ul>/<ol>` for
  display. Containers showing answers/notes need the `rich` class, whose CSS
  is written to match the editor's list overrides (`.ql-snow .ql-editor li…`).
  Stored HTML stays in Quill's flat format (the editor needs it).
- **Keyboard shortcuts** — `HOTKEYS` defines every shortcut with a scope:
  `editor` (Quill bindings via `editorBindings`, need a modifier, matched by
  `code`), `app` (subject page, not while typing) and `session`; all matched
  with `matchHotkey` in the single global keydown handler and editable in
  Settings. `_kbCard` / `setCardFocus` is the keyboard-selected card.
- **Study sessions (side by side)** — after `revealSessionAnswer`, the model
  answer column appears beside the blurt; `updateKeyTerms` →
  `highlightKeyTerms` marks key terms (stopwords skipped, light stemming via
  `stemWord`/`stemsMatch`) and suggests a rating; both toggled by
  `state.studyPrefs`.
- **Undo / archive / move** — deletes go through `removeWithUndo` (toast
  Undo re-inserts by id path via `resolveList`). `subject.archived` hides a
  subject under "Archived" in the sidebar. Moving a card/subtopic/topic uses
  `moveItem`, which gives the item a **new id** and tombstones the old one so
  merges can't leave copies in two places; "Save as copy" is `saveCard(true)`.
- **Bulk add** — `openBulk` modal: `parseBulkCards` (tab/`|` columns, `Q:`/`A:`
  blocks, blank-line blocks; `answerToHtml` turns `-`/`1.` lines into Quill
  list HTML) and `parseSpec` (numbered spec lines; numbers that prefix others
  are headings → subtopics). `planBulk` computes exactly what `commitBulk`
  will add (also used for the preview), skipping spec points already present.
- **Search** — `openSearch` (`/`, Ctrl/Cmd+K, sidebar icon): `searchAll` over
  every subject, `goToResult` opens the section and selects the card.
- **Settings & help** — tabbed modal (`openSettings(tab)`): shortcuts, study
  prefs, data & sync, help guides (`HELP_GUIDES`). `openTour` / `TOUR` is the
  walkthrough, shown once per device by `maybeShowTour`
  (localStorage `blurt-tour-seen`).
- **Small screens** — below 760px (`isNarrow()`), the sidebar becomes an
  overlay drawer, columns stack and the session rating bar sticks to the bottom.
- **Content CRUD** — `saveSubject/Topic/Subtopic/Card`,
  `deleteSubject/Topic/Subtopic/Card`, edited through side panels
  (`openPanel`, `buildSubjectPanel`, `buildTopicPanel`, `buildSubtopicPanel`,
  `buildCardPanel`).
- **Navigation / rendering** — `renderSidebar`, `renderMain`, `openSubject`,
  `setTopic`, filtering helpers (`getSpecPoints`, `setSpFilter`,
  `setSubtopicSpFilter`).
- **Ordering** — every list the user sees (sidebar, subject page, study setup,
  session deck, session breakdown, weak areas) uses the same helpers:
  `naturalCompare` (numeric, case-insensitive), `compareNames` (ignores a
  leading "Topic/Unit/Chapter…" label; numbered names first) via
  `sortedTopics` / `sortedSubtopics`, `compareSpecPoints` / `sortCardsBySpec`
  for cards, and `sortedSubjects` (A–Z, or newest first via `createdAt`).
  Within a topic, subtopics come first, then general cards. Don't iterate
  `sub.topics` / `t.subtopics` directly for anything that is displayed.
- **Study sessions** — `openStudySetup` → `startSession` builds a card queue
  (optionally shuffled/timed) from selected topics/subtopics;
  `renderSessionCard` / `revealSessionAnswer` / `rateCard` drive the
  blurt-then-reveal-then-rate loop; `showSessionEnd` reports per-topic accuracy
  and `retryMissed` re-runs only the missed cards.
- **Weak areas** — `buildWeakAreasHTML` surfaces low-confidence cards for
  focused revision.
- **Tables** — Quill 1 has no table format, so `TableBlot` is a custom block
  embed (`<table class="blurt-table">`, not editable in place; clicking it opens
  the table editor via `openTableEditor`). Cells are sanitized to
  sub/sup/bold/italic/line breaks (`sanitizeCell`). `attachTableSupport` wires
  every editor: pasted HTML tables convert through Quill's clipboard, and
  `tableFromPlainText` spots tab-separated or one-cell-per-paragraph text and
  offers a "Paste as table" preview.

## Working on this project

- **Run it** — open `index.html` in a browser, or serve the folder with any
  static file server (e.g. `python -m http.server`). Firebase sign-in and the
  service worker require serving over `http(s)://` rather than `file://`.
- **No build step** — edit `index.html` directly and reload. There is nothing
  to compile or install.
- **When changing cached assets** — `index.html` is fetched network-first, so
  edits show up on the next load. Bump `CACHE` in `sw.js` when the shell file
  list or CDN versions change.
- **Firestore rules** — the app writes `state`, `rev`, `savedAt` and
  `device` on `users/{uid}`; rules that only allow a `state` field would make
  every sync fail (shown as "Sync failed" in the sidebar).
- **Firebase config** — the `firebaseConfig` block in `index.html` is a public
  web config (safe to ship); access is controlled by Firestore security rules,
  not by hiding these keys.
