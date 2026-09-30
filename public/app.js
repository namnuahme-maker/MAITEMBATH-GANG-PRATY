const socket = io();

// HTML escape helper to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function safeColor(c) {
    return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#ABD2FA';
}

// Toast notification helper
function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const borderCol = type === 'error' 
        ? 'border-red-500/50 bg-red-950/90 text-red-200 shadow-red-500/20' 
        : 'border-brand-peri/50 bg-[#0a0a0a]/90 text-brand-light shadow-brand-deep/30';
    toast.className = `px-3.5 py-2 rounded-lg border text-xs shadow-xl backdrop-blur transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto flex items-center gap-2 ${borderCol}`;
    
    const icon = type === 'error' ? '<i class="fa-solid fa-circle-exclamation text-red-400"></i>' : '<i class="fa-solid fa-circle-info text-brand-peri"></i>';
    toast.innerHTML = `${icon} <span>${escapeHtml(msg)}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// State
let state = {
    queue: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 50,
    quality: 'max',
    autoDjEnabled: true,
    autoDjMode: 'khlerm',
    autoDjCustomQuery: ''
};

// Profile
let myProfile = {
    name: localStorage.getItem('nickname') || '',
    color: safeColor(localStorage.getItem('usercolor'))
};

// DOM Refs
const $ = id => document.getElementById(id);
const playerArea = $('player-area');
const ytPlayerDiv = $('yt-player');
const nativeVideo = $('native-video');
const nativeAudio = $('native-audio');
const directVideoLoading = $('direct-video-loading');
const emptyState = $('empty-state');
const hostBadge = $('host-badge');
const unmuteBtn = $('unmute-btn');
const danmakuLayer = $('danmaku-layer');
const qrContainer = $('qr-container');
const playerQualityBadge = $('player-quality-badge');
const qualitySelect = $('quality-select');

// Overlays
const loginOverlay = $('login-overlay');
const loginName = $('login-name');
const loginColor = $('login-color');
const loginBtn = $('login-btn');
const editProfileBtn = $('edit-profile-btn');
const myColorDot = $('my-color-dot');

// Controls
const toggleHost = $('toggle-host');
const urlInput = $('url-input');
const addBtn = $('add-btn');
const btnPlay = $('btn-play');
const iconPlay = $('icon-play');
const playLabel = $('play-label');
const btnSkip = $('btn-skip');
const skipLabel = $('skip-label');
const volDown = $('vol-down');
const volUp = $('vol-up');
const volSlider = $('vol-slider');
const volLabel = $('vol-label');
const progressFill = $('progress-fill');
const timeNow = $('time-now');
const timeTotal = $('time-total');
const progressBar = $('progress-bar');
const clientControls = $('client-controls');

// Displays
const nowPlayingCard = $('now-playing-card');
const nowAmbientBg = $('now-ambient-bg');
const nowInfoWrap = $('now-info-wrap');
const nowThumb = $('now-thumb');
const nowThumbEmpty = $('now-thumb-empty');
const nowEq = $('now-eq');
const nowLiveDot = $('now-live-dot');
const nowTitle = $('now-title');
const nowAuthor = $('now-author');
const nowAddedBy = $('now-added-by');
const queueList = $('queue-list');
const qCount = $('q-count');
const qCountMobile = $('q-count-mobile');
const clearBtn = $('clear-btn');
const usersList = $('users-list');
const onlineNum = $('online-num');
const secUsers = $('sec-users');

// Danmaku & Reactions
const msgInput = $('msg-input');
const msgBtn = $('msg-btn');
const ttsToggle = $('tts-toggle');
const reactLove = $('react-love');
const reactOk = $('react-ok');
const reactBad = $('react-bad');

// Tabs (Mobile)
const tabCtrl = $('tab-ctrl');
const tabQueue = $('tab-queue');
const secCtrl = $('sec-ctrl');
const secQueue = $('sec-queue');

// Device defaults
const isMobile = window.innerWidth < 768;
let hostMode = localStorage.getItem('host') !== null ? localStorage.getItem('host') === 'true' : !isMobile;
toggleHost.checked = hostMode;

// ============================================================================
// MINIMAL LUXE INTRO — auto-enter, no click needed, epic cinematic sound
// ============================================================================
let introSoundPlayed = false;
let introDismissed = false;
let introAutoTimer = null;

function playIntroSound() {
    if (introSoundPlayed) return;
    introSoundPlayed = true;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const now = ctx.currentTime + 0.01;

        // Master chain: compressor → gain → destination
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-10, now);
        comp.ratio.setValueAtTime(4, now);
        comp.attack.setValueAtTime(0.003, now);
        comp.release.setValueAtTime(0.15, now);
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.8, now);
        comp.connect(master);
        master.connect(ctx.destination);

        // === 1. DEEP CINEMA HIT (impact thump — 120Hz→35Hz) ===
        const hit = ctx.createOscillator();
        const hitG = ctx.createGain();
        hit.type = 'sine';
        hit.frequency.setValueAtTime(120, now);
        hit.frequency.exponentialRampToValueAtTime(35, now + 0.6);
        hitG.gain.setValueAtTime(0.0001, now);
        hitG.gain.linearRampToValueAtTime(0.7, now + 0.02);
        hitG.gain.exponentialRampToValueAtTime(0.2, now + 0.4);
        hitG.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        hit.connect(hitG); hitG.connect(comp);
        hit.start(now); hit.stop(now + 1.9);

        // === 2. EPIC CINEMATIC RISER (filtered noise sweep up) ===
        const rLen = Math.floor(ctx.sampleRate * 2.5);
        const rBuf = ctx.createBuffer(1, rLen, ctx.sampleRate);
        const rD = rBuf.getChannelData(0);
        for (let i = 0; i < rLen; i++) rD[i] = Math.random() * 2 - 1;
        const riser = ctx.createBufferSource();
        riser.buffer = rBuf;
        const rFlt = ctx.createBiquadFilter();
        rFlt.type = 'bandpass';
        rFlt.frequency.setValueAtTime(150, now);
        rFlt.frequency.exponentialRampToValueAtTime(5000, now + 2.0);
        rFlt.Q.setValueAtTime(2, now);
        const rG = ctx.createGain();
        rG.gain.setValueAtTime(0.0001, now);
        rG.gain.linearRampToValueAtTime(0.18, now + 1.2);
        rG.gain.linearRampToValueAtTime(0.25, now + 1.9);
        rG.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
        riser.connect(rFlt); rFlt.connect(rG); rG.connect(comp);
        riser.start(now); riser.stop(now + 2.5);

        // === 3. POWER CHORD PAD (Cm add9 — dark & cinematic) ===
        const chordFreqs = [65.41, 97.99, 155.56, 146.83, 293.66]; // C2 G2 Eb3 D3 D4
        chordFreqs.forEach((freq, i) => {
            const o1 = ctx.createOscillator();
            const o2 = ctx.createOscillator();
            const flt = ctx.createBiquadFilter();
            const g = ctx.createGain();
            o1.type = 'sawtooth';
            o2.type = 'sawtooth';
            o1.frequency.setValueAtTime(freq, now + 0.05);
            o2.frequency.setValueAtTime(freq * 1.005, now + 0.05);
            flt.type = 'lowpass';
            flt.frequency.setValueAtTime(120, now + 0.05);
            flt.frequency.exponentialRampToValueAtTime(2200, now + 0.9);
            flt.frequency.exponentialRampToValueAtTime(400, now + 2.8);
            flt.Q.setValueAtTime(2, now);
            g.gain.setValueAtTime(0.0001, now + 0.05);
            g.gain.linearRampToValueAtTime(0.06, now + 0.5);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
            o1.connect(flt); o2.connect(flt);
            if (ctx.createStereoPanner) {
                const p = ctx.createStereoPanner();
                p.pan.setValueAtTime((i / 4) * 1.2 - 0.6, now);
                flt.connect(p); p.connect(g);
            } else { flt.connect(g); }
            g.connect(comp);
            o1.start(now + 0.05); o2.start(now + 0.05);
            o1.stop(now + 3.3); o2.stop(now + 3.3);
        });

        // === 4. SIGNATURE CHIME (3 clean tones — iconic & memorable) ===
        const chimes = [
            { freq: 523.25, t: 0.15, dur: 1.5, pan: -0.25 }, // C5
            { freq: 783.99, t: 0.55, dur: 1.3, pan: 0.25 },  // G5
            { freq: 1046.50, t: 0.95, dur: 2.0, pan: 0.0 },  // C6 (resolve)
        ];
        chimes.forEach(c => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(c.freq, now + c.t);
            g.gain.setValueAtTime(0.0001, now + c.t);
            g.gain.linearRampToValueAtTime(0.18, now + c.t + 0.01);
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

        // === 5. TAIL REVERB SHIMMER ===
        const sLen = Math.floor(ctx.sampleRate * 1.5);
        const sBuf = ctx.createBuffer(1, sLen, ctx.sampleRate);
        const sD = sBuf.getChannelData(0);
        for (let i = 0; i < sLen; i++) sD[i] = Math.random() * 2 - 1;
        const shimmer = ctx.createBufferSource();
        shimmer.buffer = sBuf;
        const sFlt = ctx.createBiquadFilter();
        sFlt.type = 'highpass';
        sFlt.frequency.setValueAtTime(6000, now + 1.0);
        sFlt.Q.setValueAtTime(1, now);
        const sG = ctx.createGain();
        sG.gain.setValueAtTime(0.0001, now + 1.0);
        sG.gain.linearRampToValueAtTime(0.035, now + 1.5);
        sG.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
        shimmer.connect(sFlt); sFlt.connect(sG); sG.connect(comp);
        shimmer.start(now + 1.0); shimmer.stop(now + 2.9);
    } catch (_) { /* silent fail */ }
}

function dismissIntro(isReplay) {
    if (introDismissed) return;
    introDismissed = true;
    clearTimeout(introAutoTimer);

    const overlay = $('intro-overlay');
    if (!overlay) return;

    overlay.classList.add('intro-exit');
    setTimeout(() => {
        overlay.style.display = 'none';
        if (!isReplay) {
            if (!myProfile.name) {
                showLogin();
            } else {
                updateProfileUI();
                socket.emit('set-profile', myProfile);
            }
        }
    }, 1300);
}

function startIntroSequence(isReplay = false) {
    introDismissed = false;
    const overlay = $('intro-overlay');
    if (!overlay) return;

    overlay.classList.remove('intro-exit');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';

    // Play sound immediately (browser may block — first gesture fallback below)
    playIntroSound();

    // Auto-dismiss after 2.5s — no click needed
    introAutoTimer = setTimeout(() => dismissIntro(isReplay), 2500);
}

// First user gesture fallback — play sound if browser blocked autoplay
['pointerdown', 'keydown'].forEach(evt => {
    window.addEventListener(evt, function _f() {
        if (!introSoundPlayed) playIntroSound();
        window.removeEventListener(evt, _f);
    }, { once: true, passive: true });
});

// Launch intro on page load
startIntroSequence(false);

// --- Profile / Login ---
function showLogin() {
    loginName.value = myProfile.name;
    loginColor.value = myProfile.color;
    loginOverlay.classList.remove('hidden');
}

loginBtn.addEventListener('click', () => {
    const name = loginName.value.trim().substring(0, 25);
    if (!name) return showToast('กรุณาใส่ชื่อเล่น', 'error');
    
    myProfile.name = name;
    myProfile.color = safeColor(loginColor.value);
    
    localStorage.setItem('nickname', myProfile.name);
    localStorage.setItem('usercolor', myProfile.color);
    
    loginOverlay.classList.add('hidden');
    updateProfileUI();
    socket.emit('set-profile', myProfile);
});

editProfileBtn.addEventListener('click', () => {
    if (typeof openSettingsModal === 'function') openSettingsModal();
    else showLogin();
});

function updateProfileUI() {
    myColorDot.style.backgroundColor = myProfile.color;
    const previewBadge = $('profile-preview-badge');
    if (previewBadge) {
        previewBadge.textContent = myProfile.name || 'ผู้ใช้ทั่วไป';
        previewBadge.style.color = myProfile.color;
        previewBadge.style.borderColor = myProfile.color;
    }
}

// --- YouTube API & Direct Video Stream Engine (Forced 1080p+ Full HD, Zero YouTube UI) ---
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
    if (directFallbackToEmbedId === videoId) return false;
    // Always use Direct Clean Stream Engine for all quality modes so no YouTube UI/menus ever appear
    return true;
}

function detectRealVideoHeightLabel() {
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

function ensureAudioUnmutedAndPlaying() {
    if (!hostMode || !state.isPlaying) return;
    const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
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

// Automatically unlock audio on any user interaction anywhere on the page
['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach((evtName) => {
    document.addEventListener(evtName, () => {
        ensureAudioUnmutedAndPlaying();
    }, { passive: true });
});

function playNativeVideoSafely() {
    if (!nativeVideo || !directStreamReadySrcSet) return;
    const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));

    if (directHasSeparateAudio && nativeAudio) {
        nativeVideo.muted = true;
        nativeAudio.muted = false;
        nativeAudio.volume = vol;
        nativeVideo.play().catch(() => {});

        const tryPlaySeparateAudio = () => {
            if (!directVideoMode || !directHasSeparateAudio || !state.isPlaying) return;
            nativeAudio.muted = false;
            nativeAudio.volume = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
            const p = nativeAudio.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    // Only if browser strictly blocked initial unmuted autoplay before first gesture,
                    // keep video rolling and retry unmuted playback immediately on next frame/canplay
                    if (err && err.name === 'NotAllowedError') {
                        setTimeout(() => {
                            if (directVideoMode && state.isPlaying && nativeAudio) {
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
                    // Start video frames immediately and retry unmuting
                    nativeVideo.muted = true;
                    nativeVideo.play().then(() => {
                        nativeVideo.muted = false;
                        nativeVideo.volume = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
                    }).catch(() => {});
                }
            });
        }
    }
}

function pauseNativeMedia() {
    if (nativeVideo && !nativeVideo.paused) nativeVideo.pause();
    if (nativeAudio && !nativeAudio.paused) nativeAudio.pause();
}

function stopDirectVideoStream() {
    directVideoMode = false;
    directVideoId = null;
    directHasSeparateAudio = false;
    directAppliedQuality = null;
    directStreamReadySrcSet = false;
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

async function startDirectVideoStream(videoId, forceReload = false, resumeTime = 0, isEmbedErrorFallback = false) {
    if (!hostMode || !nativeVideo || !videoId) return;
    const targetQuality = state.quality || 'max';
    if (!forceReload && directVideoMode && directVideoId === videoId && directAppliedQuality === targetQuality && directStreamReadySrcSet) {
        return;
    }

    directVideoMode = true;
    directVideoId = videoId;
    directAppliedQuality = targetQuality;
    directStreamReadySrcSet = false;

    // Completely hide YouTube IFrame so no YouTube pause menu, title bar, or overlays can ever show
    setYtPlayerVisible(false);

    // Pause previous native media cleanly before fetching new stream info
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

        // Ensure user hasn't switched song while awaiting info
        if (!directVideoMode || directVideoId !== videoId) return;

        directHasSeparateAudio = Boolean(info.hasSeparateAudio);
        directQualityLabel = info.qualityLabel || '1080p HD';
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;

        const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
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

        if (state.isPlaying) {
            playNativeVideoSafely();
        }
    } catch (err) {
        console.error('Direct stream init error:', err);
        if (!hostMode || !directVideoMode || directVideoId !== videoId) return;
        stopDirectVideoStream();
        if (!isEmbedErrorFallback && directFallbackToEmbedId !== videoId) {
            directFallbackToEmbedId = videoId;
            applyHostModeState();
            return;
        }
        if (state.currentVideo && state.currentVideo.videoId === videoId) {
            showToast('ไม่สามารถดึงวิดีโอตรงได้ กำลังค้นหาคลิปสำรองให้อัตโนมัติ...', 'info');
            socket.emit('resolve-error-action', 'find-alt');
        }
    }
}

if (nativeAudio) {
    nativeAudio.addEventListener('canplay', () => {
        if (!directVideoMode || !directStreamReadySrcSet || !directHasSeparateAudio || !state.isPlaying) return;
        nativeAudio.muted = false;
        nativeAudio.volume = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
        if (nativeAudio.paused) {
            nativeAudio.play().catch(() => {});
        }
    });
}

if (nativeVideo) {
    nativeVideo.addEventListener('loadedmetadata', () => {
        if (!directVideoMode || !directStreamReadySrcSet) return;
        const realLabel = detectRealVideoHeightLabel();
        if (realLabel) {
            directQualityLabel = realLabel;
            if (playerQualityBadge) playerQualityBadge.textContent = realLabel;
        }
    });

    nativeVideo.addEventListener('loadeddata', () => {
        if (!directVideoMode || !directStreamReadySrcSet) return;
        if (directVideoLoading) directVideoLoading.classList.add('hidden');
        const realLabel = detectRealVideoHeightLabel();
        if (realLabel) {
            directQualityLabel = realLabel;
            if (playerQualityBadge) playerQualityBadge.textContent = realLabel;
        }
        if (state.isPlaying) {
            playNativeVideoSafely();
        }
    });

    nativeVideo.addEventListener('waiting', () => {
        if (!directVideoMode || !directHasSeparateAudio || !nativeAudio) return;
        if (!nativeAudio.paused) nativeAudio.pause();
    });

    nativeVideo.addEventListener('playing', () => {
        if (!directVideoMode || !directStreamReadySrcSet) return;
        if (directVideoLoading) directVideoLoading.classList.add('hidden');
        const realLabel = detectRealVideoHeightLabel();
        if (realLabel) {
            directQualityLabel = realLabel;
            if (playerQualityBadge) playerQualityBadge.textContent = realLabel;
        }
        const vol = Math.max(0.05, Math.min(1, (state.volume ?? 50) / 100));
        if (directHasSeparateAudio && nativeAudio && state.isPlaying) {
            nativeVideo.muted = true;
            nativeAudio.muted = false;
            nativeAudio.volume = vol;
            if (Math.abs((nativeVideo.currentTime || 0) - (nativeAudio.currentTime || 0)) > 0.25) {
                nativeAudio.currentTime = nativeVideo.currentTime || 0;
            }
            if (nativeAudio.paused) nativeAudio.play().catch(() => {});
        } else if (!directHasSeparateAudio && state.isPlaying) {
            nativeVideo.muted = false;
            nativeVideo.volume = vol;
        }
    });

    nativeVideo.addEventListener('ended', () => {
        if (hostMode && directVideoMode && directStreamReadySrcSet) {
            pauseNativeMedia();
            socket.emit('player-video-ended');
        }
    });

    nativeVideo.addEventListener('error', () => {
        // Ignore spurious error events fired when clearing src during song transitions
        if (!hostMode || !directVideoMode || !directStreamReadySrcSet || !nativeVideo.getAttribute('src')) return;
        const failedId = directVideoId;
        stopDirectVideoStream();
        if (failedId && directFallbackToEmbedId !== failedId) {
            directFallbackToEmbedId = failedId;
            applyHostModeState();
            return;
        }
        if (state.currentVideo && state.currentVideo.videoId === failedId) {
            showToast('ไม่สามารถดึงวิดีโอตรงได้ กำลังค้นหาคลิปสำรองให้อัตโนมัติ...', 'info');
            socket.emit('resolve-error-action', 'find-alt');
        }
    });
}

function initYouTubeAPI() {
    if (window.YT) return;
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function() {
    if (!hostMode) return;
    ytPlayer = new YT.Player('yt-player', {
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
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
};

function onPlayerReady(event) {
    playerReady = true;
    applyHostModeState();
}

function onPlayerError(event) {
    console.warn('YouTube Embed Error:', event.data, '-> Switching to Direct 1080p HD Video Stream');
    if (hostMode && state.currentVideo && state.currentVideo.videoId && directFallbackToEmbedId !== state.currentVideo.videoId) {
        startDirectVideoStream(state.currentVideo.videoId, true, 0, true);
    } else {
        socket.emit('resolve-error-action', 'find-alt');
    }
}

function enforceQuality() {
    if (!hostMode || !state.currentVideo) return;
    const targetQuality = state.quality || 'max';
    const videoId = state.currentVideo.videoId;

    // If user selected forced quality (max / 1080p / 720p / 480p / 360p), use Direct HD Stream Engine
    if (targetQuality !== 'auto' && directFallbackToEmbedId !== videoId) {
        if (!directVideoMode) {
            const currTime = (ytPlayer && ytPlayer.getCurrentTime) ? (ytPlayer.getCurrentTime() || 0) : (state.currentTime || 0);
            startDirectVideoStream(videoId, true, currTime);
            return;
        }
        if (directVideoId === videoId && directAppliedQuality && directAppliedQuality !== targetQuality) {
            const currTime = nativeVideo ? (nativeVideo.currentTime || 0) : 0;
            startDirectVideoStream(videoId, true, currTime);
            return;
        }
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;
        return;
    }

    if (directVideoMode) {
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;
        return;
    }

    if (!ytPlayer || !ytPlayer.getAvailableQualityLevels || !ytPlayer.setPlaybackQuality) return;
    const target = state.quality || 'max';
    const available = ytPlayer.getAvailableQualityLevels();
    
    let selectedQuality = target;
    if (target === 'max') {
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

function onPlayerStateChange(event) {
    if (directVideoMode) return;
    if (event.data === YT.PlayerState.PLAYING) {
        try {
            if (ytPlayer && typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
            if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(state.volume ?? 50);
            if (ytPlayer && typeof ytPlayer.unloadModule === 'function') {
                ytPlayer.unloadModule('captions');
                ytPlayer.unloadModule('cc');
            }
        } catch (e) {}
        enforceQuality();
        setTimeout(enforceQuality, 1200);
    }
    if ((event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.CUED) && state.isPlaying) {
        if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
            try {
                if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
                ytPlayer.playVideo();
            } catch (e) {}
        }
    }
    if (event.data === YT.PlayerState.ENDED) {
        socket.emit('player-video-ended');
    }
}

// Host syncs progress to server & keeps 1080p split video+audio in tight sync
setInterval(() => {
    if (!hostMode) return;
    if (directVideoMode && nativeVideo && !nativeVideo.paused) {
        if (directHasSeparateAudio && nativeAudio && !nativeAudio.paused) {
            const drift = Math.abs((nativeVideo.currentTime || 0) - (nativeAudio.currentTime || 0));
            if (drift > 0.28) {
                nativeVideo.currentTime = nativeAudio.currentTime;
            }
        }
        const currentTime = (directHasSeparateAudio && nativeAudio && !nativeAudio.paused)
            ? (nativeAudio.currentTime || 0)
            : (nativeVideo.currentTime || 0);
        const duration = isFinite(nativeVideo.duration) && nativeVideo.duration > 0
            ? nativeVideo.duration
            : (nativeAudio && isFinite(nativeAudio.duration) ? nativeAudio.duration : 0);
        socket.emit('player-progress', {
            currentTime: currentTime,
            duration: duration
        });
        updateProgress(currentTime, duration);
        return;
    }
    if (playerReady && ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        const currentTime = ytPlayer.getCurrentTime();
        const duration = ytPlayer.getDuration();
        socket.emit('player-progress', {
            currentTime: currentTime,
            duration: duration
        });
        updateProgress(currentTime, duration);
    }
}, 1000);

// --- Modes: Host vs Client ---
function updateUIMode() {
    const addQueueCard = $('add-queue-card');
    const soundboardCard = $('soundboard-card');

    if (hostMode) {
        // Host mode
        document.body.classList.remove('client-mode');
        hostBadge.classList.remove('hidden');
        clientControls.classList.add('hidden');
        if (addQueueCard) addQueueCard.classList.add('hidden');
        if (soundboardCard) soundboardCard.classList.add('hidden');
        qrContainer.classList.remove('hidden');
        fitQrUrlText();
        secUsers.style.display = 'none';
        if (!window.YT) initYouTubeAPI();
        else if (!ytPlayer) window.onYouTubeIframeAPIReady();
        applyHostModeState();
    } else {
        // Client mode
        document.body.classList.add('client-mode');
        hostBadge.classList.add('hidden');
        clientControls.classList.remove('hidden');
        if (addQueueCard) addQueueCard.classList.remove('hidden');
        if (soundboardCard) soundboardCard.classList.remove('hidden');
        qrContainer.classList.add('hidden');
        secUsers.style.display = '';
        stopDirectVideoStream();
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        if (unmuteBtn) unmuteBtn.classList.add('hidden');
    }
}

toggleHost.addEventListener('change', (e) => {
    hostMode = e.target.checked;
    localStorage.setItem('host', hostMode);
    updateUIMode();
});

// Init on load
updateUIMode();

// --- Render UI ---
function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getYoutubeThumb(videoId) {
    if (!videoId) return '';
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function getTrackThumb(item) {
    if (!item) return '';
    if (item.thumbnail && /^https?:\/\//i.test(item.thumbnail)) {
        return item.thumbnail;
    }
    return getYoutubeThumb(item.videoId);
}

function getSourceIconHtml(item) {
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

function getAutoDjModeShortLabel(mode, customQuery) {
    if (customQuery && customQuery.trim()) {
        return `✨ ${customQuery.trim()}`;
    }
    return AUTO_DJ_MODE_LABELS[mode] || AUTO_DJ_MODE_LABELS.khlerm;
}

let lastRenderedVideoId = null;
let lastQueueSignature = null;
let knownQueueIds = new Set();

function renderState() {
    if (nowPlayingCard) nowPlayingCard.scrollTop = 0;

    // Current Video + Now Playing Thumbnail & Ambient Glow
    const currentId = state.currentVideo ? `${state.currentVideo.videoId}:${state.currentVideo.thumbnail || ''}` : null;

    if (state.currentVideo) {
        nowTitle.textContent = state.currentVideo.title;
        const authorText = state.currentVideo.author ? escapeHtml(state.currentVideo.author) : 'กำลังเล่นเพลง';
        nowAuthor.innerHTML = `${getSourceIconHtml(state.currentVideo)}${authorText}`;
        if (nowAddedBy) {
            nowAddedBy.innerHTML = `เพิ่มโดย: <span style="color:${safeColor(state.currentVideo.color)}" class="font-semibold">${escapeHtml(state.currentVideo.addedBy || 'สมาชิก')}</span>`;
            nowAddedBy.classList.remove('hidden');
        }

        // Smooth fade-out for empty state
        emptyState.classList.remove('opacity-100', 'scale-100');
        emptyState.classList.add('opacity-0', 'scale-95', 'pointer-events-none');

        if (nowPlayingCard) nowPlayingCard.classList.add('now-playing-card');

        // Animate & update thumbnail only when track changes
        if (currentId !== lastRenderedVideoId) {
            const thumbUrl = getTrackThumb(state.currentVideo);
            if (nowThumb) {
                nowThumb.classList.remove('loaded', 'hidden');
                nowThumb.onload = () => {
                    nowThumb.classList.add('loaded');
                    if (nowThumbEmpty) nowThumbEmpty.classList.add('opacity-0', 'pointer-events-none');
                };
                nowThumb.onerror = () => {
                    const fallback = getYoutubeThumb(state.currentVideo?.videoId);
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
            lastRenderedVideoId = currentId;
        }

        // Equalizer & live dot state
        if (nowEq) {
            nowEq.classList.remove('hidden');
            nowEq.classList.toggle('eq-paused', !state.isPlaying);
        }
        if (nowLiveDot) {
            nowLiveDot.className = state.isPlaying
                ? 'w-1.5 h-1.5 rounded-full bg-brand-peri animate-pulse transition-colors duration-300'
                : 'w-1.5 h-1.5 rounded-full bg-yellow-400/80 transition-colors duration-300';
        }
    } else {
        nowTitle.textContent = 'ยังไม่มีเพลง';
        nowAuthor.textContent = '—';
        if (nowAddedBy) {
            nowAddedBy.textContent = '';
            nowAddedBy.classList.add('hidden');
        }

        // Smooth fade-in for empty state
        emptyState.classList.remove('hidden', 'opacity-0', 'scale-95', 'pointer-events-none');
        emptyState.classList.add('opacity-100', 'scale-100');

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
            nowLiveDot.className = 'w-1.5 h-1.5 rounded-full bg-brand-peri/40 transition-colors duration-300';
        }
        lastRenderedVideoId = null;
    }

    if (typeof updateKaraokeButtonUI === 'function') {
        updateKaraokeButtonUI();
    }
    if (typeof syncLyricsForCurrentTrack === 'function') {
        syncLyricsForCurrentTrack();
    }

    // Play/Pause icon & label
    iconPlay.className = state.isPlaying ? "fa-solid fa-pause text-base text-brand-peri" : "fa-solid fa-play text-base text-brand-peri";
    if (playLabel) {
        playLabel.textContent = state.isPlaying ? 'หยุดชั่วคราว' : 'เล่นเพลง';
    }

    // Volume
    volSlider.value = state.volume;
    volLabel.textContent = `${state.volume}%`;

    // Quality
    if (qualitySelect && state.quality) {
        qualitySelect.value = state.quality;
    }

    // Queue
    qCount.textContent = state.queue.length;
    qCountMobile.textContent = state.queue.length;

    const autoDjSig = `${Boolean(state.autoDjEnabled)}:${state.autoDjMode || 'khlerm'}:${state.autoDjCustomQuery || ''}`;
    const currentSignature = state.queue.length > 0
        ? state.queue.map(i => `${i.id}:${i.videoId}:${i.title}`).join('|')
        : `EMPTY:${autoDjSig}`;
    if (currentSignature !== lastQueueSignature) {
        if (state.queue.length === 0) {
            if (state.autoDjEnabled !== false) {
                const modeLabel = getAutoDjModeShortLabel(state.autoDjMode, state.autoDjCustomQuery);
                queueList.innerHTML = `
                    <div class="text-center py-3.5 px-2 space-y-1.5 animate-fade-in-up">
                        <p class="text-[10px] text-brand-light/35">คิวว่างเปล่า — ระบบจะสุ่มเพลงเล่นต่ออัตโนมัติ</p>
                        <button type="button" data-open-autodj-settings="1" class="text-[10px] text-purple-300 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/30 rounded-lg py-1.5 px-2.5 inline-flex items-center gap-1.5 transition cursor-pointer" title="คลิกเพื่อเปลี่ยนโหมด Auto-DJ ในเมนูตั้งค่า">
                            <i class="fa-solid fa-wand-magic-sparkles text-purple-400 animate-pulse"></i>
                            <span>Auto-DJ: <strong>${escapeHtml(modeLabel)}</strong></span>
                            <i class="fa-solid fa-sliders text-[9px] text-purple-300/70 ml-0.5"></i>
                        </button>
                    </div>
                `;
            } else {
                queueList.innerHTML = `<p class="text-center text-[10px] text-brand-light/30 py-4 animate-fade-in-up">คิวว่างเปล่า (ปิด Auto-DJ อยู่)</p>`;
            }
            knownQueueIds.clear();
        } else {
            const nextKnownIds = new Set();
            queueList.innerHTML = state.queue.map((item, index) => {
                const isNew = !knownQueueIds.has(item.id);
                nextKnownIds.add(item.id);
                const delayMs = isNew ? Math.min(index * 45, 250) : 0;
                const animClass = isNew ? 'animate-fade-in-up' : '';
                const thumbUrl = getTrackThumb(item);

                return `
                <div data-queue-card="${escapeHtml(item.id)}" style="animation-delay: ${delayMs}ms" class="flex items-center gap-2.5 p-2 bg-[#0a0a0a]/90 hover:bg-[#111822]/90 rounded-lg border border-brand-deep/30 hover:border-brand-peri/40 transition-all duration-300 group ${animClass}">
                    <span class="text-[10px] text-brand-light/50 w-4 text-center font-mono shrink-0">${index + 1}</span>
                    <div class="relative w-14 h-9 rounded-md overflow-hidden bg-[#050505] border border-brand-deep/40 shrink-0 shadow-sm">
                        <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" class="w-full h-full object-cover thumb-img group-hover:scale-110" onload="this.classList.add('loaded')">
                        <div class="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-300"></div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-medium text-white group-hover:text-brand-peri transition-colors duration-200 truncate">${escapeHtml(item.title)}</p>
                        <p class="text-[9px] text-brand-light/50 truncate mt-0.5">${getSourceIconHtml(item)}เพิ่มโดย: <span style="color:${safeColor(item.color)}" class="font-medium">${escapeHtml(item.addedBy)}</span></p>
                    </div>
                    <button data-remove-id="${escapeHtml(item.id)}" class="w-6 h-6 rounded-md bg-red-900/20 text-red-400 hover:bg-red-500 hover:text-white transition-all duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center justify-center shrink-0" title="ลบออกจากคิว">
                        <i class="fa-solid fa-trash text-[10px]"></i>
                    </button>
                </div>
            `;
            }).join('');
            knownQueueIds = nextKnownIds;
        }
        lastQueueSignature = currentSignature;
    }

    if (typeof syncAutoDjSettingsUI === 'function') {
        syncAutoDjSettingsUI();
    }
    applyHostModeState();
}

// Queue delegation for delete buttons with smooth fade-out animation
queueList.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-autodj-settings]')) {
        if (typeof openSettingsModal === 'function') openSettingsModal();
        return;
    }
    const btn = e.target.closest('[data-remove-id]');
    if (btn) {
        const id = btn.getAttribute('data-remove-id');
        if (!id) return;
        const card = btn.closest('[data-queue-card]');
        if (card) {
            card.classList.remove('animate-fade-in-up');
            card.classList.add('animate-fade-out-slide');
            setTimeout(() => {
                socket.emit('remove-from-queue', id);
            }, 240);
        } else {
            socket.emit('remove-from-queue', id);
        }
    }
});

function applyHostModeState() {
    if (!state.currentVideo) {
        activePlayerVideoId = null;
        directFallbackToEmbedId = null;
        lastLoadedYtVideoId = null;
        stopDirectVideoStream();
        setYtPlayerVisible(false);
        return;
    }

    const videoId = state.currentVideo.videoId;

    if (!hostMode) return;

    const isNewTrack = videoId !== activePlayerVideoId;
    if (isNewTrack) {
        activePlayerVideoId = videoId;
        directFallbackToEmbedId = null;
        lastLoadedYtVideoId = null;
    }

    // Always use Direct Clean 1080p+ HD Stream so no YouTube UI/pause menus ever show
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

    // Fallback to YouTube IFrame only if Direct Stream failed
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
    }

    ytPlayer.setVolume(state.volume ?? 50);
}

function updateProgress(curr, dur) {
    if (dur > 0) {
        const p = (curr / dur) * 100;
        progressFill.style.width = `${Math.min(100, Math.max(0, p))}%`;
        timeNow.textContent = formatTime(curr);
        timeTotal.textContent = formatTime(dur);
    } else {
        progressFill.style.width = `0%`;
        timeNow.textContent = '0:00';
        timeTotal.textContent = '0:00';
    }
    if (typeof updateActiveLyricLine === 'function') {
        updateActiveLyricLine(curr);
    }
}

// --- 3-Click Skip Logic ---
let skipCount = 0;
let skipTimer = null;

btnSkip.addEventListener('click', () => {
    skipCount++;
    clearTimeout(skipTimer);
    
    if (skipCount === 1) {
        skipLabel.textContent = "แน่ใจ?";
        skipLabel.className = "text-[9px] mt-0.5 text-yellow-400";
        btnSkip.classList.add('border-yellow-500/50');
    } else if (skipCount === 2) {
        skipLabel.textContent = "ยืนยัน?";
        skipLabel.className = "text-[9px] mt-0.5 text-red-500 font-bold";
        btnSkip.classList.remove('border-yellow-500/50');
        btnSkip.classList.add('border-red-500');
    } else if (skipCount === 3) {
        socket.emit('skip-video');
        resetSkipBtn();
        return;
    }
    
    skipTimer = setTimeout(resetSkipBtn, 3000);
});

function resetSkipBtn() {
    skipCount = 0;
    skipLabel.textContent = "ข้ามเลย";
    skipLabel.className = "text-[10px] font-medium";
    btnSkip.className = "bg-red-950/30 hover:bg-red-900/45 border border-red-500/35 text-red-400 rounded-xl py-2 px-3 flex flex-col items-center justify-center gap-0.5 transition active:scale-95 relative overflow-hidden shadow-sm";
}

// --- Actions ---
const addBtnIcon = $('add-btn-icon');
addBtn.addEventListener('click', () => {
    const val = urlInput.value.trim();
    if(!val) return showToast('กรุณาวางลิงก์ YouTube หรือ Spotify ก่อนกดเพิ่ม', 'error');
    socket.emit('add-to-queue', { 
        url: val, 
        nickname: myProfile.name,
        color: myProfile.color 
    });
    urlInput.value = '';
});

socket.on('add-queue-status', (status) => {
    if (!status) return;
    if (status.message) showToast(status.message, 'info');
    if (addBtnIcon) {
        addBtnIcon.className = status.loading
            ? 'fa-solid fa-spinner fa-spin'
            : 'fa-solid fa-plus';
    }
    addBtn.disabled = Boolean(status.loading);
});

urlInput.addEventListener('keypress', e => {
    if(e.key === 'Enter') addBtn.click();
});

btnPlay.addEventListener('click', () => {
    socket.emit('play-control', !state.isPlaying);
});

volSlider.addEventListener('input', e => {
    socket.emit('volume-control', parseInt(e.target.value));
});

volDown.addEventListener('click', () => socket.emit('volume-control', Math.max(0, state.volume - 10)));
volUp.addEventListener('click', () => socket.emit('volume-control', Math.min(100, state.volume + 10)));

if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
        const val = e.target.value;
        directFallbackToEmbedId = null;
        socket.emit('quality-control', val);
        showToast(`ตั้งค่าความคมชัดเป็น: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });
}

