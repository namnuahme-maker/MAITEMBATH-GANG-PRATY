/**
 * MAITEMBATH GANG PARTY - Socket Client Module (public/js/socket.js)
 * 
 * Manages Socket.IO connection, event dispatching, automatic reconnection,
 * state reconciliation, and typed outbound emit wrappers.
 */

import {
    getState,
    updateState,
    getMyProfile,
    getHostMode,
    updateConnectedUsers,
    updateVoteSkipState,
    updateNavState,
    updateServerInfo,
    setConnectionStatus
} from './state.js';

// ============================================================================
// 1. SOCKET.IO CLIENT INITIALIZATION & CONFIGURATION
// ============================================================================

let socket = null;
let isInitialized = false;

// Custom callback registries for non-state UI/Audio events
const toastListeners = new Set();
const errorListeners = new Set();
const reactionListeners = new Set();
const danmakuListeners = new Set();
const soundboardListeners = new Set();
const seekVideoListeners = new Set();
const navAlertListeners = new Set();
const queueStatusListeners = new Set();
const timeUpdateListeners = new Set();
const initListeners = new Set();

/**
 * Initialize Socket.IO connection and wire up all incoming event dispatchers.
 * Safe to call multiple times (idempotent).
 * @param {any} [customIoInstance] - Optional mock or pre-instantiated io instance
 * @returns {any} Socket instance
 */
export function initSocket(customIoInstance = null) {
    if (isInitialized && socket) return socket;

    if (customIoInstance) {
        socket = customIoInstance;
    } else if (typeof io === 'function') {
        socket = io({
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            transports: ['websocket', 'polling']
        });
    } else {
        console.warn('[Socket] Global `io` function is not available on window. Deferring socket init.');
        return null;
    }

    setupInboundDispatchers();
    isInitialized = true;
    return socket;
}

/**
 * Access underlying Socket.IO instance
 * @returns {any}
 */
export function getSocket() {
    if (!socket) initSocket();
    return socket;
}

// ============================================================================
// 2. INBOUND EVENT DISPATCHERS & STATE RECONCILIATION
// ============================================================================

function setupInboundDispatchers() {
    if (!socket) return;

    // --- Lifecycle & Resilient Reconnection Protocol ---
    socket.on('connect', () => {
        console.log('[Socket] Connected to server, id:', socket.id);
        setConnectionStatus('connected');

        // Protocol Step 1: Automatically re-emit user profile upon connect/reconnect
        const profile = getMyProfile();
        if (profile && profile.name) {
            emitSetProfile(profile);
        }

        // Protocol Step 2: Request fresh state snapshot from server
        emitRequestState();
    });

    socket.on('disconnect', (reason) => {
        console.warn('[Socket] Disconnected from server, reason:', reason);
        setConnectionStatus('disconnected');
    });

    socket.on('connect_error', (err) => {
        console.warn('[Socket] Connection error:', err.message);
        setConnectionStatus('disconnected');
    });

    // --- Core State Updates ---
    socket.on('init', (data) => {
        if (!data) return;

        if (data.state) updateState(data.state);
        if (data.users) updateConnectedUsers(data.users);
        if (data.voteSkipState) updateVoteSkipState(data.voteSkipState);
        if (data.navState) updateNavState(data.navState);

        updateServerInfo({
            localIp: data.localIp || '',
            port: data.port || 3000,
            joinUrl: data.joinUrl || '',
            qrDataUrl: data.qrDataUrl || ''
        });

        for (const fn of initListeners) {
            try { fn(data); } catch (e) { console.error('[Socket] init listener error:', e); }
        }
    });

    socket.on('state-update', (newState) => {
        if (newState) updateState(newState);
    });

    socket.on('time-update', (data) => {
        if (!data || typeof data !== 'object') return;
        // Host coordinates local media element; non-hosts follow server time ticker
        if (!getHostMode()) {
            updateState({
                currentTime: data.currentTime || 0,
                duration: data.duration || 0
            }, true); // silent update to avoid heavy UI re-render on 1000ms ticker
        }

        for (const fn of timeUpdateListeners) {
            try { fn(data.currentTime || 0, data.duration || 0); } catch (e) {}
        }
    });

    socket.on('seek-video', (seconds) => {
        for (const fn of seekVideoListeners) {
            try { fn(seconds); } catch (e) { console.error('[Socket] seek-video error:', e); }
        }
    });

    socket.on('users-update', (users) => {
        if (users) updateConnectedUsers(users);
    });

    socket.on('vote-skip-update', (vs) => {
        if (vs) updateVoteSkipState(vs);
    });

    // --- Interactive Room Features & Media Sync ---
    socket.on('add-queue-status', (status) => {
        for (const fn of queueStatusListeners) {
            try { fn(status); } catch (e) {}
        }
    });

    socket.on('show-toast-broadcast', (msg) => {
        for (const fn of toastListeners) {
            try { fn(msg, 'info'); } catch (e) {}
        }
    });

    socket.on('error-msg', (msg) => {
        for (const fn of errorListeners) {
            try { fn(msg, 'error'); } catch (e) {}
        }
    });

    socket.on('new-reaction', (emoji) => {
        for (const fn of reactionListeners) {
            try { fn(emoji); } catch (e) {}
        }
    });

    socket.on('new-danmaku', (data) => {
        for (const fn of danmakuListeners) {
            try { fn(data); } catch (e) {}
        }
    });

    socket.on('play-soundboard-fx', (payload) => {
        for (const fn of soundboardListeners) {
            try { fn(payload); } catch (e) {}
        }
    });

    socket.on('nav-state-update', (payload) => {
        if (payload?.navState) {
            updateNavState(payload.navState);
        }
    });

    socket.on('nav-alert-broadcast', (payload) => {
        for (const fn of navAlertListeners) {
            try { fn(payload); } catch (e) {}
        }
    });
}

