# Project: MAITEMBATH GANG PARTY

## Architecture
The application is a collaborative music and video player for road trips and parties:
- **Server (`server.js`)**: Node.js + Express + Socket.IO server. Manages a synchronized collaborative party room with shared playback state (`state`), connected user profiles (`connectedUsers`), democratic vote-skipping (`voteSkipUsers`), and GPS navigation state (`navState`).
- **Client (`public/`)**: Single-page web app. Refactored from monolithic `public/app.js` into clean ES modules under `public/js/`:
  - `state.js`: Central state management, reactive store, and event dispatcher.
  - `socket.js`: Socket.IO client connection, event routing, automatic reconnection, and state reconciliation.
  - `audio.js`: Direct HD audio/video streams, YouTube IFrame API fallback, Web Audio API 3D warp intro synth, and DJ soundboard effects.
  - `lyrics.js`: Synced LRC lyrics fetcher, 100ms ticker, and karaoke left-to-right visual text wipes.
  - `queue.js`: Queue rendering, add/remove/clear operations, drag-and-drop reordering, mobile touch handles, and host up/down move buttons.
  - `history.js`: Recently played track log with 1-click re-queueing.
  - `favorites.js`: Local bookmarking/favorites drawer with instant enqueuing.
  - `map.js`: Leaflet GPS navigation, radar map tiles, Open-Meteo weather forecasts, and route analysis.
  - `ui.js`: DOM event bindings, Now Playing card, progress/volume sliders, danmaku comments, floating emoji reactions, and modal management.
  - `main.js`: Main application entry point initializing all subsystems on DOMContentLoaded.
  - `app.js`: Backward-compatibility entry bridge importing `main.js`.
- **E2E Testing Suite (`tests/verify_suite.js`)**: Standalone verification runner using `socket.io-client` simulating multiple concurrent clients (Host, Alice, Bob, Charlie) against an isolated transient server on an ephemeral port.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | ES Module Modularization | Refactor `public/app.js` into clean ES modules under `public/js/` preserving 100% functionality and styling with zero broken DOM bindings | M2 | ORIGINAL_REQUEST §R1 |
| F2 | Resilient Socket Reconnection | Client detects disconnect, reconnects automatically, re-registers user profile, and reconciles playback drift and queue without page reload | M4 | ORIGINAL_REQUEST §R1 |
| F3 | Visual Queue Reordering | HTML5 drag-and-drop, mobile touch grip handles, and host fallback up/down move triggers with atomic server synchronization | M3 | ORIGINAL_REQUEST §R2 |
| F4 | Track Playback History | Recently played tracks log retaining up to 50 tracks with instant one-click re-queueing | M3 | ORIGINAL_REQUEST §R2 |
| F5 | Local Favorites Drawer | Favorites bookmarking drawer allowing users to save anthems and rapidly enqueue them to the active party queue | M3 | ORIGINAL_REQUEST §R2 |
| F6 | Server Queue Reorder Protocol | Implement `reorder-queue` and `move-track` socket event handlers in `server.js` with atomic queue validation and state broadcasting | M1 | ORIGINAL_REQUEST §R2, §R3 |
| F7 | Server Playback History Store | Extend `state.history` on server to store recent tracks upon transition, broadcasting to all clients in `init` and `state-update` | M1 | ORIGINAL_REQUEST §R2 |
| F8 | Server State Reconciliation Endpoint | Implement `request-state` socket event on server returning full state, users, and vote-skip snapshot | M1 | ORIGINAL_REQUEST §R1, §R3 |
| F9 | Multi-Client Verification Suite | Standalone test script `tests/verify_suite.js` connecting simulated clients to test queue operations, reordering, vote-skipping, and sync | Track A (E2E) | ORIGINAL_REQUEST §R3 |
| F10 | Port & Process Safety Guardrails | Respect `process.env.PORT`, run test server on ephemeral port without blocking port 3000, zero daemon leaks, verify 0 unclosed HTML tags and 0 CSS brace imbalance | Track A / M5 | ORIGINAL_REQUEST §R4 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | Automated Multi-Client Verification Suite | Build `tests/verify_suite.js` using `socket.io-client` with 4-tier test matrix (21 test cases) on isolated test port; create `TEST_INFRA.md` & `TEST_READY.md` | Interface Contracts | **DONE** |
| M1 | Server Socket Protocol Enhancements | Add `reorder-queue`, `move-track`, `state.history`, and `request-state` handlers to `server.js` | none | **DONE** |
| M2 | Client Architecture & Modularization | Refactor `public/app.js` into clean ES modules under `public/js/` (`state.js`, `socket.js`, `audio.js`, `lyrics.js`, `queue.js`, `history.js`, `favorites.js`, `map.js`, `ui.js`, `main.js`) with zero broken bindings | M1 | **DONE** |
| M3 | Advanced Queue Suite & History UI | Implement drag-and-drop reordering, mobile touch handles, host up/down move buttons, track history tab with 1-click re-queueing, and favorites drawer | M1, M2 | **DONE** |
| M4 | Resilient Socket Reconnection & Reconciliation | Implement auto profile re-emission on connect, playback time drift reconciliation, and instant queue resync without page reload | M1, M2 | **DONE** |
| M5 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Phase 1: 100% E2E Pass (Tiers 1-4); Phase 2: Tier 5 Adversarial Coverage Hardening & Final Forensic Audit | E2E, M1-M4 | **DONE** |