clearBtn.addEventListener('click', () => {
    if(confirm('ล้างคิวทั้งหมดหรือไม่?')) socket.emit('clear-queue');
});

progressBar.addEventListener('click', (e) => {
    if(!state.currentVideo || !state.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const seekTime = pos * state.duration;
    socket.emit('seek-to', seekTime);
});

// Reactions
const sendReact = (emoji) => socket.emit('send-reaction', emoji);
reactLove.addEventListener('click', () => sendReact('😍'));
reactOk.addEventListener('click', () => sendReact('👍'));
reactBad.addEventListener('click', () => sendReact('👎'));

// Danmaku
msgBtn.addEventListener('click', () => {
    const text = msgInput.value.trim();
    if(!text) return;
    socket.emit('send-danmaku', {
        text: text,
        nickname: myProfile.name,
        color: myProfile.color,
        tts: ttsToggle.checked
    });
    msgInput.value = '';
});

msgInput.addEventListener('keypress', e => {
    if(e.key === 'Enter') msgBtn.click();
});

socket.on('show-toast-broadcast', (msg) => {
    showToast(msg, 'info');
});

// Helper: Scale URL text so its width matches the exact QR code width (120px)
let currentPartyLink = '';
function fitQrUrlText() {
    const urlEl = document.getElementById('url-display');
    if (!urlEl || !urlEl.textContent) return;
    const targetWidth = 120;
    urlEl.style.transform = 'none';
    urlEl.style.fontSize = '12px';
    urlEl.style.display = 'inline-block';

    const measured = urlEl.scrollWidth || urlEl.offsetWidth;
    if (measured > 0) {
        const exactSize = Math.min(11.5, Math.max(5.5, (12 * targetWidth) / measured));
        urlEl.style.fontSize = `${exactSize.toFixed(2)}px`;
        const afterWidth = urlEl.scrollWidth || urlEl.offsetWidth;
        if (afterWidth > 0 && Math.abs(afterWidth - targetWidth) > 0.5) {
            urlEl.style.transformOrigin = 'center top';
            urlEl.style.transform = `scaleX(${(targetWidth / afterWidth).toFixed(4)})`;
        }
    }
}

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => fitQrUrlText());
}

if (qrContainer) {
    qrContainer.addEventListener('click', () => {
        if (!currentPartyLink || !navigator.clipboard) return;
        navigator.clipboard.writeText(currentPartyLink).then(() => {
            showToast('คัดลอกลิงก์ปาร์ตี้เรียบร้อย!', 'info');
        }).catch(() => {});
    });
}

// --- Socket Listeners ---
socket.on('init', (data) => {
    state = data.state;
    renderState();
    
    // Generate QR
    qrContainer.innerHTML = `
        <div id="qrcode" class="w-[120px] h-[120px] flex items-center justify-center"></div>
        <div class="w-[120px] mt-1.5 pt-1 border-t border-slate-200 text-center overflow-hidden flex justify-center">
            <span id="url-display" class="text-[9px] text-[#1c2938] font-bold select-all whitespace-nowrap leading-tight block"></span>
        </div>
    `;
    
    let link = window.location.origin;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        link = `http://${data.localIp}:${data.port}`;
    }
    currentPartyLink = link;
    
    new QRCode(document.getElementById("qrcode"), {
        text: link,
        width: 120,
        height: 120,
        colorDark : "#1c2938",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
    });
    document.getElementById('url-display').textContent = link;
    requestAnimationFrame(() => fitQrUrlText());

    if (data.users) updateUsersList(data.users);
    if (data.navState && typeof applyRemoteNavState === 'function') {
        applyRemoteNavState(data.navState, true);
    }
});

socket.on('state-update', (newState) => {
    state = newState;
    renderState();
    if (hostMode) enforceQuality();
});

socket.on('time-update', (data) => {
    if (!hostMode) {
        state.currentTime = data.currentTime;
        state.duration = data.duration;
        updateProgress(data.currentTime, data.duration);
    }
});

socket.on('seek-video', (seconds) => {
    if (!hostMode) return;
    if (directVideoMode && nativeVideo) {
        nativeVideo.currentTime = seconds;
        if (directHasSeparateAudio && nativeAudio) {
            nativeAudio.currentTime = seconds;
        }
        return;
    }
    if (playerReady && ytPlayer && ytPlayer.seekTo) {
        ytPlayer.seekTo(seconds, true);
    }
});

socket.on('users-update', (users) => {
    updateUsersList(users);
});

function updateUsersList(users) {
    const keys = Object.keys(users);
    onlineNum.textContent = keys.length;
    
    const onlineCount = $('online-count');
    if (keys.length > 0) {
        onlineCount.classList.remove('hidden');
    } else {
        onlineCount.classList.add('hidden');
    }
    
    if (keys.length === 0) {
        usersList.innerHTML = `<p class="text-[9px] text-brand-light/30 py-2">ไม่มีผู้ใช้</p>`;
        return;
    }

    usersList.innerHTML = keys.map(id => {
        const u = users[id];
        const color = safeColor(u.color);
        return `<div class="bg-[#0a0a0a] border border-brand-deep/30 rounded px-2 py-1 text-[10px] flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${color}"></span>
            <span style="color: ${color}">${escapeHtml(u.name) || 'ผู้ใช้ทั่วไป'}</span>
        </div>`;
    }).join('');
}

