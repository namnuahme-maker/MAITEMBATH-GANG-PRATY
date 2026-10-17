/**
 * MAITEMBATH GANG PARTY - Main Application Bootstrapper (public/js/main.js)
 * 
 * Orchestrates application lifecycle and bootstraps all modular subsystems:
 * 1. State Management & Persistence (state.js)
 * 2. Gesture-based Browser Autoplay Audio Unlock (audio.js)
 * 3. Cinematic 3D Warp Intro & Starfield Canvas (audio.js)
 * 4. User Interface, Controls & Modals (ui.js)
 * 5. Audio / Video Direct Streaming & Synthesizers (audio.js)
 * 6. Queue Management & Drag-and-Drop Reordering (queue.js)
 * 7. Playback History & 1-Click Requeue (history.js)
 * 8. Favorites Drawer & Anthems (favorites.js)
 * 9. Synced Lyrics & Karaoke Engine (lyrics.js)
 * 10. GPS Navigation & Weather Radar (map.js)
 * 11. Socket.IO Real-time Connection & Reconnection (socket.js)
 */

import { getState, getHostMode, onStateChange } from './state.js';
import { initSocket } from './socket.js';
import { initAudio, setupAutoplayUnlock, startIntroSequence } from './audio.js';
import { initUI } from './ui.js';
import { initQueue } from './queue.js';
import { initHistory } from './history.js';
import { initFavorites } from './favorites.js';
import { initLyrics } from './lyrics.js';
import { initMap } from './map.js';

let appBootstrapped = false;

/**
 * Bootstrap all application subsystems in strict order of dependency.
 */
export async function bootstrapApp() {
    if (appBootstrapped) return;
    appBootstrapped = true;

    console.log('[MAITEMBATH] Bootstrapping client architecture...');

    // 1. Global Process Safety & Window Error Traps
    setupGlobalErrorTraps();

    // 2. Gesture-based Browser Autoplay Audio Unlock
    try {
        if (typeof setupAutoplayUnlock === 'function') {
            setupAutoplayUnlock();
        }
    } catch (err) {
        console.warn('[Audio] Autoplay unlock handler error:', err);
    }

    // 3. Cinematic 3D Warp Intro & Starfield Canvas
    try {
        if (typeof startIntroSequence === 'function') {
            startIntroSequence(false);
        }
    } catch (err) {
        console.warn('[Intro] Failed to initialize 3D warp intro:', err);
    }

    // 4. User Interface, Controls & Event Delegation
    try {
        if (typeof initUI === 'function') {
            initUI();
        }
    } catch (err) {
        console.error('[UI] Failed to initialize UI subsystem:', err);
    }

    // 5. Audio & Video Playback Engine
    try {
        if (typeof initAudio === 'function') {
            initAudio();
        }
    } catch (err) {
        console.error('[Audio] Failed to initialize Audio subsystem:', err);
    }

    // 6. Queue System & Visual Reordering
    try {
        if (typeof initQueue === 'function') {
            initQueue();
        }
    } catch (err) {
        console.error('[Queue] Failed to initialize Queue subsystem:', err);
    }

    // 7. Playback History
    try {
        if (typeof initHistory === 'function') {
            initHistory();
        }
    } catch (err) {
        console.error('[History] Failed to initialize History subsystem:', err);
    }

    // 8. Favorites Drawer
    try {
        if (typeof initFavorites === 'function') {
            initFavorites();
        }
    } catch (err) {
        console.error('[Favorites] Failed to initialize Favorites subsystem:', err);
    }

    // 9. Synced Lyrics & Karaoke Wipes
    try {
        if (typeof initLyrics === 'function') {
            initLyrics();
        }
    } catch (err) {
        console.error('[Lyrics] Failed to initialize Lyrics subsystem:', err);
    }

    // 10. GPS Navigation & Weather Radar
    try {
        if (typeof initMap === 'function') {
            initMap();
        }
    } catch (err) {
        console.error('[Map] Failed to initialize Map subsystem:', err);
    }

    // 11. Connect Real-time Socket & State Synchronization
    try {
        initSocket();
    } catch (err) {
        console.error('[Socket] Failed to connect Socket.IO client:', err);
    }

    console.log('[MAITEMBATH] Application successfully bootstrapped.');
}

/**
 * Defensive Window Error Traps to prevent uncaught exceptions from halting UI
 */
function setupGlobalErrorTraps() {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
        // Suppress benign third-party script cross-origin errors (e.g. YouTube Iframe CDN)
        if (event.filename && (event.filename.includes('youtube.com') || event.filename.includes('doubleclick'))) {
            return;
        }
        console.warn('[MAITEMBATH] Global error caught:', event.message, event.filename, event.lineno);
    });

    window.addEventListener('unhandledrejection', (event) => {
        // Suppress autoplay promise rejections
        if (event.reason && String(event.reason).includes('NotAllowedError')) {
            console.warn('[MAITEMBATH] Autoplay deferred until user interaction.');
            event.preventDefault();
            return;
        }
        console.warn('[MAITEMBATH] Unhandled rejection caught:', event.reason);
    });
}

// ============================================================================
// AUTOMATIC DOM READY BOOTSTRAP
// ============================================================================

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapApp, { once: true });
    } else {
        bootstrapApp();
    }
}
