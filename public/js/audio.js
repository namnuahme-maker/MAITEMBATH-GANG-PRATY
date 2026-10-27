/**
 * MAITEMBATH GANG PARTY - Audio & Media Subsystem (public/js/audio.js)
 * 
 * Comprehensive media engine:
 * - Direct HD video/audio stream player (#native-video, #native-audio)
 * - Video/audio drift reconciler
 * - YouTube IFrame API fallback player with automatic embed-error recovery
 * - 3D warp starfield canvas animation & 5-layer Web Audio cinema sound synth
 * - DJ Party Soundboard 6-effect synthesizer with media ducking
 * - Thai TTS audio proxy engine & navigational alert chimes
 * - Canonical getPrecisePlaybackTime() provider
 */

import { getState, isHostMode, onStateChange } from './state.js';
import { 
    getSocket, 
    emitPlayerProgress, 
    emitPlayerVideoEnded, 
    emitResolveErrorAction, 
    emitSendSoundboard,
    onSeekVideo
} from './socket.js';
import { showToast, escapeHtml, updateProgress } from './ui.js';

// DOM selector helper
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// --- Internal Media State ---
let ytPlayer = null;
let playerReady = false;
let directVideoMode = false;
let directVideoId = null;
let directHasSeparateAudio = false;
let directQualityLabel = '1080p HD';
let directAppliedQuality = null;
let directFallbackToEmbedId = null;
let directStreamReadySrcSet = false;
let activePlayerVideoId = null;
let lastLoadedYtVideoId = null;

// Intro & Warp Animation State
let introSoundPlayed = false;
let introDismissed = false;
let introCrossfadeStarted = false;
let introPrestartedNext = false;
let introFadeAudioInterval = null;
let introAutoTimer = null;
let introWatchdogTimer = null;
let warpAnimId = null;
let warpStars = [];
let isWarpingExit = false;

// Web Audio Contexts & Synthesizer State
let softAudioCtx = null;
let audioUnlocked = false;
let ttsAudioEl = null;
let activeTtsBufferSource = null;
let lastChimeTime = 0;
let mediaDuckTimer = null;
let pendingRemoteAlertAudio = null;
let soundboardBadgeTimer = null;

export const SOUNDBOARD_META = {
    airhorn: { emoji: '📢', title: 'แตรลมปาร์ตี้! (Airhorn)' },
    badumtss: { emoji: '🥁', title: 'ตบมุกผ่าง! (Ba-Dum-Tss)' },
    cheer: { emoji: '👏', title: 'เสียงปรบมือเฮลั่น!' },
    siren: { emoji: '🚨', title: 'ไซเรนสายตี้! (Party Siren)' },
    laser: { emoji: '⚡', title: 'เลเซอร์บีม! (Laser Zap)' },
    cricket: { emoji: '🦗', title: 'จิ้งหรีดร้อง... กริบเลย' }
};

// ============================================================================
// 1. CINEMATIC 3D WARP INTRO & WEB AUDIO 5-LAYER SYNTH
// ============================================================================

export function initIntroWarp() {
    initWarpCanvas();
}

function initWarpCanvas() {
    const canvas = $('intro-warp-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    function onResize() {
        if (!canvas) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', onResize);

    const STAR_COUNT = 220;
    warpStars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
        warpStars.push({
            x: (Math.random() - 0.5) * width * 2,
            y: (Math.random() - 0.5) * height * 2,
            z: Math.random() * width,
            pz: Math.random() * width,
            size: Math.random() * 1.6 + 0.6,
            color: Math.random() > 0.35 ? '#ABD2FA' : '#38bdf8'
        });
    }

    let speed = 2.8;

    function renderWarp() {
        if (introDismissed && !isWarpingExit) {
            cancelAnimationFrame(warpAnimId);
            window.removeEventListener('resize', onResize);
            return;
        }

        ctx.fillStyle = 'rgba(2, 4, 8, 0.32)';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;

        if (isWarpingExit) {
            speed = Math.min(speed * 1.14 + 1.2, 45); // Hyperdrive warp burst
        }

        for (let i = 0; i < warpStars.length; i++) {
            const s = warpStars[i];
            s.pz = s.z;
            s.z -= speed;

            if (s.z <= 0) {
                s.z = width;
                s.pz = width;
                s.x = (Math.random() - 0.5) * width * 2;
                s.y = (Math.random() - 0.5) * height * 2;
            }

            const k = 220 / s.z;
            const px = s.x * k + cx;
            const py = s.y * k + cy;

            if (px < 0 || px >= width || py < 0 || py >= height) {
                s.z = width;
                s.pz = width;
                continue;
            }

            const prevK = 220 / s.pz;
            const prevX = s.x * prevK + cx;
            const prevY = s.y * prevK + cy;

            const alpha = Math.min(1, (1 - s.z / width) * 1.3);

            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.size * (1 - s.z / width) * (isWarpingExit ? 2.5 : 1.2);
            ctx.globalAlpha = alpha;

            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(px, py);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(px, py, s.size * 0.75, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        warpAnimId = requestAnimationFrame(renderWarp);
    }

    if (warpAnimId) cancelAnimationFrame(warpAnimId);
    warpAnimId = requestAnimationFrame(renderWarp);
}

export function playSynthesizedIntroSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime + 0.01;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(0.26, now + 0.08);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);
        master.connect(ctx.destination);
        const notes = [
            { frequency: 220, at: 0, duration: 1.55, gain: 0.22 },
            { frequency: 329.63, at: 0.28, duration: 1.75, gain: 0.14 },
            { frequency: 659.25, at: 0.78, duration: 1.35, gain: 0.1 }
        ];
        notes.forEach(({ frequency, at, duration, gain }) => {
            const osc = ctx.createOscillator();
            const envelope = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, now + at);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, now + at);
            envelope.gain.setValueAtTime(0.0001, now + at);
            envelope.gain.exponentialRampToValueAtTime(gain, now + at + 0.04);
            envelope.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
            osc.connect(filter); filter.connect(envelope); envelope.connect(master);
            osc.start(now + at); osc.stop(now + at + duration + 0.04);
        });
        window.setTimeout(() => ctx.close().catch(() => {}), 2700);
    } catch (_) {}
}

export function playIntroSound() {
    if (introSoundPlayed) return;
    introSoundPlayed = true;

    playSynthesizedIntroSound();
}

