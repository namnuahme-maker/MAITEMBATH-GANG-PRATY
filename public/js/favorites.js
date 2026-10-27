/**
 * MAITEMBATH GANG PARTY - Favorites Management Module
 * File: public/js/favorites.js
 * 
 * Responsibilities:
 * - Favorites store backed by localStorage (maitembath_favorites)
 * - Heart button triggers on Now Playing card, queue items, and history tracks
 * - Slide-out drawer / modal rendering with search filter
 * - Instant 1-click enqueuing to the active party queue
 */

import { getState, onStateChange } from './state.js';
import { emitAddToQueue } from './socket.js';
import { showToast, escapeHtml, safeColor } from './ui.js';
import { wouldBeConsecutiveDuplicate } from './queue.js';

const STORAGE_KEY = 'maitembath_favorites';

let favorites = [];

// --- Load / Save Local Favorites ---
export function loadFavoritesFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                favorites = parsed;
            }
        }
    } catch (_) {
        favorites = [];
    }
    return favorites;
}

export function saveFavoritesToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch (_) {}
}

export function getFavorites() {
    return [...favorites];
}

export function isFavorite(videoId) {
    if (!videoId) return false;
    return favorites.some(f => f.videoId === String(videoId));
}

export function addFavorite(track) {
    if (!track || !track.videoId) return false;
    const vid = String(track.videoId);
    if (isFavorite(vid)) return false;

    const favItem = {
        videoId: vid,
        title: String(track.title || 'Unknown Title'),
        author: String(track.author || 'YouTube'),
        thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
        url: track.url || `https://www.youtube.com/watch?v=${vid}`,
        source: track.source || 'youtube',
        addedAt: Date.now()
    };

    favorites.unshift(favItem);
    saveFavoritesToStorage();
    updateAllFavoriteIcons(vid, true);
    renderFavoritesDrawer();
    showToast(`บันทึก "${favItem.title}" ในเพลงโปรดแล้ว ❤️`, 'info');
    return true;
}

