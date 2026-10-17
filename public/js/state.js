/**
 * MAITEMBATH GANG PARTY - State Module (public/js/state.js)
 * 
 * Single source of truth for all client-side state:
 * - Synchronized party playback state (queue, history, currentVideo, volume, etc.)
 * - Room users and democratic vote-to-skip state
 * - GPS navigation & weather radar state
 * - Local profile, favorites, device mode, and connection status
 * - Reactive listener bus with fine-grained subscription capabilities
 */

// ============================================================================
// 1. DATA SANITIZATION & SECURITY HELPERS
// ============================================================================

/**
 * HTML escape helper to prevent XSS injection in titles, nicknames, and chat.
 * @param {string} str - Raw string
 * @returns {string} Sanitized HTML-safe string
 */
export function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    if (typeof document !== 'undefined') {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Validates and normalizes hex color code or returns fallback brand color.
 * @param {string} c - Color string
 * @returns {string} Normalized #RRGGBB
 */
export function safeColor(c) {
    return (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c)) ? c : '#ABD2FA';
}

/**
 * Format seconds into MM:SS or HH:MM:SS string.
 * @param {number} sec - Seconds
 * @returns {string}
 */
export function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const remSec = s % 60;
    const secStr = remSec < 10 ? `0${remSec}` : `${remSec}`;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const remMin = m % 60;
        const minStr = remMin < 10 ? `0${remMin}` : `${remMin}`;
        return `${h}:${minStr}:${secStr}`;
    }
    return `${m}:${secStr}`;
}

// ============================================================================
// 2. LOCAL STORAGE PERSISTENCE HELPERS
// ============================================================================

const STORAGE_KEYS = {
    NICKNAME: 'nickname',
    USER_COLOR: 'usercolor',
    USER_AVATAR: 'useravatar',
    HOST_MODE: 'host',
    FAVORITES: 'maitembath_favorites',
    LOCAL_HISTORY: 'maitembath_track_history'
};

function readStorageJson(key, fallback = []) {
    if (typeof localStorage === 'undefined') return fallback;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
        return fallback;
    }
}

function writeStorageJson(key, data) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (_) {}
}

// ============================================================================
// 3. INTERNAL STATE STORAGE
// ============================================================================

const isBrowser = typeof window !== 'undefined';
const isMobileClient = isBrowser ? window.innerWidth < 768 : false;

/**
 * Central State Object
 */
const state = {
    // Synchronized party playback state (mirrored from server)
    queue: [],
    history: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 50,
    quality: 'max',
    autoDjEnabled: true,
    autoDjMode: 'khlerm',
    autoDjCustomQuery: '',

    // Connected room users: { [socketId]: { name, color } }
    connectedUsers: {},

    // Democratic vote skip state: { current, required, hasVoted }
    voteSkipState: { current: 0, required: 1, hasVoted: false },

    // Real-time GPS navigation & weather radar sync
    navState: {
        origin: '',
        destination: '',
        route: null,
        weather: null,
        updatedAt: 0
    },

    // Server connection & join metadata
    serverInfo: {
        localIp: '',
        port: 3000,
        joinUrl: '',
        qrDataUrl: ''
    },

    // Client-specific device & user settings
    myProfile: {
        name: (isBrowser && localStorage.getItem(STORAGE_KEYS.NICKNAME)) || '',
        color: safeColor(isBrowser && localStorage.getItem(STORAGE_KEYS.USER_COLOR)),
        avatar: (isBrowser && localStorage.getItem(STORAGE_KEYS.USER_AVATAR)) || ''
    },
    hostMode: isBrowser && localStorage.getItem(STORAGE_KEYS.HOST_MODE) !== null
        ? localStorage.getItem(STORAGE_KEYS.HOST_MODE) === 'true'
        : !isMobileClient,
    isMobile: isMobileClient,
    connectionStatus: 'connecting', // 'connected' | 'disconnected' | 'connecting'

    // Local client persistence stores
    favorites: readStorageJson(STORAGE_KEYS.FAVORITES, []),
    localHistory: readStorageJson(STORAGE_KEYS.LOCAL_HISTORY, [])
};

// ============================================================================
// 4. REACTIVE LISTENER BUS
// ============================================================================

const stateListeners = new Set();
const usersListeners = new Set();
const voteSkipListeners = new Set();
const navListeners = new Set();
const connectionListeners = new Set();
const historyListeners = new Set();
const favoritesListeners = new Set();

/**
 * Subscribe to state updates.
 * @param {Function} callback - Signature: (state, changedKeys) => void
 * @returns {Function} Unsubscribe function
 */
export function onStateChange(callback) {
    if (typeof callback !== 'function') return () => {};
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
}

/**
 * Notify all state listeners with list of changed keys.
 * @param {string[]} [changedKeys=[]]
 */
export function notifyStateChange(changedKeys = []) {
    for (const listener of stateListeners) {
        try {
            listener(state, changedKeys);
        } catch (err) {
            console.error('[StateBus] Error in state listener:', err);
        }
    }
}

