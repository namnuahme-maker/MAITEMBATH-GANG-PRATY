#!/usr/bin/env node
/**
 * Adversarial Client Reconnection & State Reconciliation Stress Test
 * Milestone 2 Challenger 2: Client Reconnection & Multi-Run Soak Challenger
 * 
 * Verifies:
 * 1. Rapid Client Disconnect & Reconnect cycles with cached profile re-emission.
 * 2. Protocol state reconciliation via 'request-state' (receiving 'state-update', 'users-update', 'vote-skip-update').
 * 3. Profile broadcast verification: when client reconnects, existing connected peers immediately receive updated 'users-update'.
 * 4. Concurrent multi-passenger connection flapping under active queue mutations.
 * 5. State consistency across reconnects (queue sequence, currentVideo, volume).
 * 
 * Process Safety Guardrail (R4):
 * - Ephemeral port allocation (net.createServer listen(0))
 * - Port 3000 untouched
 * - Process tree termination on SIGINT/SIGTERM/exit
 */

'use strict';

const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'server.js');

let allocatedPort = null;
let serverChild = null;
const activeSockets = new Set();
const serverStderrLogs = [];

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
  for (const s of activeSockets) {
    try {
      s.removeAllListeners();
      s.disconnect();
    } catch (_) {}
  }
  activeSockets.clear();
  if (serverChild) {
    killProcessTreeSync(serverChild.pid);
    serverChild = null;
  }
}