// Visuals
socket.on('new-reaction', emoji => {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '10%';
    playerArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('new-danmaku', data => {
    if (hostMode && data.tts) {
        const textToSpeak = (data.text || '').substring(0, 70);
        if (typeof speakThaiText === 'function') {
            speakThaiText(textToSpeak, true);
        }
    }

    const el = document.createElement('div');
    el.className = 'danmaku-text';
    const color = safeColor(data.color);
    el.innerHTML = `<span style="color: ${color}">${escapeHtml(data.nickname) || ''}:</span> ${escapeHtml(data.text)}`;
    el.style.top = (Math.random() * 60 + 10) + '%';
    el.style.animationDuration = (Math.random() * 4 + 7) + 's';
    danmakuLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('error-msg', msg => showToast(msg, 'error'));

// --- Connection Status Badge ---
const statusBadge = $('status-badge');

socket.on('connect', () => {
    statusBadge.innerHTML = '● เชื่อมต่อแล้ว';
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/30';
});

socket.on('disconnect', () => {
    statusBadge.innerHTML = '● ขาดการเชื่อมต่อ';
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/30';
});

// --- Mobile Tabs ---
if (tabCtrl && tabQueue) {
    tabCtrl.addEventListener('click', () => {
        secCtrl.classList.remove('hidden', 'animate-fade-in-up');
        void secCtrl.offsetWidth;
        secCtrl.classList.add('animate-fade-in-up');
        secQueue.classList.add('hidden');
        tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-brand-peri border-b-2 border-brand-peri transition-colors duration-200';
        tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-brand-light/50 border-b-2 border-transparent transition-colors duration-200';
    });

    tabQueue.addEventListener('click', () => {
        secCtrl.classList.add('hidden');
        secQueue.classList.remove('hidden', 'animate-fade-in-up');
        void secQueue.offsetWidth;
        secQueue.classList.add('animate-fade-in-up');
        tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-brand-peri border-b-2 border-brand-peri transition-colors duration-200';
        tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-brand-light/50 border-b-2 border-transparent transition-colors duration-200';
    });
}

// --- Fullscreen & Theater Mode ---
const fsBtn = $('fs-btn');
const theaterBtn = $('theater-btn');

theaterBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            showToast(`Error: ${err.message}`, 'error');
        });
    } else {
        document.exitFullscreen();
    }
});

fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        playerArea.requestFullscreen().catch(err => {
            showToast(`Error: ${err.message}`, 'error');
        });
    } else {
        document.exitFullscreen();
    }
});

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === document.documentElement) {
        document.body.classList.add('web-fullscreen');
    } else {
        document.body.classList.remove('web-fullscreen');
    }
});

// Preload voices for TTS
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.getVoices();
}

// ============================================================================
// WEATHER RADAR SPLIT VIEW & GPS NAVIGATION SYSTEM
// ============================================================================
const headerRadarBtn = $('header-radar-btn');
const sidebarOpenRadarBtn = $('sidebar-open-radar-btn');
const sidebarOpenNavBtn = $('sidebar-open-nav-btn');
const sidebarWeatherMini = $('sidebar-weather-mini');
const radarNavPanel = $('radar-nav-panel');
const btnModeMapRadar = $('btn-mode-map-radar');
const btnModeWindy = $('btn-mode-windy');
const btnNavTts = $('btn-nav-tts');
const btnRefreshGps = $('btn-refresh-gps');
const gpsSpinIcon = $('gps-spin-icon');
const btnCloseRadar = $('btn-close-radar');

// Weather DOM
const weatherLocName = $('weather-loc-name');
const weatherTemp = $('weather-temp');
const weatherDesc = $('weather-desc');
const weatherRainProb = $('weather-rain-prob');
const weatherWind = $('weather-wind');
const weatherHumidity = $('weather-humidity');
const weatherAdvice = $('weather-advice');

// Navigation DOM
const navStepInput = $('nav-step-input');
const navStepPreview = $('nav-step-preview');
const navStepActive = $('nav-step-active');
const routeLinkInput = $('route-link-input');
const routeCheckBtn = $('route-check-btn');
const routeCheckIcon = $('route-check-icon');
const previewDestName = $('preview-dest-name');
const previewRouteSummary = $('preview-route-summary');
const previewDuration = $('preview-duration');
const previewDistance = $('preview-distance');
const navStartBtn = $('nav-start-btn');
const navCancelPreviewBtn = $('nav-cancel-preview-btn');
const navTurnIcon = $('nav-turn-icon');
const navNextInstruction = $('nav-next-instruction');
const navRoadStatus = $('nav-road-status');
const navEtaMins = $('nav-eta-mins');
const navRemDist = $('nav-rem-dist');
const navArrivalTime = $('nav-arrival-time');
const navGpsPingStatus = $('nav-gps-ping-status');
const navPingNowBtn = $('nav-ping-now-btn');
const navStopBtn = $('nav-stop-btn');
const navProgressPct = $('nav-progress-pct');
const navProgressFill = $('nav-progress-fill');
const btnTriggerShowcase = $('btn-trigger-showcase');
const radarShowcaseBanner = $('radar-showcase-banner');
const showcaseCountdown = $('showcase-countdown');
const showcaseSubInfo = $('showcase-sub-info');
const btnExitShowcase = $('btn-exit-showcase');

// Map & Radar DOM
const leafletRadarMapEl = $('leaflet-radar-map');
const windyRadarIframe = $('windy-radar-iframe');
const radarTimelineBar = $('radar-timeline-bar');
const radarPlayBtn = $('radar-play-btn');
const radarPlayIcon = $('radar-play-icon');
const radarTimeLabel = $('radar-time-label');
const toggleRadarOverlay = $('toggle-radar-overlay');
const btnMapStyle = $('btn-map-style');
const mapStyleLabel = $('map-style-label');

let splitRadarOpen = false;
let radarViewMode = 'map'; // 'map' | 'windy'
let mapStyleMode = 'dark'; // 'dark' | 'street' | 'hybrid'
let navTtsEnabled = true;
let userCoords = null; // { lat, lon, label }
let currentWeatherInfo = null;

// Leaflet instances
let radarMap = null;
let baseTileLayer = null;
let userMarker = null;
let destMarker = null;
let routePolyline = null;
let routeGlowLine = null;

// RainViewer Radar Animation state
let rainviewerHost = 'https://tilecache.rainviewer.com';
let radarFrames = [];
let radarTileLayers = {};
let currentRadarFrameIdx = 0;
let radarAnimTimer = null;
let radarPlaying = true;
let radarOverlayVisible = true;

// Navigation State
let pendingDestination = null; // { lat, lon, name, distanceKm, durationMin, initialDistanceKm, summary }
let activeNavigation = false;
let navPollTimer = null;
let lastSpokenEtaMin = null;
let hasWarnedRainVoice = false;
let hasAlerted90Pct = false;
let isApplyingRemoteNav = false;

// 20-Minute Auto Showcase (20 Seconds Display) State
const AUTO_SHOWCASE_INTERVAL_MS = 20 * 60 * 1000; // Every 20 minutes
const SHOWCASE_DURATION_SEC = 10;                 // Show Map/Radar in place of Control Panel for 10 seconds, then hide map & restore Control Panel
let autoShowcaseInterval = null;
let showcaseCountdownTimer = null;
let showcaseRemainingSec = 0;

// Soft Web Audio Chime & Reliable Thai Voice Alert System (Works on Host even when triggered via Socket.io)
let softAudioCtx = null;
let audioUnlocked = false;
let ttsAudioEl = null;
let activeTtsBufferSource = null;
let lastChimeTime = 0;
let mediaDuckTimer = null;
let pendingRemoteAlertAudio = null;

function setHostPlayerVolume(volPercent) {
    if (!hostMode) return;
    const clamped = Math.max(0, Math.min(100, volPercent));
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

function duckHostMediaVolume(durationMs = 5200) {
    if (!hostMode) return;
    const baseVol = state.volume ?? 50;
    const duckedVol = Math.min(baseVol, Math.max(10, Math.round(baseVol * 0.25)));
    setHostPlayerVolume(duckedVol);
    clearTimeout(mediaDuckTimer);
    mediaDuckTimer = setTimeout(() => {
        setHostPlayerVolume(state.volume ?? 50);
    }, durationMs);
}

function unlockAudioSystem() {
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

['pointerdown', 'click', 'touchstart', 'keydown'].forEach((evtName) => {
    document.addEventListener(evtName, unlockAudioSystem, { passive: true });
});

function playSoftAlertChime(type = 'rain') {
    lastChimeTime = Date.now();
    duckHostMediaVolume(4800);

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!softAudioCtx) softAudioCtx = new AudioCtx();

        const triggerSound = () => {
            const ctx = softAudioCtx;
            const now = ctx.currentTime + 0.01;

            // Compressor for punch
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.setValueAtTime(-10, now);
            comp.ratio.setValueAtTime(4, now);
            comp.attack.setValueAtTime(0.003, now);
            comp.release.setValueAtTime(0.15, now);
            comp.connect(ctx.destination);

            // --- Config per type ---
            let hitFreqStart = 100, hitFreqEnd = 38;
            let hitVol = 0.55;
            let chordFreqs, chordVol = 0.045;
            let chimeNotes, chimeVol = 0.16;

            if (type === 'storm') {
                hitFreqStart = 130; hitFreqEnd = 30; hitVol = 0.7;
                chordFreqs = [65.41, 97.99, 155.56, 146.83]; // Cm dark
                chordVol = 0.055;
                chimeNotes = [
                    { freq: 440.00, t: 0.12, dur: 0.8, pan: -0.3 },
                    { freq: 554.37, t: 0.35, dur: 0.7, pan: 0.3 },
                    { freq: 659.25, t: 0.55, dur: 1.0, pan: 0.0 },
                ];
                chimeVol = 0.2;
            } else if (type === 'near-90pct') {
                hitFreqStart = 110; hitFreqEnd = 42; hitVol = 0.5;
                chordFreqs = [130.81, 164.81, 196.00, 246.94]; // Cmaj7 warm
                chordVol = 0.05;
                chimeNotes = [
                    { freq: 587.33, t: 0.12, dur: 1.0, pan: -0.2 },
                    { freq: 783.99, t: 0.40, dur: 0.9, pan: 0.2 },
                    { freq: 1174.66, t: 0.70, dur: 1.5, pan: 0.0 },
                ];
                chimeVol = 0.18;
            } else {
                // rain — gentle
                hitFreqStart = 90; hitFreqEnd = 45; hitVol = 0.4;
                chordFreqs = [130.81, 164.81, 196.00, 246.94]; // Cmaj7
                chordVol = 0.04;
                chimeNotes = [
                    { freq: 523.25, t: 0.12, dur: 1.0, pan: -0.25 },
                    { freq: 783.99, t: 0.42, dur: 0.9, pan: 0.25 },
                    { freq: 1046.50, t: 0.72, dur: 1.5, pan: 0.0 },
                ];
                chimeVol = 0.15;
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

            // 2. Dark/warm power chord pad
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
                if (unmuteBtn) unmuteBtn.classList.remove('hidden');
            });
        } else {
            triggerSound();
        }
    } catch (e) {}
}

function emitNavStatePatch(patch) {
    if (isApplyingRemoteNav) return;
    socket.emit('sync-nav-state', patch);
}

function emitLyricsStateSync() {
    if (isApplyingRemoteNav) return;
    emitNavStatePatch({
        lyricsVisible: lyricsVisible,
        lyricsOverlayDismissed: overlayDismissedForTrack,
        lyricsUserShiftSec: lyricsUserShiftSec,
        lyricsCinemaMode: lyricsCinemaMode
    });
}

function speakBrowserFallback(text) {
    if (!('speechSynthesis' in window) || !text) return;
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

function speakThaiText(text, forceSpeak = false) {
    if ((!navTtsEnabled && !forceSpeak) || !text) return;

    duckHostMediaVolume(6000);

    // Wait briefly if a chime just started so the chime rings clearly before the voice begins
    const elapsedSinceChime = Date.now() - lastChimeTime;
    const delayMs = elapsedSinceChime < 420 ? (420 - elapsedSinceChime) : 0;

    setTimeout(async () => {
        const ttsUrl = `/api/tts-thai?text=${encodeURIComponent(text.substring(0, 190))}`;

        // 1. Stop any currently playing TTS buffer/audio
        if (activeTtsBufferSource) {
            try { activeTtsBufferSource.stop(); } catch (e) {}
            activeTtsBufferSource = null;
        }
        if (ttsAudioEl) {
            try { ttsAudioEl.pause(); } catch (e) {}
        }

        // 2. Primary: Fetch Thai TTS MP3 from our server and play via Web Audio API (bypasses SpeechSynthesis remote gesture blocks & works even without Windows Thai voice pack)
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
                    gainNode.gain.value = 1.35; // Boost voice clarity
                    source.buffer = audioBuffer;
                    source.playbackRate.value = 1.18; // Slightly faster TTS
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

            // 3. Secondary: Play via HTML5 Audio element
            if (!ttsAudioEl) ttsAudioEl = new Audio();
            const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            ttsAudioEl.src = blobUrl;
            ttsAudioEl.volume = 1.0;
            ttsAudioEl.playbackRate = 1.18; // Slightly faster TTS
            const playProm = ttsAudioEl.play();
            if (playProm && typeof playProm.then === 'function') {
                await playProm;
                ttsAudioEl.onended = () => URL.revokeObjectURL(blobUrl);
                return;
            }
        } catch (err) {
            // If autoplay blocked on Host before first click, queue it for immediate playback on click and try browser SpeechSynthesis
            pendingRemoteAlertAudio = { ...(pendingRemoteAlertAudio || {}), voiceText: text };
            if (hostMode && unmuteBtn) unmuteBtn.classList.remove('hidden');
        }

        // 4. Tertiary Fallback: Browser SpeechSynthesis API
        speakBrowserFallback(text);
    }, delayMs);
}

function getWmoWeatherThai(code) {
    if (code === 0) return { text: '☀️ ท้องฟ้าแจ่มใส', rainAlert: false, advice: '☀️ สภาพอากาศปลอดโปร่ง ทัศนวิสัยดีเยี่ยม เหมาะแก่การเดินทาง' };
    if (code === 1 || code === 2) return { text: '⛅ มีเมฆบางส่วน', rainAlert: false, advice: '⛅ อากาศปกติ มีเมฆบางส่วน เดินทางได้สะดวก' };
    if (code === 3) return { text: '☁️ มีเมฆมาก', rainAlert: false, advice: '☁️ ท้องฟ้าครึ้มมีเมฆมาก อาจมีฝนตกในบางพื้นที่' };
    if (code === 45 || code === 48) return { text: '🌫️ มีหมอกลงจัด', rainAlert: true, advice: '⚠️ มีหมอกหนา ทัศนวิสัยลดลง โปรดเปิดไฟหน้าและลดความเร็ว' };
    if (code >= 51 && code <= 57) return { text: '🌦️ ฝนตกปรอยๆ', rainAlert: true, advice: '🌦️ มีฝนปรอยๆ ถนนอาจลื่น โปรดระมัดระวังในการขับขี่' };
    if (code >= 61 && code <= 67) return { text: '🌧️ ฝนตกปานกลางถึงหนัก', rainAlert: true, advice: '🌧️ ฝนกำลังตกในพื้นที่ ถนนลื่น ควรเว้นระยะห่างจากคันหน้า' };
    if (code >= 80 && code <= 82) return { text: '🌧️ ฝนฟ้าคะนองเป็นระยะ', rainAlert: true, advice: '🌧️ มีกลุ่มฝนตกหนักเป็นระยะ โปรดตรวจสอบเรดาร์เมฆฝนข้างเคียง' };
    if (code >= 95) return { text: '⛈️ พายุฝนฟ้าคะนองรุนแรง', rainAlert: true, advice: '⛈️ คำเตือน! มีพายุฝนฟ้าคะนองและลมกระโชกแรง โปรดหลีกเลี่ยงพื้นที่น้ำท่วมขัง' };
    return { text: '🌤️ สภาพอากาศทั่วไป', rainAlert: false, advice: '🌤️ สภาพอากาศปกติ เดินทางปลอดภัย' };
}

function applyMapBaseLayer(mode) {
    if (!radarMap || typeof L === 'undefined') return;
    mapStyleMode = mode;
    if (baseTileLayer && radarMap.hasLayer(baseTileLayer)) {
        radarMap.removeLayer(baseTileLayer);
    }

    if (leafletRadarMapEl) {
        leafletRadarMapEl.classList.toggle('map-theme-dark', mode === 'dark');
    }

    const lyrs = mode === 'hybrid' ? 'y' : 'm';
    baseTileLayer = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=${lyrs}&hl=th&x={x}&y={y}&z={z}`, {
        attribution: '&copy; Google Maps',
        subdomains: '0123',
        maxZoom: 20,
        className: 'basemap-tile-layer'
    }).addTo(radarMap);

    if (mapStyleLabel) {
        mapStyleLabel.textContent = mode === 'dark' ? 'แผนที่มืด' : (mode === 'street' ? 'แผนที่ถนน' : 'ดาวเทียม');
    }
}

function initLeafletRadarMap() {
    if (radarMap || !leafletRadarMapEl || typeof L === 'undefined') return;

    const initLat = userCoords ? userCoords.lat : 13.7563;
    const initLon = userCoords ? userCoords.lon : 100.5018;

    radarMap = L.map(leafletRadarMapEl, {
        center: [initLat, initLon],
        zoom: 9,
        zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(radarMap);

    // Use Google Maps Thai road tiles (no API key watermark, supports full zoom 0-20)
    applyMapBaseLayer(mapStyleMode);

    // Auto-resize map to fill 100% edge-to-edge whenever container size changes
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            if (radarMap) radarMap.invalidateSize();
        });
        ro.observe(leafletRadarMapEl);
    }

    // Allow clicking anywhere on the map to set/preview destination
    radarMap.on('click', async (e) => {
        if (activeNavigation) return;
        const { lat, lng } = e.latlng;
        routeLinkInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        await processRouteLinkInput();
    });

    loadRainViewerRadarFrames();
}

async function loadRainViewerRadarFrames() {
    if (!radarMap) return;
    try {
        const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await resp.json();
        if (data && data.host) rainviewerHost = data.host;
        const past = data?.radar?.past || [];
        const nowcast = data?.radar?.nowcast || [];
        radarFrames = [...past.slice(-6), ...nowcast.slice(0, 2)];

        // Clear old layers
        Object.values(radarTileLayers).forEach(layer => {
            if (radarMap.hasLayer(layer)) radarMap.removeLayer(layer);
        });
        radarTileLayers = {};

        if (radarFrames.length === 0) {
            if (radarTimeLabel) radarTimeLabel.textContent = 'ไม่มีข้อมูลเมฆฝน';
            return;
        }

        currentRadarFrameIdx = Math.max(0, past.slice(-6).length - 1);
        showRadarFrame(currentRadarFrameIdx);
        startRadarAnimation();
    } catch (err) {
        if (radarTimeLabel) radarTimeLabel.textContent = 'ออฟไลน์';
    }
}

function showRadarFrame(idx) {
    if (!radarMap || radarFrames.length === 0) return;
    const frame = radarFrames[idx];
    if (!frame) return;

    Object.values(radarTileLayers).forEach(layer => {
        if (layer.setOpacity) layer.setOpacity(0);
    });

    if (radarOverlayVisible) {
        if (!radarTileLayers[frame.path]) {
            // maxNativeZoom: 7 prevents RainViewer from returning "Zoom Level Not Supported" when zoomed in > 7
            radarTileLayers[frame.path] = L.tileLayer(`${rainviewerHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                tileSize: 256,
                maxNativeZoom: 7,
                maxZoom: 20,
                opacity: 0.01,
                zIndex: 200
            }).addTo(radarMap);
        }
        if (radarTileLayers[frame.path]) {
            radarTileLayers[frame.path].setOpacity(0.68);
        }
    }

    if (radarTimeLabel && frame.time) {
        const d = new Date(frame.time * 1000);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const isFuture = frame.time * 1000 > Date.now() + 60000;
        radarTimeLabel.textContent = `${hh}:${mm} น.${isFuture ? ' (คาดการณ์)' : ''}`;
    }
}

function startRadarAnimation() {
    clearInterval(radarAnimTimer);
    if (!radarPlaying || radarFrames.length <= 1) return;
    radarAnimTimer = setInterval(() => {
        if (!splitRadarOpen || radarViewMode !== 'map' || !radarOverlayVisible) return;
        currentRadarFrameIdx = (currentRadarFrameIdx + 1) % radarFrames.length;
        showRadarFrame(currentRadarFrameIdx);
    }, 850);
}