/**
 * Subscribe to connected users updates.
 * @param {Function} callback - Signature: (users) => void
 * @returns {Function} Unsubscribe function
 */
export function onUsersChange(callback) {
    if (typeof callback !== 'function') return () => {};
    usersListeners.add(callback);
    return () => usersListeners.delete(callback);
}

export function notifyUsersChange() {
    for (const listener of usersListeners) {
        try {
            listener(state.connectedUsers);
        } catch (err) {
            console.error('[StateBus] Error in users listener:', err);
        }
    }
}

/**
 * Subscribe to vote skip updates.
 * @param {Function} callback - Signature: (voteSkipState) => void
 * @returns {Function} Unsubscribe function
 */
export function onVoteSkipChange(callback) {
    if (typeof callback !== 'function') return () => {};
    voteSkipListeners.add(callback);
    return () => voteSkipListeners.delete(callback);
}

export function notifyVoteSkipChange() {
    for (const listener of voteSkipListeners) {
        try {
            listener(state.voteSkipState);
        } catch (err) {
            console.error('[StateBus] Error in voteSkip listener:', err);
        }
    }
}

/**
 * Subscribe to GPS navigation updates.
 * @param {Function} callback - Signature: (navState) => void
 * @returns {Function} Unsubscribe function
 */
export function onNavStateChange(callback) {
    if (typeof callback !== 'function') return () => {};
    navListeners.add(callback);
    return () => navListeners.delete(callback);
}

export function notifyNavStateChange() {
    for (const listener of navListeners) {
        try {
            listener(state.navState);
        } catch (err) {
            console.error('[StateBus] Error in navState listener:', err);
        }
    }
}

/**
 * Subscribe to connection status changes.
 * @param {Function} callback - Signature: (status) => void
 * @returns {Function} Unsubscribe function
 */
export function onConnectionChange(callback) {
    if (typeof callback !== 'function') return () => {};
    connectionListeners.add(callback);
    return () => connectionListeners.delete(callback);
}

export function notifyConnectionChange() {
    for (const listener of connectionListeners) {
        try {
            listener(state.connectionStatus);
        } catch (err) {
            console.error('[StateBus] Error in connection listener:', err);
        }
    }
}

/**
 * Subscribe to history changes.
 * @param {Function} callback - Signature: (history) => void
 * @returns {Function} Unsubscribe function
 */
export function onHistoryChange(callback) {
    if (typeof callback !== 'function') return () => {};
    historyListeners.add(callback);
    return () => historyListeners.delete(callback);
}

export function notifyHistoryChange() {
    for (const listener of historyListeners) {
        try {
            listener(state.history, state.localHistory);
        } catch (err) {
            console.error('[StateBus] Error in history listener:', err);
        }
    }
}

/**
 * Subscribe to favorites changes.
 * @param {Function} callback - Signature: (favorites) => void
 * @returns {Function} Unsubscribe function
 */
export function onFavoritesChange(callback) {
    if (typeof callback !== 'function') return () => {};
    favoritesListeners.add(callback);
    return () => favoritesListeners.delete(callback);
}

export function notifyFavoritesChange() {
    for (const listener of favoritesListeners) {
        try {
            listener(state.favorites);
        } catch (err) {
            console.error('[StateBus] Error in favorites listener:', err);
        }
    }
}

// ============================================================================
// 5. GETTERS & SETTERS
// ============================================================================

/**
 * Get current state object snapshot.
 * @returns {typeof state}
 */
export function getState() {
    return state;
}

/**
 * Deep/shallow update state with partial object and trigger reactive listeners.
 * @param {Partial<typeof state>} partial
 * @param {boolean} [silent=false]
 */
export function updateState(partial, silent = false) {
    if (!partial || typeof partial !== 'object') return;
    const changedKeys = [];

    for (const key of Object.keys(partial)) {
        if (state[key] !== partial[key]) {
            state[key] = partial[key];
            changedKeys.push(key);
        }
    }

    if (changedKeys.includes('history')) {
        notifyHistoryChange();
    }

    if (!silent && changedKeys.length > 0) {
        notifyStateChange(changedKeys);
    }
}

/**
 * Access individual state slices directly
 */
export function getQueue() { return state.queue; }
export function getCurrentVideo() { return state.currentVideo; }
export function getPlaybackHistory() { return state.history; }
export function getIsPlaying() { return state.isPlaying; }
export function getVolume() { return state.volume; }
export function getQuality() { return state.quality; }

/**
 * Profile Management
 */
export function getMyProfile() {
    return { ...state.myProfile };
}

export function setMyProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    const name = typeof profile.name === 'string' ? profile.name.trim().substring(0, 25) : state.myProfile.name;
    const color = safeColor(profile.color || state.myProfile.color);
    const avatar = typeof profile.avatar === 'string' ? profile.avatar : (state.myProfile.avatar || '');

    state.myProfile = { name, color, avatar };
    if (isBrowser) {
        localStorage.setItem(STORAGE_KEYS.NICKNAME, name);
        localStorage.setItem(STORAGE_KEYS.USER_COLOR, color);
        if (avatar) localStorage.setItem(STORAGE_KEYS.USER_AVATAR, avatar);
        else localStorage.removeItem(STORAGE_KEYS.USER_AVATAR);
    }
    notifyStateChange(['myProfile']);
}

