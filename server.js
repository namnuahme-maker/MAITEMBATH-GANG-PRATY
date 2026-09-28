const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');
const { Innertube, Log } = require('youtubei.js');

if (Log && typeof Log.setLevel === 'function' && Log.Level) {
  Log.setLevel(Log.Level.NONE);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_ALT_RETRIES = 10;
let isFindingAlt = false;

// Cache for direct video stream URLs (cacheKey -> { videoUrl, audioUrl, qualityLabel, expiresAt })
const streamUrlCache = new Map();
const pendingExtractions = new Map();

function getQualityHeight(quality) {
  if (quality === 'hd720') return { height: 720, label: '720p HD' };
  if (quality === 'large') return { height: 480, label: '480p' };
  if (quality === 'medium') return { height: 360, label: '360p' };
  return { height: 1080, label: '1080p HD' };
}

function runYtDlpGetUrls(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: 25000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr?.trim() || err.message));
      }
      const lines = (stdout || '').trim().split(/\r?\n/).map(l => l.trim()).filter(l => /^https?:\/\//i.test(l));
      if (lines.length === 0) {
        return reject(new Error('No stream URL returned by yt-dlp'));
      }
      resolve(lines);
    });
  });
}

async function resolveDirectStreamInfo(videoId, quality = 'max') {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error('Invalid videoId');
  }

  const { height, label } = getQualityHeight(quality);
  const cacheKey = `${videoId}:${height}`;

  const cached = streamUrlCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  if (pendingExtractions.has(cacheKey)) {
    return pendingExtractions.get(cacheKey);
  }

  const extractPromise = (async () => {
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const formatSelector = height <= 360
      ? '18/best[ext=mp4][acodec!=none][vcodec!=none]/best'
      : `bestvideo[height<=${height}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/18/best`;

    const argSets = [
      [
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--extractor-args', 'youtube:player_client=mweb,web;player_skip=webpage,configs;formats=missing_pot',
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', formatSelector,
        targetUrl
      ],
      [
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--extractor-args', 'youtube:player_client=default;player_skip=webpage',
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', 'best[ext=mp4][acodec!=none][vcodec!=none]/18/best',
        targetUrl
      ]
    ];

    let lastErr = null;
    for (const args of argSets) {
      try {
        const urls = await runYtDlpGetUrls(args);
        if (urls && urls.length > 0) {
          const info = {
            videoUrl: urls[0],
            audioUrl: urls.length > 1 ? urls[1] : null,
            qualityLabel: urls.length > 1 ? label : '360p',
            expiresAt: Date.now() + 2 * 60 * 60 * 1000 // cache 2 hours
          };
          streamUrlCache.set(cacheKey, info);
          return info;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Failed to extract direct video stream');
  })();

  pendingExtractions.set(cacheKey, extractPromise);
  try {
    return await extractPromise;
  } finally {
    pendingExtractions.delete(cacheKey);
  }
}

function prefetchVideoStreamUrl(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
  resolveDirectStreamInfo(videoId, state.quality || 'max').catch(() => {});
}

function proxyVideoStream(streamUrl, req, res, cacheKey, redirectsLeft = 5) {
  if (redirectsLeft <= 0) {
    if (!res.headersSent) res.status(502).end('Too many redirects');
    return;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const client = streamUrl.startsWith('http:') ? http : https;
  const upstreamReq = client.get(streamUrl, { headers }, (upstreamRes) => {
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
      upstreamRes.resume();
      const nextUrl = new URL(upstreamRes.headers.location, streamUrl).toString();
      return proxyVideoStream(nextUrl, req, res, cacheKey, redirectsLeft - 1);
    }

    if (upstreamRes.statusCode === 403 || upstreamRes.statusCode === 410) {
      streamUrlCache.delete(cacheKey);
    }

    if (!res.headersSent) {
      const forwardHeaders = {
        'Content-Type': upstreamRes.headers['content-type'] || 'video/mp4',
        'Accept-Ranges': upstreamRes.headers['accept-ranges'] || 'bytes',
        'Cache-Control': 'no-cache'
      };
      if (upstreamRes.headers['content-length']) {
        forwardHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      }
      if (upstreamRes.headers['content-range']) {
        forwardHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      }
      res.writeHead(upstreamRes.statusCode || 200, forwardHeaders);
    }

    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    console.error(`Direct stream proxy error (${cacheKey}):`, err.message);
    if (!res.headersSent) {
      res.status(502).end('Stream proxy error');
    } else {
      res.end();
    }
  });

  req.on('close', () => {
    upstreamReq.destroy();
  });
}

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Direct Video Info endpoint (returns whether 1080p/720p split video+audio is used)
app.get('/api/video-info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality = req.query.quality || state.quality || 'max';
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }
  try {
    const info = await resolveDirectStreamInfo(videoId, quality);
    res.json({
      hasSeparateAudio: Boolean(info.audioUrl),
      qualityLabel: info.qualityLabel
    });
  } catch (err) {
    console.error(`Failed to resolve direct stream info for ${videoId}:`, err.message);
    res.status(500).json({ error: 'Unable to extract direct video stream' });
  }
});

