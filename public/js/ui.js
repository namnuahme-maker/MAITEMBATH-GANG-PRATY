/**
 * MAITEMBATH GANG PARTY - UI & DOM Controller Module
 * File: public/js/ui.js
 * 
 * Responsibilities:
 * - DOM element caching & safe utilities (escapeHtml, safeColor, formatTime)
 * - Now Playing card rendering, ambient thumbnail glow, and animated waveforms
 * - Universal transport controls: play/pause, volume slider/steps, progress click-seek, quality picker
 * - Toast notification manager with auto-dismissal
 * - Floating emoji reactions and flying danmaku comments with TTS trigger
 * - Mobile remote 3-tab navigation and desktop layout adapter
 * - Host vs Client mode UI state manager
 * - In-car idle auto-fade controller (3s timeout, modal/input exemption)
 * - QR code party link generator with dynamic width scaling
 * - Settings modal, profile customization, Auto-DJ config, and 5-tap secret test lab
 */

import { getState, setMyProfile, onStateChange, onConnectionChange, isHostMode } from './state.js';
import { 
    getSocket,
    emitPlayControl, 
    emitVolumeControl, 
    emitQualityControl, 
    emitSeekTo, 
    emitSendReaction, 
    emitSendDanmaku,
    emitSetProfile,
    emitAutoDjConfig,
    emitAutoDjPlayNow,
    emitTriggerNavAlert,
    emitSyncNavState
} from './socket.js';
import { getTrackThumb, getSourceIconHtml } from './queue.js';
import { playSoftAlertChime, speakThaiText, startIntroSequence, seekHostPlayer, getPlayerDuration, getPrecisePlaybackTime } from './audio.js';
import { AVATAR_PRESETS, resizeImageToAvatarDataUrl, getAvatarInitial } from './avatars.js';

// --- Safe Utility Functions ---
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

export function safeColor(c) {
    return (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c)) ? c : '#6366F1';
}

// --- Genesis Theme Controller ---
export function applyGenesisTheme(theme) {
    const isDark = theme === 'dark';
    if (typeof document !== 'undefined') {
        if (isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.documentElement.classList.remove('dark');
        }
        const icon = $('theme-toggle-icon');
        if (icon) {
            icon.className = isDark ? 'fa-solid fa-sun text-amber-400 text-xs' : 'fa-solid fa-moon text-indigo-500 text-xs';
        }
        const toggleBtn = $('theme-toggle-btn');
        if (toggleBtn) {
            toggleBtn.title = isDark ? 'สลับเป็นธีมสว่าง (Genesis Light)' : 'สลับเป็นธีมมืด (Genesis Dark)';
        }
    }
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem('genesis_theme', theme);
        } catch (_) {}
    }
}

export function initGenesisTheme() {
    let savedTheme = 'dark';
    if (typeof localStorage !== 'undefined') {
        try {
            savedTheme = localStorage.getItem('genesis_theme') || 'dark';
        } catch (_) {}
    }
    applyGenesisTheme(savedTheme);

    const toggleBtn = $('theme-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyGenesisTheme(nextTheme);
            showToast(nextTheme === 'dark' ? 'เปลี่ยนเป็นธีม Genesis Dark 🌙' : 'เปลี่ยนเป็นธีม Genesis Light ☀️', 'info');
        });
    }
}

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

