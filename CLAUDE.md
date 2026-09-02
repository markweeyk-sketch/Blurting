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

- **UI / logic** — one hand-written `index.html` (~1400 lines) containing all
  HTML, CSS, and vanilla JavaScript. No framework.
- **Rich text** — [Quill 1.3.7](https://quilljs.com/), loaded from a CDN, for
  editing card answers and blurt notes.
- **Local storage** — the entire app state is persisted to
  `localStorage` under the key `blurt3`. The app works fully offline.
- **Cloud sync (optional)** — Firebase v10 (Auth + Firestore), loaded as ES
  modules from the CDN. Google sign-in syncs state to
  `users/{uid}` and study sessions to the `users/{uid}/sessions`
  subcollection.
- **Offline / installability** — `sw.js` (service worker) + `manifest.json`
  make it an installable PWA with a cache-first fetch strategy.

## Repository structure

The repo is **flat** — there are no source subfolders. Every file lives at the
root:

| File | Purpose |
|------|---------|
| `index.html` | The entire application: markup, styles, and all JavaScript. This is the only file you edit for features. |
| `sw.js` | Service worker. Caches the app shell (`CACHE = 'blurt-v2'`) for offline use; bump the cache name when assets change. |
| `manifest.json` | PWA manifest (name, icons, theme colours, standalone display). |
| `android-chrome-192x192.png`, `android-chrome-512x512.png` | App / installer icons referenced by the manifest and service worker. |
| `.git/` | Git repository metadata. |

## Data model

All data hangs off a single `state` object (persisted to `localStorage.blurt3`
and mirrored to Firestore). The content hierarchy is:

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
├─ activeSubId / activeTopicId   ← current navigation
├─ theme, sidebarOpen, sortOrder ← UI preferences
└─ activeSpFilter / activeSubtopicSpFilters ← spec-point filters
```

A **card** holds:
- `question` / `answer` — the prompt and the model answer (answer may be Quill HTML).
- `sp` — an optional "spec point" tag used to group/filter cards within a topic.
- `note` — a free-text blurt / scratch note.
- `confidence` — recall tracking: `{ lastRating, history[], timesGot, timesAlmost, timesMissed }`,
  where each rating is one of `got` / `almost` / `missed`.

## How the app works (feature map)

Key functions in `index.html`, grouped by area:

- **Persistence** — `load()`, `save()`, `_setState()`, `exportData()` (JSON
  backup download). Firestore bridges are exposed on `window`:
  `firebaseSignIn`, `firebaseSignOut`, `firestoreSave`, `firestoreSaveSession`.
- **Sync conflict handling** — on sign-in, `onAuthStateChanged` compares local
  vs. cloud state and offers a modal to *keep local*, *keep cloud*, or
  *merge* (`mergeSubjects`).
- **Content CRUD** — `saveSubject/Topic/Subtopic/Card`,
  `deleteSubject/Topic/Subtopic/Card`, edited through side panels
  (`openPanel`, `buildSubjectPanel`, `buildTopicPanel`, `buildSubtopicPanel`,
  `buildCardPanel`).
- **Navigation / rendering** — `renderSidebar`, `renderMain`, `openSubject`,
  `setTopic`, sorting/filtering helpers (`sortedSubjects`, `getSpecPoints`,
  `setSpFilter`, `setSubtopicSpFilter`).
- **Study sessions** — `openStudySetup` → `startSession` builds a card queue
  (optionally shuffled/timed) from selected topics/subtopics;
  `renderSessionCard` / `revealSessionAnswer` / `rateCard` drive the
  blurt-then-reveal-then-rate loop; `showSessionEnd` reports per-topic accuracy
  and `retryMissed` re-runs only the missed cards.
- **Weak areas** — `buildWeakAreasHTML` surfaces low-confidence cards for
  focused revision.

## Working on this project

- **Run it** — open `index.html` in a browser, or serve the folder with any
  static file server (e.g. `python -m http.server`). Firebase sign-in and the
  service worker require serving over `http(s)://` rather than `file://`.
- **No build step** — edit `index.html` directly and reload. There is nothing
  to compile or install.
- **When changing cached assets** — bump `CACHE` in `sw.js` (e.g. `blurt-v3`)
  so clients pick up the new files instead of serving the stale cache.
- **Firebase config** — the `firebaseConfig` block in `index.html` is a public
  web config (safe to ship); access is controlled by Firestore security rules,
  not by hiding these keys.