function updateUserMarkerOnMap(lat, lon, panMap = false) {
    if (!radarMap || typeof L === 'undefined') return;
    const icon = L.divIcon({
        className: '',
        html: '<div class="gps-user-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    if (!userMarker) {
        userMarker = L.marker([lat, lon], { icon, draggable: true, title: 'ตำแหน่งของคุณ (ลากเพื่อปรับตำแหน่งได้)' }).addTo(radarMap);
        userMarker.bindPopup('<b>ตำแหน่งปัจจุบันของคุณ</b><br><span style="font-size:11px">สามารถลากหมุดสีฟ้าเพื่อปรับพิกัดเริ่มต้นได้</span>');
        userMarker.on('dragend', async () => {
            const pos = userMarker.getLatLng();
            userCoords = { lat: pos.lat, lon: pos.lng, label: 'พิกัดที่กำหนดบนแผนที่' };
            showToast('อัปเดตตำแหน่งเริ่มต้นตามหมุดแล้ว', 'info');
            await analyzeWeatherAtCoords(pos.lat, pos.lng);
            emitNavStatePatch({ userCoords, weatherInfo: currentWeatherInfo });
            if (activeNavigation && pendingDestination) {
                await refreshLiveNavigationRoute();
            } else if (pendingDestination) {
                await calculateAndPreviewRoute(pendingDestination.lat, pendingDestination.lon, pendingDestination.name);
            }
        });
    } else {
        userMarker.setLatLng([lat, lon]);
    }

    if (panMap) {
        const targetZoom = activeNavigation ? Math.max(radarMap.getZoom(), 13) : Math.max(radarMap.getZoom(), 9);
        radarMap.setView([lat, lon], targetZoom, { animate: true });
    }
}

function renderWeatherCardUI(info, locLabel) {
    if (!info) return;
    if (locLabel && weatherLocName) weatherLocName.textContent = locLabel;
    if (weatherTemp) weatherTemp.textContent = `${info.temp}°C`;
    if (weatherDesc) weatherDesc.textContent = info.text;
    if (weatherRainProb) weatherRainProb.textContent = `${info.rainProb}%`;
    if (weatherWind) weatherWind.textContent = `${info.wind} กม./ชม.`;
    if (weatherHumidity) weatherHumidity.textContent = `${info.humidity}%`;
    if (sidebarWeatherMini) sidebarWeatherMini.textContent = `${info.temp}°C • ${info.text}`;

    if (weatherAdvice && info.advice) {
        const isMayRain = info.rainAlert || info.code === 3 || info.rainProb >= 35 || info.advice.includes('ฝน');
        weatherAdvice.className = isMayRain
            ? 'text-[10px] px-2.5 py-1 rounded bg-amber-950/70 border border-amber-500/40 text-amber-200 flex items-center gap-1.5'
            : 'text-[10px] px-2.5 py-1 rounded bg-sky-950/50 border border-sky-500/30 text-sky-200 flex items-center gap-1.5';
        weatherAdvice.innerHTML = `<i class="fa-solid ${isMayRain ? 'fa-cloud-rain text-amber-400' : 'fa-circle-check text-emerald-400'} shrink-0"></i><span class="truncate">${escapeHtml(info.advice)}</span>`;
    }
}

async function analyzeWeatherAtCoords(lat, lon) {
    try {
        // Fetch Open-Meteo real-time weather
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,precipitation_probability,weather_code,wind_speed_10m&hourly=precipitation_probability&timezone=auto`;
        const resp = await fetch(url);
        const data = await resp.json();
        const curr = data?.current;
        if (!curr) return;

        const temp = Math.round(curr.temperature_2m ?? 30);
        const humidity = Math.round(curr.relative_humidity_2m ?? 65);
        const wind = Math.round(curr.wind_speed_10m ?? 5);
        const code = curr.weather_code ?? 0;

        // Find current hour precipitation probability matched against location timezone (curr.time & data.hourly.time)
        let rainProb = typeof curr.precipitation_probability === 'number' ? Math.round(curr.precipitation_probability) : 0;
        const hourlyProbs = data?.hourly?.precipitation_probability;
        const hourlyTimes = data?.hourly?.time;
        if (Array.isArray(hourlyProbs) && hourlyProbs.length > 0) {
            let hourIdx = -1;
            if (typeof curr.time === 'string' && Array.isArray(hourlyTimes)) {
                const currentHourPrefix = curr.time.slice(0, 13); // "YYYY-MM-DDTHH" in target timezone
                hourIdx = hourlyTimes.findIndex(t => typeof t === 'string' && t.slice(0, 13) === currentHourPrefix);
            }
            if (hourIdx < 0) {
                hourIdx = Math.min(new Date().getHours(), hourlyProbs.length - 1);
            }
            const currHourProb = hourlyProbs[hourIdx] ?? hourlyProbs[0] ?? 0;
            const nextHourProb = hourlyProbs[Math.min(hourIdx + 1, hourlyProbs.length - 1)] ?? currHourProb;
            rainProb = Math.max(rainProb, Math.round(Math.max(currHourProb, nextHourProb)));
        }
        if ((curr.rain || 0) > 0 || (curr.precipitation || 0) > 0) {
            rainProb = Math.max(rainProb, 85);
        }

        const wmo = getWmoWeatherThai(code);
        currentWeatherInfo = { temp, humidity, wind, rainProb, code, ...wmo };

        // Reverse geocode location name in Thai
        let locLabel = userCoords?.label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        try {
            const geoResp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=th`);
            const geoData = await geoResp.json();
            const addr = geoData?.address;
            locLabel = [
                addr?.suburb || addr?.neighbourhood || addr?.village || addr?.town,
                addr?.city || addr?.county || addr?.state
            ].filter(Boolean).join(', ') || geoData?.display_name?.split(',').slice(0, 2).join(', ') || locLabel;
            if (userCoords) userCoords.label = locLabel;
        } catch (e) {}

        renderWeatherCardUI(currentWeatherInfo, locLabel);

        // Check if "อาจมีฝนตก" (rainAlert, cloudy code 3 with rain advice, or rainProb >= 35%)
        const mayRain = wmo.rainAlert || code === 3 || rainProb >= 35 || (wmo.advice && wmo.advice.includes('ฝน'));
        if (mayRain && !hasWarnedRainVoice) {
            hasWarnedRainVoice = true;
            const isSevereStorm = code >= 95;
            const chimeType = isSevereStorm ? 'storm' : 'rain';
            const cleanText = wmo.text.replace(/^[^\s]+\s/, '');
            const voiceMsg = isSevereStorm
                ? `คำเตือนสภาพอากาศ พบ${cleanText} โอกาสเกิดฝน ${rainProb} เปอร์เซ็นต์ โปรดระมัดระวังในการขับขี่`
                : `แจ้งเตือนสภาพอากาศ ${cleanText} อาจมีฝนตกในพื้นที่ โอกาสเกิดฝน ${rainProb} เปอร์เซ็นต์`;

            playSoftAlertChime(chimeType);
            speakThaiText(voiceMsg, true);
            triggerRadarShowcase20s(false, isSevereStorm ? '⛈️ คำเตือนพายุฝนฟ้าคะนองรุนแรง' : '🌧️ แจ้งเตือนสภาพอากาศ: อาจมีฝนตก', chimeType);
            showToast(`🌧️ แจ้งเตือนเบาๆ: ${wmo.advice} (แสดงเรดาร์ 10 วินาที)`, 'info');
            socket.emit('trigger-nav-alert', {
                type: isSevereStorm ? 'storm-warning' : 'rain-warning',
                advice: wmo.advice,
                text: wmo.text,
                rainProb,
                userCoords,
                weatherInfo: currentWeatherInfo,
                voiceText: voiceMsg
            });
        }

        emitNavStatePatch({
            userCoords,
            weatherInfo: currentWeatherInfo
        });
    } catch (err) {
        console.warn('Weather analysis error:', err);
    }
}

function requestUserLocation(panMap = false, silent = false) {
    return new Promise((resolve) => {
        if (gpsSpinIcon) gpsSpinIcon.classList.add('fa-spin');

        const applyCoords = async (lat, lon, label, isFallback = false) => {
            if (gpsSpinIcon) gpsSpinIcon.classList.remove('fa-spin');
            userCoords = { lat, lon, label };
            if (weatherLocName && label) weatherLocName.textContent = label;
            updateUserMarkerOnMap(lat, lon, panMap);
            await analyzeWeatherAtCoords(lat, lon);
            if (radarViewMode === 'windy') updateWindyIframe();
            if (!silent && isFallback) {
                showToast('ใช้พิกัดเครือข่ายเริ่มต้น (คุณสามารถลากหมุดสีฟ้าบนแผนที่เพื่อปรับตำแหน่งได้)', 'info');
            }
            resolve(userCoords);
        };

        const fallbackToIpLocation = async () => {
            try {
                const resp = await fetch('/api/ip-location');
                const data = await resp.json();
                await applyCoords(data.lat || 13.7563, data.lon || 100.5018, data.label || 'กรุงเทพมหานคร', true);
            } catch (e) {
                await applyCoords(13.7563, 100.5018, 'กรุงเทพมหานคร', true);
            }
        };

        if (!('geolocation' in navigator)) {
            fallbackToIpLocation();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                await applyCoords(pos.coords.latitude, pos.coords.longitude, 'พิกัด GPS ปัจจุบันของคุณ', false);
            },
            async () => {
                await fallbackToIpLocation();
            },
            { enableHighAccuracy: true, timeout: 7000, maximumAge: 5000 }
        );
    });
}

function updateWindyIframe() {
    if (!windyRadarIframe) return;
    const lat = userCoords ? userCoords.lat : 13.7563;
    const lon = userCoords ? userCoords.lon : 100.5018;
    const targetSrc = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=8&overlay=radar&product=radar&level=surface&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&message=true`;
    if (windyRadarIframe.src !== targetSrc) {
        windyRadarIframe.src = targetSrc;
    }
}

function setRadarViewMode(mode, sync = true) {
    radarViewMode = mode;
    if (mode === 'windy') {
        if (leafletRadarMapEl) leafletRadarMapEl.classList.add('hidden');
        if (radarTimelineBar) radarTimelineBar.classList.add('hidden');
        if (windyRadarIframe) {
            windyRadarIframe.classList.remove('hidden');
            updateWindyIframe();
        }
        if (btnModeWindy) btnModeWindy.className = 'px-2 py-1 rounded text-[10px] font-medium bg-sky-500/20 text-sky-300 border border-sky-400/40 transition';
        if (btnModeMapRadar) btnModeMapRadar.className = 'px-2 py-1 rounded text-[10px] font-medium bg-[#0a0a0a] text-brand-light/70 border border-brand-deep/40 hover:text-white transition';
    } else {
        if (windyRadarIframe) windyRadarIframe.classList.add('hidden');
        if (leafletRadarMapEl) leafletRadarMapEl.classList.remove('hidden');
        if (radarTimelineBar) radarTimelineBar.classList.remove('hidden');
        if (btnModeMapRadar) btnModeMapRadar.className = 'px-2 py-1 rounded text-[10px] font-medium bg-sky-500/20 text-sky-300 border border-sky-400/40 transition';
        if (btnModeWindy) btnModeWindy.className = 'px-2 py-1 rounded text-[10px] font-medium bg-[#0a0a0a] text-brand-light/70 border border-brand-deep/40 hover:text-white transition';
        if (radarMap) setTimeout(() => radarMap.invalidateSize(), 150);
    }
    if (sync) emitNavStatePatch({ viewMode: mode });
}

// --- Country-to-User Radar Zoom Animation for Rain & Storm Alerts ---
let weatherZoomTimers = [];
let weatherAlertOverlayGroup = null;

function clearWeatherZoomAnimation() {
    weatherZoomTimers.forEach(t => clearTimeout(t));
    weatherZoomTimers = [];
    const stageBadge = $('radar-zoom-stage-badge');
    if (stageBadge) stageBadge.classList.add('hidden');
    if (weatherAlertOverlayGroup && radarMap) {
        try { radarMap.removeLayer(weatherAlertOverlayGroup); } catch (e) {}
        weatherAlertOverlayGroup = null;
    }
}

function animateWeatherRadarCountryToUserZoom(mode = 'rain') {
    if (!radarMap || typeof L === 'undefined') return;
    clearWeatherZoomAnimation();

    const targetLat = userCoords?.lat || 13.7563;
    const targetLon = userCoords?.lon || 100.5018;
    updateUserMarkerOnMap(targetLat, targetLon, false);

    const isStorm = mode === 'storm';
    const stageBadge = $('radar-zoom-stage-badge');
    const stageIcon = $('radar-zoom-stage-icon');
    const stageText = $('radar-zoom-stage-text');

    if (stageBadge && stageIcon && stageText) {
        stageBadge.className = isStorm
            ? 'absolute bottom-12 left-1/2 -translate-x-1/2 z-[440] bg-[#24090d]/95 backdrop-blur-md border border-red-400/70 text-red-200 rounded-full px-3 py-1 text-[10px] font-medium shadow-xl flex items-center gap-1.5 pointer-events-none whitespace-nowrap transition-all duration-300 animate-fade-in-up'
            : 'absolute bottom-12 left-1/2 -translate-x-1/2 z-[440] bg-[#081326]/95 backdrop-blur-md border border-sky-400/60 text-sky-200 rounded-full px-3 py-1 text-[10px] font-medium shadow-xl flex items-center gap-1.5 pointer-events-none whitespace-nowrap transition-all duration-300 animate-fade-in-up';
        stageIcon.className = isStorm
            ? 'fa-solid fa-earth-asia text-red-400 animate-pulse'
            : 'fa-solid fa-earth-asia text-sky-400 animate-pulse';
        stageText.textContent = isStorm
            ? '🌏 สแกนเรดาร์พายุระดับประเทศ...'
            : '🌏 สแกนเรดาร์กลุ่มเมฆฝนระดับประเทศ...';
    }

    // Create meteorological radar echo rings + pulsing sonar target pin around user's coordinates
    weatherAlertOverlayGroup = L.layerGroup().addTo(radarMap);

    // Outer light precipitation radar band
    L.circle([targetLat, targetLon], {
        radius: isStorm ? 55000 : 42000,
        color: isStorm ? '#10b981' : '#06b6d4',
        weight: 1,
        opacity: 0.45,
        fillColor: isStorm ? '#10b981' : '#06b6d4',
        fillOpacity: 0.16
    }).addTo(weatherAlertOverlayGroup);

    // Middle moderate precipitation radar band
    L.circle([targetLat, targetLon], {
        radius: isStorm ? 28000 : 20000,
        color: '#facc15',
        weight: 1,
        opacity: 0.55,
        fillColor: '#facc15',
        fillOpacity: 0.22
    }).addTo(weatherAlertOverlayGroup);

    // Inner heavy precipitation / storm core radar band
    L.circle([targetLat, targetLon], {
        radius: isStorm ? 12000 : 8500,
        color: isStorm ? '#ef4444' : '#38bdf8',
        weight: 1.5,
        opacity: 0.75,
        fillColor: isStorm ? '#ef4444' : '#38bdf8',
        fillOpacity: 0.32
    }).addTo(weatherAlertOverlayGroup);

    // Pulsing Sonar Target Marker at user's exact location
    const pinLabel = isStorm ? '⛈️ พายุฝนฟ้าคะนอง • จุดที่คุณอยู่' : '🌧️ อาจมีฝนตก • จุดที่คุณอยู่';
    const sonarIcon = L.divIcon({
        className: '',
        html: `<div class="weather-target-pin ${isStorm ? 'storm-mode' : ''}">
            <div class="sonar-ring"></div>
            <div class="sonar-ring delay-1"></div>
            <div class="sonar-ring delay-2"></div>
            <div class="weather-target-label">${pinLabel}</div>
        </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
    L.marker([targetLat, targetLon], { icon: sonarIcon, interactive: false }).addTo(weatherAlertOverlayGroup);

    // Phase 1: Immediately show nearly country-wide Thailand radar view (zoom 5.4)
    const countryCenterLat = (13.3 + targetLat) / 2;
    const countryCenterLon = (101.0 + targetLon) / 2;
    radarMap.invalidateSize();
    try {
        radarMap.stop();
        radarMap.setView([countryCenterLat, countryCenterLon], 6.4, { animate: false });
        radarMap.flyTo([countryCenterLat, countryCenterLon], 5.3, {
            animate: true,
            duration: 1.1,
            easeLinearity: 0.25
        });
    } catch (e) {}

    // Phase 2: After showing country-level radar, smoothly fly & zoom in to user's exact location (zoom 12)
    weatherZoomTimers.push(setTimeout(() => {
        if (!radarMap) return;
        if (stageIcon && stageText) {
            stageIcon.className = isStorm
                ? 'fa-solid fa-location-crosshairs text-amber-300 fa-spin'
                : 'fa-solid fa-location-crosshairs text-sky-300 fa-spin';
            stageText.textContent = '🎯 กำลังซูมเข้าสู่จุดที่คุณอยู่...';
        }
        try {
            radarMap.flyTo([targetLat, targetLon], 12, {
                animate: true,
                duration: 3.2,
                easeLinearity: 0.18
            });
        } catch (e) {}
    }, 1850));

    // Phase 3: Target lock-on at user's location
    weatherZoomTimers.push(setTimeout(() => {
        if (!radarMap) return;
        if (stageIcon && stageText) {
            stageIcon.className = isStorm
                ? 'fa-solid fa-triangle-exclamation text-red-400 animate-bounce'
                : 'fa-solid fa-location-dot text-emerald-400 animate-bounce';
            stageText.textContent = isStorm
                ? '⛈️ พิกัดของคุณ: ตรวจพบพายุฝนฟ้าคะนองรุนแรงในพื้นที่!'
                : '🌧️ พิกัดของคุณ: มีโอกาสเกิดฝนตกในพื้นที่ของคุณ';
        }
    }, 5150));
}

// --- Show Map + Weather Radar IN PLACE OF Control Panel for 10s, then automatically hide Map & restore Control Panel ---
function triggerRadarShowcase20s(broadcastToAll = false, customTitle = null, weatherZoomMode = null) {
    if (broadcastToAll) {
        socket.emit('trigger-nav-alert', {
            type: 'showcase-20s',
            title: customTitle || '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ'
        });
    }

    if (!splitRadarOpen) {
        openSplitRadarPanel(false, true);
    }

    setRadarViewMode('map', false);
    radarOverlayVisible = true;
    if (toggleRadarOverlay) toggleRadarOverlay.checked = true;
    showRadarFrame(currentRadarFrameIdx);

    document.body.classList.add('nav-radar-showcase');
    if (radarShowcaseBanner) {
        radarShowcaseBanner.classList.remove('hidden', 'animate-fade-in-up');
        void radarShowcaseBanner.offsetWidth;
        radarShowcaseBanner.classList.add('animate-fade-in-up');
    }

    const titleEl = $('showcase-title');
    if (titleEl) {
        titleEl.textContent = customTitle || '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ';
    }

    showcaseRemainingSec = SHOWCASE_DURATION_SEC;
    if (showcaseCountdown) showcaseCountdown.textContent = String(showcaseRemainingSec);

    if (showcaseSubInfo) {
        if (pendingDestination && activeNavigation && !weatherZoomMode) {
            const etaText = navEtaMins ? navEtaMins.textContent : `${pendingDestination.durationMin || '--'} นาที`;
            const remText = navRemDist ? navRemDist.textContent : `${pendingDestination.distanceKm || '--'} กม.`;
            showcaseSubInfo.innerHTML = `เหลือ ${escapeHtml(etaText)} (${escapeHtml(remText)}) • กลับแผงควบคุมใน <strong id="showcase-countdown" class="text-emerald-300 font-mono animate-countdown-pop">${showcaseRemainingSec}</strong> วิ`;
        } else {
            showcaseSubInfo.innerHTML = `ซ่อนแผนที่และกลับไปโชว์แผงควบคุมใน <strong id="showcase-countdown" class="text-emerald-300 font-mono animate-countdown-pop">${showcaseRemainingSec}</strong> วินาที`;
        }
    }

    // Animate visual progress bar from 100% -> 0% smoothly over SHOWCASE_DURATION_SEC
    const progBar = $('showcase-progress-bar');
    if (progBar) {
        progBar.style.transition = 'none';
        progBar.style.width = '100%';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                progBar.style.transition = `width ${SHOWCASE_DURATION_SEC}s linear`;
                progBar.style.width = '0%';
            });
        });
    }

    setTimeout(() => {
        if (radarMap) {
            radarMap.invalidateSize();
            if (weatherZoomMode === 'rain' || weatherZoomMode === 'storm') {
                animateWeatherRadarCountryToUserZoom(weatherZoomMode);
            } else {
                clearWeatherZoomAnimation();
                if (routePolyline && routePolyline.getBounds) {
                    radarMap.fitBounds(routePolyline.getBounds(), { padding: [28, 28] });
                }
            }
        }
    }, 140);

    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = setInterval(() => {
        showcaseRemainingSec -= 1;
        const cdEl = $('showcase-countdown');
        if (cdEl) {
            cdEl.textContent = String(Math.max(0, showcaseRemainingSec));
            cdEl.classList.remove('animate-countdown-pop');
            void cdEl.offsetWidth;
            cdEl.classList.add('animate-countdown-pop');
        }
        if (showcaseRemainingSec <= 0) {
            stopRadarShowcase20s();
        }
    }, 1000);
}

function stopRadarShowcase20s() {
    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = null;
    clearWeatherZoomAnimation();
    document.body.classList.remove('nav-radar-showcase');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');
    // Always hide the map and smoothly cross-fade back to showing the Control Panel after the 10s showcase finishes
    closeSplitRadarPanel(false);
}

function startAutoShowcaseSchedule() {
    clearInterval(autoShowcaseInterval);
    // Automatically swap Control Panel to Map + Weather Radar for 10 seconds every 20 minutes during active navigation
    autoShowcaseInterval = setInterval(() => {
        if (activeNavigation) {
            triggerRadarShowcase20s(true, '📡 แสดงแผนที่นำทาง & เรดาร์อากาศอัตโนมัติ');
        }
    }, AUTO_SHOWCASE_INTERVAL_MS);
}

function stopAutoShowcaseSchedule() {
    clearInterval(autoShowcaseInterval);
    autoShowcaseInterval = null;
    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = null;
    clearWeatherZoomAnimation();
    document.body.classList.remove('nav-radar-showcase');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');
}

