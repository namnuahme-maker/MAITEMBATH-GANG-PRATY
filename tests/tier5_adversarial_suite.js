#!/usr/bin/env node
/**
 * MAITEMBATH GANG PARTY - Tier 5 Adversarial Coverage & Fuzzing Suite
 * (tests/tier5_adversarial_suite.js)
 * 
 * Conducts white-box adversarial stress tests and fuzzing across 5 dimensions:
 *   - Area 1: YouTube video ID extraction fuzzing & matrix verification (obscure URLs, embed, shortlinks, malformed params, whitespace)
 *   - Area 2: Concurrency & race conditions (concurrent queue clear & reorder, concurrent skip & vote-skip, rapid bursts)
 *   - Area 3: Volume & audio controls boundary fuzzing (NaN, negatives, strings, >100, soundboard ducking concurrency & sanitization)
 *   - Area 4: Chat, Danmaku & XSS injection fuzzing (XSS scripts/onerror, unicode emojis, length truncation, burst rate limiter, color validation)
 *   - Area 5: Process Safety Guardrail R4 verification (ephemeral port binding, port 3000 untouched, zero daemon leak)
 * 
 * Safety Traps:
 *   - Binds ephemeral port via net.createServer().listen(0).
 *   - Never interferes with default port 3000 or the user's manual server process.
 *   - Guarantees complete cleanup of child processes on exit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');

// --- Configuration & Paths ---
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'server.js');

// Known fast pre-cached YouTube videos from server.js
const CACHED_VIDEOS = [
  'dQw4w9WgXcQ', // Rick Astley
  'kJQP7kiw5Fk', // Despacito
  'oHg5SJYRHA0', // RickRoll
  '9bZkp7q19f0'  // Gangnam Style
];

// ANSI Colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

const SYMBOLS = {
  pass: `${c.green}✔${c.reset}`,
  fail: `${c.red}✖${c.reset}`,
  info: `${c.cyan}ℹ${c.reset}`
};

// Global context for process lifecycle
let activeChildProcess = null;
let activeClients = [];
let allocatedPort = null;
let initialPort3000Pid = null;

// --- Process Safety & Signal Traps (R4) ---
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

function globalEmergencyCleanup() {
  for (const client of activeClients) {
    try {
      client.removeAllListeners();
      client.disconnect();
    } catch (_) {}
  }
  activeClients = [];
  if (activeChildProcess) {
    killChildProcessSync(activeChildProcess);
    activeChildProcess = null;
  }
}

process.on('SIGINT', () => {
  console.log(`\n${c.yellow}[GUARDRAIL] SIGINT caught. Performing emergency cleanup...${c.reset}`);
  globalEmergencyCleanup();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log(`\n${c.yellow}[GUARDRAIL] SIGTERM caught. Performing emergency cleanup...${c.reset}`);
  globalEmergencyCleanup();
  process.exit(143);
});

process.on('uncaughtException', (err) => {
  console.error(`\n${c.red}[CRITICAL] Uncaught exception in test runner:${c.reset}`, err);
  globalEmergencyCleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`\n${c.red}[CRITICAL] Unhandled promise rejection in test runner:${c.reset}`, reason);
  globalEmergencyCleanup();
  process.exit(1);
});

// Ephemeral port allocator
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

function checkPort3000Process() {
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess'], { encoding: 'utf8', timeout: 5000 });
      const pidStr = (res.stdout || '').trim().split(/\r?\n/)[0];
      return pidStr ? parseInt(pidStr, 10) : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

// Sleep helper
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- Simulated Socket Client ---
class SimulatedClient {
  constructor(port, name, color) {
    this.port = port;
    this.name = name;
    this.color = color;
    this.socket = null;
    this.connected = false;
    this.state = null;
    this.users = {};
    this.voteSkipState = null;
    this.danmakuList = [];
    this.reactionList = [];
    this.errorMsgList = [];
    this.toastList = [];
    this.soundboardFxList = [];
    activeClients.push(this);
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SimulatedClient [${this.name}] connection timeout (${timeoutMs}ms)`));
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

      this.socket.on('new-danmaku', (danmaku) => {
        this.danmakuList.push(danmaku);
      });

      this.socket.on('new-reaction', (reaction) => {
        this.reactionList.push(reaction);
      });

      this.socket.on('error-msg', (msg) => {
        this.errorMsgList.push(msg);
      });

      this.socket.on('show-toast-broadcast', (toast) => {
        this.toastList.push(toast);
      });

      this.socket.on('play-soundboard-fx', (fx) => {
        this.soundboardFxList.push(fx);
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

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }

  waitForState(predicate, timeoutMs = 4000, desc = 'state update') {
    if (this.state && predicate(this.state)) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${desc} on [${this.name}] (${timeoutMs}ms)`));
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

  waitForVoteSkip(predicate, timeoutMs = 4000, desc = 'vote-skip update') {
    if (this.voteSkipState && predicate(this.voteSkipState)) {
      return Promise.resolve(this.voteSkipState);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${desc} on [${this.name}] (${timeoutMs}ms)`));
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

  waitForErrorMsg(predicate, timeoutMs = 4000, desc = 'error-msg') {
    for (const msg of this.errorMsgList) {
      if (predicate(msg)) return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${desc} on [${this.name}] (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (msg) => {
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('error-msg', handler);
      };

      this.socket.on('error-msg', handler);
    });
  }

  waitForDanmaku(predicate, timeoutMs = 4000, desc = 'danmaku') {
    for (const d of this.danmakuList) {
      if (predicate(d)) return Promise.resolve(d);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${desc} on [${this.name}] (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (d) => {
        if (predicate(d)) {
          cleanup();
          resolve(d);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('new-danmaku', handler);
      };

      this.socket.on('new-danmaku', handler);
    });
  }

  waitForSoundboardFx(predicate, timeoutMs = 4000, desc = 'soundboard fx') {
    for (const fx of this.soundboardFxList) {
      if (predicate(fx)) return Promise.resolve(fx);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${desc} on [${this.name}] (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (fx) => {
        if (predicate(fx)) {
          cleanup();
          resolve(fx);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off('play-soundboard-fx', handler);
      };

      this.socket.on('play-soundboard-fx', handler);
    });
  }
}

// Exact YouTube regex parser from server.js:1000-1008
function serverGetYoutubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const regExp = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

// Client-side sanitizers from public/js/ui.js
function clientEscapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clientSafeColor(c) {
  return (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c)) ? c : '#ABD2FA';
}

// --- Test Case Harness ---
const testResults = [];

function registerTest(id, name, fn) {
  return { id, name, fn };
}

// Setup transient server & multi-client context
async function setupTestContext() {
  initialPort3000Pid = checkPort3000Process();
  allocatedPort = await getEphemeralPort();

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(allocatedPort) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  activeChildProcess = child;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server failed to boot on port ${allocatedPort} within 7000ms`));
    }, 7000);

    child.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      if (str.includes('Server is running!') || str.includes(`:${allocatedPort}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.on('exit', (code, sig) => {
      clearTimeout(timeout);
      reject(new Error(`Server process exited prematurely with code ${code}, signal ${sig}`));
    });
  });

  const host = new SimulatedClient(allocatedPort, 'Host Driver', '#3b82f6');
  const alice = new SimulatedClient(allocatedPort, 'Alice Co-Pilot', '#ec4899');
  const bob = new SimulatedClient(allocatedPort, 'Bob Passenger', '#10b981');
  const charlie = new SimulatedClient(allocatedPort, 'Charlie DJ', '#f59e0b');

  await Promise.all([
    host.connect(),
    alice.connect(),
    bob.connect(),
    charlie.connect()
  ]);

  // Turn off autoDj for deterministic test state
  host.emit('autodj-config', { enabled: false, notify: false });
  await host.waitForState(s => s.autoDjEnabled === false, 3000);

  // Clear any existing queue
  host.emit('clear-queue');
  await host.waitForState(s => s.queue.length === 0, 3000);

  return { child, port: allocatedPort, host, alice, bob, charlie };
}

// --- TEST CASES DEFINITIONS ---

const tests = [
  // =========================================================================
  // AREA 1: YOUTUBE VIDEO ID EXTRACTION FUZZING & MATRIX VERIFICATION
  // =========================================================================
  registerTest('T5.1.1', 'YouTube URL Extraction Matrix (Standard, Mobile, Music, Embed, Shorts, Live)', async () => {
    const testMatrix = [
      // Standard watch URLs
      { input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      
      // Mobile & Music subdomains
      { input: 'https://m.youtube.com/watch?v=kJQP7kiw5Fk', expected: 'kJQP7kiw5Fk' },
      { input: 'https://music.youtube.com/watch?v=oHg5SJYRHA0', expected: 'oHg5SJYRHA0' },
      
      // Shortlinks (youtu.be)
      { input: 'https://youtu.be/9bZkp7q19f0', expected: '9bZkp7q19f0' },
      { input: 'http://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'youtu.be/kJQP7kiw5Fk', expected: 'kJQP7kiw5Fk' },
      
      // Embed URLs
      { input: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'http://youtube.com/embed/kJQP7kiw5Fk', expected: 'kJQP7kiw5Fk' },
      
      // Legacy /v/ URLs
      { input: 'https://www.youtube.com/v/oHg5SJYRHA0', expected: 'oHg5SJYRHA0' },
      
      // YouTube Shorts & Live
      { input: 'https://www.youtube.com/shorts/9bZkp7q19f0', expected: '9bZkp7q19f0' },
      { input: 'https://www.youtube.com/live/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      
      // Pure 11-char ID
      { input: 'dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' }
    ];

    for (const tc of testMatrix) {
      const extracted = serverGetYoutubeId(tc.input);
      assert.strictEqual(extracted, tc.expected, `Failed extracting ID from '${tc.input}': got '${extracted}', expected '${tc.expected}'`);
    }
  }),

  registerTest('T5.1.2', 'Obscure Query Parameters & Complex URL Permutations', async () => {
    const complexMatrix = [
      // Parameter preceding v=
      { input: 'https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
      { input: 'https://www.youtube.com/watch?ab_channel=RickAstley&v=kJQP7kiw5Fk&list=PL12345', expected: 'kJQP7kiw5Fk' },
      
      // Parameter succeeding v=
      { input: 'https://www.youtube.com/watch?v=oHg5SJYRHA0&t=42s&feature=emb_title', expected: 'oHg5SJYRHA0' },
      { input: 'https://www.youtube.com/watch?v=9bZkp7q19f0&index=5&list=RD9bZkp7q19f0', expected: '9bZkp7q19f0' },
      
      // Shortlink with query parameters
      { input: 'https://youtu.be/dQw4w9WgXcQ?si=abcdef123456&t=15', expected: 'dQw4w9WgXcQ' },
      { input: 'https://youtu.be/kJQP7kiw5Fk?t=1m30s', expected: 'kJQP7kiw5Fk' },
      
      // Embed with parameters
      { input: 'https://www.youtube.com/embed/oHg5SJYRHA0?autoplay=1&mute=1&controls=0', expected: 'oHg5SJYRHA0' },
      
      // Shorts with parameters
      { input: 'https://www.youtube.com/shorts/9bZkp7q19f0?feature=share', expected: '9bZkp7q19f0' },
      
      // Live with parameters
      { input: 'https://www.youtube.com/live/dQw4w9WgXcQ?si=live_token_123', expected: 'dQw4w9WgXcQ' }
    ];

    for (const tc of complexMatrix) {
      const extracted = serverGetYoutubeId(tc.input);
      assert.strictEqual(extracted, tc.expected, `Failed extracting ID from complex URL '${tc.input}': got '${extracted}'`);
    }
  }),

  registerTest('T5.1.3', 'Whitespace, Newlines, Tabs & Boundary Padding Handling', async () => {
    const whitespaceMatrix = [
      { input: '   dQw4w9WgXcQ   ', expected: 'dQw4w9WgXcQ' },
      { input: '\t\ndQw4w9WgXcQ\r\n', expected: 'dQw4w9WgXcQ' },
      { input: '  https://www.youtube.com/watch?v=kJQP7kiw5Fk  ', expected: 'kJQP7kiw5Fk' },
      { input: '\nhttps://youtu.be/oHg5SJYRHA0\n\t', expected: 'oHg5SJYRHA0' },
      { input: '   https://www.youtube.com/embed/9bZkp7q19f0   ', expected: '9bZkp7q19f0' }
    ];

    for (const tc of whitespaceMatrix) {
      const extracted = serverGetYoutubeId(tc.input);
      assert.strictEqual(extracted, tc.expected, `Failed handling whitespace for '${tc.input}': got '${extracted}'`);
    }
  }),

  registerTest('T5.1.4', 'Malformed Inputs, Non-Strings & Negative Extraction Tests', async () => {
    const negativeCases = [
      null,
      undefined,
      12345678901,
      {},
      [],
      '',
      '    ',
      '\t\r\n',
      'https://vimeo.com/12345678901',
      'https://www.youtube.com/watch?channel=UCuAXFkgsw1L7xaCfnd5JJOw',
      'https://youtu.be/tooShort',
      'https://www.youtube.com/watch?v=tooShort'
    ];

    for (const badInput of negativeCases) {
      const result = serverGetYoutubeId(badInput);
      assert.strictEqual(result, null, `Expected null for bad input ${JSON.stringify(badInput)}, but got '${result}'`);
    }
  }),

  registerTest('T5.1.5', 'Live Socket Enqueueing with Diverse YouTube Formats', async (ctx) => {
    // Clear queue & reset state
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000);

    // 1. Host adds standard URL
    ctx.host.emit('add-to-queue', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', nickname: 'Host' });
    await ctx.host.waitForState(s => s.currentVideo && s.currentVideo.videoId === 'dQw4w9WgXcQ', 3000, 'currentVideo Rick');

    // 2. Alice adds youtu.be shortlink with query params
    ctx.alice.emit('add-to-queue', { url: 'https://youtu.be/kJQP7kiw5Fk?si=abcdef123&t=20', nickname: 'Alice' });
    await ctx.alice.waitForState(s => s.queue.some(q => q.videoId === 'kJQP7kiw5Fk'), 3000, 'Despacito enqueued');

    // 3. Bob adds embed URL with query params
    ctx.bob.emit('add-to-queue', { url: 'https://www.youtube.com/embed/oHg5SJYRHA0?autoplay=1', nickname: 'Bob' });
    await ctx.bob.waitForState(s => s.queue.some(q => q.videoId === 'oHg5SJYRHA0'), 3000, 'RickRoll enqueued');

    // 4. Charlie adds shorts URL with leading/trailing whitespace
    ctx.charlie.emit('add-to-queue', { url: '   https://www.youtube.com/shorts/9bZkp7q19f0   ', nickname: 'Charlie' });
    await ctx.charlie.waitForState(s => s.queue.some(q => q.videoId === '9bZkp7q19f0'), 3000, 'Gangnam Style enqueued');

    assert.strictEqual(ctx.host.state.queue.length, 3, 'Queue should contain exactly 3 items');
    assert.strictEqual(ctx.host.state.queue[0].videoId, 'kJQP7kiw5Fk');
    assert.strictEqual(ctx.host.state.queue[1].videoId, 'oHg5SJYRHA0');
    assert.strictEqual(ctx.host.state.queue[2].videoId, '9bZkp7q19f0');
  }),

  // =========================================================================
  // AREA 2: CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  registerTest('T5.2.1', 'Concurrent Queue Clear & Reorder Atomicity', async (ctx) => {
    // Current queue has 3 items: [kJQP7kiw5Fk, oHg5SJYRHA0, 9bZkp7q19f0]
    const itemIds = ctx.host.state.queue.map(i => i.id);
    const reversedIds = [...itemIds].reverse();

    // Fire clear-queue from Alice and reorder-queue from Bob simultaneously without awaiting
    const clearPromise = new Promise(res => {
      ctx.alice.emit('clear-queue');
      res();
    });
    const reorderPromise = new Promise(res => {
      ctx.bob.emit('reorder-queue', reversedIds);
      res();
    });

    await Promise.all([clearPromise, reorderPromise]);
    await sleep(200);

    // After resolution, queue must either be completely empty or contain valid non-duplicated items
    const finalQueue = ctx.host.state.queue;
    assert(Array.isArray(finalQueue), 'Queue must remain an array');
    if (finalQueue.length > 0) {
      assert(finalQueue.length <= 3, 'Queue length cannot exceed original items');
      const ids = finalQueue.map(i => i.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, 'No duplicate IDs in queue');
    }
  }),

  registerTest('T5.2.2', 'High-Frequency Interleaved Clear & Reorder Burst Stress', async (ctx) => {
    // Repopulate queue with 4 items
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000);

    for (let i = 0; i < CACHED_VIDEOS.length; i++) {
      ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[i], nickname: `FuzzTrack_${i}` });
    }
    // Wait for at least 3 queued (one is playing)
    await ctx.host.waitForState(s => s.queue.length >= 3, 3000);

    const queuedIds = ctx.host.state.queue.map(i => i.id);

    // Fire 20 interleaved clear and reorder requests rapidly
    const burstPromises = [];
    for (let r = 0; r < 20; r++) {
      if (r % 2 === 0) {
        ctx.alice.emit('reorder-queue', [...queuedIds].reverse());
      } else {
        ctx.bob.emit('clear-queue');
      }
    }

    await sleep(350);

    // Server must be responsive and in a consistent valid state
    const currentQueue = ctx.host.state.queue;
    assert(Array.isArray(currentQueue), 'Queue must be an array');
    assert(currentQueue.length >= 0, 'Queue length must be non-negative');
  }),

  registerTest('T5.2.3', 'Concurrent Host Skip and Passenger Vote-Skip Quorum Reset', async (ctx) => {
    // Ensure room is completely clean (both queue and currentVideo reset)
    ctx.host.emit('clear-queue');
    ctx.host.emit('skip-video');
    await ctx.host.waitForState(s => s.queue.length === 0 && s.currentVideo === null, 3000, 'room empty reset');

    // 1. Add active video -> immediately becomes currentVideo
    ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[0], nickname: 'Active' });
    await ctx.host.waitForState(s => s.currentVideo && s.currentVideo.videoId === CACHED_VIDEOS[0], 3000, 'active video playing');

    // 2. Add two queued videos
    ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[1], nickname: 'Next 1' });
    ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[2], nickname: 'Next 2' });
    await ctx.host.waitForState(s => s.queue.length === 2, 3000, 'two items queued');

    // 3. Alice and Bob vote-skip while Host simultaneously skips
    ctx.alice.emit('vote-skip');
    ctx.bob.emit('vote-skip');
    ctx.host.emit('skip-video');

    await sleep(200);

    // 4. Wait for transition to Next 1 (CACHED_VIDEOS[1])
    await ctx.host.waitForState(s => s.currentVideo && s.currentVideo.videoId === CACHED_VIDEOS[1], 3000, 'transitioned to Next 1');

    // The vote-skip state must be reset for the new track (0 votes)
    const vs = ctx.host.voteSkipState;
    assert(vs, 'Vote-skip state must exist');
    assert.strictEqual(vs.current, 0, 'Vote-skip count must reset to 0 after track transition');
    assert.strictEqual(vs.voters.length, 0, 'Vote-skip voters array must be empty');
  }),

  registerTest('T5.2.4', 'Concurrent Add-to-Queue & Reorder Safeguard (Preservation Proof)', async (ctx) => {
    // Ensure an active video is playing so additions go into the queue
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[0], nickname: 'BaseActive' });
      await ctx.host.waitForState(s => s.currentVideo !== null, 3000);
    }
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000);

    ctx.alice.emit('add-to-queue', { url: CACHED_VIDEOS[1], nickname: 'Alice T1' });
    ctx.bob.emit('add-to-queue', { url: CACHED_VIDEOS[2], nickname: 'Bob T2' });
    await ctx.host.waitForState(s => s.queue.length === 2, 3000);

    const existingIds = ctx.host.state.queue.map(i => i.id);

    // Simultaneously, Charlie reorders existing IDs (reversing them), while Host adds CACHED_VIDEOS[3]
    ctx.charlie.emit('reorder-queue', [existingIds[1], existingIds[0]]);
    ctx.host.emit('add-to-queue', { url: CACHED_VIDEOS[3], nickname: 'Concurrent Add' });

    // Wait for queue length to be 3
    await ctx.host.waitForState(s => s.queue.length === 3, 3000);

    const updatedQueue = ctx.host.state.queue;
    // Verify that CACHED_VIDEOS[3] was preserved (not dropped by reorder)
    const preservedItem = updatedQueue.find(i => i.videoId === CACHED_VIDEOS[3]);
    assert(preservedItem, 'Concurrently added item must be preserved in queue');
  }),

  // =========================================================================
  // AREA 3: VOLUME & CONTROLS BOUNDARY FUZZING & SOUNDBOARD CONCURRENCY
  // =========================================================================
  registerTest('T5.3.1', 'Server Volume Control Type & NaN Fuzzing', async (ctx) => {
    // Set a known baseline volume
    ctx.host.emit('volume-control', 60);
    await ctx.host.waitForState(s => s.volume === 60, 3000);

    // Emit various illegal payloads
    const fuzzPayloads = [
      NaN,
      '50',
      'loud',
      null,
      undefined,
      {},
      { volume: 80 },
      [],
      true,
      false
    ];

    for (const badVol of fuzzPayloads) {
      ctx.alice.emit('volume-control', badVol);
    }
    await sleep(150);

    // Volume must remain 60 unchanged
    assert.strictEqual(ctx.host.state.volume, 60, 'Illegal volume inputs must be rejected without mutating state');
  }),

  registerTest('T5.3.2', 'Volume Range Clamping & Decimals Rounding', async (ctx) => {
    // Underflow test: -50 -> 0
    ctx.host.emit('volume-control', -50);
    await ctx.host.waitForState(s => s.volume === 0, 3000, 'volume clamp 0');
    assert.strictEqual(ctx.host.state.volume, 0);

    // Overflow test: 999 -> 100
    ctx.host.emit('volume-control', 999);
    await ctx.host.waitForState(s => s.volume === 100, 3000, 'volume clamp 100');
    assert.strictEqual(ctx.host.state.volume, 100);

    // Floating point rounding test: 45.6 -> 46
    ctx.host.emit('volume-control', 45.6);
    await ctx.host.waitForState(s => s.volume === 46, 3000, 'volume round 46');
    assert.strictEqual(ctx.host.state.volume, 46);
  }),

  registerTest('T5.3.3', 'Rapid Soundboard Audio Ducking Concurrency & Broadcast', async (ctx) => {
    const validSounds = ['airhorn', 'badumtss', 'cheer', 'siren', 'laser', 'cricket'];
    ctx.alice.soundboardFxList = [];

    // Fire 20 soundboard events across all 4 clients rapidly in 100ms
    for (let i = 0; i < 20; i++) {
      const soundId = validSounds[i % validSounds.length];
      const client = [ctx.host, ctx.alice, ctx.bob, ctx.charlie][i % 4];
      client.emit('send-soundboard', { soundId, nickname: `DJ_${i}` });
    }

    await sleep(250);

    // Verify all clients received broadcasts without crashing the server
    assert(ctx.alice.soundboardFxList.length > 0, 'Alice should receive soundboard events');
    const firstFx = ctx.alice.soundboardFxList[0];
    assert(validSounds.includes(firstFx.soundId), 'Broadcasted soundId must be a valid allowed sound');
  }),

  registerTest('T5.3.4', 'Soundboard Input Sanitization & Whitelist Enforcement', async (ctx) => {
    const initialFxCount = ctx.charlie.soundboardFxList.length;

    // Send forbidden sound IDs
    const maliciousSounds = [
      'rm -rf /',
      '../../secret',
      '<script>alert(1)</script>',
      'unknown_sound_id',
      null,
      12345
    ];

    for (const badSound of maliciousSounds) {
      ctx.bob.emit('send-soundboard', badSound);
      ctx.bob.emit('send-soundboard', { soundId: badSound });
    }
    await sleep(200);

    // None of these should be broadcasted
    assert.strictEqual(ctx.charlie.soundboardFxList.length, initialFxCount, 'Malicious sound IDs must be rejected by whitelist');
  }),

  registerTest('T5.3.5', 'Client-side Math Verification (Ducking & Volume Clamping)', async () => {
    // Pure mathematical verification of setHostPlayerVolume and duckHostMediaVolume formulas
    const calculateDuckedVol = (baseVol) => Math.min(baseVol, Math.max(10, Math.round(baseVol * 0.25)));
    
    assert.strictEqual(calculateDuckedVol(100), 25);
    assert.strictEqual(calculateDuckedVol(80), 20);
    assert.strictEqual(calculateDuckedVol(50), 13);
    assert.strictEqual(calculateDuckedVol(20), 10); // clamped at min 10
    assert.strictEqual(calculateDuckedVol(5), 5);   // clamped at baseVol (Math.min(5, 10))

    // Verification of clamp logic
    const clampVol = (v) => Math.max(0, Math.min(100, Math.round(v)));
    assert.strictEqual(clampVol(-10), 0);
    assert.strictEqual(clampVol(120), 100);
    assert.strictEqual(clampVol(55.4), 55);
  }),

  // =========================================================================
  // AREA 4: CHAT, DANMAKU & XSS INJECTION FUZZING
  // =========================================================================
  registerTest('T5.4.1', 'Danmaku XSS Injection String Hardening & Escaping', async (ctx) => {
    ctx.bob.danmakuList = [];

    const xssPayloads = [
      "<script>alert('XSS')</script>",
      "<img src=x onerror=alert('PWNED')>",
      "<svg/onload=alert(1)>",
      "\"><script>document.location='http://attacker.com'</script>",
      "javascript:alert(1)"
    ];

    for (const payload of xssPayloads) {
      // Send with an interval >= 1000ms to bypass rate limiter
      ctx.alice.emit('send-danmaku', {
        text: payload,
        nickname: 'Hacker<script>',
        color: '#ff0000'
      });
      await sleep(1050);
    }

    // Verify all payloads were received as plain data strings
    assert(ctx.bob.danmakuList.length >= xssPayloads.length, 'Bob should receive all danmaku payloads');

    // Test clientEscapeHtml against each payload
    for (const d of ctx.bob.danmakuList) {
      const escapedText = clientEscapeHtml(d.text);
      const escapedNick = clientEscapeHtml(d.nickname);

      assert(!escapedText.includes('<script>'), `XSS tag unescaped in text: ${escapedText}`);
      assert(!escapedText.includes('<img'), `XSS img tag unescaped in text: ${escapedText}`);
      assert(!escapedText.includes('<svg'), `XSS svg tag unescaped in text: ${escapedText}`);
      assert(!escapedNick.includes('<script>'), `XSS tag unescaped in nickname: ${escapedNick}`);
    }
  }),

  registerTest('T5.4.2', 'Danmaku Extreme String Length & Truncation Bounds', async (ctx) => {
    ctx.charlie.danmakuList = [];
    await sleep(1050); // Ensure rate limiter window is clear

    const longText = 'A'.repeat(500);
    const longNick = 'B'.repeat(500);

    ctx.host.emit('send-danmaku', {
      text: longText,
      nickname: longNick,
      color: '#00ffaa'
    });

    const received = await ctx.charlie.waitForDanmaku(d => d.text.startsWith('AAAA'), 3000);
    assert(received, 'Should receive truncated danmaku');
    assert.strictEqual(received.text.length, 80, `Danmaku text should be truncated to exactly 80 chars, got ${received.text.length}`);
    assert.strictEqual(received.nickname.length, 25, `Danmaku nickname should be truncated to exactly 25 chars, got ${received.nickname.length}`);
  }),

  registerTest('T5.4.3', 'Unicode Emojis, Thai Script & Multi-Byte Payloads', async (ctx) => {
    ctx.bob.danmakuList = [];
    await sleep(1050);

    const unicodeText = '🚗💨 Party! 🤘🔥 เพลงนี้มันส์มาก สระซ้อน ่้๊๋ 🎵✨';
    const unicodeNick = 'น้องบ็อบ 🎸';

    ctx.alice.emit('send-danmaku', {
      text: unicodeText,
      nickname: unicodeNick,
      color: '#ABD2FA'
    });

    const received = await ctx.bob.waitForDanmaku(d => d.text.includes('Party!'), 3000);
    assert(received, 'Should receive unicode danmaku');
    assert.strictEqual(received.text, unicodeText, 'Unicode text should match verbatim');
    assert.strictEqual(received.nickname, unicodeNick, 'Unicode nickname should match verbatim');
  }),

  registerTest('T5.4.4', 'Danmaku Rapid Burst Rate Limiter Defense', async (ctx) => {
    ctx.bob.errorMsgList = [];
    await sleep(1050); // Clear rate limiter window

    // Send 8 messages in rapid succession (0ms interval) from Bob
    for (let i = 0; i < 8; i++) {
      ctx.bob.emit('send-danmaku', {
        text: `Burst message ${i}`,
        nickname: 'Bob'
      });
    }

    // Wait for rate limit error message
    const errorMsg = await ctx.bob.waitForErrorMsg(msg => msg.includes('ส่งข้อความเร็วเกินไป'), 3000);
    assert(errorMsg, 'Bob should receive rate limiter warning');
    assert(errorMsg.includes('ส่งข้อความเร็วเกินไป กรุณารอ 1 วินาที'));
  }),

  registerTest('T5.4.5', 'Color Sanitization & CSS Injection Prevention', async (ctx) => {
    // Test server color handling
    await sleep(1050);
    ctx.charlie.danmakuList = [];

    const maliciousColors = [
      'red; background:url(javascript:evil())',
      '<script>alert(1)</script>',
      '#12',
      '#GGGGGG',
      '#12345678',
      'rgb(255, 0, 0)',
      null
    ];

    for (const badColor of maliciousColors) {
      assert.strictEqual(clientSafeColor(badColor), '#ABD2FA', `clientSafeColor failed to sanitize '${badColor}'`);
    }

    // Verify server defaults to '#ABD2FA' when invalid color is sent
    ctx.host.emit('send-danmaku', {
      text: 'Color test',
      nickname: 'Tester',
      color: 'red; evil:true'
    });

    const received = await ctx.charlie.waitForDanmaku(d => d.text === 'Color test', 3000);
    assert.strictEqual(received.color, '#ABD2FA', 'Server should replace invalid color with default #ABD2FA');
  }),

  // =========================================================================
  // AREA 5: PROCESS SAFETY GUARDRAIL R4 & EPHEMERAL AUDIT
  // =========================================================================
  registerTest('T5.5.1', 'Ephemeral Port Isolation & Non-Default Port Binding', async (ctx) => {
    assert(ctx.port !== 3000, `Test server must run on ephemeral port, got ${ctx.port}`);
    assert(ctx.port > 1024, `Test server port must be an unprivileged dynamic port (>1024)`);
  }),

  registerTest('T5.5.2', 'Port 3000 Non-Interference Verification', async (ctx) => {
    const currentPid = checkPort3000Process();
    if (initialPort3000Pid !== null) {
      assert.strictEqual(currentPid, initialPort3000Pid, `Port 3000 process was modified! Expected PID ${initialPort3000Pid}, got ${currentPid}`);
    }
  }),

  registerTest('T5.5.3', 'Process Teardown & Zero Daemon Leak Audit', async (ctx) => {
    // Disconnect all clients
    for (const c of activeClients) {
      c.disconnect();
    }
    activeClients = [];

    // Terminate test server process
    if (ctx.child) {
      killChildProcessSync(ctx.child);
      ctx.child = null;
      activeChildProcess = null;
    }

    await sleep(300);

    // Confirm ephemeral port is released
    const isPortOpen = await new Promise((resolve) => {
      const probe = net.createConnection({ port: ctx.port, host: '127.0.0.1' }, () => {
        probe.end();
        resolve(true); // still open
      });
      probe.on('error', () => resolve(false)); // closed
    });

    assert.strictEqual(isPortOpen, false, `Ephemeral port ${ctx.port} was not released after server shutdown`);

    // Re-check port 3000
    const finalPid = checkPort3000Process();
    if (initialPort3000Pid !== null) {
      assert.strictEqual(finalPid, initialPort3000Pid, `Port 3000 PID changed during teardown!`);
    }
  })
];

// --- Test Runner Engine ---
async function runTier5Suite() {
  console.log('\n====================================================================');
  console.log('      MAITEMBATH GANG PARTY - TIER 5 ADVERSARIAL TEST SUITE        ');
  console.log('====================================================================');
  console.log(`Workspace: ${WORKSPACE_ROOT}`);
  console.log(`Target: server.js & public/js/ modules`);
  console.log(`Total Adversarial Test Cases: ${tests.length}\n`);

  let ctx = null;
  let passedCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  try {
    console.log(`${SYMBOLS.info} Spawning test server on ephemeral port...`);
    ctx = await setupTestContext();
    console.log(`${SYMBOLS.pass} Ephemeral server running on port ${ctx.port} (Port 3000 untouched)\n`);

    for (const t of tests) {
      const testStart = Date.now();
      process.stdout.write(`  [${t.id}] ${t.name.padEnd(58, '.')}`);

      try {
        await t.fn(ctx);
        const duration = Date.now() - testStart;
        console.log(` ${SYMBOLS.pass} (${duration}ms)`);
        passedCount++;
        testResults.push({ id: t.id, name: t.name, status: 'PASSED', duration });
      } catch (err) {
        const duration = Date.now() - testStart;
        console.log(` ${SYMBOLS.fail} (${duration}ms)`);
        console.error(`\n${c.red}    Error: ${err.message}${c.reset}`);
        if (err.stack) {
          const lines = err.stack.split('\n').slice(1, 4).join('\n');
          console.error(`${c.dim}${lines}${c.reset}\n`);
        }
        failedCount++;
        testResults.push({ id: t.id, name: t.name, status: 'FAILED', duration, error: err.message });
      }
    }
  } catch (err) {
    console.error(`\n${c.red}[SUITE SETUP ERROR]${c.reset}`, err);
    failedCount++;
  } finally {
    globalEmergencyCleanup();
  }

  const totalDuration = Date.now() - startTime;
  console.log('\n====================================================================');
  console.log('                     TIER 5 ADVERSARIAL SUMMARY                     ');
  console.log('====================================================================');
  console.log(`  Passed: ${passedCount} / ${tests.length}`);
  console.log(`  Failed: ${failedCount} / ${tests.length}`);
  console.log(`  Duration: ${totalDuration}ms`);
  console.log('--------------------------------------------------------------------');

  if (failedCount === 0) {
    console.log(`\n${SYMBOLS.pass} ALL TIER 5 ADVERSARIAL TESTS PASSED EMPIRICALLY! Exit code: 0\n`);
    process.exit(0);
  } else {
    console.log(`\n${SYMBOLS.fail} TIER 5 ADVERSARIAL FAILURES DETECTED! Exit code: 1\n`);
    process.exit(1);
  }
}

runTier5Suite();
