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
    quality: 'max'
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

// --- Intro Animation ---
setTimeout(() => {
    if (!myProfile.name) {
        showLogin();
    } else {
        updateProfileUI();
        socket.emit('set-profile', myProfile);
    }
}, 3500);

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

editProfileBtn.addEventListener('click', showLogin);

function updateProfileUI() {
    myColorDot.style.backgroundColor = myProfile.color;
}

// --- YouTube API & Direct Video Stream Bypass (1080p Full HD) ---
let ytPlayer = null;
let playerReady = false;
let directVideoMode = false;
let directVideoId = null;
let directHasSeparateAudio = false;
let directQualityLabel = '1080p HD';
let directAppliedQuality = null;
let activePlayerVideoId = null;

function playNativeVideoSafely() {
    if (!nativeVideo) return;
    if (directHasSeparateAudio && nativeAudio) {
        nativeVideo.muted = true;
        nativeVideo.play().catch(() => {});
        const audioPromise = nativeAudio.play();
        if (audioPromise && typeof audioPromise.catch === 'function') {
            audioPromise.catch(() => {
                nativeAudio.muted = true;
                if (unmuteBtn) unmuteBtn.classList.remove('hidden');
                nativeAudio.play().catch(() => {});
            });
        }
    } else {
        const playPromise = nativeVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                nativeVideo.muted = true;
                if (unmuteBtn) unmuteBtn.classList.remove('hidden');
                nativeVideo.play().catch(() => {});
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
    const ytEl = $('yt-player');
    if (ytEl) ytEl.classList.remove('hidden');
    if (directVideoLoading) directVideoLoading.classList.add('hidden');
    if (nativeVideo) {
        nativeVideo.pause();
        nativeVideo.removeAttribute('src');
        nativeVideo.load();
        nativeVideo.classList.add('hidden');
    }
    if (nativeAudio) {
        nativeAudio.pause();
        nativeAudio.removeAttribute('src');
        nativeAudio.load();
    }
}

async function startDirectVideoStream(videoId, forceReload = false, resumeTime = 0) {
    if (!hostMode || !nativeVideo || !videoId) return;
    const targetQuality = state.quality || 'max';
    if (!forceReload && directVideoMode && directVideoId === videoId && directAppliedQuality === targetQuality) return;

    directVideoMode = true;
    directVideoId = videoId;
    directAppliedQuality = targetQuality;

    if (ytPlayer && ytPlayer.stopVideo) {
        try { ytPlayer.stopVideo(); } catch (e) {}
    }
    const ytEl = $('yt-player');
    if (ytEl) ytEl.classList.add('hidden');

    if (directVideoLoading) directVideoLoading.classList.remove('hidden');
    nativeVideo.classList.remove('hidden');
    if (playerQualityBadge) playerQualityBadge.textContent = '1080p HD';

    if (!forceReload) {
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

        const vol = Math.max(0, Math.min(1, (state.volume ?? 50) / 100));
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
        if (state.currentVideo && state.currentVideo.videoId === videoId) {
            showToast('ไม่สามารถดึงวิดีโอตรงได้ กำลังค้นหาคลิปสำรองให้อัตโนมัติ...', 'info');
            socket.emit('resolve-error-action', 'find-alt');
        }
    }
}

if (nativeVideo) {
    nativeVideo.addEventListener('loadeddata', () => {
        if (!directVideoMode) return;
        if (directVideoLoading) directVideoLoading.classList.add('hidden');
        if (state.isPlaying && nativeVideo.paused) {
            playNativeVideoSafely();
        }
    });

    nativeVideo.addEventListener('waiting', () => {
        if (!directVideoMode || !directHasSeparateAudio || !nativeAudio) return;
        if (!nativeAudio.paused) nativeAudio.pause();
    });

    nativeVideo.addEventListener('playing', () => {
        if (!directVideoMode) return;
        if (directVideoLoading) directVideoLoading.classList.add('hidden');
        if (directHasSeparateAudio && nativeAudio && state.isPlaying) {
            if (Math.abs((nativeVideo.currentTime || 0) - (nativeAudio.currentTime || 0)) > 0.25) {
                nativeAudio.currentTime = nativeVideo.currentTime || 0;
            }
            if (nativeAudio.paused) nativeAudio.play().catch(() => {});
        }
        const isMutedNow = directHasSeparateAudio ? (nativeAudio && nativeAudio.muted) : nativeVideo.muted;
        if (isMutedNow && unmuteBtn) {
            unmuteBtn.classList.remove('hidden');
        } else if (unmuteBtn) {
            unmuteBtn.classList.add('hidden');
        }
    });

    nativeVideo.addEventListener('ended', () => {
        if (hostMode && directVideoMode) {
            pauseNativeMedia();
            socket.emit('player-video-ended');
        }
    });

    nativeVideo.addEventListener('error', () => {
        if (!hostMode || !directVideoMode) return;
        const failedId = directVideoId;
        stopDirectVideoStream();
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
            'playsinline': 1,
            'enablejsapi': 1,
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
    if (hostMode && state.currentVideo && state.currentVideo.videoId) {
        startDirectVideoStream(state.currentVideo.videoId);
    } else {
        socket.emit('resolve-error-action', 'find-alt');
    }
}

function enforceQuality() {
    if (directVideoMode) {
        const targetQuality = state.quality || 'max';
        if (directVideoId && directAppliedQuality && directAppliedQuality !== targetQuality) {
            const currTime = nativeVideo ? (nativeVideo.currentTime || 0) : 0;
            startDirectVideoStream(directVideoId, true, currTime);
        }
        if (playerQualityBadge) playerQualityBadge.textContent = directQualityLabel;
        return;
    }
    if (!hostMode || !ytPlayer || !ytPlayer.getAvailableQualityLevels || !ytPlayer.setPlaybackQuality) return;
    const target = state.quality || 'max';
    const available = ytPlayer.getAvailableQualityLevels();
    
    let selectedQuality = target;
    if (target === 'max') {
        const priority = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium'];
        selectedQuality = priority.find(q => available.includes(q)) || available[0] || 'hd1080';
    }

    if (selectedQuality && selectedQuality !== 'auto') {
        ytPlayer.setPlaybackQuality(selectedQuality);
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
        enforceQuality();
        setTimeout(enforceQuality, 1200);
    }
    if (event.data === YT.PlayerState.ENDED) {
        socket.emit('player-video-ended');
    }
    // Check if autoplay muted it
    if (ytPlayer && ytPlayer.isMuted && ytPlayer.isMuted() && unmuteBtn) {
        unmuteBtn.classList.remove('hidden');
    } else if (unmuteBtn) {
        unmuteBtn.classList.add('hidden');
    }
}

if (unmuteBtn) {
    unmuteBtn.addEventListener('click', () => {
        if (directVideoMode) {
            if (directHasSeparateAudio && nativeAudio) {
                nativeAudio.muted = false;
                nativeAudio.play().catch(() => {});
            } else if (nativeVideo) {
                nativeVideo.muted = false;
                nativeVideo.play().catch(() => {});
            }
            unmuteBtn.classList.add('hidden');
            return;
        }
        if (ytPlayer && ytPlayer.unMute) {
            ytPlayer.unMute();
            ytPlayer.playVideo();
            unmuteBtn.classList.add('hidden');
        }
    });
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
    if (hostMode) {
        // Host mode
        document.body.classList.remove('client-mode');
        hostBadge.classList.remove('hidden');
        clientControls.classList.add('hidden');
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
    return '<i class="fa-brands fa-youtube text-red-500 mr-1" title="จาก YouTube"></i>';
}

let lastRenderedVideoId = null;
let lastQueueSignature = null;
let knownQueueIds = new Set();

function renderState() {
    // Current Video + Now Playing Thumbnail & Ambient Glow
    const currentId = state.currentVideo ? `${state.currentVideo.videoId}:${state.currentVideo.thumbnail || ''}` : null;

    if (state.currentVideo) {
        nowTitle.textContent = state.currentVideo.title;
        const authorPrefix = state.currentVideo.author ? `${escapeHtml(state.currentVideo.author)} • ` : '';
        nowAuthor.innerHTML = `${getSourceIconHtml(state.currentVideo)}${authorPrefix}เพิ่มโดย: <span style="color:${safeColor(state.currentVideo.color)}" class="font-medium">${escapeHtml(state.currentVideo.addedBy)}</span>`;

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

    // Play/Pause icon
    iconPlay.className = state.isPlaying ? "fa-solid fa-pause text-lg text-brand-peri" : "fa-solid fa-play text-lg text-brand-peri";

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

    const currentSignature = state.queue.map(i => `${i.id}:${i.videoId}:${i.title}`).join('|');
    if (currentSignature !== lastQueueSignature) {
        if (state.queue.length === 0) {
            queueList.innerHTML = `<p class="text-center text-[10px] text-brand-light/30 py-4 animate-fade-in-up">คิวว่างเปล่า</p>`;
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

    applyHostModeState();
}

// Queue delegation for delete buttons with smooth fade-out animation
queueList.addEventListener('click', (e) => {
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
        stopDirectVideoStream();
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        return;
    }

    const videoId = state.currentVideo.videoId;

    if (!hostMode) return;

    if (videoId !== activePlayerVideoId) {
        activePlayerVideoId = videoId;
        stopDirectVideoStream();
    }

    if (directVideoMode && nativeVideo) {
        const vol = Math.max(0, Math.min(1, (state.volume ?? 50) / 100));
        if (directHasSeparateAudio && nativeAudio) {
            nativeAudio.volume = vol;
        } else {
            nativeVideo.volume = vol;
        }
        if (state.isPlaying) {
            if (nativeVideo.paused || (directHasSeparateAudio && nativeAudio && nativeAudio.paused)) {
                playNativeVideoSafely();
            }
        } else {
            pauseNativeMedia();
        }
        return;
    }

    if (!playerReady || !ytPlayer || !ytPlayer.loadVideoById) return;

    let currentUrl = ytPlayer.getVideoUrl ? ytPlayer.getVideoUrl() : '';
    if (!currentUrl || !currentUrl.includes(videoId)) {
        ytPlayer.loadVideoById(videoId);
    }
    
    if (state.isPlaying) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
    
    ytPlayer.setVolume(state.volume);
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
    skipLabel.className = "text-[9px] mt-0.5";
    btnSkip.className = "flex-1 bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 text-red-400 rounded-lg py-2 flex flex-col items-center transition relative overflow-hidden";
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
    if (hostMode && data.tts && 'speechSynthesis' in window) {
        const textToSpeak = (data.text || '').substring(0, 60);
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'th-TH';
        const voices = window.speechSynthesis.getVoices();
        const googleVoice = voices.find(v => v.name.toLowerCase().includes('google') && v.lang.includes('th'));
        if (googleVoice) utterance.voice = googleVoice;
        window.speechSynthesis.speak(utterance);
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
