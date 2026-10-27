# Test Infrastructure Architecture & Methodology

**Target System**: MAITEMBATH GANG PARTY  
**Test Suite Path**: `tests/verify_suite.js`  
**Execution Command**: `node tests/verify_suite.js`  
**Framework**: Native Node.js test runner using `socket.io-client` (`^4.8.4`)  
**Design Pattern**: Multi-Client Concurrent Simulation & Process Safety Guardrails

---

## 1. Architectural Overview

The automated verification test infrastructure provides end-to-end integration and resilience testing for the MAITEMBATH GANG PARTY collaborative music and video player. Rather than using mock facades or disconnected unit stubs, the verification suite boots a genuine, transient Node.js + Express + Socket.IO server child process on an isolated ephemeral port, establishes four simultaneous WebSocket connections, and exercises real-time room dynamics across four structured tiers.

```
+-----------------------------------------------------------------------------------------+
|                                  tests/verify_suite.js                                  |
+-----------------------------------------------------------------------------------------+
| 1. Static Integrity & Syntax Subsystem                                                  |
|    - JS syntax validator: runs `node --check` across server and client modules          |
|    - HTML5 stack parser: enforces 0 unclosed and 0 mismatched tags in public/index.html |
|    - CSS brace validator: verifies 100% brace balance across style tags and style.css   |
+-----------------------------------------------------------------------------------------+
| 2. Process Safety & Port Isolation Guardrail (Requirement R4)                           |
|    - Dynamic ephemeral test port allocation via `net.createServer().listen(0)`          |
|    - Transient child server spawn: `PORT=<ephemeralPort> node server.js`                |
|    - Process signals trapped: SIGINT, SIGTERM, uncaughtException, unhandledRejection    |
|    - Teardown: recursive tree termination (taskkill / kill), zero zombie daemon leaks   |
|    - Zero port contention: port 3000 left completely untouched for manual user runs     |
+-----------------------------------------------------------------------------------------+
| 3. Multi-Client Socket.IO Simulation Engine                                             |
|    - SimulatedClient class wrapping socket.io-client with async event predicates        |
|    - 4 Concurrent in-car client roles: Host Driver, Alice, Bob, Charlie                 |
|    - Event waiters: waitForState(), waitForUsers(), waitForVoteSkip(), waitForEvent()   |
+-----------------------------------------------------------------------------------------+
| 4. 4-Tier Test Case Execution Matrix (21 Test Cases)                                    |
|    - Tier 1: Core Feature Coverage Baseline (T1.1 - T1.8)                               |
|    - Tier 2: Boundary & Corner Cases (T2.1 - T2.6)                                      |
|    - Tier 3: Cross-Feature Combinations & New Socket Contracts (T3.1 - T3.4)            |
|    - Tier 4: Real-World In-Car Scenarios & Guardrails (T4.1 - T4.3)                     |
+-----------------------------------------------------------------------------------------+
| 5. Reporting & Exit Code Protocol                                                       |
|    - Formatted ANSI colorized output with per-tier summary metrics                      |
|    - Exit Code 0: 100% test pass                                                        |
|    - Exit Code 1: Any test failure with actionable diagnosis and failure trace          |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Process Safety & Port Isolation (Requirement R4)

A critical requirement is that automated testing must **never conflict with the user's manual server execution model** (`node server.js` on port 3000) and must **never leave zombie background node processes**.

### Ephemeral Port Probing
The suite never hardcodes test ports. Before spawning `server.js`, it binds to an OS-allocated ephemeral port:
```javascript
function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}
```

### Signal Traps & Guaranteed Cleanup
To ensure clean termination under all failure modes (including Ctrl+C or unhandled rejections), global traps are established:
```javascript
process.on('SIGINT', () => { globalEmergencyCleanup(); process.exit(130); });
process.on('SIGTERM', () => { globalEmergencyCleanup(); process.exit(143); });
process.on('uncaughtException', (err) => { globalEmergencyCleanup(); process.exit(1); });
process.on('unhandledRejection', (reason) => { globalEmergencyCleanup(); process.exit(1); });
```
On Windows platforms, child termination uses `taskkill /pid <pid> /f /t` to recursively terminate the entire process sub-tree.

---

## 3. Multi-Client Simulation Engine

The engine defines a `SimulatedClient` class that manages an active Socket.IO connection and caches room state:
- **`connect(timeoutMs)`**: Handshakes with the server, emits `set-profile`, and awaits the `init` event bundle.
- **`waitForState(predicate, timeoutMs, description)`**: Resolves immediately if cached `state` satisfies the predicate; otherwise listens for `'state-update'` until matched or timed out.
- **`waitForVoteSkip(predicate, timeoutMs, description)`**: Resolves when `'vote-skip-update'` matches the target quorum or tally.
- **`waitForUsers(predicate, timeoutMs, description)`**: Resolves when connected passenger profiles synchronize.
- **`waitForEvent(eventName, predicate, timeoutMs, description)`**: Generic event listener for danmaku, reactions, toasts, and errors.

---

## 4. 4-Tier Test Matrix Specification

| Tier | Test ID | Test Name | Validation Method & Assertion | Milestone Dependency |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | T1.1 | Static Integrity & Syntax | `node --check` passes on all JS; HTML tag stack has 0 unclosed; CSS open/close braces match | Baseline |
| | T1.2 | Transient Server Boot | Server boots on dynamic port; HTTP GET `/` returns 200 with title; port 3000 untouched | Baseline |
| | T1.3 | Multi-Client Connection | 4 clients (Host, Alice, Bob, Charlie) connect concurrently and receive `init` | Baseline |
| | T1.4 | Profile Synchronization | Clients emit `set-profile`; nicknames and hex colors broadcast to all 4 clients | Baseline |
| | T1.5 | Single Track Enqueueing | Alice enqueues track 1; track immediately transitions to `currentVideo` and starts playing | Baseline |
| | T1.6 | Multi-Track Enqueueing | Bob and Charlie enqueue tracks 2 & 3; tracks append in FIFO sequence with unique IDs | Baseline |
| | T1.7 | Basic Playback Controls | Host pauses/resumes, adjusts volume to 75, sets quality to hd720; state broadcasts | Baseline |
| | T1.8 | Queue Removal & Clear | Host removes track 1, then clears queue; `state.queue.length === 0` | Baseline |
| **Tier 2** | T2.1 | Malformed Add-Queue Inputs | Empty object and empty URL string rejected with `error-msg`; server process remains healthy | Baseline |
| | T2.2 | Volume Range Clamping | Negative volume clamped to 0; volume >100 clamped to 100; NaN ignored | Baseline |
| | T2.3 | Single-Client Vote Skip | Isolated client (`userCount = 1`) votes to skip; 1/1 quorum immediately advances track | Baseline |
| | T2.4 | Vote Retraction / Toggle | Client votes to skip (current=1), then votes again (current=0); membership toggles | Baseline |
| | T2.5 | Queue Boundary Moves | Moving top track UP stays at index 0; moving bottom track DOWN stays at length-1 | Milestone 1 (`move-track`) |
| | T2.6 | Danmaku Rate Limiter | Sending second danmaku within 100ms returns `error-msg` ('ส่งข้อความเร็วเกินไป') | Baseline |
| **Tier 3** | T3.1 | Queue Reorder While Playing | Host emits `reorder-queue`; queue reorders atomically without interrupting active video | Milestone 1 (`reorder-queue`) |
| | T3.2 | Host Skip After Reorder | Skipping advances to new top item; previous track logged in `state.history` | Milestone 1 (`state.history`) |
| | T3.3 | Dynamic Disconnect Quorum | 4 clients -> 2 vote -> 4th disconnects -> required drops to 2 -> quorum satisfied | Milestone 1 (vote reconciliation) |
| | T3.4 | History Log & 1-Click Re-queue | Client re-queues from `state.history`; track successfully appends to active queue | Milestone 1 (`state.history`) |
| **Tier 4** | T4.1 | In-Car Road Trip Party E2E | Concurrent multi-passenger flow: GPS sync, simultaneous adds, reactions, danmaku | Baseline + Integrations |
| | T4.2 | Tunnel Disconnect & Resync | Passenger disconnects in tunnel, host mutates state, passenger reconnects and reconciles | Milestone 1 (`request-state`) |
| | T4.3 | Process Safety & Teardown | All clients disconnect; transient server killed; ephemeral port verified released | Baseline |

---

## 5. Execution Modes & CLI Reference

Run all test tiers in sequence (default):
```bash
node tests/verify_suite.js
```

Run a specific tier in isolation:
```bash
node tests/verify_suite.js --tier=1
node tests/verify_suite.js --tier=2
node tests/verify_suite.js --tier=3
node tests/verify_suite.js --tier=4
```

Abort test suite execution on the first encountered failure:
```bash
node tests/verify_suite.js --bail
```

---

## 6. Coverage & Quality Thresholds

- **Static Integrity**: 100% clean `node --check` syntax pass; 0 unclosed HTML tags; 0 CSS brace imbalance.
- **Multi-Client State Congruence**: 100% agreement of `state.queue` across all connected client instances.
- **Process Safety**: Zero orphaned Node.js daemon processes post-execution.