// Direct Video Stream endpoint to bypass YouTube Embed restrictions (Error 101 / 150)
app.get('/api/video-stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality = req.query.quality || state.quality || 'max';
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).send('Invalid video ID');
  }
  try {
    const { height } = getQualityHeight(quality);
    const info = await resolveDirectStreamInfo(videoId, quality);
    proxyVideoStream(info.videoUrl, req, res, `${videoId}:${height}`);
  } catch (err) {
    console.error(`Failed to resolve direct video stream for ${videoId}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Unable to extract direct video stream');
    }
  }
});

// Direct Audio Stream endpoint for 1080p/720p split HD playback
app.get('/api/audio-stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality = req.query.quality || state.quality || 'max';
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).send('Invalid video ID');
  }
  try {
    const { height } = getQualityHeight(quality);
    const info = await resolveDirectStreamInfo(videoId, quality);
    proxyVideoStream(info.audioUrl || info.videoUrl, req, res, `${videoId}:${height}`);
  } catch (err) {
    console.error(`Failed to resolve direct audio stream for ${videoId}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Unable to extract direct audio stream');
    }
  }
});

// Innertube instance for search & YouTube metadata
let innertube = null;
async function getInnertube() {
  if (!innertube) {
    innertube = await Innertube.create();
  }
  return innertube;
}

// Collaborative Player State
let state = {
  queue: [],
  currentVideo: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 50,
  quality: 'max'
};

let connectedUsers = {}; // { socketId: { name, color } }
const clientRateLimits = new Map(); // socket.id -> { lastDanmaku: timestamp, lastReaction: timestamp }

// Helper: Get local network IP address (prioritizing physical Wi-Fi/Ethernet)
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const physicalCandidates = [];
  const otherCandidates = [];

  for (const devName in interfaces) {
    const isVirtual = /vEthernet|wsl|virtual|vmware|vbox|docker|loopback/i.test(devName);
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        if (!isVirtual) {
          if (/wi-fi|wifi|ethernet|lan/i.test(devName)) {
            return alias.address;
          }
          physicalCandidates.push(alias.address);
        } else {
          otherCandidates.push(alias.address);
        }
      }
    }
  }
  return physicalCandidates[0] || otherCandidates[0] || 'localhost';
}

// Helper: Parse YouTube URL to extract 11-character video ID (supports standard, shorts, live, embed, youtu.be)
function getYoutubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const regExp = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

