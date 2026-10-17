/**
 * MAITEMBATH GANG PARTY - Synced Lyrics & Karaoke Module (public/js/lyrics.js)
 * 
 * Synchronized LRC parser, 100ms ticker, dynamic left-to-right karaoke text-wipe gradient,
 * vertical scrolling overlay reel, inline list, and mobile remote lyrics.
 */

import { getState, isHostMode, onStateChange } from './state.js';
import { 
    getSocket, 
    emitSeekTo, 
    emitSendDanmaku, 
    emitTriggerNavAlert, 
    emitSendReaction, 
    emitToggleKaraokeMode, 
    emitSyncNavState 
} from './socket.js';
import { getPrecisePlaybackTime } from './audio.js';
import { showToast, formatTime, escapeHtml } from './ui.js';

// DOM selector helper
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// --- Internal Lyrics State ---
let lyricsVisible = true;
let overlayDismissedForTrack = false;
let lyricsCinemaMode = false;
let inlineLyricsExpanded = false;
let currentLyricsTrackKey = null;
let currentLyricsData = null; // { found, synced, lines: [{ time, text }], source }
let currentActiveLyricIdx = -1;
let karaokeSwitchPending = false;
let inlineLyricsScrollRaf = null;
let isAutoScrollingInlineLyrics = false;
let userManualScrollUntil = 0;
let lastKnownPlaybackTime = 0;
let lastPlaybackSyncPerf = (typeof performance !== 'undefined') ? performance.now() : Date.now();
let lyricSpotlightFadeTimer = null;

export const LYRICS_BASE_DELAY_SEC = 2.0;
let lyricsUserShiftSec = 0.0;

export function getEffectiveLyricDelaySec() {
    return LYRICS_BASE_DELAY_SEC + lyricsUserShiftSec;
}

export function getCurrentLyricsData() {
    return currentLyricsData;
}

export function updateLyricOffsetBadges() {
    const totalDelay = getEffectiveLyricDelaySec();
    const displayVal = -totalDelay;
    const formatted = `${displayVal > 0 ? '+' : ''}${displayVal.toFixed(1)}s`;
    const lyricsOverlayOffsetLabel = $('lyrics-overlay-offset-label');
    const inlineLyricsOffsetBadge = $('inline-lyrics-offset-badge');
    if (lyricsOverlayOffsetLabel) lyricsOverlayOffsetLabel.textContent = formatted;
    if (inlineLyricsOffsetBadge) inlineLyricsOffsetBadge.textContent = formatted;
}

export function setLyricsPanelsFadeState(showOverlay, _showInlineUnused, canShowOnScreen = false) {
    const lyricsOverlay = $('lyrics-overlay');
    const btnToggleLyrics = $('btn-toggle-lyrics');
    const btnLyricsLabel = $('btn-lyrics-label');
    const lyricsRestorePill = $('lyrics-restore-pill');
    const playerLyricsBtn = $('player-lyrics-btn');
    const playerLyricsBtnLabel = $('player-lyrics-btn-label');

    const nextOverlayActive = Boolean(showOverlay);
    const hasActiveTrackLyrics = Boolean(canShowOnScreen);

    if (lyricsOverlay) {
        lyricsOverlay.classList.remove('hidden');
        const wasActive = lyricsOverlay.classList.contains('lyrics-overlay-active');
        lyricsOverlay.classList.toggle('lyrics-overlay-active', nextOverlayActive);
        if (!wasActive && nextOverlayActive && currentActiveLyricIdx >= 0) {
            setTimeout(() => smoothScrollOverlayReelToActive(currentActiveLyricIdx), 40);
        }
    }

    const isOverlayEnabledByUser = Boolean(lyricsVisible && !overlayDismissedForTrack);
    btnToggleLyrics.className = isOverlayEnabledByUser
        ? 'h-7 px-2.5 rounded-[6px] bg-indigo-600 text-white border border-indigo-500 flex items-center gap-1.5 text-[11px] font-semibold transition active:scale-95 shadow-sm'
        : 'h-7 px-2.5 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] text-[var(--genesis-text-secondary,#6B6B6B)] hover:text-[var(--genesis-text-primary,#0A0A0A)] hover:bg-[var(--genesis-surface,#FFFFFF)] border border-[var(--genesis-border,#E8E8EC)] flex items-center gap-1.5 text-[11px] font-medium transition active:scale-95';
    if (btnLyricsLabel) {
        btnLyricsLabel.textContent = isOverlayEnabledByUser ? 'เนื้อเพลง (เปิด)' : 'เนื้อเพลง';
        btnLyricsLabel.className = 'text-[11px]';
    }

    if (lyricsRestorePill) {
        lyricsRestorePill.classList.toggle('lyrics-btn-fade-active', hasActiveTrackLyrics && !nextOverlayActive);
    }

    if (playerLyricsBtn) {
        playerLyricsBtn.classList.toggle('lyrics-btn-fade-active', hasActiveTrackLyrics);
        playerLyricsBtn.classList.toggle('bg-brand-peri', nextOverlayActive);
        playerLyricsBtn.classList.toggle('text-primary', nextOverlayActive);
        playerLyricsBtn.classList.toggle('border-brand-peri', nextOverlayActive);
        playerLyricsBtn.classList.toggle('font-semibold', nextOverlayActive);
        playerLyricsBtn.classList.toggle('bg-[#0a0a0a]/80', !nextOverlayActive);
        playerLyricsBtn.classList.toggle('text-brand-light/85', !nextOverlayActive);
        playerLyricsBtn.classList.toggle('border-brand-deep/50', !nextOverlayActive);
    }
    if (playerLyricsBtnLabel) {
        playerLyricsBtnLabel.textContent = nextOverlayActive ? 'ซ่อนบนจอ' : 'แสดงขึ้นจอ';
    }
}