---

## Interface Contracts

### 1. Queue Reordering Contract
- **Client -> Server (`reorder-queue`)**:
  - Payload: `{ queueIds: string[] }` or `{ itemIds: string[] }` or `string[]` (ordered array of track item IDs).
  - Validation: Server verifies array of string IDs, reorders `state.queue` to match the given order, preserves any concurrently added items at the end, and triggers `prefetchVideoStreamUrl` for new top track if applicable.
  - Broadcast: `io.emit('state-update', state)`
- **Client -> Server (`move-track`)**:
  - Payload: `{ itemId: string, direction?: 'up' | 'down', toIndex?: number }`
  - Validation: Moves item within bounds `[0, state.queue.length - 1]`.
  - Broadcast: `io.emit('state-update', state)`

### 2. Playback History Contract
- **Server Data Structure**: `state.history = []` (max 50 items).
- **History Item Schema**:
  ```javascript
  {
    id: string,
    videoId: string,
    title: string,
    author: string,
    thumbnail: string,
    url: string,
    source: 'youtube' | 'spotify' | 'autodj',
    playedAt: number,
    addedBy: string
  }
  ```
- **Lifecycle**: When track playback completes or is skipped, the active `state.currentVideo` is unshifted to `state.history`.
- **Broadcast**: Included in `io.emit('state-update', state)` and unicast on `init`.

### 3. State Reconciliation Contract
- **Client -> Server (`request-state`)**:
  - Unicast Response:
    - `socket.emit('state-update', state)`
    - `socket.emit('vote-skip-update', getVoteSkipState())`
    - `socket.emit('users-update', connectedUsers)`
- **Client On-Reconnect Protocol**:
  1. On `'connect'` event: if cached `myProfile` exists, immediately `socket.emit('set-profile', myProfile)`.
  2. Request state snapshot: `socket.emit('request-state')`.
  3. Reconcile local playback drift: if host and `Math.abs(nativeVideo.currentTime - state.currentTime) > 2.0`, seek video. Ensure play/pause matches `state.isPlaying`.

---

## Code Layout

```
.
├── server.js                        # Express & Socket.IO server (updated with reorder, history, request-state)
├── package.json                     # Project manifest and dependencies
├── tests/
│   └── verify_suite.js              # Multi-client automated test runner & guardrail validator
├── public/
│   ├── index.html                   # Main single-page interface (zero unclosed tags, zero brace imbalance)
│   ├── style.css                    # Global stylesheet
│   ├── app.js                       # Compatibility entry bridge
│   ├── PNRJAPANLOGO.png             # Brand assets
│   ├── favicon.ico
│   └── js/                          # ES Modules
│       ├── main.js                  # Application bootstrapper
│       ├── state.js                 # Central state store & reactive bus
│       ├── socket.js                # Socket.IO connection & reconnection reconciler
│       ├── audio.js                 # Direct HD stream player, YouTube fallback, Web Audio synthesizers
│       ├── lyrics.js                # Synced lyrics fetcher, ticker, and karaoke wipes
│       ├── queue.js                 # Queue renderer, drag-and-drop, touch handles, move buttons
│       ├── history.js               # Recently played track history manager & re-queueing
│       ├── favorites.js             # Local favorites bookmark drawer
│       ├── map.js                   # Leaflet radar map & GPS navigation
│       └── ui.js                    # UI controls, modals, toast, danmaku, floating reactions
```