// ============================================================================
// 3. OUTBOUND EMIT WRAPPERS
// ============================================================================

function ensureSocket() {
    if (!socket) initSocket();
    return socket;
}

/**
 * Register/update client profile on server
 * @param {{ name: string, color: string }} profile
 */
export function emitSetProfile(profile) {
    const s = ensureSocket();
    if (!s || !profile) return;
    s.emit('set-profile', {
        name: typeof profile.name === 'string' ? profile.name.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป',
        color: profile.color || '#ABD2FA',
        avatar: profile.avatar || ''
    });
}

/**
 * Request full server state reconciliation snapshot
 */
export function emitRequestState() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('request-state');
}

/**
 * Enqueue a track URL or search query
 * @param {{ url: string, nickname?: string, color?: string, avatar?: string }} data
 */
export function emitAddToQueue(data) {
    const s = ensureSocket();
    if (!s || !data || !data.url) return;
    const profile = getMyProfile();
    s.emit('add-to-queue', {
        url: data.url.trim(),
        nickname: data.nickname || profile.name || 'ผู้ใช้ทั่วไป',
        color: data.color || profile.color || '#ABD2FA',
        avatar: data.avatar || profile.avatar || ''
    });
}

/**
 * Remove track from queue by ID
 * @param {string} itemId
 */
export function emitRemoveFromQueue(itemId) {
    const s = ensureSocket();
    if (!s || !itemId) return;
    s.emit('remove-from-queue', itemId);
}

/**
 * Clear all tracks in active queue
 */
export function emitClearQueue() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('clear-queue');
}

/**
 * Reorder active queue sequence
 * @param {string[]} queueIds - Array of track item IDs in desired order
 */
export function emitReorderQueue(queueIds) {
    const s = ensureSocket();
    if (!s || !Array.isArray(queueIds)) return;
    s.emit('reorder-queue', { queueIds });
}

/**
 * Move a track up, down, or to a specific target index
 * @param {string} itemId
 * @param {'up' | 'down' | number} directionOrIndex
 */
export function emitMoveTrack(itemId, directionOrIndex) {
    const s = ensureSocket();
    if (!s || !itemId) return;
    if (typeof directionOrIndex === 'string') {
        s.emit('move-track', { itemId, direction: directionOrIndex });
    } else if (typeof directionOrIndex === 'number') {
        s.emit('move-track', { itemId, toIndex: Math.round(directionOrIndex) });
    }
}

/**
 * Control shared playback (Play / Pause)
 * @param {boolean} isPlaying
 */
export function emitPlayControl(isPlaying) {
    const s = ensureSocket();
    if (!s) return;
    s.emit('play-control', Boolean(isPlaying));
}

/**
 * Set party master volume (0 - 100)
 * @param {number} volume
 */
export function emitVolumeControl(volume) {
    const s = ensureSocket();
    if (!s || typeof volume !== 'number') return;
    s.emit('volume-control', Math.max(0, Math.min(100, Math.round(volume))));
}

/**
 * Set video stream quality
 * @param {string} quality
 */
export function emitQualityControl(quality) {
    const s = ensureSocket();
    if (!s || typeof quality !== 'string') return;
    s.emit('quality-control', quality);
}

/**
 * Skip current playing track immediately (Host)
 */
export function emitSkipVideo() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('skip-video');
}

/**
 * Cast or revoke democratic vote to skip track (Passenger)
 */
export function emitVoteSkip() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('vote-skip');
}

/**
 * Report playback progress to synchronize passenger devices (Host only)
 * @param {number} currentTime
 * @param {number} duration
 */
