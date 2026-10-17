#!/usr/bin/env node
/**
 * Adversarial History Overflow & Reconnection Stress Test Suite
 * Milestone 1 Challenger 2: Adversarial History Overflow & Reconnection Stress
 * Target: server.js
 * 
 * Objectives:
 * 1. History Overflow Stress:
 *    - Push >100 tracks through playback transition (recordPlayedVideo / skip-video).
 *    - Verify state.history.length NEVER exceeds 50 under any condition (strictly bounded O(1) memory).
 * 2. Consecutive Duplicate Track Transitions:
 *    - Test consecutive transitions of the identical videoId.
 *    - Verify playedAt timestamp is refreshed without duplicate history spam (length does not increase).
 * 3. Rapid Network Flapping & State Reconciliation:
 *    - 5 clients disconnecting and reconnecting 10 times in rapid succession.
 *    - Each client emits 'request-state' on each reconnect.
 *    - Verify all clients receive authoritative state snapshots, profile updates, and vote-skip quorums.
 * 4. Process Memory & Crash Guardrail Inspection:
 *    - Verify server memory remains stable.
 *    - Verify zero unhandled promise rejections and zero uncaught exceptions in server stderr/stdout.
 * 
 * Safety:
 *    - Dynamic ephemeral port via net.createServer().listen(0) - port 3000 is NEVER touched.
 *    - Process-tree termination guardrails (taskkill on Windows, SIGKILL on Unix).
 */

'use strict';

const net = require('net');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const { io } = require('socket.io-client');

const SERVER_PATH = path.resolve(__dirname, '..', 'server.js');

// Known instant-cached video IDs from server.js (avoids external network calls to noembed)
const CACHED_VIDEOS = [
  'dQw4w9WgXcQ', // Rick Astley
  'kJQP7kiw5Fk', // Despacito
  'oHg5SJYRHA0', // RickRoll
  '9bZkp7q19f0'  // Gangnam Style
];

let allocatedPort = null;
let serverChild = null;
const activeClients = [];
const serverStderrLogs = [];
const serverStdoutLogs = [];

// --- Emergency Process Teardown Guards ---
function killProcessTreeSync(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (_) {
    try { process.kill(pid, 'SIGKILL'); } catch (__) {}
  }
}

function fullCleanup() {
  for (const client of activeClients) {
    try {
      client.removeAllListeners();
      client.disconnect();
    } catch (_) {}
  }
  activeClients.length = 0;
  if (serverChild) {
    killProcessTreeSync(serverChild.pid);
    serverChild = null;
  }
}