/**
 * Host Mode Management
 */
export function getHostMode() {
    return state.hostMode;
}

export const isHostMode = getHostMode;

export function setHostMode(isHost) {
    const val = Boolean(isHost);
    if (state.hostMode === val) return;
    state.hostMode = val;
    if (isBrowser) {
        localStorage.setItem(STORAGE_KEYS.HOST_MODE, String(val));
    }
    notifyStateChange(['hostMode']);
}

/**
 * Connected Users Management
 */
export function getConnectedUsers() {
    return state.connectedUsers;
}

export function updateConnectedUsers(users) {
    if (!users || typeof users !== 'object') return;
    state.connectedUsers = { ...users };
    notifyUsersChange();
}

/**
 * Vote-to-Skip Management
 */
export function getVoteSkipState() {
    return state.voteSkipState;
}

export function updateVoteSkipState(vs) {
    if (!vs || typeof vs !== 'object') return;
    state.voteSkipState = { ...vs };
    notifyVoteSkipChange();
}

/**
 * Nav State Management
 */
export function getNavState() {
    return state.navState;
}

export function updateNavState(nav) {
    if (!nav || typeof nav !== 'object') return;
    state.navState = { ...state.navState, ...nav };
    notifyNavStateChange();
}

/**
 * Server Metadata Management
 */
export function getServerInfo() {
    return state.serverInfo;
}

export function updateServerInfo(info) {
    if (!info || typeof info !== 'object') return;
    state.serverInfo = { ...state.serverInfo, ...info };
    notifyStateChange(['serverInfo']);
}

/**
 * Connection Status Management
 */
export function getConnectionStatus() {
    return state.connectionStatus;
}

export function setConnectionStatus(status) {
    if (state.connectionStatus === status) return;
    state.connectionStatus = status;
    notifyConnectionChange();
}

// ============================================================================
// 6. FAVORITES DRAWER & BOOKMARK STORE
// ============================================================================

export function getFavorites() {
    return [...state.favorites];
}

export function isFavorite(videoId) {
    if (!videoId) return false;
    return state.favorites.some(f => f.videoId === String(videoId));
}

export function addFavorite(track) {
    if (!track || !track.videoId) return false;
    const vid = String(track.videoId);
    if (isFavorite(vid)) return true;

    const item = {
        id: track.id || `fav_${Date.now()}`,
        videoId: vid,
        title: track.title || 'Untitled Track',
        author: track.author || 'YouTube',
        thumbnail: track.thumbnail || null,
        url: track.url || `https://www.youtube.com/watch?v=${vid}`,
        source: track.source || 'youtube',
        savedAt: Date.now()
    };

    state.favorites.unshift(item);
    if (state.favorites.length > 100) state.favorites.pop(); // Cap at 100 bookmarks
    writeStorageJson(STORAGE_KEYS.FAVORITES, state.favorites);
    notifyFavoritesChange();
    notifyStateChange(['favorites']);
    return true;
}

export function removeFavorite(videoId) {
    if (!videoId) return false;
    const vid = String(videoId);
    const initialLen = state.favorites.length;
    state.favorites = state.favorites.filter(f => f.videoId !== vid);
    if (state.favorites.length !== initialLen) {
        writeStorageJson(STORAGE_KEYS.FAVORITES, state.favorites);
        notifyFavoritesChange();
        notifyStateChange(['favorites']);
        return true;
    }
    return false;
}

export function toggleFavorite(track) {
    if (!track || !track.videoId) return false;
    const vid = String(track.videoId);
    if (isFavorite(vid)) {
        removeFavorite(vid);
        return false;
    } else {
        addFavorite(track);
        return true;
    }
}

// ============================================================================
// 7. LOCAL PLAYBACK HISTORY LOG
// ============================================================================

export function getLocalHistory() {
    return [...state.localHistory];
}

export function addLocalHistory(track) {
    if (!track || !track.videoId) return;
    const vid = String(track.videoId);
    const item = {
        id: track.id || `hist_${Date.now()}`,
        videoId: vid,
        title: track.title || 'Untitled Track',
        author: track.author || 'YouTube',
        thumbnail: track.thumbnail || null,
        url: track.url || `https://www.youtube.com/watch?v=${vid}`,
        source: track.source || 'youtube',
        playedAt: Date.now(),
        addedBy: track.addedBy || 'ผู้ใช้ทั่วไป'
    };

    // Remove duplicates if already in local history
    state.localHistory = state.localHistory.filter(h => h.videoId !== vid);
    state.localHistory.unshift(item);
    if (state.localHistory.length > 50) state.localHistory.pop(); // Rolling 50 tracks
    writeStorageJson(STORAGE_KEYS.LOCAL_HISTORY, state.localHistory);
    notifyHistoryChange();
    notifyStateChange(['localHistory']);
}