export function showLyricSpotlightFade(lyricLine, senderName = 'นักร้องนำ') {
    const lyricSpotlightBanner = $('lyric-spotlight-banner');
    const lyricSpotlightUser = $('lyric-spotlight-user');
    const lyricSpotlightText = $('lyric-spotlight-text');

    if (!lyricSpotlightBanner || !lyricLine) return;
    if (lyricSpotlightUser) {
        lyricSpotlightUser.textContent = `🎤 ${senderName} • แสดงเนื้อเพลงขึ้นจอ`;
    }
    if (lyricSpotlightText) {
        lyricSpotlightText.textContent = `♪ ${lyricLine} ♪`;
    }
    lyricSpotlightBanner.classList.add('spotlight-fade-active');
    if (lyricSpotlightFadeTimer) clearTimeout(lyricSpotlightFadeTimer);
    lyricSpotlightFadeTimer = setTimeout(() => {
        lyricSpotlightBanner.classList.remove('spotlight-fade-active');
    }, 3800);
}

export function adjustLyricSyncOffset(action, skipSync = false) {
    if (action === 'reset') {
        lyricsUserShiftSec = 0.0;
        showToast('⏱️ รีเซ็ตจังหวะเนื้อเพลงเป็นค่ามาตรฐาน (ช้าลง 2.0 วินาที)', 'info');
    } else {
        const delta = parseFloat(action);
        if (!isNaN(delta)) {
            lyricsUserShiftSec = Math.max(-8.0, Math.min(10.0, lyricsUserShiftSec - delta));
            const totalDelay = getEffectiveLyricDelaySec();
            const desc = totalDelay >= 0
                ? `ช้าลง ${totalDelay.toFixed(1)} วินาที`
                : `เร็วขึ้น ${Math.abs(totalDelay).toFixed(1)} วินาที`;
            showToast(`⏱️ ปรับจังหวะเนื้อเพลง: ${desc}`, 'info');
        }
    }
    updateLyricOffsetBadges();
    updateActiveLyricLine(getPrecisePlaybackTime(), true);
    if (!skipSync) emitLyricsStateSync();
}

function smoothScrollOverlayReelToActive(activeIdx) {
    const lyricsReelViewport = $('lyrics-reel-viewport');
    const lyricsReelTrack = $('lyrics-reel-track');
    if (!lyricsReelViewport || !lyricsReelTrack) return;
    const activeItem = lyricsReelTrack.querySelector(`[data-reel-idx="${activeIdx}"]`);
    if (!activeItem) return;

    const viewportHeight = lyricsReelViewport.clientHeight || (lyricsCinemaMode ? 176 : 96);
    const itemCenter = activeItem.offsetTop + (activeItem.offsetHeight / 2);
    const translateY = (viewportHeight / 2) - itemCenter;
    lyricsReelTrack.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
}

function smoothScrollInlineLyricsToCenter(activeEl, immediate = false, forceOverrideManual = false) {
    const container = $('inline-lyrics-scroll') || $('inline-lyrics-box');
    const btnLyricsRecenter = $('btn-lyrics-recenter');
    if (!container || !activeEl) return;

    if (!forceOverrideManual && !immediate && Date.now() < userManualScrollUntil) {
        return;
    }
    if (btnLyricsRecenter) btnLyricsRecenter.classList.add('hidden');

    const targetTop = Math.max(
        0,
        activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.offsetHeight / 2)
    );

    if (immediate) {
        if (inlineLyricsScrollRaf) cancelAnimationFrame(inlineLyricsScrollRaf);
        isAutoScrollingInlineLyrics = true;
        container.scrollTop = targetTop;
        setTimeout(() => { isAutoScrollingInlineLyrics = false; }, 40);
        return;
    }

    const startTop = container.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 2) return;

    if (inlineLyricsScrollRaf) cancelAnimationFrame(inlineLyricsScrollRaf);
    const duration = 500;
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3.6);
        isAutoScrollingInlineLyrics = true;
        container.scrollTop = startTop + distance * eased;
        if (progress < 1) {
            inlineLyricsScrollRaf = requestAnimationFrame(step);
        } else {
            inlineLyricsScrollRaf = null;
            setTimeout(() => { isAutoScrollingInlineLyrics = false; }, 40);
        }
    }
    inlineLyricsScrollRaf = requestAnimationFrame(step);
}

