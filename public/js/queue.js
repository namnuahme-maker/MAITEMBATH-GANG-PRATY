/**
 * MAITEMBATH GANG PARTY - Queue Management Module (public/js/queue.js)
 * 
 * Responsibilities:
 * - Queue rendering into #queue-list with optimistic diffing
 * - Visual reordering via HTML5 Drag-and-Drop
 * - Mobile touch drag handles for bumpy car rides
 * - Host accessibility up/down move buttons
 * - Queue actions: add song (#url-input, #add-btn), remove item with slide-out, clear queue
 * - Host 2-tap skip confirmation (#btn-skip) and passenger vote-skip (#btn-vote-skip)
 * - Real-time queue count badges (#q-count, #q-count-mobile, #mobile-queue-badge)
 */

import { getState, onStateChange } from './state.js';
import { 
    getSocket, 
    emitAddToQueue, 
    emitRemoveFromQueue, 
    emitClearQueue, 
    emitSkipVideo, 
    emitVoteSkip, 
    emitReorderQueue, 
    emitMoveTrack 
} from './socket.js';
import { showToast, escapeHtml, safeColor, triggerPartyPulse } from './ui.js';
import { isFavorite, toggleFavorite } from './favorites.js';

// DOM selector helper
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

let queueList = null;
let qCount = null;
let qCountMobile = null;
let mobileQueueBadge = null;
let urlInput = null;
let addBtn = null;
let addBtnIcon = null;
let clearBtn = null;
let btnSkip = null;
let skipLabel = null;
let btnVoteSkip = null;
let voteSkipCount = null;
let voteSkipLabel = null;

// --- Internal State ---
let lastQueueSignature = null;
let knownQueueIds = new Set();
let skipCount = 0;
let skipTimer = null;
let currentVoteSkipState = null;

// Drag & Drop State
let draggedItemId = null;
let dragOverItemId = null;

// Touch Drag State (Mobile)
let touchDragActive = false;
let touchDraggedElement = null;
let touchStartY = 0;
let touchCurrentTargetId = null;