function triggerIntroCrossfade(isReplay = false) {
    if (introCrossfadeStarted) return;
    introCrossfadeStarted = true;

    const overlay = $('intro-overlay');
    const introVid = $('intro-video');
    if (!overlay) return;

    // Begin smooth 1.7s visual crossfade dissolve
    overlay.classList.add('intro-exit');

    // Ensure underlying player is active and playing
    if (isHostMode() && getState().currentVideo && getState().isPlaying) {
        applyHostModeState();
    }

    // Smooth audio crossfade over 1600ms
    const targetPartyVol = getState().volume ?? 50;
    const startIntroVol = introVid ? (introVid.muted ? 0 : introVid.volume) : 0;
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const crossfadeDuration = 1600;

    clearInterval(introFadeAudioInterval);
    introFadeAudioInterval = setInterval(() => {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / crossfadeDuration);

        // Ramp down intro video audio
        if (introVid && !introVid.muted) {
            introVid.volume = Math.max(0, startIntroVol * (1 - progress));
        }

        // Ramp up underlying host player audio
        if (isHostMode() && getState().currentVideo) {
            const rampVol = Math.round(targetPartyVol * (0.15 + 0.85 * progress));
            setHostPlayerVolume(rampVol);
        }

        if (progress >= 1) {
            clearInterval(introFadeAudioInterval);
            introFadeAudioInterval = null;
            if (introVid) {
                try { introVid.pause(); } catch (_) {}
            }
        }
    }, 50);
}

export function dismissIntro(isReplay = false, isImmediateSkip = false) {
    clearTimeout(introAutoTimer);
    clearTimeout(introWatchdogTimer);
    introAutoTimer = null;
    introWatchdogTimer = null;
    clearInterval(introFadeAudioInterval);
    introFadeAudioInterval = null;

    const overlay = $('intro-overlay');
    const introVid = $('intro-video');
    const unmuteBtn = $('intro-unmute-btn');

    if (unmuteBtn) unmuteBtn.classList.add('hidden');

    if (introVid) {
        try { introVid.pause(); } catch (_) {}
    }

    introDismissed = true;

    if (overlay) {
        if (isImmediateSkip) {
            overlay.classList.add('intro-fast-exit', 'hidden');
            overlay.classList.remove('flex');
            overlay.style.setProperty('display', 'none', 'important');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
        } else {
            overlay.classList.add('intro-exit');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                    overlay.style.setProperty('display', 'none', 'important');
                }
            }, 300);
        }
    }

    if (warpAnimId) {
        cancelAnimationFrame(warpAnimId);
        warpAnimId = null;
    }

    if (isHostMode() && getState().currentVideo) {
        applyHostModeState();
        setHostPlayerVolume(getState().volume ?? 50);
    }
}

if (typeof window !== 'undefined') {
    window.__introDismissCallback = (isImmediate) => {
        dismissIntro(false, isImmediate);
    };
}

export function startIntroSequence(isReplay = false) {
    introDismissed = false;
    introCrossfadeStarted = false;
    introPrestartedNext = false;
    isWarpingExit = false;
    introSoundPlayed = false;
    clearInterval(introFadeAudioInterval);
    introFadeAudioInterval = null;
    clearTimeout(introAutoTimer);
    clearTimeout(introWatchdogTimer);
    introAutoTimer = null;
    introWatchdogTimer = null;

    const overlay = $('intro-overlay');
    if (!overlay) return;

    // If already dismissed (e.g. by instant inline script or user skipped early) and not an explicit replay:
    if (!isReplay && (overlay.classList.contains('hidden') || overlay.style.display === 'none')) {
        introDismissed = true;
        return;
    }

    overlay.classList.remove('intro-exit', 'intro-fast-exit', 'hidden');
    overlay.classList.add('flex');
    overlay.style.setProperty('display', 'flex', 'important');
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';

    // If replaying intro while music is playing, duck music so intro audio is heard clearly
    if (isReplay && isHostMode() && getState().currentVideo) {
        setHostPlayerVolume(0);
    }

    const introVid = $('intro-video');
    const unmuteBtn = $('intro-unmute-btn');
    if (unmuteBtn) unmuteBtn.classList.remove('hidden');

    // Handler when user interacts anywhere on intro or unmute button:
    // Unmutes audio, ensures volume is 100%, resumes Web Audio context
    const handleUnmuteGesture = () => {
        unlockAudioSystem();
        if (introVid) {
            introVid.muted = false;
            introVid.volume = 1;
            if (introVid.paused) {
                introVid.play().catch(() => {});
            }
        }
        if (unmuteBtn) unmuteBtn.classList.add('hidden');
    };

    if (unmuteBtn) {
        unmuteBtn.onclick = (e) => {
            e.stopPropagation();
            handleUnmuteGesture();
        };
    }

    overlay.onclick = () => {
        handleUnmuteGesture();
    };

    if (introVid) {
        // Fallback error handler: if video cannot be loaded or decoded, exit cleanly immediately
        introVid.onerror = (e) => {
            console.warn('[Intro] Video error encountered, auto-dismissing intro:', e);
            dismissIntro(isReplay, true);
        };

        try {
            introVid.currentTime = 0;
            introVid.volume = 1;

            // Attempt unmuted play first; if browser blocks, fallback to muted + show unmute button
            introVid.muted = false;
            const playPromise = introVid.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    // Played with sound directly! Hide prompt
                    if (unmuteBtn) unmuteBtn.classList.add('hidden');
                }).catch((err) => {
                    console.warn('[Intro] Unmuted autoplay blocked by browser policy, starting muted:', err);
                    introVid.muted = true;
                    if (unmuteBtn) unmuteBtn.classList.remove('hidden');
                    introVid.play().catch(() => {
                        dismissIntro(isReplay, true);
                    });
                });
            }

            introVid.ontimeupdate = () => {
                if (introDismissed) return;
                const dur = introVid.duration;
                const cur = introVid.currentTime;
                const effectiveDuration = (isFinite(dur) && dur > 0) ? dur : 6.75;

                // Pre-start underlying video at ~4.2s (2.5s before end)
                if (cur >= effectiveDuration - 2.5 && !introPrestartedNext) {
                    introPrestartedNext = true;
                    if (isHostMode() && getState().currentVideo && getState().isPlaying) {
                        applyHostModeState();
                        setHostPlayerVolume(Math.min(10, (getState().volume ?? 50) * 0.2));
                    }
                }

                // If within 0.25s of end, dismiss cleanly
                if (cur >= effectiveDuration - 0.25) {
                    dismissIntro(isReplay, false);
                }
            };

            introVid.onended = () => {
                dismissIntro(isReplay, false);
            };
        } catch (e) {
            console.warn('[Intro] Video play execution error:', e);
            dismissIntro(isReplay, true);
        }
    }

    const skipBtn = $('btn-skip-intro');
    if (skipBtn) {
        skipBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            dismissIntro(isReplay, true);
        };
        skipBtn.onpointerdown = (e) => {
            e.stopPropagation();
        };
    }

    // Safety Watchdog: If after 2.5s video has not progressed, dismiss intro to avoid stalling
    introWatchdogTimer = setTimeout(() => {
        if (!introDismissed && (!introVid || introVid.paused || introVid.currentTime === 0)) {
            console.warn('[Intro] Video stalled or autoplay blocked on startup. Auto-dismissing.');
            dismissIntro(isReplay, true);
        }
    }, 2500);

    // Absolute Maximum safety timeout: dismiss after 7.5s regardless
    introAutoTimer = setTimeout(() => {
        if (!introDismissed) {
            dismissIntro(isReplay, false);
        }
    }, 7500);
}