export function updateLyricsToggleButtonsUI() {
    const state = getState();
    const hasValidLyrics = Boolean(
        state.currentVideo &&
        currentLyricsData &&
        currentLyricsData.found &&
        Array.isArray(currentLyricsData.lines) &&
        currentLyricsData.lines.length > 0
    );
    if (!hasValidLyrics) {
        setLyricsPanelsFadeState(false, false, false);
    } else if (!lyricsVisible || overlayDismissedForTrack) {
        setLyricsPanelsFadeState(false, false, true);
    } else {
        updateActiveLyricLine(getPrecisePlaybackTime(), true);
    }
}

export function toggleLyricsDisplay(forceState, skipSync = false) {
    const currentlyEnabled = Boolean(lyricsVisible && !overlayDismissedForTrack);
    const nextState = typeof forceState === 'boolean' ? forceState : !currentlyEnabled;
    lyricsVisible = nextState;
    overlayDismissedForTrack = !nextState;
    updateLyricsToggleButtonsUI();
    if (!skipSync) emitLyricsStateSync();

    const state = getState();
    if (nextState && state.currentVideo) {
        if (!currentLyricsData) {
            syncLyricsForCurrentTrack(true);
        } else if (!currentLyricsData.found || !Array.isArray(currentLyricsData.lines) || currentLyricsData.lines.length === 0) {
            setLyricsPanelsFadeState(false, false, false);
            showToast('🎵 เพลงนี้ไม่มีข้อมูลเนื้อเพลงในระบบ แผงเนื้อเพลงจึงถูกซ่อนไว้อัตโนมัติ', 'info');
        } else {
            updateActiveLyricLine(getPrecisePlaybackTime(), true);
            setTimeout(() => {
                if (currentActiveLyricIdx >= 0) smoothScrollOverlayReelToActive(currentActiveLyricIdx);
            }, 60);
        }
    }
}

export function toggleVideoOverlayLyrics(forceShow) {
    toggleLyricsDisplay(forceShow);
}

export function updateKaraokeButtonUI() {
    karaokeSwitchPending = false;
    const state = getState();
    const lyricsKaraokePill = $('lyrics-karaoke-pill');
    const btnKaraokeSwitch = $('btn-karaoke-switch');
    const btnKaraokeLabel = $('btn-karaoke-label');

    const isKaraoke = Boolean(state.currentVideo?.isKaraokeMode);
    if (lyricsKaraokePill) {
        lyricsKaraokePill.classList.toggle('hidden', !isKaraoke);
    }
    if (!btnKaraokeSwitch || !btnKaraokeLabel) return;
    const hasVideo = Boolean(state.currentVideo);
    btnKaraokeSwitch.disabled = !hasVideo;

    if (!hasVideo) {
        btnKaraokeSwitch.className = 'h-8 px-3 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] text-[var(--genesis-text-muted,#9C9C9C)] border border-[var(--genesis-border,#E8E8EC)] flex items-center justify-center gap-1.5 text-xs font-medium opacity-50 cursor-not-allowed whitespace-nowrap';
        btnKaraokeSwitch.title = 'โหมดคาราโอเกะ (จะเปิดใช้งานได้เมื่อมีเพลงกำลังเล่น)';
        btnKaraokeLabel.textContent = 'คาราโอเกะ';
        btnKaraokeLabel.className = 'text-xs truncate';
    } else if (isKaraoke) {
        btnKaraokeSwitch.className = 'h-8 px-3 rounded-[6px] bg-indigo-600 text-white border border-indigo-500 flex items-center justify-center gap-1.5 text-xs font-semibold transition active:scale-95 shadow-sm whitespace-nowrap';
        btnKaraokeSwitch.title = 'คาราโอเกะ (เปิดอยู่) - คลิกเพื่อกลับเพลงต้นฉบับ';
        btnKaraokeLabel.textContent = 'คาราโอเกะ (เปิด)';
        btnKaraokeLabel.className = 'text-xs truncate';
    } else {
        btnKaraokeSwitch.className = 'h-8 px-3 rounded-[6px] bg-[var(--genesis-surface-subtle,#F4F4F6)] text-[var(--genesis-text-secondary,#6B6B6B)] hover:text-[var(--genesis-text-primary,#0A0A0A)] hover:bg-[var(--genesis-surface,#FFFFFF)] border border-[var(--genesis-border,#E8E8EC)] flex items-center justify-center gap-1.5 text-xs font-medium transition active:scale-95 whitespace-nowrap';
        btnKaraokeSwitch.title = 'สลับโหมดคาราโอเกะ (ตัดเสียงร้อง)';
        btnKaraokeLabel.textContent = 'คาราโอเกะ';
        btnKaraokeLabel.className = 'text-xs truncate';
    }
}

export function emitLyricsStateSync() {
    emitSyncNavState({
        lyricsVisible: lyricsVisible,
        lyricsOverlayDismissed: overlayDismissedForTrack,
        lyricsUserShiftSec: lyricsUserShiftSec,
        lyricsCinemaMode: lyricsCinemaMode
    });
}

