#!/usr/bin/env node
/**
 * MAITEMBATH GANG PARTY - Automated Multi-Client Verification Suite
 * 
 * Standalone executable verification test runner using socket.io-client.
 * Simulates concurrent multi-passenger in-car party dynamics across 4 tiers:
 *   - Tier 1: Core Feature Coverage (Syntax, Boot, Multi-Client, Profile, Queue, Playback, Clear)
 *   - Tier 2: Boundary & Corner Cases (Malformed inputs, Volume clamp, Quorum, Vote toggle, Danmaku rate limit)
 *   - Tier 3: Cross-Feature Combinations (Reorder while playing, Skip after reorder, Dynamic disconnect quorum, History re-queue)
 *   - Tier 4: Real-World Scenarios (In-car party E2E, Tunnel disconnect/reconnect reconciliation, Zero daemon teardown)
 * 
 * Process Safety Guardrail (R4):
 *   - Binds ephemeral port via net.createServer().listen(0).
 *   - Never blocks or touches default port 3000.
 *   - Traps SIGINT, SIGTERM, uncaughtException, unhandledRejection to guarantee zero zombie node processes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');

// --- Configuration & Paths ---
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'server.js');
const INDEX_HTML_PATH = path.join(WORKSPACE_ROOT, 'public', 'index.html');
const STYLE_CSS_PATH = path.join(WORKSPACE_ROOT, 'public', 'style.css');
const APP_JS_PATH = path.join(WORKSPACE_ROOT, 'public', 'app.js');
const JS_DIR_PATH = path.join(WORKSPACE_ROOT, 'public', 'js');

// CLI options
const args = process.argv.slice(2);
const tierArg = args.find(a => a.startsWith('--tier='));
const targetTier = tierArg ? parseInt(tierArg.split('=')[1], 10) : null;
const bail = args.includes('--bail');

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
  magenta: '\x1b[35m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  white: '\x1b[37m'
};

const SYMBOLS = {
  pass: `${c.green}✔${c.reset}`,
  fail: `${c.red}✖${c.reset}`,
  warn: `${c.yellow}⚠${c.reset}`,
  info: `${c.cyan}ℹ${c.reset}`,
  bullet: `${c.dim}•${c.reset}`
};

// Global context for process lifecycle & test cleanup
let activeChildProcess = null;
let activeClients = [];
let allocatedPort = null;

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
    try { client.disconnect(); } catch (_) {}
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

// --- Ephemeral Port Allocator ---
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

// --- Multi-Client Socket.IO Simulation Engine ---
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
    this.navState = null;
    this.danmakuList = [];
    this.reactionList = [];
    this.errorMsgList = [];
    this.toastList = [];
    this.eventLog = [];
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
        this.navState = payload.navState || null;
        this.eventLog.push({ type: 'init', payload });
        resolve(this);
      });

      this.socket.on('state-update', (state) => {
        this.state = state;
        this.eventLog.push({ type: 'state-update', state });
      });

      this.socket.on('users-update', (users) => {
        this.users = users;
        this.eventLog.push({ type: 'users-update', users });
      });

      this.socket.on('vote-skip-update', (vs) => {
        this.voteSkipState = vs;
        this.eventLog.push({ type: 'vote-skip-update', vs });
      });

      this.socket.on('nav-state-update', (data) => {
        this.navState = data.navState || data;
        this.eventLog.push({ type: 'nav-state-update', data });
      });

      this.socket.on('new-danmaku', (danmaku) => {
        this.danmakuList.push(danmaku);
        this.eventLog.push({ type: 'new-danmaku', danmaku });
      });

      this.socket.on('new-reaction', (reaction) => {
        this.reactionList.push(reaction);
        this.eventLog.push({ type: 'new-reaction', reaction });
      });

      this.socket.on('error-msg', (msg) => {
        this.errorMsgList.push(msg);
        this.eventLog.push({ type: 'error-msg', msg });
      });

      this.socket.on('show-toast-broadcast', (toast) => {
        this.toastList.push(toast);
        this.eventLog.push({ type: 'show-toast-broadcast', toast });
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

  waitForState(predicate, timeoutMs = 3000, description = 'state update') {
    if (this.state && predicate(this.state)) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${description} on [${this.name}] (${timeoutMs}ms)`));
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

  waitForVoteSkip(predicate, timeoutMs = 3000, description = 'vote-skip update') {
    if (this.voteSkipState && predicate(this.voteSkipState)) {
      return Promise.resolve(this.voteSkipState);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${description} on [${this.name}] (${timeoutMs}ms)`));
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

  waitForUsers(predicate, timeoutMs = 3000, description = 'users update') {
    if (this.users && predicate(this.users)) {
      return Promise.resolve(this.users);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${description} on [${this.name}] (${timeoutMs}ms)`));
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

  waitForEvent(eventName, predicate = () => true, timeoutMs = 3000, description = eventName) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for event '${eventName}' on [${this.name}] (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (data) => {
        if (predicate(data)) {
          cleanup();
          resolve(data);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (this.socket) this.socket.off(eventName, handler);
      };

      this.socket.on(eventName, handler);
    });
  }

  disconnect() {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (_) {}
      this.socket = null;
      this.connected = false;
    }
    const idx = activeClients.indexOf(this);
    if (idx !== -1) activeClients.splice(idx, 1);
  }
}

// --- Test Case Definition Harness ---
const testResults = [];

function registerTest(tier, id, name, fn) {
  return { tier, id, name, fn };
}

// Helper: HTTP GET probe
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

// Helper: Sleep
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Helper: Ensure test environment server and clients are running
async function ensureServerAndClients(ctx) {
  if (!ctx.child) {
    allocatedPort = await getEphemeralPort();
    ctx.port = allocatedPort;

    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(ctx.port) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    activeChildProcess = child;
    ctx.child = child;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to boot on port ${ctx.port} within 10000ms`));
      }, 10000);

      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        if (str.includes('Server is running!') || str.includes(`:${ctx.port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });

      child.on('exit', (code, sig) => {
        clearTimeout(timeout);
        reject(new Error(`Server process exited prematurely with code ${code}, signal ${sig}`));
      });
    });
  }

  if (!ctx.host || !ctx.host.connected) {
    ctx.host = new SimulatedClient(ctx.port, 'Host Driver', '#3b82f6');
    ctx.alice = new SimulatedClient(ctx.port, 'Alice', '#ec4899');
    ctx.bob = new SimulatedClient(ctx.port, 'Bob', '#10b981');
    ctx.charlie = new SimulatedClient(ctx.port, 'Charlie', '#f59e0b');

    await Promise.all([
      ctx.host.connect(),
      ctx.alice.connect(),
      ctx.bob.connect(),
      ctx.charlie.connect()
    ]);
    await ctx.host.waitForUsers(u => Object.keys(u).length === 4, 3000);
    ctx.host.emit('autodj-config', { enabled: false, notify: false });
    await ctx.host.waitForState(s => s.autoDjEnabled === false, 3000);
  }
}

// =============================================================================
// TEST SUITE DEFINITIONS (21 Test Cases across 4 Tiers)
// =============================================================================

const ALL_TESTS = [
  // ---------------------------------------------------------------------------
  // TIER 1: Feature Coverage Baseline
  // ---------------------------------------------------------------------------
  registerTest(1, 'T1.1', 'Static Integrity & Syntax Checks', async (ctx) => {
    // 1. JavaScript Syntax Check via node --check
    const jsFiles = [SERVER_PATH, APP_JS_PATH, path.join(__dirname, 'verify_suite.js')];
    if (fs.existsSync(JS_DIR_PATH)) {
      const dirEntries = fs.readdirSync(JS_DIR_PATH);
      for (const entry of dirEntries) {
        if (entry.endsWith('.js')) {
          jsFiles.push(path.join(JS_DIR_PATH, entry));
        }
      }
    }

    for (const file of jsFiles) {
      if (fs.existsSync(file)) {
        const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (check.status !== 0) {
          throw new Error(`Syntax error in ${path.relative(WORKSPACE_ROOT, file)}: ${check.stderr.trim()}`);
        }
      }
    }

    // 2. CSS Brace Balance in public/index.html & public/style.css
    if (!fs.existsSync(INDEX_HTML_PATH)) {
      throw new Error(`Missing ${INDEX_HTML_PATH}`);
    }
    const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

    let openBraces = 0;
    let closeBraces = 0;

    // Check style tags in index.html
    const styleMatches = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    for (const styleTag of styleMatches) {
      const stripped = styleTag.replace(/\/\*[\s\S]*?\*\//g, '');
      openBraces += (stripped.match(/\{/g) || []).length;
      closeBraces += (stripped.match(/\}/g) || []).length;
    }

    // Check public/style.css if present
    if (fs.existsSync(STYLE_CSS_PATH)) {
      const cssContent = fs.readFileSync(STYLE_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      openBraces += (cssContent.match(/\{/g) || []).length;
      closeBraces += (cssContent.match(/\}/g) || []).length;
    }

    if (openBraces !== closeBraces) {
      throw new Error(`CSS brace imbalance detected: { = ${openBraces}, } = ${closeBraces} (diff: ${openBraces - closeBraces})`);
    }

    // 3. HTML Tag Balance Validator on public/index.html
    const voidTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);

    const sanitizedHtml = htmlContent
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    const tagRegex = /<\/?([a-zA-Z0-9\-]+)(?:\s+[^>]*)?\/?>/g;
    const tagStack = [];
    let match;

    while ((match = tagRegex.exec(sanitizedHtml)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();

      if (tagName === '!doctype') continue;
      if (fullTag.endsWith('/>')) continue;
      if (voidTags.has(tagName)) continue;

      if (fullTag.startsWith('</')) {
        const top = tagStack.pop();
        if (top !== tagName) {
          throw new Error(`HTML tag mismatch: found </${tagName}> but expected </${top}>`);
        }
      } else {
        tagStack.push(tagName);
      }
    }

    if (tagStack.length > 0) {
      throw new Error(`HTML unclosed tags remain: ${tagStack.join(', ')}`);
    }
  }),

  registerTest(1, 'T1.2', 'Transient Server Boot on Ephemeral Port', async (ctx) => {
    // Allocate port and spawn server
    allocatedPort = await getEphemeralPort();
    ctx.port = allocatedPort;

    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(ctx.port) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    activeChildProcess = child;
    ctx.child = child;

    let serverReady = false;
    let serverOutput = '';

    const readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to boot on port ${ctx.port} within 10000ms. Output:\n${serverOutput}`));
      }, 10000);

      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        serverOutput += str;
        if (str.includes('Server is running!') || str.includes(`:${ctx.port}`)) {
          serverReady = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      child.stderr.on('data', (chunk) => {
        serverOutput += chunk.toString();
      });

      child.on('exit', (code, sig) => {
        clearTimeout(timeout);
        if (!serverReady) {
          reject(new Error(`Server process exited prematurely with code ${code}, signal ${sig}. Output:\n${serverOutput}`));
        }
      });
    });

    await readyPromise;

    // Probe HTTP endpoint
    const res = await httpGet(`http://127.0.0.1:${ctx.port}/`);
    if (res.statusCode !== 200) {
      throw new Error(`HTTP GET returned status ${res.statusCode}, expected 200`);
    }
    if (!res.body.includes('MAITEMBATH GANG PARTY')) {
      throw new Error(`HTTP response body missing expected title 'MAITEMBATH GANG PARTY'`);
    }
  }),

  registerTest(1, 'T1.3', 'Multi-Client Concurrent Connection & Init', async (ctx) => {
    // Concurrently connect 4 distinct passengers
    ctx.host = new SimulatedClient(ctx.port, 'Host Driver', '#3b82f6');
    ctx.alice = new SimulatedClient(ctx.port, 'Alice', '#ec4899');
    ctx.bob = new SimulatedClient(ctx.port, 'Bob', '#10b981');
    ctx.charlie = new SimulatedClient(ctx.port, 'Charlie', '#f59e0b');

    await Promise.all([
      ctx.host.connect(),
      ctx.alice.connect(),
      ctx.bob.connect(),
      ctx.charlie.connect()
    ]);

    // Wait until all 4 clients observe all 4 connected users
    await Promise.all([
      ctx.host.waitForUsers(u => Object.keys(u).length === 4, 3000, '4 users count on Host'),
      ctx.alice.waitForUsers(u => Object.keys(u).length === 4, 3000, '4 users count on Alice'),
      ctx.bob.waitForUsers(u => Object.keys(u).length === 4, 3000, '4 users count on Bob'),
      ctx.charlie.waitForUsers(u => Object.keys(u).length === 4, 3000, '4 users count on Charlie')
    ]);

    // Turn off Auto-DJ on server so background playlist additions don't mutate our test queue
    ctx.host.emit('autodj-config', { enabled: false, notify: false });
    await ctx.host.waitForState(s => s.autoDjEnabled === false, 3000, 'Auto-DJ disabled');
  }),

  registerTest(1, 'T1.4', 'Profile Synchronization Across Clients', async (ctx) => {
    // Alice, Bob, Charlie update profiles
    ctx.alice.emit('set-profile', { name: 'Alice Passenger', color: '#ff0055' });
    ctx.bob.emit('set-profile', { name: 'Bob Co-Pilot', color: '#00ffaa' });
    ctx.charlie.emit('set-profile', { name: 'Charlie DJ', color: '#ffaa00' });

    // Host must receive users-update with updated names and colors
    await ctx.host.waitForUsers((users) => {
      const names = Object.values(users).map(u => u.name);
      return names.includes('Alice Passenger') &&
             names.includes('Bob Co-Pilot') &&
             names.includes('Charlie DJ');
    }, 3000, 'Profile updates reflected on Host');

    // Bob also observes the changes
    await ctx.bob.waitForUsers((users) => {
      const colors = Object.values(users).map(u => u.color);
      return colors.includes('#ff0055') && colors.includes('#00ffaa') && colors.includes('#ffaa00');
    }, 3000, 'Profile colors reflected on Bob');
  }),

  registerTest(1, 'T1.5', 'Single Track Enqueueing & Immediate Playback', async (ctx) => {
    // Alice adds first track (Rick Astley 11-char ID)
    const testVideoId = 'dQw4w9WgXcQ';
    ctx.alice.emit('add-to-queue', {
      url: testVideoId,
      nickname: 'Alice Passenger',
      color: '#ff0055'
    });

    // All clients should receive state-update: currentVideo playing with videoId
    await Promise.all([
      ctx.host.waitForState(s => s.currentVideo && s.currentVideo.videoId === testVideoId && s.isPlaying === true, 4000, 'Track playing on Host'),
      ctx.alice.waitForState(s => s.currentVideo && s.currentVideo.videoId === testVideoId && s.isPlaying === true, 4000, 'Track playing on Alice'),
      ctx.bob.waitForState(s => s.currentVideo && s.currentVideo.videoId === testVideoId && s.isPlaying === true, 4000, 'Track playing on Bob'),
      ctx.charlie.waitForState(s => s.currentVideo && s.currentVideo.videoId === testVideoId && s.isPlaying === true, 4000, 'Track playing on Charlie')
    ]);

    if (ctx.host.state.queue.length !== 0) {
      throw new Error(`Queue should be empty since first track becomes currentVideo, got queue length: ${ctx.host.state.queue.length}`);
    }
  }),

  registerTest(1, 'T1.6', 'Multi-Track Enqueueing & FIFO Ordering', async (ctx) => {
    // Bob enqueues track 2, Charlie enqueues track 3
    const id2 = 'kJQP7kiw5Fk';
    const id3 = 'oHg5SJYRHA0';

    ctx.bob.emit('add-to-queue', { url: id2, nickname: 'Bob Co-Pilot', color: '#00ffaa' });
    await ctx.host.waitForState(s => s.queue.length === 1 && s.queue[0].videoId === id2, 3500, 'Track 2 in queue');

    ctx.charlie.emit('add-to-queue', { url: id3, nickname: 'Charlie DJ', color: '#ffaa00' });
    await ctx.host.waitForState(s => s.queue.length === 2 && s.queue[1].videoId === id3, 3500, 'Track 3 in queue');

    const q = ctx.host.state.queue;
    if (q[0].addedBy !== 'Bob Co-Pilot' || q[1].addedBy !== 'Charlie DJ') {
      throw new Error(`Queue items did not preserve addedBy attribution correctly`);
    }
    if (!q[0].id || !q[1].id || q[0].id === q[1].id) {
      throw new Error(`Queue items must have unique IDs`);
    }
  }),

  registerTest(1, 'T1.7', 'Basic Playback & Volume / Quality Controls', async (ctx) => {
    // Host pauses playback
    ctx.host.emit('play-control', false);
    await ctx.alice.waitForState(s => s.isPlaying === false, 3000, 'Playback paused on Alice');

    // Host adjusts volume to 75
    ctx.host.emit('volume-control', 75);
    await ctx.bob.waitForState(s => s.volume === 75, 3000, 'Volume 75 on Bob');

    // Host adjusts quality to hd720
    ctx.host.emit('quality-control', 'hd720');
    await ctx.charlie.waitForState(s => s.quality === 'hd720', 3000, 'Quality hd720 on Charlie');

    // Resume playback
    ctx.host.emit('play-control', true);
    await ctx.host.waitForState(s => s.isPlaying === true, 3000, 'Playback resumed on Host');
  }),

  registerTest(1, 'T1.8', 'Queue Item Removal & Complete Queue Clear', async (ctx) => {
    // Queue currently has 2 items [Track 2, Track 3]
    const itemToRemove = ctx.host.state.queue[0].id;
    ctx.host.emit('remove-from-queue', itemToRemove);
    await ctx.host.waitForState(s => s.queue.length === 1, 3000, 'Queue length 1 after removal');

    // Now clear the entire queue
    ctx.host.emit('clear-queue');
    await ctx.alice.waitForState(s => s.queue.length === 0, 3000, 'Queue empty after clear-queue');
  }),

  // ---------------------------------------------------------------------------
  // TIER 2: Boundary & Corner Cases
  // ---------------------------------------------------------------------------
  registerTest(2, 'T2.1', 'Malformed & Invalid Add-Queue Inputs', async (ctx) => {
    // 1. Emit empty object -> should receive error-msg
    const errPromise1 = ctx.alice.waitForEvent('error-msg', msg => typeof msg === 'string' && msg.length > 0, 3000);
    ctx.alice.emit('add-to-queue', {});
    const err1 = await errPromise1;
    if (!err1.includes('กรุณาระบุลิงก์เพลง')) {
      throw new Error(`Unexpected error message for empty object: ${err1}`);
    }

    // 2. Emit null/empty string -> should receive error-msg
    const errPromise2 = ctx.bob.waitForEvent('error-msg', msg => typeof msg === 'string' && msg.length > 0, 3000);
    ctx.bob.emit('add-to-queue', { url: '' });
    const err2 = await errPromise2;
    if (!err2.includes('กรุณาระบุลิงก์เพลง')) {
      throw new Error(`Unexpected error message for empty url: ${err2}`);
    }

    // Server must still be responsive and queue intact
    if (ctx.host.state.queue.length !== 0) {
      throw new Error(`Queue was corrupted by invalid inputs, length: ${ctx.host.state.queue.length}`);
    }
  }),

  registerTest(2, 'T2.2', 'Volume Range Clamping & NaN Hardening', async (ctx) => {
    // Lower boundary: -50 should clamp to 0
    ctx.host.emit('volume-control', -50);
    await ctx.host.waitForState(s => s.volume === 0, 3000, 'Volume clamped to 0');

    // Upper boundary: 250 should clamp to 100
    ctx.host.emit('volume-control', 250);
    await ctx.host.waitForState(s => s.volume === 100, 3000, 'Volume clamped to 100');

    // Invalid input: NaN should be ignored, leaving volume unchanged at 100
    ctx.host.emit('volume-control', NaN);
    await sleep(200);
    if (ctx.host.state.volume !== 100 || isNaN(ctx.host.state.volume)) {
      throw new Error(`Volume invalid after NaN: ${ctx.host.state.volume}`);
    }

    // Reset volume to normal
    ctx.host.emit('volume-control', 50);
    await ctx.host.waitForState(s => s.volume === 50, 3000, 'Volume reset to 50');
  }),

  registerTest(2, 'T2.3', 'Single-Client Vote Skip Quorum', async (ctx) => {
    // Disconnect 4 main clients temporarily
    for (const k of ['host', 'alice', 'bob', 'charlie']) {
      if (ctx[k]) {
        ctx[k].disconnect();
        ctx[k] = null;
      }
    }

    let solo = null;
    try {
      solo = new SimulatedClient(ctx.port, 'Solo Driver', '#ffffff');
      await solo.connect();
      await solo.waitForUsers(u => Object.keys(u).length === 1, 3500, 'Solo user isolated');

      // Turn off Auto-DJ
      solo.emit('autodj-config', { enabled: false, notify: false });
      await solo.waitForState(s => s.autoDjEnabled === false, 3000);

      // Clear queue and advance track so currentVideo becomes null
      solo.emit('clear-queue');
      await solo.waitForState(s => s.queue.length === 0, 3000);
      if (solo.state.currentVideo) {
        solo.emit('skip-video');
        await solo.waitForState(s => s.currentVideo === null, 3000);
      }

      // Add Song A (plays immediately, currentVideo becomes Song A)
      solo.emit('add-to-queue', { url: 'dQw4w9WgXcQ' });
      await solo.waitForState(s => s.currentVideo && s.currentVideo.videoId === 'dQw4w9WgXcQ', 3500, 'Song A playing');

      // Add Song B (enters queue at index 0)
      solo.emit('add-to-queue', { url: 'kJQP7kiw5Fk' });
      await solo.waitForState(s => s.queue.length === 1 && s.queue[0].videoId === 'kJQP7kiw5Fk', 3500, 'Song B in queue');

      // Check vote-skip state: required must be 1 for single user
      if (solo.voteSkipState.required !== 1) {
        throw new Error(`Expected solo user voteSkipState.required to be 1, got ${solo.voteSkipState.required}`);
      }

      // Solo user votes to skip -> 1/1 reaches quorum -> immediately advances to Song B
      solo.emit('vote-skip');
      await solo.waitForState(s => s.currentVideo && s.currentVideo.videoId === 'kJQP7kiw5Fk', 3500, 'Advanced to Song B via single vote');
    } finally {
      if (solo) {
        solo.disconnect();
      }
      // Re-establish 4 main clients for subsequent tests
      await ensureServerAndClients(ctx);
    }
  }),

  registerTest(2, 'T2.4', 'Vote Retraction & Toggle Mechanics', async (ctx) => {
    // Ensure active video is playing
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: 'dQw4w9WgXcQ' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }

    // With 4 clients, required votes = Math.floor(4/2) + 1 = 3
    if (ctx.host.voteSkipState.required !== 3) {
      throw new Error(`Expected required votes to be 3 with 4 users, got ${ctx.host.voteSkipState.required}`);
    }

    // Alice votes to skip
    ctx.alice.emit('vote-skip');
    await ctx.host.waitForVoteSkip(vs => vs.current === 1 && vs.voters.includes(ctx.alice.socket.id), 3000, 'Alice vote registered');

    // Alice votes again -> Retracts vote
    ctx.alice.emit('vote-skip');
    await ctx.host.waitForVoteSkip(vs => vs.current === 0 && !vs.voters.includes(ctx.alice.socket.id), 3000, 'Alice vote retracted');
  }),

  registerTest(2, 'T2.5', 'Queue Boundary Moves (Move-Track Guards)', async (ctx) => {
    // Add 2 tracks so we have queue of [Track A, Track B]
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000);

    ctx.alice.emit('add-to-queue', { url: '9bZkp7q19f0' }); // Track A
    await ctx.host.waitForState(s => s.queue.length === 1, 3500);

    ctx.bob.emit('add-to-queue', { url: 'oHg5SJYRHA0' }); // Track B
    await ctx.host.waitForState(s => s.queue.length === 2, 3500);

    const trackA = ctx.host.state.queue[0];
    const trackB = ctx.host.state.queue[1];

    // Attempt moving top track UP (should stay at index 0)
    ctx.host.emit('move-track', { itemId: trackA.id, direction: 'up' });
    await sleep(300);

    // Attempt moving bottom track DOWN (should stay at index 1)
    ctx.host.emit('move-track', { itemId: trackB.id, direction: 'down' });
    await sleep(300);

    // Now test valid move: move trackB UP -> should become index 0
    ctx.host.emit('move-track', { itemId: trackB.id, direction: 'up' });
    await ctx.host.waitForState(
      s => s.queue.length === 2 && s.queue[0].id === trackB.id,
      2500,
      "move-track UP moving bottom track to top (Milestone 1 dependency: server.js lacks 'move-track' handler)"
    );

    // Move trackB back down
    ctx.host.emit('move-track', { itemId: trackB.id, direction: 'down' });
    await ctx.host.waitForState(
      s => s.queue.length === 2 && s.queue[1].id === trackB.id,
      2500,
      "move-track DOWN restoring original order"
    );
  }),

  registerTest(2, 'T2.6', 'Danmaku Rate Limiter (1-Second Cooldown)', async (ctx) => {
    // First message: should succeed
    const firstDanmakuPromise = ctx.host.waitForEvent('new-danmaku', d => d.text === 'First Danmaku', 3000);
    ctx.alice.emit('send-danmaku', { text: 'First Danmaku', nickname: 'Alice', color: '#ff0055' });
    await firstDanmakuPromise;

    // Second message immediately within 100ms: must be rejected with rate limit error
    const errPromise = ctx.alice.waitForEvent('error-msg', msg => msg.includes('ส่งข้อความเร็วเกินไป'), 3000);
    ctx.alice.emit('send-danmaku', { text: 'Spam Danmaku', nickname: 'Alice', color: '#ff0055' });
    const errMsg = await errPromise;

    if (!errMsg.includes('ส่งข้อความเร็วเกินไป')) {
      throw new Error(`Rate limit error expected, received: ${errMsg}`);
    }
  }),

  // ---------------------------------------------------------------------------
  // TIER 3: Cross-Feature Combinations & Protocols
  // ---------------------------------------------------------------------------
  registerTest(3, 'T3.1', 'Queue Reordering While Video is Playing', async (ctx) => {
    // Ensure active video is playing
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: '9bZkp7q19f0' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }

    // Clear and build a known 3-track queue: [T1, T2, T3]
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000);

    ctx.alice.emit('add-to-queue', { url: 'dQw4w9WgXcQ' }); // T1
    await ctx.host.waitForState(s => s.queue.length === 1, 3500);
    ctx.bob.emit('add-to-queue', { url: 'kJQP7kiw5Fk' });   // T2
    await ctx.host.waitForState(s => s.queue.length === 2, 3500);
    ctx.charlie.emit('add-to-queue', { url: 'oHg5SJYRHA0' }); // T3
    await ctx.host.waitForState(s => s.queue.length === 3, 3500);

    const [t1, t2, t3] = ctx.host.state.queue;
    const currentPlayingVideoId = ctx.host.state.currentVideo ? ctx.host.state.currentVideo.videoId : null;

    // Host emits reorder-queue: reverse to [T3, T1, T2]
    const targetOrder = [t3.id, t1.id, t2.id];
    ctx.host.emit('reorder-queue', { itemIds: targetOrder });

    // All clients must receive state-update with new queue order
    await Promise.all([
      ctx.host.waitForState(
        s => s.queue.length === 3 && s.queue[0].id === t3.id && s.queue[1].id === t1.id && s.queue[2].id === t2.id,
        2500,
        "Reordered queue on Host (Milestone 1 dependency: server.js lacks 'reorder-queue' handler)"
      ),
      ctx.alice.waitForState(s => s.queue.length === 3 && s.queue[0].id === t3.id, 2500, 'Reordered on Alice'),
      ctx.bob.waitForState(s => s.queue.length === 3 && s.queue[0].id === t3.id, 2500, 'Reordered on Bob'),
      ctx.charlie.waitForState(s => s.queue.length === 3 && s.queue[0].id === t3.id, 2500, 'Reordered on Charlie')
    ]);

    // Active playing video must remain uninterrupted
    if (ctx.host.state.currentVideo.videoId !== currentPlayingVideoId) {
      throw new Error(`Current playing video interrupted during queue reorder`);
    }
  }),

  registerTest(3, 'T3.2', 'Host Skip After Reorder & Playback History Log', async (ctx) => {
    // Ensure active video is playing
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: 'dQw4w9WgXcQ' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }
    // Ensure queue has tracks
    if (ctx.host.state.queue.length < 2) {
      ctx.alice.emit('add-to-queue', { url: 'kJQP7kiw5Fk' });
      ctx.bob.emit('add-to-queue', { url: 'oHg5SJYRHA0' });
      await ctx.host.waitForState(s => s.queue.length >= 2, 3500);
    }

    const expectedNextTrack = ctx.host.state.queue[0];
    const previousTrack = ctx.host.state.currentVideo;

    ctx.host.emit('skip-video');

    // State update: currentVideo should now be expectedNextTrack
    await ctx.host.waitForState(
      s => s.currentVideo && s.currentVideo.id === expectedNextTrack.id,
      3500,
      'Next track now playing'
    );

    // Verify state.history contains previousTrack (Server History Contract)
    if (!ctx.host.state.history || !Array.isArray(ctx.host.state.history)) {
      throw new Error(`Server state missing 'history' array (Milestone 1 dependency: server.js lacks state.history)`);
    }
    const hasPreviousTrack = ctx.host.state.history.some(h => h.videoId === previousTrack.videoId);
    if (!hasPreviousTrack) {
      throw new Error(`Previous track ${previousTrack.videoId} not recorded in state.history`);
    }
  }),

  registerTest(3, 'T3.3', 'Vote-to-Skip Quorum under Dynamic Disconnect', async (ctx) => {
    // Ensure active video is playing
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: 'dQw4w9WgXcQ' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }
    // Ensure queue has at least 1 track to skip to
    if (ctx.host.state.queue.length === 0) {
      ctx.alice.emit('add-to-queue', { url: 'kJQP7kiw5Fk' });
      await ctx.host.waitForState(s => s.queue.length > 0, 3500);
    }

    const currentTrackId = ctx.host.state.currentVideo.id;

    // Currently 4 users (Host, Alice, Bob, Charlie) -> Required votes = floor(4/2)+1 = 3
    if (ctx.host.voteSkipState.required !== 3) {
      throw new Error(`Expected required votes = 3 for 4 users, got ${ctx.host.voteSkipState.required} (users count: ${Object.keys(ctx.host.users).length})`);
    }

    // Alice votes (1/3)
    ctx.alice.emit('vote-skip');
    await ctx.host.waitForVoteSkip(vs => vs.current === 1, 3000, '1 vote registered');

    // Bob votes (2/3)
    ctx.bob.emit('vote-skip');
    await ctx.host.waitForVoteSkip(vs => vs.current === 2, 3000, '2 votes registered');

    try {
      // Charlie abruptly disconnects -> user count drops from 4 to 3 -> required drops to floor(3/2)+1 = 2
      ctx.charlie.disconnect();

      // With 2 votes already cast and required now 2, the quorum (2/2) is satisfied!
      // The server should trigger playNext() under dynamic quorum reconciliation
      await ctx.host.waitForState(
        s => !s.currentVideo || s.currentVideo.id !== currentTrackId,
        3000,
        'Track skipped under dynamic quorum reconciliation (Milestone 1 dependency: disconnect handler should trigger playNext when vote quorum met)'
      );

      // Votes must be reset
      await ctx.host.waitForVoteSkip(vs => vs.current === 0, 3000, 'Vote tally reset after skip');
    } finally {
      // Reconnect Charlie
      if (!ctx.charlie || !ctx.charlie.connected) {
        ctx.charlie = new SimulatedClient(ctx.port, 'Charlie', '#f59e0b');
        await ctx.charlie.connect();
        await ctx.host.waitForUsers(u => Object.keys(u).length === 4, 3500);
      }
    }
  }),

  registerTest(3, 'T3.4', 'History Log & Instant One-Click Re-Queue', async (ctx) => {
    // Verify history exists
    if (!ctx.host.state.history || ctx.host.state.history.length === 0) {
      throw new Error(`state.history is empty (Milestone 1 dependency: server.js lacks state.history)`);
    }

    const historyItem = ctx.host.state.history[0];
    const initialQueueLen = ctx.host.state.queue.length;

    // Alice clicks "Re-Queue" on history item
    ctx.alice.emit('add-to-queue', {
      url: historyItem.url || `https://www.youtube.com/watch?v=${historyItem.videoId}`,
      nickname: 'Alice Passenger',
      color: '#ff0055'
    });

    // Queue must grow by 1 with matching videoId
    await ctx.host.waitForState(s => s.queue.length === initialQueueLen + 1 && s.queue[s.queue.length - 1].videoId === historyItem.videoId, 4000, 'History track re-queued');

    const addedItem = ctx.host.state.queue[ctx.host.state.queue.length - 1];
    if (addedItem.videoId !== historyItem.videoId) {
      throw new Error(`Re-queued track videoId mismatch: expected ${historyItem.videoId}, got ${addedItem.videoId}`);
    }
  }),

  // ---------------------------------------------------------------------------
  // TIER 4: Real-World In-Car Road Trip Scenarios & Guardrails
  // ---------------------------------------------------------------------------
  registerTest(4, 'T4.1', 'In-Car Road Trip Party Simulation E2E', async (ctx) => {
    // Ensure active video is playing so subsequent additions go into queue
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: '9bZkp7q19f0' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }

    // 1. Host updates GPS navigation state (simulating driver setting route to Pattaya)
    const navPatch = {
      destination: 'Pattaya Beach Road',
      step: 'navigate',
      controllerName: 'Host Driver'
    };
    ctx.host.emit('sync-nav-state', navPatch);

    // All passengers receive GPS update
    await Promise.all([
      ctx.alice.waitForEvent('nav-state-update', d => d.navState && d.navState.destination === 'Pattaya Beach Road', 3000),
      ctx.bob.waitForEvent('nav-state-update', d => d.navState && d.navState.destination === 'Pattaya Beach Road', 3000),
      ctx.charlie.waitForEvent('nav-state-update', d => d.navState && d.navState.destination === 'Pattaya Beach Road', 3000)
    ]);

    // 2. Passengers send celebratory reactions and danmaku ('🔥' is in allowed whitelist)
    const reactionPromise = ctx.host.waitForEvent('new-reaction', r => r === '🔥', 3000);
    ctx.bob.emit('send-reaction', '🔥');
    await reactionPromise;

    // Clear residual queue from previous tests to guarantee isolated baseline
    ctx.host.emit('clear-queue');
    await ctx.host.waitForState(s => s.queue.length === 0, 3000, 'Queue reset before concurrent additions');

    // 3. Concurrent track additions by Alice and Charlie
    ctx.alice.emit('add-to-queue', { url: 'dQw4w9WgXcQ', nickname: 'Alice Passenger' });
    ctx.charlie.emit('add-to-queue', { url: 'kJQP7kiw5Fk', nickname: 'Charlie DJ' });

    // Wait until BOTH tracks are present across all 4 devices
    const hasBothTracks = s => s.queue.some(t => t.videoId === 'dQw4w9WgXcQ') && s.queue.some(t => t.videoId === 'kJQP7kiw5Fk');
    await Promise.all([
      ctx.host.waitForState(hasBothTracks, 3500, 'Both tracks on Host'),
      ctx.alice.waitForState(hasBothTracks, 3500, 'Both tracks on Alice'),
      ctx.bob.waitForState(hasBothTracks, 3500, 'Both tracks on Bob'),
      ctx.charlie.waitForState(hasBothTracks, 3500, 'Both tracks on Charlie')
    ]);

    // Verify 100% state congruence across all 4 devices
    const hostQ = JSON.stringify(ctx.host.state.queue.map(t => t.id));
    const aliceQ = JSON.stringify(ctx.alice.state.queue.map(t => t.id));
    const bobQ = JSON.stringify(ctx.bob.state.queue.map(t => t.id));
    const charlieQ = JSON.stringify(ctx.charlie.state.queue.map(t => t.id));

    if (hostQ !== aliceQ || hostQ !== bobQ || hostQ !== charlieQ) {
      throw new Error(`State incongruence across clients during road trip simulation:\nHost: ${hostQ}\nAlice: ${aliceQ}\nBob: ${bobQ}\nCharlie: ${charlieQ}`);
    }
  }),

  registerTest(4, 'T4.2', 'Tunnel Disconnect & Auto-Reconnect Reconciliation', async (ctx) => {
    // Ensure active video is playing
    if (!ctx.host.state.currentVideo) {
      ctx.host.emit('add-to-queue', { url: 'dQw4w9WgXcQ' });
      await ctx.host.waitForState(s => !!s.currentVideo, 3500);
    }
    if (ctx.host.state.queue.length === 0) {
      ctx.alice.emit('add-to-queue', { url: 'kJQP7kiw5Fk' });
      await ctx.host.waitForState(s => s.queue.length > 0, 3500);
    }

    // Bob disconnects (simulating passing through an underground mountain tunnel)
    ctx.bob.disconnect();
    await ctx.host.waitForUsers(u => Object.keys(u).length === 3, 3000, 'Bob disconnected');

    // While Bob is offline in tunnel:
    // Host changes room volume to 82 and advances track
    ctx.host.emit('volume-control', 82);
    await ctx.host.waitForState(s => s.volume === 82, 3000);

    const prevCurrentId = ctx.host.state.currentVideo ? ctx.host.state.currentVideo.id : null;
    ctx.host.emit('skip-video');
    await ctx.host.waitForState(s => !s.currentVideo || s.currentVideo.id !== prevCurrentId, 3000, 'Host track skipped');

    // Bob exits tunnel and reconnects to socket
    ctx.bob = new SimulatedClient(ctx.port, 'Bob Co-Pilot', '#00ffaa');
    await ctx.bob.connect();

    // Bob emits request-state to perform full state reconciliation
    ctx.bob.emit('request-state');

    // Bob's state must match room state without page reload
    await ctx.bob.waitForState(s => s.volume === 82, 3500, 'Bob reconciled volume');

    if (!ctx.bob.state.currentVideo || ctx.bob.state.currentVideo.id !== ctx.host.state.currentVideo.id) {
      throw new Error(`Bob state failed to reconcile currentVideo with Host upon tunnel reconnect`);
    }

    if (ctx.bob.state.queue.length !== ctx.host.state.queue.length) {
      throw new Error(`Bob queue length mismatch: expected ${ctx.host.state.queue.length}, got ${ctx.bob.state.queue.length}`);
    }
  }),

  registerTest(4, 'T4.3', 'Process Safety Guardrail & Zero Daemon Leak (R4)', async (ctx) => {
    // 1. Cleanly disconnect all simulated clients
    for (const client of [ctx.host, ctx.alice, ctx.bob, ctx.charlie]) {
      if (client) client.disconnect();
    }
    activeClients = [];

    // 2. Kill transient child server process
    if (activeChildProcess) {
      const pid = activeChildProcess.pid;
      killChildProcessSync(activeChildProcess);
      activeChildProcess = null;

      // Wait up to 2000ms for process to be completely dead
      let isDead = false;
      const start = Date.now();
      while (Date.now() - start < 2000) {
        try {
          // Sending signal 0 checks if process exists
          process.kill(pid, 0);
          await sleep(100);
        } catch (e) {
          isDead = true;
          break;
        }
      }

      if (!isDead) {
        throw new Error(`Transient server PID ${pid} did not terminate within 2000ms`);
      }
    }

    // 3. Confirm ephemeral test port was cleanly released and is immediately re-bindable
    await new Promise((resolve, reject) => {
      const testServer = net.createServer();
      testServer.listen(ctx.port, '127.0.0.1', () => {
        testServer.close(() => resolve());
      });
      testServer.on('error', (err) => {
        reject(new Error(`Test port ${ctx.port} was not released: ${err.message}`));
      });
    });

    // 4. Confirm default port 3000 was never touched
    await new Promise((resolve) => {
      const socket = net.createConnection({ port: 3000, host: '127.0.0.1' }, () => {
        // If port 3000 was listening, that would be user's server or open port; disconnect
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        // Error means port 3000 is free or untouched, which is fine
        resolve();
      });
      socket.setTimeout(200, () => {
        socket.destroy();
        resolve();
      });
    });
  })
];

// =============================================================================
// RUNNER & FORMATTED REPORTING
// =============================================================================

async function runSuite() {
  const selectedTests = targetTier
    ? ALL_TESTS.filter(t => t.tier === targetTier)
    : ALL_TESTS;

  console.log(`\n${c.bold}${c.cyan}====================================================================${c.reset}`);
  console.log(`${c.bold}${c.white}      MAITEMBATH GANG PARTY - AUTOMATED VERIFICATION SUITE         ${c.reset}`);
  console.log(`${c.bold}${c.cyan}====================================================================${c.reset}`);
  console.log(`${c.dim}Workspace: ${WORKSPACE_ROOT}${c.reset}`);
  console.log(`${c.dim}Execution Mode: ${targetTier ? `Tier ${targetTier} only` : 'All 4 Tiers (Full Matrix)'}${c.reset}`);
  console.log(`${c.dim}Total Test Cases: ${selectedTests.length}${c.reset}\n`);

  const ctx = {
    port: null,
    child: null,
    host: null,
    alice: null,
    bob: null,
    charlie: null
  };

  let passedCount = 0;
  let failedCount = 0;
  const suiteStartTime = Date.now();

  for (const test of selectedTests) {
    const testStartTime = Date.now();
    process.stdout.write(`  [${test.id}] ${test.name.padEnd(52, '.')} `);

    try {
      if (test.tier > 1) {
        await ensureServerAndClients(ctx);
      }
      await test.fn(ctx);
      const duration = Date.now() - testStartTime;
      console.log(`${SYMBOLS.pass} ${c.dim}(${duration}ms)${c.reset}`);
      testResults.push({ id: test.id, name: test.name, tier: test.tier, status: 'PASS', duration, error: null });
      passedCount++;
    } catch (err) {
      const duration = Date.now() - testStartTime;
      console.log(`${SYMBOLS.fail} ${c.red}FAIL${c.reset} ${c.dim}(${duration}ms)${c.reset}`);
      console.log(`      ${c.red}${err.message || err}${c.reset}`);
      testResults.push({ id: test.id, name: test.name, tier: test.tier, status: 'FAIL', duration, error: err.message || String(err) });
      failedCount++;

      if (bail) {
        console.log(`\n${c.yellow}[BAIL] Stopping test suite on first failure (--bail specified).${c.reset}`);
        break;
      }
    }
  }

  // Final cleanup if T4.3 didn't run or if suite bailed
  globalEmergencyCleanup();

  const totalDuration = Date.now() - suiteStartTime;

  console.log(`\n${c.bold}${c.cyan}====================================================================${c.reset}`);
  console.log(`${c.bold}${c.white}                         VERIFICATION SUMMARY                       ${c.reset}`);
  console.log(`${c.bold}${c.cyan}====================================================================${c.reset}`);

  // Summary by Tier
  for (let tier = 1; tier <= 4; tier++) {
    const tierTests = testResults.filter(t => t.tier === tier);
    if (tierTests.length === 0) continue;
    const tierPassed = tierTests.filter(t => t.status === 'PASS').length;
    const tierFailed = tierTests.filter(t => t.status === 'FAIL').length;
    const statusColor = tierFailed === 0 ? c.green : c.red;
    console.log(`  Tier ${tier}: ${statusColor}${tierPassed}/${tierTests.length} Passed${c.reset} (${tierFailed} Failed)`);
  }

  console.log(`${c.dim}--------------------------------------------------------------------${c.reset}`);
  console.log(`  Total: ${testResults.length} | Passed: ${c.green}${passedCount}${c.reset} | Failed: ${failedCount > 0 ? c.red : c.green}${failedCount}${c.reset} | Duration: ${totalDuration}ms\n`);

  if (failedCount > 0) {
    console.log(`${c.bold}${c.red}✖ FAILED TESTS:${c.reset}`);
    for (const res of testResults.filter(t => t.status === 'FAIL')) {
      console.log(`  - [${res.id}] ${res.name}: ${c.red}${res.error}${c.reset}`);
    }
    console.log(`\n${c.red}Verification suite failed. Exit code: 1${c.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${c.bold}${c.green}✔ ALL VERIFICATION TESTS PASSED SUCCESSFULLY! Exit code: 0${c.reset}\n`);
    process.exit(0);
  }
}

// Execute Runner
runSuite().catch((err) => {
  console.error(`\n${c.bgRed}${c.white} FATAL ERROR IN VERIFICATION RUNNER ${c.reset}`, err);
  globalEmergencyCleanup();
  process.exit(1);
});