// ============================================================================
// 2. DIRECT HD VIDEO/AUDIO STREAM PLAYER & YOUTUBE FALLBACK
// ============================================================================

export function getYtPlayer() { return ytPlayer; }
export function getNativeVideo() { return $('native-video'); }
export function getNativeAudio() { return $('native-audio'); }

function setYtPlayerVisible(visible) {
    const wrap = $('yt-player-wrap');
    const livePlayerEl = $('yt-player');
    if (wrap) wrap.classList.toggle('hidden', !visible);
    if (livePlayerEl) livePlayerEl.classList.toggle('hidden', !visible);
    if (!visible) {
        lastLoadedYtVideoId = null;
        if (ytPlayer && ytPlayer.stopVideo) {
            try { ytPlayer.stopVideo(); } catch (e) {}
        }
    }
}

function shouldForceDirectStream(videoId) {
    if (!videoId) return false;
    // Hardware-accelerated YouTube IFrame Player handles mobile and desktop smoothly without proxy stuttering.
    // Direct stream proxy is activated dynamically on YouTube embed error (101/150).
    return false;
}

function detectRealVideoHeightLabel() {
    const nativeVideo = $('native-video');
    if (!nativeVideo || !nativeVideo.videoHeight) return null;
    const h = nativeVideo.videoHeight;
    if (h >= 2000) return '4K UHD';
    if (h >= 1350) return '1440p 2K';
    if (h >= 1000) return '1080p HD';
    if (h >= 680) return '720p HD';
    if (h >= 440) return '480p';
    if (h > 0) return `${h}p`;
    return null;
}

export function ensureAudioUnmutedAndPlaying() {
    const state = getState();
    if (!isHostMode() || !state.isPlaying) return;
    const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (directVideoMode && nativeVideo && directStreamReadySrcSet) {
        if (directHasSeparateAudio && nativeAudio) {
            nativeVideo.muted = true;
            nativeAudio.muted = false;
            nativeAudio.volume = vol;
            if (nativeVideo.paused) nativeVideo.play().catch(() => {});
            if (nativeAudio.paused) nativeAudio.play().catch(() => {});
        } else {
            nativeVideo.muted = false;
            nativeVideo.volume = vol;
            if (nativeVideo.paused) nativeVideo.play().catch(() => {});
        }
        return;
    }
    if (playerReady && ytPlayer) {
        try {
            if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
            if (typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(state.volume ?? 50);
            if (typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo();
        } catch (e) {}
    }
}

export function playNativeVideoSafely() {
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');
    const state = getState();
    if (!nativeVideo || !directStreamReadySrcSet) return;
    const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));

    if (directHasSeparateAudio && nativeAudio) {
        nativeVideo.muted = true;
        nativeAudio.muted = false;
        nativeAudio.volume = vol;
        nativeVideo.play().catch(() => {});

        const tryPlaySeparateAudio = () => {
            const curState = getState();
            if (!directVideoMode || !directHasSeparateAudio || !curState.isPlaying) return;
            nativeAudio.muted = false;
            nativeAudio.volume = Math.max(0.05, Math.min(1, (curState.volume ?? 50) / 100));
            const p = nativeAudio.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    if (err && err.name === 'NotAllowedError') {
                        setTimeout(() => {
                            if (directVideoMode && getState().isPlaying && nativeAudio) {
                                nativeAudio.muted = false;
                                nativeAudio.play().catch(() => {});
                            }
                        }, 350);
                    }
                });
            }
        };

        if (nativeAudio.readyState >= 2) {
            tryPlaySeparateAudio();
        } else {
            nativeAudio.addEventListener('canplay', tryPlaySeparateAudio, { once: true });
            tryPlaySeparateAudio();
        }
    } else {
        nativeVideo.muted = false;
        nativeVideo.volume = vol;
        const playPromise = nativeVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
                if (err && err.name === 'NotAllowedError') {
                    nativeVideo.muted = true;
                    nativeVideo.play().then(() => {
                        nativeVideo.muted = false;
                        nativeVideo.volume = Math.max(0.05, Math.min(1, (getState().volume ?? 50) / 100));
                    }).catch(() => {});
                }
            });
        }
    }
}

export function pauseNativeMedia() {
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');
    if (nativeVideo && !nativeVideo.paused) nativeVideo.pause();
    if (nativeAudio && !nativeAudio.paused) nativeAudio.pause();
}

export function stopDirectVideoStream() {
    directVideoMode = false;
    directVideoId = null;
    directHasSeparateAudio = false;
    directAppliedQuality = null;
    directStreamReadySrcSet = false;

    const directVideoLoading = $('direct-video-loading');
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (directVideoLoading) directVideoLoading.classList.add('hidden');
    if (nativeVideo) {
        nativeVideo.pause();
        nativeVideo.removeAttribute('src');
        nativeVideo.classList.add('hidden');
    }
    if (nativeAudio) {
        nativeAudio.pause();
        nativeAudio.removeAttribute('src');
    }
}

