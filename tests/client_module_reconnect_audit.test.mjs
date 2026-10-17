#!/usr/bin/env node
/**
 * Direct Client Module (public/js/socket.js & state.js) Lifecycle Audit
 * Milestone 2 Challenger 2: Adversarial Client Reconnection & State Reconciliation
 * 
 * Directly loads the client ES modules to verify:
 * 1. Automatic profile re-emission on socket 'connect' event
 * 2. Automatic 'request-state' emission on 'connect' event
 * 3. Reactive state listeners notification on 'state-update', 'users-update', 'vote-skip-update'
 * 4. Resilient connection status transitions ('connecting' -> 'connected' -> 'disconnected' -> 'connected')
 * 5. Event listener cleanliness across 20 simulated disconnect/reconnect cycles
 */

import { EventEmitter } from 'events';
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import of client ES modules
const stateModule = await import('../public/js/state.js');
const socketModule = await import('../public/js/socket.js');

const {
  getState,
  updateState,
  setMyProfile,
  getMyProfile,
  onStateChange,
  onUsersChange,
  onVoteSkipChange,
  onConnectionChange,
  getConnectionStatus,
  getConnectedUsers,
  getVoteSkipState
} = stateModule;

const {
  initSocket,
  getSocket,
  emitSetProfile,
  emitRequestState,
  onToast,
  onError
} = socketModule;

console.log('====================================================================');
console.log(' CLIENT ES MODULE (socket.js & state.js) DIRECT AUDIT');
console.log('====================================================================\n');

// Mock Socket.IO Client instance with event tracking
class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.id = 'mock_client_' + Math.random().toString(36).substr(2, 6);
    this.emittedEvents = [];
    this.connected = false;
  }

  emit(eventName, ...args) {
    this.emittedEvents.push({ event: eventName, args, timestamp: Date.now() });
    return super.emit(eventName, ...args);
  }

  simulateConnect() {
    this.connected = true;
    this.emit('connect');
  }

  simulateDisconnect(reason = 'transport close') {
    this.connected = false;
    this.emit('disconnect', reason);
  }

  getEmissions(eventName) {
    return this.emittedEvents.filter(e => e.event === eventName);
  }

  clearEmissions() {
    this.emittedEvents = [];
  }
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  process.stdout.write(`  Audit: ${name.padEnd(58, '.')} `);
  try {
    fn();
    console.log('\x1b[32m✔ PASS\x1b[0m');
    passed++;
  } catch (err) {
    console.log('\x1b[31m✖ FAIL\x1b[0m');
    console.error(`    -> Error: ${err.message}`);
    failed++;
  }
}

// 1. Initialize client socket module with MockSocket
const mockIo = new MockSocket();
initSocket(mockIo);

runTest('1. Client socket initializes and binds to mock instance', () => {
  assert.strictEqual(getSocket(), mockIo, 'getSocket() should return initialized socket instance');
});

runTest('2. Initial connection status is connecting', () => {
  assert.strictEqual(getConnectionStatus(), 'connecting');
});

runTest('3. Profile caching and retrieval in state store', () => {
  setMyProfile({ name: 'Challenger Pilot', color: '#ff44aa' });
  const p = getMyProfile();
  assert.strictEqual(p.name, 'Challenger Pilot');
  assert.strictEqual(p.color, '#ff44aa');
});

runTest('4. Connect trigger automatically emits set-profile and request-state', () => {
  mockIo.clearEmissions();
  mockIo.simulateConnect();

  // Verify status updated to 'connected'
  assert.strictEqual(getConnectionStatus(), 'connected');

  // Verify set-profile emission with cached profile
  const profileEmits = mockIo.getEmissions('set-profile');
  assert.strictEqual(profileEmits.length, 1, 'Should emit set-profile exactly once upon connect');
  assert.strictEqual(profileEmits[0].args[0].name, 'Challenger Pilot');
  assert.strictEqual(profileEmits[0].args[0].color, '#ff44aa');

  // Verify request-state emission
  const stateReqEmits = mockIo.getEmissions('request-state');
  assert.strictEqual(stateReqEmits.length, 1, 'Should emit request-state exactly once upon connect');
});

runTest('5. Disconnect trigger transitions status to disconnected', () => {
  mockIo.simulateDisconnect('ping timeout');
  assert.strictEqual(getConnectionStatus(), 'disconnected');
});

runTest('6. Rapid 20-cycle reconnection stress preserves state handlers', () => {
  let connectionTransitions = 0;
  const unsubConn = onConnectionChange((status) => {
    connectionTransitions++;
  });

  for (let i = 1; i <= 20; i++) {
    mockIo.clearEmissions();
    mockIo.simulateConnect();
    assert.strictEqual(getConnectionStatus(), 'connected');
    
    // Check auto re-emissions
    assert.strictEqual(mockIo.getEmissions('set-profile').length, 1);
    assert.strictEqual(mockIo.getEmissions('request-state').length, 1);

    mockIo.simulateDisconnect('network glitch');
    assert.strictEqual(getConnectionStatus(), 'disconnected');
  }

  unsubConn();
  assert.strictEqual(connectionTransitions, 40, 'Should have precisely 40 status transitions (20 connect, 20 disconnect)');
});

runTest('7. Reactive state reconciliation updates state slices and triggers listeners', () => {
  let stateNotified = false;
  let usersNotified = false;
  let voteSkipNotified = false;

  const unsubState = onStateChange((st, keys) => {
    if (keys.includes('volume')) stateNotified = true;
  });
  const unsubUsers = onUsersChange((users) => {
    usersNotified = true;
  });
  const unsubVoteSkip = onVoteSkipChange((vs) => {
    voteSkipNotified = true;
  });

  // Server sends state snapshot
  mockIo.emit('state-update', { volume: 77, isPlaying: true, queue: [] });
  mockIo.emit('users-update', { [mockIo.id]: { name: 'Challenger Pilot', color: '#ff44aa' } });
  mockIo.emit('vote-skip-update', { current: 1, required: 2, hasVoted: false });

  assert.strictEqual(getState().volume, 77);
  assert.strictEqual(getState().isPlaying, true);
  assert.strictEqual(stateNotified, true, 'State listener should have been notified');
  assert.strictEqual(usersNotified, true, 'Users listener should have been notified');
  assert.strictEqual(voteSkipNotified, true, 'VoteSkip listener should have been notified');

  unsubState();
  unsubUsers();
  unsubVoteSkip();
});

console.log('\n====================================================================');
console.log(` RESULTS: ${passed} Passed, ${failed} Failed`);
console.log('====================================================================\n');

if (failed > 0) process.exit(1);
else process.exit(0);
