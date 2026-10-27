/**
 * MAITEMBATH GANG PARTY - Playback History Management Module
 * File: public/js/history.js
 * 
 * Responsibilities:
 * - Recently played track log storage (up to 50 tracks in memory and localStorage)
 * - Synchronizes with server-side state.history
 * - History UI panel rendering with relative playback timestamps
 * - Instant 1-click re-queueing (+ คิว)
 * - Seamless integration with favorites bookmarking
 */

import { getState, onStateChange } from './state.js';
import { emitAddToQueue } from './socket.js';
import { showToast, escapeHtml, safeColor } from './ui.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { getTrackThumb, getSourceIconHtml, wouldBeConsecutiveDuplicate } from './queue.js';

const STORAGE_KEY = 'maitembath_track_history';
const MAX_HISTORY_ITEMS = 50;

let localHistory = [];
let lastRecordedVideoId = null;

// --- Load / Save Local History ---
export function loadHistoryFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                localHistory = parsed.slice(0, MAX_HISTORY_ITEMS);
            }
        }
    } catch (_) {
        localHistory = [];
    }
    return localHistory;
}

export function saveHistoryToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localHistory.slice(0, MAX_HISTORY_ITEMS)));
    } catch (_) {}
}

export function getHistory() {
    return [...localHistory];
}

export function clearHistory() {
    localHistory = [];
    saveHistoryToStorage();
    renderHistory();
    showToast('ล้างประวัติการเล่นเรียบร้อยแล้ว', 'info');
}

// --- Record Played Track ---
export function recordPlayedTrack(track) {
    if (!track || !track.videoId) return;
    if (track.videoId === lastRecordedVideoId) return;

    lastRecordedVideoId = track.videoId;

    const historyItem = {
        id: track.id || (Date.now().toString() + Math.random().toString(36).substring(2, 6)),
        videoId: String(track.videoId),
        title: String(track.title || 'Unknown Title'),
        author: String(track.author || 'YouTube'),
        thumbnail: track.thumbnail || getTrackThumb(track),
        url: track.url || `https://www.youtube.com/watch?v=${track.videoId}`,
        source: track.source || 'youtube',
        playedAt: Date.now(),
        addedBy: track.addedBy || 'DJ',
        color: track.color || '#ABD2FA'
    };

    // If same track was top, update playedAt
    if (localHistory.length > 0 && localHistory[0].videoId === historyItem.videoId) {
        localHistory[0].playedAt = historyItem.playedAt;
    } else {
        localHistory.unshift(historyItem);
        if (localHistory.length > MAX_HISTORY_ITEMS) {
            localHistory.length = MAX_HISTORY_ITEMS;
        }
    }

    saveHistoryToStorage();
    renderHistory();
}

// --- Sync with Server History ---
export function syncServerHistory(serverHistory) {
    if (!Array.isArray(serverHistory) || serverHistory.length === 0) return;

    // Merge server history with local history, deduplicating by videoId
    const mergedMap = new Map();

    // Prioritize newest entries
    for (const item of serverHistory) {
        if (item && item.videoId) {
            mergedMap.set(item.videoId, {
                id: item.id || (Date.now().toString() + Math.random().toString(36).substring(2, 6)),
                videoId: item.videoId,
                title: item.title || 'Unknown Title',
                author: item.author || 'YouTube',
                thumbnail: item.thumbnail || getTrackThumb(item),
                url: item.url || `https://www.youtube.com/watch?v=${item.videoId}`,
                source: item.source || 'youtube',
                playedAt: item.playedAt || Date.now(),
                addedBy: item.addedBy || 'DJ',
                color: item.color || '#ABD2FA'
            });
        }
    }

    for (const item of localHistory) {
        if (item && item.videoId && !mergedMap.has(item.videoId)) {
            mergedMap.set(item.videoId, item);
        }
    }

    localHistory = Array.from(mergedMap.values())
        .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
        .slice(0, MAX_HISTORY_ITEMS);

    saveHistoryToStorage();
    renderHistory();
}

// --- Relative Time Formatter ---
function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'เมื่อสักครู่';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// --- 1-Click Re-Queue Action ---
export function requeueTrack(track) {
    if (!track) return;
    if (track.videoId && wouldBeConsecutiveDuplicate(track.videoId)) {
        showToast('ห้ามเล่นเพลงซ้ำติดต่อกัน 2 รอบ (กรุณารอให้มีเพลงอื่นเล่นคั่นก่อน)', 'warn');
        return;
    }
    const state = getState();
    const profile = state.myProfile || {
        name: localStorage.getItem('nickname') || 'ผู้ใช้ทั่วไป',
        color: localStorage.getItem('usercolor') || '#ABD2FA'
    };

    const targetUrl = track.url || `https://www.youtube.com/watch?v=${track.videoId}`;

    emitAddToQueue({
        url: targetUrl,
        nickname: profile.name || 'ผู้ใช้ทั่วไป',
        color: safeColor(profile.color)
    });

    showToast(`เพิ่ม "${track.title}" กลับเข้าคิวแล้ว 🎵`, 'info');
}