export function removeFavorite(videoId) {
    if (!videoId) return false;
    const vid = String(videoId);
    const initialLen = favorites.length;
    favorites = favorites.filter(f => f.videoId !== vid);
    if (favorites.length !== initialLen) {
        saveFavoritesToStorage();
        updateAllFavoriteIcons(vid, false);
        renderFavoritesDrawer();
        showToast('ลบออกจากเพลงโปรดแล้ว', 'info');
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

export function clearFavorites() {
    favorites = [];
    saveFavoritesToStorage();
    updateAllFavoriteIcons(null, false);
    renderFavoritesDrawer();
    showToast('ล้างรายการเพลงโปรดเรียบร้อย', 'info');
}

// --- Sync All Heart Icons in DOM ---
export function updateAllFavoriteIcons(targetVideoId = null, isFav = false) {
    // 1. Now Playing card heart button
    const nowFavBtn = document.getElementById('btn-now-fav');
    if (nowFavBtn) {
        const state = getState();
        const currId = state.currentVideo?.videoId;
        const currentIsFav = isFavorite(currId);
        nowFavBtn.innerHTML = currentIsFav
            ? '<i class="fa-solid fa-heart text-pink-500 scale-110 pointer-events-none"></i>'
            : '<i class="fa-regular fa-heart text-brand-light/50 hover:text-pink-400 pointer-events-none"></i>';
        nowFavBtn.title = currentIsFav ? 'ลบออกจากเพลงโปรด' : 'บันทึกเป็นเพลงโปรด';
    }

    // 2. Queue & History heart icons
    const selector = targetVideoId 
        ? `[data-fav-toggle-id="${targetVideoId}"], [data-fav-history-id="${targetVideoId}"]`
        : '[data-fav-toggle-id], [data-fav-history-id]';

    document.querySelectorAll(selector).forEach(btn => {
        const vid = btn.getAttribute('data-fav-toggle-id') || btn.getAttribute('data-fav-history-id');
        const favStatus = isFavorite(vid);
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = favStatus
                ? 'fa-solid fa-heart text-pink-500 scale-105 pointer-events-none'
                : 'fa-regular fa-heart text-brand-light/40 hover:text-pink-400 pointer-events-none';
        }
        btn.title = favStatus ? 'ลบออกจากเพลงโปรด' : 'บันทึกเป็นเพลงโปรด';
    });
}

// --- Favorites Drawer / Modal UI ---
let favoritesDrawer = null;

export function openFavoritesDrawer() {
    if (!favoritesDrawer) initFavoritesDrawerDOM();
    if (!favoritesDrawer) return;

    renderFavoritesDrawer();
    favoritesDrawer.classList.remove('hidden');
    void favoritesDrawer.offsetWidth;
    favoritesDrawer.classList.add('opacity-100');
    const panel = favoritesDrawer.querySelector('.drawer-panel');
    if (panel) {
        panel.classList.remove('translate-x-full');
    }
}

export function closeFavoritesDrawer() {
    if (!favoritesDrawer) return;
    const panel = favoritesDrawer.querySelector('.drawer-panel');
    if (panel) {
        panel.classList.add('translate-x-full');
    }
    favoritesDrawer.classList.remove('opacity-100');
    setTimeout(() => {
        favoritesDrawer.classList.add('hidden');
    }, 280);
}

function initFavoritesDrawerDOM() {
    let existing = document.getElementById('favorites-drawer');
    if (existing) {
        favoritesDrawer = existing;
        return;
    }

    // Create drawer overlay and append to body
    const drawer = document.createElement('div');
    drawer.id = 'favorites-drawer';
    drawer.className = 'fixed inset-0 z-[600] hidden bg-black/80 backdrop-blur-md transition-opacity duration-300 flex justify-end';
    drawer.innerHTML = `
        <div class="drawer-panel w-full sm:w-96 max-w-full h-full bg-[#050505] border-l border-white/10 shadow-2xl flex flex-col transform translate-x-full transition-transform duration-300 ease-out">
            <!-- Header -->
            <div class="p-4 bg-black/90 border-b border-white/[0.08] flex items-center justify-between shrink-0">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-full bg-pink-500/15 border border-pink-500/30 text-pink-400 flex items-center justify-center text-xs shadow-sm">
                        <i class="fa-solid fa-heart"></i>
                    </span>
                    <div>
                        <h3 class="text-xs font-bold text-white leading-tight">เพลงโปรดประจำแก๊ง</h3>
                        <p class="text-[10px] text-slate-400">บันทึกไว้เปิดในทริป (<span id="fav-count-badge" class="text-pink-300 font-mono">${favorites.length}</span>)</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" id="btn-clear-favorites" class="text-[10px] text-rose-400/70 hover:text-rose-400 px-2.5 py-1 rounded-full hover:bg-rose-500/10 transition" title="ล้างทั้งหมด">
                        ล้างทั้งหมด
                    </button>
                    <button type="button" id="btn-close-favorites" class="w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center text-xs transition active:scale-95">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Search input -->
            <div class="p-3 border-b border-white/[0.06] bg-black/50 shrink-0">
                <div class="relative flex items-center">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 text-slate-500 text-xs pointer-events-none"></i>
                    <input type="text" id="fav-search-input" placeholder="ค้นหาในเพลงโปรด..." class="w-full bg-white/[0.04] border border-white/[0.08] focus:border-cyan-400/50 rounded-full pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none transition">
                </div>
            </div>

            <!-- Scrollable Track List -->
            <div id="favorites-list-container" class="flex-1 overflow-y-auto p-3 space-y-2">
                <!-- Rendered dynamically -->
            </div>
        </div>
    `;

    document.body.appendChild(drawer);
    favoritesDrawer = drawer;

    // Close on backdrop click
    drawer.addEventListener('click', (e) => {
        if (e.target === drawer) closeFavoritesDrawer();
    });

    const closeBtn = drawer.querySelector('#btn-close-favorites');
    if (closeBtn) closeBtn.addEventListener('click', closeFavoritesDrawer);

    const clearBtn = drawer.querySelector('#btn-clear-favorites');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('ต้องการล้างรายการเพลงโปรดทั้งหมดหรือไม่?')) {
                clearFavorites();
            }
        });
    }

    const searchInput = drawer.querySelector('#fav-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            renderFavoritesDrawer(query);
        });
    }
}