// --- Helper Functions ---
export function getYoutubeThumb(videoId) {
    if (!videoId) return '';
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

export function getTrackThumb(item) {
    if (!item) return '';
    if (item.thumbnail && /^https?:\/\//i.test(item.thumbnail)) {
        return item.thumbnail;
    }
    return getYoutubeThumb(item.videoId);
}

export function getSourceIconHtml(item) {
    if (item && item.source === 'spotify') {
        return '<i class="fa-brands fa-spotify text-[#1DB954] mr-1" title="จาก Spotify"></i>';
    }
    if (item && (item.source === 'autodj' || item.isAutoDj)) {
        return '<i class="fa-solid fa-wand-magic-sparkles text-purple-400 mr-1" title="สุ่มอัตโนมัติโดย Auto-DJ"></i>';
    }
    return '<i class="fa-brands fa-youtube text-red-500 mr-1" title="จาก YouTube"></i>';
}

const AUTO_DJ_MODE_LABELS = {
    khlerm: '🌙 เคลิ้มๆ ลอยๆ',
    similar: '🎯 ตามเพลงล่าสุด',
    indie_thai: '🎸 อินดี้/ป๊อปไทยฮิต',
    acoustic_cafe: '☕ อะคูสติกฟังสบาย',
    party_dance: '🔥 สายตี้แดนซ์มันส์ๆ',
    retro_90s: '📼 ย้อนยุค 90s-2000s',
    inter_chill: '🌎 สากลเคลิ้มๆ',
    lukthung_party: '🍻 ลูกทุ่งสายม่วน'
};

export function getAutoDjModeShortLabel(mode, customQuery) {
    if (customQuery && customQuery.trim()) {
        return `✨ ${customQuery.trim()}`;
    }
    return AUTO_DJ_MODE_LABELS[mode] || AUTO_DJ_MODE_LABELS.khlerm;
}

// --- Queue Renderer ---
export function renderQueue(queue, autoDjState = {}) {
    if (!queueList) queueList = $('queue-list');
    if (!qCount) qCount = $('q-count');
    if (!qCountMobile) qCountMobile = $('q-count-mobile');
    if (!mobileQueueBadge) mobileQueueBadge = $('mobile-queue-badge');

    if (!queueList) return;

    const queueLength = Array.isArray(queue) ? queue.length : 0;

    // Update count badges
    if (qCount) qCount.textContent = queueLength;
    if (qCountMobile) qCountMobile.textContent = queueLength;
    if (mobileQueueBadge) {
        mobileQueueBadge.textContent = queueLength;
        mobileQueueBadge.classList.toggle('hidden', queueLength === 0);
    }

    const autoDjSig = `${Boolean(autoDjState.enabled)}:${autoDjState.mode || 'khlerm'}:${autoDjState.customQuery || ''}`;
    const currentSignature = queueLength > 0
        ? queue.map(i => `${i.id}:${i.videoId}:${i.title}`).join('|')
        : `EMPTY:${autoDjSig}`;

    if (currentSignature === lastQueueSignature) return;

    if (queueLength === 0) {
        if (autoDjState.enabled !== false) {
            const modeLabel = getAutoDjModeShortLabel(autoDjState.mode, autoDjState.customQuery);
            queueList.innerHTML = `
                <div class="text-center py-4 px-2 space-y-2 animate-fade-in-up">
                    <p class="text-[11px] text-slate-400">คิวว่างเปล่า — ระบบจะสุ่มเพลงเล่นต่ออัตโนมัติ</p>
                    <button type="button" data-open-autodj-settings="1" class="text-[11px] text-purple-200 bg-gradient-to-r from-purple-950/80 via-fuchsia-950/70 to-indigo-950/80 hover:brightness-125 border border-purple-500/40 rounded-full py-1.5 px-4 inline-flex items-center gap-2 transition cursor-pointer shadow-[0_0_16px_rgba(168,85,247,0.3)] active:scale-95" title="คลิกเพื่อเปลี่ยนโหมด Auto-DJ ในเมนูตั้งค่า">
                        <i class="fa-solid fa-wand-magic-sparkles text-pink-400 animate-pulse"></i>
                        <span>Auto-DJ: <strong class="text-white bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">${escapeHtml(modeLabel)}</strong></span>
                        <i class="fa-solid fa-sliders text-[9px] text-purple-300/80 ml-0.5"></i>
                    </button>
                </div>
            `;
        } else {
            queueList.innerHTML = `<p class="text-center text-[11px] text-slate-500 py-4 animate-fade-in-up">คิวว่างเปล่า (ปิด Auto-DJ อยู่)</p>`;
        }
        knownQueueIds.clear();
    } else {
        const nextKnownIds = new Set();
        queueList.innerHTML = queue.map((item, index) => {
            const isNew = !knownQueueIds.has(item.id);
            nextKnownIds.add(item.id);
            const delayMs = isNew ? Math.min(index * 45, 250) : 0;
            const animClass = isNew ? 'animate-fade-in-up' : '';
            const thumbUrl = getTrackThumb(item);
            const isFav = isFavorite(item.videoId);

            // D2. Party Pulse when new songs are queued (after initial load)
            if (isNew && knownQueueIds.size > 0) {
                triggerPartyPulse(`${item.addedBy || 'เพื่อน'} เพิ่มเพลงแล้ว 🔥`);
            }

            // D3. Queue Momentum Badges: 🔥 ถัดไป on top track, ⚡ ยอดนิยม on favorites
            const momentumBadge = index === 0 
                ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[9px] font-bold shrink-0">🔥 ถัดไป</span>`
                : (isFav ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-medium shrink-0">⚡ ยอดนิยม</span>` : '');

            return `
            <div 
                data-queue-card="${escapeHtml(item.id)}" 
                data-item-id="${escapeHtml(item.id)}"
                data-index="${index}"
                draggable="true"
                style="animation-delay: ${delayMs}ms" 
                class="queue-item-card flex items-center gap-2.5 p-2.5 bg-[var(--genesis-surface,#FFFFFF)] hover:bg-[var(--genesis-surface-subtle,#F4F4F6)] rounded-[12px] border border-[var(--genesis-border,#E8E8EC)] transition-all duration-200 group relative select-none ${animClass}"
            >
                <!-- Drag Grip Handle (Mobile & Touch) -->
                <div class="touch-grip-handle cursor-grab active:cursor-grabbing text-[var(--genesis-text-muted,#9C9C9C)] hover:text-[var(--genesis-primary,#6366F1)] p-1 shrink-0 flex items-center justify-center touch-none transition-colors" title="ลากเพื่อเปลี่ยนลำดับคิว">
                    <i class="fa-solid fa-grip-vertical text-xs pointer-events-none"></i>
                </div>

                <!-- Index -->
                <span class="text-[11px] text-[var(--genesis-text-muted,#9C9C9C)] w-3.5 text-center font-mono shrink-0 font-medium">${index + 1}</span>

                <!-- Artwork Thumbnail (Genesis 8px radius) -->
                <div class="relative w-14 h-9 rounded-[8px] overflow-hidden bg-black/80 border border-[var(--genesis-border,#E8E8EC)] shrink-0 shadow-sm pointer-events-none">
                    <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" class="w-full h-full object-cover thumb-img group-hover:scale-110 transition-transform duration-300" onload="this.classList.add('loaded')">
                    <div class="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-300"></div>
                </div>

                <!-- Title & Added-by -->
                <div class="flex-1 min-w-0 pointer-events-none">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <p class="text-xs font-semibold text-[var(--genesis-text-primary,#0A0A0A)] group-hover:text-[var(--genesis-primary,#6366F1)] transition-colors duration-200 truncate">${escapeHtml(item.title)}</p>
                        ${momentumBadge}
                    </div>
                    <p class="text-[10px] text-[var(--genesis-text-secondary,#6B6B6B)] truncate mt-0.5 flex items-center gap-1">${getSourceIconHtml(item)}<span>เพิ่มโดย:</span>${item.avatar ? `<img src="${escapeHtml(item.avatar)}" class="w-3.5 h-3.5 rounded-full object-cover border border-[var(--genesis-border,#E8E8EC)] shrink-0 inline-block">` : `<span class="w-1.5 h-1.5 rounded-full inline-block shrink-0" style="background-color:${safeColor(item.color)}"></span>`}<span style="color:${safeColor(item.color)}" class="font-medium">${escapeHtml(item.addedBy)}</span></p>
                </div>

                <!-- Host / Accessibility Fallback Move Buttons (Genesis 6px radius) -->
                <div class="move-btn-group flex md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity duration-200 items-center gap-1 shrink-0">
                    <button type="button" data-move-id="${escapeHtml(item.id)}" data-move-dir="up" class="w-6 h-6 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] hover:bg-[var(--genesis-primary,#6366F1)] hover:text-white focus:bg-[var(--genesis-primary,#6366F1)] focus:text-white text-[var(--genesis-text-secondary,#6B6B6B)] border border-[var(--genesis-border,#E8E8EC)] text-[9px] flex items-center justify-center transition active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title="เลื่อนขึ้น (ลำดับ ${index + 1})" aria-label="เลื่อนขึ้น ลำดับที่ ${index + 1}">
                        <i class="fa-solid fa-chevron-up pointer-events-none"></i>
                    </button>
                    <button type="button" data-move-id="${escapeHtml(item.id)}" data-move-dir="down" class="w-6 h-6 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] hover:bg-[var(--genesis-primary,#6366F1)] hover:text-white focus:bg-[var(--genesis-primary,#6366F1)] focus:text-white text-[var(--genesis-text-secondary,#6B6B6B)] border border-[var(--genesis-border,#E8E8EC)] text-[9px] flex items-center justify-center transition active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title="เลื่อนลง (ลำดับ ${index + 1})" aria-label="เลื่อนลง ลำดับที่ ${index + 1}">
                        <i class="fa-solid fa-chevron-down pointer-events-none"></i>
                    </button>
                </div>

                <!-- Favorite Heart Button (Genesis 6px radius) -->
                <button type="button" data-fav-toggle-id="${escapeHtml(item.videoId)}" data-fav-title="${escapeHtml(item.title)}" data-fav-author="${escapeHtml(item.author || '')}" data-fav-thumb="${escapeHtml(thumbUrl)}" class="fav-item-btn w-7 h-7 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] hover:bg-pink-500/15 border border-[var(--genesis-border,#E8E8EC)] hover:border-pink-500/40 text-pink-500 transition-all flex items-center justify-center shrink-0 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-400" title="${isFav ? 'ลบออกจากเพลงโปรด' : 'บันทึกเป็นเพลงโปรด'}" aria-label="${isFav ? 'ลบออกจากเพลงโปรด' : 'บันทึกเป็นเพลงโปรด'}">
                    <i class="${isFav ? 'fa-solid fa-heart text-pink-500 scale-105' : 'fa-regular fa-heart text-[11px]'} pointer-events-none"></i>
                </button>

                <!-- Delete Button (Genesis 6px radius destructive) -->
                <button type="button" data-remove-id="${escapeHtml(item.id)}" class="w-7 h-7 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] hover:bg-red-500/15 text-[var(--genesis-error,#EF4444)] border border-[var(--genesis-border,#E8E8EC)] hover:border-red-500/40 transition-all duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 flex items-center justify-center shrink-0 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400" title="ลบออกจากคิว" aria-label="ลบเพลงออกจากคิว">
                    <i class="fa-solid fa-trash text-[10px] pointer-events-none"></i>
                </button>
            </div>
            `;
        }).join('');
        knownQueueIds = nextKnownIds;
    }
    lastQueueSignature = currentSignature;
}

// --- HTML5 Drag-and-Drop & Mobile Touch Reordering ---
function setupReorderListeners() {
    if (!queueList) queueList = $('queue-list');
    if (!queueList) return;

    // Desktop HTML5 Drag & Drop
    queueList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-queue-card]');
        if (!card) return;
        draggedItemId = card.getAttribute('data-item-id');
        card.classList.add('opacity-40', 'scale-[0.98]', 'border-brand-peri');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedItemId);
        }
    });

    queueList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const overCard = e.target.closest('[data-queue-card]');
        if (!overCard || overCard.getAttribute('data-item-id') === draggedItemId) return;

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }

        const rect = overCard.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
            overCard.classList.add('border-t-2', 'border-t-brand-peri');
            overCard.classList.remove('border-b-2', 'border-b-brand-peri');
        } else {
            overCard.classList.add('border-b-2', 'border-b-brand-peri');
            overCard.classList.remove('border-t-2', 'border-t-brand-peri');
        }
    });

    queueList.addEventListener('dragleave', (e) => {
        const card = e.target.closest('[data-queue-card]');
        if (card) {
            card.classList.remove('border-t-2', 'border-b-2', 'border-t-brand-peri', 'border-b-brand-peri');
        }
    });

    queueList.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropCard = e.target.closest('[data-queue-card]');
        if (!dropCard || !draggedItemId) return;

        const targetId = dropCard.getAttribute('data-item-id');
        dropCard.classList.remove('border-t-2', 'border-b-2', 'border-t-brand-peri', 'border-b-brand-peri');

        if (draggedItemId === targetId) return;

        const state = getState();
        const currentQueue = Array.isArray(state.queue) ? [...state.queue] : [];
        const fromIdx = currentQueue.findIndex(i => i.id === draggedItemId);
        const toIdx = currentQueue.findIndex(i => i.id === targetId);

        if (fromIdx === -1 || toIdx === -1) return;

        const [movedItem] = currentQueue.splice(fromIdx, 1);
        currentQueue.splice(toIdx, 0, movedItem);

        // Optimistic render
        renderQueue(currentQueue, {
            enabled: state.autoDjEnabled,
            mode: state.autoDjMode,
            customQuery: state.autoDjCustomQuery
        });

        // Broadcast to server
        emitReorderQueue(currentQueue.map(i => i.id));
        showToast('จัดลำดับคิวเพลงเรียบร้อย 🎶', 'info');
    });

    queueList.addEventListener('dragend', (e) => {
        const card = e.target.closest('[data-queue-card]');
        if (card) {
            card.classList.remove('opacity-40', 'scale-[0.98]', 'border-brand-peri');
        }
        document.querySelectorAll('[data-queue-card]').forEach(el => {
            el.classList.remove('border-t-2', 'border-b-2', 'border-t-brand-peri', 'border-b-brand-peri');
        });
        draggedItemId = null;
    });

    // Mobile Touch Grip Reordering
    queueList.addEventListener('touchstart', (e) => {
        const grip = e.target.closest('.touch-grip-handle');
        if (!grip) return;
        const card = grip.closest('[data-queue-card]');
        if (!card) return;

        touchDragActive = true;
        touchDraggedElement = card;
        touchStartY = e.touches[0].clientY;
        draggedItemId = card.getAttribute('data-item-id');

        card.classList.add('bg-brand-deep/80', 'border-brand-peri', 'shadow-lg');
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
    }, { passive: true });

    queueList.addEventListener('touchmove', (e) => {
        if (!touchDragActive || !touchDraggedElement) return;
        const touchY = e.touches[0].clientY;
        const elementUnderTouch = document.elementFromPoint(e.touches[0].clientX, touchY);
        const overCard = elementUnderTouch?.closest('[data-queue-card]');

        document.querySelectorAll('[data-queue-card]').forEach(el => {
            if (el !== touchDraggedElement) {
                el.classList.remove('border-t-2', 'border-b-2', 'border-t-brand-peri', 'border-b-brand-peri');
            }
        });

        if (overCard && overCard !== touchDraggedElement) {
            touchCurrentTargetId = overCard.getAttribute('data-item-id');
            const rect = overCard.getBoundingClientRect();
            if (touchY < rect.top + rect.height / 2) {
                overCard.classList.add('border-t-2', 'border-t-brand-peri');
            } else {
                overCard.classList.add('border-b-2', 'border-b-brand-peri');
            }
        }
    }, { passive: true });

    queueList.addEventListener('touchend', () => {
        if (!touchDragActive || !touchDraggedElement) return;
        touchDraggedElement.classList.remove('bg-brand-deep/80', 'border-brand-peri', 'shadow-lg');

        document.querySelectorAll('[data-queue-card]').forEach(el => {
            el.classList.remove('border-t-2', 'border-b-2', 'border-t-brand-peri', 'border-b-brand-peri');
        });

        if (draggedItemId && touchCurrentTargetId && draggedItemId !== touchCurrentTargetId) {
            const state = getState();
            const currentQueue = Array.isArray(state.queue) ? [...state.queue] : [];
            const fromIdx = currentQueue.findIndex(i => i.id === draggedItemId);
            const toIdx = currentQueue.findIndex(i => i.id === touchCurrentTargetId);

            if (fromIdx !== -1 && toIdx !== -1) {
                const [movedItem] = currentQueue.splice(fromIdx, 1);
                currentQueue.splice(toIdx, 0, movedItem);

                renderQueue(currentQueue, {
                    enabled: state.autoDjEnabled,
                    mode: state.autoDjMode,
                    customQuery: state.autoDjCustomQuery
                });

                emitReorderQueue(currentQueue.map(i => i.id));
                showToast('จัดลำดับคิวเพลงเรียบร้อย 🎶', 'info');
            }
        }

        touchDragActive = false;
        touchDraggedElement = null;
        draggedItemId = null;
        touchCurrentTargetId = null;
    });
}