export async function startDirectVideoStream(videoId, forceReload = false, resumeTime = 0, isEmbedErrorFallback = false) {
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');
    const directVideoLoading = $('direct-video-loading');
    const playerQualityBadge = $('player-quality-badge');

    if (!isHostMode() || !nativeVideo || !videoId) return;
    const state = getState();
    const targetQuality = state.quality || 'max';
    if (!forceReload && directVideoMode && directVideoId === videoId && directAppliedQuality === targetQuality && directStreamReadySrcSet) {
        return;
    }

    directVideoMode = true;
    directVideoId = videoId;
    directAppliedQuality = targetQuality;
    directStreamReadySrcSet = false;

    setYtPlayerVisible(false);

    if (nativeVideo) {
        nativeVideo.pause();
        nativeVideo.removeAttribute('src');
    }
    if (nativeAudio) {
        nativeAudio.pause();
        nativeAudio.removeAttribute('src');
    }

    const loadingTitle = $('direct-loading-title');
    const loadingSub = $('direct-loading-sub');
    if (loadingTitle && loadingSub) {
        if (isEmbedErrorFallback) {
            loadingTitle.textContent = 'กำลังปลดล็อกวิดีโอติดลิขสิทธิ์ (Direct 1080p HD)...';
            loadingSub.textContent = 'เจ้าของคลิปไม่อนุญาตให้ฝัง ระบบกำลังดึงภาพและเสียงตรงความชัดสูงมาเล่นให้';
        } else {
            loadingTitle.textContent = '⚡ กำลังดึงสตรีมวิดีโอความคมชัดสูง (Direct HD Stream)...';
            loadingSub.textContent = 'เล่นวิดีโอตรงแบบคลีน ไร้ปุ่มและเมนูรบกวนจาก YouTube';
        }
    }

    if (directVideoLoading) directVideoLoading.classList.remove('hidden');
    nativeVideo.classList.remove('hidden');
    if (playerQualityBadge) playerQualityBadge.textContent = '1080p HD';

    if (isEmbedErrorFallback && !forceReload) {
        showToast('เจ้าของคลิปไม่อนุญาตให้ฝัง ระบบกำลังดึงวิดีโอความชัดสูง (1080p Full HD) มาเล่นให้...', 'info');
    }

    try {
        const resp = await fetch(`/api/video-info/${encodeURIComponent(videoId)}?quality=${encodeURIComponent(targetQuality)}`);
        if (!resp.ok) throw new Error('Failed to fetch direct stream info');
        const info = await resp.json();

        if (!directVideoMode || directVideoId !== videoId) return;

        directHasSeparateAudio = Boolean(info.hasSeparateAudio);
        directQualityLabel = info.qualityLabel || '1080p HD';
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;

        const vol = Math.max(0.05, Math.min(1, (getState().volume ?? 50) / 100));
        const qParam = encodeURIComponent(targetQuality);

        if (directHasSeparateAudio && nativeAudio) {
            nativeVideo.muted = true;
            nativeAudio.muted = false;
            nativeAudio.volume = vol;
            nativeAudio.src = `/api/audio-stream/${encodeURIComponent(videoId)}?quality=${qParam}`;
            nativeAudio.load();
        } else {
            if (nativeAudio) {
                nativeAudio.pause();
                nativeAudio.removeAttribute('src');
            }
            nativeVideo.muted = false;
            nativeVideo.volume = vol;
        }

        directStreamReadySrcSet = true;
        nativeVideo.src = `/api/video-stream/${encodeURIComponent(videoId)}?quality=${qParam}`;
        nativeVideo.load();

        if (resumeTime > 0) {
            const applyResume = () => {
                nativeVideo.currentTime = resumeTime;
                if (directHasSeparateAudio && nativeAudio) nativeAudio.currentTime = resumeTime;
                nativeVideo.removeEventListener('loadedmetadata', applyResume);
            };
            nativeVideo.addEventListener('loadedmetadata', applyResume);
        }

        if (getState().isPlaying) {
            playNativeVideoSafely();
        }
    } catch (err) {
        console.error('Direct stream init error:', err);
        if (!isHostMode() || !directVideoMode || directVideoId !== videoId) return;
        stopDirectVideoStream();
        if (!isEmbedErrorFallback && directFallbackToEmbedId !== videoId) {
            directFallbackToEmbedId = videoId;
            applyHostModeState();
            return;
        }
        const curVideo = getState().currentVideo;
        if (curVideo && curVideo.videoId === videoId) {
            showToast('ไม่สามารถดึงวิดีโอตรงได้ กำลังค้นหาคลิปสำรองให้อัตโนมัติ...', 'info');
            emitResolveErrorAction('find-alt');
        }
    }
}

export function enforceQuality() {
    const state = getState();
    if (!isHostMode() || !state.currentVideo) return;
    const targetQuality = state.quality || 'max';
    const videoId = state.currentVideo.videoId;
    const nativeVideo = $('native-video');
    const playerQualityBadge = $('player-quality-badge');

    if (directVideoMode) {
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;
        return;
    }

    if (!ytPlayer || !ytPlayer.getAvailableQualityLevels || !ytPlayer.setPlaybackQuality) return;
    const available = ytPlayer.getAvailableQualityLevels();
    let selectedQuality = targetQuality;
    if (targetQuality === 'max') {
        const priority = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium'];
        selectedQuality = priority.find(q => available.includes(q)) || available[0] || 'hd1080';
    }

    if (selectedQuality && selectedQuality !== 'auto') {
        ytPlayer.setPlaybackQuality(selectedQuality);
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
            try { ytPlayer.setPlaybackQualityRange(selectedQuality, 'highres'); } catch (e) {}
        }
    } else {
        ytPlayer.setPlaybackQuality('auto');
    }
    updateQualityBadge(selectedQuality);
}

function updateQualityBadge(q) {
    const playerQualityBadge = $('player-quality-badge');
    if (!playerQualityBadge) return;
    if (directVideoMode) {
        playerQualityBadge.textContent = directQualityLabel;
        return;
    }
    if (q === 'highres' || q === 'hd2160') playerQualityBadge.textContent = '4K';
    else if (q === 'hd1440') playerQualityBadge.textContent = '2K';
    else if (q === 'hd1080') playerQualityBadge.textContent = '1080p';
    else if (q === 'hd720') playerQualityBadge.textContent = '720p';
    else if (q === 'large') playerQualityBadge.textContent = '480p';
    else if (q === 'medium') playerQualityBadge.textContent = '360p';
    else playerQualityBadge.textContent = 'HD';
}