async function openSplitRadarPanel(focusInput = false, skipSync = false) {
    splitRadarOpen = true;
    if (radarNavPanel) radarNavPanel.classList.remove('hidden');
    document.body.classList.add('split-radar-active');

    initLeafletRadarMap();
    setTimeout(() => {
        if (radarMap) radarMap.invalidateSize();
    }, 60);
    setTimeout(() => {
        if (radarMap) radarMap.invalidateSize();
    }, 380);

    if (!skipSync) {
        emitNavStatePatch({ panelOpen: true });
    }

    if (!userCoords) {
        if (skipSync || currentWeatherInfo) {
            userCoords = { lat: 13.7563, lon: 100.5018, label: 'กรุงเทพมหานคร' };
            updateUserMarkerOnMap(userCoords.lat, userCoords.lon, false);
        } else {
            await requestUserLocation(true, false);
        }
    } else if (radarMap) {
        radarMap.invalidateSize();
    }

    if (focusInput && routeLinkInput) {
        setRadarViewMode('map', !skipSync);
        setTimeout(() => routeLinkInput.focus(), 220);
    }
}

function closeSplitRadarPanel(skipSync = false) {
    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = null;
    clearWeatherZoomAnimation();
    splitRadarOpen = false;
    document.body.classList.remove('split-radar-active', 'nav-radar-showcase');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');

    // Trigger a soft return glow animation on the GPS / Radar quick buttons when Control Panel fades back in
    if (sidebarOpenNavBtn) {
        sidebarOpenNavBtn.classList.remove('animate-control-return');
        void sidebarOpenNavBtn.offsetWidth;
        sidebarOpenNavBtn.classList.add('animate-control-return');
    }

    if (!skipSync) {
        emitNavStatePatch({ panelOpen: false });
    }
}

function formatThaiManeuver(step) {
    if (!step) return 'มุ่งหน้าตามเส้นทางหลัก';
    const type = step.maneuver?.type || '';
    const mod = step.maneuver?.modifier || '';
    const road = step.name ? `เข้าสู่ ${step.name}` : 'ตามเส้นทาง';
    const distM = Math.round(step.distance || 0);
    const distText = distM >= 1000 ? `${(distM / 1000).toFixed(1)} กม.` : `${distM} ม.`;

    let action = 'ตรงไป';
    if (type === 'arrive') return 'กำลังจะถึงจุดหมายปลายทาง';
    if (mod.includes('left')) action = 'เลี้ยวซ้าย';
    else if (mod.includes('right')) action = 'เลี้ยวขวา';
    else if (mod.includes('uturn')) action = 'กลับรถ';
    else if (type === 'roundabout') action = 'เข้าวงเวียน';

    return `${action}${road} (อีก ${distText})`;
}

async function fetchOsrmRoute(startLat, startLon, destLat, destLon) {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('ไม่สามารถคำนวณเส้นทางถนนไปยังจุดหมายนี้ได้');
    }
    return data.routes[0];
}

function drawRouteOnMap(routeGeoJson, destLat, destLon, destName, fitView = true) {
    if (!radarMap || typeof L === 'undefined' || !routeGeoJson || !Array.isArray(routeGeoJson.coordinates)) return;

    if (routePolyline && radarMap.hasLayer(routePolyline)) radarMap.removeLayer(routePolyline);
    if (routeGlowLine && radarMap.hasLayer(routeGlowLine)) radarMap.removeLayer(routeGlowLine);

    const coords = routeGeoJson.coordinates.map(c => [c[1], c[0]]);
    routeGlowLine = L.polyline(coords, {
        color: '#38bdf8',
        weight: 10,
        opacity: 0.28,
        lineCap: 'round'
    }).addTo(radarMap);

    routePolyline = L.polyline(coords, {
        color: '#10b981',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round'
    }).addTo(radarMap);

    const destIcon = L.divIcon({
        className: '',
        html: '<div class="gps-dest-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });

    if (!destMarker) {
        destMarker = L.marker([destLat, destLon], { icon: destIcon }).addTo(radarMap);
    } else {
        destMarker.setLatLng([destLat, destLon]);
    }
    destMarker.bindPopup(`<b>จุดหมายปลายทาง</b><br>${escapeHtml(destName || '')}`);

    if (fitView && routePolyline.getBounds) {
        radarMap.fitBounds(routePolyline.getBounds(), { padding: [32, 32] });
    }
}

function renderNavStepUI(step) {
    if (navStepInput) navStepInput.classList.toggle('hidden', step !== 'input');
    if (navStepPreview) navStepPreview.classList.toggle('hidden', step !== 'preview');
    if (navStepActive) navStepActive.classList.toggle('hidden', step !== 'active');
}

async function calculateAndPreviewRoute(destLat, destLon, destName) {
    if (!userCoords) {
        await requestUserLocation(true, true);
    }
    const startLat = userCoords ? userCoords.lat : 13.7563;
    const startLon = userCoords ? userCoords.lon : 100.5018;

    const route = await fetchOsrmRoute(startLat, startLon, destLat, destLon);
    const distanceKmNum = route.distance / 1000;
    const distanceKm = distanceKmNum.toFixed(1);
    const durationMin = Math.max(1, Math.round(route.duration / 60));
    const leg = route.legs?.[0];
    const summary = leg?.summary ? `ผ่าน ${leg.summary}` : 'เส้นทางหลักตามถนน';

    pendingDestination = {
        lat: destLat,
        lon: destLon,
        name: destName,
        distanceKm,
        initialDistanceKm: distanceKmNum,
        durationMin,
        summary
    };

    setRadarViewMode('map', false);
    drawRouteOnMap(route.geometry, destLat, destLon, destName, true);

    if (previewDestName) previewDestName.textContent = destName;
    if (previewRouteSummary) previewRouteSummary.textContent = `${summary} • สภาพอากาศ ${currentWeatherInfo ? currentWeatherInfo.text : 'ปกติ'}`;
    if (previewDuration) previewDuration.textContent = `${durationMin} นาที`;
    if (previewDistance) previewDistance.textContent = `${distanceKm} กม.`;

    renderNavStepUI('preview');

    emitNavStatePatch({
        panelOpen: true,
        viewMode: 'map',
        step: 'preview',
        routeInputText: routeLinkInput?.value || destName,
        userCoords,
        weatherInfo: currentWeatherInfo,
        destination: pendingDestination,
        liveRoute: {
            geometry: route.geometry,
            remKm: distanceKm,
            etaMins: durationMin,
            arrivalTime: '--:--',
            instructionText: 'รอเริ่มการนำทาง...',
            roadStatus: summary,
            progressPct: 0
        }
    });

    speakThaiText(`พบเส้นทางไปยัง ${destName} ระยะทาง ${distanceKm} กิโลเมตร ใช้เวลาเดินทางประมาณ ${durationMin} นาที กรุณาตรวจสอบเส้นทางและกดเริ่มนำทาง`);

    // Proactively analyze weather ahead along the entire route (Origin 0% -> Midpoint 50% -> Destination 100%)
    if (typeof analyzeRouteWeatherAhead === 'function') {
        analyzeRouteWeatherAhead(route.geometry, startLat, startLon, destLat, destLon, destName);
    }
}

async function processRouteLinkInput() {
    const val = (routeLinkInput?.value || '').trim();
    if (!val) {
        return showToast('กรุณาวางลิงก์เส้นทาง Google Maps หรือพิมพ์ชื่อสถานที่ปลายทาง', 'error');
    }

    if (routeCheckIcon) routeCheckIcon.className = 'fa-solid fa-spinner fa-spin';
    if (routeCheckBtn) routeCheckBtn.disabled = true;

    try {
        const resp = await fetch('/api/resolve-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: val })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            throw new Error(data.error || 'ไม่สามารถอ่านพิกัดจากลิงก์นี้ได้');
        }

        await calculateAndPreviewRoute(data.lat, data.lon, data.name || val);
        showToast('ประมวลผลเส้นทางเรียบร้อย (ซิงค์ไปยังทุกเครื่องแล้ว)', 'info');
    } catch (err) {
        showToast(err.message || 'เกิดข้อผิดพลาดในการค้นหาเส้นทาง', 'error');
    } finally {
        if (routeCheckIcon) routeCheckIcon.className = 'fa-solid fa-magnifying-glass-location';
        if (routeCheckBtn) routeCheckBtn.disabled = false;
    }
}

function updateGpsButtonsStatus(isActive, etaMins, remKm) {
    if (isActive && etaMins !== undefined && remKm !== undefined) {
        if (sidebarOpenNavBtn) {
            sidebarOpenNavBtn.className = 'min-w-0 overflow-hidden bg-emerald-950/80 hover:bg-emerald-900/90 border border-emerald-400/60 text-emerald-300 rounded-lg py-1.5 px-2 text-[11px] font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10';
            sidebarOpenNavBtn.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0"></span><span class="truncate">เหลือ ${escapeHtml(String(etaMins))} นาที (${escapeHtml(String(remKm))} กม.)</span>`;
        }
        if (headerRadarBtn) {
            headerRadarBtn.className = 'text-[11px] px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-400/50 transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0';
            headerRadarBtn.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0"></span><i class="fa-solid fa-diamond-turn-right text-emerald-400"></i><span class="font-semibold">เหลือ ${escapeHtml(String(etaMins))} นาที • ${escapeHtml(String(remKm))} กม.</span>`;
        }
    } else {
        if (sidebarOpenNavBtn) {
            sidebarOpenNavBtn.className = 'min-w-0 overflow-hidden bg-[#0d1624] hover:bg-brand-deep/70 border border-emerald-500/30 text-emerald-300 rounded-lg py-1.5 px-2 text-[11px] font-medium transition flex items-center justify-center gap-1.5';
            sidebarOpenNavBtn.innerHTML = `<i class="fa-solid fa-diamond-turn-right shrink-0"></i><span class="truncate">GPS นำทาง</span>`;
        }
        if (headerRadarBtn) {
            headerRadarBtn.className = 'text-[11px] px-2.5 py-1 rounded-lg bg-[#0d1624] hover:bg-brand-deep/80 text-brand-peri border border-brand-peri/30 transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0';
            headerRadarBtn.innerHTML = `<i class="fa-solid fa-satellite-dish text-sky-400"></i><span class="hidden sm:inline font-medium">เรดาร์อากาศ & GPS นำทาง</span><span class="sm:hidden font-medium">เรดาร์/GPS</span>`;
        }
    }
}

function updateLiveNavigationDOM(live) {
    if (!live) return;
    if (navEtaMins) navEtaMins.textContent = `${live.etaMins} นาที`;
    if (navRemDist) navRemDist.textContent = `${live.remKm} กม.`;
    if (navArrivalTime) navArrivalTime.textContent = live.arrivalTime || '--:--';
    if (navNextInstruction) navNextInstruction.textContent = live.instructionText || 'มุ่งหน้าตามเส้นทางหลัก';
    if (navRoadStatus) navRoadStatus.textContent = live.roadStatus || 'สภาพเส้นทางปกติ';

    const pct = Math.min(100, Math.max(0, Number(live.progressPct) || 0));
    if (navProgressPct) navProgressPct.textContent = `${pct}%`;
    if (navProgressFill) navProgressFill.style.width = `${pct}%`;

    updateGpsButtonsStatus(true, live.etaMins, live.remKm);
}

async function refreshLiveNavigationRoute() {
    if (!activeNavigation || !pendingDestination) return;

    await requestUserLocation(false, true);
    if (!userCoords) return;

    try {
        const route = await fetchOsrmRoute(userCoords.lat, userCoords.lon, pendingDestination.lat, pendingDestination.lon);
        const remKmNum = route.distance / 1000;
        const remKm = remKmNum.toFixed(1);
        const etaMins = Math.max(1, Math.round(route.duration / 60));

        if (!pendingDestination.initialDistanceKm || pendingDestination.initialDistanceKm < remKmNum) {
            pendingDestination.initialDistanceKm = Math.max(remKmNum, parseFloat(pendingDestination.distanceKm) || remKmNum);
        }
        const initDist = pendingDestination.initialDistanceKm || remKmNum;
        const progressPct = initDist > 0
            ? Math.min(100, Math.max(0, Math.round(((initDist - remKmNum) / initDist) * 100)))
            : 0;

        drawRouteOnMap(route.geometry, pendingDestination.lat, pendingDestination.lon, pendingDestination.name, false);

        const arrival = new Date(Date.now() + route.duration * 1000);
        const arrHH = String(arrival.getHours()).padStart(2, '0');
        const arrMM = String(arrival.getMinutes()).padStart(2, '0');
        const arrivalTime = `${arrHH}:${arrMM} น.`;

        const steps = route.legs?.[0]?.steps || [];
        const nextStep = steps.length > 1 ? steps[1] : steps[0];
        const instructionText = formatThaiManeuver(nextStep);
        const summaryRoad = route.legs?.[0]?.summary || 'เส้นทางหลัก';
        const weatherNote = currentWeatherInfo ? `${currentWeatherInfo.text} (${currentWeatherInfo.temp}°C)` : 'อากาศปกติ';
        const roadStatus = `ผ่าน ${summaryRoad} • ${weatherNote}`;

        const livePayload = {
            remKm,
            etaMins,
            arrivalTime,
            instructionText,
            roadStatus,
            progressPct,
            geometry: route.geometry
        };

        updateLiveNavigationDOM(livePayload);

        // Sync live route & coordinates to all connected clients
        emitNavStatePatch({
            step: 'active',
            userCoords,
            weatherInfo: currentWeatherInfo,
            destination: pendingDestination,
            liveRoute: livePayload,
            hasAlerted90Pct
        });

        // Check if arrived within 120 meters (100%)
        if (remKmNum <= 0.12) {
            speakThaiText(`คุณเดินทางถึงจุดหมาย ${pendingDestination.name} เรียบร้อยแล้ว`);
            showToast(`🎉 เดินทางถึงจุดหมาย: ${pendingDestination.name}`, 'info');
            cancelNavigation(true);
            return;
        }

        // Check if reached >= 90% of the trip ("เมื่อใกล้ถึงจุดหมาย เดินทาง 90% แล้ว ก็แจ้งเตือนด้วยเสียง ว่าใกล้ถึงจุดหมายแล้ว แล้วก็บอกเวลาที่เหลือ กับ กี่กิโลเมตร")
        if (progressPct >= 90 && !hasAlerted90Pct) {
            hasAlerted90Pct = true;
            playSoftAlertChime('near-90pct');
            const alertMsg = `ใกล้ถึงจุดหมายแล้ว ขณะนี้เดินทางแล้ว ${progressPct} เปอร์เซ็นต์ เหลือเวลาอีกประมาณ ${etaMins} นาที กับระยะทางอีก ${remKm} กิโลเมตร`;
            speakThaiText(alertMsg);
            showToast(`🏁 ใกล้ถึงจุดหมายแล้ว (${progressPct}%)! เหลืออีก ${etaMins} นาที (${remKm} กม.)`, 'info');
            triggerRadarShowcase20s(false, `🏁 ใกล้ถึงจุดหมายแล้ว (${progressPct}%)`);
            emitNavStatePatch({ hasAlerted90Pct: true });
            socket.emit('trigger-nav-alert', {
                type: 'near-90pct',
                progressPct,
                etaMins,
                remKm,
                destName: pendingDestination.name
            });
            return;
        }

        // Speak periodic ETA update if changed by >= 3 mins
        if (lastSpokenEtaMin === null || Math.abs(lastSpokenEtaMin - etaMins) >= 3) {
            lastSpokenEtaMin = etaMins;
            speakThaiText(`เหลือเวลาเดินทางอีกประมาณ ${etaMins} นาที ระยะทาง ${remKm} กิโลเมตร ${instructionText}`);
        }
    } catch (err) {
        console.warn('Live navigation route update failed:', err.message);
    }
}

async function startActiveNavigation() {
    if (!pendingDestination) return;
    activeNavigation = true;
    hasAlerted90Pct = false;
    lastSpokenEtaMin = pendingDestination.durationMin;

    renderNavStepUI('active');
    updateGpsButtonsStatus(true, pendingDestination.durationMin, pendingDestination.distanceKm);
    startAutoShowcaseSchedule();

    showToast(`เริ่มนำทางไปยัง ${pendingDestination.name} (แสดงเส้นทาง 10 วินาที แล้วสลับกลับแผงควบคุม)`, 'info');
    speakThaiText(`เริ่มการนำทางไปยัง ${pendingDestination.name} เหลือเวลาประมาณ ${pendingDestination.durationMin} นาที`);

    await refreshLiveNavigationRoute();

    // Show route on map in place of Control Panel for 10 seconds, then automatically hide map & return to Control Panel
    triggerRadarShowcase20s(true, `🧭 เริ่มนำทาง: ${pendingDestination.name}`);

    // Poll user GPS coordinates periodically every 10 seconds
    clearInterval(navPollTimer);
    navPollTimer = setInterval(() => {
        if (activeNavigation) {
            refreshLiveNavigationRoute();
        }
    }, 10000);
}

function cancelNavigation(silent = false, skipSync = false) {
    activeNavigation = false;
    pendingDestination = null;
    lastSpokenEtaMin = null;
    hasAlerted90Pct = false;
    clearInterval(navPollTimer);
    navPollTimer = null;
    stopAutoShowcaseSchedule();
    updateGpsButtonsStatus(false);

    if (radarMap) {
        if (routePolyline && radarMap.hasLayer(routePolyline)) radarMap.removeLayer(routePolyline);
        if (routeGlowLine && radarMap.hasLayer(routeGlowLine)) radarMap.removeLayer(routeGlowLine);
        if (destMarker && radarMap.hasLayer(destMarker)) radarMap.removeLayer(destMarker);
        routePolyline = null;
        routeGlowLine = null;
        destMarker = null;
    }

    const routeWeatherCard = $('route-weather-ahead-card');
    if (routeWeatherCard) routeWeatherCard.classList.add('hidden');

    renderNavStepUI('input');

    if (!skipSync) {
        emitNavStatePatch({
            step: 'input',
            destination: null,
            liveRoute: null,
            routeWeatherAhead: null,
            hasAlerted90Pct: false
        });
    }

    if (!silent) {
        showToast('ยกเลิกการนำทางแล้ว', 'info');
        speakThaiText('ยกเลิกการนำทางแล้ว');
    }
}

// --- Apply Remote Synced Navigation State from Socket.io ---
async function applyRemoteNavState(remote, isInitial = false) {
    if (!remote || typeof remote !== 'object') return;
    isApplyingRemoteNav = true;
    try {
        if (remote.panelOpen && !splitRadarOpen) {
            await openSplitRadarPanel(false, true);
        } else if (!remote.panelOpen && splitRadarOpen && !isInitial) {
            closeSplitRadarPanel(true);
        }

        if (remote.viewMode && remote.viewMode !== radarViewMode) {
            setRadarViewMode(remote.viewMode, false);
        }

        if (remote.routeInputText && routeLinkInput && document.activeElement !== routeLinkInput) {
            routeLinkInput.value = remote.routeInputText;
        }

        if (remote.userCoords && typeof remote.userCoords.lat === 'number') {
            userCoords = remote.userCoords;
            if (radarMap) {
                updateUserMarkerOnMap(userCoords.lat, userCoords.lon, false);
            }
        }

        if (remote.weatherInfo) {
            currentWeatherInfo = remote.weatherInfo;
            renderWeatherCardUI(currentWeatherInfo, userCoords?.label);
        }

        if (remote.routeWeatherAhead && typeof renderRouteWeatherAheadUI === 'function') {
            renderRouteWeatherAheadUI(remote.routeWeatherAhead);
        } else if (!remote.destination) {
            const rCard = $('route-weather-ahead-card');
            if (rCard) rCard.classList.add('hidden');
        }

        hasAlerted90Pct = Boolean(remote.hasAlerted90Pct);

        // --- Lyrics State Sync (Mobile → Host) ---
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
            if (lyricsOverlay) lyricsOverlay.classList.toggle('lyrics-cinema-mode', lyricsCinemaMode);
            setTimeout(() => { if (currentActiveLyricIdx >= 0) smoothScrollOverlayReelToActive(currentActiveLyricIdx); }, 60);
        }
        if (lyricsStateChanged) {
            updateLyricsToggleButtonsUI();
        }

        if (remote.step === 'input' || !remote.destination) {
            if (activeNavigation || pendingDestination) {
                cancelNavigation(true, true);
            } else {
                renderNavStepUI('input');
                updateGpsButtonsStatus(false);
            }
        } else if (remote.step === 'preview' && remote.destination) {
            activeNavigation = false;
            clearInterval(navPollTimer);
            stopAutoShowcaseSchedule();
            pendingDestination = remote.destination;
            renderNavStepUI('preview');
            updateGpsButtonsStatus(false);

            if (previewDestName) previewDestName.textContent = pendingDestination.name || '—';
            if (previewRouteSummary) previewRouteSummary.textContent = `${pendingDestination.summary || 'เส้นทางหลัก'} • สภาพอากาศ ${currentWeatherInfo ? currentWeatherInfo.text : 'ปกติ'}`;
            if (previewDuration) previewDuration.textContent = `${pendingDestination.durationMin || '--'} นาที`;
            if (previewDistance) previewDistance.textContent = `${pendingDestination.distanceKm || '--'} กม.`;

            if (remote.liveRoute?.geometry && radarMap) {
                drawRouteOnMap(remote.liveRoute.geometry, pendingDestination.lat, pendingDestination.lon, pendingDestination.name, true);
            }
        } else if (remote.step === 'active' && remote.destination) {
            const wasActive = activeNavigation;
            activeNavigation = true;
            pendingDestination = remote.destination;
            renderNavStepUI('active');

            if (!wasActive) {
                startAutoShowcaseSchedule();
            }

            if (remote.liveRoute) {
                updateLiveNavigationDOM(remote.liveRoute);
                if (remote.liveRoute.geometry && radarMap) {
                    drawRouteOnMap(remote.liveRoute.geometry, pendingDestination.lat, pendingDestination.lon, pendingDestination.name, !wasActive);
                }
            } else {
                updateGpsButtonsStatus(true, pendingDestination.durationMin || '--', pendingDestination.distanceKm || '--');
            }
        }
    } finally {
        isApplyingRemoteNav = false;
    }
}

socket.on('nav-state-update', (payload) => {
    if (!payload || payload.senderId === socket.id) return;
    applyRemoteNavState(payload.navState, false);
});

socket.on('nav-alert-broadcast', (payload) => {
    if (!payload || payload.senderId === socket.id) return;

    if (payload.userCoords && typeof payload.userCoords.lat === 'number') {
        userCoords = payload.userCoords;
    }

    if (payload.weatherInfo) {
        currentWeatherInfo = payload.weatherInfo;
        renderWeatherCardUI(currentWeatherInfo, userCoords?.label || 'พื้นที่ตรวจสอบเรดาร์สภาพอากาศ');
    }

    if (payload.type === 'showcase-20s') {
        playSoftAlertChime('rain');
        if (payload.voiceText) speakThaiText(payload.voiceText, true);
        triggerRadarShowcase20s(false, payload.title || '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ');
    } else if (payload.type === 'near-90pct') {
        playSoftAlertChime('near-90pct');
        const msg = payload.voiceText || `ใกล้ถึงจุดหมายแล้ว ขณะนี้เดินทางแล้ว ${payload.progressPct || 90} เปอร์เซ็นต์ เหลือเวลาอีกประมาณ ${payload.etaMins} นาที กับระยะทางอีก ${payload.remKm} กิโลเมตร`;
        speakThaiText(msg, true);
        showToast(`🏁 ใกล้ถึงจุดหมายแล้ว (${payload.progressPct || 90}%)! เหลืออีก ${payload.etaMins} นาที (${payload.remKm} กม.)`, 'info');
        triggerRadarShowcase20s(false, `🏁 ใกล้ถึงจุดหมายแล้ว (${payload.progressPct || 90}%)`);
    } else if (payload.type === 'rain-warning') {
        playSoftAlertChime('rain');
        const msg = payload.voiceText || `แจ้งเตือนสภาพอากาศ ท้องฟ้าครึ้มมีเมฆมาก อาจมีฝนตกในพื้นที่ โอกาสเกิดฝน ${payload.rainProb || 68} เปอร์เซ็นต์`;
        speakThaiText(msg, true);
        triggerRadarShowcase20s(false, '🌧️ แจ้งเตือนสภาพอากาศ: อาจมีฝนตก', 'rain');
        showToast(`🌧️ แจ้งเตือนเบาๆ: ${payload.advice || 'อาจมีฝนตกในพื้นที่'} (แสดงเรดาร์ 10 วินาที)`, 'info');
    } else if (payload.type === 'storm-warning') {
        playSoftAlertChime('storm');
        const msg = payload.voiceText || `คำเตือนสภาพอากาศ พบพายุฝนฟ้าคะนองรุนแรง โอกาสเกิดฝน ${payload.rainProb || 95} เปอร์เซ็นต์ โปรดระมัดระวังในการขับขี่`;
        speakThaiText(msg, true);
        triggerRadarShowcase20s(false, '⛈️ คำเตือนพายุฝนฟ้าคะนองรุนแรง', 'storm');
        showToast(`⛈️ คำเตือนพายุฝนฟ้าคะนองรุนแรง: ${payload.advice || 'โปรดระมัดระวังในการขับขี่'} (แสดงเรดาร์ 10 วินาที)!`, 'error');
    } else if (payload.type === 'arrived-100pct') {
        const destName = payload.destName || pendingDestination?.name || 'จุดหมายปลายทาง';
        if (navProgressPct) navProgressPct.textContent = '100%';
        if (navProgressFill) navProgressFill.style.width = '100%';
        updateGpsButtonsStatus(true, 0, '0.0');
        playSoftAlertChime('near-90pct');
        const msg = payload.voiceText || `คุณเดินทางถึงจุดหมาย ${destName} เรียบร้อยแล้ว`;
        speakThaiText(msg, true);
        triggerRadarShowcase20s(false, `🎉 ถึงจุดหมาย: ${destName}`);
        showToast(`🎉 เดินทางถึงจุดหมาย: ${destName} เรียบร้อยแล้ว!`, 'info');
    } else if (payload.type === 'nav-started') {
        playSoftAlertChime('rain');
        if (payload.voiceText) speakThaiText(payload.voiceText, true);
        triggerRadarShowcase20s(false, payload.title || `🧭 เริ่มนำทาง: ${payload.destName || ''}`);
    } else if (payload.type === 'route-weather-warning') {
        playSoftAlertChime('rain');
        if (payload.voiceText) speakThaiText(payload.voiceText, true);
        if (payload.routeWeatherAhead && typeof renderRouteWeatherAheadUI === 'function') {
            renderRouteWeatherAheadUI(payload.routeWeatherAhead);
        }
        showToast(`🌧️ พยากรณ์ล่วงหน้าตามเส้นทาง: ${payload.summary || 'พบโอกาสฝนตกระหว่างทาง'}`, 'info');
    } else if (payload.type === 'lyric-spotlight') {
        if (payload.lyricLine) {
            showLyricSpotlightFade(payload.lyricLine, payload.senderName || 'นักร้องนำ');
        }
    }
});

// Event Listeners for Radar & GPS Navigation
if (headerRadarBtn) {
    headerRadarBtn.addEventListener('click', () => {
        if (splitRadarOpen) closeSplitRadarPanel();
        else openSplitRadarPanel(false);
    });
}
if (sidebarOpenRadarBtn) {
    sidebarOpenRadarBtn.addEventListener('click', () => openSplitRadarPanel(false));
}
if (sidebarOpenNavBtn) {
    sidebarOpenNavBtn.addEventListener('click', () => openSplitRadarPanel(true));
}
if (btnCloseRadar) {
    btnCloseRadar.addEventListener('click', () => closeSplitRadarPanel());
}
if (btnModeMapRadar) {
    btnModeMapRadar.addEventListener('click', () => setRadarViewMode('map'));
}
if (btnModeWindy) {
    btnModeWindy.addEventListener('click', () => setRadarViewMode('windy'));
}
if (btnNavTts) {
    btnNavTts.addEventListener('click', () => {
        navTtsEnabled = !navTtsEnabled;
        btnNavTts.className = navTtsEnabled
            ? 'px-2 py-1 rounded text-[10px] bg-brand-peri/20 text-brand-peri border border-brand-peri/40 transition'
            : 'px-2 py-1 rounded text-[10px] bg-[#0a0a0a] text-brand-light/40 border border-brand-deep/40 transition';
        btnNavTts.innerHTML = navTtsEnabled ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
        showToast(navTtsEnabled ? 'เปิดเสียงแจ้งเตือนนำทางและสภาพอากาศ (TTS)' : 'ปิดเสียงแจ้งเตือนนำทาง (TTS)', 'info');
    });
}
if (btnRefreshGps) {
    btnRefreshGps.addEventListener('click', async () => {
        await requestUserLocation(true, false);
        showToast('อัปเดตพิกัดและวิเคราะห์สภาพอากาศล่าสุดแล้ว', 'info');
    });
}
if (routeCheckBtn) {
    routeCheckBtn.addEventListener('click', processRouteLinkInput);
}
if (routeLinkInput) {
    routeLinkInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') processRouteLinkInput();
    });
}
if (navStartBtn) {
    navStartBtn.addEventListener('click', startActiveNavigation);
}
if (navCancelPreviewBtn) {
    navCancelPreviewBtn.addEventListener('click', () => cancelNavigation(false));
}
if (navStopBtn) {
    navStopBtn.addEventListener('click', () => cancelNavigation(false));
}
if (navPingNowBtn) {
    navPingNowBtn.addEventListener('click', async () => {
        showToast('กำลังดึงพิกัดและคำนวณเวลาที่เหลือใหม่...', 'info');
        await refreshLiveNavigationRoute();
    });
}
if (btnTriggerShowcase) {
    btnTriggerShowcase.addEventListener('click', () => {
        triggerRadarShowcase20s(true);
    });
}
if (btnExitShowcase) {
    btnExitShowcase.addEventListener('click', () => {
        stopRadarShowcase20s();
    });
}
if (radarPlayBtn) {
    radarPlayBtn.addEventListener('click', () => {
        radarPlaying = !radarPlaying;
        if (radarPlayIcon) {
            radarPlayIcon.className = radarPlaying ? 'fa-solid fa-pause text-[9px]' : 'fa-solid fa-play text-[9px]';
        }
        if (radarPlaying) startRadarAnimation();
        else clearInterval(radarAnimTimer);
    });
}
if (toggleRadarOverlay) {
    toggleRadarOverlay.addEventListener('change', (e) => {
        radarOverlayVisible = e.target.checked;
        showRadarFrame(currentRadarFrameIdx);
    });
}
if (btnMapStyle) {
    btnMapStyle.addEventListener('click', () => {
        const order = ['dark', 'street', 'hybrid'];
        const next = order[(order.indexOf(mapStyleMode) + 1) % order.length];
        applyMapBaseLayer(next);
        const sel = $('settings-map-style');
        if (sel) sel.value = next;
    });
}