// --- Vote Skip Renderer ---
export function renderVoteSkip(vs) {
    if (!vs) return;
    currentVoteSkipState = vs;

    if (!voteSkipCount) voteSkipCount = $('vote-skip-count');
    if (!btnVoteSkip) btnVoteSkip = $('btn-vote-skip');
    if (!voteSkipLabel) voteSkipLabel = $('vote-skip-label');

    if (voteSkipCount) {
        voteSkipCount.textContent = `${vs.current || 0}/${vs.required || 1}`;
    }

    if (btnVoteSkip) {
        const socket = getSocket();
        const hasVoted = Boolean(vs.voters && socket?.id && vs.voters.includes(socket.id));
        btnVoteSkip.disabled = !vs.active;

        if (hasVoted) {
            btnVoteSkip.className = 'h-9 px-3.5 rounded-full bg-indigo-600 text-white border border-indigo-500 flex items-center gap-1.5 transition-all active:scale-95 shadow-sm';
            btnVoteSkip.title = 'คลิกเพื่อยกเลิกการโหวตข้าม';
            if (voteSkipLabel) {
                voteSkipLabel.textContent = 'ยกเลิกโหวต';
                voteSkipLabel.className = 'sr-only';
            }
        } else {
            btnVoteSkip.className = 'h-9 px-3.5 rounded-full bg-[var(--genesis-surface-subtle,#F4F4F6)] hover:bg-[var(--genesis-surface,#FFFFFF)] text-[var(--genesis-text-primary,#0A0A0A)] border border-[var(--genesis-border,#E8E8EC)] hover:border-indigo-400 text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-sm';
            btnVoteSkip.title = 'โหวตข้ามเพลง (เมื่อครบ >50% เพลงจะเปลี่ยนทันที)';
            if (voteSkipLabel) {
                voteSkipLabel.textContent = 'โหวตข้าม';
                voteSkipLabel.className = 'sr-only';
            }
        }
    }
}