export function emitPlayerProgress(currentTime, duration) {
    const s = ensureSocket();
    if (!s) return;
    s.emit('player-progress', { currentTime, duration });
}

/**
 * Report video completion to trigger next queue item (Host only)
 */
export function emitPlayerVideoEnded() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('player-video-ended');
}

export const emitVideoEnded = emitPlayerVideoEnded;

/**
 * Seek to timestamp across the room
 * @param {number} seconds
 */
export function emitSeekTo(seconds) {
    const s = ensureSocket();
    if (!s || typeof seconds !== 'number' || seconds < 0) return;
    s.emit('seek-to', seconds);
}

/**
 * Configure Auto-DJ continuous party mode
 * @param {{ enabled?: boolean, mode?: string, customQuery?: string, notify?: boolean }} config
 */
export function emitAutoDjConfig(config) {
    const s = ensureSocket();
    if (!s || !config) return;
    s.emit('autodj-config', config);
}

/**
 * Force Auto-DJ to immediately pick and play a track
 * @param {{ mode?: string, customQuery?: string }} [config={}]
 */
export function emitAutoDjPlayNow(config = {}) {
    const s = ensureSocket();
    if (!s) return;
    s.emit('autodj-play-now', config);
}

/**
 * Resolve video playback error (e.g. search alternative clean stream)
 * @param {'find-alt' | 'skip'} action
 */
export function emitResolveErrorAction(action) {
    const s = ensureSocket();
    if (!s || !action) return;
    s.emit('resolve-error-action', action);
}

/**
 * Send floating emoji reaction
 * @param {string} emoji
 */
export function emitSendReaction(emoji) {
    const s = ensureSocket();
    if (!s || typeof emoji !== 'string') return;
    s.emit('send-reaction', emoji);
}

/**
 * Broadcast DJ soundboard effect
 * @param {string} soundId
 * @param {string} [nickname]
 */
export function emitSendSoundboard(soundId, nickname = '') {
    const s = ensureSocket();
    if (!s || typeof soundId !== 'string') return;
    const profile = getMyProfile();
    s.emit('send-soundboard', {
        soundId,
        nickname: nickname || profile.name || 'DJ ในห้อง'
    });
}

/**
 * Toggle between original vocal track and instrumental karaoke track
 */
export function emitToggleKaraokeMode() {
    const s = ensureSocket();
    if (!s) return;
    s.emit('toggle-karaoke-mode');
}

/**
 * Send danmaku text banner with optional Thai TTS voice reading
 * @param {{ text: string, nickname?: string, color?: string, tts?: boolean }} data
 */
export function emitSendDanmaku(data) {
    const s = ensureSocket();
    if (!s || !data || !data.text) return;
    const profile = getMyProfile();
    s.emit('send-danmaku', {
        text: data.text.trim().substring(0, 80),
        nickname: data.nickname || profile.name || 'ผู้ใช้ทั่วไป',
        color: data.color || profile.color || '#ABD2FA',
        tts: Boolean(data.tts)
    });
}

/**
 * Synchronize real-time GPS navigation state across devices
 * @param {object} patch
 */
export function emitSyncNavState(patch) {
    const s = ensureSocket();
    if (!s || !patch) return;
    s.emit('sync-nav-state', patch);
}

export const emitNavStatePatch = emitSyncNavState;

/**
 * Trigger navigational weather or road alert
 * @param {object} alertPayload
 */
export function emitTriggerNavAlert(alertPayload) {
    const s = ensureSocket();
    if (!s || !alertPayload) return;
    s.emit('trigger-nav-alert', alertPayload);
}

// ============================================================================
// 4. CROSS-MODULE EVENT SUBSCRIPTIONS
// ============================================================================

export function onToast(fn) { toastListeners.add(fn); return () => toastListeners.delete(fn); }
export function onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); }
export function onReaction(fn) { reactionListeners.add(fn); return () => reactionListeners.delete(fn); }
export function onDanmaku(fn) { danmakuListeners.add(fn); return () => danmakuListeners.delete(fn); }
export function onSoundboard(fn) { soundboardListeners.add(fn); return () => soundboardListeners.delete(fn); }
export function onSeekVideo(fn) { seekVideoListeners.add(fn); return () => seekVideoListeners.delete(fn); }
export function onNavAlert(fn) { navAlertListeners.add(fn); return () => navAlertListeners.delete(fn); }
export function onQueueStatus(fn) { queueStatusListeners.add(fn); return () => queueStatusListeners.delete(fn); }
export function onTimeUpdate(fn) { timeUpdateListeners.add(fn); return () => timeUpdateListeners.delete(fn); }
export function onInitReceived(fn) { initListeners.add(fn); return () => initListeners.delete(fn); }
