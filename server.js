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
const MAX_STREAM_CACHE_SIZE = 200;
const streamUrlCache = new Map();
const pendingExtractions = new Map();

function pruneStreamUrlCache() {
  const now = Date.now();
  for (const [key, entry] of streamUrlCache.entries()) {
    if (!entry || now >= entry.expiresAt) {
      streamUrlCache.delete(key);
    }
  }
  while (streamUrlCache.size > MAX_STREAM_CACHE_SIZE) {
    const oldestKey = streamUrlCache.keys().next().value;
    if (oldestKey === undefined) break;
    streamUrlCache.delete(oldestKey);
  }
}

setInterval(pruneStreamUrlCache, 15 * 60 * 1000).unref();

function getQualityHeight(quality) {
  if (quality === 'hd720') return { height: 720, label: '720p HD' };
  if (quality === 'large') return { height: 480, label: '480p' };
  if (quality === 'medium') return { height: 360, label: '360p' };
  if (quality === 'hd1080') return { height: 1080, label: '1080p HD' };
  return { height: 1440, label: '1080p HD' };
}

function detectQualityLabelFromUrl(videoUrl, hasSeparateAudio, fallbackLabel = '1080p HD') {
  if (!videoUrl || typeof videoUrl !== 'string') return fallbackLabel;
  const m = videoUrl.match(/[?&]itag=(\d+)/);
  if (m) {
    const itag = parseInt(m[1], 10);
    if ([313, 315, 401, 266, 305].includes(itag)) return '4K UHD';
    if ([271, 308, 400, 264, 304].includes(itag)) return '1440p 2K';
    if ([137, 248, 299, 303, 399, 614, 270].includes(itag)) return '1080p HD';
    if ([136, 247, 298, 302, 398, 22, 609, 232].includes(itag)) return '720p HD';
    if ([135, 244, 397, 231, 606].includes(itag)) return '480p';
    if ([18, 134, 243, 396, 230, 605].includes(itag)) return '360p';
  }
  return hasSeparateAudio ? fallbackLabel : '360p';
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
  const cacheKey = `${videoId}:${quality || 'max'}`;

  const cached = streamUrlCache.get(cacheKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached;
    }
    streamUrlCache.delete(cacheKey);
  }

  if (pendingExtractions.has(cacheKey)) {
    return pendingExtractions.get(cacheKey);
  }

  const extractPromise = (async () => {
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let formatSelector;
    if (height <= 360) {
      formatSelector = '18/best[height<=360][ext=mp4][protocol^=http][acodec!=none][vcodec!=none]/bestvideo[height<=360][protocol^=http]+bestaudio[protocol^=http]/best[protocol^=http]';
    } else if (quality === 'max') {
      // Prioritize 1080p avc1/mp4 (universal hardware decode, zero stutter), then up to 1440p/1080p VP9/AV1 over direct HTTP
      formatSelector = [
        'bestvideo[height=1080][ext=mp4][vcodec^=avc1][protocol^=http]+bestaudio[ext=m4a][protocol^=http]',
        'bestvideo[height<=1440][height>=1080][protocol^=http]+bestaudio[protocol^=http]',
        'bestvideo[height<=1080][ext=mp4][protocol^=http]+bestaudio[ext=m4a][protocol^=http]',
        'bestvideo[height<=1080][protocol^=http]+bestaudio[protocol^=http]',
        'bestvideo[height<=1080]+bestaudio',
        '22/18/best'
      ].join('/');
    } else {
      formatSelector = [
        `bestvideo[height<=${height}][ext=mp4][vcodec^=avc1][protocol^=http]+bestaudio[ext=m4a][protocol^=http]`,
        `bestvideo[height<=${height}][ext=mp4][protocol^=http]+bestaudio[ext=m4a][protocol^=http]`,
        `bestvideo[height<=${height}][protocol^=http]+bestaudio[protocol^=http]`,
        `bestvideo[height<=${height}]+bestaudio`,
        '22/18/best'
      ].join('/');
    }

    const argSets = [
      // 1. Fast native extraction (~2s via visionos/web client) with direct HTTP 1080p+ streams
      [
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', formatSelector,
        targetUrl
      ],
      // 2. Fallback with Node JS runtime & mweb/web client keeping full HD formatSelector
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
      // 3. Final fallback
      [
        '--js-runtimes', 'node',
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', formatSelector,
        targetUrl
      ]
    ];

    let lastErr = null;
    for (const args of argSets) {
      try {
        const urls = await runYtDlpGetUrls(args);
        if (urls && urls.length > 0) {
          const hasSeparateAudio = urls.length > 1;
          const detectedLabel = detectQualityLabelFromUrl(urls[0], hasSeparateAudio, label);
          const info = {
            videoUrl: urls[0],
            audioUrl: hasSeparateAudio ? urls[1] : null,
            qualityLabel: detectedLabel,
            expiresAt: Date.now() + 2 * 60 * 60 * 1000 // cache 2 hours
          };
          pruneStreamUrlCache();
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
    const info = await resolveDirectStreamInfo(videoId, quality);
    proxyVideoStream(info.videoUrl, req, res, `${videoId}:${quality || 'max'}`);
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
    const info = await resolveDirectStreamInfo(videoId, quality);
    proxyVideoStream(info.audioUrl || info.videoUrl, req, res, `${videoId}:${quality || 'max'}`);
  } catch (err) {
    console.error(`Failed to resolve direct audio stream for ${videoId}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Unable to extract direct audio stream');
    }
  }
});

app.use(express.json());

// Fallback IP Geolocation endpoint (useful when browser blocks navigator.geolocation over HTTP LAN)
app.get('/api/ip-location', async (req, res) => {
  try {
    const resp = await fetch('http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country', {
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    if (data && data.status === 'success' && typeof data.lat === 'number' && typeof data.lon === 'number') {
      return res.json({
        lat: data.lat,
        lon: data.lon,
        label: [data.city, data.regionName].filter(Boolean).join(', ') || 'ตำแหน่งเครือข่ายปัจจุบัน'
      });
    }
  } catch (e) {
    // fallback to default Bangkok coordinates if offline
  }
  res.json({ lat: 13.7563, lon: 100.5018, label: 'กรุงเทพมหานคร (พิกัดเริ่มต้น)' });
});

// Thai TTS Audio Proxy endpoint so Host & Clients can always play natural Thai voice alerts even via remote Socket.io events
app.get('/api/tts-thai', async (req, res) => {
  const text = String(req.query.text || '').trim().substring(0, 200);
  if (!text) return res.status(400).end();
  try {
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=th&client=tw-ob&q=${encodeURIComponent(text)}`;
    const resp = await fetch(ttsUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });
    if (!resp.ok) throw new Error(`TTS status ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('TTS proxy error:', err.message);
    res.status(502).end();
  }
});

// Cache for Synced Lyrics (videoId -> { found, synced, lines, trackName, artistName })
const lyricsCache = new Map();

function cleanSongTitleForLyrics(rawTitle = '', rawAuthor = '') {
  let title = String(rawTitle || '')
    .replace(/[\(\[\{【『].*?[\)\]\}】』]/g, ' ')
    .replace(/(?:official\s*(?:music\s*)?(?:video|mv|audio|visualizer|lyric\s*video|lyrics)|mv|คาราโอเกะ|karaoke|instrumental|backing\s*track|full\s*hd|4k)/gi, ' ')
    .replace(/(?:feat\.?|ft\.?|prod\.?\s*by)\s+[^-|•|]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split by pipe or bullet if present (usually "Song Name - Artist | Official MV")
  if (title.includes('|')) {
    title = title.split('|')[0].trim();
  }
  if (title.includes('•')) {
    title = title.split('•')[0].trim();
  }

  let artist = String(rawAuthor || '')
    .replace(/-\s*Topic$/i, '')
    .replace(/(?:official|channel|vevo|music|records|entertainment|thailand)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(youtube|spotify|auto-dj)$/i.test(artist)) artist = '';

  let songOnly = title;
  if (title.includes(' - ')) {
    const parts = title.split(' - ').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      songOnly = parts[0];
      if (!artist) artist = parts[1];
    }
  }

  return {
    fullQuery: [songOnly, artist].filter(Boolean).join(' ').trim() || title,
    songOnly: songOnly || title,
    artist,
    cleanTitle: songOnly || title,
    cleanAuthor: artist
  };
}

function parseLrcText(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = [];
  const rawLines = lrcText.split(/\r?\n/);
  const timeReg = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const raw of rawLines) {
    const matches = [...raw.matchAll(timeReg)];
    if (matches.length === 0) continue;
    const text = raw.replace(timeReg, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      const msStr = m[3] ? m[3].padEnd(3, '0') : '0';
      const timeSec = mins * 60 + secs + parseInt(msStr, 10) / 1000;
      lines.push({ time: Number(timeSec.toFixed(2)), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

app.get('/api/lyrics', async (req, res) => {
  const videoId = String(req.query.videoId || '').trim();
  const title = String(req.query.title || '').trim();
  const author = String(req.query.author || '').trim();
  const duration = parseFloat(req.query.duration) || 210;

  if (!title) {
    return res.json({ found: false, lines: [] });
  }

  const cacheKey = `${videoId || title}:${Math.round(duration)}`;
  if (lyricsCache.has(cacheKey)) {
    return res.json(lyricsCache.get(cacheKey));
  }

  const { fullQuery, songOnly } = cleanSongTitleForLyrics(title, author);
  const queriesToTry = [...new Set([fullQuery, songOnly].filter(Boolean))];

  try {
    for (const q of queriesToTry) {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(5500),
        headers: { 'User-Agent': 'MaitembathGangParty/1.0' }
      });
      if (!resp.ok) continue;
      const list = await resp.json();
      if (!Array.isArray(list) || list.length === 0) continue;

      // Prefer item with syncedLyrics
      const syncedItem = list.find(item => item && typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim());
      if (syncedItem) {
        const parsedLines = parseLrcText(syncedItem.syncedLyrics);
        if (parsedLines.length > 0) {
          const result = {
            found: true,
            synced: true,
            trackName: syncedItem.trackName || songOnly,
            artistName: syncedItem.artistName || author,
            lines: parsedLines
          };
          if (lyricsCache.size >= 100) {
            lyricsCache.delete(lyricsCache.keys().next().value);
          }
          lyricsCache.set(cacheKey, result);
          return res.json(result);
        }
      }

      // Fallback to plainLyrics distributed across track duration
      const plainItem = list.find(item => item && typeof item.plainLyrics === 'string' && item.plainLyrics.trim());
      if (plainItem) {
        const rawTextLines = plainItem.plainLyrics
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
        if (rawTextLines.length > 0) {
          const effectiveDur = Math.max(90, duration - 12);
          const stepSec = effectiveDur / rawTextLines.length;
          const approxLines = rawTextLines.map((text, idx) => ({
            time: Number((6 + idx * stepSec).toFixed(2)),
            text
          }));
          const result = {
            found: true,
            synced: false,
            trackName: plainItem.trackName || songOnly,
            artistName: plainItem.artistName || author,
            lines: approxLines
          };
          if (lyricsCache.size >= 100) {
            lyricsCache.delete(lyricsCache.keys().next().value);
          }
          lyricsCache.set(cacheKey, result);
          return res.json(result);
        }
      }
    }
  } catch (err) {
    console.warn('Lyrics lookup error:', err.message);
  }

  return res.json({ found: false, lines: [] });
});

// Helper: Parse coordinates "lat, lon" if valid
function parseCoordPair(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  return null;
}

async function geocodePlaceName(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=th`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: { 'User-Agent': 'MaitembathGangParty/1.0' }
  });
  const list = await resp.json();
  if (Array.isArray(list) && list.length > 0) {
    return {
      lat: parseFloat(list[0].lat),
      lon: parseFloat(list[0].lon),
      name: list[0].display_name.split(',').slice(0, 3).join(', ')
    };
  }
  return null;
}

async function reverseGeocodeCoord(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=th`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'MaitembathGangParty/1.0' }
    });
    const data = await resp.json();
    if (data && data.display_name) {
      return data.display_name.split(',').slice(0, 3).join(', ');
    }
  } catch (e) {}
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// Resolve Google Maps URL (short or full), coordinates, or place name into destination coordinates
app.post('/api/resolve-route', async (req, res) => {
  const rawInput = (req.body?.input || '').trim();
  if (!rawInput) {
    return res.status(400).json({ error: 'กรุณาวางลิงก์เส้นทาง Google Maps หรือระบุสถานที่ปลายทาง' });
  }

  try {
    // 1. Direct coordinates "13.7563, 100.5018"
    const directCoord = parseCoordPair(rawInput);
    if (directCoord) {
      const name = await reverseGeocodeCoord(directCoord.lat, directCoord.lon);
      return res.json({ lat: directCoord.lat, lon: directCoord.lon, name });
    }

    let expandedUrl = rawInput;
    let htmlSnippet = '';

    // 2. If it's a URL, follow redirects (e.g. maps.app.goo.gl, goo.gl/maps)
    if (/^https?:\/\//i.test(rawInput)) {
      try {
        const resp = await fetch(rawInput, {
          redirect: 'follow',
          signal: AbortSignal.timeout(7000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });
        if (resp && resp.url) expandedUrl = resp.url;
        const text = await resp.text();
        htmlSnippet = text.slice(0, 50000);
        // Check if Google returned an HTML redirect with full maps URL inside
        const metaUrlMatch = htmlSnippet.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps[^\s"'<>\\]+/i);
        if (metaUrlMatch && (expandedUrl.includes('goo.gl') || expandedUrl.includes('maps.app'))) {
          expandedUrl = metaUrlMatch[0].replace(/&amp;/g, '&');
        }
      } catch (e) {
        // continue with original URL string
      }
    }

    const decodedUrl = decodeURIComponent(expandedUrl.replace(/\+/g, ' '));
    let destCoord = null;
    let candidateName = null;

    // 3. Check URL query parameters: destination=, daddr=, q=, query=
    try {
      const parsed = new URL(expandedUrl);
      const destParam = parsed.searchParams.get('destination') || parsed.searchParams.get('daddr') || parsed.searchParams.get('q') || parsed.searchParams.get('query');
      if (destParam) {
        const c = parseCoordPair(destParam);
        if (c) destCoord = c;
        else candidateName = destParam;
      }
    } catch (e) {}

    // 4. Extract /dir/Origin/Destination/... or /place/PlaceName/...
    if (!candidateName) {
      const dirMatch = decodedUrl.match(/\/maps\/dir\/([^/?#]+)\/([^/?#@]+)/i);
      if (dirMatch && dirMatch[2]) {
        const destSeg = dirMatch[2].trim();
        const c = parseCoordPair(destSeg);
        if (c) destCoord = c;
        else if (!/^data=/i.test(destSeg)) candidateName = destSeg;
      }
      const placeMatch = decodedUrl.match(/\/maps\/place\/([^/?#@]+)/i);
      if (placeMatch && placeMatch[1]) {
        const placeSeg = placeMatch[1].trim();
        const c = parseCoordPair(placeSeg);
        if (c) destCoord = c;
        else candidateName = placeSeg;
      }
    }

    // 5. Extract exact pin coordinates !3dLAT!4dLON or !2dLON!3dLAT from Google Maps data= parameter (last pin = destination)
    if (!destCoord) {
      const pin3d4d = [...expandedUrl.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
      if (pin3d4d.length > 0) {
        const last = pin3d4d[pin3d4d.length - 1];
        destCoord = { lat: parseFloat(last[1]), lon: parseFloat(last[2]) };
      } else {
        const pin2d3d = [...expandedUrl.matchAll(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/g)];
        if (pin2d3d.length > 0) {
          const last = pin2d3d[pin2d3d.length - 1];
          destCoord = { lat: parseFloat(last[2]), lon: parseFloat(last[1]) };
        }
      }
    }

    // 6. Extract @LAT,LON viewport coordinates from URL
    if (!destCoord) {
      const atMatch = expandedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (atMatch) {
        destCoord = { lat: parseFloat(atMatch[1]), lon: parseFloat(atMatch[2]) };
      }
    }

    // 7. If we have a candidate place name but no coordinates yet, geocode the place name
    if (!destCoord && candidateName) {
      const geo = await geocodePlaceName(candidateName);
      if (geo) return res.json(geo);
    }

    // 8. If we have coordinates, resolve or clean the place name
    if (destCoord && !isNaN(destCoord.lat) && !isNaN(destCoord.lon)) {
      const displayName = candidateName || await reverseGeocodeCoord(destCoord.lat, destCoord.lon);
      return res.json({
        lat: destCoord.lat,
        lon: destCoord.lon,
        name: displayName
      });
    }

    // 9. Finally, if user typed a place name directly (not a URL), geocode it
    if (!/^https?:\/\//i.test(rawInput)) {
      const geo = await geocodePlaceName(rawInput);
      if (geo) return res.json(geo);
    }

    return res.status(404).json({ error: 'ไม่พบพิกัดปลายทางจากลิงก์หรือข้อความนี้ กรุณาลองวางลิงก์ Google Maps เต็ม หรือพิมพ์ชื่อสถานที่' });
  } catch (err) {
    console.error('Resolve route error:', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการประมวลผลลิงก์เส้นทาง' });
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
  quality: 'max',
  autoDjEnabled: true,
  autoDjMode: 'khlerm',
  autoDjCustomQuery: ''
};

// Auto-DJ Mode Presets & Recently Played History (to prevent repeating tracks)
let isSelectingAutoDj = false;
let lastPlayedVideoInfo = null;
const recentPlayedIds = [];

function recordPlayedVideo(videoObj) {
  if (!videoObj || !videoObj.videoId) return;
  lastPlayedVideoInfo = {
    videoId: videoObj.videoId,
    title: videoObj.originalTitle || videoObj.title || '',
    author: videoObj.author || ''
  };
  const idx = recentPlayedIds.indexOf(videoObj.videoId);
  if (idx !== -1) recentPlayedIds.splice(idx, 1);
  recentPlayedIds.push(videoObj.videoId);
  if (recentPlayedIds.length > 60) recentPlayedIds.shift();
}

const AUTO_DJ_MODES = {
  khlerm: {
    label: '🌙 เคลิ้มๆ ลอยๆ (Chill & Dreamy)',
    shortLabel: 'โหมดเคลิ้มๆ',
    color: '#a78bfa',
    seeds: [
      'DEPT Official MV',
      'YENTED Official Audio',
      'Safeplanet Official MV',
      'POLYCAT Official MV',
      'Anatomy Rabbit Official',
      'Jeff Satur Official MV',
      'PUN Official MV',
      'The TOYS Official MV',
      'Bowkylion Official MV',
      'Fellow Fellow Official MV',
      'Violette Wautier Official',
      'NONT TANONT Official MV',
      'Tilly Birds Official MV',
      'Moving and Cut Official',
      'Whal & Dolph Official',
      'TELEx TELEXs Official',
      'Patrickananda Official',
      'HYBS Official Audio',
      'WIM Official Audio'
    ]
  },
  similar: {
    label: '🎯 อิงตามเพลงล่าสุด (Smart Match)',
    shortLabel: 'ตามเพลงล่าสุด',
    color: '#38bdf8',
    seeds: [
      'Three Man Down Official MV',
      'Tilly Birds Official MV',
      'NONT TANONT Official MV',
      'Jeff Satur Official MV',
      'Bowkylion Official MV',
      'Fellow Fellow Official MV',
      'The TOYS Official MV',
      'PUN Official MV'
    ]
  },
  indie_thai: {
    label: '🎸 อินดี้/ป๊อปไทยฮิต (Thai Pop & Indie)',
    shortLabel: 'อินดี้/ป๊อปไทย',
    color: '#60a5fa',
    seeds: [
      'Three Man Down Official MV',
      'Tilly Birds Official MV',
      'Tattoo Colour Official MV',
      'Paper Planes Official MV',
      'Only Monday Official MV',
      'Cocktail Official MV',
      'Slot Machine Official MV',
      'Scrubb Official MV',
      'Potato Official MV',
      'Paradox Official MV',
      'Billkin Official MV',
      'INK WARUNTORN Official MV',
      '4EVE Official MV',
      'Lomosonic Official MV'
    ]
  },
  acoustic_cafe: {
    label: '☕ อะคูสติกฟังสบาย (Acoustic & Cafe)',
    shortLabel: 'อะคูสติกชิลๆ',
    color: '#fbbf24',
    seeds: [
      'Serious Bacon Official MV',
      'Scrubb Official Audio',
      'Ink Waruntorn Official MV',
      'Earth Patravee Official',
      'Whal & Dolph Official',
      'Fellow Fellow ดาวหางฮัลเลย์ Official',
      'No One Else Official MV',
      'Mirrr Official MV',
      'Sarah Salola Official',
      'Bell Warisara Official',
      'Rooftop Official MV'
    ]
  },
  party_dance: {
    label: '🔥 สายตี้แดนซ์มันส์ๆ (Party & Dance)',
    shortLabel: 'สายตี้แดนซ์',
    color: '#f472b6',
    seeds: [
      'Joey Boy Official MV',
      'F.HERO Official MV',
      'URBOYTJ Official MV',
      'YOUNGOHM Official MV',
      'Pok Mindset Official MV',
      'แจ๊ส สปุ๊กนิค ปาปิยอง กุ๊กกุ๊ก Official',
      'TIMETHAI Official MV',
      'MILLI Official MV',
      'SPRITE Official MV',
      'เพลงแดนซ์สายตี้ มันส์ๆ'
    ]
  },
  retro_90s: {
    label: '📼 ย้อนยุค 90s-2000s (Retro Hits)',
    shortLabel: 'ย้อนยุค 90s-2000s',
    color: '#fb923c',
    seeds: [
      'Silly Fools Official Audio',
      'Bodyslam เพลงฮิต Official',
      'Big Ass Official MV',
      'Loso Official Audio',
      'Moderndog Official',
      'Clash เพลงฮิต Official',
      'Da Endorphine Official',
      'D2B Official Audio',
      'Pru ทุกสิ่ง Official',
      'กะลา Official Audio',
      'Labanoon Official MV'
    ]
  },
  inter_chill: {
    label: '🌎 สากลเคลิ้มๆ (Global R&B / Lofi)',
    shortLabel: 'สากลเคลิ้มๆ',
    color: '#34d399',
    seeds: [
      'keshi Official Audio',
      'Joji Official Video',
      'The Weeknd Official Video',
      'Honne Official Video',
      'LANY Official Video',
      'Lauv Official Audio',
      'Bruno Mars Official Video',
      'Jeremy Zucker Official Video',
      'Daniel Caesar Official Audio',
      'Cigarettes After Sex Official',
      'Post Malone Official Video'
    ]
  },
  lukthung_party: {
    label: '🍻 ลูกทุ่งอินดี้/สายม่วน (Lukthung Party)',
    shortLabel: 'ลูกทุ่งสายม่วน',
    color: '#f87171',
    seeds: [
      'โจอี้ ภูวศิษฐ์ Official MV',
      'ก้อง ห้วยไร่ Official MV',
      'มนต์แคน แก่นคูน Official MV',
      'ลำไย ไหทองคำ Official MV',
      'เบิ้ล ปทุมราช Official MV',
      'บอย พนมไพร Official MV',
      'มีนตรา อินทิรา Official MV',
      'ปรีชา ปัดภัย Official MV',
      'เต๊ะ ตระกูลตอ Official MV'
    ]
  }
};

// Collaborative Weather Radar & GPS Navigation State (synced across all clients)
let navState = {
  panelOpen: false,
  viewMode: 'map',           // 'map' | 'windy'
  step: 'input',             // 'input' | 'preview' | 'active'
  routeInputText: '',
  userCoords: null,          // { lat, lon, label }
  weatherInfo: null,         // { temp, humidity, wind, rainProb, code, text, rainAlert, advice }
  destination: null,         // { lat, lon, name, distanceKm, durationMin, initialDistanceKm, summary }
  liveRoute: null,           // { remKm, etaMins, arrivalTime, instructionText, roadStatus, progressPct, geometry }
  routeWeatherAhead: null,   // { points: [{ label, pct, temp, rainProb, code, text, icon, isRainy }], hasRainAhead, summary }
  hasAlerted90Pct: false,
  controllerName: '',
  updatedAt: 0
};

let isSwitchingKaraoke = false;
let connectedUsers = {}; // { socketId: { name, color } }
const clientRateLimits = new Map(); // socket.id -> { lastDanmaku: timestamp, lastReaction: timestamp, lastSoundboard: timestamp }

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

async function triggerAutoDjNextTrack(forcePlay = false) {
  if (isSelectingAutoDj) return;
  if (!forcePlay && (!state.autoDjEnabled || state.queue.length > 0 || state.currentVideo)) return;

  isSelectingAutoDj = true;
  try {
    const modeKey = AUTO_DJ_MODES[state.autoDjMode] ? state.autoDjMode : 'khlerm';
    const modeCfg = AUTO_DJ_MODES[modeKey];
    const customQuery = (state.autoDjCustomQuery || '').trim();

    let searchQuery = '';
    if (customQuery) {
      const suffixes = ['Official MV', 'Official Audio', 'เพลง', ''];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      searchQuery = `${customQuery} ${suffix}`.trim();
    } else if (modeKey === 'similar' && lastPlayedVideoInfo) {
      const cleanAuthor = (lastPlayedVideoInfo.author || '')
        .replace(/-\s*Topic$/i, '')
        .replace(/Official|Channel|VEVO|Music|Records/gi, '')
        .trim();
      const cleanTitle = (lastPlayedVideoInfo.title || '')
        .replace(/[\(\[\{【『].*?[\)\]\}】』]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanAuthor && !/^(youtube|spotify)$/i.test(cleanAuthor) && Math.random() < 0.7) {
        searchQuery = `${cleanAuthor} Official MV`;
      } else if (cleanTitle) {
        const titlePrefix = cleanTitle.split(/[-|–—]/)[0].trim();
        searchQuery = `${titlePrefix} Official Audio`;
      }
    }

    if (!searchQuery) {
      const seeds = modeCfg.seeds;
      searchQuery = seeds[Math.floor(Math.random() * seeds.length)];
    }

    const yt = await getInnertube();
    const search = await yt.search(searchQuery);
    const videos = Array.isArray(search?.videos) ? search.videos : [];

    // Filter out already played videos and long 1-hour compilations / very short clips
    const isGoodSingleTrack = (v) => {
      if (!v || typeof v.id !== 'string' || v.id.length !== 11) return false;
      if (recentPlayedIds.includes(v.id)) return false;
      const t = v.title?.text || v.title?.runs?.[0]?.text || '';
      if (/รวมเพลง|1\s*ชั่วโมง|2\s*ชั่วโมง|1\s*hour|nonstop|full\s*album|ยาวๆ/i.test(t)) return false;
      const durSec = v.duration?.seconds;
      if (typeof durSec === 'number' && durSec > 0 && (durSec < 85 || durSec > 540)) return false;
      return true;
    };

    let candidates = videos.filter(isGoodSingleTrack);
    if (candidates.length === 0) {
      candidates = videos.filter(v => v && typeof v.id === 'string' && v.id.length === 11 && !recentPlayedIds.includes(v.id));
    }
    if (candidates.length === 0) {
      candidates = videos.filter(v => v && typeof v.id === 'string' && v.id.length === 11);
    }
    if (candidates.length === 0) return;

    const topPool = candidates.slice(0, Math.min(candidates.length, 6));
    const chosen = topPool[Math.floor(Math.random() * topPool.length)];
    const trackTitle = chosen.title?.text || chosen.title?.runs?.[0]?.text || searchQuery;
    const trackAuthor = chosen.author?.name || 'YouTube';
    const badgeLabel = customQuery
      ? `Auto-DJ (${customQuery})`
      : `Auto-DJ (${modeCfg.shortLabel})`;

    const autoTrack = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      url: `https://www.youtube.com/watch?v=${chosen.id}`,
      videoId: chosen.id,
      title: trackTitle,
      author: trackAuthor,
      thumbnail: null,
      source: 'autodj',
      addedBy: badgeLabel,
      color: modeCfg.color || '#a78bfa',
      isAutoDj: true,
      autoDjMode: modeKey
    };

    if (!forcePlay && (state.currentVideo || state.queue.length > 0 || !state.autoDjEnabled)) {
      return;
    }

    if (!state.currentVideo || (forcePlay && state.currentVideo.isAutoDj)) {
      state.currentVideo = autoTrack;
      state.isPlaying = true;
      state.currentTime = 0;
      state.duration = 0;
      recordPlayedVideo(autoTrack);
      prefetchVideoStreamUrl(autoTrack.videoId);
      broadcastState();
      io.emit('show-toast-broadcast', `🎧 ${badgeLabel} เลือกเพลง: ${trackTitle}`);
    } else if (forcePlay) {
      state.queue.unshift(autoTrack);
      recordPlayedVideo(autoTrack);
      broadcastState();
      io.emit('show-toast-broadcast', `🎧 เพิ่มเพลง ${badgeLabel} เป็นคิวถัดไป: ${trackTitle}`);
    }
  } catch (err) {
    console.error('Auto-DJ selection error:', err.message);
  } finally {
    isSelectingAutoDj = false;
  }
}

function playNext() {
  if (state.currentVideo) {
    recordPlayedVideo(state.currentVideo);
  }
  if (state.queue.length > 0) {
    state.currentVideo = state.queue.shift();
    state.isPlaying = true;
    state.currentTime = 0;
    state.duration = 0;
    recordPlayedVideo(state.currentVideo);
    prefetchVideoStreamUrl(state.currentVideo.videoId);
    if (state.queue[0] && state.queue[0].videoId) {
      prefetchVideoStreamUrl(state.queue[0].videoId);
    }
    broadcastState();
  } else {
    state.currentVideo = null;
    state.isPlaying = false;
    state.currentTime = 0;
    state.duration = 0;
    broadcastState();
    if (state.autoDjEnabled) {
      triggerAutoDjNextTrack(false);
    }
  }
}

function broadcastState() {
  io.emit('state-update', state);
}

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.emit('init', {
    state: state,
    navState: navState,
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
            if (state.queue.length <= 2) {
              prefetchVideoStreamUrl(match.videoId);
            }

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
      if (state.queue.length <= 2) {
        prefetchVideoStreamUrl(videoId);
      }

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
      if (state.currentVideo && state.currentVideo.videoId && qual !== 'auto') {
        prefetchVideoStreamUrl(state.currentVideo.videoId);
      }
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

  // Auto-DJ Mode & Continuous Playback Configuration
  socket.on('autodj-config', (cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    if (typeof cfg.enabled === 'boolean') {
      state.autoDjEnabled = cfg.enabled;
    }
    if (typeof cfg.mode === 'string' && AUTO_DJ_MODES[cfg.mode]) {
      state.autoDjMode = cfg.mode;
    }
    if (typeof cfg.customQuery === 'string') {
      state.autoDjCustomQuery = cfg.customQuery.trim().substring(0, 50);
    }
    broadcastState();

    const modeCfg = AUTO_DJ_MODES[state.autoDjMode] || AUTO_DJ_MODES.khlerm;
    const modeDesc = state.autoDjCustomQuery
      ? `${modeCfg.shortLabel} • "${state.autoDjCustomQuery}"`
      : modeCfg.label;

    if (cfg.notify !== false) {
      io.emit(
        'show-toast-broadcast',
        state.autoDjEnabled
          ? `🎧 Auto-DJ เปิดอยู่: ${modeDesc}`
          : `⏸️ ปิดระบบเล่นเพลงต่อเนื่อง Auto-DJ แล้ว`
      );
    }

    if (state.autoDjEnabled && !state.currentVideo && state.queue.length === 0) {
      triggerAutoDjNextTrack(false);
    }
  });

  socket.on('autodj-play-now', (cfg) => {
    if (cfg && typeof cfg === 'object') {
      if (typeof cfg.mode === 'string' && AUTO_DJ_MODES[cfg.mode]) {
        state.autoDjMode = cfg.mode;
      }
      if (typeof cfg.customQuery === 'string') {
        state.autoDjCustomQuery = cfg.customQuery.trim().substring(0, 50);
      }
    }
    state.autoDjEnabled = true;
    broadcastState();
    triggerAutoDjNextTrack(true);
  });

  // Automatic Alternative Video Fallback Handler
  socket.on('resolve-error-action', async (action) => {
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
          prefetchVideoStreamUrl(alt.id);
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
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0, lastSoundboard: 0 };
    if (now - limits.lastReaction < 200) return;
    limits.lastReaction = now;
    clientRateLimits.set(socket.id, limits);

    io.emit('new-reaction', emoji);
  });

  // DJ Party Soundboard Effects Broadcast
  socket.on('send-soundboard', (payload) => {
    const soundId = typeof payload === 'string' ? payload : payload?.soundId;
    if (typeof soundId !== 'string') return;
    const allowedSounds = ['airhorn', 'badumtss', 'cheer', 'siren', 'laser', 'cricket'];
    if (!allowedSounds.includes(soundId)) return;

    const now = Date.now();
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0, lastSoundboard: 0 };
    if (now - (limits.lastSoundboard || 0) < 850) {
      return socket.emit('error-msg', 'กดซาวด์เอฟเฟกต์รัวเกินไป รอสักครู่นะครับ 🎛️');
    }
    limits.lastSoundboard = now;
    clientRateLimits.set(socket.id, limits);

    const senderName = connectedUsers[socket.id]?.name || (typeof payload?.nickname === 'string' ? payload.nickname.trim().substring(0, 20) : 'DJ ในห้อง');
    io.emit('play-soundboard-fx', {
      soundId,
      senderName,
      senderId: socket.id,
      timestamp: now
    });
  });

  // One-click Karaoke / Backing Track Switcher for current playing track
  socket.on('toggle-karaoke-mode', async () => {
    if (!state.currentVideo || isSwitchingKaraoke) return;
    isSwitchingKaraoke = true;
    const targetItemId = state.currentVideo.id;
    const senderName = connectedUsers[socket.id]?.name || 'สมาชิก';

    try {
      // If currently in Karaoke mode and we have the original vocal video saved, switch back!
      if (state.currentVideo.isKaraokeMode && state.currentVideo.normalVideoId) {
        const normalId = state.currentVideo.normalVideoId;
        const normalTitle = state.currentVideo.normalTitle || state.currentVideo.originalTitle || state.currentVideo.title;
        const normalAuthor = state.currentVideo.normalAuthor || state.currentVideo.author;
        state.currentVideo = {
          ...state.currentVideo,
          videoId: normalId,
          url: `https://www.youtube.com/watch?v=${normalId}`,
          title: normalTitle,
          author: normalAuthor,
          isKaraokeMode: false
        };
        state.isPlaying = true;
        state.currentTime = 0;
        state.duration = 0;
        prefetchVideoStreamUrl(normalId);
        broadcastState();
        io.emit('show-toast-broadcast', `🎵 ${senderName} สลับกลับเป็นโหมดเพลงต้นฉบับ (มีเสียงร้อง)`);
        return;
      }

      // Otherwise, search for a Karaoke / Instrumental version of the current song
      const baseTitle = state.currentVideo.originalTitle || state.currentVideo.normalTitle || state.currentVideo.title || '';
      const baseAuthor = state.currentVideo.normalAuthor || state.currentVideo.author || '';
      const { cleanTitle, cleanAuthor } = cleanSongTitleForLyrics(baseTitle, baseAuthor);
      const searchBase = `${cleanTitle || baseTitle} ${cleanAuthor}`.trim();
      const karaokeQuery = `${searchBase} คาราโอเกะ karaoke backing track`.trim();

      const yt = await getInnertube();
      const search = await yt.search(karaokeQuery);

      if (!state.currentVideo || state.currentVideo.id !== targetItemId) return;

      const videos = Array.isArray(search?.videos) ? search.videos : [];
      const currentVidId = state.currentVideo.videoId;
      const karaokeCandidate = videos.find(v => {
        if (!v || typeof v.id !== 'string' || v.id.length !== 11 || v.id === currentVidId) return false;
        const t = (v.title?.text || v.title?.runs?.[0]?.text || '').toLowerCase();
        return /karaoke|คาราโอเกะ|backing\s*track|instrumental|ดนตรีสด|ดนตรีล้วน|minus\s*one|off\s*vocal/.test(t);
      }) || videos.find(v => v && typeof v.id === 'string' && v.id.length === 11 && v.id !== currentVidId);

      if (!karaokeCandidate) {
        socket.emit('error-msg', 'ไม่พบเวอร์ชันคาราโอเกะสำหรับเพลงนี้ใน YouTube');
        return;
      }

      const kTitle = karaokeCandidate.title?.text || karaokeCandidate.title?.runs?.[0]?.text || `${cleanTitle} (Karaoke)`;
      const kAuthor = karaokeCandidate.author?.name || 'Karaoke Channel';

      state.currentVideo = {
        ...state.currentVideo,
        normalVideoId: state.currentVideo.normalVideoId || state.currentVideo.videoId,
        normalTitle: state.currentVideo.normalTitle || state.currentVideo.title,
        normalAuthor: state.currentVideo.normalAuthor || state.currentVideo.author,
        originalTitle: state.currentVideo.originalTitle || state.currentVideo.title,
        videoId: karaokeCandidate.id,
        url: `https://www.youtube.com/watch?v=${karaokeCandidate.id}`,
        title: `🎤 [คาราโอเกะ] ${kTitle}`,
        author: kAuthor,
        isKaraokeMode: true
      };
      state.isPlaying = true;
      state.currentTime = 0;
      state.duration = 0;
      prefetchVideoStreamUrl(karaokeCandidate.id);
      broadcastState();
      io.emit('show-toast-broadcast', `🎤 ${senderName} สลับเป็นโหมดคาราโอเกะ: ${kTitle}`);
    } catch (err) {
      console.error('Toggle karaoke error:', err.message);
      socket.emit('error-msg', 'เกิดข้อผิดพลาดในการค้นหาเวอร์ชันคาราโอเกะ');
    } finally {
      isSwitchingKaraoke = false;
    }
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

  // Real-time Weather Radar & GPS Navigation Sync across all connected clients
  socket.on('sync-nav-state', (patch) => {
    if (!patch || typeof patch !== 'object') return;
    navState = {
      ...navState,
      ...patch,
      updatedAt: Date.now()
    };
    io.emit('nav-state-update', {
      navState,
      senderId: socket.id
    });
  });

  socket.on('trigger-nav-alert', (alertPayload) => {
    if (!alertPayload || typeof alertPayload !== 'object') return;
    io.emit('nav-alert-broadcast', {
      ...alertPayload,
      senderId: socket.id,
      timestamp: Date.now()
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
