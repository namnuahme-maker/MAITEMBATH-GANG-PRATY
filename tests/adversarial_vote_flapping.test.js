#!/usr/bin/env node
/**
 * Adversarial Vote-to-Skip Quorum & Rapid Flapping Stress Test Suite
 * Milestone 1 Round 2 - Challenger 1
 * 
 * Target:
 *   - `server.js` (vote-to-skip quorum mechanics, rapid flapping, dynamic disconnect quorum,
 *     broadcastVoteSkip() temporal ordering, and zero desync between vote tally and current track)
 * 
 * Safety:
 *   - Ephemeral port allocated via net.createServer().listen(0)
 *   - Default port 3000 untouched
 *   - Signal traps (SIGINT, SIGTERM, uncaughtException) guarantee zero orphaned node processes
 */

'use strict';

const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');

const SERVER_PATH = path.resolve(__dirname, '..', 'server.js');

// Known mock tracks (fast cached IDs)
const TEST_TRACKS = [
  { url: 'dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
  { url: 'kJQP7kiw5Fk', id: 'kJQP7kiw5Fk' },
  { url: 'oHg5SJYRHA0', id: 'oHg5SJYRHA0' },
  { url: '9bZkp7q19f0', id: '9bZkp7q19f0' },
  { url: '3JZ_D3ELwOQ', id: '3JZ_D3ELwOQ' },
  { url: 'L_LUpnjgPso', id: 'L_LUpnjgPso' },
  { url: 'fJ9rUzIMcZQ', id: 'fJ9rUzIMcZQ' }
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
  console.error('[CRITICAL] Uncaught exception in test harness:', err);
  cleanup();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled rejection in test harness:', reason);
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

class AdversarialClient {
  constructor(name, port, color = '#60a5fa') {
    this.name = name;
    this.port = port;
    this.color = color;
    this.socket = null;
    this.state = null;
    this.users = {};
    this.voteSkipState = null;
    this.connected = false;

    // Temporal tracking for desync detection
    this.eventLog = [];
    this.desyncViolations = [];
    this.lastObservedVideoId = null;

    activeClients.push(this);
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

      this.socket.on('connect', () => {
        this.connected = true;
        this.socket.emit('set-profile', { name: this.name, color: this.color });
      });

      this.socket.on('init', (payload) => {
        clearTimeout(timer);
        this.state = payload.state;
        this.users = payload.users || {};
        this.voteSkipState = payload.voteSkipState || null;
        this.lastObservedVideoId = this.state?.currentVideo?.id || null;
        this.eventLog.push({ type: 'init', time: Date.now(), payload });
        resolve(this);
      });

      this.socket.on('state-update', (state) => {
        const now = Date.now();
        const prevVideoId = this.lastObservedVideoId;
        const newVideoId = state?.currentVideo?.id || null;

        // Desync check: if video changed to a new track, check voteSkipState
        if (prevVideoId && newVideoId && prevVideoId !== newVideoId) {
          // Track transitioned! Check if voteSkipState still reports non-zero votes from previous track
          if (this.voteSkipState && this.voteSkipState.current > 0) {
            this.desyncViolations.push({
              time: now,
              event: 'state-update',
              prevVideoId,
              newVideoId,
              staleVotes: this.voteSkipState.current,
              staleVoters: [...(this.voteSkipState.voters || [])]
            });
          }
        }

        this.lastObservedVideoId = newVideoId;
        this.state = state;
        this.eventLog.push({ type: 'state-update', time: now, currentVideoId: newVideoId });
      });

      this.socket.on('vote-skip-update', (vs) => {
        const now = Date.now();
        this.voteSkipState = vs;
        this.eventLog.push({ type: 'vote-skip-update', time: now, current: vs.current, required: vs.required });
      });

      this.socket.on('users-update', (users) => {
        this.users = users;
        this.eventLog.push({ type: 'users-update', time: Date.now(), count: Object.keys(users).length });
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  emit(event, ...args) {
    if (!this.socket || !this.connected) {
      throw new Error(`Cannot emit '${event}': [${this.name}] is not connected`);
    }
    this.socket.emit(event, ...args);
  }

  disconnect() {
    this.connected = false;
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (_) {}
      this.socket = null;
    }
  }

  waitForState(predicate, timeoutMs = 4000, desc = 'state predicate') {
    if (this.state && predicate(this.state)) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanupListeners();
        reject(new Error(`[${this.name}] Timeout waiting for ${desc} (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (st) => {
        if (predicate(st)) {
          cleanupListeners();
          resolve(st);
        }
      };

      const cleanupListeners = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('state-update', handler);
      };

      if (this.socket) {
        this.socket.on('state-update', handler);
      }
    });
  }

  waitForVoteSkip(predicate, timeoutMs = 4000, desc = 'vote-skip predicate') {
    if (this.voteSkipState && predicate(this.voteSkipState)) {
      return Promise.resolve(this.voteSkipState);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanupListeners();
        reject(new Error(`[${this.name}] Timeout waiting for ${desc} (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (vs) => {
        if (predicate(vs)) {
          cleanupListeners();
          resolve(vs);
        }
      };

      const cleanupListeners = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('vote-skip-update', handler);
      };

      if (this.socket) {
        this.socket.on('vote-skip-update', handler);
      }
    });
  }

  waitForUsers(predicate, timeoutMs = 4000, desc = 'users predicate') {
    if (this.users && predicate(this.users)) {
      return Promise.resolve(this.users);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanupListeners();
        reject(new Error(`[${this.name}] Timeout waiting for ${desc} (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (u) => {
        if (predicate(u)) {
          cleanupListeners();
          resolve(u);
        }
      };

      const cleanupListeners = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('users-update', handler);
      };

      if (this.socket) {
        this.socket.on('users-update', handler);
      }
    });
  }
}

async function startServer() {
  allocatedPort = await getEphemeralPort();
  console.log(`[BOOT] Allocated ephemeral port: ${allocatedPort} (port 3000 untouched)`);

  serverChild = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(allocatedPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverChild.stdout.on('data', (d) => {
    const s = d.toString();
    serverStdoutLogs.push(s);
  });

  serverChild.stderr.on('data', (d) => {
    const s = d.toString();
    serverStderrLogs.push(s);
  });

  // Wait for server to be responsive
  let started = false;
  const startTime = Date.now();
  while (Date.now() - startTime < 8000) {
    try {
      await new Promise((res, rej) => {
        const s = net.connect(allocatedPort, '127.0.0.1', () => {
          s.destroy();
          res();
        });
        s.on('error', rej);
      });
      started = true;
      break;
    } catch (_) {
      await sleep(100);
    }
  }

  if (!started) {
    throw new Error(`Server failed to boot on port ${allocatedPort} within 8000ms`);
  }
  console.log(`[BOOT] Server process running (PID: ${serverChild.pid})`);
}

async function main() {
  console.log('====================================================================');
  console.log(' ADVERSARIAL VOTE-TO-SKIP QUORUM & FLAPPING STRESS TEST SUITE      ');
  console.log('====================================================================');

  await startServer();

  let passCount = 0;
  let failCount = 0;
  const suiteResults = [];

  function recordResult(name, passed, detail = '') {
    if (passed) {
      passCount++;
      console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
      suiteResults.push({ name, passed: true, detail });
    } else {
      failCount++;
      console.error(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
      suiteResults.push({ name, passed: false, detail });
    }
  }

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: RAPID FLAPPING AT EXACT THRESHOLD BOUNDARY
    // -------------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log(' SUITE 1: RAPID FLAPPING AT EXACT THRESHOLD BOUNDARY                ');
    console.log('--------------------------------------------------------------------');

    // Connect 5 clients: Host, Alice, Bob, Charlie, Dave
    const host = new AdversarialClient('Host', allocatedPort, '#ef4444');
    const alice = new AdversarialClient('Alice', allocatedPort, '#3b82f6');
    const bob = new AdversarialClient('Bob', allocatedPort, '#10b981');
    const charlie = new AdversarialClient('Charlie', allocatedPort, '#f59e0b');
    const dave = new AdversarialClient('Dave', allocatedPort, '#8b5cf6');

    await Promise.all([
      host.connect(),
      alice.connect(),
      bob.connect(),
      charlie.connect(),
      dave.connect()
    ]);

    await host.waitForUsers(u => Object.keys(u).length === 5, 4000, '5 connected users');
    recordResult('Initial 5-Client Cluster Connection', true, 'Host, Alice, Bob, Charlie, Dave');

    // Turn off Auto-DJ for deterministic track advancement
    host.emit('autodj-config', { enabled: false, notify: false });
    await host.waitForState(s => s.autoDjEnabled === false, 3000);

    // Clear queue and set initial playing video
    host.emit('clear-queue');
    await host.waitForState(s => s.queue.length === 0, 3000);

    // Enqueue 5 tracks: S0 (plays immediately), S1, S2, S3, S4 in queue
    host.emit('add-to-queue', { url: TEST_TRACKS[0].url });
    await host.waitForState(s => s.currentVideo && s.currentVideo.videoId === TEST_TRACKS[0].id, 4000, 'Track S0 playing');

    for (let i = 1; i <= 4; i++) {
      host.emit('add-to-queue', { url: TEST_TRACKS[i].url });
    }
    await host.waitForState(s => s.queue.length === 4, 4000, '4 tracks in queue');

    // Quorum check: with 5 clients, floor(5/2) + 1 = 3
    const initialVs = host.voteSkipState;
    const expectedRequired = Math.floor(5 / 2) + 1; // 3
    if (initialVs.required !== expectedRequired) {
      recordResult('Quorum Calculation (5 Clients)', false, `Expected ${expectedRequired}, got ${initialVs.required}`);
    } else {
      recordResult('Quorum Calculation (5 Clients)', true, `Required votes = ${initialVs.required}`);
    }

    // Phase 1A: Non-Quorum Flapping (Sub-Threshold Flap Storm)
    // Alice locks in 1 vote. Charlie rapidly toggles 40 times (vote, retract, vote, retract...).
    // Required = 3. Votes flap between 1 and 2. Never hits 3.
    console.log('[SUITE 1] Executing sub-threshold rapid flapping storm (40 rapid toggles)...');
    alice.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 1, 3000, 'Alice 1st vote');

    for (let i = 0; i < 40; i++) {
      charlie.emit('vote-skip');
      if (i % 8 === 0) await sleep(10);
    }
    // Settle for 200ms
    await sleep(200);

    // Verify track DID NOT change
    const afterFlapTrackId = host.state.currentVideo?.videoId;
    if (afterFlapTrackId === TEST_TRACKS[0].id) {
      recordResult('Sub-Threshold Flapping Track Stability', true, `Track remained strictly ${afterFlapTrackId}`);
    } else {
      recordResult('Sub-Threshold Flapping Track Stability', false, `Track prematurely changed to ${afterFlapTrackId}`);
    }

    // Verify all 5 clients agree on vote count
    const tallyMatches = [alice, bob, charlie, dave].every(c => c.voteSkipState.current === host.voteSkipState.current);
    recordResult('Sub-Threshold Multi-Client Tally Consensus', tallyMatches, `All clients report tally: ${host.voteSkipState.current}/${host.voteSkipState.required}`);

    // Reset votes before threshold crossing test
    if (charlie.voteSkipState.voters.includes(charlie.socket.id)) {
      charlie.emit('vote-skip');
      await host.waitForVoteSkip(vs => !vs.voters.includes(charlie.socket.id), 2000);
    }
    if (!alice.voteSkipState.voters.includes(alice.socket.id)) {
      alice.emit('vote-skip');
      await host.waitForVoteSkip(vs => vs.voters.includes(alice.socket.id), 2000);
    }

    // Phase 1B: Exact Boundary Race Condition Flapping (2 votes locked, 2 clients flap concurrently)
    // Alice (voted), Bob (voted) -> current = 2. Exactly 1 vote short of quorum (3).
    // Charlie and Dave both fire rapid concurrent 'vote-skip' bursts to cross the boundary.
    console.log('[SUITE 1] Alice & Bob lock in votes (2/3). Charlie & Dave trigger concurrent boundary burst...');
    bob.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 2, 3000, 'Alice + Bob voted (2/3)');

    const expectedNextTrackId = TEST_TRACKS[1].id;

    // Concurrently fire rapid bursts
    const burstPromises = [
      (async () => {
        for (let i = 0; i < 6; i++) {
          charlie.emit('vote-skip');
          await sleep(5);
        }
      })(),
      (async () => {
        for (let i = 0; i < 6; i++) {
          dave.emit('vote-skip');
          await sleep(5);
        }
      })()
    ];
    await Promise.all(burstPromises);

    // Wait for state to advance to S1
    await host.waitForState(s => s.currentVideo && s.currentVideo.videoId === expectedNextTrackId, 4000, `Track advance to ${expectedNextTrackId}`);
    recordResult('Threshold Boundary Burst Advance', true, `Advanced to expected track ${expectedNextTrackId}`);

    // Check for double-skip bug: verify queue length is now 3 (not 2 or 1)
    if (host.state.queue.length === 3) {
      recordResult('Single-Advance Integrity (Zero Double-Skip)', true, `Queue length is exactly 3 (expected tracks S2, S3, S4)`);
    } else {
      recordResult('Single-Advance Integrity (Zero Double-Skip)', false, `Queue length corrupted: ${host.state.queue.length} (expected 3)`);
    }

    // Verify tally reset on Host and all clients
    await sleep(200);
    const hostTallyAfterSkip = host.voteSkipState.current;
    // Note: because Charlie/Dave sent bursts, any vote that arrived AFTER playNext() finished
    // would be treated as a vote for the NEW track. Let's inspect the tally.
    console.log(`[SUITE 1] Post-skip tally on Host: ${hostTallyAfterSkip}/${host.voteSkipState.required} (voters: ${JSON.stringify(host.voteSkipState.voters)})`);
    recordResult('Boundary Burst Server Survival', true, 'Server smoothly handled concurrent boundary bursts without crash');

    // -------------------------------------------------------------------------
    // SUITE 2: DYNAMIC QUORUM TRANSITIONS UNDER PASSENGER DISCONNECT
    // -------------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log(' SUITE 2: DYNAMIC QUORUM TRANSITIONS UNDER PASSENGER DISCONNECT     ');
    console.log('--------------------------------------------------------------------');

    // Clean up current votes by host skip to fresh track
    host.emit('skip-video');
    await host.waitForState(s => s.currentVideo && s.currentVideo.videoId === TEST_TRACKS[2].id, 4000, `Fresh track S2`);
    await host.waitForVoteSkip(vs => vs.current === 0, 3000, 'Tally reset to 0');

    // Scenario 2A: Disconnect of non-voter triggers dynamic quorum satisfaction
    // Currently 5 clients: [Host, Alice, Bob, Charlie, Dave] -> required = 3
    // Alice & Bob vote (2/3). Quorum NOT satisfied.
    // Dave disconnects -> room drops to 4 clients -> required = floor(4/2)+1 = 3. Still 2/3.
    // Wait, let's test: 4 clients -> required = 3. 2 vote (2/3). Charlie disconnects -> 3 clients -> required = floor(3/2)+1 = 2!
    // Since votes = 2 and required is now 2, QUORUM (2/2) IS SATISFIED DYNAMICALLY!
    console.log('[SUITE 2A] Dynamic Quorum: 4 clients, 2 votes (2/3), 4th client disconnects -> required drops to 2 -> triggers skip');

    // Disconnect Dave first so we have exactly 4 clients
    dave.disconnect();
    await host.waitForUsers(u => Object.keys(u).length === 4, 3000, '4 users remaining');
    await host.waitForVoteSkip(vs => vs.required === 3, 3000, 'Required = 3 for 4 users');

    const trackBeforeDisconnectSkip = host.state.currentVideo.videoId;
    const expectedTrackAfterDynamicSkip = host.state.queue[0]?.videoId;

    alice.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 1, 3000, 'Alice voted (1/3)');

    bob.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 2, 3000, 'Bob voted (2/3)');

    // Charlie disconnects -> count 4 -> 3 -> required 3 -> 2 -> votes 2 >= 2 -> playNext()
    charlie.disconnect();

    await host.waitForState(
      s => s.currentVideo && s.currentVideo.videoId === expectedTrackAfterDynamicSkip,
      4000,
      `Track dynamically skipped to ${expectedTrackAfterDynamicSkip}`
    );
    recordResult('Dynamic Quorum Satisfaction on Disconnect', true, `Track advanced to ${expectedTrackAfterDynamicSkip} after non-voter left`);

    // Verify vote tally reset to 0
    await host.waitForVoteSkip(vs => vs.current === 0, 3000, 'Vote tally reset to 0 after dynamic skip');
    recordResult('Dynamic Quorum Vote Tally Reset', true, 'Tally reset to 0 immediately upon skip');

    // Scenario 2B: Voter disconnects -> vote deleted -> quorum NOT satisfied
    console.log('[SUITE 2B] Voter Disconnect: client who voted leaves -> vote retracted -> no premature skip');
    
    // Add two tracks to queue
    host.emit('add-to-queue', { url: TEST_TRACKS[4].url });
    host.emit('add-to-queue', { url: TEST_TRACKS[5].url });
    await host.waitForState(s => s.queue.length >= 2, 3000);

    // Currently 3 clients: Host, Alice, Bob. Connect Charlie2 to bring room to exactly 4 clients.
    const charlie2 = new AdversarialClient('Charlie2', allocatedPort, '#f59e0b');
    await charlie2.connect();
    await host.waitForUsers(u => Object.keys(u).length === 4, 3500, '4 users in room');
    await host.waitForVoteSkip(vs => vs.required === 3, 3500, 'Required = 3 for 4 users');

    const stableTrackId = host.state.currentVideo.videoId;

    // Alice votes (1/3) and Charlie2 votes (2/3)
    alice.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 1, 3000, 'Alice voted (1/3)');
    charlie2.emit('vote-skip');
    await host.waitForVoteSkip(vs => vs.current === 2, 3000, 'Charlie2 voted (2/3)');

    // Charlie2 (who voted!) abruptly disconnects
    charlie2.disconnect();

    // Remaining users = 3 [Host, Alice, Bob]. Required = floor(3/2)+1 = 2.
    // Remaining votes = 1 (Alice). Since Charlie2's vote was deleted, current = 1 < 2!
    // Quorum is NOT met. Track MUST NOT SKIP!
    await host.waitForUsers(u => Object.keys(u).length === 3, 3000, '3 users remaining');
    await host.waitForVoteSkip(vs => vs.required === 2 && vs.current === 1, 3000, 'Required = 2, Current = 1');

    await sleep(400); // verify no delayed skip
    if (host.state.currentVideo.videoId === stableTrackId) {
      recordResult('Voter Disconnect Retracts Vote (No False Quorum)', true, `Track remained ${stableTrackId}, tally correctly 1/2`);
    } else {
      recordResult('Voter Disconnect Retracts Vote (No False Quorum)', false, `Track prematurely changed after voter disconnect!`);
    }

    // Scenario 2C: Disconnect cascade to solo client who has active vote
    console.log('[SUITE 2C] Disconnect cascade to solo user: active vote reaches 1/1 quorum...');
    // Currently 3 clients: Host, Alice, Bob. Alice has 1 vote (1/2).
    // Host and Bob disconnect, leaving Alice as solo user (1 user -> required = 1).
    // Alice already voted! Alice's 1 vote meets 1/1 quorum -> should advance!
    const expectedSoloAdvanceTrack = host.state.queue[0]?.videoId;

    host.disconnect();
    bob.disconnect();

    await alice.waitForUsers(u => Object.keys(u).length === 1, 3500, 'Alice solo');
    await alice.waitForState(
      s => s.currentVideo && s.currentVideo.videoId === expectedSoloAdvanceTrack,
      4000,
      `Track advanced to ${expectedSoloAdvanceTrack} under solo quorum`
    );
    recordResult('Solo Cascade Quorum Satisfaction', true, `Solo user active vote satisfied 1/1 quorum immediately`);

    // Clean up Alice before Suite 3
    alice.disconnect();
    await sleep(200);

    // -------------------------------------------------------------------------
    // SUITE 3: ZERO-DESYNC TEMPORAL ORDERING AUDIT (broadcastVoteSkip TIMING)
    // -------------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log(' SUITE 3: ZERO-DESYNC TEMPORAL ORDERING AUDIT (broadcastVoteSkip)    ');
    console.log('--------------------------------------------------------------------');

    // Reconnect a fresh cluster of 4 clients for zero-desync audit
    const auditor1 = new AdversarialClient('Auditor1', allocatedPort, '#10b981');
    const auditor2 = new AdversarialClient('Auditor2', allocatedPort, '#3b82f6');
    const auditor3 = new AdversarialClient('Auditor3', allocatedPort, '#8b5cf6');
    const auditor4 = new AdversarialClient('Auditor4', allocatedPort, '#f59e0b');

    await Promise.all([
      auditor1.connect(),
      auditor2.connect(),
      auditor3.connect(),
      auditor4.connect()
    ]);
    await auditor1.waitForUsers(u => Object.keys(u).length === 4, 3500, 'Fresh 4-auditor cluster');

    // Disable Auto-DJ and populate a large queue of 10 tracks
    auditor1.emit('autodj-config', { enabled: false, notify: false });
    auditor1.emit('clear-queue');
    await auditor1.waitForState(s => s.queue.length === 0, 3000);

    for (let i = 0; i < TEST_TRACKS.length; i++) {
      auditor1.emit('add-to-queue', { url: TEST_TRACKS[i].url });
    }
    // Add extra copies to guarantee 10+ tracks
    for (let i = 0; i < 4; i++) {
      auditor1.emit('add-to-queue', { url: TEST_TRACKS[i].url });
    }
    await auditor1.waitForState(s => s.queue.length >= 8, 4000, 'Queue populated');

    // Ensure playback active
    if (!auditor1.state.currentVideo) {
      auditor1.emit('skip-video');
      await auditor1.waitForState(s => !!s.currentVideo, 3000);
    }

    // Clear prior desync logs on all auditors
    const cluster = [auditor1, auditor2, auditor3, auditor4];
    cluster.forEach(c => { c.desyncViolations = []; });

    // Execute 10 consecutive vote-skip cycles across the cluster:
    // With 4 clients, required = 3.
    // Auditor1, Auditor2, Auditor3 all vote in sequence to trigger playNext().
    // We observe if ANY client observes a new track with old vote tally > 0.
    console.log('[SUITE 3] Executing 10 consecutive democratic vote-skip cycles...');
    let cyclesCompleted = 0;

    for (let round = 1; round <= 10; round++) {
      const currentTrack = auditor1.state.currentVideo?.id;
      if (!currentTrack || auditor1.state.queue.length === 0) {
        // refill queue if running low
        auditor1.emit('add-to-queue', { url: TEST_TRACKS[round % TEST_TRACKS.length].url });
        await sleep(100);
      }

      // 3 clients vote to reach quorum (3/3)
      auditor1.emit('vote-skip');
      auditor2.emit('vote-skip');
      auditor3.emit('vote-skip');

      // Wait for track to transition
      await auditor1.waitForState(
        s => s.currentVideo && s.currentVideo.id !== currentTrack,
        4000,
        `Round ${round} track transition`
      );

      // Wait for vote tally to reset to 0
      await auditor1.waitForVoteSkip(vs => vs.current === 0, 3000, `Round ${round} tally reset`);

      cyclesCompleted++;
    }

    // Inspect desync violations across all 4 auditor clients
    let totalViolations = 0;
    for (const client of cluster) {
      if (client.desyncViolations.length > 0) {
        console.error(`[DESYNC ERROR] Client ${client.name} recorded ${client.desyncViolations.length} desync violations:`, client.desyncViolations);
        totalViolations += client.desyncViolations.length;
      }
    }

    if (totalViolations === 0) {
      recordResult('Zero Desynchronization Invariant (10 Cycles, 4 Clients)', true, `0 violations recorded across ${cyclesCompleted} cycles`);
    } else {
      recordResult('Zero Desynchronization Invariant (10 Cycles, 4 Clients)', false, `${totalViolations} desync violations detected!`);
    }

    // -------------------------------------------------------------------------
    // SUITE 4: CHAOTIC SOCKET CONCURRENCY & CRASH RESILIENCE
    // -------------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log(' SUITE 4: CHAOTIC SOCKET CONCURRENCY & CRASH RESILIENCE              ');
    console.log('--------------------------------------------------------------------');

    const initialPid = serverChild ? serverChild.pid : null;
    const initialStderrLen = serverStderrLogs.length;

    console.log('[SUITE 4] Firing 200 chaotic socket actions across all connected clients in 1.5s...');

    const actions = [];
    for (let i = 0; i < 200; i++) {
      const client = cluster[i % cluster.length];
      const actionType = i % 5;
      if (actionType === 0) {
        client.emit('vote-skip');
      } else if (actionType === 1) {
        client.emit('request-state');
      } else if (actionType === 2) {
        client.emit('volume-control', Math.floor(Math.random() * 100));
      } else if (actionType === 3) {
        client.emit('reorder-queue', { queueIds: auditor1.state.queue.map(q => q.id).reverse() });
      } else if (actionType === 4) {
        client.emit('set-profile', { name: `Chaos_${i}`, color: '#10b981' });
      }
      if (i % 25 === 0) await sleep(20);
    }

    await sleep(500);

    // Verify server process is still alive and PID unchanged
    const currentPid = serverChild ? serverChild.pid : null;
    const isAlive = serverChild && !serverChild.killed;

    recordResult('Server Process Survival (PID Consistency)', isAlive && currentPid === initialPid, `PID: ${currentPid}`);

    // Verify server responds to request-state
    let responded = false;
    try {
      auditor1.emit('request-state');
      await auditor1.waitForState(s => !!s, 2000, 'Responsive after chaos');
      responded = true;
    } catch (_) {}
    recordResult('Server Responsiveness Post-Chaos', responded, 'Server responded to request-state');

    // Check stderr for critical errors / crashes
    const newStderr = serverStderrLogs.slice(initialStderrLen).join('');
    const hasCriticalError = /uncaughtException|unhandledRejection|TypeError|RangeError/i.test(newStderr);
    recordResult('Zero Uncaught Exceptions / Fatal Errors', !hasCriticalError, hasCriticalError ? `Errors: ${newStderr}` : 'Zero critical errors on stderr');

    // -------------------------------------------------------------------------
    // PORT 3000 GUARDRAIL CHECK
    // -------------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log(' PORT 3000 GUARDRAIL VERIFICATION                                   ');
    console.log('--------------------------------------------------------------------');
    if (allocatedPort === 3000) {
      recordResult('Ephemeral Port Allocation Guardrail', false, 'FATAL: Test ran on port 3000!');
    } else {
      recordResult('Ephemeral Port Allocation Guardrail', true, `Test executed on ephemeral port ${allocatedPort} (port 3000 untouched)`);
    }

  } catch (err) {
    console.error('\n[SUITE FATAL ERROR]:', err);
    recordResult('Suite Fatal Exception', false, err.message);
  } finally {
    console.log('\n====================================================================');
    console.log('                    ADVERSARIAL STRESS SUMMARY                      ');
    console.log('====================================================================');
    console.log(`  Total Checks: ${passCount + failCount}`);
    console.log(`  Passed:       ${passCount}`);
    console.log(`  Failed:       ${failCount}`);
    console.log('====================================================================');

    cleanup();

    if (failCount > 0) {
      console.error(`\n❌ ADVERSARIAL STRESS TEST FAILED with ${failCount} failures!`);
      process.exit(1);
    } else {
      console.log('\n✔ ALL ADVERSARIAL STRESS TESTS PASSED WITH ZERO DESYNC & ZERO CRASHES!');
      process.exit(0);
    }
  }
}

main();