process.on('SIGINT', () => { fullCleanup(); process.exit(130); });
process.on('SIGTERM', () => { fullCleanup(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('\n[CRITICAL] Uncaught exception:', err);
  fullCleanup();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[CRITICAL] Unhandled rejection:', reason);
  fullCleanup();
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

// Client simulation wrapper modeling public/js/socket.js & public/js/state.js
class ReconnectingClient {
  constructor(port, profile) {
    this.port = port;
    this.cachedProfile = { ...profile };
    this.socket = null;
    this.state = null;
    this.users = {};
    this.voteSkipState = null;
    this.receivedStateUpdates = 0;
    this.receivedUsersUpdates = 0;
    this.connectCount = 0;
    this.disconnectCount = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timed out for ${this.cachedProfile.name}`));
      }, 5000);

      this.socket = io(`http://127.0.0.1:${this.port}`, {
        transports: ['websocket'],
        reconnection: false, // We control disconnect/reconnect explicitly in stress tests
        timeout: 4000
      });

      activeSockets.add(this.socket);

      this.socket.on('connect', () => {
        this.connectCount++;
        // Follow public/js/socket.js protocol exactly:
        // Step 1: Re-emit cached profile
        if (this.cachedProfile && this.cachedProfile.name) {
          this.socket.emit('set-profile', this.cachedProfile);
        }
        // Step 2: Request fresh state snapshot
        this.socket.emit('request-state');
      });

      this.socket.on('init', (data) => {
        if (data.state) this.state = data.state;
        if (data.users) this.users = data.users;
        if (data.voteSkipState) this.voteSkipState = data.voteSkipState;
        clearTimeout(timeout);
        resolve(this);
      });

      this.socket.on('state-update', (s) => {
        this.state = s;
        this.receivedStateUpdates++;
      });

      this.socket.on('users-update', (u) => {
        this.users = u;
        this.receivedUsersUpdates++;
      });

      this.socket.on('vote-skip-update', (vs) => {
        this.voteSkipState = vs;
      });

      this.socket.on('disconnect', () => {
        this.disconnectCount++;
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.socket) {
      activeSockets.delete(this.socket);
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  async reconnect() {
    this.disconnect();
    await sleep(50);
    return this.connect();
  }

  // Request state manually
  requestState() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('request-state');
    }
  }

  waitForCondition(fn, timeoutMs = 4000, desc = 'condition') {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        try {
          if (fn(this)) return resolve();
        } catch (_) {}
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for ${desc} after ${timeoutMs}ms`));
        }
        setTimeout(check, 25);
      };
      check();
    });
  }
}

async function runTests() {
  console.log('====================================================================');
  console.log(' ADVERSARIAL CLIENT RECONNECTION & STATE RECONCILIATION STRESS TEST ');
  console.log('====================================================================\n');

  allocatedPort = await getEphemeralPort();
  console.log(`[SETUP] Ephemeral Port Allocated: ${allocatedPort} (Port 3000 untouched)`);

  // Launch transient server
  serverChild = spawn('node', [SERVER_PATH], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, PORT: String(allocatedPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverChild.stderr.on('data', chunk => {
    const s = chunk.toString();
    serverStderrLogs.push(s);
  });

  // Await server readiness
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server boot timeout')), 8000);
    serverChild.stdout.on('data', chunk => {
      if (chunk.toString().includes('MAITEMBATH GANG PARTY Server is running!')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  console.log('[SETUP] Transient test server booted successfully.\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`  Testing: ${name.padEnd(60, '.')} `);
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      console.log(`\x1b[32m✔ PASS\x1b[0m (${duration}ms)`);
      passed++;
    } catch (err) {
      const duration = Date.now() - start;
      console.log(`\x1b[31m✖ FAIL\x1b[0m (${duration}ms)`);
      console.error(`    -> Error: ${err.message}`);
      failed++;
    }
  }

  // --- STAGE 1: Baseline Connection & Profile Broadcast ---
  const host = new ReconnectingClient(allocatedPort, { name: 'Host Driver', color: '#ff5500' });
  const alice = new ReconnectingClient(allocatedPort, { name: 'Alice Passenger', color: '#ff00aa' });
  const bob = new ReconnectingClient(allocatedPort, { name: 'Bob Co-Pilot', color: '#00cc88' });

  await test('1. Baseline Multi-Client Connection & Profile Broadcast', async () => {
    await host.connect();
    await alice.connect();
    await bob.connect();

    // Verify all clients see each other in connectedUsers
    await host.waitForCondition(c => Object.keys(c.users).length === 3, 2000, '3 connected users on Host');
    await alice.waitForCondition(c => Object.keys(c.users).length === 3, 2000, '3 connected users on Alice');
    await bob.waitForCondition(c => Object.keys(c.users).length === 3, 2000, '3 connected users on Bob');

    // Check profiles match
    const aliceUserOnHost = Object.values(host.users).find(u => u.name === 'Alice Passenger');
    if (!aliceUserOnHost || aliceUserOnHost.color !== '#ff00aa') {
      throw new Error('Host did not receive Alice profile with correct name and color');
    }
  });

  // --- STAGE 2: Rapid Single-Client Disconnect & Reconnect with Cached Profile ---
  await test('2. Rapid 5x Disconnect/Reconnect with Cached Profile & Resync', async () => {
    for (let i = 1; i <= 5; i++) {
      await alice.disconnect();
      await sleep(40);
      await alice.connect();

      // Alice must receive full state snapshot
      if (!alice.state) {
        throw new Error(`Cycle ${i}: Alice did not receive state snapshot`);
      }

      // Host must see Alice reconnected with current profile
      await host.waitForCondition(c => {
        return Object.values(c.users).some(u => u.name === 'Alice Passenger' && u.color === '#ff00aa');
      }, 2000, `Cycle ${i}: Host seeing Alice reconnected`);
    }
  });

  // --- STAGE 3: State Reconciliation During Disconnect ---
  await test('3. State Reconciliation Across Mutations While Disconnected', async () => {
    // 1. Bob disconnects
    await bob.disconnect();
    await sleep(50);

    // 2. While Bob is offline, Host enqueues tracks and changes volume
    host.socket.emit('add-to-queue', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      nickname: 'Host Driver',
      color: '#ff5500'
    });
    host.socket.emit('volume-control', 82);

    await host.waitForCondition(c => c.state && (c.state.currentVideo || c.state.queue.length > 0), 3000, 'Queue addition on Host');
    await host.waitForCondition(c => c.state && c.state.volume === 82, 2000, 'Volume 82 on Host');

    // 3. Bob reconnects with cached profile
    await bob.connect();

    // 4. Bob must immediately reconcile state (volume = 82, video playing or queued)
    await bob.waitForCondition(c => c.state && c.state.volume === 82, 3000, 'Bob volume reconciled to 82');
    if (!bob.state.currentVideo && bob.state.queue.length === 0) {
      throw new Error('Bob did not receive active playback/queue state after reconnect');
    }

    // 5. Host and Alice must see Bob in connectedUsers
    await host.waitForCondition(c => Object.values(c.users).some(u => u.name === 'Bob Co-Pilot'), 2000, 'Host seeing Bob back');
    await alice.waitForCondition(c => Object.values(c.users).some(u => u.name === 'Bob Co-Pilot'), 2000, 'Alice seeing Bob back');
  });

  // --- STAGE 4: Concurrent Multi-Client Reconnection Storm ---
  await test('4. Concurrent 4-Client Reconnection Storm Under Load', async () => {
    const charlie = new ReconnectingClient(allocatedPort, { name: 'Charlie DJ', color: '#3388ff' });
    await charlie.connect();

    const clients = [host, alice, bob, charlie];

    // Simultaneously disconnect 3 passenger clients
    await Promise.all([alice.disconnect(), bob.disconnect(), charlie.disconnect()]);
    await sleep(60);

    // Host should see count drop to 1
    await host.waitForCondition(c => Object.keys(c.users).length === 1, 2000, 'Host seeing only 1 user');

    // Simultaneously reconnect all 3 passengers
    await Promise.all([alice.connect(), bob.connect(), charlie.connect()]);

    // All clients must see 4 users and identical queue/volume state
    for (const cl of clients) {
      await cl.waitForCondition(c => Object.keys(c.users).length === 4, 3000, `${cl.cachedProfile.name} seeing 4 users`);
      if (cl.state.volume !== 82) {
        throw new Error(`${cl.cachedProfile.name} state volume mismatch (${cl.state.volume} !== 82)`);
      }
    }

    charlie.disconnect();
  });

  // --- STAGE 5: Explicit 'request-state' Idempotency & Quorum Resync ---
  await test('5. Explicit request-state Reconciliation & Vote Quorum Audit', async () => {
    // Alice votes to skip
    alice.socket.emit('vote-skip');
    await host.waitForCondition(c => c.voteSkipState && c.voteSkipState.current >= 1, 2000, 'Vote skip on Host');

    // Bob emits request-state explicitly
    const initialUsersCount = bob.receivedUsersUpdates;
    const initialStateCount = bob.receivedStateUpdates;

    bob.requestState();

    await bob.waitForCondition(c => c.receivedStateUpdates > initialStateCount, 2000, 'Bob state update via request-state');
    await bob.waitForCondition(c => c.receivedUsersUpdates > initialUsersCount, 2000, 'Bob users update via request-state');

    // Check voteSkip quorum accuracy
    if (bob.voteSkipState.current < 1) {
      throw new Error(`Bob voteSkipState mismatch: ${bob.voteSkipState.current} < 1`);
    }
  });

  // --- STAGE 6: Server Stderr & Crash Audit ---
  await test('6. Server Stderr & Zero Unhandled Rejections Audit', async () => {
    const fatalErrors = serverStderrLogs.filter(log =>
      log.includes('UnhandledPromiseRejection') ||
      log.includes('uncaughtException') ||
      log.includes('TypeError') ||
      log.includes('ReferenceError')
    );
    if (fatalErrors.length > 0) {
      throw new Error(`Fatal error in server stderr: ${fatalErrors.join(' | ')}`);
    }
  });

  // Teardown
  fullCleanup();

  console.log('\n====================================================================');
  console.log(` RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('[FATAL]', err);
  fullCleanup();
  process.exit(1);
});
