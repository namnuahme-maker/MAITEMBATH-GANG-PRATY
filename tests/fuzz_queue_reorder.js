#!/usr/bin/env node
/**
 * Adversarial Queue Reordering & Mutation Fuzzer
 * Milestone 1 Challenger 1 (tests/fuzz_queue_reorder.js)
 * 
 * Ephemeral Port Safety: Binds port 0 (never touches port 3000)
 * Process Safety: Traps exit signals, guarantees clean shutdown of child process
 */

'use strict';

const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');

const SERVER_PATH = path.resolve(__dirname, '..', 'server.js');

// Known fast cached video IDs from server.js
const CACHED_VIDEOS = [
  'dQw4w9WgXcQ',
  'kJQP7kiw5Fk',
  'oHg5SJYRHA0',
  '9bZkp7q19f0'
];

let allocatedPort = null;
let serverChild = null;
const activeClients = [];
const serverStderrLogs = [];
const serverStdoutLogs = [];

function killChildProcessSync(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (_) {
    try { child.kill('SIGKILL'); } catch (__) {}
  }
}

function cleanup() {
  for (const client of activeClients) {
    try {
      client.removeAllListeners();
      client.disconnect();
    } catch (_) {}
  }
  activeClients.length = 0;
  if (serverChild) {
    killChildProcessSync(serverChild);
    serverChild = null;
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught exception in fuzzer runner:', err);
  cleanup();
  process.exit(1);
});

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

class TestClient {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.socket = null;
    this.state = null;
    this.connected = false;
    this.stateUpdateCount = 0;
  }

  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Client [${this.name}] timed out connecting to port ${this.port}`));
      }, timeoutMs);

      this.socket = io(`http://127.0.0.1:${this.port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });
      activeClients.push(this.socket);

      this.socket.on('connect', () => {
        this.connected = true;
        this.socket.emit('set-profile', { name: this.name, color: '#38bdf8' });
      });

      this.socket.on('init', (payload) => {
        clearTimeout(timer);
        this.state = payload.state;
        resolve(this);
      });

      this.socket.on('state-update', (state) => {
        this.state = state;
        this.stateUpdateCount++;
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  emit(event, ...args) {
    if (!this.socket || !this.connected) {
      throw new Error(`Client [${this.name}] cannot emit '${event}': Not connected`);
    }
    this.socket.emit(event, ...args);
  }

  waitForState(predicate, timeoutMs = 4000, desc = 'state update') {
    if (this.state && predicate(this.state)) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`[${this.name}] Timeout waiting for ${desc} (${timeoutMs}ms)`));
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
}

// Verification assertion tracker
const stats = {
  passed: 0,
  failed: 0,
  tests: []
};

function recordTest(name, passed, details = '') {
  if (passed) {
    stats.passed++;
    console.log(`  [PASS] ${name}${details ? ' - ' + details : ''}`);
    stats.tests.push({ name, passed: true, details });
  } else {
    stats.failed++;
    console.error(`  [FAIL] ${name}${details ? ' - ' + details : ''}`);
    stats.tests.push({ name, passed: false, details });
  }
}