export function updateSkipButtonState(queueLength, hasCurrentVideo) {
    if (!btnSkip) btnSkip = $('btn-skip');
    if (!btnSkip || skipCount > 0) return;
    const canSkip = Boolean(hasCurrentVideo || queueLength > 0);
    if (!canSkip) {
        btnSkip.classList.add('opacity-40', 'cursor-not-allowed');
        btnSkip.title = 'ไม่มีเพลงในคิวหรือเพลงกำลังเล่นให้ข้าม';
        btnSkip.setAttribute('aria-disabled', 'true');
    } else {
        btnSkip.classList.remove('opacity-40', 'cursor-not-allowed');
        btnSkip.title = 'กด 3 ครั้งเพื่อข้ามเพลง';
        btnSkip.removeAttribute('aria-disabled');
    }
}

export function resetSkipBtn() {
    skipCount = 0;
    clearTimeout(skipTimer);
    if (!btnSkip) btnSkip = $('btn-skip');
    if (!btnSkip) return;

    btnSkip.className = "h-11 min-h-[44px] px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.12] hover:border-violet-400/60 text-xs font-semibold flex items-center gap-2 transition-all duration-200 active:scale-95 shadow-sm cursor-pointer select-none group";
    btnSkip.title = 'กด 3 ครั้งเพื่อข้ามเพลง';

    const dot1 = $('skip-dot-1');
    const dot2 = $('skip-dot-2');
    const dot3 = $('skip-dot-3');
    const label = $('skip-label');

    if (label) label.textContent = 'ข้ามเพลง';
    if (dot1) dot1.className = 'w-1.5 h-1.5 rounded-full bg-white/20 transition-all duration-200';
    if (dot2) dot2.className = 'w-1.5 h-1.5 rounded-full bg-white/20 transition-all duration-200';
    if (dot3) dot3.className = 'w-1.5 h-1.5 rounded-full bg-white/20 transition-all duration-200';

    const state = getState();
    const qLen = Array.isArray(state?.queue) ? state.queue.length : 0;
    updateSkipButtonState(qLen, Boolean(state?.currentVideo));
}