export function applyHostModeState() {
    const state = getState();
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (!state.currentVideo) {
        activePlayerVideoId = null;
        directFallbackToEmbedId = null;
        lastLoadedYtVideoId = null;
        const unmuteBtn = $('unmute-btn');
        if (unmuteBtn) unmuteBtn.classList.add('hidden');
        stopDirectVideoStream();
        setYtPlayerVisible(false);
        return;
    }

    const videoId = state.currentVideo.videoId;
    if (!isHostMode()) return;

    const isNewTrack = videoId !== activePlayerVideoId;
    if (isNewTrack) {
        activePlayerVideoId = videoId;
        directFallbackToEmbedId = null;
        lastLoadedYtVideoId = null;
        const playerArea = $('player-area');
        const overlay = $('intro-overlay');
        if (playerArea && (!overlay || overlay.style.display === 'none')) {
            playerArea.classList.remove('player-crossfade-in');
            void playerArea.offsetWidth;
            playerArea.classList.add('player-crossfade-in');
            setTimeout(() => {
                playerArea.classList.remove('player-crossfade-in');
            }, 600);
        }
    }

    if (shouldForceDirectStream(videoId)) {
        if (isNewTrack || !directVideoMode || directVideoId !== videoId) {
            startDirectVideoStream(videoId, isNewTrack, state.currentTime || 0, false);
            return;
        }
    }

    if (directVideoMode && nativeVideo) {
        const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
        if (directHasSeparateAudio && nativeAudio) {
            nativeVideo.muted = true;
            nativeAudio.muted = false;
            nativeAudio.volume = vol;
        } else {
            nativeVideo.muted = false;
            nativeVideo.volume = vol;
        }
        if (state.isPlaying) {
            if (directStreamReadySrcSet && (nativeVideo.paused || (directHasSeparateAudio && nativeAudio && nativeAudio.paused))) {
                playNativeVideoSafely();
            }
        } else {
            pauseNativeMedia();
        }
        return;
    }

    setYtPlayerVisible(true);
    if (!playerReady || !ytPlayer || !ytPlayer.loadVideoById) return;

    if (lastLoadedYtVideoId !== videoId) {
        lastLoadedYtVideoId = videoId;
        ytPlayer.loadVideoById({
            videoId: videoId,
            suggestedQuality: 'hd1080'
        });
        if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
        ytPlayer.setVolume(state.volume ?? 50);
        return;
    }

    if (state.isPlaying) {
        if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
        ytPlayer.playVideo();
    } else {
        ytPlayer.pauseVideo();
        const unmuteBtn = $('unmute-btn');
        if (unmuteBtn) unmuteBtn.classList.add('hidden');
    }
    ytPlayer.setVolume(state.volume ?? 50);
}

// ============================================================================
// 3. CANONICAL PLAYBACK TIMESTAMP PROVIDER
// ============================================================================

export function getPrecisePlaybackTime() {
    const state = getState();
    if (!state.currentVideo) return 0;
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (isHostMode()) {
        if (directVideoMode && nativeVideo && !nativeVideo.paused) {
            if (directHasSeparateAudio && nativeAudio && !nativeAudio.paused) {
                return nativeAudio.currentTime || 0;
            }
            return nativeVideo.currentTime || 0;
        }
        if (playerReady && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
            return ytPlayer.getCurrentTime() || 0;
        }
    }
    return state.currentTime || 0;
}

export function getPlayerDuration() {
    const nativeVideoEl = $('native-video');
    const nativeAudioEl = $('native-audio');

    if (directVideoMode && nativeVideoEl && isFinite(nativeVideoEl.duration) && nativeVideoEl.duration > 0) {
        return nativeVideoEl.duration;
    }
    if (directVideoMode && directHasSeparateAudio && nativeAudioEl && isFinite(nativeAudioEl.duration) && nativeAudioEl.duration > 0) {
        return nativeAudioEl.duration;
    }
    if (playerReady && ytPlayer && typeof ytPlayer.getDuration === 'function') {
        const dur = ytPlayer.getDuration();
        if (isFinite(dur) && dur > 0) return dur;
    }
    const stateDur = getState().duration;
    if (isFinite(stateDur) && stateDur > 0) return stateDur;
    return 0;
}

export function seekHostPlayer(seconds) {
    if (!isHostMode()) return;
    const targetTime = Math.max(0, Number(seconds) || 0);

    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (directVideoMode && nativeVideo) {
        try {
            nativeVideo.currentTime = targetTime;
            if (directHasSeparateAudio && nativeAudio) {
                nativeAudio.currentTime = targetTime;
            }
        } catch (e) {
            console.warn('[Audio] Direct stream seek error:', e);
        }
    } else if (playerReady && ytPlayer && typeof ytPlayer.seekTo === 'function') {
        try {
            ytPlayer.seekTo(targetTime, true);
        } catch (e) {
            console.warn('[Audio] YouTube seek error:', e);
        }
    }

    const dur = getPlayerDuration();
    if (dur > 0) {
        updateProgress(targetTime, dur);
        emitPlayerProgress(targetTime, dur);
    }
}

// ============================================================================
// 4. DJ PARTY SOUNDBOARD & AUDIO SYNTHESIZERS
// ============================================================================

export function setHostPlayerVolume(volPercent) {
    if (!isHostMode()) return;
    const clamped = Math.max(0, Math.min(100, volPercent));
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    if (directVideoMode && nativeVideo) {
        const v = clamped / 100;
        if (directHasSeparateAudio && nativeAudio) {
            nativeAudio.volume = v;
        } else {
            nativeVideo.volume = v;
        }
    } else if (playerReady && ytPlayer && ytPlayer.setVolume) {
        try { ytPlayer.setVolume(clamped); } catch (e) {}
    }
}

export function duckHostMediaVolume(durationMs = 5200) {
    if (!isHostMode()) return;
    const state = getState();
    const baseVol = state.volume ?? 50;
    const duckedVol = Math.min(baseVol, Math.max(10, Math.round(baseVol * 0.25)));
    setHostPlayerVolume(duckedVol);
    clearTimeout(mediaDuckTimer);
    mediaDuckTimer = setTimeout(() => {
        setHostPlayerVolume(getState().volume ?? 50);
    }, durationMs);
}

export function unlockAudioSystem() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!softAudioCtx) softAudioCtx = new AudioCtx();
            if (softAudioCtx.state === 'suspended') {
                softAudioCtx.resume().catch(() => {});
            }
            if (!audioUnlocked && softAudioCtx.state === 'running') {
                const buf = softAudioCtx.createBuffer(1, 1, 22050);
                const src = softAudioCtx.createBufferSource();
                src.buffer = buf;
                src.connect(softAudioCtx.destination);
                src.start(0);
                audioUnlocked = true;
            }
        }
        if (!ttsAudioEl && typeof Audio !== 'undefined') {
            ttsAudioEl = new Audio();
            ttsAudioEl.preload = 'auto';
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.resume();
        }
        if (pendingRemoteAlertAudio) {
            const { chimeType, voiceText } = pendingRemoteAlertAudio;
            pendingRemoteAlertAudio = null;
            if (chimeType) playSoftAlertChime(chimeType);
            if (voiceText) speakThaiText(voiceText, true);
        }
    } catch (e) {}
}