export function applyRemoteLyricsState(remote) {
    if (!remote || typeof remote !== 'object') return;
    let lyricsStateChanged = false;

    if (typeof remote.lyricsVisible === 'boolean') {
        const remoteEffectivelyVisible = remote.lyricsVisible && !Boolean(remote.lyricsOverlayDismissed);
        const localEffectivelyVisible = lyricsVisible && !overlayDismissedForTrack;
        if (remoteEffectivelyVisible !== localEffectivelyVisible) {
            lyricsVisible = remote.lyricsVisible;
            overlayDismissedForTrack = Boolean(remote.lyricsOverlayDismissed);
            lyricsStateChanged = true;
        }
    }
    if (typeof remote.lyricsUserShiftSec === 'number' && remote.lyricsUserShiftSec !== lyricsUserShiftSec) {
        lyricsUserShiftSec = remote.lyricsUserShiftSec;
        updateLyricOffsetBadges();
        updateActiveLyricLine(getPrecisePlaybackTime(), true);
    }
    if (typeof remote.lyricsCinemaMode === 'boolean' && remote.lyricsCinemaMode !== lyricsCinemaMode) {
        lyricsCinemaMode = remote.lyricsCinemaMode;
        const lyricsOverlay = $('lyrics-overlay');
        if (lyricsOverlay) lyricsOverlay.classList.toggle('lyrics-cinema-mode', lyricsCinemaMode);
        setTimeout(() => { if (currentActiveLyricIdx >= 0) smoothScrollOverlayReelToActive(currentActiveLyricIdx); }, 60);
    }
    if (lyricsStateChanged) {
        updateLyricsToggleButtonsUI();
    }
}

function updateVocalCountdownUI(effectiveTime, lines, activeIdx) {
    if (!lines || lines.length === 0) return;
    let upcomingTime = -1;
    let gapSpan = 0;

    const firstLineTime = Number(lines[0]?.time) || 0;
    if (effectiveTime < firstLineTime) {
        upcomingTime = firstLineTime;
        gapSpan = firstLineTime;
    } else if (activeIdx + 1 < lines.length) {
        const curStart = Number(lines[activeIdx]?.time) || 0;
        const nextStart = Number(lines[activeIdx + 1]?.time) || 0;
        gapSpan = nextStart - curStart;
        upcomingTime = nextStart;
    }

    const remain = upcomingTime - effectiveTime;
    const showCountdown = gapSpan >= 4.5 && remain <= 3.5 && remain > 0.15;
    const lyricsCountdownPill = $('lyrics-countdown-pill');
    const inlineLyricsCountdown = $('inline-lyrics-countdown');

    if (showCountdown) {
        const secCeil = Math.ceil(remain);
        const dots = '•'.repeat(Math.max(1, Math.min(3, secCeil)));
        const badgeText = `🎤 เตรียมร้องใน ${secCeil} วิ ${dots}`;
        const shortText = `🎤 ${secCeil}..`;
        if (lyricsCountdownPill) {
            lyricsCountdownPill.textContent = badgeText;
            lyricsCountdownPill.classList.remove('hidden');
        }
        if (inlineLyricsCountdown) {
            inlineLyricsCountdown.textContent = shortText;
            inlineLyricsCountdown.classList.remove('hidden');
        }
    } else {
        if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
        if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');
    }
}