export function renderFavoritesDrawer(filterQuery = '') {
    if (!favoritesDrawer) return;
    const container = favoritesDrawer.querySelector('#favorites-list-container');
    const badge = favoritesDrawer.querySelector('#fav-count-badge');
    if (badge) badge.textContent = favorites.length;
    if (!container) return;

    let items = favorites;
    if (filterQuery) {
        items = items.filter(f => 
            (f.title && f.title.toLowerCase().includes(filterQuery)) ||
            (f.author && f.author.toLowerCase().includes(filterQuery))
        );
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 px-4 space-y-2 text-brand-light/40 animate-fade-in-up">
                <i class="fa-solid fa-heart-crack text-3xl text-pink-500/30 mb-1"></i>
                <p class="text-xs font-medium text-brand-light/60">
                    ${filterQuery ? 'ไม่พบเพลงโปรดที่ค้นหา' : 'ยังไม่มีเพลงโปรด'}
                </p>
                <p class="text-[10px] text-brand-light/30 max-w-xs mx-auto">
                    ${filterQuery ? 'ลองค้นหาด้วยคำอื่น' : 'กดปุ่ม ❤️ ที่เพลงกำลังเล่นหรือในคิว เพื่อบันทึกเป็นเพลงประจำแก๊ง!'}
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map((item, index) => {
        const thumbUrl = item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;

        return `
        <div data-fav-item="${escapeHtml(item.videoId)}" class="flex items-center gap-2.5 p-2.5 bg-white/[0.025] hover:bg-white/[0.06] rounded-2xl border border-white/[0.05] hover:border-cyan-400/30 transition-all duration-200 group">
            <span class="text-[10px] text-slate-500 w-3.5 text-center font-mono shrink-0 font-medium">${index + 1}</span>

            <!-- Thumbnail -->
            <div class="relative w-12 h-8 rounded-xl overflow-hidden bg-black/80 border border-white/10 shrink-0 shadow-sm pointer-events-none">
                <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" class="w-full h-full object-cover thumb-img group-hover:scale-110 transition-transform duration-300" onload="this.classList.add('loaded')">
            </div>

            <!-- Title & Author -->
            <div class="flex-1 min-w-0 pointer-events-none">
                <p class="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors duration-200 truncate">${escapeHtml(item.title)}</p>
                <p class="text-[9px] text-slate-400 truncate mt-0.5">${escapeHtml(item.author || 'YouTube')}</p>
            </div>

            <!-- Action: Enqueue -->
            <button type="button" data-enqueue-fav="${escapeHtml(item.videoId)}" class="h-7 px-2.5 rounded-full bg-cyan-400/15 hover:bg-cyan-400 hover:text-black text-cyan-300 text-[10px] font-bold border border-cyan-400/30 transition-all duration-200 flex items-center gap-1 shrink-0 active:scale-95 shadow-sm" title="เพิ่มเพลงนี้เข้าคิว">
                <i class="fa-solid fa-plus text-[9px] pointer-events-none"></i>
                <span class="pointer-events-none">+ คิว</span>
            </button>

            <!-- Action: Remove -->
            <button type="button" data-remove-fav="${escapeHtml(item.videoId)}" class="w-7 h-7 rounded-full hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all flex items-center justify-center shrink-0 active:scale-90" title="ลบออกจากเพลงโปรด">
                <i class="fa-solid fa-trash-can text-[10px] pointer-events-none"></i>
            </button>
        </div>
        `;
    }).join('');
}

// --- Wire Event Handlers ---
export function initFavoritesUI() {
    loadFavoritesFromStorage();
    initFavoritesDrawerDOM();

    // Check if Now Playing card has heart button; if not, inject it
    const nowTextBox = document.getElementById('now-text-box');
    if (nowTextBox && !document.getElementById('btn-now-fav')) {
        const topRow = nowTextBox.querySelector('.flex.items-center.justify-between') || nowTextBox;
        const heartBtn = document.createElement('button');
        heartBtn.type = 'button';
        heartBtn.className = 'w-7 h-7 rounded-lg bg-pink-500/15 hover:bg-pink-500/30 border border-pink-500/40 hover:border-pink-500/70 text-pink-400 hover:text-pink-300 shadow-[0_0_10px_rgba(244,114,182,0.25)] flex items-center justify-center text-xs transition active:scale-95 ml-1 shrink-0';
        heartBtn.title = 'บันทึกเป็นเพลงโปรด';
        heartBtn.innerHTML = '<i class="fa-regular fa-heart pointer-events-none"></i>';

        heartBtn.addEventListener('click', () => {
            const state = getState();
            if (!state.currentVideo || !state.currentVideo.videoId) {
                return showToast('ยังไม่มีเพลงกำลังเล่น', 'info');
            }
            toggleFavorite(state.currentVideo);
            updateAllFavoriteIcons(state.currentVideo.videoId, isFavorite(state.currentVideo.videoId));
        });

        topRow.appendChild(heartBtn);
    }

    // Add Favorites Trigger Button to Main Header or Controls if absent
    if (!document.getElementById('btn-open-favorites')) {
        const headerIcons = document.querySelector('header .flex.items-center.gap-2') || document.getElementById('player-corner-controls');
        if (headerIcons) {
            const openFavBtn = document.createElement('button');
            openFavBtn.type = 'button';
            openFavBtn.id = 'btn-open-favorites';
            openFavBtn.className = 'text-[10px] px-2 py-1 rounded-md bg-[#160d1b] hover:bg-pink-950/60 border border-pink-500/35 text-pink-300 transition flex items-center gap-1 active:scale-95';
            openFavBtn.title = 'เปิดคลังเพลงโปรด';
            openFavBtn.innerHTML = '<i class="fa-solid fa-heart text-pink-400"></i> <span class="hidden sm:inline">เพลงโปรด</span>';
            openFavBtn.addEventListener('click', openFavoritesDrawer);
            headerIcons.prepend(openFavBtn);
        }
    }

    // Click delegation for drawer actions
    document.addEventListener('click', (e) => {
        // Enqueue from favorites drawer
        const enqueueBtn = e.target.closest('[data-enqueue-fav]');
        if (enqueueBtn) {
            const vid = enqueueBtn.getAttribute('data-enqueue-fav');
            if (vid && wouldBeConsecutiveDuplicate(vid)) {
                showToast('ห้ามเล่นเพลงซ้ำติดต่อกัน 2 รอบ (กรุณารอให้มีเพลงอื่นเล่นคั่นก่อน)', 'warn');
                return;
            }
            const item = favorites.find(f => f.videoId === vid);
            if (item) {
                const state = getState();
                const profile = state.myProfile || {
                    name: localStorage.getItem('nickname') || 'ผู้ใช้ทั่วไป',
                    color: localStorage.getItem('usercolor') || '#ABD2FA'
                };
                emitAddToQueue({
                    url: item.url || `https://www.youtube.com/watch?v=${vid}`,
                    nickname: profile.name || 'ผู้ใช้ทั่วไป',
                    color: safeColor(profile.color)
                });
                showToast(`เพิ่ม "${item.title}" เข้าคิวแล้ว 🎵`, 'info');

                const originalHtml = enqueueBtn.innerHTML;
                enqueueBtn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i>';
                setTimeout(() => { enqueueBtn.innerHTML = originalHtml; }, 1000);
            }
            return;
        }

        // Remove from favorites drawer
        const removeBtn = e.target.closest('[data-remove-fav]');
        if (removeBtn) {
            const vid = removeBtn.getAttribute('data-remove-fav');
            removeFavorite(vid);
            return;
        }
    });

    // Reactive State Subscriptions
    onStateChange((state) => {
        if (state.currentVideo && state.currentVideo.videoId) {
            updateAllFavoriteIcons(state.currentVideo.videoId, isFavorite(state.currentVideo.videoId));
        }
    });

    updateAllFavoriteIcons();
}

// Dual alias for main bootstrapping compatibility
export const initFavorites = initFavoritesUI;