export function playSoftAlertChime(type = 'rain') {
    lastChimeTime = Date.now();
    duckHostMediaVolume(4800);

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!softAudioCtx) softAudioCtx = new AudioCtx();

        const triggerSound = () => {
            const ctx = softAudioCtx;
            const now = ctx.currentTime + 0.01;

            const comp = ctx.createDynamicsCompressor();
            comp.threshold.setValueAtTime(-10, now);
            comp.ratio.setValueAtTime(4, now);
            comp.attack.setValueAtTime(0.003, now);
            comp.release.setValueAtTime(0.15, now);
            comp.connect(ctx.destination);

            let hitFreqStart = 90, hitFreqEnd = 45;
            let hitVol = 0.4;
            let chordFreqs = [130.81, 164.81, 196.00, 246.94];
            let chordVol = 0.04;
            let chimeNotes = [
                { freq: 523.25, t: 0.12, dur: 1.0, pan: -0.25 },
                { freq: 783.99, t: 0.42, dur: 0.9, pan: 0.25 },
                { freq: 1046.50, t: 0.72, dur: 1.5, pan: 0.0 }
            ];
            let chimeVol = 0.15;

            if (type === 'storm') {
                hitFreqStart = 130; hitFreqEnd = 30; hitVol = 0.7;
                chordFreqs = [65.41, 97.99, 155.56, 146.83];
                chordVol = 0.055;
                chimeNotes = [
                    { freq: 440.00, t: 0.12, dur: 0.8, pan: -0.3 },
                    { freq: 554.37, t: 0.35, dur: 0.7, pan: 0.3 },
                    { freq: 659.25, t: 0.55, dur: 1.0, pan: 0.0 }
                ];
                chimeVol = 0.2;
            } else if (type === 'near-90pct') {
                hitFreqStart = 110; hitFreqEnd = 42; hitVol = 0.5;
                chordFreqs = [130.81, 164.81, 196.00, 246.94];
                chordVol = 0.05;
                chimeNotes = [
                    { freq: 587.33, t: 0.12, dur: 1.0, pan: -0.2 },
                    { freq: 783.99, t: 0.40, dur: 0.9, pan: 0.2 },
                    { freq: 1174.66, t: 0.70, dur: 1.5, pan: 0.0 }
                ];
                chimeVol = 0.18;
            }

            // 1. Deep cinema hit
            const hit = ctx.createOscillator();
            const hitG = ctx.createGain();
            hit.type = 'sine';
            hit.frequency.setValueAtTime(hitFreqStart, now);
            hit.frequency.exponentialRampToValueAtTime(hitFreqEnd, now + 0.5);
            hitG.gain.setValueAtTime(0.0001, now);
            hitG.gain.linearRampToValueAtTime(hitVol, now + 0.02);
            hitG.gain.exponentialRampToValueAtTime(0.1, now + 0.35);
            hitG.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
            hit.connect(hitG); hitG.connect(comp);
            hit.start(now); hit.stop(now + 1.3);

            // 2. Power chord pad
            chordFreqs.forEach((freq, i) => {
                const o1 = ctx.createOscillator();
                const o2 = ctx.createOscillator();
                const flt = ctx.createBiquadFilter();
                const g = ctx.createGain();
                o1.type = 'sawtooth'; o2.type = 'sawtooth';
                o1.frequency.setValueAtTime(freq, now + 0.03);
                o2.frequency.setValueAtTime(freq * 1.005, now + 0.03);
                flt.type = 'lowpass';
                flt.frequency.setValueAtTime(100, now + 0.03);
                flt.frequency.exponentialRampToValueAtTime(1600, now + 0.6);
                flt.frequency.exponentialRampToValueAtTime(350, now + 2.0);
                flt.Q.setValueAtTime(1.5, now);
                g.gain.setValueAtTime(0.0001, now + 0.03);
                g.gain.linearRampToValueAtTime(chordVol, now + 0.35);
                g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
                o1.connect(flt); o2.connect(flt);
                if (ctx.createStereoPanner) {
                    const p = ctx.createStereoPanner();
                    p.pan.setValueAtTime((i / 3) * 1.0 - 0.5, now);
                    flt.connect(p); p.connect(g);
                } else { flt.connect(g); }
                g.connect(comp);
                o1.start(now + 0.03); o2.start(now + 0.03);
                o1.stop(now + 2.3); o2.stop(now + 2.3);
            });

            // 3. Signature chime
            chimeNotes.forEach(c => {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(c.freq, now + c.t);
                g.gain.setValueAtTime(0.0001, now + c.t);
                g.gain.linearRampToValueAtTime(chimeVol, now + c.t + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, now + c.t + c.dur);
                osc.connect(g);
                if (ctx.createStereoPanner) {
                    const p = ctx.createStereoPanner();
                    p.pan.setValueAtTime(c.pan, now + c.t);
                    g.connect(p); p.connect(comp);
                } else { g.connect(comp); }
                osc.start(now + c.t);
                osc.stop(now + c.t + c.dur + 0.05);
            });
        };

        if (softAudioCtx.state === 'suspended') {
            softAudioCtx.resume().then(() => {
                audioUnlocked = true;
                triggerSound();
            }).catch(() => {
                pendingRemoteAlertAudio = { ...(pendingRemoteAlertAudio || {}), chimeType: type };
            });
        } else {
            triggerSound();
        }
    } catch (e) {}
}

export function speakThaiText(text, forceSpeak = false) {
    if (!text) return;
    duckHostMediaVolume(6000);

    const elapsedSinceChime = Date.now() - lastChimeTime;
    const delayMs = elapsedSinceChime < 420 ? (420 - elapsedSinceChime) : 0;

    setTimeout(async () => {
        const ttsUrl = `/api/tts-thai?text=${encodeURIComponent(text.substring(0, 190))}`;

        if (activeTtsBufferSource) {
            try { activeTtsBufferSource.stop(); } catch (e) {}
            activeTtsBufferSource = null;
        }
        if (ttsAudioEl) {
            try { ttsAudioEl.pause(); } catch (e) {}
        }

        try {
            const resp = await fetch(ttsUrl);
            if (!resp.ok) throw new Error('TTS fetch failed');
            const arrayBuf = await resp.arrayBuffer();

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                if (!softAudioCtx) softAudioCtx = new AudioCtx();
                if (softAudioCtx.state === 'suspended') {
                    await softAudioCtx.resume().catch(() => {});
                }
                if (softAudioCtx.state === 'running') {
                    const audioBuffer = await softAudioCtx.decodeAudioData(arrayBuf.slice(0));
                    const source = softAudioCtx.createBufferSource();
                    const gainNode = softAudioCtx.createGain();
                    gainNode.gain.value = 1.35;
                    source.buffer = audioBuffer;
                    source.playbackRate.value = 1.18;
                    source.connect(gainNode);
                    gainNode.connect(softAudioCtx.destination);
                    activeTtsBufferSource = source;
                    source.onended = () => {
                        if (activeTtsBufferSource === source) activeTtsBufferSource = null;
                    };
                    source.start(0);
                    return;
                }
            }

            if (!ttsAudioEl) ttsAudioEl = new Audio();
            const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            ttsAudioEl.src = blobUrl;
            ttsAudioEl.volume = 1.0;
            ttsAudioEl.playbackRate = 1.18;
            const playProm = ttsAudioEl.play();
            if (playProm && typeof playProm.then === 'function') {
                await playProm;
                ttsAudioEl.onended = () => URL.revokeObjectURL(blobUrl);
                return;
            }
        } catch (err) {
            pendingRemoteAlertAudio = { ...(pendingRemoteAlertAudio || {}), voiceText: text };
        }

        // Tertiary fallback: Browser SpeechSynthesis
        if ('speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
                window.speechSynthesis.resume();
                setTimeout(() => {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = 'th-TH';
                    utterance.rate = 1.2;
                    utterance.volume = 1.0;
                    const voices = window.speechSynthesis.getVoices();
                    const thVoice = voices.find(v => v.name.toLowerCase().includes('google') && v.lang.includes('th'))
                        || voices.find(v => v.lang && v.lang.toLowerCase().includes('th'));
                    if (thVoice) utterance.voice = thVoice;
                    window.speechSynthesis.speak(utterance);
                }, 60);
            } catch (e) {}
        }
    }, delayMs);
}