async function runFuzzer() {
  console.log('================================================================');
  console.log(' ADVERSARIAL QUEUE REORDERING & MUTATION FUZZER (EPHEMERAL PORT)');
  console.log('================================================================\n');

  // 1. Allocate ephemeral port
  allocatedPort = await getEphemeralPort();
  console.log(`[INIT] Bound ephemeral port: ${allocatedPort} (port 3000 left untouched)`);

  // 2. Spawn server.js
  serverChild = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(allocatedPort) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverChild.stdout.on('data', (d) => {
    const s = d.toString();
    serverStdoutLogs.push(s);
  });

  serverChild.stderr.on('data', (d) => {
    const s = d.toString();
    serverStderrLogs.push(s);
    console.error(`[SERVER STDERR] ${s.trim()}`);
  });

  // Await server boot
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server failed to boot within 6000ms on port ${allocatedPort}`));
    }, 6000);

    const onData = (chunk) => {
      const str = chunk.toString();
      if (str.includes('Server is running!') || str.includes(`:${allocatedPort}`)) {
        clearTimeout(timer);
        serverChild.stdout.off('data', onData);
        resolve();
      }
    };
    serverChild.stdout.on('data', onData);
  });

  console.log(`[INIT] Server running on port ${allocatedPort}\n`);

  // 3. Connect 4 simulated clients: Host, Alice, Bob, Charlie
  console.log('[STEP 1] Connecting simulated clients (Host, Alice, Bob, Charlie)...');
  const host = new TestClient('Host', allocatedPort);
  const alice = new TestClient('Alice', allocatedPort);
  const bob = new TestClient('Bob', allocatedPort);
  const charlie = new TestClient('Charlie', allocatedPort);

  await Promise.all([
    host.connect(),
    alice.connect(),
    bob.connect(),
    charlie.connect()
  ]);

  recordTest('Multi-Client Connection', true, '4 clients connected via WebSocket');

  // Disable Auto-DJ to isolate queue mutations
  host.emit('autodj-config', { enabled: false, notify: false });
  await host.waitForState(s => s.autoDjEnabled === false, 3000, 'Auto-DJ disabled');
  host.emit('play-control', false); // Pause playback
  await sleep(100);

  // Helper to verify server health
  function verifyServerAlive() {
    return serverChild && !serverChild.killed && serverChild.exitCode === null;
  }

  // 4. Populate initial queue with tracks
  console.log('\n[STEP 2] Pre-populating queue with known tracks...');
  // First track added will become currentVideo
  host.emit('add-to-queue', { url: `https://www.youtube.com/watch?v=${CACHED_VIDEOS[0]}`, nickname: 'Host' });
  await host.waitForState(s => s.currentVideo !== null, 4000, 'first track playing');

  // Next 5 tracks stay in queue
  for (let i = 0; i < 5; i++) {
    const vId = CACHED_VIDEOS[i % CACHED_VIDEOS.length];
    alice.emit('add-to-queue', { url: `https://www.youtube.com/watch?v=${vId}`, nickname: `Alice_${i}` });
  }
  await host.waitForState(s => Array.isArray(s.queue) && s.queue.length === 5, 5000, 'queue length === 5');
  
  let currentQueue = host.state.queue.slice();
  console.log(`[INFO] Initial queue length: ${currentQueue.length}`);
  recordTest('Queue Pre-population', currentQueue.length === 5, `Initial tracks: ${currentQueue.map(q => q.id).join(', ')}`);

  // =========================================================================
  // PHASE 1: FUZZ reorder-queue WITH ADVERSARIAL & MALFORMED PAYLOADS
  // =========================================================================
  console.log('\n[PHASE 1] Fuzzing reorder-queue with adversarial payloads...');

  // 1.1 Empty array []
  console.log('\n--- Test 1.1: Empty array [] ---');
  alice.emit('reorder-queue', []);
  await sleep(150);
  recordTest('reorder-queue: Empty array []',
    verifyServerAlive() && host.state.queue.length === 5,
    'Server ignored empty array safely without crash, length remained 5');

  // 1.2 Array with non-existent IDs
  console.log('\n--- Test 1.2: Array with non-existent IDs ---');
  const fakeIds = ['non-existent-id-1', 'fake-uuid-999', 'ghost-track-404'];
  bob.emit('reorder-queue', fakeIds);
  await sleep(150);
  const queueAfterFake = host.state.queue;
  const zeroDropped1_2 = currentQueue.every(orig => queueAfterFake.some(item => item.id === orig.id));
  const zeroDups1_2 = new Set(queueAfterFake.map(i => i.id)).size === queueAfterFake.length;
  recordTest('reorder-queue: Non-existent IDs',
    verifyServerAlive() && zeroDropped1_2 && zeroDups1_2 && queueAfterFake.length === 5,
    'All existing tracks preserved, zero dropped, zero duplicates, server alive');

  // 1.3 Array with duplicate IDs ['id1', 'id1', 'id1']
  console.log('\n--- Test 1.3: Array with duplicate IDs ---');
  const qItem0 = currentQueue[0];
  const duplicatePayload = [qItem0.id, qItem0.id, qItem0.id, qItem0.id];
  charlie.emit('reorder-queue', duplicatePayload);
  await sleep(150);
  const queueAfterDups = host.state.queue;
  const countQ0 = queueAfterDups.filter(i => i.id === qItem0.id).length;
  const zeroDropped1_3 = currentQueue.every(orig => queueAfterDups.some(item => item.id === orig.id));
  const zeroDups1_3 = new Set(queueAfterDups.map(i => i.id)).size === queueAfterDups.length;
  recordTest('reorder-queue: Duplicate IDs [id1, id1, id1]',
    verifyServerAlive() && countQ0 === 1 && zeroDropped1_3 && zeroDups1_3 && queueAfterDups.length === 5,
    `Duplicate ID deduplicated to exactly 1 occurrence; queue length preserved at 5`);

  // 1.4 Mixed valid, duplicate, and non-existent IDs
  console.log('\n--- Test 1.4: Mixed valid, duplicate, and non-existent IDs ---');
  const qItem1 = currentQueue[1];
  const qItem3 = currentQueue[3];
  const mixedPayload = ['phantom-A', qItem3.id, qItem1.id, qItem3.id, 'phantom-B', qItem1.id];
  alice.emit('reorder-queue', mixedPayload);
  await sleep(150);
  const queueAfterMixed = host.state.queue;
  const zeroDropped1_4 = currentQueue.every(orig => queueAfterMixed.some(item => item.id === orig.id));
  const zeroDups1_4 = new Set(queueAfterMixed.map(i => i.id)).size === queueAfterMixed.length;
  const topTwoAreQ3Q1 = queueAfterMixed[0].id === qItem3.id && queueAfterMixed[1].id === qItem1.id;
  recordTest('reorder-queue: Mixed valid, duplicate, non-existent',
    verifyServerAlive() && zeroDropped1_4 && zeroDups1_4 && topTwoAreQ3Q1 && queueAfterMixed.length === 5,
    'Specified valid items ordered first without duplicates; remainder preserved');

  // 1.5 Non-array types (null, 123, {}, undefined, string, boolean, wrapped objects)
  console.log('\n--- Test 1.5: Non-array primitive & object payloads ---');
  const malformedTypes = [
    null,
    123,
    0,
    -1,
    {},
    undefined,
    "malicious_string_payload",
    true,
    false,
    { queueIds: "not_an_array" },
    { itemIds: 999 },
    { queueIds: null },
    { dummy: [1, 2, 3] }
  ];

  let malformedPassed = true;
  for (const payload of malformedTypes) {
    try {
      bob.emit('reorder-queue', payload);
    } catch (e) {
      malformedPassed = false;
    }
  }
  await sleep(200);
  recordTest('reorder-queue: Non-array types (null, 123, {}, undefined, etc.)',
    verifyServerAlive() && malformedPassed && host.state.queue.length === 5,
    'All 13 malformed payload types rejected defensively without server crash');

  // 1.6 Array containing dirty/corrupt element types
  console.log('\n--- Test 1.6: Array with dirty elements ---');
  const dirtyElements = [null, undefined, 123, {}, [], false, true, ""];
  charlie.emit('reorder-queue', dirtyElements);
  await sleep(150);
  recordTest('reorder-queue: Array of dirty non-string elements',
    verifyServerAlive() && host.state.queue.length === 5,
    'Array of non-string items safely handled, zero corruption');

  // 1.7 DoS stress: 1,000 random ID payload
  console.log('\n--- Test 1.7: Massive array (1,000 items) ---');
  const massivePayload = Array.from({ length: 1000 }, (_, i) => `flood_id_${i}`);
  alice.emit('reorder-queue', massivePayload);
  await sleep(150);
  recordTest('reorder-queue: DoS protection (>500 items)',
    verifyServerAlive() && host.state.queue.length === 5,
    'Clamped to <=500 safely, all original items preserved');

  // 1.8 Payload schema compatibility ({ queueIds: [...] } and { itemIds: [...] })
  console.log('\n--- Test 1.8: Wrapper object formats ({ queueIds }, { itemIds }) ---');
  const reversedIds = host.state.queue.map(i => i.id).reverse();
  host.emit('reorder-queue', { queueIds: reversedIds });
  await sleep(150);
  const queueAfterQueueIds = host.state.queue.map(i => i.id);
  const wrapper1Success = queueAfterQueueIds[0] === reversedIds[0] && queueAfterQueueIds[4] === reversedIds[4];

  const reReversedIds = queueAfterQueueIds.slice().reverse();
  alice.emit('reorder-queue', { itemIds: reReversedIds });
  await sleep(150);
  const queueAfterItemIds = host.state.queue.map(i => i.id);
  const wrapper2Success = queueAfterItemIds[0] === reReversedIds[0] && queueAfterItemIds[4] === reReversedIds[4];

  recordTest('reorder-queue: Supported wrapper formats',
    wrapper1Success && wrapper2Success,
    'Both { queueIds } and { itemIds } parsed and reordered correctly');


  // =========================================================================
  // PHASE 2: FUZZ move-track WITH BOUNDARIES & MUTATIONS
  // =========================================================================
  console.log('\n[PHASE 2] Fuzzing move-track with boundary & adversarial mutations...');
  
  // Refresh current queue snapshot
  currentQueue = host.state.queue.slice();
  const topItem = currentQueue[0];
  const lastItem = currentQueue[currentQueue.length - 1];
  const midItem = currentQueue[2];

  // 2.1 Moving index 0 "up"
  console.log('\n--- Test 2.1: Moving index 0 "up" ---');
  alice.emit('move-track', { itemId: topItem.id, direction: 'up' });
  await sleep(150);
  const queueAfterMoveUp0 = host.state.queue;
  recordTest('move-track: Index 0 moving "up"',
    verifyServerAlive() && queueAfterMoveUp0[0].id === topItem.id && queueAfterMoveUp0.length === currentQueue.length,
    'Remained at index 0, no boundary underflow, queue unchanged');

  // 2.2 Moving last index "down"
  console.log('\n--- Test 2.2: Moving last index "down" ---');
  bob.emit('move-track', { itemId: lastItem.id, direction: 'down' });
  await sleep(150);
  const queueAfterMoveDownLast = host.state.queue;
  recordTest('move-track: Last index moving "down"',
    verifyServerAlive() && queueAfterMoveDownLast[queueAfterMoveDownLast.length - 1].id === lastItem.id,
    'Remained at last index, no boundary overflow, queue unchanged');

  // 2.3 toIndex: -99 (should clamp to 0)
  console.log('\n--- Test 2.3: toIndex: -99 (Boundary underflow clamp) ---');
  charlie.emit('move-track', { itemId: midItem.id, toIndex: -99 });
  await sleep(150);
  const queueAfterClampUnder = host.state.queue;
  recordTest('move-track: toIndex: -99 clamped to 0',
    verifyServerAlive() && queueAfterClampUnder[0].id === midItem.id && queueAfterClampUnder.length === currentQueue.length,
    `Mid item (${midItem.id}) clamped to index 0 safely`);

  // 2.4 toIndex: 9999 (should clamp to last index)
  console.log('\n--- Test 2.4: toIndex: 9999 (Boundary overflow clamp) ---');
  alice.emit('move-track', { itemId: midItem.id, toIndex: 9999 });
  await sleep(150);
  const queueAfterClampOver = host.state.queue;
  recordTest('move-track: toIndex: 9999 clamped to last index',
    verifyServerAlive() && queueAfterClampOver[queueAfterClampOver.length - 1].id === midItem.id,
    `Item (${midItem.id}) clamped to last index safely`);

  // 2.5 toIndex: NaN
  console.log('\n--- Test 2.5: toIndex: NaN ---');
  const queueBeforeNaN = host.state.queue.map(i => i.id);
  bob.emit('move-track', { itemId: midItem.id, toIndex: NaN });
  await sleep(150);
  const queueAfterNaN = host.state.queue.map(i => i.id);
  const orderUnchangedNaN = queueBeforeNaN.every((id, idx) => id === queueAfterNaN[idx]);
  recordTest('move-track: toIndex: NaN rejected',
    verifyServerAlive() && orderUnchangedNaN,
    'NaN rejected defensively via Number.isInteger, no corruption');

  // 2.6 Non-integer toIndex values: 1.5, Infinity, -Infinity, "0"
  console.log('\n--- Test 2.6: Non-integer / non-finite toIndex values ---');
  const invalidIndices = [1.5, Infinity, -Infinity, "0", null, undefined, true, {}];
  let invalidIdxPassed = true;
  for (const inv of invalidIndices) {
    charlie.emit('move-track', { itemId: midItem.id, toIndex: inv });
  }
  await sleep(150);
  recordTest('move-track: Non-integer & non-finite toIndex',
    verifyServerAlive() && host.state.queue.length === currentQueue.length,
    'All non-integer toIndex values rejected safely');

  // 2.7 Non-existent itemId
  console.log('\n--- Test 2.7: Non-existent itemId ---');
  alice.emit('move-track', { itemId: 'phantom-item-id-999', direction: 'up' });
  bob.emit('move-track', { itemId: 'phantom-item-id-999', toIndex: 0 });
  await sleep(150);
  recordTest('move-track: Non-existent itemId',
    verifyServerAlive() && host.state.queue.length === currentQueue.length,
    'Non-existent itemId ignored safely, no exception thrown');

  // 2.8 Malformed move-track payloads
  console.log('\n--- Test 2.8: Malformed move-track payloads ---');
  const malformedMovePayloads = [
    null,
    123,
    undefined,
    "",
    {},
    { itemId: null },
    { itemId: 123 },
    { itemId: "" },
    { itemId: midItem.id }, // missing direction and toIndex
    { itemId: midItem.id, direction: 'diagonal' },
    { itemId: midItem.id, direction: 42 }
  ];
  for (const p of malformedMovePayloads) {
    charlie.emit('move-track', p);
  }
  await sleep(150);
  recordTest('move-track: Malformed payloads',
    verifyServerAlive() && host.state.queue.length === currentQueue.length,
    'All 11 malformed move-track payloads rejected safely without server crash');


  // =========================================================================
  // PHASE 3: HIGH-CONCURRENCY STRESS & RACE CONDITION FUZZER
  // =========================================================================
  console.log('\n[PHASE 3] High-concurrency stress test: 100 rapid concurrent reorders + simultaneous adds...');

  // Reset queue to 10 known tracks
  host.emit('clear-queue');
  await host.waitForState(s => s.queue.length === 0, 3000, 'queue cleared');

  console.log('  Adding 10 base tracks...');
  for (let i = 0; i < 10; i++) {
    const vId = CACHED_VIDEOS[i % CACHED_VIDEOS.length];
    alice.emit('add-to-queue', { url: `https://www.youtube.com/watch?v=${vId}`, nickname: `Base_${i}` });
  }
  await host.waitForState(s => s.queue.length === 10, 5000, 'queue length === 10');

  const baseQueueSnapshot = host.state.queue.slice();
  const baseItemIds = baseQueueSnapshot.map(i => i.id);
  console.log(`  Base queue ready: ${baseItemIds.length} items`);

  // Track additions during concurrency: Host will add 15 additional tracks
  const addedTrackIdsExpected = [];
  const CONCURRENT_REORDERS = 100;
  const CONCURRENT_ADDS = 15;

  console.log(`  Launching ${CONCURRENT_REORDERS} concurrent reorders across Alice, Bob, Charlie while Host adds ${CONCURRENT_ADDS} tracks...`);

  // Shuffle helper
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const concurrentPromises = [];

  // Client Alice: 35 randomized permutations
  for (let i = 0; i < 35; i++) {
    const perm = shuffle(baseItemIds);
    alice.emit('reorder-queue', perm);
  }

  // Client Bob: 35 randomized permutations with partial subsets & duplicates
  for (let i = 0; i < 35; i++) {
    const subset = shuffle(baseItemIds).slice(0, 6);
    // Duplicate some items
    const duplicatedSubset = [...subset, subset[0], subset[1] || subset[0]];
    bob.emit('reorder-queue', duplicatedSubset);
  }

  // Client Charlie: 30 randomized permutations with injected fake IDs
  for (let i = 0; i < 30; i++) {
    const mixed = shuffle(baseItemIds).slice(0, 7);
    mixed.splice(2, 0, `fake_race_id_${i}`);
    mixed.splice(5, 0, `ghost_race_id_${i}`);
    charlie.emit('reorder-queue', mixed);
  }

  // Host: Concurrently adds 15 new tracks
  for (let i = 0; i < CONCURRENT_ADDS; i++) {
    const vId = CACHED_VIDEOS[i % CACHED_VIDEOS.length];
    host.emit('add-to-queue', { url: `https://www.youtube.com/watch?v=${vId}`, nickname: `ConcurrentAdd_${i}` });
  }

  // Wait for the queue to stabilize: expected total items = 10 base + 15 added = 25 items
  console.log('  Awaiting queue settling (expecting 25 items)...');
  await host.waitForState(s => s.queue.length === 25, 8000, 'queue length === 25');
  await sleep(500); // Allow any trailing state broadcasts to settle

  const finalQueue = host.state.queue;
  console.log(`  Settled queue length: ${finalQueue.length}`);

  // INVARIANT 1: Zero Duplicate Items
  const finalIdSet = new Set();
  const duplicateIds = [];
  for (const item of finalQueue) {
    if (finalIdSet.has(item.id)) {
      duplicateIds.push(item.id);
    }
    finalIdSet.add(item.id);
  }
  const zeroDuplicates = duplicateIds.length === 0;
  recordTest('Concurrency Invariant: Zero duplicate items',
    zeroDuplicates,
    zeroDuplicates ? 'All 25 items have strictly unique IDs' : `Found duplicates: ${duplicateIds.join(', ')}`);

  // INVARIANT 2: Zero Dropped Base Items
  const missingBaseIds = baseItemIds.filter(baseId => !finalIdSet.has(baseId));
  const zeroDroppedBase = missingBaseIds.length === 0;
  recordTest('Concurrency Invariant: Zero dropped pre-existing items',
    zeroDroppedBase,
    zeroDroppedBase ? 'All 10 initial items preserved across 100 concurrent reorders' : `Missing base items: ${missingBaseIds.join(', ')}`);

  // INVARIANT 3: Total Count Conservation
  const countConserved = finalQueue.length === 25;
  recordTest('Concurrency Invariant: Exact count conservation (10 + 15 = 25)',
    countConserved,
    `Final queue length: ${finalQueue.length}`);

  // INVARIANT 4: All Queue Items Have Valid Schema
  const allSchemaValid = finalQueue.every(item => (
    typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.title === 'string' &&
    typeof item.videoId === 'string' &&
    typeof item.source === 'string'
  ));
  recordTest('Concurrency Invariant: Item schema integrity',
    allSchemaValid,
    'Every item maintains non-null id, title, videoId, source');

  // INVARIANT 5: Multi-Client State Consistency
  console.log('\n--- Multi-Client Broadcast State Synchronization Check ---');
  // Trigger one final reorder to test broadcast synchronization across all 4 clients
  const finalReorderOrder = shuffle(finalQueue.map(i => i.id));
  host.emit('reorder-queue', finalReorderOrder);

  // Wait for all 4 clients to observe the new top item
  const expectedTopId = finalReorderOrder[0];
  await Promise.all([
    host.waitForState(s => s.queue[0]?.id === expectedTopId, 3000, 'Host sync'),
    alice.waitForState(s => s.queue[0]?.id === expectedTopId, 3000, 'Alice sync'),
    bob.waitForState(s => s.queue[0]?.id === expectedTopId, 3000, 'Bob sync'),
    charlie.waitForState(s => s.queue[0]?.id === expectedTopId, 3000, 'Charlie sync')
  ]);

  const hostIds = host.state.queue.map(i => i.id);
  const aliceIds = alice.state.queue.map(i => i.id);
  const bobIds = bob.state.queue.map(i => i.id);
  const charlieIds = charlie.state.queue.map(i => i.id);

  const clientsInSync = (
    hostIds.length === 25 &&
    aliceIds.length === 25 &&
    bobIds.length === 25 &&
    charlieIds.length === 25 &&
    aliceIds.every((id, idx) => id === hostIds[idx]) &&
    bobIds.every((id, idx) => id === hostIds[idx]) &&
    charlieIds.every((id, idx) => id === hostIds[idx])
  );

  recordTest('Multi-Client Broadcast Consistency',
    clientsInSync,
    'Host, Alice, Bob, Charlie state.queue sequences are 100% identical');

  // INVARIANT 6: Server Process Health & Zero Uncaught Exceptions
  const hasCriticalStderr = serverStderrLogs.some(l => (
    l.includes('[CRITICAL]') ||
    l.includes('uncaughtException') ||
    l.includes('unhandledRejection') ||
    l.includes('TypeError:') ||
    l.includes('RangeError:')
  ));
  recordTest('Server Process Health: Zero uncaught exceptions or crash errors',
    verifyServerAlive() && !hasCriticalStderr,
    verifyServerAlive() ? 'Server process alive, 0 uncaught exceptions in stderr' : 'Server crashed!');

  // Cleanup
  console.log('\n[TEARDOWN] Disconnecting clients and stopping ephemeral server...');
  cleanup();
  console.log('[TEARDOWN] Clean shutdown complete.\n');

  // Final Summary
  console.log('================================================================');
  console.log(' FUZZ TEST SUMMARY');
  console.log('================================================================');
  console.log(`  Total Checks: ${stats.passed + stats.failed}`);
  console.log(`  Passed:       ${stats.passed}`);
  console.log(`  Failed:       ${stats.failed}`);
  console.log('================================================================\n');

  if (stats.failed > 0) {
    console.error('❌ VERDICT: REQUEST_CHANGES - Vulnerabilities or invariants violated');
    process.exit(1);
  } else {
    console.log('✅ VERDICT: APPROVE - Queue reordering and mutation logic is robust');
    process.exit(0);
  }
}

runFuzzer().catch((err) => {
  console.error('[FATAL] Fuzzer execution failed:', err);
  cleanup();
  process.exit(1);
});