// ============================================================================
// SETTINGS MODAL, PROFILE CUSTOMIZATION & 5-TAP SECRET EVENT TEST LAB
// ============================================================================
const headerSettingsBtn = $('header-settings-btn');
const settingsModal = $('settings-modal');
const closeSettingsBtn = $('close-settings-btn');
const settingsNameInput = $('settings-name');
const settingsColorInput = $('settings-color');
const saveProfileBtn = $('save-profile-btn');
const settingsNavTts = $('settings-nav-tts');
const settingsDanmakuTts = $('settings-danmaku-tts');
const settingsMapStyle = $('settings-map-style');
const settingsRefreshGpsBtn = $('settings-refresh-gps-btn');

// Auto-DJ Settings Refs
const autodjStatusBadge = $('autodj-status-badge');
const settingsAutodjToggle = $('settings-autodj-toggle');
const autodjOptionsWrap = $('autodj-options-wrap');
const settingsAutodjMode = $('settings-autodj-mode');
const settingsAutodjCustom = $('settings-autodj-custom');
const settingsAutodjCustomBtn = $('settings-autodj-custom-btn');
const settingsAutodjPlayNowBtn = $('settings-autodj-play-now-btn');

// 5-Tap Unlock Refs
const secretTestUnlockBtn = $('secret-test-unlock-btn');
const modalGear5Tap = $('modal-gear-5tap');
const settingsGearIcon = $('settings-gear-icon');
const secretTapBadge = $('secret-tap-badge');
const secretTapHint = $('secret-tap-hint');
const testLabPanel = $('test-lab-panel');
const testSyncAllToggle = $('test-sync-all-toggle');

// Test Buttons
const btnTestRainAlert = $('btn-test-rain-alert');
const btnTest90PctAlert = $('btn-test-90pct-alert');
const btnTest20mShowcase = $('btn-test-20m-showcase');
const btnTestSimDrive = $('btn-test-sim-drive');
const btnTestStormAlert = $('btn-test-storm-alert');
const btnTestArrivedAlert = $('btn-test-arrived-alert');
const btnTestPartyFx = $('btn-test-party-fx');

let secretTapCount = 0;
let secretTapResetTimer = null;
let testLabUnlocked = false;
let simDriveTimer = null;

function syncAutoDjSettingsUI() {
    const enabled = state.autoDjEnabled !== false;
    const mode = state.autoDjMode || 'khlerm';
    const customQuery = state.autoDjCustomQuery || '';
    const shortLabel = getAutoDjModeShortLabel(mode, customQuery);

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

function openSettingsModal() {
    if (!settingsModal) return;
    if (settingsNameInput) settingsNameInput.value = myProfile.name || '';
    if (settingsColorInput) settingsColorInput.value = safeColor(myProfile.color);
    if (settingsNavTts) settingsNavTts.checked = navTtsEnabled;
    if (settingsDanmakuTts && ttsToggle) settingsDanmakuTts.checked = ttsToggle.checked;
    if (settingsMapStyle) settingsMapStyle.value = mapStyleMode;
    syncAutoDjSettingsUI();
    updateProfileUI();
    settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('hidden');
}

// Handle 5 rapid taps to unlock the Event & Alert Test Lab
function registerSecret5Tap() {
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

if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', () => {
        openSettingsModal();
        registerSecret5Tap();
    });
}
if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
}
if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });
}
if (secretTestUnlockBtn) {
    secretTestUnlockBtn.addEventListener('click', registerSecret5Tap);
}
if (modalGear5Tap) {
    modalGear5Tap.addEventListener('click', registerSecret5Tap);
}

// Preset color swatches in Settings Modal
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
        const previewBadge = $('profile-preview-badge');
        if (previewBadge) {
            previewBadge.textContent = settingsNameInput.value.trim() || 'ตัวอย่างชื่อ';
        }
    });
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
        const name = (settingsNameInput?.value || '').trim().substring(0, 25);
        if (!name) return showToast('กรุณาใส่ชื่อเล่นของคุณ', 'error');

        myProfile.name = name;
        myProfile.color = safeColor(settingsColorInput?.value || '#ABD2FA');

        localStorage.setItem('nickname', myProfile.name);
        localStorage.setItem('usercolor', myProfile.color);

        updateProfileUI();
        socket.emit('set-profile', myProfile);
        showToast('บันทึกโปรไฟล์เรียบร้อยแล้ว!', 'info');
    });
}

// Auto-DJ Settings Event Listeners
if (settingsAutodjToggle) {
    settingsAutodjToggle.addEventListener('change', (e) => {
        socket.emit('autodj-config', {
            enabled: e.target.checked
        });
    });
}