process.on('SIGINT', () => { fullCleanup(); process.exit(130); });
process.on('SIGTERM', () => { fullCleanup(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('\n[CRITICAL] Uncaught exception in test runner:', err);
  fullCleanup();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[CRITICAL] Unhandled promise rejection in test runner:', reason);
  fullCleanup();
  process.exit(1);
});

// --- Helpers ---
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getProcessMemoryMB(pid) {
  if (!pid) return null;
  try {
    const cmd = process.platform === 'win32'
      ? `powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64 / 1MB"`
      : `ps -o rss= -p ${pid}`;
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
    const val = parseFloat(stdout.trim());
    return process.platform === 'win32' ? Math.round(val * 100) / 100 : Math.round((val / 1024) * 100) / 100;
  } catch (_) {
    return null;
  }
}

// --- Test Client Simulation Class ---
class SimulatedTestClient {
  constructor(name, port, color = '#38bdf8') {
    this.name = name;
    this.port = port;
    this.color = color;
    this.socket = null;
    this.state = null;
    this.users = {};
    this.voteSkipState = null;
    this.connected = false;
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SimulatedTestClient [${this.name}] timed out connecting to port ${this.port}`));
      }, timeoutMs);

      this.socket = io(`http://127.0.0.1:${this.port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });

      activeClients.push(this.socket);

      this.socket.on('connect', () => {
        this.connected = true;
        this.socket.emit('set-profile', { name: this.name, color: this.color });
      });

      this.socket.on('init', (payload) => {
        clearTimeout(timer);
        this.state = payload.state;
        this.users = payload.users || {};
        this.voteSkipState = payload.voteSkipState || null;
        resolve(this);
      });

      this.socket.on('state-update', (state) => {
        this.state = state;
      });

      this.socket.on('users-update', (users) => {
        this.users = users;
      });

      this.socket.on('vote-skip-update', (vs) => {
        this.voteSkipState = vs;
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  emit(event, ...args) {
    if (!this.socket || !this.connected) {
      throw new Error(`Cannot emit '${event}': Client [${this.name}] is not connected`);
    }
    this.socket.emit(event, ...args);
  }

  waitForState(predicate, timeoutMs = 4000, description = 'state condition') {
    if (this.state && predicate(this.state)) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for ${description} on [${this.name}]`));
      }, timeoutMs);

      const handler = (state) => {
        if (predicate(state)) {
          cleanup();
          resolve(state);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('state-update', handler);
      };

      this.socket.on('state-update', handler);
    });
  }

  waitForUsers(predicate, timeoutMs = 4000, description = 'users condition') {
    if (this.users && predicate(this.users)) {
      return Promise.resolve(this.users);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for ${description} on [${this.name}]`));
      }, timeoutMs);

      const handler = (users) => {
        if (predicate(users)) {
          cleanup();
          resolve(users);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('users-update', handler);
      };

      this.socket.on('users-update', handler);
    });
  }

  waitForVoteSkip(predicate, timeoutMs = 4000, description = 'vote-skip condition') {
    if (this.voteSkipState && predicate(this.voteSkipState)) {
      return Promise.resolve(this.voteSkipState);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for ${description} on [${this.name}]`));
      }, timeoutMs);

      const handler = (vs) => {
        if (predicate(vs)) {
          cleanup();
          resolve(vs);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('vote-skip-update', handler);
      };

      this.socket.on('vote-skip-update', handler);
    });
  }

  disconnect() {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (_) {}
      const idx = activeClients.indexOf(this.socket);
      if (idx !== -1) activeClients.splice(idx, 1);
      this.socket = null;
      this.connected = false;
    }
  }
}

// --- Test Results Tracker ---
const results = {
  passed: 0,
  failed: 0,
  checks: []
};

function assert(condition, message, details = '') {
  if (condition) {
    results.passed++;
    results.checks.push({ status: 'PASS', message, details });
    console.log(`  [PASS] ${message}`);
  } else {
    results.failed++;
    results.checks.push({ status: 'FAIL', message, details });
    console.error(`  [FAIL] ${message} - ${details}`);
    throw new Error(`Assertion failed: ${message} (${details})`);
  }
}

// ============================================================================
// MAIN EXECUTION FLOW
// ============================================================================
async function runStressSuite() {
  console.log('====================================================================');
  console.log(' ADVERSARIAL HISTORY OVERFLOW & RECONNECTION STRESS TEST SUITE      ');
  console.log('====================================================================');

  // Step 0: Allocate ephemeral port and spawn server
  allocatedPort = await getEphemeralPort();
  console.log(`[BOOT] Allocated ephemeral port: ${allocatedPort} (port 3000 untouched)`);

  serverChild = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(allocatedPort) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverChild.stdout.on('data', (d) => {
    const text = d.toString();
    serverStdoutLogs.push(text);
  });

  serverChild.stderr.on('data', (d) => {
    const text = d.toString();
    serverStderrLogs.push(text);
  });

  // Await server boot
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server failed to boot on port ${allocatedPort} within 6000ms`));
    }, 6000);

    const onData = (chunk) => {
      if (chunk.toString().includes('Server is running!') || chunk.toString().includes(String(allocatedPort))) {
        clearTimeout(timeout);
        serverChild.stdout.removeListener('data', onData);
        resolve();
      }
    };
    serverChild.stdout.on('data', onData);
  });
  console.log(`[BOOT] Server process running (PID: ${serverChild.pid})`);

  const initialMemoryMB = getProcessMemoryMB(serverChild.pid);
  console.log(`[PERF] Initial Server Working Set Memory: ${initialMemoryMB} MB\n`);

  // ==========================================================================
  // SUITE 1: HISTORY OVERFLOW STRESS (>100 TRACK TRANSITIONS)
  // ==========================================================================
  console.log('--------------------------------------------------------------------');
  console.log(' SUITE 1: HISTORY OVERFLOW STRESS (>100 PLAYBACK TRANSITIONS)       ');
  console.log('--------------------------------------------------------------------');

  const host = new SimulatedTestClient('Host-DJ', allocatedPort, '#ef4444');
  await host.connect();
  console.log('[SUITE 1] Host connected. Disabling Auto-DJ for deterministic test...');
  host.emit('autodj-config', { enabled: false, notify: false });
  await host.waitForState(s => s.autoDjEnabled === false, 3000);

  // Clear queue
  host.emit('clear-queue');
  await host.waitForState(s => s.queue.length === 0, 3000);

  // If there's an active video, skip it so currentVideo is null
  if (host.state.currentVideo) {
    host.emit('skip-video');
    await host.waitForState(s => s.currentVideo === null, 3000);
  }

  // Pre-seed queue with 120 tracks rotating through the 4 cached video IDs
  // Because the IDs alternate (0, 1, 2, 3, 0, 1, 2, 3...), adjacent tracks are NEVER identical.
  const TOTAL_TRACKS = 120;
  console.log(`[SUITE 1] Enqueueing ${TOTAL_TRACKS} alternating tracks...`);

  // Track 1 plays immediately
  host.emit('add-to-queue', { url: CACHED_VIDEOS[0], nickname: 'StressBot' });
  await host.waitForState(s => !!s.currentVideo, 3500, 'Initial track playback');

  // Enqueue the remaining 119 tracks
  for (let i = 1; i < TOTAL_TRACKS; i++) {
    const videoId = CACHED_VIDEOS[i % CACHED_VIDEOS.length];
    host.emit('add-to-queue', { url: videoId, nickname: `StressBot-${i}` });
  }

  // Wait for all 119 items in queue
  await host.waitForState(
    s => s.queue.length === TOTAL_TRACKS - 1,
    8000,
    `Queue reaches ${TOTAL_TRACKS - 1} tracks`
  );
  assert(host.state.queue.length === TOTAL_TRACKS - 1, `Queue successfully populated with ${TOTAL_TRACKS - 1} tracks`);

  console.log(`[SUITE 1] Beginning rapid track skip transitions across all ${TOTAL_TRACKS} tracks...`);
  
  let maxHistoryObserved = 0;
  const historyLengthsAtCheckpoints = {};
  const checkpoints = [1, 5, 25, 49, 50, 51, 75, 100, 120];

  for (let step = 1; step <= TOTAL_TRACKS; step++) {
    const prevPlayingVideo = host.state.currentVideo;
    const prevVideoId = prevPlayingVideo ? prevPlayingVideo.videoId : null;

    // Trigger transition
    host.emit('skip-video');

    if (step < TOTAL_TRACKS) {
      // Waiting for next track to become active
      await host.waitForState(
        s => s.queue.length === (TOTAL_TRACKS - 1 - step) || (step === TOTAL_TRACKS && s.currentVideo === null),
        3000,
        `Step ${step} skip transition`
      );
    } else {
      // Last track skipped, queue is empty and currentVideo becomes null
      await host.waitForState(s => s.currentVideo === null, 3000, 'Final track skip transition');
    }

    const currentHist = host.state.history;
    const currentHistLen = Array.isArray(currentHist) ? currentHist.length : 0;
    if (currentHistLen > maxHistoryObserved) {
      maxHistoryObserved = currentHistLen;
    }

    // Invariant H1: Length MUST NEVER exceed 50 under any condition
    if (currentHistLen > 50) {
      assert(false, `History Overflow Violation: state.history.length was ${currentHistLen} (> 50) at step ${step}!`);
    }

    // Invariant H2: Top item in history must be the video that just finished
    if (prevVideoId && currentHist.length > 0) {
      if (currentHist[0].videoId !== prevVideoId) {
        throw new Error(`History top item mismatch at step ${step}: expected ${prevVideoId}, got ${currentHist[0].videoId}`);
      }
    }

    // Invariant H3: Schema completeness
    if (currentHist.length > 0) {
      const top = currentHist[0];
      if (!top.id || !top.videoId || !top.title || !top.author || !top.url || typeof top.playedAt !== 'number') {
        throw new Error(`History schema incomplete at step ${step}: ${JSON.stringify(top)}`);
      }
    }

    // Checkpoint logging
    if (checkpoints.includes(step)) {
      historyLengthsAtCheckpoints[step] = currentHistLen;
      console.log(`  [PROGRESS] Transition ${step}/${TOTAL_TRACKS} completed -> state.history.length = ${currentHistLen}`);
    }
  }

  console.log(`[SUITE 1] History lengths at checkpoints:`, JSON.stringify(historyLengthsAtCheckpoints));

  // Assertions for Suite 1
  assert(maxHistoryObserved === 50, `Maximum history length observed was strictly bounded to 50 (observed: ${maxHistoryObserved})`);
  assert(host.state.history.length === 50, `Final history length is exactly 50 after 120 track transitions`);
  assert(historyLengthsAtCheckpoints[50] === 50, `History capped at 50 at step 50`);
  assert(historyLengthsAtCheckpoints[100] === 50, `History remained strictly 50 at step 100 (O(1) memory bound)`);
  assert(historyLengthsAtCheckpoints[120] === 50, `History remained strictly 50 at step 120 (zero drift)`);

  const memAfterSuite1 = getProcessMemoryMB(serverChild.pid);
  console.log(`[PERF] Memory after Suite 1 (120 track transitions): ${memAfterSuite1} MB (Delta: +${(memAfterSuite1 - initialMemoryMB).toFixed(2)} MB)\n`);

  // ==========================================================================
  // SUITE 2: CONSECUTIVE DUPLICATE TRACK TRANSITIONS (ANTI-SPAM DEDUPLICATION)
  // ==========================================================================
  console.log('--------------------------------------------------------------------');
  console.log(' SUITE 2: CONSECUTIVE DUPLICATE TRACK TRANSITIONS (ANTI-SPAM)       ');
  console.log('--------------------------------------------------------------------');

  const baseHistoryLength = host.state.history.length;
  assert(baseHistoryLength === 50, `Pre-condition: History length starts at 50`);

  const duplicateVideoId = CACHED_VIDEOS[0]; // 'dQw4w9WgXcQ'
  console.log(`[SUITE 2] Enqueueing 5 consecutive copies of track ${duplicateVideoId}...`);

  for (let i = 0; i < 5; i++) {
    host.emit('add-to-queue', { url: duplicateVideoId, nickname: `DupeBot-${i}` });
  }

  await host.waitForState(s => s.queue.length === 4 && !!s.currentVideo, 4000, 'Queue has 4 dupes, 1 playing');
  assert(host.state.currentVideo.videoId === duplicateVideoId, `Active playing video is ${duplicateVideoId}`);

  console.log('[SUITE 2] Skipping through 4 consecutive identical track transitions...');
  for (let i = 1; i <= 4; i++) {
    const histBefore = [...host.state.history];
    const prevPlayedAt = histBefore[0]?.videoId === duplicateVideoId ? histBefore[0].playedAt : 0;

    await sleep(20); // Small pause to verify playedAt timestamp advancement
    host.emit('skip-video');

    await host.waitForState(s => s.queue.length === 4 - i, 3000, `Dupe skip transition ${i}`);

    const histAfter = host.state.history;

    // Check 1: History length MUST NOT grow
    assert(
      histAfter.length === 50,
      `Consecutive dupe transition ${i}: state.history.length remained strictly 50 without spamming`
    );

    // Check 2: Top item videoId is the duplicate video ID
    assert(
      histAfter[0].videoId === duplicateVideoId,
      `Consecutive dupe transition ${i}: history[0].videoId is ${duplicateVideoId}`
    );

    // Check 3: If history[0] was already duplicateVideoId, playedAt timestamp was updated
    if (i > 1 && prevPlayedAt > 0) {
      assert(
        histAfter[0].playedAt >= prevPlayedAt,
        `Consecutive dupe transition ${i}: history[0].playedAt updated (${histAfter[0].playedAt} >= ${prevPlayedAt})`
      );
    }

    // Check 4: Zero consecutive duplicate spam in indices 0 and 1
    if (histAfter.length > 1) {
      assert(
        histAfter[0].videoId !== histAfter[1].videoId,
        `Consecutive dupe transition ${i}: history[0] (${histAfter[0].videoId}) does not duplicate history[1] (${histAfter[1].videoId})`
      );
    }
  }

  // Now verify that a transition to a DIFFERENT video ID DOES record a new entry
  console.log('[SUITE 2] Verifying that a transition to a DIFFERENT track records properly...');
  const differentVideoId = CACHED_VIDEOS[1]; // 'kJQP7kiw5Fk'
  host.emit('add-to-queue', { url: differentVideoId, nickname: 'DifferentBot' });
  await host.waitForState(s => s.queue.length === 1, 3000, 'Different track queued');

  host.emit('skip-video'); // Skip from duplicateVideoId to differentVideoId
  await host.waitForState(s => s.currentVideo && s.currentVideo.videoId === differentVideoId, 3000, 'Different track playing');

  // Now skip differentVideoId to finish it
  host.emit('skip-video');
  await host.waitForState(s => s.currentVideo === null, 3000, 'Different track finished');

  assert(host.state.history[0].videoId === differentVideoId, `Different track recorded as newest in history`);
  assert(host.state.history[1].videoId === duplicateVideoId, `Previous track remains as history[1]`);
  assert(host.state.history.length === 50, `History length remains capped at 50`);

  const memAfterSuite2 = getProcessMemoryMB(serverChild.pid);
  console.log(`[PERF] Memory after Suite 2: ${memAfterSuite2} MB\n`);

  // ==========================================================================
  // SUITE 3: RAPID NETWORK FLAPPING & STATE RECONCILIATION
  // (5 CLIENTS x 10 FLAPS IN RAPID SUCCESSION)
  // ==========================================================================
  console.log('--------------------------------------------------------------------');
  console.log(' SUITE 3: RAPID NETWORK FLAPPING & STATE RECONCILIATION              ');
  console.log(' (5 CLIENTS x 10 FLAPS WITH RAPID REQUEST-STATE RECONCILIATION)     ');
  console.log('--------------------------------------------------------------------');

  // Prepare room state so clients have an active video and queue to reconcile
  host.emit('add-to-queue', { url: CACHED_VIDEOS[2], nickname: 'FlapTest-Active' });
  await host.waitForState(s => !!s.currentVideo, 3000);
  host.emit('add-to-queue', { url: CACHED_VIDEOS[3], nickname: 'FlapTest-Next' });
  await host.waitForState(s => s.queue.length === 1, 3000);

  const clientConfigs = [
    { name: 'Flap-Alpha', color: '#ef4444' },
    { name: 'Flap-Beta', color: '#22c55e' },
    { name: 'Flap-Gamma', color: '#3b82f6' },
    { name: 'Flap-Delta', color: '#eab308' },
    { name: 'Flap-Epsilon', color: '#a855f7' }
  ];

  const FLAP_ROUNDS = 10;
  console.log(`[SUITE 3] Executing ${FLAP_ROUNDS} rapid flapping cycles with 5 concurrent passengers...`);

  for (let round = 1; round <= FLAP_ROUNDS; round++) {
    const clients = clientConfigs.map(cfg => new SimulatedTestClient(cfg.name, allocatedPort, cfg.color));

    // 1. Connect all 5 clients concurrently
    await Promise.all(clients.map(c => c.connect()));

    // 2. All 5 clients immediately request state reconciliation
    for (const c of clients) {
      c.emit('request-state');
    }

    // 3. Await state reconciliation on all 5 clients
    await Promise.all(clients.map(c => c.waitForState(s => s.queue.length === 1 && !!s.currentVideo, 3000, `Round ${round} state sync`)));

    // 4. Verify authoritative state congruence across all 5 clients
    const authoritativeCurrentVideoId = host.state.currentVideo.videoId;
    const authoritativeQueueLen = host.state.queue.length;
    const authoritativeHistoryLen = host.state.history.length;

    for (const c of clients) {
      if (c.state.currentVideo?.videoId !== authoritativeCurrentVideoId) {
        throw new Error(`Round ${round}: Client [${c.name}] currentVideo desync! Expected ${authoritativeCurrentVideoId}, got ${c.state.currentVideo?.videoId}`);
      }
      if (c.state.queue.length !== authoritativeQueueLen) {
        throw new Error(`Round ${round}: Client [${c.name}] queue desync! Expected ${authoritativeQueueLen}, got ${c.state.queue.length}`);
      }
      if (c.state.history.length !== authoritativeHistoryLen) {
        throw new Error(`Round ${round}: Client [${c.name}] history desync! Expected ${authoritativeHistoryLen}, got ${c.state.history.length}`);
      }
      if (c.state.history.length > 50) {
        throw new Error(`Round ${round}: Client [${c.name}] history length exceeded 50 (${c.state.history.length})`);
      }
    }

    // 5. Verify user list includes all 5 clients + host = 6 users total
    await host.waitForUsers(u => Object.keys(u).length === 6, 3000, `Round ${round} user presence`);
    
    // Check vote-skip state: required = floor(6/2)+1 = 4
    if (host.voteSkipState.required !== 4) {
      throw new Error(`Round ${round}: Quorum mismatch! Expected required=4 for 6 users, got ${host.voteSkipState.required}`);
    }

    // 6. Abruptly disconnect all 5 clients
    for (const c of clients) {
      c.disconnect();
    }

    // 7. Await Host detecting departure of all 5 clients (user count drops back to 1)
    await host.waitForUsers(u => Object.keys(u).length === 1, 3000, `Round ${round} client departures`);

    // Quorum adjusts back to 1
    await host.waitForVoteSkip(vs => vs.required === 1, 3000, `Round ${round} post-disconnect quorum adjusting to 1`);


    if (round % 2 === 0 || round === FLAP_ROUNDS) {
      console.log(`  [PROGRESS] Flapping cycle ${round}/${FLAP_ROUNDS} complete - State snapshots, user updates & quorums verified 100% congruent`);
    }

    // Micro-delay between rapid flaps
    await sleep(30);
  }

  assert(true, `All ${FLAP_ROUNDS} rapid flapping rounds completed with 0 desyncs and 100% state congruence`);

  const memAfterSuite3 = getProcessMemoryMB(serverChild.pid);
  console.log(`[PERF] Memory after Suite 3 (50 client reconnections): ${memAfterSuite3} MB\n`);

  // ==========================================================================
  // SUITE 4: PROCESS STABILITY, MEMORY BOUNDING & CRASH LOG INSPECTION
  // ==========================================================================
  console.log('--------------------------------------------------------------------');
  console.log(' SUITE 4: PROCESS STABILITY, MEMORY & CRASH GUARDRAIL INSPECTION    ');
  console.log('--------------------------------------------------------------------');

  // Check stderr and stdout logs for critical errors
  const allStderr = serverStderrLogs.join('\n');
  const allStdout = serverStdoutLogs.join('\n');

  const criticalErrors = [];
  if (allStderr.includes('[CRITICAL]') || allStdout.includes('[CRITICAL]')) {
    criticalErrors.push('Found [CRITICAL] log entry in server output');
  }
  if (/UnhandledPromiseRejection/i.test(allStderr) || /Unhandled promise rejection/i.test(allStderr)) {
    criticalErrors.push('Found UnhandledPromiseRejection in server stderr');
  }
  if (/UncaughtException/i.test(allStderr) || /Uncaught exception/i.test(allStderr)) {
    criticalErrors.push('Found UncaughtException in server stderr');
  }

  assert(criticalErrors.length === 0, `Zero critical unhandled errors or rejections in server process`, criticalErrors.join(', '));

  // Memory Stability Analysis
  console.log(`[MEM STATS] Initial: ${initialMemoryMB} MB | After Suite 1: ${memAfterSuite1} MB | After Suite 2: ${memAfterSuite2} MB | Final: ${memAfterSuite3} MB`);
  const memDelta = memAfterSuite3 - initialMemoryMB;
  console.log(`[MEM STATS] Total Net Working Set Growth: ${memDelta >= 0 ? '+' : ''}${memDelta.toFixed(2)} MB`);

  assert(memDelta < 60, `Server process memory is strictly bounded (net growth ${memDelta.toFixed(2)} MB < 60 MB limit)`);
  assert(host.state.history.length === 50, `Final state.history.length is exactly 50 (strictly O(1))`);

  // Final responsiveness check: Host sends ping-like state request and gets immediate response
  const finalCheckStart = Date.now();
  host.emit('request-state');
  await host.waitForState(s => s.history.length === 50, 2000, 'Final responsiveness probe');
  const probeLatency = Date.now() - finalCheckStart;
  console.log(`[HEALTH] Final server response latency: ${probeLatency}ms`);
  assert(probeLatency < 500, `Server process remains fast and responsive (${probeLatency}ms < 500ms)`);

  // Clean disconnect of host
  host.disconnect();

  console.log('\n[TEARDOWN] All test suites completed successfully. Terminating server process tree...');
  fullCleanup();
  console.log('[TEARDOWN] Cleanup complete.\n');

  console.log('====================================================================');
  console.log(' STRESS TEST SUMMARY                                                ');
  console.log('====================================================================');
  console.log(`  Total Invariant Checks: ${results.passed + results.failed}`);
  console.log(`  Passed:                 ${results.passed}`);
  console.log(`  Failed:                 ${results.failed}`);
  console.log('====================================================================');

  if (results.failed === 0) {
    console.log('\n🌟 VERDICT: APPROVE - state.history bounded strictly to 50, zero duplicate spam, and flawless state reconciliation under rapid flapping.');
    process.exit(0);
  } else {
    console.error('\n❌ VERDICT: REQUEST_CHANGES - One or more invariant checks failed.');
    process.exit(1);
  }
}

// Run!
runStressSuite().catch((err) => {
  console.error('\n[FATAL] Stress suite runner crashed:', err);
  fullCleanup();
  process.exit(1);
});