export async function syncLyricsForCurrentTrack(forceFetch = false) {
    const state = getState();
    const lyricsLineProgress = $('lyrics-line-progress');
    const lyricsCountdownPill = $('lyrics-countdown-pill');
    const inlineLyricsCountdown = $('inline-lyrics-countdown');
    const inlineLyricsList = $('inline-lyrics-list');
    const mobileLyricPrev = $('mobile-lyric-prev');
    const mobileLyricActive = $('mobile-lyric-active');
    const mobileLyricNext = $('mobile-lyric-next');
    const inlineLyricsSource = $('inline-lyrics-source');
    const lyricsReelTrack = $('lyrics-reel-track');
    const lyricsReelViewport = $('lyrics-reel-viewport');
    const lyricsFallbackStage = $('lyrics-fallback-stage');
    const btnLyricsRecenter = $('btn-lyrics-recenter');

    if (!state.currentVideo) {
        currentLyricsTrackKey = null;
        currentLyricsData = null;
        currentActiveLyricIdx = -1;
        overlayDismissedForTrack = false;
        setLyricsPanelsFadeState(false, false);
        if (lyricsLineProgress) lyricsLineProgress.style.width = '0%';
        if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
        if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');
        if (inlineLyricsList) inlineLyricsList.innerHTML = '';
        if (mobileLyricPrev) mobileLyricPrev.textContent = '...';
        if (mobileLyricActive) mobileLyricActive.textContent = '♪ ยังไม่มีเพลงเล่น ♪';
        if (mobileLyricNext) mobileLyricNext.textContent = '...';
        return;
    }

    const baseTitle = state.currentVideo.originalTitle || state.currentVideo.normalTitle || state.currentVideo.title || '';
    const baseAuthor = state.currentVideo.normalAuthor || state.currentVideo.author || '';
    const trackKey = `${state.currentVideo.id || ''}:${baseTitle}`;

    if (state.currentVideo.isKaraokeMode && !lyricsVisible) {
        lyricsVisible = true;
        overlayDismissedForTrack = false;
    }

    if (!forceFetch && trackKey === currentLyricsTrackKey && currentLyricsData) {
        updateLyricsToggleButtonsUI();
        return;
    }

    currentLyricsTrackKey = trackKey;
    currentLyricsData = null;
    currentActiveLyricIdx = -1;
    overlayDismissedForTrack = false;
    userManualScrollUntil = 0;
    if (btnLyricsRecenter) btnLyricsRecenter.classList.add('hidden');

    setLyricsPanelsFadeState(false, false);
    if (lyricsLineProgress) lyricsLineProgress.style.width = '0%';
    if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
    if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');

    try {
        const dur = Math.round(state.duration || 220);
        const qs = new URLSearchParams({
            title: baseTitle,
            author: baseAuthor,
            duration: String(dur)
        });
        const resp = await fetch(`/api/lyrics?${qs.toString()}`);
        const data = await resp.json();

        if (currentLyricsTrackKey !== trackKey) return;
        currentLyricsData = data;

        if (inlineLyricsSource) {
            inlineLyricsSource.textContent = data.found
                ? (data.synced ? 'LRC ซิงค์' : 'Auto-Sync')
                : 'ไม่พบ';
        }

        if (!data.found || !Array.isArray(data.lines) || data.lines.length === 0) {
            setLyricsPanelsFadeState(false, false);
            if (lyricsLineProgress) lyricsLineProgress.style.width = '0%';
            if (inlineLyricsList) inlineLyricsList.innerHTML = '';
            return;
        }

        if (lyricsReelTrack && lyricsReelViewport) {
            if (lyricsFallbackStage) lyricsFallbackStage.classList.add('hidden');
            lyricsReelViewport.classList.remove('hidden');
            lyricsReelTrack.innerHTML = data.lines.map((line, idx) => `
                <div data-reel-idx="${idx}" data-lyric-time="${Number(line.time) || 0}" class="lyrics-reel-item reel-far text-center w-full">
                    <span class="reel-lyric-text text-xs sm:text-base md:text-lg font-semibold leading-snug block truncate px-2">${escapeHtml(line.text)}</span>
                </div>
            `).join('');

            lyricsReelTrack.querySelectorAll('[data-lyric-time]').forEach((el) => {
                el.addEventListener('click', () => {
                    const sec = parseFloat(el.getAttribute('data-lyric-time'));
                    if (!isNaN(sec)) {
                        emitSeekTo(Math.max(0, sec + getEffectiveLyricDelaySec()));
                    }
                });
            });
        }

        if (inlineLyricsList) {
            inlineLyricsList.innerHTML = data.lines.map((line, idx) => {
                const lineSec = Math.max(0, (Number(line.time) || 0) + getEffectiveLyricDelaySec());
                return `
                <div data-lyric-idx="${idx}" data-lyric-time="${Number(line.time) || 0}" class="lyric-inline-item lyric-upcoming text-[11px] text-brand-light/55 hover:text-white cursor-pointer py-1.5 px-2.5 rounded-lg flex items-center gap-2 text-left">
                    <span class="text-[9px] font-mono text-brand-light/35 shrink-0">${formatTime(lineSec)}</span>
                    <span class="inline-lyric-text relative z-10 flex-1 leading-snug">${escapeHtml(line.text)}</span>
                    <span class="lyric-inline-progress" style="width: 0%"></span>
                </div>
            `;
            }).join('');

            inlineLyricsList.querySelectorAll('[data-lyric-time]').forEach((el) => {
                el.addEventListener('click', () => {
                    const sec = parseFloat(el.getAttribute('data-lyric-time'));
                    if (!isNaN(sec)) {
                        userManualScrollUntil = 0;
                        if (btnLyricsRecenter) btnLyricsRecenter.classList.add('hidden');
                        emitSeekTo(Math.max(0, sec + getEffectiveLyricDelaySec()));
                    }
                });
            });
        }

        updateActiveLyricLine(getPrecisePlaybackTime(), true);
    } catch (err) {
        console.warn('Lyrics fetch error:', err.message);
        setLyricsPanelsFadeState(false, false);
    }
}