if (settingsAutodjMode) {
    settingsAutodjMode.addEventListener('change', (e) => {
        if (settingsAutodjCustom) settingsAutodjCustom.value = '';
        socket.emit('autodj-config', {
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
        socket.emit('autodj-config', {
            enabled: true,
            mode: preset,
            customQuery: ''
        });
    });
});

if (settingsAutodjCustomBtn) {
    settingsAutodjCustomBtn.addEventListener('click', () => {
        const customVal = (settingsAutodjCustom?.value || '').trim().substring(0, 50);
        socket.emit('autodj-config', {
            enabled: true,
            mode: settingsAutodjMode?.value || state.autoDjMode || 'khlerm',
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
        const modeVal = settingsAutodjMode?.value || state.autoDjMode || 'khlerm';
        const customVal = (settingsAutodjCustom?.value || '').trim().substring(0, 50);
        closeSettingsModal();
        showToast('🎧 กำลังสุ่มหาเพลง Auto-DJ ตามโหมดที่เลือก...', 'info');
        socket.emit('autodj-play-now', {
            mode: modeVal,
            customQuery: customVal
        });
    });
}

if (settingsNavTts) {
    settingsNavTts.addEventListener('change', (e) => {
        navTtsEnabled = e.target.checked;
        if (btnNavTts) {
            btnNavTts.className = navTtsEnabled
                ? 'px-2 py-1 rounded text-[10px] bg-brand-peri/20 text-brand-peri border border-brand-peri/40 transition'
                : 'px-2 py-1 rounded text-[10px] bg-[#0a0a0a] text-brand-light/40 border border-brand-deep/40 transition';
            btnNavTts.innerHTML = navTtsEnabled ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
        }
        showToast(navTtsEnabled ? 'เปิดเสียงพูดแจ้งเตือนนำทาง (TTS)' : 'ปิดเสียงพูดแจ้งเตือนนำทาง (TTS)', 'info');
    });
}

if (settingsDanmakuTts) {
    settingsDanmakuTts.addEventListener('change', (e) => {
        if (ttsToggle) ttsToggle.checked = e.target.checked;
        showToast(e.target.checked ? 'เปิดอ่านข้อความวิ่ง (Danmaku TTS)' : 'ปิดอ่านข้อความวิ่ง (Danmaku TTS)', 'info');
    });
}

if (settingsMapStyle) {
    settingsMapStyle.addEventListener('change', (e) => {
        initLeafletRadarMap();
        applyMapBaseLayer(e.target.value);
        showToast('เปลี่ยนรูปแบบแผนที่เรียบร้อย', 'info');
    });
}

if (settingsRefreshGpsBtn) {
    settingsRefreshGpsBtn.addEventListener('click', async () => {
        closeSettingsModal();
        if (!splitRadarOpen) await openSplitRadarPanel(false);
        await requestUserLocation(true, false);
        showToast('รีเฟรชพิกัด GPS ปัจจุบันเรียบร้อยแล้ว', 'info');
    });
}

// ============================================================================
// TEST LAB ACTIONS (Simulate Every Event & Alert Immediately)
// ============================================================================

// 1. Test "อาจมีฝนตก" (Soft chime + Thai voice warning + show weather radar in place of Control Panel for 10s, then return)
if (btnTestRainAlert) {
    btnTestRainAlert.addEventListener('click', async () => {
        const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
        closeSettingsModal();

        const simWeather = {
            temp: 26,
            humidity: 88,
            wind: 18,
            rainProb: 68,
            code: 3,
            text: '☁️ มีเมฆมาก (อาจมีฝนตก)',
            rainAlert: true,
            advice: '🌧️ ท้องฟ้าครึ้มมีเมฆมาก อาจมีฝนตกในพื้นที่ ระบบเปิดเรดาร์ให้ตรวจสอบแล้ว'
        };
        currentWeatherInfo = simWeather;
        renderWeatherCardUI(simWeather, userCoords?.label || 'พื้นที่ทดสอบเรดาร์สภาพอากาศ');

        const voiceMsg = 'แจ้งเตือนสภาพอากาศ ท้องฟ้าครึ้มมีเมฆมาก อาจมีฝนตกในพื้นที่ โอกาสเกิดฝน 68 เปอร์เซ็นต์ โปรดตรวจสอบเรดาร์สภาพอากาศ';
        playSoftAlertChime('rain');
        speakThaiText(voiceMsg, true);
        triggerRadarShowcase20s(false, '🌧️ แจ้งเตือนสภาพอากาศ: อาจมีฝนตก', 'rain');
        showToast('🌧️ [ทดสอบ] โอกาสเกิดฝน: ซูมเรดาร์ระดับประเทศ ➔ จุดที่คุณอยู่!', 'info');

        if (syncAll) {
            emitNavStatePatch({ panelOpen: true, userCoords, weatherInfo: simWeather });
        }
        // Always broadcast alert to Host & room so Host always plays the warning chime, voice & country-to-user zoom
        socket.emit('trigger-nav-alert', {
            type: 'rain-warning',
            advice: simWeather.advice,
            text: simWeather.text,
            rainProb: simWeather.rainProb,
            userCoords,
            weatherInfo: simWeather,
            voiceText: voiceMsg
        });
    });
}

// 2. Test "เดินทางถึง 90% ใกล้ถึงจุดหมาย" (Voice TTS + Chime + 90% Progress Bar + 10s Map Showcase)
if (btnTest90PctAlert) {
    btnTest90PctAlert.addEventListener('click', async () => {
        const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
        closeSettingsModal();

        if (!splitRadarOpen) {
            await openSplitRadarPanel(false, true);
        }

        const baseLat = userCoords ? userCoords.lat : 13.7563;
        const baseLon = userCoords ? userCoords.lon : 100.5018;
        const destLat = pendingDestination ? pendingDestination.lat : baseLat + 0.018;
        const destLon = pendingDestination ? pendingDestination.lon : baseLon + 0.018;
        const destName = pendingDestination?.name || 'จุดหมายทดสอบ (สยามพารากอน)';

        pendingDestination = {
            lat: destLat,
            lon: destLon,
            name: destName,
            distanceKm: '24.0',
            initialDistanceKm: 24.0,
            durationMin: 35,
            summary: 'ผ่านเส้นทางหลัก'
        };
        activeNavigation = true;
        hasAlerted90Pct = true;
        renderNavStepUI('active');

        const simGeometry = {
            type: 'LineString',
            coordinates: [
                [baseLon, baseLat],
                [baseLon + (destLon - baseLon) * 0.5, baseLat + (destLat - baseLat) * 0.6],
                [destLon, destLat]
            ]
        };
        drawRouteOnMap(simGeometry, destLat, destLon, destName, true);

        const arrival = new Date(Date.now() + 5 * 60000);
        const arrivalTime = `${String(arrival.getHours()).padStart(2, '0')}:${String(arrival.getMinutes()).padStart(2, '0')} น.`;
        const livePayload = {
            remKm: '2.4',
            etaMins: 5,
            arrivalTime,
            instructionText: 'เตรียมชิดซ้าย อีก 400 ม. ถึงจุดหมาย',
            roadStatus: `เดินทางแล้ว 90% • ใกล้ถึง ${destName}`,
            progressPct: 90,
            geometry: simGeometry
        };
        updateLiveNavigationDOM(livePayload);

        const voiceMsg = `ใกล้ถึงจุดหมายแล้ว ขณะนี้เดินทางแล้ว 90 เปอร์เซ็นต์ เหลือเวลาอีกประมาณ 5 นาที กับระยะทางอีก 2.4 กิโลเมตร`;
        playSoftAlertChime('near-90pct');
        speakThaiText(voiceMsg, true);
        triggerRadarShowcase20s(false, '🏁 ใกล้ถึงจุดหมายแล้ว (90%)');
        showToast('🏁 [ทดสอบ 90%] โชว์แผนที่แทนแผงควบคุม 10 วินาที แล้วสลับกลับอัตโนมัติ!', 'info');

        if (syncAll) {
            emitNavStatePatch({
                panelOpen: true,
                step: 'active',
                destination: pendingDestination,
                liveRoute: livePayload,
                hasAlerted90Pct: true
            });
        }
        socket.emit('trigger-nav-alert', {
            type: 'near-90pct',
            progressPct: 90,
            etaMins: 5,
            remKm: '2.4',
            destName,
            voiceText: voiceMsg
        });
    });
}

// 3. Test "สลับโชว์แผนที่แทนแผงควบคุม 10 วินาที แล้วสลับกลับ"
if (btnTest20mShowcase) {
    btnTest20mShowcase.addEventListener('click', () => {
        closeSettingsModal();
        const voiceMsg = 'แสดงแผนที่นำทางและเรดาร์สภาพอากาศ 10 วินาที';
        playSoftAlertChime('rain');
        speakThaiText(voiceMsg, true);
        showToast('👁️ [ทดสอบ] โชว์แผนที่ + เรดาร์อากาศแทนแผงควบคุม 10 วินาที แล้วสลับกลับอัตโนมัติ!', 'info');
        triggerRadarShowcase20s(false, '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ');
        socket.emit('trigger-nav-alert', {
            type: 'showcase-20s',
            title: '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ',
            voiceText: voiceMsg
        });
    });
}

// 4. Test "จำลองการขับรถนำทางจริง (0% -> 50% -> 90% -> 100%)"
if (btnTestSimDrive) {
    btnTestSimDrive.addEventListener('click', async () => {
        const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
        closeSettingsModal();
        clearInterval(simDriveTimer);

        if (!splitRadarOpen) {
            await openSplitRadarPanel(false, true);
        }

        const startLat = userCoords ? userCoords.lat : 13.7563;
        const startLon = userCoords ? userCoords.lon : 100.5018;
        const destLat = startLat + 0.035;
        const destLon = startLon + 0.035;
        const destName = 'จุดหมายจำลอง (ตลาดนัดกลางคืน)';

        pendingDestination = {
            lat: destLat,
            lon: destLon,
            name: destName,
            distanceKm: '10.0',
            initialDistanceKm: 10.0,
            durationMin: 20,
            summary: 'ถนนสายหลัก (จำลองการขับขี่)'
        };
        activeNavigation = true;
        hasAlerted90Pct = false;
        renderNavStepUI('active');

        const waypoints = [
            { pct: 10, remKm: '9.0', eta: 18, lat: startLat + 0.0035, lon: startLon + 0.0035, turn: 'ตรงไปตามถนนสายหลัก (อีก 3.5 กม.)' },
            { pct: 50, remKm: '5.0', eta: 10, lat: startLat + 0.0175, lon: startLon + 0.0175, turn: 'เลี้ยวขวาเข้าสู่ทางหลวง (อีก 1.2 กม.)' },
            { pct: 90, remKm: '1.0', eta: 2,  lat: startLat + 0.0315, lon: startLon + 0.0315, turn: 'ชิดซ้าย เตรียมเข้าสู่จุดหมาย (อีก 300 ม.)' },
            { pct: 100, remKm: '0.0', eta: 0, lat: destLat, lon: destLon, turn: 'ถึงจุดหมายปลายทางแล้ว!' }
        ];

        const startVoice = `เริ่มจำลองการนำทางไปยัง ${destName}`;
        playSoftAlertChime('rain');
        speakThaiText(startVoice, true);
        showToast('🚗 เริ่มจำลองการขับรถนำทางอัตโนมัติ (10% ➔ 50% ➔ 90% ➔ 100%)', 'info');
        socket.emit('trigger-nav-alert', {
            type: 'nav-started',
            destName,
            title: `🧭 เริ่มจำลองนำทาง: ${destName}`,
            voiceText: startVoice
        });

        let stepIdx = 0;
        const runSimStep = () => {
            if (stepIdx >= waypoints.length) {
                clearInterval(simDriveTimer);
                return;
            }
            const wp = waypoints[stepIdx++];
            userCoords = { lat: wp.lat, lon: wp.lon, label: 'พิกัดจำลองการเดินทาง' };
            updateUserMarkerOnMap(wp.lat, wp.lon, true);

            const geom = {
                type: 'LineString',
                coordinates: [
                    [wp.lon, wp.lat],
                    [destLon, destLat]
                ]
            };
            drawRouteOnMap(geom, destLat, destLon, destName, false);

            const arrival = new Date(Date.now() + wp.eta * 60000);
            const arrivalTime = `${String(arrival.getHours()).padStart(2, '0')}:${String(arrival.getMinutes()).padStart(2, '0')} น.`;
            const livePayload = {
                remKm: wp.remKm,
                etaMins: wp.eta,
                arrivalTime,
                instructionText: wp.turn,
                roadStatus: `จำลองการเดินทาง (${wp.pct}%) • ${currentWeatherInfo ? currentWeatherInfo.text : 'อากาศปกติ'}`,
                progressPct: wp.pct,
                geometry: geom
            };
            updateLiveNavigationDOM(livePayload);

            if (syncAll) {
                emitNavStatePatch({
                    panelOpen: true,
                    step: 'active',
                    userCoords,
                    destination: pendingDestination,
                    liveRoute: livePayload
                });
            }

            if (wp.pct === 90) {
                const voice90 = `ใกล้ถึงจุดหมายแล้ว ขณะนี้เดินทางแล้ว 90 เปอร์เซ็นต์ เหลือเวลาอีกประมาณ ${wp.eta} นาที กับระยะทางอีก ${wp.remKm} กิโลเมตร`;
                playSoftAlertChime('near-90pct');
                speakThaiText(voice90, true);
                showToast(`🏁 [จำลอง 90%] ใกล้ถึงจุดหมายแล้ว! เหลือ ${wp.eta} นาที (${wp.remKm} กม.)`, 'info');
                socket.emit('trigger-nav-alert', {
                    type: 'near-90pct',
                    progressPct: 90,
                    etaMins: wp.eta,
                    remKm: wp.remKm,
                    destName,
                    voiceText: voice90
                });
            } else if (wp.pct === 100) {
                clearInterval(simDriveTimer);
                setTimeout(() => {
                    const voice100 = `คุณเดินทางถึงจุดหมาย ${destName} เรียบร้อยแล้ว`;
                    playSoftAlertChime('near-90pct');
                    speakThaiText(voice100, true);
                    showToast(`🎉 [จำลอง 100%] ถึงจุดหมายแล้ว! จะสลับกลับแผงควบคุมใน 10 วินาที`, 'info');
                    triggerRadarShowcase20s(false, `🎉 ถึงจุดหมาย: ${destName}`);
                    socket.emit('trigger-nav-alert', {
                        type: 'arrived-100pct',
                        destName,
                        voiceText: voice100
                    });
                }, 500);
            }
        };

        runSimStep();
        simDriveTimer = setInterval(runSimStep, 3500);
    });
}

// 5. Test Severe Thunderstorm Alert
if (btnTestStormAlert) {
    btnTestStormAlert.addEventListener('click', async () => {
        const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
        closeSettingsModal();
        const stormWeather = {
            temp: 24,
            humidity: 96,
            wind: 45,
            rainProb: 95,
            code: 95,
            text: '⛈️ พายุฝนฟ้าคะนองรุนแรง',
            rainAlert: true,
            advice: '⛈️ คำเตือน! มีพายุฝนฟ้าคะนองและลมกระโชกแรง โปรดหลีกเลี่ยงพื้นที่น้ำท่วมขัง'
        };
        currentWeatherInfo = stormWeather;
        renderWeatherCardUI(stormWeather, userCoords?.label || 'พื้นที่ทดสอบพายุฝน');

        const voiceMsg = 'คำเตือนสภาพอากาศ พบพายุฝนฟ้าคะนองรุนแรง โอกาสเกิดฝน 95 เปอร์เซ็นต์ โปรดระมัดระวังในการขับขี่';
        playSoftAlertChime('storm');
        speakThaiText(voiceMsg, true);
        triggerRadarShowcase20s(false, '⛈️ คำเตือนพายุฝนฟ้าคะนองรุนแรง', 'storm');
        showToast('⛈️ [ทดสอบ] แจ้งเตือนพายุรุนแรง: ซูมเรดาร์ระดับประเทศ ➔ จุดที่คุณอยู่!', 'error');

        if (syncAll) {
            emitNavStatePatch({ panelOpen: true, userCoords, weatherInfo: stormWeather });
        }
        // Always broadcast storm alert to Host & room so Host plays warning chime, voice & country-to-user zoom
        socket.emit('trigger-nav-alert', {
            type: 'storm-warning',
            advice: stormWeather.advice,
            text: stormWeather.text,
            rainProb: stormWeather.rainProb,
            userCoords,
            weatherInfo: stormWeather,
            voiceText: voiceMsg
        });
    });
}

// 6. Test Arrived 100% Alert
if (btnTestArrivedAlert) {
    btnTestArrivedAlert.addEventListener('click', () => {
        closeSettingsModal();
        const destName = pendingDestination?.name || 'จุดหมายปลายทาง';
        if (navProgressPct) navProgressPct.textContent = '100%';
        if (navProgressFill) navProgressFill.style.width = '100%';
        updateGpsButtonsStatus(true, 0, '0.0');

        const voiceMsg = `คุณเดินทางถึงจุดหมาย ${destName} เรียบร้อยแล้ว`;
        playSoftAlertChime('near-90pct');
        speakThaiText(voiceMsg, true);
        triggerRadarShowcase20s(false, `🎉 ถึงจุดหมาย: ${destName}`);
        showToast(`🎉 [ทดสอบ 100%] เดินทางถึงจุดหมาย: ${destName} เรียบร้อยแล้ว!`, 'info');

        socket.emit('trigger-nav-alert', {
            type: 'arrived-100pct',
            destName,
            voiceText: voiceMsg
        });
    });
}

// 7. Test Party FX (Danmaku + Reactions)
if (btnTestPartyFx) {
    btnTestPartyFx.addEventListener('click', () => {
        closeSettingsModal();
        socket.emit('send-danmaku', {
            text: '🎉 ทดสอบระบบข้อความวิ่ง & เสียงแจ้งเตือน MAITEMBATH GANG PARTY!',
            nickname: myProfile.name || 'System Test',
            color: myProfile.color || '#ABD2FA',
            tts: true
        });
        ['😍', '🎉', '🔥', '👍'].forEach((em, i) => {
            setTimeout(() => socket.emit('send-reaction', em), i * 250);
        });
        showToast('✨ ส่งเอฟเฟกต์ข้อความวิ่งและอีโมจิทดสอบแล้ว!', 'info');
    });
}

// 8. Replay Minimal Luxe Intro & Sound
const btnTestIntro = $('btn-test-intro');
if (btnTestIntro) {
    btnTestIntro.addEventListener('click', () => {
        closeSettingsModal();
        // Reset state so sound replays
        introSoundPlayed = false;
        introDismissed = false;
        startIntroSequence(true);
    });
}

// ============================================================================
// FEATURE 1: SYNCED LYRICS OVERLAY & ONE-CLICK KARAOKE SWITCH
// ============================================================================
const lyricsOverlay = $('lyrics-overlay');
const lyricsOverlayClose = $('lyrics-overlay-close');
const lyricsKaraokePill = $('lyrics-karaoke-pill');
const lyricsCountdownPill = $('lyrics-countdown-pill');
const lyricsOverlayOffsetLabel = $('lyrics-overlay-offset-label');
const btnLyricsSendDanmaku = $('btn-lyrics-send-danmaku');
const btnLyricsCinema = $('btn-lyrics-cinema');
const lyricsStage = $('lyrics-stage');
const lyricsFallbackStage = $('lyrics-fallback-stage');
const lyricsReelViewport = $('lyrics-reel-viewport');
const lyricsReelTrack = $('lyrics-reel-track');
const lyricsLinePrev = $('lyrics-line-prev');
const lyricsLineActive = $('lyrics-line-active');
const lyricsLineNext = $('lyrics-line-next');
const lyricsLineProgress = $('lyrics-line-progress');
const lyricsRestorePill = $('lyrics-restore-pill');
const playerLyricsBtn = $('player-lyrics-btn');
const playerLyricsBtnLabel = $('player-lyrics-btn-label');
const btnToggleLyrics = $('btn-toggle-lyrics');
const btnLyricsLabel = $('btn-lyrics-label');
const btnKaraokeSwitch = $('btn-karaoke-switch');
const btnKaraokeLabel = $('btn-karaoke-label');
const inlineLyricsBox = $('inline-lyrics-box');
const inlineLyricsCountdown = $('inline-lyrics-countdown');
const inlineLyricsOffsetBadge = $('inline-lyrics-offset-badge');
const btnInlineToggleOverlay = $('btn-inline-toggle-overlay');
const inlineToggleOverlayLabel = $('inline-toggle-overlay-label');
const btnInlineLyricsDanmaku = $('btn-inline-lyrics-danmaku');
const btnInlineLyricsCopy = $('btn-inline-lyrics-copy');
const btnInlineLyricsExpand = $('btn-inline-lyrics-expand');
const iconInlineLyricsExpand = $('icon-inline-lyrics-expand');
const btnLyricsRecenter = $('btn-lyrics-recenter');
const inlineLyricsScroll = $('inline-lyrics-scroll');
const inlineLyricsList = $('inline-lyrics-list');
const inlineLyricsSource = $('inline-lyrics-source');
const lyricSpotlightBanner = $('lyric-spotlight-banner');
const lyricSpotlightUser = $('lyric-spotlight-user');
const lyricSpotlightText = $('lyric-spotlight-text');

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
let lastPlaybackSyncPerf = performance.now();
let lyricSpotlightFadeTimer = null;

function setLyricsPanelsFadeState(showOverlay, _showInlineUnused, canShowOnScreen = false) {
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
    // Control panel button (#btn-toggle-lyrics) reflects whether lyrics are currently shown on the main video screen
    const isOverlayEnabledByUser = Boolean(lyricsVisible && !overlayDismissedForTrack);
    if (btnToggleLyrics) {
        btnToggleLyrics.className = isOverlayEnabledByUser
            ? 'bg-brand-peri/25 hover:bg-brand-peri/35 border border-brand-peri text-white rounded-xl py-2 px-2.5 text-[11px] font-semibold transition flex items-center justify-center gap-1.5 shadow-sm shadow-brand-peri/20'
            : 'bg-[#0d1524] hover:bg-brand-deep/70 border border-brand-peri/35 text-brand-peri rounded-xl py-2 px-2.5 text-[11px] font-medium transition flex items-center justify-center gap-1.5 active:scale-95';
    }
    if (btnLyricsLabel) {
        btnLyricsLabel.textContent = isOverlayEnabledByUser ? 'ซ่อนเนื้อเพลงบนจอ' : 'เนื้อเพลงขึ้นจอ';
    }
    // Floating restore pill on video player: smoothly fades in when song has active lyrics & overlay is hidden
    if (lyricsRestorePill) {
        lyricsRestorePill.classList.toggle('lyrics-btn-fade-active', hasActiveTrackLyrics && !nextOverlayActive);
    }
    // Bottom-right player lyrics button: smoothly fades in when song has active lyrics, fades out when no lyrics/ended
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

function showLyricSpotlightFade(lyricLine, senderName = 'นักร้องนำ') {
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

// Default 2.0s slower (delayed) so YouTube MVs match LRC audio timestamps, plus user fine-tuning
const LYRICS_BASE_DELAY_SEC = 2.0;
let lyricsUserShiftSec = 0.0; // Positive = slower (more delay), Negative = faster

function getEffectiveLyricDelaySec() {
    return LYRICS_BASE_DELAY_SEC + lyricsUserShiftSec;
}

function updateLyricOffsetBadges() {
    const totalDelay = getEffectiveLyricDelaySec();
    // Display as negative offset when delayed (e.g. -2.0s means lyrics appear 2.0s later/slower)
    const displayVal = -totalDelay;
    const formatted = `${displayVal > 0 ? '+' : ''}${displayVal.toFixed(1)}s`;
    if (lyricsOverlayOffsetLabel) lyricsOverlayOffsetLabel.textContent = formatted;
    if (inlineLyricsOffsetBadge) inlineLyricsOffsetBadge.textContent = formatted;
}
updateLyricOffsetBadges();

function adjustLyricSyncOffset(action, skipSync = false) {
    if (action === 'reset') {
        lyricsUserShiftSec = 0.0;
        showToast('⏱️ รีเซ็ตจังหวะเนื้อเพลงเป็นค่ามาตรฐาน (ช้าลง 2.0 วินาที)', 'info');
    } else {
        const delta = parseFloat(action);
        if (!isNaN(delta)) {
            // If user clicks "-0.5s" (make lyrics slower), increase delay by +0.5s
            // If user clicks "+0.5s" (make lyrics faster), decrease delay by -0.5s
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

document.querySelectorAll('[data-lyric-offset]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-lyric-offset');
        adjustLyricSyncOffset(act);
    });
});

// Detect manual scrolling in #inline-lyrics-scroll so auto-scroll doesn't fight the user
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
        if (inlineLyricsList && currentActiveLyricIdx >= 0) {
            const activeEl = inlineLyricsList.querySelector(`[data-lyric-idx="${currentActiveLyricIdx}"]`);
            if (activeEl) smoothScrollInlineLyricsToCenter(activeEl, false, true);
        }
    });
}

function smoothScrollInlineLyricsToCenter(activeEl, immediate = false, forceOverrideManual = false) {
    const container = inlineLyricsScroll || inlineLyricsBox;
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
        // Smooth spring-like cubic-bezier ease-out
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

function smoothScrollOverlayReelToActive(activeIdx) {
    if (!lyricsReelViewport || !lyricsReelTrack) return;
    const activeItem = lyricsReelTrack.querySelector(`[data-reel-idx="${activeIdx}"]`);
    if (!activeItem) return;

    const viewportHeight = lyricsReelViewport.clientHeight || (lyricsCinemaMode ? 176 : 96);
    const itemCenter = activeItem.offsetTop + (activeItem.offsetHeight / 2);
    const translateY = (viewportHeight / 2) - itemCenter;
    lyricsReelTrack.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
}

function getPrecisePlaybackTime() {
    if (!state.currentVideo) return 0;
    if (hostMode) {
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
    if (state.isPlaying && lastKnownPlaybackTime > 0) {
        const deltaSec = Math.min(1.5, Math.max(0, (performance.now() - lastPlaybackSyncPerf) / 1000));
        return lastKnownPlaybackTime + deltaSec;
    }
    return state.currentTime || 0;
}

function updateLyricsToggleButtonsUI() {
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
    if (nowPlayingCard) {
        nowPlayingCard.scrollTop = 0;
    }
}

function toggleLyricsDisplay(forceState, skipSync = false) {
    const currentlyEnabled = Boolean(lyricsVisible && !overlayDismissedForTrack);
    const nextState = typeof forceState === 'boolean' ? forceState : !currentlyEnabled;
    lyricsVisible = nextState;
    overlayDismissedForTrack = !nextState;
    updateLyricsToggleButtonsUI();
    if (!skipSync) emitLyricsStateSync();
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

function toggleVideoOverlayLyrics(forceShow) {
    toggleLyricsDisplay(forceShow);
}

function updateKaraokeButtonUI() {
    karaokeSwitchPending = false;
    const isKaraoke = Boolean(state.currentVideo?.isKaraokeMode);
    if (lyricsKaraokePill) {
        lyricsKaraokePill.classList.toggle('hidden', !isKaraoke);
    }
    if (!btnKaraokeSwitch || !btnKaraokeLabel) return;
    btnKaraokeSwitch.disabled = !state.currentVideo;
    if (isKaraoke) {
        btnKaraokeSwitch.className = 'bg-pink-600/30 hover:bg-pink-600/45 border border-pink-400 text-pink-200 rounded-xl py-2 px-2.5 text-[11px] font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-pink-500/20';
        btnKaraokeLabel.textContent = 'กลับเพลงต้นฉบับ';
    } else {
        btnKaraokeSwitch.className = 'bg-[#1a0f24] hover:bg-pink-950/70 border border-pink-500/35 text-pink-300 rounded-xl py-2 px-2.5 text-[11px] font-medium transition flex items-center justify-center gap-1.5 active:scale-95';
        btnKaraokeLabel.textContent = 'สลับคาราโอเกะ';
    }
}

function sendCurrentLyricLineToDanmaku() {
    if (!state.currentVideo || !currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines)) {
        return showToast('ยังไม่มีท่อนเนื้อเพลงให้ส่งขึ้นจอ', 'error');
    }
    const idx = Math.max(0, currentActiveLyricIdx);
    const lineObj = currentLyricsData.lines[idx];
    if (!lineObj || !lineObj.text) return;

    const sender = myProfile.name || 'นักร้องนำ';
    showLyricSpotlightFade(lineObj.text, sender);

    socket.emit('send-danmaku', {
        text: `🎤 ♪ ${lineObj.text} ♪`,
        nickname: sender,
        color: myProfile.color || '#ABD2FA',
        tts: false
    });
    // Also broadcast via nav-alert so Host & all screens receive the lyric spotlight fade
    socket.emit('trigger-nav-alert', {
        type: 'lyric-spotlight',
        lyricLine: lineObj.text,
        senderName: sender
    });
    socket.emit('send-reaction', '🎶');
    showToast(`✨ แสดงท่อน "${lineObj.text.slice(0, 28)}..." ขึ้นจอแบบ Fade แล้ว!`, 'info');
}

socket.on('new-danmaku', (d) => {
    if (d && typeof d.text === 'string' && d.text.startsWith('🎤 ♪ ')) {
        const cleanLyric = d.text.replace(/^🎤\s*♪\s*/, '').replace(/\s*♪\s*$/, '').trim();
        if (cleanLyric) {
            showLyricSpotlightFade(cleanLyric, d.nickname || 'นักร้องนำ');
        }
    }
});

function copyAllLyricsToClipboard() {
    if (!currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines) || currentLyricsData.lines.length === 0) {
        return showToast('ไม่มีเนื้อเพลงให้คัดลอกสำหรับเพลงนี้', 'error');
    }
    const title = state.currentVideo?.title || 'เนื้อเพลง';
    const fullText = `🎵 ${title}\n\n` + currentLyricsData.lines.map(l => l.text).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullText).then(() => {
            showToast('📋 คัดลอกเนื้อเพลงทั้งหมดเรียบร้อยแล้ว!', 'info');
        }).catch(() => {
            showToast('ไม่สามารถคัดลอกเนื้อเพลงได้', 'error');
        });
    }
}