export const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// --- Toast Notifications ---
export function showToast(msg, type = 'info', action = null) {
    const container = $('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const borderCol = type === 'error' 
        ? 'border-red-500/50 bg-red-950/90 text-red-200 shadow-red-500/20' 
        : type === 'success'
            ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200 shadow-emerald-500/20'
            : 'border-[var(--genesis-border,#E8E8EC)] bg-[var(--genesis-surface,#FFFFFF)] text-[var(--genesis-text-primary,#0A0A0A)] shadow-md';

    toast.className = `px-3.5 py-2 rounded-[8px] border text-xs shadow-xl backdrop-blur transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto flex items-center justify-between gap-3 ${borderCol}`;
    
    const icon = type === 'error' 
        ? '<i class="fa-solid fa-circle-exclamation text-red-400 shrink-0"></i>' 
        : type === 'success'
            ? '<i class="fa-solid fa-circle-check text-emerald-500 shrink-0"></i>'
            : '<i class="fa-solid fa-circle-info text-indigo-500 shrink-0"></i>';

    const msgSpan = document.createElement('div');
    msgSpan.className = 'flex items-center gap-2';
    msgSpan.innerHTML = `${icon} <span>${escapeHtml(msg)}</span>`;
    toast.appendChild(msgSpan);

    if (action && typeof action.onClick === 'function') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'text-[11px] font-bold text-indigo-600 hover:text-indigo-500 underline ml-2 shrink-0 cursor-pointer active:scale-95';
        actionBtn.textContent = action.label || 'ดำเนินการ';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            action.onClick();
            toast.remove();
        });
        toast.appendChild(actionBtn);
    }
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);
    const duration = action ? 7000 : 3500;
    setTimeout(() => {
        if (toast.isConnected) {
            toast.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

// --- Cached DOM Refs ---
let playerArea = null;
let emptyState = null;
let hostBadge = null;
let qrContainer = null;
let playerQualityBadge = null;
let qualitySelect = null;
let toggleHost = null;
let btnPlay = null;
let iconPlay = null;
let playLabel = null;
let volDown = null;
let volUp = null;
let volSlider = null;
let volLabel = null;
let progressFill = null;
let timeNow = null;
let timeTotal = null;
let progressBar = null;
let clientControls = null;
let nowPlayingCard = null;
let nowAmbientBg = null;
let nowInfoWrap = null;
let nowThumb = null;
let nowThumbEmpty = null;
let nowEq = null;
let nowLiveDot = null;
let nowTitle = null;
let nowAuthor = null;
let nowAddedBy = null;
let usersList = null;
let onlineNum = null;
let secUsers = null;
let msgInput = null;
let msgBtn = null;
let ttsToggle = null;
let danmakuLayer = null;
let tabCtrl = null;
let tabQueue = null;
let secCtrl = null;
let secQueue = null;
let mobileNavBar = null;
let tabNavNow = null;
let tabNavQueue = null;
let tabNavParty = null;
let mobileLyricsBox = null;

let mobileStickyMiniplayer = null;
let miniThumb = null;
let miniTitle = null;
let miniAuthor = null;
let miniProgressFill = null;
let miniBtnVoteSkip = null;
let stageAmbientGlow = null;
let stageEq = null;
let momentCard = null;
let momentCardText = null;
let momentCardIcon = null;
let momentCardTimer = null;
let partyPulsePill = null;
let partyPulseText = null;
let partyPulseTimer = null;
let hasWelcomedGuest = false;

let lastRenderedVideoId = null;
let currentMobileTab = 'now';
let currentPartyLink = '';

// --- Moment Card Floating Toast (2-3s Announcement on Track Change / Chorus) ---
export function triggerMomentCard(text, iconClass = 'fa-sparkles') {
    if (!momentCard) momentCard = $('moment-card');
    if (!momentCardText) momentCardText = $('moment-card-text');
    if (!momentCardIcon) momentCardIcon = $('moment-card-icon');
    if (!momentCard || !momentCardText) return;

    if (momentCardTimer) clearTimeout(momentCardTimer);
    momentCardText.textContent = text;
    if (momentCardIcon && iconClass) {
        momentCardIcon.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    }
    momentCard.classList.remove('hidden', 'opacity-0');
    momentCard.classList.add('opacity-100');

    momentCardTimer = setTimeout(() => {
        momentCard.classList.add('opacity-0');
        setTimeout(() => {
            momentCard.classList.add('hidden');
        }, 300);
    }, 3000);
}

// --- Party Pulse Event Badge (Cyan Ring & Toast on Song Add / Reactions) ---
export function triggerPartyPulse(text) {
    if (!partyPulsePill) partyPulsePill = $('party-pulse-pill');
    if (!partyPulseText) partyPulseText = $('party-pulse-text');
    if (!partyPulsePill || !partyPulseText) return;

    if (partyPulseTimer) clearTimeout(partyPulseTimer);
    partyPulseText.textContent = text;
    partyPulsePill.classList.remove('hidden', 'opacity-0');
    partyPulsePill.classList.add('opacity-100');

    partyPulseTimer = setTimeout(() => {
        partyPulsePill.classList.add('opacity-0');
        setTimeout(() => {
            partyPulsePill.classList.add('hidden');
        }, 300);
    }, 3000);
}

// --- Settings & Secret Test Lab State ---
let secretTapCount = 0;
let secretTapResetTimer = null;
let testLabUnlocked = false;

// --- Now Playing Card Renderer ---
export function renderNowPlaying(currentVideo, isPlaying) {
    if (!nowTitle) return;

    const currentId = currentVideo ? `${currentVideo.videoId}:${currentVideo.thumbnail || ''}` : null;

    if (currentVideo) {
        nowTitle.textContent = currentVideo.title;
        const authorText = currentVideo.author ? escapeHtml(currentVideo.author) : 'กำลังเล่นเพลง';
        nowAuthor.innerHTML = `${getSourceIconHtml(currentVideo)}${authorText}`;

        if (nowAddedBy) {
            const avatarHtml = currentVideo.avatar 
                ? `<img src="${escapeHtml(currentVideo.avatar)}" alt="" class="w-4 h-4 rounded-full object-cover border border-white/20 shrink-0 inline-block align-middle mr-1.5 shadow-sm">`
                : '';
            nowAddedBy.innerHTML = `เพิ่มโดย: ${avatarHtml}<span style="color:${safeColor(currentVideo.color)}" class="font-semibold">${escapeHtml(currentVideo.addedBy || 'สมาชิก')}</span>`;
            nowAddedBy.classList.remove('hidden');
        }

        if (emptyState) {
            emptyState.classList.remove('opacity-100', 'scale-100');
            emptyState.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
        }

        if (nowPlayingCard) nowPlayingCard.classList.add('now-playing-card');

        // Animate & update thumbnail only when track changes
        if (currentId !== lastRenderedVideoId) {
            const thumbUrl = getTrackThumb(currentVideo);
            if (nowThumb) {
                nowThumb.classList.remove('loaded', 'hidden');
                nowThumb.onload = () => {
                    nowThumb.classList.add('loaded');
                    if (nowThumbEmpty) nowThumbEmpty.classList.add('opacity-0', 'pointer-events-none');
                };
                nowThumb.onerror = () => {
                    const fallback = `https://i.ytimg.com/vi/${currentVideo?.videoId}/mqdefault.jpg`;
                    if (fallback && nowThumb.src !== fallback) nowThumb.src = fallback;
                };
                nowThumb.src = thumbUrl;
            }

            if (nowAmbientBg) {
                nowAmbientBg.style.backgroundImage = `url('${thumbUrl}')`;
                nowAmbientBg.classList.remove('opacity-0');
                nowAmbientBg.classList.add('opacity-35');
            }

            if (nowInfoWrap) {
                nowInfoWrap.classList.remove('animate-thumb-change');
                void nowInfoWrap.offsetWidth; // trigger reflow
                nowInfoWrap.classList.add('animate-thumb-change');
            }

            // D4. Trigger Moment Card on track change
            triggerMomentCard(`✨ เพลงใหม่: ${currentVideo.title}`);

            lastRenderedVideoId = currentId;
        }

        // Equalizer & live dot state
        if (nowEq) {
            nowEq.classList.remove('hidden');
            nowEq.classList.toggle('eq-paused', !isPlaying);
        }
        if (nowLiveDot) {
            nowLiveDot.className = isPlaying
                ? 'w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse transition-colors duration-300'
                : 'w-2 h-2 rounded-full bg-amber-400/80 shadow-[0_0_6px_rgba(251,191,36,0.6)] transition-colors duration-300';
        }



        // Synchronize Mobile Sticky Mini-Player
        if (!mobileStickyMiniplayer) mobileStickyMiniplayer = $('mobile-sticky-miniplayer');
        if (!miniThumb) miniThumb = $('mini-thumb');
        if (!miniTitle) miniTitle = $('mini-title');
        if (!miniAuthor) miniAuthor = $('mini-author');

        if (miniTitle) miniTitle.textContent = currentVideo.title || 'กำลังเล่น';
        if (miniAuthor) miniAuthor.textContent = currentVideo.author || '—';
        if (miniThumb) miniThumb.src = getTrackThumb(currentVideo);
        if (window.innerWidth < 768 && (currentMobileTab === 'queue' || currentMobileTab === 'party')) {
            if (mobileStickyMiniplayer) mobileStickyMiniplayer.classList.remove('hidden');
        }
    } else {
        nowTitle.textContent = 'ยังไม่มีเพลง';
        nowAuthor.textContent = '—';
        if (nowAddedBy) {
            nowAddedBy.textContent = '';
            nowAddedBy.classList.add('hidden');
        }

        if (emptyState) {
            emptyState.classList.remove('hidden', 'opacity-0', 'scale-95', 'pointer-events-none');
            emptyState.classList.add('opacity-100', 'scale-100');
        }

        if (nowPlayingCard) nowPlayingCard.classList.remove('now-playing-card');
        if (nowThumb) {
            nowThumb.classList.remove('loaded');
            nowThumb.classList.add('hidden');
            nowThumb.removeAttribute('src');
        }
        if (nowThumbEmpty) {
            nowThumbEmpty.classList.remove('opacity-0', 'pointer-events-none');
        }
        if (nowAmbientBg) {
            nowAmbientBg.classList.remove('opacity-35');
            nowAmbientBg.classList.add('opacity-0');
        }
        if (nowEq) nowEq.classList.add('hidden');
        if (nowLiveDot) {
            nowLiveDot.className = 'w-2 h-2 rounded-full bg-cyan-400/30 transition-colors duration-300';
        }



        // Hide miniplayer when no song
        if (!mobileStickyMiniplayer) mobileStickyMiniplayer = $('mobile-sticky-miniplayer');
        if (mobileStickyMiniplayer) mobileStickyMiniplayer.classList.add('hidden');
        if (miniTitle) miniTitle.textContent = 'ยังไม่มีเพลง';
        if (miniAuthor) miniAuthor.textContent = '—';

        // Requirement 3: Strictly hide lyrics box when no song
        if (mobileLyricsBox) mobileLyricsBox.classList.add('hidden');

        lastRenderedVideoId = null;
    }

    // Play/Pause icon & label (Ensure high-contrast white on violet transport button)
    if (iconPlay) {
        iconPlay.className = isPlaying 
            ? "fa-solid fa-pause text-base text-white" 
            : "fa-solid fa-play text-base ml-0.5 text-white";
    }
    if (playLabel) {
        playLabel.textContent = isPlaying ? 'หยุดชั่วคราว' : 'เล่นเพลง';
    }
}

// --- Progress & Time Display ---
let isScrubbing = false;
export function setIsScrubbingState(val) { isScrubbing = Boolean(val); }

export function getEffectiveDuration() {
    const state = getState();
    if (state.duration && state.duration > 0) return state.duration;
    if (typeof getPlayerDuration === 'function') {
        const dur = getPlayerDuration();
        if (dur > 0) return dur;
    }
    if (timeTotal && timeTotal.textContent && timeTotal.textContent !== '0:00') {
        const parts = timeTotal.textContent.trim().split(':').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return parts[0] * 60 + parts[1];
        }
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
    }
    return 0;
}

export function updateProgress(curr, dur) {
    if (isScrubbing) return;
    if (!progressFill || !timeNow || !timeTotal) return;
    if (dur > 0) {
        const p = (curr / dur) * 100;
        progressFill.style.width = `${Math.min(100, Math.max(0, p))}%`;
        timeNow.textContent = formatTime(curr);
        timeTotal.textContent = formatTime(dur);

        if (progressBar) {
            progressBar.setAttribute('aria-valuenow', String(Math.round(p)));
            progressBar.setAttribute('aria-valuetext', `${formatTime(curr)} จาก ${formatTime(dur)}`);
        }

        // Sync Mini-player progress bar
        if (!miniProgressFill) miniProgressFill = $('mini-progress-fill');
        if (miniProgressFill) {
            miniProgressFill.style.width = `${Math.min(100, Math.max(0, p))}%`;
        }
    } else {
        progressFill.style.width = `0%`;
        timeNow.textContent = '0:00';
        timeTotal.textContent = '0:00';
        if (progressBar) {
            progressBar.setAttribute('aria-valuenow', '0');
            progressBar.setAttribute('aria-valuetext', '0:00');
        }
        if (!miniProgressFill) miniProgressFill = $('mini-progress-fill');
        if (miniProgressFill) miniProgressFill.style.width = `0%`;
    }
}

export function updateVolumeUI(vol) {
    if (volSlider) volSlider.value = vol;
    if (volLabel) volLabel.textContent = `${vol}%`;
}

export function updateQualityUI(quality) {
    if (qualitySelect && quality) {
        qualitySelect.value = quality;
    }
    if (playerQualityBadge && quality) {
        const labels = { max: '1080p+', hd720: '720p', medium: '360p', auto: 'Auto' };
        playerQualityBadge.textContent = labels[quality] || 'HD';
    }
}

// --- Mobile Tab Switching ---
export function switchMobileTab(tabKey) {
    if (!['now', 'queue', 'party'].includes(tabKey)) return;
    currentMobileTab = tabKey;

    const isMobileViewport = window.innerWidth < 768;
    const addQueueCard = $('add-queue-card');
        const state = getState();
    const isHost = state.hostMode;

    const tabs = [
        { btn: tabNavNow, key: 'now' },
        { btn: tabNavQueue, key: 'queue' },
        { btn: tabNavParty, key: 'party' }
    ];
    tabs.forEach(({ btn, key }) => {
        if (!btn) return;
        const isActive = key === tabKey;
        btn.classList.toggle('text-cyan-400', isActive);
        btn.classList.toggle('text-slate-400', !isActive);
        btn.classList.toggle('font-bold', isActive);
    });

    if (!isMobileViewport || isHost) return;

    if (!mobileStickyMiniplayer) mobileStickyMiniplayer = $('mobile-sticky-miniplayer');

    if (tabKey === 'now') {
        if (secCtrl) secCtrl.classList.remove('hidden');
        if (secQueue) secQueue.classList.add('hidden');
        if (nowPlayingCard) nowPlayingCard.classList.remove('hidden');
        if (addQueueCard) addQueueCard.classList.remove('hidden'); // Req #7: Show search & add song input prominently on front page
        if (clientControls) clientControls.classList.add('hidden');
        if (mobileStickyMiniplayer) mobileStickyMiniplayer.classList.add('hidden');
    } else if (tabKey === 'queue') {
        if (secCtrl) secCtrl.classList.remove('hidden');
        if (nowPlayingCard) nowPlayingCard.classList.add('hidden');
        if (addQueueCard) addQueueCard.classList.remove('hidden');
        if (clientControls) clientControls.classList.add('hidden');
        if (secQueue) {
            secQueue.classList.remove('hidden');
            secQueue.classList.remove('animate-fade-in-up');
            void secQueue.offsetWidth;
            secQueue.classList.add('animate-fade-in-up');
        }
        if (state.currentVideo && mobileStickyMiniplayer) {
            mobileStickyMiniplayer.classList.remove('hidden');
        } else if (mobileStickyMiniplayer) {
            mobileStickyMiniplayer.classList.add('hidden');
        }
    } else if (tabKey === 'party') {
        if (secCtrl) secCtrl.classList.remove('hidden');
        if (secQueue) secQueue.classList.add('hidden');
        if (nowPlayingCard) nowPlayingCard.classList.add('hidden');
        if (addQueueCard) addQueueCard.classList.add('hidden');
        if (clientControls) clientControls.classList.remove('hidden');
        if (state.currentVideo && mobileStickyMiniplayer) {
            mobileStickyMiniplayer.classList.remove('hidden');
        } else if (mobileStickyMiniplayer) {
            mobileStickyMiniplayer.classList.add('hidden');
        }
    }
}

// --- Host vs Client Mode UI Adapter ---
export function updateUIMode(hostMode) {
    const addQueueCard = $('add-queue-card');
        const btnSkip = $('btn-skip');
    const btnVoteSkip = $('btn-vote-skip');
    const isMobileViewport = window.innerWidth < 768;

    const playerQrBadge = $('player-qr-badge');
    const asideQrBtn = $('aside-qr-btn');
    const headerQrBtn = $('header-qr-btn');

    if (hostMode) {
        document.body.classList.remove('client-mode');
        if (hostBadge) hostBadge.classList.remove('hidden');
        if (clientControls) clientControls.classList.add('hidden');
        if (addQueueCard) addQueueCard.classList.remove('hidden');
        if (qrContainer) qrContainer.classList.remove('hidden');
        if (playerQrBadge) playerQrBadge.classList.remove('hidden');
        if (asideQrBtn) asideQrBtn.classList.remove('hidden');
        if (headerQrBtn) headerQrBtn.classList.remove('hidden');
        fitQrUrlText();
        if (secUsers) secUsers.style.display = 'none';

        if (btnSkip) btnSkip.classList.remove('hidden');
        if (btnVoteSkip) btnVoteSkip.classList.add('hidden');
        if (mobileLyricsBox) mobileLyricsBox.classList.add('hidden');

        if (nowPlayingCard) nowPlayingCard.classList.remove('hidden');
        if (secCtrl) secCtrl.classList.remove('hidden');
        if (secQueue) secQueue.classList.remove('hidden');
    } else {
        document.body.classList.add('client-mode');
        if (hostBadge) hostBadge.classList.add('hidden');
        if (btnSkip) btnSkip.classList.remove('hidden');
        if (btnVoteSkip) btnVoteSkip.classList.add('hidden');
        if (mobileLyricsBox) {
            const hasSong = Boolean(getState().currentVideo);
            mobileLyricsBox.classList.toggle('hidden', !hasSong);
        }

        if (qrContainer) qrContainer.classList.add('hidden');
        if (playerQrBadge) playerQrBadge.classList.add('hidden');
        if (asideQrBtn) asideQrBtn.classList.add('hidden');
        if (headerQrBtn) headerQrBtn.classList.add('hidden');
        if (secUsers) secUsers.style.display = '';

        if (isMobileViewport) {
            switchMobileTab(currentMobileTab);
        } else {
            if (clientControls) clientControls.classList.remove('hidden');
            if (addQueueCard) addQueueCard.classList.remove('hidden');
            if (nowPlayingCard) nowPlayingCard.classList.remove('hidden');
            if (secCtrl) secCtrl.classList.remove('hidden');
            if (secQueue) secQueue.classList.remove('hidden');
        }
    }
}

// --- Users List Renderer ---
export function updateUsersList(users) {
    if (!usersList || !onlineNum) return;
    const keys = Object.keys(users || {});
    onlineNum.textContent = keys.length;
    
    const onlineCount = $('online-count');
    if (onlineCount) {
        onlineCount.classList.toggle('hidden', keys.length === 0);
    }

    const qrGuestCount = $('qr-guest-count');
    if (qrGuestCount) {
        qrGuestCount.textContent = keys.length;
    }
    
    if (keys.length === 0) {
        usersList.innerHTML = `<p class="text-[9px] text-brand-light/30 py-2">ไม่มีผู้ใช้</p>`;
        return;
    }

    usersList.innerHTML = keys.map(id => {
        const u = users[id];
        const color = safeColor(u.color);
        const name = escapeHtml(u.name) || 'ผู้ใช้ทั่วไป';
        const avatarEl = u.avatar
            ? `<img src="${escapeHtml(u.avatar)}" alt="${name}" class="w-4 h-4 rounded-full object-cover border border-white/20 shrink-0">`
            : `<span class="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor]" style="background-color: ${color}; color: ${color}"></span>`;

        return `<div class="bg-white/[0.04] border border-white/[0.08] hover:border-cyan-400/40 rounded-full px-2.5 py-1 text-[11px] flex items-center gap-1.5 transition shadow-sm">
            ${avatarEl}
            <span class="font-medium truncate max-w-[120px]" style="color: ${color}">${name}</span>
        </div>`;
    }).join('');
}

// --- Floating Emoji Reactions ---
export function spawnFloatingReaction(emoji) {
    if (!playerArea) playerArea = $('player-area');
    if (!playerArea) return;

    triggerPartyPulse(`มีเพื่อนส่งรีแอค ${emoji}`);

    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '10%';
    playerArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

// --- Flying Danmaku Comments ---
export function spawnDanmaku(data) {
    if (!danmakuLayer) danmakuLayer = $('danmaku-layer');
    if (!danmakuLayer) return;

    if (data?.text) {
        triggerPartyPulse(`💬 ${data.nickname || 'เพื่อน'}: ${data.text.slice(0, 20)}`);
    }

    const el = document.createElement('div');
    el.className = 'danmaku-text';
    const color = safeColor(data.color);
    const avatarHtml = data.avatar 
        ? `<img src="${escapeHtml(data.avatar)}" alt="" class="w-5 h-5 rounded-full object-cover border border-white/30 inline-block align-middle mr-1.5 shadow-sm">`
        : '';
    el.innerHTML = `${avatarHtml}<span style="color: ${color}">${escapeHtml(data.nickname) || ''}:</span> ${escapeHtml(data.text)}`;
    el.style.top = (Math.random() * 60 + 10) + '%';
    el.style.animationDuration = (Math.random() * 4 + 7) + 's';
    danmakuLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

// --- QR Code Generator & Fullscreen Modal ---
export function openQrModal() {
    const modal = $('qr-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const modalQrEl = $('modal-qrcode');
    if (modalQrEl && currentPartyLink) {
        modalQrEl.innerHTML = '';
        const isMobileScreen = window.innerWidth < 440;
        const qrSize = isMobileScreen ? 210 : 260;
        if (window.QRCode) {
            new window.QRCode(modalQrEl, {
                text: currentPartyLink,
                width: qrSize,
                height: qrSize,
                colorDark: "#080d1a",
                colorLight: "#ffffff",
                correctLevel: window.QRCode.CorrectLevel.M
            });
        }
    }
    const modalUrlDisplay = $('modal-url-display');
    if (modalUrlDisplay && currentPartyLink) {
        modalUrlDisplay.textContent = currentPartyLink;
    }
}

export function closeQrModal() {
    const modal = $('qr-modal');
    if (modal) modal.classList.add('hidden');
}

export function fitQrUrlText() {
    const urlEl = document.getElementById('url-display');
    if (!urlEl || !urlEl.textContent) return;
    const targetWidth = 140;
    urlEl.style.transform = 'none';
    urlEl.style.fontSize = '10px';
    urlEl.style.display = 'inline-block';

    const measured = urlEl.scrollWidth || urlEl.offsetWidth;
    if (measured > 0) {
        const exactSize = Math.min(10.5, Math.max(6.5, (10 * targetWidth) / measured));
        urlEl.style.fontSize = `${exactSize.toFixed(2)}px`;
        const afterWidth = urlEl.scrollWidth || urlEl.offsetWidth;
        if (afterWidth > 0 && Math.abs(afterWidth - targetWidth) > 0.5) {
            urlEl.style.transformOrigin = 'center top';
            urlEl.style.transform = `scaleX(${(targetWidth / afterWidth).toFixed(4)})`;
        }
    }
}

export function renderQrCode(localIp, port) {
    if (!qrContainer) qrContainer = $('qr-container');

    let link = window.location.origin;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        link = `http://${localIp || 'localhost'}:${port || 3000}`;
    }
    currentPartyLink = link;

    // 1. Render Sidebar QR (128x128)
    const qrEl = $('qrcode');
    if (qrEl) {
        qrEl.innerHTML = '';
        if (window.QRCode) {
            new window.QRCode(qrEl, {
                text: link,
                width: 128,
                height: 128,
                colorDark: "#080d1a",
                colorLight: "#ffffff",
                correctLevel: window.QRCode.CorrectLevel.M
            });
        }
    }

    // 2. Render Fullscreen Modal QR (260x260)
    const modalQrEl = $('modal-qrcode');
    if (modalQrEl) {
        modalQrEl.innerHTML = '';
        const isMobileScreen = window.innerWidth < 440;
        const qrSize = isMobileScreen ? 210 : 260;
        if (window.QRCode) {
            new window.QRCode(modalQrEl, {
                text: link,
                width: qrSize,
                height: qrSize,
                colorDark: "#080d1a",
                colorLight: "#ffffff",
                correctLevel: window.QRCode.CorrectLevel.M
            });
        }
    }

    const urlDisplay = $('url-display');
    if (urlDisplay) urlDisplay.textContent = link;

    const modalUrlDisplay = $('modal-url-display');
    if (modalUrlDisplay) modalUrlDisplay.textContent = link;

    requestAnimationFrame(() => fitQrUrlText());
}

// --- Idle Auto-Fade Controller ---
let userIdleTimer = null;
const IDLE_TIMEOUT_MS = 3000;

function isInteractiveContextActive() {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return true;
    }
    const qrModal = $('qr-modal');
    if (qrModal && !qrModal.classList.contains('hidden')) return true;
    const settingsModal = $('settings-modal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) return true;
    const profileModal = $('profile-modal');
    if (profileModal && !profileModal.classList.contains('hidden')) return true;
    const playlistModal = $('playlist-import-modal');
    if (playlistModal && !playlistModal.classList.contains('hidden')) return true;
    const favoritesDrawer = $('favorites-drawer');
    if (favoritesDrawer && !favoritesDrawer.classList.contains('hidden')) return true;
    const introOverlay = $('intro-overlay');
    if (introOverlay && !introOverlay.classList.contains('intro-exit') && !introOverlay.classList.contains('hidden')) return true;
    return false;
}

export function resetUserIdleTimer() {
    if (document.body.classList.contains('user-idle')) {
        document.body.classList.remove('user-idle');
    }
    clearTimeout(userIdleTimer);

    if (isInteractiveContextActive()) return;

    userIdleTimer = setTimeout(() => {
        if (!isInteractiveContextActive()) {
            document.body.classList.add('user-idle');
        }
    }, IDLE_TIMEOUT_MS);
}

// --- Settings & Profile UI ---
let pendingAvatar = null;

function updateAvatarModalPreview(avatarUrl, name) {
    const previewImg = $('settings-avatar-preview');
    const previewInit = $('settings-avatar-initial');
    const profilePrevImg = $('profile-preview-avatar');
    const profilePrevInit = $('profile-preview-avatar-init');
    const initialChar = getAvatarInitial(name || getState().myProfile?.name);

    if (avatarUrl) {
        if (previewImg) {
            previewImg.src = avatarUrl;
            previewImg.classList.remove('hidden');
        }
        if (previewInit) previewInit.classList.add('hidden');
        if (profilePrevImg) {
            profilePrevImg.src = avatarUrl;
            profilePrevImg.classList.remove('hidden');
        }
        if (profilePrevInit) profilePrevInit.classList.add('hidden');
    } else {
        if (previewImg) {
            previewImg.removeAttribute('src');
            previewImg.classList.add('hidden');
        }
        if (previewInit) {
            previewInit.textContent = initialChar;
            previewInit.classList.remove('hidden');
        }
        if (profilePrevImg) {
            profilePrevImg.removeAttribute('src');
            profilePrevImg.classList.add('hidden');
        }
        if (profilePrevInit) {
            profilePrevInit.textContent = initialChar;
            profilePrevInit.classList.remove('hidden');
        }
    }

    // Highlight active preset button if applicable
    document.querySelectorAll('.avatar-preset-btn').forEach((btn) => {
        const btnUrl = btn.getAttribute('data-avatar-url');
        const isMatch = !!(avatarUrl && btnUrl === avatarUrl);
        btn.classList.toggle('ring-2', isMatch);
        btn.classList.toggle('ring-cyan-400', isMatch);
        btn.classList.toggle('scale-110', isMatch);
    });
}

function renderAvatarPresetsGrid() {
    const grid = $('avatar-presets-grid');
    if (!grid || grid.children.length > 0) return;

    grid.innerHTML = AVATAR_PRESETS.map((preset) => `
        <button type="button" 
                class="avatar-preset-btn w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-white/20 hover:border-cyan-400 bg-white/5 overflow-hidden transition-all transform hover:scale-110 active:scale-95 flex items-center justify-center shadow-sm"
                data-avatar-url="${escapeHtml(preset.dataUrl)}"
                title="${escapeHtml(preset.label)}">
            <img src="${escapeHtml(preset.dataUrl)}" alt="${escapeHtml(preset.label)}" class="w-full h-full object-cover pointer-events-none">
        </button>
    `).join('');

    grid.querySelectorAll('.avatar-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const url = btn.getAttribute('data-avatar-url');
            pendingAvatar = url;
            const currentName = ($('settings-name')?.value || '').trim() || getState().myProfile?.name;
            updateAvatarModalPreview(url, currentName);
            showToast(`เลือกรูปโปรไฟล์ "${btn.title}" แล้ว`, 'info');
        });
    });
}

function updateProfileUI() {
    const state = getState();
    const profile = state.myProfile || {
        name: localStorage.getItem('nickname') || '',
        color: safeColor(localStorage.getItem('usercolor')),
        avatar: localStorage.getItem('useravatar') || ''
    };

    const myColorDot = $('my-color-dot');
    if (myColorDot) {
        myColorDot.style.backgroundColor = safeColor(profile.color);
    }
    const previewBadge = $('profile-preview-badge');
    if (previewBadge) {
        previewBadge.textContent = profile.name || 'ตัวอย่างชื่อ';
        previewBadge.style.color = safeColor(profile.color);
        previewBadge.style.borderColor = safeColor(profile.color);
    }

    // Top Header Avatar Chip
    const myAvatarImg = $('my-avatar-img');
    const myAvatarInitial = $('my-avatar-initial');
    const initialChar = getAvatarInitial(profile.name);

    if (profile.avatar) {
        if (myAvatarImg) {
            myAvatarImg.src = profile.avatar;
            myAvatarImg.classList.remove('hidden');
        }
        if (myAvatarInitial) myAvatarInitial.classList.add('hidden');
    } else {
        if (myAvatarImg) {
            myAvatarImg.removeAttribute('src');
            myAvatarImg.classList.add('hidden');
        }
        if (myAvatarInitial) {
            myAvatarInitial.textContent = initialChar;
            myAvatarInitial.classList.remove('hidden');
        }
    }

    // Profile Preview Modal Avatar
    const profilePrevImg = $('profile-preview-avatar');
    const profilePrevInit = $('profile-preview-avatar-init');
    if (profilePrevImg && profilePrevInit) {
        if (profile.avatar) {
            profilePrevImg.src = profile.avatar;
            profilePrevImg.classList.remove('hidden');
            profilePrevInit.classList.add('hidden');
        } else {
            profilePrevImg.removeAttribute('src');
            profilePrevImg.classList.add('hidden');
            profilePrevInit.textContent = initialChar;
            profilePrevInit.classList.remove('hidden');
        }
    }
}

function getAutoDjModeShortLabel(mode, customQuery) {
    if (customQuery) return `แนว: ${customQuery}`;
    const labels = {
        khlerm: 'ชิลล์เคลิ้มๆ',
        party: 'ตี้แดนซ์โจ๊ะๆ',
        thai_indie: 'อินดี้ไทย',
        rock: 'ร็อกลั่นรถ',
        tiktok: 'ฮิต TikTok'
    };
    return labels[mode] || 'อัตโนมัติ';
}

function syncAutoDjSettingsUI() {
    const state = getState();
    const enabled = state.autoDjEnabled !== false;
    const mode = state.autoDjMode || 'khlerm';
    const customQuery = state.autoDjCustomQuery || '';
    const shortLabel = getAutoDjModeShortLabel(mode, customQuery);

    const settingsAutodjToggle = $('settings-autodj-toggle');
    const settingsAutodjMode = $('settings-autodj-mode');
    const settingsAutodjCustom = $('settings-autodj-custom');
    const autodjOptionsWrap = $('autodj-options-wrap');
    const autodjStatusBadge = $('autodj-status-badge');

    if (settingsAutodjToggle) {
        settingsAutodjToggle.checked = enabled;
    }
    if (settingsAutodjMode && settingsAutodjMode.value !== mode) {
        settingsAutodjMode.value = mode;
    }
    if (settingsAutodjCustom && document.activeElement !== settingsAutodjCustom) {
        settingsAutodjCustom.value = customQuery;
    }
    if (autodjOptionsWrap) {
        autodjOptionsWrap.classList.toggle('opacity-50', !enabled);
    }
    if (autodjStatusBadge) {
        if (enabled) {
            autodjStatusBadge.textContent = `เปิดอยู่ • ${shortLabel}`;
            autodjStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-purple-950/70 text-purple-300 border border-purple-500/40 font-medium truncate max-w-[170px]';
        } else {
            autodjStatusBadge.textContent = 'ปิดอยู่';
            autodjStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-brand-light/40 border border-brand-deep/50 font-medium';
        }
    }

    document.querySelectorAll('[data-autodj-preset]').forEach((btn) => {
        const preset = btn.getAttribute('data-autodj-preset');
        const isSelected = preset === mode && !customQuery;
        btn.className = isSelected
            ? 'px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-left border transition flex items-center gap-1.5 bg-purple-950/70 border-purple-400/70 text-white shadow-sm shadow-purple-500/20'
            : 'px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-left border transition flex items-center gap-1.5 bg-[#0a0f18] border-brand-deep/50 text-brand-light/75 hover:text-white hover:border-purple-500/30';
    });
}

export function openSettingsModal() {
    const settingsModal = $('settings-modal');
    if (!settingsModal) return;

    const state = getState();
    const profile = state.myProfile || {
        name: localStorage.getItem('nickname') || '',
        color: safeColor(localStorage.getItem('usercolor')),
        avatar: localStorage.getItem('useravatar') || ''
    };

    pendingAvatar = profile.avatar || '';

    const settingsNameInput = $('settings-name');
    const settingsColorInput = $('settings-color');
    if (settingsNameInput) settingsNameInput.value = profile.name || '';
    if (settingsColorInput) settingsColorInput.value = safeColor(profile.color);

    renderAvatarPresetsGrid();
    updateAvatarModalPreview(pendingAvatar, profile.name);
    syncAutoDjSettingsUI();
    updateProfileUI();
    settingsModal.classList.remove('hidden');
}

export function closeSettingsModal() {
    const settingsModal = $('settings-modal');
    if (settingsModal) settingsModal.classList.add('hidden');
}

// 5-Tap Unlock for Test Lab
function registerSecret5Tap() {
    const settingsGearIcon = $('settings-gear-icon');
    const secretTapBadge = $('secret-tap-badge');
    const secretTapHint = $('secret-tap-hint');
    const testLabPanel = $('test-lab-panel');

    if (testLabUnlocked) {
        if (testLabPanel) {
            testLabPanel.classList.remove('hidden');
            testLabPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
    }

    secretTapCount += 1;
    clearTimeout(secretTapResetTimer);

    if (settingsGearIcon) {
        settingsGearIcon.style.transform = `rotate(${secretTapCount * 72}deg)`;
    }
    if (secretTapBadge) {
        secretTapBadge.textContent = `${secretTapCount}/5`;
    }

    if (secretTapCount >= 5) {
        testLabUnlocked = true;
        secretTapCount = 5;
        playSoftAlertChime('near-90pct');
        if (secretTapBadge) {
            secretTapBadge.textContent = '🔓 ปลดล็อกแล้ว';
            secretTapBadge.className = 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0';
        }
        if (secretTapHint) {
            secretTapHint.textContent = 'เปิดใช้งานศูนย์ทดสอบการแจ้งเตือนและระบบจำลองเรียบร้อยแล้ว!';
            secretTapHint.className = 'text-[9px] text-emerald-300 truncate';
        }
        if (testLabPanel) {
            testLabPanel.classList.remove('hidden');
            setTimeout(() => {
                testLabPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 80);
        }
        showToast('🧪 ปลดล็อกหน้าทดสอบระบบและการแจ้งเตือนสำเร็จ!', 'info');
        return;
    }

    if (secretTapCount >= 2) {
        const remain = 5 - secretTapCount;
        if (secretTapHint) {
            secretTapHint.textContent = `กดย้ำอีก ${remain} ครั้ง เพื่อเปิดหน้าทดสอบการแจ้งเตือน...`;
        }
    }

    secretTapResetTimer = setTimeout(() => {
        if (!testLabUnlocked) {
            secretTapCount = 0;
            if (secretTapBadge) secretTapBadge.textContent = '0/5';
            if (secretTapHint) {
                secretTapHint.textContent = 'กดย้ำๆ ที่ปุ่มนี้ 5 ครั้ง เพื่อเปิดหน้าทดสอบการแจ้งเตือนทุกเหตุการณ์';
            }
        }
    }, 1800);
}

// --- Wire Event Handlers ---
export function initUI() {
    // Cache references
    playerArea = $('player-area');
    emptyState = $('empty-state');
    hostBadge = $('host-badge');
    qrContainer = $('qr-container');
    playerQualityBadge = $('player-quality-badge');
    qualitySelect = $('quality-select');
    toggleHost = $('toggle-host');
    btnPlay = $('btn-play');
    iconPlay = $('icon-play');
    playLabel = $('play-label');
    volDown = $('vol-down');
    volUp = $('vol-up');
    volSlider = $('vol-slider');
    volLabel = $('vol-label');
    progressFill = $('progress-fill');
    timeNow = $('time-now');
    timeTotal = $('time-total');
    progressBar = $('progress-bar');
    clientControls = $('client-controls');
    nowPlayingCard = $('now-playing-card');
    nowAmbientBg = $('now-ambient-bg');
    nowInfoWrap = $('now-info-wrap');
    nowThumb = $('now-thumb');
    nowThumbEmpty = $('now-thumb-empty');
    nowEq = $('now-eq');
    nowLiveDot = $('now-live-dot');
    nowTitle = $('now-title');
    nowAuthor = $('now-author');
    nowAddedBy = $('now-added-by');
    usersList = $('users-list');
    onlineNum = $('online-num');
    secUsers = $('sec-users');
    msgInput = $('msg-input');
    msgBtn = $('msg-btn');
    ttsToggle = $('tts-toggle');
    danmakuLayer = $('danmaku-layer');
    tabCtrl = $('tab-ctrl');
    tabQueue = $('tab-queue');
    secCtrl = $('sec-ctrl');
    secQueue = $('sec-queue');
    mobileNavBar = $('mobile-nav-bar');
    tabNavNow = $('tab-nav-now');
    tabNavQueue = $('tab-nav-queue');
    tabNavParty = $('tab-nav-party');
    mobileLyricsBox = $('mobile-lyrics-box');
    mobileStickyMiniplayer = $('mobile-sticky-miniplayer');
    miniThumb = $('mini-thumb');
    miniTitle = $('mini-title');
    miniAuthor = $('mini-author');
    miniProgressFill = $('mini-progress-fill');
    const miniBtnSkip = $('mini-btn-skip') || $('mini-btn-vote-skip');
    stageAmbientGlow = $('stage-ambient-glow');
    stageEq = $('stage-equalizer');
    momentCard = $('moment-card');
    momentCardText = $('moment-card-text');
    momentCardIcon = $('moment-card-icon');
    partyPulsePill = $('party-pulse-pill');
    partyPulseText = $('party-pulse-text');

    // Mini-Player tap returns to Tab 1 (now)
    if (mobileStickyMiniplayer) {
        mobileStickyMiniplayer.addEventListener('click', () => {
            switchMobileTab('now');
            const aside = document.querySelector('aside');
            if (aside) aside.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    if (miniBtnSkip) {
        miniBtnSkip.addEventListener('click', (e) => {
            e.stopPropagation();
            const mainSkip = $('btn-skip');
            if (mainSkip) {
                mainSkip.click();
            } else {
                emitSkipVideo();
            }
        });
    }

    // 1. Play / Pause Control
    if (btnPlay) {
        btnPlay.addEventListener('click', () => {
            const state = getState();
            emitPlayControl(!state.isPlaying);
        });
    }

    // 2. Volume Controls
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            emitVolumeControl(parseInt(e.target.value, 10));
        });
    }
    if (volDown) {
        volDown.addEventListener('click', () => {
            const state = getState();
            emitVolumeControl(Math.max(0, (state.volume ?? 50) - 10));
        });
    }
    if (volUp) {
        volUp.addEventListener('click', () => {
            const state = getState();
            emitVolumeControl(Math.min(100, (state.volume ?? 50) + 10));
        });
    }

    // 3. Quality Control
    if (qualitySelect) {
        qualitySelect.addEventListener('change', (e) => {
            const val = e.target.value;
            emitQualityControl(val);
            showToast(`ตั้งค่าความคมชัดเป็น: ${e.target.options[e.target.selectedIndex].text}`, 'info');
        });
    }

    // 4. Progress Bar Seek & Interactive Scrubbing (Click, Drag, Touch & Keyboard)
    if (progressBar) {
        let isLocalScrubbing = false;

        const getScrubTimeFromEvent = (e) => {
            const rect = progressBar.getBoundingClientRect();
            if (rect.width <= 0) return { pos: 0, seekTime: 0, duration: 0 };
            const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const duration = getEffectiveDuration();
            return { pos, seekTime: pos * duration, duration };
        };

        const updateScrubVisual = (pos, seekTime, duration) => {
            if (progressFill) {
                progressFill.style.width = `${pos * 100}%`;
            }
            if (timeNow) {
                timeNow.textContent = formatTime(seekTime);
            }
            if (timeTotal && duration > 0) {
                timeTotal.textContent = formatTime(duration);
            }
            if (miniProgressFill) {
                miniProgressFill.style.width = `${pos * 100}%`;
            }
        };

        const commitSeek = (seekTime) => {
            const duration = getEffectiveDuration();
            if (duration <= 0) return;
            const clampedSeek = Math.max(0, Math.min(duration, seekTime));

            // Optimistic local UI update
            updateProgress(clampedSeek, duration);

            // Emit to server for peer sync
            emitSeekTo(clampedSeek);

            // If in Host mode, seek local media element immediately
            if (isHostMode()) {
                seekHostPlayer(clampedSeek);
            }
        };

        progressBar.addEventListener('pointerdown', (e) => {
            const state = getState();
            if (!state.currentVideo) return;
            const duration = getEffectiveDuration();
            if (duration <= 0) return;

            isLocalScrubbing = true;
            setIsScrubbingState(true);
            progressBar.classList.add('is-scrubbing');
            try { progressBar.setPointerCapture(e.pointerId); } catch (_) {}

            const { pos, seekTime } = getScrubTimeFromEvent(e);
            updateScrubVisual(pos, seekTime, duration);
        });

        progressBar.addEventListener('pointermove', (e) => {
            if (!isLocalScrubbing) return;
            const { pos, seekTime, duration } = getScrubTimeFromEvent(e);
            if (duration > 0) {
                updateScrubVisual(pos, seekTime, duration);
            }
        });

        const stopScrub = (e) => {
            if (!isLocalScrubbing) return;
            isLocalScrubbing = false;
            setIsScrubbingState(false);
            progressBar.classList.remove('is-scrubbing');
            try { progressBar.releasePointerCapture(e.pointerId); } catch (_) {}

            const { seekTime } = getScrubTimeFromEvent(e);
            commitSeek(seekTime);
        };

        progressBar.addEventListener('pointerup', stopScrub);
        progressBar.addEventListener('pointercancel', stopScrub);

        // Keyboard arrow navigation (-5s / +5s)
        progressBar.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const cur = (typeof getPrecisePlaybackTime === 'function' ? getPrecisePlaybackTime() : (getState().currentTime || 0));
                const dur = getEffectiveDuration();
                if (dur <= 0) return;
                const delta = e.key === 'ArrowLeft' ? -5 : 5;
                const target = Math.max(0, Math.min(dur, cur + delta));
                commitSeek(target);
            }
        });
    }

    // 5. Host Mode Toggle
    if (toggleHost) {
        const isMobile = window.innerWidth < 768;
        const initialHost = localStorage.getItem('host') !== null 
            ? localStorage.getItem('host') === 'true' 
            : !isMobile;
        toggleHost.checked = initialHost;
        updateUIMode(initialHost);

        toggleHost.addEventListener('change', (e) => {
            const host = e.target.checked;
            localStorage.setItem('host', host);
            updateUIMode(host);
        });
    }

    // 6. Mobile Bottom Navigation
    [
        { el: tabNavNow, key: 'now' },
        { el: tabNavQueue, key: 'queue' },
        { el: tabNavParty, key: 'party' }
    ].forEach(({ el, key }) => {
        if (el) el.addEventListener('click', () => switchMobileTab(key));
    });

    // 7. Top Mobile Tabs
    if (tabCtrl && tabQueue) {
        tabCtrl.addEventListener('click', () => {
            secCtrl?.classList.remove('hidden', 'animate-fade-in-up');
            void secCtrl?.offsetWidth;
            secCtrl?.classList.add('animate-fade-in-up');
            secQueue?.classList.add('hidden');
            tabCtrl.className = 'flex-1 py-2.5 text-xs font-bold text-cyan-400 border-b-2 border-cyan-400 transition-colors duration-200';
            tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-slate-400 border-b-2 border-transparent transition-colors duration-200';
        });

        tabQueue.addEventListener('click', () => {
            secCtrl?.classList.add('hidden');
            secQueue?.classList.remove('hidden', 'animate-fade-in-up');
            void secQueue?.offsetWidth;
            secQueue?.classList.add('animate-fade-in-up');
            tabQueue.className = 'flex-1 py-2.5 text-xs font-bold text-cyan-400 border-b-2 border-cyan-400 transition-colors duration-200';
            tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-slate-400 border-b-2 border-transparent transition-colors duration-200';
        });
    }

    // 8. Reactions
    const reactLove = $('react-love');
    const reactOk = $('react-ok');
    const reactBad = $('react-bad');
    if (reactLove) reactLove.addEventListener('click', () => emitSendReaction('😍'));
    if (reactOk) reactOk.addEventListener('click', () => emitSendReaction('👍'));
    if (reactBad) reactBad.addEventListener('click', () => emitSendReaction('👎'));

    // 9. Danmaku
    const handleSendDanmaku = () => {
        if (!msgInput) return;
        const text = msgInput.value.trim();
        if (!text) return;
        const state = getState();
        const profile = state.myProfile || {
            name: localStorage.getItem('nickname') || 'ผู้ใช้ทั่วไป',
            color: localStorage.getItem('usercolor') || '#ABD2FA',
            avatar: localStorage.getItem('useravatar') || ''
        };

        emitSendDanmaku({
            text: text,
            nickname: profile.name,
            color: profile.color,
            avatar: profile.avatar || '',
            tts: ttsToggle ? ttsToggle.checked : false
        });
        msgInput.value = '';
    };

    if (msgBtn) msgBtn.addEventListener('click', handleSendDanmaku);
    if (msgInput) {
        msgInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSendDanmaku();
        });
    }

    // 10. Theater & Fullscreen Modes
    const theaterBtn = $('theater-btn');
    const fsBtn = $('fs-btn');

    if (theaterBtn) {
        theaterBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    showToast(`Error: ${err.message}`, 'error');
                });
            } else {
                document.exitFullscreen();
            }
        });
    }

    if (fsBtn) {
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement && playerArea) {
                playerArea.requestFullscreen().catch(err => {
                    showToast(`Error: ${err.message}`, 'error');
                });
            } else {
                document.exitFullscreen();
            }
        });
    }

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement === document.documentElement) {
            document.body.classList.add('web-fullscreen');
        } else {
            document.body.classList.remove('web-fullscreen');
        }
    });

    // 11. QR Container Click-to-Copy & Fullscreen Modal Controls
    const qrModal = $('qr-modal');
    const closeQrModalBtn = $('close-qr-modal-btn');
    const modalCopyLinkBtn = $('modal-copy-link-btn');
    const headerQrBtn = $('header-qr-btn');
    const asideQrBtn = $('aside-qr-btn');
    const playerQrBadge = $('player-qr-badge');

    const handleCopyPartyLink = () => {
        if (!currentPartyLink || !navigator.clipboard) return;
        navigator.clipboard.writeText(currentPartyLink).then(() => {
            showToast('คัดลอกลิงก์ปาร์ตี้เรียบร้อย! 📋', 'info');
        }).catch(() => {});
    };

    if (qrContainer) {
        qrContainer.addEventListener('click', () => {
            handleCopyPartyLink();
            openQrModal();
        });
    }

    if (headerQrBtn) headerQrBtn.addEventListener('click', openQrModal);
    if (asideQrBtn) asideQrBtn.addEventListener('click', openQrModal);
    if (playerQrBadge) playerQrBadge.addEventListener('click', openQrModal);

    if (closeQrModalBtn) closeQrModalBtn.addEventListener('click', closeQrModal);
    if (qrModal) {
        qrModal.addEventListener('click', (e) => {
            if (e.target === qrModal) closeQrModal();
        });
    }
    if (modalCopyLinkBtn) modalCopyLinkBtn.addEventListener('click', handleCopyPartyLink);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeQrModal();
    });

    // 12. Idle Auto-Fade Controller
    ['mousemove', 'pointermove', 'mousedown', 'touchstart', 'touchmove', 'keydown', 'wheel'].forEach((evt) => {
        window.addEventListener(evt, resetUserIdleTimer, { passive: true });
    });

    document.addEventListener('mouseleave', () => {
        if (!isInteractiveContextActive()) {
            clearTimeout(userIdleTimer);
            userIdleTimer = setTimeout(() => {
                if (!isInteractiveContextActive()) {
                    document.body.classList.add('user-idle');
                }
            }, 1200);
        }
    });

    resetUserIdleTimer();

    // 13. Settings Modal & Profile Setup
    const headerSettingsBtn = $('header-settings-btn');
    const editProfileBtn = $('edit-profile-btn');
    const myAvatarChip = $('my-avatar-chip');
    const myColorDot = $('my-color-dot');
    const closeSettingsBtn = $('close-settings-btn');
    const settingsModal = $('settings-modal');
    const secretTestUnlockBtn = $('secret-test-unlock-btn');
    const modalGear5Tap = $('modal-gear-5tap');
    const saveProfileBtn = $('save-profile-btn');
    const settingsNameInput = $('settings-name');
    const settingsColorInput = $('settings-color');
    const avatarFileInput = $('settings-avatar-file');
    const avatarClearBtn = $('settings-avatar-clear-btn');

    const handleOpenSettings = () => {
        openSettingsModal();
        registerSecret5Tap();
    };

    if (headerSettingsBtn) headerSettingsBtn.addEventListener('click', handleOpenSettings);
    if (editProfileBtn) editProfileBtn.addEventListener('click', handleOpenSettings);
    if (myAvatarChip) {
        myAvatarChip.classList.add('cursor-pointer');
        myAvatarChip.addEventListener('click', handleOpenSettings);
    }
    if (myColorDot) {
        myColorDot.classList.add('cursor-pointer');
        myColorDot.title = 'คลิกเพื่อแก้ไขโปรไฟล์ & สีประจำตัว';
        myColorDot.addEventListener('click', handleOpenSettings);
    }
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) closeSettingsModal();
        });
    }
    if (secretTestUnlockBtn) secretTestUnlockBtn.addEventListener('click', registerSecret5Tap);
    if (modalGear5Tap) modalGear5Tap.addEventListener('click', registerSecret5Tap);

    // Preset color swatches
    document.querySelectorAll('[data-preset-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const col = btn.getAttribute('data-preset-color');
            if (col && settingsColorInput) {
                settingsColorInput.value = col;
                const previewBadge = $('profile-preview-badge');
                if (previewBadge) {
                    previewBadge.style.color = col;
                    previewBadge.style.borderColor = col;
                }
            }
        });
    });

    if (settingsNameInput) {
        settingsNameInput.addEventListener('input', () => {
            const val = settingsNameInput.value.trim();
            const previewBadge = $('profile-preview-badge');
            if (previewBadge) {
                previewBadge.textContent = val || 'ตัวอย่างชื่อ';
            }
            if (!pendingAvatar) {
                updateAvatarModalPreview('', val);
            }
        });
    }

    // Avatar custom file upload
    if (avatarFileInput) {
        avatarFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                showToast('กำลังประมวลผลรูปภาพ...', 'info');
                const dataUrl = await resizeImageToAvatarDataUrl(file);
                pendingAvatar = dataUrl;
                const currentName = (settingsNameInput?.value || '').trim() || getState().myProfile?.name;
                updateAvatarModalPreview(pendingAvatar, currentName);
                showToast('อัปโหลดรูปโปรไฟล์พร้อมแล้ว! กด "บันทึกข้อมูล" เพื่อเริ่มใช้งาน', 'success');
            } catch (err) {
                showToast(err.message || 'ไม่สามารถอัปโหลดรูปภาพได้', 'error');
            } finally {
                avatarFileInput.value = '';
            }
        });
    }

    // Avatar clear button (revert to initials)
    if (avatarClearBtn) {
        avatarClearBtn.addEventListener('click', () => {
            pendingAvatar = '';
            const currentName = (settingsNameInput?.value || '').trim() || getState().myProfile?.name;
            updateAvatarModalPreview('', currentName);
            showToast('ลบรูปโปรไฟล์แล้ว (ใช้ตัวอักษรเริ่มต้นแทน)', 'info');
        });
    }

    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => {
            const name = (settingsNameInput?.value || '').trim().substring(0, 25);
            if (!name) return showToast('กรุณาใส่ชื่อเล่นของคุณ', 'error');

            const state = getState();
            const chosenAvatar = pendingAvatar !== null ? pendingAvatar : (state.myProfile?.avatar || '');

            const profile = {
                name: name,
                color: safeColor(settingsColorInput?.value || '#ABD2FA'),
                avatar: chosenAvatar
            };

            setMyProfile(profile);
            updateProfileUI();
            emitSetProfile(profile);
            closeSettingsModal();
            showToast('บันทึกโปรไฟล์เรียบร้อยแล้ว!', 'success');
        });
    }

    // Auto-DJ settings controls
    const settingsAutodjToggle = $('settings-autodj-toggle');
    const settingsAutodjMode = $('settings-autodj-mode');
    const settingsAutodjCustom = $('settings-autodj-custom');
    const settingsAutodjCustomBtn = $('settings-autodj-custom-btn');
    const settingsAutodjPlayNowBtn = $('settings-autodj-play-now-btn');

    if (settingsAutodjToggle) {
        settingsAutodjToggle.addEventListener('change', (e) => {
            emitAutoDjConfig({ enabled: e.target.checked });
        });
    }
    if (settingsAutodjMode) {
        settingsAutodjMode.addEventListener('change', (e) => {
            if (settingsAutodjCustom) settingsAutodjCustom.value = '';
            emitAutoDjConfig({
                enabled: true,
                mode: e.target.value,
                customQuery: ''
            });
        });
    }
    document.querySelectorAll('[data-autodj-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-autodj-preset');
            if (!preset) return;
            if (settingsAutodjCustom) settingsAutodjCustom.value = '';
            if (settingsAutodjMode) settingsAutodjMode.value = preset;
            emitAutoDjConfig({
                enabled: true,
                mode: preset,
                customQuery: ''
            });
        });
    });
    if (settingsAutodjCustomBtn) {
        settingsAutodjCustomBtn.addEventListener('click', () => {
            const customVal = (settingsAutodjCustom?.value || '').trim().substring(0, 50);
            const modeVal = settingsAutodjMode?.value || getState().autoDjMode || 'khlerm';
            emitAutoDjConfig({
                enabled: true,
                mode: modeVal,
                customQuery: customVal
            });
        });
    }
    if (settingsAutodjCustom) {
        settingsAutodjCustom.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && settingsAutodjCustomBtn) {
                settingsAutodjCustomBtn.click();
            }
        });
    }
    if (settingsAutodjPlayNowBtn) {
        settingsAutodjPlayNowBtn.addEventListener('click', () => {
            const modeVal = settingsAutodjMode?.value || getState().autoDjMode || 'khlerm';
            const customVal = (settingsAutodjCustom?.value || '').trim().substring(0, 50);
            closeSettingsModal();
            showToast('🎧 กำลังสุ่มหาเพลง Auto-DJ ตามโหมดที่เลือก...', 'info');
            emitAutoDjPlayNow({
                mode: modeVal,
                customQuery: customVal
            });
        });
    }

    // 14. Test Lab Simulation Buttons
    const btnTestPartyFx = $('btn-test-party-fx');
    const btnTestIntro = $('btn-test-intro');

    if (btnTestPartyFx) {
        btnTestPartyFx.addEventListener('click', () => {
            closeSettingsModal();
            const state = getState();
            emitSendDanmaku({
                text: '🎉 ทดสอบระบบข้อความวิ่ง & เสียงแจ้งเตือน MAITEMBATH GANG PARTY!',
                nickname: state.myProfile?.name || 'System Test',
                color: state.myProfile?.color || '#ABD2FA',
                tts: true
            });
            ['😍', '🎉', '🔥', '👍'].forEach((em, i) => {
                setTimeout(() => emitSendReaction(em), i * 250);
            });
            showToast('✨ ส่งเอฟเฟกต์ข้อความวิ่งและอีโมจิทดสอบแล้ว!', 'info');
        });
    }

    if (btnTestIntro) {
        btnTestIntro.addEventListener('click', () => {
            closeSettingsModal();
            startIntroSequence(true);
        });
    }

    // 15. Window Resize Handler
    window.addEventListener('resize', () => {
        const state = getState();
        if (!state.hostMode) {
            updateUIMode(false);
        }
    });

    // 16. Inbound Socket Events wiring
    const socket = getSocket();
    if (socket) {
        socket.on('show-toast-broadcast', (msg) => {
            if (msg) showToast(msg, 'info');
        });
        socket.on('new-reaction', (emoji) => {
            if (emoji) spawnFloatingReaction(emoji);
        });
        socket.on('new-danmaku', (data) => {
            if (data) {
                spawnDanmaku(data);
                const state = getState();
                if (state.hostMode && data.tts && typeof speakThaiText === 'function') {
                    speakThaiText((data.text || '').substring(0, 70), true);
                }
            }
        });
        socket.on('error-msg', (msg) => {
            if (msg) showToast(msg, 'error');
        });
        socket.on('users-update', (users) => {
            updateUsersList(users);
        });
        socket.on('time-update', (data) => {
            if (!data) return;
            if (!isHostMode()) {
                updateProgress(data.currentTime, data.duration);
            }
        });
    }

    // Reactive State Subscriptions
    onStateChange((state) => {
        renderNowPlaying(state.currentVideo, state.isPlaying);
        updateVolumeUI(state.volume);
        updateQualityUI(state.quality);
        if (state.currentTime !== undefined && state.duration !== undefined) {
            updateProgress(state.currentTime, state.duration);
        }
        if (state.users) {
            updateUsersList(state.users);
        }
        if (state.serverInfo) {
            renderQrCode(state.serverInfo.localIp, state.serverInfo.port);
        }
    });

    updateProfileUI();
    initGenesisTheme();

    // 14. Real-time Connection Status Dot & Badge
    onConnectionChange((status) => {
        updateConnectionStatus(status);
    });
    updateConnectionStatus(getState().connectionStatus);
}