export function updateActiveLyricLine(currentTimeSec, forceRender = false, isTicker = false) {
    if (typeof currentTimeSec === 'number' && !isNaN(currentTimeSec) && !forceRender && !isTicker) {
        lastKnownPlaybackTime = currentTimeSec;
        lastPlaybackSyncPerf = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    }

    if (!currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines) || currentLyricsData.lines.length === 0) {
        setLyricsPanelsFadeState(false, false, false);
        return;
    }

    const lines = currentLyricsData.lines;
    const rawTime = Number(currentTimeSec) || 0;
    const t = Math.max(0, rawTime - getEffectiveLyricDelaySec());
    const state = getState();

    const lastLineTime = Number(lines[lines.length - 1]?.time) || 0;
    const lastLineHoldSec = 6.0;
    const isLyricsEnded = (t > lastLineTime + lastLineHoldSec) || (state.duration > 20 && rawTime >= state.duration - 1.5);

    const canShowOnScreen = Boolean(state.currentVideo) && !isLyricsEnded;
    const shouldShowOverlay = canShowOnScreen && lyricsVisible && !overlayDismissedForTrack;
    setLyricsPanelsFadeState(shouldShowOverlay, shouldShowOverlay, canShowOnScreen);

    const lyricsCountdownPill = $('lyrics-countdown-pill');
    const inlineLyricsCountdown = $('inline-lyrics-countdown');
    const mobileLyricPrev = $('mobile-lyric-prev');
    const mobileLyricActive = $('mobile-lyric-active');
    const mobileLyricNext = $('mobile-lyric-next');
    const lyricsLineProgress = $('lyrics-line-progress');
    const lyricsReelTrack = $('lyrics-reel-track');
    const inlineLyricsList = $('inline-lyrics-list');
    const lyricsLinePrev = $('lyrics-line-prev');
    const lyricsLineActive = $('lyrics-line-active');
    const lyricsLineNext = $('lyrics-line-next');

    if (isLyricsEnded) {
        if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
        if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');
        if (mobileLyricPrev) mobileLyricPrev.textContent = '...';
        if (mobileLyricActive) mobileLyricActive.textContent = '♪ จบเนื้อเพลง ♪';
        if (mobileLyricNext) mobileLyricNext.textContent = '...';
        return;
    }

    let activeIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        if (t + 0.18 >= lines[i].time) {
            activeIdx = i;
        } else {
            break;
        }
    }

    updateVocalCountdownUI(t, lines, activeIdx);

    const lineStart = Number(lines[activeIdx]?.time) || 0;
    const nextLineStart = activeIdx + 1 < lines.length
        ? Number(lines[activeIdx + 1].time)
        : lineStart + lastLineHoldSec;
    const lineSpan = Math.max(0.8, nextLineStart - lineStart);
    const linePct = Math.min(100, Math.max(0, ((t + 0.12 - lineStart) / lineSpan) * 100));
    const pctStr = `${linePct.toFixed(1)}%`;

    if (lyricsLineProgress) {
        lyricsLineProgress.style.width = pctStr;
    }

    const lineChanged = activeIdx !== currentActiveLyricIdx;
    const prevIdx = currentActiveLyricIdx;
    if (!forceRender && !lineChanged) {
        if (lyricsReelTrack && lyricsVisible) {
            const activeReelText = lyricsReelTrack.querySelector(`[data-reel-idx="${activeIdx}"] .reel-lyric-text`);
            if (activeReelText) {
                activeReelText.style.setProperty('--fill-pct', pctStr);
            }
        }
        if (inlineLyricsList && lyricsVisible) {
            const activeInlineEl = inlineLyricsList.querySelector(`[data-lyric-idx="${activeIdx}"]`);
            if (activeInlineEl) {
                const progBar = activeInlineEl.querySelector('.lyric-inline-progress');
                const textEl = activeInlineEl.querySelector('.inline-lyric-text');
                if (progBar) progBar.style.width = pctStr;
                if (textEl) textEl.style.setProperty('--fill-pct', pctStr);
            }
        }
        return;
    }
    currentActiveLyricIdx = activeIdx;

    const prevLine = activeIdx > 0 ? lines[activeIdx - 1].text : '♪ • • • ♪';
    const currLine = lines[activeIdx]?.text || '♪';
    const nextLine = activeIdx + 1 < lines.length ? lines[activeIdx + 1].text : '♪ • • • ♪';

    if (lyricsLinePrev) lyricsLinePrev.textContent = prevLine;
    if (lyricsLineActive) lyricsLineActive.textContent = currLine;
    if (lyricsLineNext) lyricsLineNext.textContent = nextLine;

    if (mobileLyricPrev) mobileLyricPrev.textContent = prevLine;
    if (mobileLyricActive) mobileLyricActive.textContent = currLine;
    if (mobileLyricNext) mobileLyricNext.textContent = nextLine;

    // 1. Reel update
    if (lyricsReelTrack) {
        const reelItems = lyricsReelTrack.querySelectorAll('.lyrics-reel-item');
        reelItems.forEach((item, idx) => {
            const dist = idx - activeIdx;
            const textEl = item.querySelector('.reel-lyric-text');
            item.classList.remove('reel-active', 'reel-prev', 'reel-next', 'reel-near', 'reel-far');
            if (dist === 0) {
                item.classList.add('reel-active');
                if (textEl) {
                    textEl.className = 'reel-lyric-text karaoke-wipe-text text-sm sm:text-lg md:text-xl font-bold leading-snug block px-2';
                    textEl.style.setProperty('--fill-pct', pctStr);
                }
            } else {
                if (textEl) {
                    textEl.className = 'reel-lyric-text text-xs sm:text-sm md:text-base font-medium text-brand-light/75 leading-snug block truncate px-2';
                    textEl.style.removeProperty('--fill-pct');
                }
                if (dist === -1) item.classList.add('reel-prev');
                else if (dist === 1) item.classList.add('reel-next');
                else if (Math.abs(dist) === 2) item.classList.add('reel-near');
                else item.classList.add('reel-far');
            }
        });
        smoothScrollOverlayReelToActive(activeIdx);
    }

    // 2. Inline list update
    if (inlineLyricsList) {
        const items = inlineLyricsList.querySelectorAll('.lyric-inline-item');
        let activeElement = null;
        items.forEach((el, idx) => {
            const progBar = el.querySelector('.lyric-inline-progress');
            const textEl = el.querySelector('.inline-lyric-text');
            el.classList.remove('lyric-past', 'lyric-active', 'lyric-next', 'lyric-upcoming');
            if (idx < activeIdx) {
                el.classList.add('lyric-past');
                if (progBar) progBar.style.width = '0%';
                if (textEl) {
                    textEl.classList.remove('karaoke-wipe-text');
                    textEl.style.removeProperty('--fill-pct');
                }
            } else if (idx === activeIdx) {
                el.classList.add('lyric-active');
                if (progBar) progBar.style.width = pctStr;
                if (textEl) {
                    textEl.classList.add('karaoke-wipe-text');
                    textEl.style.setProperty('--fill-pct', pctStr);
                }
                activeElement = el;
            } else if (idx === activeIdx + 1) {
                el.classList.add('lyric-next');
                if (progBar) progBar.style.width = '0%';
                if (textEl) {
                    textEl.classList.remove('karaoke-wipe-text');
                    textEl.style.removeProperty('--fill-pct');
                }
            } else {
                el.classList.add('lyric-upcoming');
                if (progBar) progBar.style.width = '0%';
                if (textEl) {
                    textEl.classList.remove('karaoke-wipe-text');
                    textEl.style.removeProperty('--fill-pct');
                }
            }
        });

        if (activeElement && lyricsVisible) {
            smoothScrollInlineLyricsToCenter(activeElement, forceRender && prevIdx === -1);
        }
    }
}