if (btnLyricsSendDanmaku) {
    btnLyricsSendDanmaku.addEventListener('click', () => sendCurrentLyricLineToDanmaku());
}
if (btnInlineLyricsDanmaku) {
    btnInlineLyricsDanmaku.addEventListener('click', () => sendCurrentLyricLineToDanmaku());
}
if (btnInlineToggleOverlay) {
    btnInlineToggleOverlay.addEventListener('click', () => toggleVideoOverlayLyrics());
}
if (lyricsRestorePill) {
    lyricsRestorePill.addEventListener('click', () => toggleVideoOverlayLyrics(true));
}
if (btnInlineLyricsCopy) {
    btnInlineLyricsCopy.addEventListener('click', () => copyAllLyricsToClipboard());
}
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
        if (lyricsOverlay) {
            lyricsOverlay.classList.toggle('lyrics-cinema-mode', lyricsCinemaMode);
        }
        emitLyricsStateSync();
        setTimeout(() => {
            if (currentActiveLyricIdx >= 0) smoothScrollOverlayReelToActive(currentActiveLyricIdx);
        }, 180);
    });
}

async function syncLyricsForCurrentTrack(forceFetch = false) {
    if (!state.currentVideo) {
        currentLyricsTrackKey = null;
        currentLyricsData = null;
        currentActiveLyricIdx = -1;
        overlayDismissedForTrack = false;
        setLyricsPanelsFadeState(false, false);
        if (lyricsLineProgress) lyricsLineProgress.style.width = '0%';
        if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
        if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');
        if (inlineLyricsList) {
            inlineLyricsList.innerHTML = '';
        }
        return;
    }

    const baseTitle = state.currentVideo.originalTitle || state.currentVideo.normalTitle || state.currentVideo.title || '';
    const baseAuthor = state.currentVideo.normalAuthor || state.currentVideo.author || '';
    const trackKey = `${state.currentVideo.id || ''}:${baseTitle}`;

    // Automatically show lyrics overlay when user switches into Karaoke mode
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

    // Keep lyrics panels smoothly faded out while searching so we never show an empty/loading box over the MV
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

        // If lyrics are NOT found, smoothly keep/fade out the lyrics panels
        if (!data.found || !Array.isArray(data.lines) || data.lines.length === 0) {
            setLyricsPanelsFadeState(false, false);
            if (lyricsLineProgress) lyricsLineProgress.style.width = '0%';
            if (inlineLyricsList) {
                inlineLyricsList.innerHTML = '';
            }
            return;
        }

        // Build Smooth Vertical Scrolling Reel on Video Overlay (#lyrics-reel-track)
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
                        socket.emit('seek-to', Math.max(0, sec + getEffectiveLyricDelaySec()));
                    }
                });
            });
        }

        // Build Inline Lyrics List with timestamps & karaoke wipe progress
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
                        socket.emit('seek-to', Math.max(0, sec + getEffectiveLyricDelaySec()));
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

function updateActiveLyricLine(currentTimeSec, forceRender = false, isTicker = false) {
    if (typeof currentTimeSec === 'number' && !isNaN(currentTimeSec) && !forceRender && !isTicker) {
        lastKnownPlaybackTime = currentTimeSec;
        lastPlaybackSyncPerf = performance.now();
    }

    if (!currentLyricsData || !currentLyricsData.found || !Array.isArray(currentLyricsData.lines) || currentLyricsData.lines.length === 0) {
        setLyricsPanelsFadeState(false, false, false);
        return;
    }

    const lines = currentLyricsData.lines;
    const rawTime = Number(currentTimeSec) || 0;
    // Delay lyrics by getEffectiveLyricDelaySec() (2.0s slower by default + user fine-tune)
    const t = Math.max(0, rawTime - getEffectiveLyricDelaySec());

    // Determine if all lyrics have finished playing (fade out smoothly after the last lyric line finishes)
    const lastLineTime = Number(lines[lines.length - 1]?.time) || 0;
    const lastLineHoldSec = 6.0;
    const isLyricsEnded = (t > lastLineTime + lastLineHoldSec) || (state.duration > 20 && rawTime >= state.duration - 1.5);

    const canShowOnScreen = Boolean(state.currentVideo) && !isLyricsEnded;
    const shouldShowOverlay = canShowOnScreen && lyricsVisible && !overlayDismissedForTrack;
    setLyricsPanelsFadeState(shouldShowOverlay, shouldShowOverlay, canShowOnScreen);

    if (isLyricsEnded) {
        if (lyricsCountdownPill) lyricsCountdownPill.classList.add('hidden');
        if (inlineLyricsCountdown) inlineLyricsCountdown.classList.add('hidden');
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

    // Update Vocal Entry Countdown badge ("🎤 เตรียมร้องใน 3.. 2.. 1..")
    updateVocalCountdownUI(t, lines, activeIdx);

    // Calculate smooth line progress percentage (0..100%)
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
        // Update Karaoke Left-to-Right Wipe & Progress Bar smoothly at 100ms ticker rate
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

    // 1. Update Smooth Vertical Scrolling Reel on Video Overlay
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

    // 2. Update Inline Lyrics List in Control Sidebar
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

// High-frequency lyric sync ticker (100ms) for smooth karaoke text-wipe progress & exact beat transitions
setInterval(() => {
    if (!state.currentVideo || !state.isPlaying || !currentLyricsData || !currentLyricsData.found) return;
    const preciseTime = getPrecisePlaybackTime();
    updateActiveLyricLine(preciseTime, false, true);
}, 100);

if (btnToggleLyrics) {
    btnToggleLyrics.addEventListener('click', () => toggleLyricsDisplay());
}
if (playerLyricsBtn) {
    playerLyricsBtn.addEventListener('click', () => toggleVideoOverlayLyrics());
}
if (lyricsOverlayClose) {
    lyricsOverlayClose.addEventListener('click', () => toggleVideoOverlayLyrics(false));
}
if (btnKaraokeSwitch) {
    btnKaraokeSwitch.addEventListener('click', () => {
        if (!state.currentVideo) {
            return showToast('กรุณาเปิดเพลงก่อนสลับโหมดคาราโอเกะ', 'error');
        }
        if (karaokeSwitchPending) return;
        karaokeSwitchPending = true;
        if (btnKaraokeLabel) {
            btnKaraokeLabel.textContent = state.currentVideo.isKaraokeMode ? 'กำลังสลับกลับ...' : 'กำลังหาคาราโอเกะ...';
        }
        // Automatically open synced lyrics when entering karaoke mode
        if (!state.currentVideo.isKaraokeMode && !lyricsVisible) {
            toggleLyricsDisplay(true);
        }
        socket.emit('toggle-karaoke-mode');
        setTimeout(() => {
            if (karaokeSwitchPending) updateKaraokeButtonUI();
        }, 6000);
    });
}

// ============================================================================
// FEATURE 2: DJ PARTY SOUNDBOARD (Web Audio Synthesizer + Room-Wide Sync)
// ============================================================================
const soundboardFxBadge = $('soundboard-fx-badge');
const soundboardFxEmoji = $('soundboard-fx-emoji');
const soundboardFxTitle = $('soundboard-fx-title');
const soundboardFxUser = $('soundboard-fx-user');
let soundboardBadgeTimer = null;

const SOUNDBOARD_META = {
    airhorn: { emoji: '📢', title: 'แตรลมปาร์ตี้! (Airhorn)' },
    badumtss: { emoji: '🥁', title: 'ตบมุกผ่าง! (Ba-Dum-Tss)' },
    cheer: { emoji: '👏', title: 'เสียงปรบมือเฮลั่น!' },
    siren: { emoji: '🚨', title: 'ไซเรนสายตี้! (Party Siren)' },
    laser: { emoji: '⚡', title: 'เลเซอร์บีม! (Laser Zap)' },
    cricket: { emoji: '🦗', title: 'จิ้งหรีดร้อง... กริบเลย' }
};

function playDjSoundboardSynthesizer(soundId) {
    try {
        unlockAudioSystem();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!softAudioCtx) softAudioCtx = new AudioCtx();
        if (softAudioCtx.state === 'suspended') {
            softAudioCtx.resume().catch(() => {});
        }

        const ctx = softAudioCtx;
        const now = ctx.currentTime;

        // Briefly duck media volume on Host so the party effect cuts through clearly
        duckHostMediaVolume(1800);

        if (soundId === 'airhorn') {
            // Classic DJ Reggae/Trap Airhorn: 3 blasts (short, short, long) with detuned sawtooth oscillators
            const bursts = [
                { start: 0, dur: 0.14 },
                { start: 0.18, dur: 0.14 },
                { start: 0.36, dur: 0.68 }
            ];
            const freqs = [392, 493.88, 587.33, 783.99];
            bursts.forEach((b) => {
                freqs.forEach((f, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(f * (1 + (idx - 1.5) * 0.008), now + b.start);
                    osc.frequency.linearRampToValueAtTime(f * 1.03, now + b.start + 0.03);
                    gain.gain.setValueAtTime(0.001, now + b.start);
                    gain.gain.linearRampToValueAtTime(0.09, now + b.start + 0.015);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + b.start + b.dur);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + b.start);
                    osc.stop(now + b.start + b.dur + 0.02);
                });
            });
        } else if (soundId === 'badumtss') {
            // 1. "Ba" (High Tom) -> 2. "Dum" (Low Kick/Tom) -> 3. "Tss!" (Metallic Cymbal Noise)
            const playDrumTone = (startOffset, startFreq, endFreq, dur, peakGain) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(startFreq, now + startOffset);
                osc.frequency.exponentialRampToValueAtTime(endFreq, now + startOffset + dur);
                gain.gain.setValueAtTime(peakGain, now + startOffset);
                gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + startOffset);
                osc.stop(now + startOffset + dur + 0.02);
            };
            playDrumTone(0, 195, 75, 0.16, 0.32);
            playDrumTone(0.19, 145, 52, 0.22, 0.36);

            // Cymbal "Tssss" at +0.42s
            const bufferSize = Math.floor(ctx.sampleRate * 0.75);
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            const whiteNoise = ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;
            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(5500, now + 0.42);
            const nGain = ctx.createGain();
            nGain.gain.setValueAtTime(0.24, now + 0.42);
            nGain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
            whiteNoise.connect(highpass);
            highpass.connect(nGain);
            nGain.connect(ctx.destination);
            whiteNoise.start(now + 0.42);
            whiteNoise.stop(now + 1.16);
        } else if (soundId === 'cheer') {
            // Celebratory Fanfare Chord + Crowd Applause Swell
            const chord = [523.25, 659.25, 783.99, 1046.5];
            chord.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                const st = now + idx * 0.055;
                osc.frequency.setValueAtTime(freq, st);
                gain.gain.setValueAtTime(0.001, st);
                gain.gain.linearRampToValueAtTime(0.12, st + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, st + 0.75);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(st);
                osc.stop(st + 0.78);
            });
            // Filtered applause texture
            const bufLen = Math.floor(ctx.sampleRate * 1.1);
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) {
                ch[i] = (Math.random() * 2 - 1) * Math.sin((i / bufLen) * Math.PI);
            }
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(1600, now);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.16, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
            src.connect(bp);
            bp.connect(g);
            g.connect(ctx.destination);
            src.start(now);
            src.stop(now + 1.12);
        } else if (soundId === 'siren') {
            // Sweeping Party Siren (Wee-Ooo-Wee-Ooo)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.linearRampToValueAtTime(980, now + 0.28);
            osc.frequency.linearRampToValueAtTime(520, now + 0.56);
            osc.frequency.linearRampToValueAtTime(1020, now + 0.84);
            osc.frequency.linearRampToValueAtTime(500, now + 1.12);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.16);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 1.18);
        } else if (soundId === 'laser') {
            // 3 rapid Sci-Fi Laser Zaps (Pew-Pew-Pew!)
            [0, 0.16, 0.32].forEach((offset) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(1550, now + offset);
                osc.frequency.exponentialRampToValueAtTime(110, now + offset + 0.14);
                gain.gain.setValueAtTime(0.18, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + offset);
                osc.stop(now + offset + 0.15);
            });
        } else if (soundId === 'cricket') {
            // Awkward Cricket Chirps (2 double-chirp clusters at 4.3kHz)
            const pulses = [0, 0.045, 0.09, 0.48, 0.525, 0.57];
            pulses.forEach((p) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(4350, now + p);
                osc.frequency.linearRampToValueAtTime(4550, now + p + 0.032);
                gain.gain.setValueAtTime(0.001, now + p);
                gain.gain.linearRampToValueAtTime(0.16, now + p + 0.008);
                gain.gain.exponentialRampToValueAtTime(0.001, now + p + 0.035);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + p);
                osc.stop(now + p + 0.038);
            });
        }
    } catch (err) {
        console.warn('Soundboard synth error:', err.message);
    }
}

function showSoundboardVisualBadge(soundId, senderName) {
    const meta = SOUNDBOARD_META[soundId] || SOUNDBOARD_META.airhorn;

    // Floating emoji on video player
    if (playerArea) {
        const el = document.createElement('div');
        el.className = 'float-emoji';
        el.textContent = meta.emoji;
        el.style.left = (Math.random() * 70 + 15) + '%';
        el.style.bottom = '14%';
        playerArea.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }

    if (soundboardFxBadge) {
        if (soundboardFxEmoji) soundboardFxEmoji.textContent = meta.emoji;
        if (soundboardFxTitle) soundboardFxTitle.textContent = meta.title;
        if (soundboardFxUser) soundboardFxUser.textContent = `กดโดย ${senderName || 'DJ ในห้อง'}`;
        soundboardFxBadge.classList.remove('hidden');
        clearTimeout(soundboardBadgeTimer);
        soundboardBadgeTimer = setTimeout(() => {
            soundboardFxBadge.classList.add('hidden');
        }, 2800);
    }
}

document.querySelectorAll('[data-soundboard]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const soundId = btn.getAttribute('data-soundboard');
        if (!soundId) return;
        unlockAudioSystem();
        socket.emit('send-soundboard', {
            soundId,
            nickname: myProfile.name || 'สมาชิก'
        });
    });
});

socket.on('play-soundboard-fx', (payload) => {
    if (!payload || !payload.soundId) return;
    playDjSoundboardSynthesizer(payload.soundId);
    showSoundboardVisualBadge(payload.soundId, payload.senderName);
});

// ============================================================================
// FEATURE 3: ROUTE WEATHER AHEAD (3-Point Forecast Along Entire Route)
// ============================================================================
const routeWeatherAheadCard = $('route-weather-ahead-card');
const routeWeatherSummaryBadge = $('route-weather-summary-badge');
const routeWeatherPointsGrid = $('route-weather-points-grid');
let currentRouteWeatherAhead = null;

async function fetchQuickPointWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=precipitation_probability&timezone=auto&forecast_days=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    const cur = data.current || {};
    let rainProb = 0;
    if (Array.isArray(data.hourly?.precipitation_probability)) {
        let idx = new Date().getHours();
        if (typeof cur.time === 'string' && Array.isArray(data.hourly?.time)) {
            const hourPrefix = cur.time.slice(0, 13);
            const found = data.hourly.time.findIndex(t => typeof t === 'string' && t.startsWith(hourPrefix));
            if (found !== -1) idx = found;
        }
        const probs = data.hourly.precipitation_probability.slice(idx, idx + 3).filter(v => typeof v === 'number');
        if (probs.length > 0) rainProb = Math.max(...probs);
    }
    const code = cur.weather_code ?? 0;
    const decoded = decodeWmoWeather(code);
    const isRainy = decoded.rain || rainProb >= 55;
    const icon = code >= 95 ? '⛈️' : (decoded.rain ? '🌧️' : (rainProb >= 45 ? '🌦️' : (code >= 2 ? '⛅' : '☀️')));
    return {
        temp: Math.round(cur.temperature_2m ?? 30),
        rainProb,
        code,
        text: decoded.text,
        icon,
        isRainy
    };
}

function renderRouteWeatherAheadUI(routeWeather) {
    if (!routeWeather || !Array.isArray(routeWeather.points) || !routeWeatherAheadCard || !routeWeatherPointsGrid) return;
    currentRouteWeatherAhead = routeWeather;
    routeWeatherAheadCard.classList.remove('hidden');

    if (routeWeatherSummaryBadge) {
        if (routeWeather.hasRainAhead) {
            routeWeatherSummaryBadge.textContent = routeWeather.summary || '⚠️ มีโอกาสเจอฝนระหว่างทาง';
            routeWeatherSummaryBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 font-semibold animate-pulse';
        } else {
            routeWeatherSummaryBadge.textContent = routeWeather.summary || '✅ ตลอดสายอากาศปลอดโปร่ง';
            routeWeatherSummaryBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/30 font-medium';
        }
    }

    routeWeatherPointsGrid.innerHTML = routeWeather.points.map((pt) => {
        const borderCls = pt.isRainy
            ? 'border-amber-400/50 bg-amber-950/30'
            : 'border-brand-deep/50 bg-black/40';
        const probCls = pt.rainProb >= 55 ? 'text-amber-300 font-bold' : 'text-sky-300';
        return `
            <div class="rounded-lg border ${borderCls} px-2 py-1.5 flex flex-col justify-between">
                <div class="flex items-center justify-between gap-1">
                    <span class="text-[9px] text-brand-light/70 font-medium truncate">${escapeHtml(pt.label)}</span>
                    <span class="text-xs">${pt.icon || '⛅'}</span>
                </div>
                <div class="flex items-baseline justify-between mt-0.5">
                    <span class="text-xs font-bold text-white">${pt.temp}°C</span>
                    <span class="text-[9px] ${probCls}">ฝน ${pt.rainProb}%</span>
                </div>
            </div>
        `;
    }).join('');
}

async function analyzeRouteWeatherAhead(routeGeometry, startLat, startLon, destLat, destLon, destName) {
    try {
        const coords = Array.isArray(routeGeometry?.coordinates) ? routeGeometry.coordinates : [];
        let midLat = (startLat + destLat) / 2;
        let midLon = (startLon + destLon) / 2;
        if (coords.length >= 3) {
            const midCoord = coords[Math.floor(coords.length / 2)];
            if (Array.isArray(midCoord) && midCoord.length >= 2) {
                midLon = midCoord[0];
                midLat = midCoord[1];
            }
        }

        const [wStart, wMid, wDest] = await Promise.all([
            fetchQuickPointWeather(startLat, startLon),
            fetchQuickPointWeather(midLat, midLon),
            fetchQuickPointWeather(destLat, destLon)
        ]);

        const points = [
            { label: '📍 ต้นทาง', pct: 0, ...wStart },
            { label: '🛣️ กลางทาง', pct: 50, ...wMid },
            { label: '🏁 ปลายทาง', pct: 100, ...wDest }
        ];

        const rainyPoints = points.filter(p => p.isRainy);
        const hasRainAhead = rainyPoints.length > 0;
        const maxRainProb = Math.max(...points.map(p => p.rainProb || 0));
        const summary = hasRainAhead
            ? `⚠️ โอกาสฝนสูงสุด ${maxRainProb}% (${rainyPoints.map(p => p.label.replace(/^[^\s]+\s/, '')).join('/')})`
            : `✅ อากาศดีตลอดสาย (โอกาสฝนสูงสุด ${maxRainProb}%)`;

        const payload = {
            points,
            hasRainAhead,
            maxRainProb,
            summary
        };

        renderRouteWeatherAheadUI(payload);
        emitNavStatePatch({ routeWeatherAhead: payload });

        if (hasRainAhead) {
            const rainyLabels = rainyPoints.map(p => p.label.replace(/^[^\s]+\s/, '')).join(' และ');
            const voiceText = `พยากรณ์อากาศล่วงหน้าตามเส้นทางไป ${destName || 'จุดหมาย'} พบโอกาสเกิดฝนบริเวณ ${rainyLabels} สูงสุด ${maxRainProb} เปอร์เซ็นต์ โปรดขับขี่ด้วยความระมัดระวัง`;
            showToast(`🌧️ พยากรณ์ตลอดเส้นทาง: ${summary}`, 'info');
            socket.emit('trigger-nav-alert', {
                type: 'route-weather-warning',
                summary,
                routeWeatherAhead: payload,
                voiceText
            });
        }
    } catch (err) {
        console.warn('Route weather ahead analysis failed:', err.message);
    }
}