// --- Wire Event Handlers ---
export function initQueueUI() {
    queueList = $('queue-list');
    qCount = $('q-count');
    qCountMobile = $('q-count-mobile');
    mobileQueueBadge = $('mobile-queue-badge');
    urlInput = $('url-input');
    addBtn = $('add-btn');
    addBtnIcon = $('add-btn-icon');
    clearBtn = $('clear-btn');
    btnSkip = $('btn-skip');
    skipLabel = $('skip-label');
    btnVoteSkip = $('btn-vote-skip');
    voteSkipCount = $('vote-skip-count');
    voteSkipLabel = $('vote-skip-label');

    setupReorderListeners();

function extractYoutubeId(url) {
    if (!url || typeof url !== 'string') return null;
    const str = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

export function wouldBeConsecutiveDuplicate(videoId) {
    if (!videoId || typeof videoId !== 'string') return false;
    const state = getState();
    if (Array.isArray(state.queue) && state.queue.length > 0) {
        const lastItem = state.queue[state.queue.length - 1];
        if (lastItem && lastItem.videoId === videoId) return true;
    }
    return false;
}

    // 1. Add Song Action
    const handleAddSong = () => {
        if (!urlInput) return;
        const val = urlInput.value.trim();
        if (!val) {
            return showToast('กรุณาวางลิงก์ YouTube, Spotify หรือพิมพ์ชื่อเพลง', 'error');
        }

        const directId = extractYoutubeId(val);
        if (directId && wouldBeConsecutiveDuplicate(directId)) {
            return showToast('ห้ามเล่นเพลงซ้ำติดต่อกัน 2 รอบ (กรุณารอให้มีเพลงอื่นเล่นคั่นก่อน)', 'warn');
        }

        const state = getState();
        const profile = state.myProfile || {
            name: 'ผู้ใช้ทั่วไป',
            color: '#ABD2FA'
        };

        emitAddToQueue({
            url: val,
            nickname: profile.name || 'ผู้ใช้ทั่วไป',
            color: safeColor(profile.color)
        });

        urlInput.value = '';
    };

    if (addBtn) addBtn.addEventListener('click', handleAddSong);
    if (urlInput) {
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAddSong();
        });
    }

    // 2. Queue Click Delegation (Delete, Move Up/Down, Favorite, Auto-DJ settings)
    if (queueList) {
        queueList.addEventListener('click', (e) => {
            if (e.target.closest('[data-open-autodj-settings]')) {
                const settingsBtn = $('header-settings-btn') || $('edit-profile-btn');
                settingsBtn?.click();
                return;
            }

            const removeBtn = e.target.closest('[data-remove-id]');
            if (removeBtn) {
                const id = removeBtn.getAttribute('data-remove-id');
                if (!id) return;
                const card = removeBtn.closest('[data-queue-card]');
                if (card) {
                    card.classList.remove('animate-fade-in-up');
                    card.classList.add('animate-fade-out-slide');
                    setTimeout(() => emitRemoveFromQueue(id), 240);
                } else {
                    emitRemoveFromQueue(id);
                }
                return;
            }

            const moveBtn = e.target.closest('[data-move-id]');
            if (moveBtn) {
                const id = moveBtn.getAttribute('data-move-id');
                const dir = moveBtn.getAttribute('data-move-dir');
                if (id && (dir === 'up' || dir === 'down')) {
                    emitMoveTrack(id, dir);
                }
                return;
            }

            const favBtn = e.target.closest('[data-fav-toggle-id]');
            if (favBtn) {
                const videoId = favBtn.getAttribute('data-fav-toggle-id');
                const title = favBtn.getAttribute('data-fav-title');
                const author = favBtn.getAttribute('data-fav-author');
                const thumbnail = favBtn.getAttribute('data-fav-thumb');

                toggleFavorite({ videoId, title, author, thumbnail });
                const icon = favBtn.querySelector('i');
                if (icon) {
                    const isNowFav = isFavorite(videoId);
                    icon.className = isNowFav ? 'fa-solid fa-heart text-pink-500 scale-105 pointer-events-none' : 'fa-regular fa-heart text-[11px] pointer-events-none';
                }
            }
        });
    }

    // 3. Clear Queue Action with Safe Instant Undo Recovery
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const state = getState();
            const currentQueue = Array.isArray(state.queue) ? [...state.queue] : [];
            if (currentQueue.length === 0) {
                return showToast('ไม่มีเพลงในคิวให้ล้าง', 'info');
            }

            const backedUpQueue = [...currentQueue];
            emitClearQueue();

            showToast(`ล้างคิวเพลงแล้ว (${backedUpQueue.length} เพลง)`, 'info', {
                label: '↩ กู้คืนคิว (Undo)',
                onClick: () => {
                    backedUpQueue.forEach((item, index) => {
                        setTimeout(() => {
                            emitAddToQueue({
                                url: `https://www.youtube.com/watch?v=${item.videoId}`,
                                nickname: item.addedBy || 'ผู้ใช้',
                                color: safeColor(item.color)
                            });
                        }, index * 80);
                    });
                    showToast(`กู้คืน ${backedUpQueue.length} เพลงกลับเข้าคิวแล้ว 🎶`, 'success');
                }
            });
        });
    }

    // 4. Universal 3-Tap Direct Skip Action (For Host & Passengers)
    if (btnSkip) {
        btnSkip.addEventListener('click', () => {
            const state = getState();
            const qLen = Array.isArray(state?.queue) ? state.queue.length : 0;
            if (!state?.currentVideo && qLen === 0) {
                return showToast('ไม่มีเพลงที่กำลังเล่นหรือในคิวให้ข้าม', 'info');
            }

            skipCount++;
            clearTimeout(skipTimer);

            const dot1 = $('skip-dot-1');
            const dot2 = $('skip-dot-2');
            const dot3 = $('skip-dot-3');
            const label = $('skip-label');

            if (skipCount === 1) {
                btnSkip.className = "h-11 min-h-[44px] px-4 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/70 text-xs font-semibold flex items-center gap-2 transition-all duration-200 active:scale-95 shadow-[0_0_15px_rgba(251,191,36,0.25)] cursor-pointer select-none group";
                if (label) label.textContent = "กดอีก 2 ครั้ง";
                if (dot1) dot1.className = "w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] transition-all duration-200";
                if (dot2) dot2.className = "w-1.5 h-1.5 rounded-full bg-white/30 transition-all duration-200";
                if (dot3) dot3.className = "w-1.5 h-1.5 rounded-full bg-white/30 transition-all duration-200";
                btnSkip.title = "กดอีก 2 ครั้งเพื่อข้ามเพลง";
                showToast('แตะอีก 2 ครั้งเพื่อข้ามเพลง ⏭️ (1/3)', 'info', { duration: 1800 });
                skipTimer = setTimeout(resetSkipBtn, 2500);
            } else if (skipCount === 2) {
                btnSkip.className = "h-11 min-h-[44px] px-4 rounded-full bg-orange-500/25 text-orange-200 border border-orange-500/80 text-xs font-bold flex items-center gap-2 transition-all duration-200 active:scale-95 shadow-[0_0_18px_rgba(249,115,22,0.35)] cursor-pointer select-none group animate-pulse";
                if (label) label.textContent = "กดอีก 1 ครั้ง!";
                if (dot1) dot1.className = "w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] transition-all duration-200";
                if (dot2) dot2.className = "w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(249,115,22,1)] transition-all duration-200";
                if (dot3) dot3.className = "w-1.5 h-1.5 rounded-full bg-white/40 transition-all duration-200";
                btnSkip.title = "กดอีก 1 ครั้งเพื่อข้ามเพลงทันที!";
                showToast('แตะอีก 1 ครั้งเพื่อข้ามเพลงทันที! ⏭️ (2/3)', 'warn', { duration: 1800 });
                skipTimer = setTimeout(resetSkipBtn, 2500);
            } else {
                // 3rd Tap: Trigger Skip!
                btnSkip.className = "h-11 min-h-[44px] px-4 rounded-full bg-emerald-500/25 text-emerald-200 border border-emerald-400 text-xs font-bold flex items-center gap-2 transition-all duration-200 active:scale-95 shadow-[0_0_20px_rgba(52,211,153,0.4)] cursor-pointer select-none group";
                if (label) label.textContent = "กำลังข้าม... ⏭️";
                if (dot1) dot1.className = "w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] transition-all duration-200";
                if (dot2) dot2.className = "w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] transition-all duration-200";
                if (dot3) dot3.className = "w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] transition-all duration-200";

                emitSkipVideo();
                showToast('กำลังข้ามไปยังเพลงถัดไป ⏭️', 'info');
                setTimeout(resetSkipBtn, 600);
            }
        });
    }

    // 5. Vote Skip Action
    if (btnVoteSkip) {
        btnVoteSkip.addEventListener('click', () => {
            const state = getState();
            if (!state.currentVideo) {
                return showToast('ยังไม่มีเพลงกำลังเล่น', 'info');
            }
            emitVoteSkip();
        });
    }

    // Reactive State Subscriptions
    onStateChange((state) => {
        const qLen = Array.isArray(state?.queue) ? state.queue.length : 0;
        renderQueue(state.queue, {
            enabled: state.autoDjEnabled,
            mode: state.autoDjMode,
            customQuery: state.autoDjCustomQuery
        });
        updateSkipButtonState(qLen, Boolean(state?.currentVideo));
        if (state.voteSkipState) {
            renderVoteSkip(state.voteSkipState);
        }
    });

    const initialState = getState();
    const initQLen = Array.isArray(initialState?.queue) ? initialState.queue.length : 0;
    renderQueue(initialState.queue, {
        enabled: initialState.autoDjEnabled,
        mode: initialState.autoDjMode,
        customQuery: initialState.autoDjCustomQuery
    });
    updateSkipButtonState(initQLen, Boolean(initialState?.currentVideo));
    if (initialState.voteSkipState) {
        renderVoteSkip(initialState.voteSkipState);
    }
}

export const initQueue = initQueueUI;