function sendCurrentLyricLineToDanmaku() {
    const state = getState();
    if (!state.currentVideo || !currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines)) {
        return showToast('ยังไม่มีท่อนเนื้อเพลงให้ส่งขึ้นจอ', 'error');
    }
    const idx = Math.max(0, currentActiveLyricIdx);
    const lineObj = currentLyricsData.lines[idx];
    if (!lineObj || !lineObj.text) return;

    const sender = state.myProfile?.name || 'นักร้องนำ';
    showLyricSpotlightFade(lineObj.text, sender);

    emitSendDanmaku({
        text: `🎤 ♪ ${lineObj.text} ♪`,
        nickname: sender,
        color: state.myProfile?.color || '#ABD2FA',
        tts: false
    });

    emitTriggerNavAlert({
        type: 'lyric-spotlight',
        lyricLine: lineObj.text,
        senderName: sender
    });

    emitSendReaction('🎶');
    showToast(`✨ แสดงท่อน "${lineObj.text.slice(0, 28)}..." ขึ้นจอแบบ Fade แล้ว!`, 'info');
}

function copyAllLyricsToClipboard() {
    if (!currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines) || currentLyricsData.lines.length === 0) {
        return showToast('ไม่มีเนื้อเพลงให้คัดลอกสำหรับเพลงนี้', 'error');
    }
    const title = getState().currentVideo?.title || 'เนื้อเพลง';
    const fullText = `🎵 ${title}\n\n` + currentLyricsData.lines.map(l => l.text).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullText).then(() => {
            showToast('📋 คัดลอกเนื้อเพลงทั้งหมดเรียบร้อยแล้ว!', 'info');
        }).catch(() => {
            showToast('ไม่สามารถคัดลอกเนื้อเพลงได้', 'error');
        });
    }
}