// Helper: Parse Spotify URL or URI (supports track, album, playlist, intl-xx, spotify.link)
async function parseSpotifyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let trimmed = rawUrl.trim();

  // Resolve short links (spotify.link / spoti.fi)
  if (/^https?:\/\/(?:spotify\.link|spoti\.fi)\//i.test(trimmed)) {
    try {
      const resp = await fetch(trimmed, {
         redirect: 'follow',
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (resp && resp.url) trimmed = resp.url;
    } catch (e) {
      // ignore redirect error and try regex
    }
  }

  // Match spotify:track:ID
  const uriMatch = trimmed.match(/^spotify:(track|album|playlist):([a-zA-Z0-9]{22})/i);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }

  // Match https://open.spotify.com/(intl-xx/)?(embed/)?(track|album|playlist)/ID
  const urlMatch = trimmed.match(/(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})/i);
  if (urlMatch) {
    return { type: urlMatch[1].toLowerCase(), id: urlMatch[2] };
  }

  return null;
}

// Helper: Fetch Spotify Metadata (Track, Album, or Playlist) without API Key via Embed & oEmbed
async function getSpotifyMetadata(type, id) {
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
  try {
    const resp = await fetch(embedUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    const html = await resp.text();
    const idx = html.indexOf('__NEXT_DATA__');
    if (idx !== -1) {
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      const json = JSON.parse(html.slice(start, end));
      const entity = json?.props?.pageProps?.state?.data?.entity;

      if (entity) {
        const cover = entity.visualIdentity?.image?.[0]?.url || null;

        if (type === 'track') {
          const title = (entity.title || entity.name || '').trim();
          const artist = Array.isArray(entity.artists)
            ? entity.artists.map(a => a.name).filter(Boolean).join(', ')
            : (entity.subtitle || 'Spotify').replace(/\u00a0/g, ' ').trim();

          if (title) {
            return {
              type: 'track',
              collectionTitle: title,
              tracks: [{ title, artist: artist || 'Spotify', thumbnail: cover }]
            };
          }
        } else if ((type === 'album' || type === 'playlist') && Array.isArray(entity.trackList)) {
          const collectionTitle = (entity.name || entity.title || 'Spotify Playlist').trim();
          const tracks = entity.trackList.slice(0, 10).map(t => ({
            title: (t.title || '').trim(),
            artist: (t.subtitle || '').replace(/\u00a0/g, ' ').trim() || 'Spotify',
            thumbnail: cover
          })).filter(t => t.title);

          if (tracks.length > 0) {
            return {
              type,
              collectionTitle,
              tracks
            };
          }
        }
      }
    }
  } catch (err) {
    console.error('Spotify embed parse error:', err.message);
  }

  // Fallback to Spotify oEmbed API
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${type}/${id}`)}`;
    const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    if (data && data.title) {
      return {
        type: 'track',
        collectionTitle: data.title,
        tracks: [{
          title: data.title,
          artist: 'Spotify',
          thumbnail: data.thumbnail_url || null
        }]
      };
    }
  } catch (err) {
    console.error('Spotify oEmbed fallback error:', err.message);
  }

  return null;
}

// Helper: Search YouTube via Innertube to find playable videoId for a Spotify track
async function findYoutubeMatchForTrack(title, artist) {
  const yt = await getInnertube();
  const query = artist && artist !== 'Spotify' ? `${title} - ${artist}` : title;
  const search = await yt.search(query);
  const video = search.videos.find(v => v.id && v.id.length === 11);
  if (!video) return null;
  return {
    videoId: video.id,
    ytTitle: video.title?.text || video.title?.runs?.[0]?.text || title,
    ytAuthor: video.author?.name || artist || 'YouTube'
  };
}

// Helper: Fetch YouTube title using noembed API with 4s timeout fallback
function getYoutubeMetadata(videoId) {
  return new Promise((resolve) => {
    const req = https.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            title: json.title || `YouTube Video (${videoId})`,
            author: json.author_name || 'YouTube'
          });
        } catch (e) {
          resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
        }
      });
    });

    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
    });

    req.on('error', () => {
      resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
    });
  });
}

function playNext() {
  if (state.queue.length > 0) {
    state.currentVideo = state.queue.shift();
    state.isPlaying = true;
    state.currentTime = 0;
    state.duration = 0;
    prefetchVideoStreamUrl(state.currentVideo.videoId);
  } else {
    state.currentVideo = null;
    state.isPlaying = false;
    state.currentTime = 0;
    state.duration = 0;
  }
  broadcastState();
}

