# Original User Request

## 2026-10-14T18:33:47Z

Refactor and modularize client-side architecture (`public/app.js`), implement advanced queue management (drag-and-drop / reordering, playback history, favorites), enhance real-time socket reconnection/sync, and build an automated multi-client verification suite for the MAITEMBATH GANG PARTY collaborative music player.

Working directory: C:\Users\NAMNUAH\.gemini\antigravity\scratch\MyWebMusic\MAITEMBATH-GANG-PRATY-main
Integrity mode: development

## Requirements

### R1. Architecture & Modularization
Refactor `public/app.js` into clean, maintainable ES modules (e.g. under `public/js/` or structured modules for state, socket, audio/synth, UI components, lyrics, queue) while preserving 100% of existing functionality, styling, animations, and zero broken bindings in `public/index.html`. Implement resilient socket reconnection with automatic state reconciliation so client playback and queue state remain strictly in sync upon network drop/reconnect without page reload.

### R2. Advanced Queue Suite & Playback History
Implement visual queue reordering (drag-and-drop with mobile touch support and fallback up/down move triggers for host), a track history tab/log retaining recently played tracks with instant one-click re-queueing, and a local/session favorites drawer allowing users to bookmark and rapidly enqueue favorite tracks.

### R3. Automated Multi-Client Verification Suite
Develop an automated verification script (e.g. `tests/verify_suite.js`) using Node.js and `socket.io-client` that connects multiple simulated clients simultaneously, tests track adding, reordering, vote-skipping, and state synchronization across clients, and verifies zero syntax or runtime errors.

### R4. Runtime & Process Safety Guardrails
Preserve the user's manual server execution model (`node server.js` on port 3000). Do not kill or run unauthorized long-lived background daemons that block port 3000. Maintain zero unclosed HTML tags and zero CSS brace imbalance.

## Acceptance Criteria

### Code Quality & Syntax Integrity
- [ ] `node --check` passes with exit code 0 on all JavaScript files.
- [ ] HTML tag balance and CSS brace balance in `public/index.html` remain exactly 0 unclosed.
- [ ] Client modularization cleanly splits concerns without any missing DOM references or console errors on cold start.

### Real-Time Synchronization & Resilience
- [ ] Disconnecting and reconnecting a client automatically resynchronizes playback time, current track, and queue without requiring a page refresh.
- [ ] Queue reordering (drag-and-drop or move buttons) updates the server queue order and immediately broadcasts the updated sequence to all connected clients.

### Queue Features
- [ ] Recently played tracks are recorded in a History panel and can be re-queued with one click.
- [ ] Users can bookmark tracks to Favorites and add them back to the active queue.

### Verification Suite
- [ ] Automated verification script (`tests/verify_suite.js`) connects simulated clients, tests queue operations and state sync, and exits with code 0.