// --- Render History UI ---
export function renderHistory(containerElement = null) {
    const container = containerElement || document.getElementById('history-list');
    if (!container) return;

    if (localHistory.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 px-3 space-y-1 text-brand-light/40 animate-fade-in-up">
                <i class="fa-solid fa-clock-rotate-left text-2xl text-brand-peri/30 mb-1"></i>
                <p class="text-xs font-medium">ยังไม่มีประวัติเพลงที่เล่น</p>
                <p class="text-[10px] text-brand-light/30">เพลงที่เล่นจบหรือถูกข้ามจะถูกบันทึกไว้ที่นี่</p>
            </div>
        `;
        return;
    }

    container.innerHTML = localHistory.map((item, index) => {
        const thumbUrl = item.thumbnail || getTrackThumb(item);
        const isFav = isFavorite(item.videoId);
        const relTime = formatRelativeTime(item.playedAt);

        return `
        <div data-history-card="${escapeHtml(item.id)}" data-video-id="${escapeHtml(item.videoId)}" class="flex items-center gap-2.5 p-2.5 bg-white/[0.025] hover:bg-white/[0.06] rounded-2xl border border-white/[0.05] hover:border-cyan-400/30 transition-all duration-200 group">
            <span class="text-[10px] text-slate-500 w-3.5 text-center font-mono shrink-0 font-medium">${index + 1}</span>
            
            <!-- Thumbnail -->
            <div class="relative w-12 h-8 rounded-xl overflow-hidden bg-black/80 border border-white/10 shrink-0 shadow-sm pointer-events-none">
                <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" class="w-full h-full object-cover thumb-img group-hover:scale-110 transition-transform duration-300" onload="this.classList.add('loaded')">
            </div>

            <!-- Title & Metadata -->
            <div class="flex-1 min-w-0 pointer-events-none">
                <p class="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors duration-200 truncate">${escapeHtml(item.title)}</p>
                <div class="flex items-center gap-2 mt-0.5 text-[9px] text-slate-400">
                    <span class="truncate">${getSourceIconHtml(item)}${escapeHtml(item.author || '')}</span>
                    <span class="text-white/20">•</span>
                    <span class="shrink-0 text-cyan-400/70 font-mono">${relTime}</span>
                </div>
            </div>

            <!-- Action: Favorite Heart Toggle -->
            <button type="button" data-fav-history-id="${escapeHtml(item.videoId)}" class="w-7 h-7 rounded-full hover:bg-pink-500/20 text-slate-400 hover:text-pink-400 transition-all flex items-center justify-center shrink-0 active:scale-90" title="${isFav ? 'ลบออกจากเพลงโปรด' : 'บันทึกเป็นเพลงโปรด'}">
                <i class="${isFav ? 'fa-solid fa-heart text-pink-500 scale-105' : 'fa-regular fa-heart text-xs'} pointer-events-none"></i>
            </button>

            <!-- Action: 1-Click Re-Queue Button -->
            <button type="button" data-requeue-btn="${escapeHtml(item.videoId)}" class="h-7 px-2.5 rounded-full bg-cyan-400/15 hover:bg-cyan-400 hover:text-black text-cyan-300 text-[10px] font-bold border border-cyan-400/30 transition-all duration-200 flex items-center gap-1 shrink-0 active:scale-95 shadow-sm" title="เพิ่มเพลงนี้เข้าคิวอีกครั้ง">
                <i class="fa-solid fa-plus text-[9px] pointer-events-none"></i>
                <span class="pointer-events-none">+ คิว</span>
            </button>
        </div>
        `;
    }).join('');
}

// --- Wire Event Handlers & Progressive Enhancement UI ---
export function initHistoryUI() {
    loadHistoryFromStorage();

    // Check if History section/tab exists in DOM; if not, wire click delegation on dynamic containers
    document.addEventListener('click', (e) => {
        // 1. Re-Queue Button Click
        const requeueBtn = e.target.closest('[data-requeue-btn]');
        if (requeueBtn) {
            const videoId = requeueBtn.getAttribute('data-requeue-btn');
            const item = localHistory.find(h => h.videoId === videoId);
            if (item) {
                requeueTrack(item);
                // Visual feedback: button pulse/checkmark
                const originalHtml = requeueBtn.innerHTML;
                requeueBtn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i>';
                setTimeout(() => { requeueBtn.innerHTML = originalHtml; }, 1200);
            }
            return;
        }

        // 2. Favorite Toggle in History
        const favBtn = e.target.closest('[data-fav-history-id]');
        if (favBtn) {
            const videoId = favBtn.getAttribute('data-fav-history-id');
            const item = localHistory.find(h => h.videoId === videoId);
            if (item) {
                toggleFavorite(item);
                const isNowFav = isFavorite(videoId);
                const icon = favBtn.querySelector('i');
                if (icon) {
                    icon.className = isNowFav ? 'fa-solid fa-heart text-pink-500 scale-105 pointer-events-none' : 'fa-regular fa-heart text-xs pointer-events-none';
                }
            }
            return;
        }

        // 3. Clear History Button
        if (e.target.closest('[data-clear-history-btn]')) {
            if (confirm('ล้างประวัติการเล่นเพลงทั้งหมดหรือไม่?')) {
                clearHistory();
            }
            return;
        }
    });

    // Reactive State Subscriptions
    onStateChange((state) => {
        // Track transition detection
        if (state.currentVideo && state.currentVideo.videoId) {
            recordPlayedTrack(state.currentVideo);
        }
        // Server history sync
        if (Array.isArray(state.history) && state.history.length > 0) {
            syncServerHistory(state.history);
        }
    });

    renderHistory();
}

// Dual alias for main bootstrapping compatibility
export const initHistory = initHistoryUI;