export function initLyricsSubsystem() {
    const btnToggleLyrics = $('btn-toggle-lyrics');
    const playerLyricsBtn = $('player-lyrics-btn');
    const lyricsOverlayClose = $('lyrics-overlay-close');
    const btnKaraokeSwitch = $('btn-karaoke-switch');
    const btnKaraokeLabel = $('btn-karaoke-label');
    const btnLyricsSendDanmaku = $('btn-lyrics-send-danmaku');
    const btnInlineLyricsDanmaku = $('btn-inline-lyrics-danmaku');
    const btnMobileSendLyric = $('btn-mobile-send-lyric');
    const btnInlineToggleOverlay = $('btn-inline-toggle-overlay');
    const lyricsRestorePill = $('lyrics-restore-pill');
    const btnInlineLyricsCopy = $('btn-inline-lyrics-copy');
    const btnInlineLyricsExpand = $('btn-inline-lyrics-expand');
    const iconInlineLyricsExpand = $('icon-inline-lyrics-expand');
    const btnLyricsCinema = $('btn-lyrics-cinema');
    const btnLyricsRecenter = $('btn-lyrics-recenter');
    const inlineLyricsScroll = $('inline-lyrics-scroll');

    if (btnToggleLyrics) btnToggleLyrics.addEventListener('click', () => toggleLyricsDisplay());
    if (playerLyricsBtn) playerLyricsBtn.addEventListener('click', () => toggleVideoOverlayLyrics());
    if (lyricsOverlayClose) lyricsOverlayClose.addEventListener('click', () => toggleVideoOverlayLyrics(false));
    if (btnInlineToggleOverlay) btnInlineToggleOverlay.addEventListener('click', () => toggleVideoOverlayLyrics());
    if (lyricsRestorePill) lyricsRestorePill.addEventListener('click', () => toggleVideoOverlayLyrics(true));

    if (btnKaraokeSwitch) {
        btnKaraokeSwitch.addEventListener('click', () => {
            const state = getState();
            if (!state.currentVideo) {
                return showToast('กรุณาเปิดเพลงก่อนสลับโหมดคาราโอเกะ', 'error');
            }
            if (karaokeSwitchPending) return;
            karaokeSwitchPending = true;
            if (btnKaraokeLabel) {
                btnKaraokeLabel.textContent = state.currentVideo.isKaraokeMode ? 'กำลังสลับกลับ...' : 'กำลังหาคาราโอเกะ...';
            }
            if (!state.currentVideo.isKaraokeMode && !lyricsVisible) {
                toggleLyricsDisplay(true);
            }
            emitToggleKaraokeMode();
            setTimeout(() => {
                if (karaokeSwitchPending) updateKaraokeButtonUI();
            }, 6000);
        });
    }

    if (btnLyricsSendDanmaku) btnLyricsSendDanmaku.addEventListener('click', sendCurrentLyricLineToDanmaku);
    if (btnInlineLyricsDanmaku) btnInlineLyricsDanmaku.addEventListener('click', sendCurrentLyricLineToDanmaku);
    if (btnMobileSendLyric) btnMobileSendLyric.addEventListener('click', sendCurrentLyricLineToDanmaku);
    if (btnInlineLyricsCopy) btnInlineLyricsCopy.addEventListener('click', copyAllLyricsToClipboard);

    if (btnInlineLyricsExpand) {
        btnInlineLyricsExpand.addEventListener('click', () => {
            inlineLyricsExpanded = !inlineLyricsExpanded;
            if (inlineLyricsScroll) {
                inlineLyricsScroll.classList.toggle('lyrics-expanded', inlineLyricsExpanded);
            }
            if (iconInlineLyricsExpand) {
                iconInlineLyricsExpand.className = inlineLyricsExpanded
                    ? 'fa-solid fa-down-left-and-up-right-to-center text-[8px] text-brand-peri'
                    : 'fa-solid fa-up-right-and-down-left-from-center text-[8px]';
            }
            setTimeout(() => {
                const inlineLyricsList = $('inline-lyrics-list');
                if (inlineLyricsList && currentActiveLyricIdx >= 0) {
                    const activeEl = inlineLyricsList.querySelector(`[data-lyric-idx="${currentActiveLyricIdx}"]`);
                    if (activeEl) smoothScrollInlineLyricsToCenter(activeEl, false, true);
                }
            }, 180);
        });
    }

    if (btnLyricsCinema) {
        btnLyricsCinema.addEventListener('click', () => {
            lyricsCinemaMode = !lyricsCinemaMode;
            const lyricsOverlay = $('lyrics-overlay');
            if (lyricsOverlay) {
                lyricsOverlay.classList.toggle('lyrics-cinema-mode', lyricsCinemaMode);
            }
            emitLyricsStateSync();
            setTimeout(() => {
                if (currentActiveLyricIdx >= 0) smoothScrollOverlayReelToActive(currentActiveLyricIdx);
            }, 180);
        });
    }

    if (inlineLyricsScroll) {
        const markManualScroll = () => {
            if (isAutoScrollingInlineLyrics) return;
            userManualScrollUntil = Date.now() + 4500;
            if (btnLyricsRecenter) btnLyricsRecenter.classList.remove('hidden');
        };
        inlineLyricsScroll.addEventListener('wheel', markManualScroll, { passive: true });
        inlineLyricsScroll.addEventListener('touchmove', markManualScroll, { passive: true });
    }

    if (btnLyricsRecenter) {
        btnLyricsRecenter.addEventListener('click', () => {
            userManualScrollUntil = 0;
            btnLyricsRecenter.classList.add('hidden');
            const inlineLyricsList = $('inline-lyrics-list');
            if (inlineLyricsList && currentActiveLyricIdx >= 0) {
                const activeEl = inlineLyricsList.querySelector(`[data-lyric-idx="${currentActiveLyricIdx}"]`);
                if (activeEl) smoothScrollInlineLyricsToCenter(activeEl, false, true);
            }
        });
    }

    // Offset buttons (-0.5s, +0.5s, reset)
    document.querySelectorAll('[data-lyric-offset]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = btn.getAttribute('data-lyric-offset');
            adjustLyricSyncOffset(act);
        });
    });

    updateLyricOffsetBadges();

    // 100ms High-Frequency Lyric Ticker
    setInterval(() => {
        const state = getState();
        if (!state.currentVideo || !state.isPlaying || !currentLyricsData || !currentLyricsData.found) return;
        const preciseTime = getPrecisePlaybackTime();
        updateActiveLyricLine(preciseTime, false, true);
    }, 100);

    // Socket Inbound Listeners for Danmaku Lyric Spotlight
    const socket = getSocket();
    if (socket) {
        socket.on('new-danmaku', (d) => {
            if (d && typeof d.text === 'string' && d.text.startsWith('🎤 ♪ ')) {
                const cleanLyric = d.text.replace(/^🎤\s*♪\s*/, '').replace(/\s*♪\s*$/, '').trim();
                if (cleanLyric) {
                    showLyricSpotlightFade(cleanLyric, d.nickname || 'นักร้องนำ');
                }
            }
        });
    }

    // State change subscriptions
    onStateChange((state, changedKeys) => {
        if (changedKeys.includes('currentVideo')) {
            syncLyricsForCurrentTrack(false);
            updateKaraokeButtonUI();
        }
    });

    syncLyricsForCurrentTrack(false);
    updateKaraokeButtonUI();
}

export const initLyrics = initLyricsSubsystem;