function broadcastState() {
  io.emit('state-update', state);
}

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.emit('init', {
    state: state,
    localIp: getLocalIp(),
    port: PORT,
    users: connectedUsers
  });

  socket.on('set-profile', (data) => {
    if (!data || typeof data !== 'object') return;
    const name = typeof data.name === 'string' ? data.name.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
    const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';
    connectedUsers[socket.id] = { name: name || 'ผู้ใช้ทั่วไป', color };
    io.emit('users-update', connectedUsers);
  });

  socket.on('add-to-queue', async (data) => {
    if (!data || typeof data !== 'object' || !data.url) {
      return socket.emit('error-msg', 'กรุณาระบุลิงก์เพลง YouTube หรือ Spotify');
    }

    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
    const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';

    // 1. Check if it's a Spotify URL/URI
    const spotifyRef = await parseSpotifyUrl(data.url);
    if (spotifyRef) {
      socket.emit('add-queue-status', { loading: true, message: 'กำลังดึงข้อมูลเพลงจาก Spotify...' });
      try {
        const spData = await getSpotifyMetadata(spotifyRef.type, spotifyRef.id);
        if (!spData || !spData.tracks || spData.tracks.length === 0) {
          socket.emit('add-queue-status', { loading: false });
          return socket.emit('error-msg', 'ไม่พบข้อมูลเพลงจากลิงก์ Spotify นี้');
        }

        if (spData.tracks.length > 1) {
          socket.emit('show-toast-broadcast', `กำลังนำเข้า ${spData.tracks.length} เพลงจาก Spotify (${spData.collectionTitle})...`);
        }

        let addedCount = 0;
        for (const track of spData.tracks) {
          try {
            const match = await findYoutubeMatchForTrack(track.title, track.artist);
            if (!match) continue;

            const displayTitle = track.artist && track.artist !== 'Spotify'
              ? `${track.title} - ${track.artist}`
              : track.title;

            state.queue.push({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
              url: `https://www.youtube.com/watch?v=${match.videoId}`,
              videoId: match.videoId,
              title: displayTitle,
              author: track.artist || match.ytAuthor || 'Spotify',
              thumbnail: track.thumbnail || null,
              source: 'spotify',
              addedBy: nickname || 'ผู้ใช้ทั่วไป',
              color: color,
              addedBySocketId: socket.id
            });
            addedCount++;

            if (!state.currentVideo) playNext();
            else broadcastState();
          } catch (trackErr) {
            console.error('Error matching Spotify track:', trackErr.message);
          }
        }

        socket.emit('add-queue-status', { loading: false });
        if (addedCount === 0) {
          return socket.emit('error-msg', 'ไม่สามารถจับคู่เพลงจาก Spotify บนระบบเล่นได้');
        }
        if (addedCount === 1) {
          const first = spData.tracks[0];
          socket.emit('show-toast-broadcast', `เพิ่มเพลงจาก Spotify: ${first.title}`);
        } else {
          socket.emit('show-toast-broadcast', `นำเข้าสำเร็จ ${addedCount} เพลงจาก Spotify!`);
        }
        return;
      } catch (err) {
        console.error('Spotify add-to-queue error:', err.message);
        socket.emit('add-queue-status', { loading: false });
        return socket.emit('error-msg', 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Spotify');
      }
    }

    // 2. Otherwise parse as YouTube URL
    const videoId = getYoutubeId(data.url);
    if (!videoId) {
      return socket.emit('error-msg', 'ลิงก์ไม่ถูกต้อง (รองรับลิงก์ YouTube ปกติ, Shorts, Live และลิงก์ Spotify Track/Album/Playlist)');
    }

    socket.emit('add-queue-status', { loading: true });
    try {
      const meta = await getYoutubeMetadata(videoId);

      state.queue.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId: videoId,
        title: meta.title,
        author: meta.author,
        thumbnail: null,
        source: 'youtube',
        addedBy: nickname || 'ผู้ใช้ทั่วไป',
        color: color,
        addedBySocketId: socket.id
      });

      socket.emit('add-queue-status', { loading: false });
      if (!state.currentVideo) playNext();
      else broadcastState();
    } catch (err) {
      socket.emit('add-queue-status', { loading: false });
      socket.emit('error-msg', 'ไม่สามารถดึงข้อมูลวิดีโอได้');
    }
  });

  socket.on('play-control', (isPlaying) => {
    if (state.currentVideo && typeof isPlaying === 'boolean') {
      state.isPlaying = isPlaying;
      broadcastState();
    }
  });

  socket.on('volume-control', (vol) => {
    if (typeof vol === 'number' && !isNaN(vol)) {
      state.volume = Math.max(0, Math.min(100, Math.round(vol)));
      broadcastState();
    }
  });

  socket.on('quality-control', (qual) => {
    if (typeof qual === 'string') {
      state.quality = qual;
      broadcastState();
    }
  });

  socket.on('skip-video', () => playNext());

  socket.on('remove-from-queue', (itemId) => {
    if (typeof itemId !== 'string') return;
    state.queue = state.queue.filter(item => item.id !== itemId);
    broadcastState();
  });

  socket.on('clear-queue', () => {
    state.queue = [];
    broadcastState();
  });

  socket.on('player-progress', (data) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.currentTime === 'number' && !isNaN(data.currentTime)) {
      state.currentTime = data.currentTime;
    }
    if (typeof data.duration === 'number' && !isNaN(data.duration) && data.duration > 0) {
      state.duration = data.duration;
    }
    socket.broadcast.volatile.emit('time-update', {
      currentTime: state.currentTime,
      duration: state.duration
    });
  });

  socket.on('player-video-ended', () => playNext());

  socket.on('seek-to', (seconds) => {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return;
    state.currentTime = seconds;
    io.emit('seek-video', seconds);
  });

  // Embed Error Handlers & Interactive Choice
  socket.on('playback-error', (data) => {
    if (!data || !state.currentVideo) return;
    io.emit('show-error-prompt', {
      videoId: state.currentVideo.videoId,
      title: state.currentVideo.title,
      errorCode: data.errorCode || 150
    });
  });

  socket.on('resolve-error-action', async (action) => {
    io.emit('close-error-prompt');

    if (action === 'find-alt') {
      if (!state.currentVideo || isFindingAlt) return;

      const currentRetryCount = state.currentVideo.retryCount || 0;
      if (currentRetryCount >= MAX_ALT_RETRIES) {
        console.warn(`Max retries (${MAX_ALT_RETRIES}) reached for: ${state.currentVideo.title}. Skipping to next track.`);
        io.emit('show-toast-broadcast', `ลองหาคลิปสำรองครบ ${MAX_ALT_RETRIES} ครั้งแล้ว ข้ามไปเพลงถัดไป...`);
        playNext();
        return;
      }

      isFindingAlt = true;
      const targetItemId = state.currentVideo.id;
      const originalTitle = state.currentVideo.originalTitle || state.currentVideo.title;
      const baseAddedBy = state.currentVideo.baseAddedBy || state.currentVideo.addedBy;
      const currentId = state.currentVideo.videoId;
      const triedSet = new Set(Array.isArray(state.currentVideo.triedVideoIds) ? state.currentVideo.triedVideoIds : []);
      if (currentId) triedSet.add(currentId);
      const nextRetryCount = currentRetryCount + 1;

      try {
        const yt = await getInnertube();
        // Clean query from noisy brackets and special symbols
        const cleanTitle = originalTitle.replace(/[\(\[\{【『].*?[\)\]\}】』]/g, ' ').replace(/\s+/g, ' ').trim();
        const baseQuery = cleanTitle || originalTitle;
        const suffixVariants = ['', ' Official Audio', ' Lyrics', ' Topic', ' Audio'];
        const suffix = suffixVariants[Math.min(Math.floor((nextRetryCount - 1) / 3), suffixVariants.length - 1)];
        const query = `${baseQuery}${suffix}`.trim();

        console.log(`[Retry ${nextRetryCount}/${MAX_ALT_RETRIES}] Searching alternative for: "${query}" (Skipping ${triedSet.size} tried IDs)`);
        const search = await yt.search(query);

        // Ensure currentVideo wasn't skipped or cleared while awaiting search
        if (!state.currentVideo || state.currentVideo.id !== targetItemId) {
          return;
        }

        const videos = Array.isArray(search?.videos) ? search.videos : [];
        const alt = videos.find(v => v && typeof v.id === 'string' && v.id.length === 11 && !triedSet.has(v.id));

        if (alt) {
          triedSet.add(alt.id);
          const altTitle = alt.title?.text || alt.title?.runs?.[0]?.text || originalTitle;
          console.log(`[Retry ${nextRetryCount}/${MAX_ALT_RETRIES}] Found alternative: ${alt.id} - ${altTitle}`);

          state.currentVideo = {
            ...state.currentVideo,
            id: targetItemId,
            url: `https://www.youtube.com/watch?v=${alt.id}`,
            videoId: alt.id,
            title: altTitle,
            originalTitle: originalTitle,
            author: alt.author?.name || state.currentVideo.author || 'YouTube',
            baseAddedBy: baseAddedBy,
            addedBy: `${baseAddedBy} (สำรอง ${nextRetryCount}/${MAX_ALT_RETRIES})`,
            retryCount: nextRetryCount,
            triedVideoIds: Array.from(triedSet)
          };
          state.isPlaying = true;
          state.currentTime = 0;
          state.duration = 0;
          broadcastState();
          io.emit('show-toast-broadcast', `สลับไปเล่นคลิปสำรอง (${nextRetryCount}/${MAX_ALT_RETRIES}): ${state.currentVideo.title}`);
        } else {
          socket.emit('error-msg', 'ไม่พบคลิปสำรองเพิ่มเติมสำหรับเพลงนี้ ข้ามไปเพลงถัดไป');
          playNext();
        }
      } catch (err) {
        console.error('Find alternative error:', err.message);
        if (state.currentVideo && state.currentVideo.id === targetItemId) {
          playNext();
        }
      } finally {
        isFindingAlt = false;
      }
    } else if (action === 'skip') {
      playNext();
    }
  });

  socket.on('send-reaction', (emoji) => {
    if (typeof emoji !== 'string') return;
    const allowedEmojis = ['😍', '👍', '👎', '🎉', '🔥', '❤️'];
    if (!allowedEmojis.includes(emoji)) return;

    const now = Date.now();
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0 };
    if (now - limits.lastReaction < 200) return;
    limits.lastReaction = now;
    clientRateLimits.set(socket.id, limits);

    io.emit('new-reaction', emoji);
  });

  socket.on('send-danmaku', (data) => {
    if (!data || typeof data !== 'object' || typeof data.text !== 'string') return;

    const now = Date.now();
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0 };
    if (now - limits.lastDanmaku < 1000) {
      return socket.emit('error-msg', 'ส่งข้อความเร็วเกินไป กรุณารอ 1 วินาที');
    }
    limits.lastDanmaku = now;
    clientRateLimits.set(socket.id, limits);

    const text = data.text.trim().substring(0, 80);
    if (!text) return;
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
    const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';

    io.emit('new-danmaku', {
      text,
      nickname,
      color,
      tts: Boolean(data.tts)
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete connectedUsers[socket.id];
    clientRateLimits.delete(socket.id);
    io.emit('users-update', connectedUsers);
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`=============================================================`);
  console.log(`MAITEMBATH GANG PARTY Server is running!`);
  console.log(`Access locally: http://localhost:${PORT}`);
  console.log(`Access on LAN:  http://${ip}:${PORT}`);
  console.log(`=============================================================`);
});