export function updateConnectionStatus(status) {
    const statusBadge = $('status-badge');
    const statusDot = $('status-dot');
    const statusText = $('status-text');
    if (!statusBadge) return;

    if (status === 'connected') {
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]';
        if (statusText) statusText.textContent = 'ออนไลน์';
        statusBadge.className = 'h-8 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium text-slate-300 transition select-none';

        // Guest Welcome Banner on QR Room Connect
        const state = getState();
        if (!state.hostMode && !hasWelcomedGuest) {
            hasWelcomedGuest = true;
            showToast('🎉 เข้าปาร์ตี้แล้ว! เลือกเพลงแรกของคุณได้เลย 🎶', 'info', 4500);
            const urlInput = $('url-input');
            if (urlInput) {
                setTimeout(() => urlInput.focus(), 600);
            }
        }
    } else if (status === 'connecting') {
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        if (statusText) statusText.textContent = 'กำลังเชื่อมต่อ...';
        statusBadge.className = 'h-8 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium text-amber-300 transition select-none';
    } else {
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-red-400';
        if (statusText) statusText.textContent = 'ออฟไลน์';
        statusBadge.className = 'h-8 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium text-red-400 transition select-none';
    }
}

// Dual alias for main bootstrapping compatibility
export const initUIController = initUI;