export function playDjSoundboardSynthesizer(soundId) {}

export function showSoundboardVisualBadge(soundId, senderName) {}

// ============================================================================
// 5. SUBSYSTEM INITIALIZATION & LISTENERS
// ============================================================================

export function setupAutoplayUnlock() {
    ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach(evt => {
        document.addEventListener(evt, () => {
            unlockAudioSystem();
            ensureAudioUnmutedAndPlaying();
        }, { passive: true });
    });
}

function initYouTubeAPI() {
    if (typeof window === 'undefined' || window.YT) return;
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    } else {
        document.head.appendChild(tag);
    }
}

export function initAudioSubsystem() {
    const nativeVideo = $('native-video');
    const nativeAudio = $('native-audio');

    // Video Element Listeners
    if (nativeVideo) {
        nativeVideo.addEventListener('loadedmetadata', () => {
            if (!directVideoMode || !directStreamReadySrcSet) return;
            const realLabel = detectRealVideoHeightLabel();
            if (realLabel) {
                directQualityLabel = realLabel;
                const badge = $('player-quality-badge');
                if (badge) badge.textContent = realLabel;
            }
            const dur = nativeVideo.duration;
            if (isFinite(dur) && dur > 0) {
                updateProgress(nativeVideo.currentTime || 0, dur);
                emitPlayerProgress(nativeVideo.currentTime || 0, dur);
            }
        });

        nativeVideo.addEventListener('timeupdate', () => {
            if (!isHostMode() || !directVideoMode || !directStreamReadySrcSet) return;
            const cur = (directHasSeparateAudio && nativeAudio && !nativeAudio.paused)
                ? (nativeAudio.currentTime || 0)
                : (nativeVideo.currentTime || 0);
            const dur = getPlayerDuration();
            if (dur > 0) {
                updateProgress(cur, dur);
            }
        });

        nativeVideo.addEventListener('loadeddata', () => {
            if (!directVideoMode || !directStreamReadySrcSet) return;
            const directVideoLoading = $('direct-video-loading');
            if (directVideoLoading) directVideoLoading.classList.add('hidden');
            const realLabel = detectRealVideoHeightLabel();
            if (realLabel) {
                directQualityLabel = realLabel;
                const badge = $('player-quality-badge');
                if (badge) badge.textContent = realLabel;
            }
            if (getState().isPlaying) {
                playNativeVideoSafely();
            }
        });

        nativeVideo.addEventListener('waiting', () => {
            if (!directVideoMode || !directHasSeparateAudio || !nativeAudio) return;
            if (!nativeAudio.paused) nativeAudio.pause();
        });

        nativeVideo.addEventListener('playing', () => {
            if (!directVideoMode || !directStreamReadySrcSet) return;
            const directVideoLoading = $('direct-video-loading');
            if (directVideoLoading) directVideoLoading.classList.add('hidden');
            const realLabel = detectRealVideoHeightLabel();
            if (realLabel) {
                directQualityLabel = realLabel;
                const badge = $('player-quality-badge');
                if (badge) badge.textContent = realLabel;
            }
            const vol = Math.max(0.05, Math.min(1, (getState().volume ?? 50) / 100));
            if (directHasSeparateAudio && nativeAudio && getState().isPlaying) {
                nativeVideo.muted = true;
                nativeAudio.muted = false;
                nativeAudio.volume = vol;
                if (Math.abs((nativeVideo.currentTime || 0) - (nativeAudio.currentTime || 0)) > 0.25) {
                    nativeAudio.currentTime = nativeVideo.currentTime || 0;
                }
                if (nativeAudio.paused) nativeAudio.play().catch(() => {});
            } else if (!directHasSeparateAudio && getState().isPlaying) {
                nativeVideo.muted = false;
                nativeVideo.volume = vol;
            }
        });

        nativeVideo.addEventListener('ended', () => {
            if (isHostMode() && directVideoMode && directStreamReadySrcSet) {
                pauseNativeMedia();
                emitPlayerVideoEnded();
            }
        });

        nativeVideo.addEventListener('error', () => {
            if (!isHostMode() || !directVideoMode || !directStreamReadySrcSet || !nativeVideo.getAttribute('src')) return;
            const failedId = directVideoId;
            stopDirectVideoStream();
            if (failedId && directFallbackToEmbedId !== failedId) {
                directFallbackToEmbedId = failedId;
                applyHostModeState();
                return;
            }
            const curVideo = getState().currentVideo;
            if (curVideo && curVideo.videoId === failedId) {
                showToast('ไม่สามารถดึงวิดีโอตรงได้ กำลังค้นหาคลิปสำรองให้อัตโนมัติ...', 'info');
                emitResolveErrorAction('find-alt');
            }
        });
    }

    if (nativeAudio) {
        nativeAudio.addEventListener('canplay', () => {
            if (!directVideoMode || !directStreamReadySrcSet || !directHasSeparateAudio || !getState().isPlaying) return;
            nativeAudio.muted = false;
            nativeAudio.volume = Math.max(0.05, Math.min(1, (getState().volume ?? 50) / 100));
            if (nativeAudio.paused) {
                nativeAudio.play().catch(() => {});
            }
        });
    }

    // Attach global YouTube IFrame API callback to window
    if (typeof window !== 'undefined') {
        window.onYouTubeIframeAPIReady = function() {
            if (!isHostMode()) return;
            ytPlayer = new window.YT.Player('yt-player', {
                height: '100%',
                width: '100%',
                host: 'https://www.youtube.com',
                playerVars: {
                    'autoplay': 1,
                    'controls': 0,
                    'disablekb': 1,
                    'fs': 0,
                    'rel': 0,
                    'modestbranding': 1,
                    'iv_load_policy': 3,
                    'cc_load_policy': 0,
                    'autohide': 1,
                    'playsinline': 1,
                    'enablejsapi': 1,
                    'vq': 'hd1080',
                    'origin': window.location.origin
                },
                events: {
                    'onReady': () => {
                        playerReady = true;
                        applyHostModeState();
                    },
                    'onStateChange': (event) => {
                        const unmuteBtn = $('unmute-btn');
                        if (directVideoMode) {
                            if (unmuteBtn) unmuteBtn.classList.add('hidden');
                            return;
                        }
                        if (event.data === window.YT.PlayerState.PLAYING) {
                            if (unmuteBtn) unmuteBtn.classList.add('hidden');
                            try {
                                if (ytPlayer && typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
                                if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(getState().volume ?? 50);
                            } catch (e) {}
                            enforceQuality();
                            setTimeout(enforceQuality, 1200);
                        }
                        if ((event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.CUED) && getState().isPlaying) {
                            if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
                                try {
                                    if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
                                    ytPlayer.playVideo();
                                } catch (e) {}
                            }
                            setTimeout(() => {
                                if (getState().isPlaying && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
                                    const st = ytPlayer.getPlayerState();
                                    if (st !== window.YT.PlayerState.PLAYING && unmuteBtn) {
                                        unmuteBtn.classList.remove('hidden');
                                    }
                                }
                            }, 600);
                        }
                        if (event.data === window.YT.PlayerState.ENDED) {
                            if (unmuteBtn) unmuteBtn.classList.add('hidden');
                            emitPlayerVideoEnded();
                        }
                    },
                    'onError': (event) => {
                        console.warn('YouTube Embed Error:', event.data, '-> Switching to Direct 1080p HD Video Stream');
                        const curVideo = getState().currentVideo;
                        if (isHostMode() && curVideo && curVideo.videoId && directFallbackToEmbedId !== curVideo.videoId) {
                            startDirectVideoStream(curVideo.videoId, true, 0, true);
                        } else {
                            emitResolveErrorAction('find-alt');
                        }
                    }
                }
            });
        };

        initYouTubeAPI();
    }

    // Host progress ticker & socket sync broadcast (smooth 250ms local UI, throttled 1000ms socket sync)
    let lastSocketEmitTime = 0;
    setInterval(() => {
        if (!isHostMode()) return;
        const nativeVideoEl = $('native-video');
        const nativeAudioEl = $('native-audio');

        if (directVideoMode && nativeVideoEl && !nativeVideoEl.paused) {
            if (directHasSeparateAudio && nativeAudioEl && !nativeAudioEl.paused) {
                const drift = Math.abs((nativeVideoEl.currentTime || 0) - (nativeAudioEl.currentTime || 0));
                if (drift > 0.28) {
                    nativeVideoEl.currentTime = nativeAudioEl.currentTime;
                }
            }
            const currentTime = (directHasSeparateAudio && nativeAudioEl && !nativeAudioEl.paused)
                ? (nativeAudioEl.currentTime || 0)
                : (nativeVideoEl.currentTime || 0);
            const duration = isFinite(nativeVideoEl.duration) && nativeVideoEl.duration > 0
                ? nativeVideoEl.duration
                : (nativeAudioEl && isFinite(nativeAudioEl.duration) ? nativeAudioEl.duration : 0);

            if (duration > 0) {
                updateProgress(currentTime, duration);
            }

            const now = Date.now();
            if (now - lastSocketEmitTime >= 950 && duration > 0) {
                lastSocketEmitTime = now;
                emitPlayerProgress(currentTime, duration);
            }
            return;
        }

        if (playerReady && ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === window.YT.PlayerState.PLAYING) {
            const currentTime = ytPlayer.getCurrentTime();
            const duration = ytPlayer.getDuration();

            if (duration > 0) {
                updateProgress(currentTime, duration);
            }

            const now = Date.now();
            if (now - lastSocketEmitTime >= 950 && duration > 0) {
                lastSocketEmitTime = now;
                emitPlayerProgress(currentTime, duration);
            }
        }
    }, 250);

    // Inbound socket seek-video event (Host applies seek to active media element)
    onSeekVideo((seconds) => {
        if (isHostMode()) {
            seekHostPlayer(seconds);
        }
    });

    // DJ Soundboard UI buttons
    document.querySelectorAll('[data-soundboard]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const soundId = btn.getAttribute('data-soundboard');
            if (!soundId) return;
            unlockAudioSystem();
            const profile = getState().myProfile;
            emitSendSoundboard(soundId, profile?.name || 'สมาชิก');
        });
    });

    // Inbound socket soundboard event
    const socket = getSocket();
    if (socket) {
        socket.on('play-soundboard-fx', (payload) => {
            if (!payload || !payload.soundId) return;
            playDjSoundboardSynthesizer(payload.soundId);
            showSoundboardVisualBadge(payload.soundId, payload.senderName || payload.nickname);
        });
    }

    // Subscribe to state changes for host playback updates
    onStateChange((state, changedKeys) => {
        if (isHostMode()) {
            if (changedKeys.includes('currentVideo') || changedKeys.includes('isPlaying') || changedKeys.includes('quality')) {
                applyHostModeState();
            }
            if (changedKeys.includes('volume')) {
                setHostPlayerVolume(state.volume ?? 50);
            }
        }
    });

    // Mobile Unmute & Tap-to-Play triggers
    const unmuteBtn = $('unmute-btn');
    if (unmuteBtn) {
        unmuteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            unlockAudioSystem();
            if (ytPlayer && typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
            if (ytPlayer && typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo();
            const nativeVideo = $('native-video');
            const nativeAudio = $('native-audio');
            if (nativeVideo && directVideoMode) {
                nativeVideo.play().catch(() => {});
                if (directHasSeparateAudio && nativeAudio) nativeAudio.play().catch(() => {});
            }
            unmuteBtn.classList.add('hidden');
        });
    }

    const playerArea = $('player-area');
    if (playerArea) {
        playerArea.addEventListener('click', () => {
            unlockAudioSystem();
            ensureAudioUnmutedAndPlaying();
            if (unmuteBtn) unmuteBtn.classList.add('hidden');
        });
    }

    setupAutoplayUnlock();
}

export const initAudio = initAudioSubsystem;
