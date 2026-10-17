/**
 * MAITEMBATH GANG PARTY - Map, Weather Radar & Navigation Module (public/js/map.js)
 * 
 * Responsibilities:
 * - Leaflet map engine with Google Maps Thai tiles & custom themes (dark, street, hybrid)
 * - RainViewer live radar loops with animation controller
 * - Open-Meteo real-time weather & Thai voice precipitation alerts
 * - Country-to-user animated radar zoom sequence for severe weather
 * - 20-minute automatic Radar Showcase schedule (10s auto-crossfade)
 * - Route resolution via /api/resolve-route and OSRM turn-by-turn guidance
 * - 3-Point Route Weather Ahead analysis (Origin 0%, Midpoint 50%, Destination 100%)
 * - Synchronized navigation state across all room participants
 */

import { getState } from './state.js';
import { 
    getSocket, 
    emitSyncNavState, 
    emitTriggerNavAlert, 
    emitNavStatePatch 
} from './socket.js';
import { 
    playSoftAlertChime, 
    speakThaiText 
} from './audio.js';
import { showToast, escapeHtml } from './ui.js';

// DOM selector helper
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// --- Internal State ---
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

// 20-Minute Auto Showcase State (10s Display)
export const AUTO_SHOWCASE_INTERVAL_MS = 20 * 60 * 1000;
export const SHOWCASE_DURATION_SEC = 10;
let autoShowcaseInterval = null;
let showcaseCountdownTimer = null;
let showcaseRemainingSec = 0;

// Weather Zoom Animation State
let weatherZoomTimers = [];
let weatherAlertOverlayGroup = null;

// Route Weather Ahead State
let currentRouteWeatherAhead = null;
let simDriveTimer = null;

// ============================================================================
// WEATHER CODE DECODER (Resolves Monolith Defect at Line 5478)
// ============================================================================

export function getWmoWeatherThai(code) {
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

/**
 * Decodes WMO weather code into text description and rain boolean flag.
 * Fully resolves monolithic ReferenceError at line 5478.
 * @param {number} code - WMO weather code
 * @returns {{ text: string, rain: boolean }}
 */
export function decodeWmoWeather(code) {
    const w = getWmoWeatherThai(code);
    return {
        text: w.text,
        rain: w.rainAlert || code >= 51
    };
}

// ============================================================================
// MAP BASE LAYERS & INITIALIZATION
// ============================================================================

export function applyMapBaseLayer(mode) {
    if (!radarMap || typeof L === 'undefined') return;
    mapStyleMode = mode;
    if (baseTileLayer && radarMap.hasLayer(baseTileLayer)) {
        radarMap.removeLayer(baseTileLayer);
    }

    const leafletRadarMapEl = $('leaflet-radar-map');
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

    const mapStyleLabel = $('map-style-label');
    if (mapStyleLabel) {
        mapStyleLabel.textContent = mode === 'dark' ? 'แผนที่มืด' : (mode === 'street' ? 'แผนที่ถนน' : 'ดาวเทียม');
    }
}

export function initLeafletRadarMap() {
    const leafletRadarMapEl = $('leaflet-radar-map');
    if (radarMap || !leafletRadarMapEl || typeof L === 'undefined') return;

    const initLat = userCoords ? userCoords.lat : 13.7563;
    const initLon = userCoords ? userCoords.lon : 100.5018;

    radarMap = L.map(leafletRadarMapEl, {
        center: [initLat, initLon],
        zoom: 9,
        zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(radarMap);
    applyMapBaseLayer(mapStyleMode);

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            if (radarMap) radarMap.invalidateSize();
        });
        ro.observe(leafletRadarMapEl);
    }

    radarMap.on('click', async (e) => {
        if (activeNavigation) return;
        const { lat, lng } = e.latlng;
        const routeLinkInput = $('route-link-input');
        if (routeLinkInput) {
            routeLinkInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
        await processRouteLinkInput();
    });

    loadRainViewerRadarFrames();
}

// ============================================================================
// RAINVIEWER LIVE WEATHER RADAR LOOPS
// ============================================================================

export async function loadRainViewerRadarFrames() {
    if (!radarMap) return;
    try {
        const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await resp.json();
        if (data && data.host) rainviewerHost = data.host;
        const past = data?.radar?.past || [];
        const nowcast = data?.radar?.nowcast || [];
        radarFrames = [...past.slice(-6), ...nowcast.slice(0, 2)];

        Object.values(radarTileLayers).forEach(layer => {
            if (radarMap.hasLayer(layer)) radarMap.removeLayer(layer);
        });
        radarTileLayers = {};

        const radarTimeLabel = $('radar-time-label');
        if (radarFrames.length === 0) {
            if (radarTimeLabel) radarTimeLabel.textContent = 'ไม่มีข้อมูลเมฆฝน';
            return;
        }

        currentRadarFrameIdx = Math.max(0, past.slice(-6).length - 1);
        showRadarFrame(currentRadarFrameIdx);
        startRadarAnimation();
    } catch (_) {
        const radarTimeLabel = $('radar-time-label');
        if (radarTimeLabel) radarTimeLabel.textContent = 'ออฟไลน์';
    }
}

export function showRadarFrame(idx) {
    if (!radarMap || radarFrames.length === 0) return;
    const frame = radarFrames[idx];
    if (!frame) return;

    Object.values(radarTileLayers).forEach(layer => {
        if (layer.setOpacity) layer.setOpacity(0);
    });

    if (radarOverlayVisible) {
        if (!radarTileLayers[frame.path]) {
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

    const radarTimeLabel = $('radar-time-label');
    if (radarTimeLabel && frame.time) {
        const d = new Date(frame.time * 1000);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const isFuture = frame.time * 1000 > Date.now() + 60000;
        radarTimeLabel.textContent = `${hh}:${mm} น.${isFuture ? ' (คาดการณ์)' : ''}`;
    }
}

export function startRadarAnimation() {
    clearInterval(radarAnimTimer);
    if (!radarPlaying || radarFrames.length <= 1) return;
    radarAnimTimer = setInterval(() => {
        if (!splitRadarOpen || radarViewMode !== 'map' || !radarOverlayVisible) return;
        currentRadarFrameIdx = (currentRadarFrameIdx + 1) % radarFrames.length;
        showRadarFrame(currentRadarFrameIdx);
    }, 850);
}

// ============================================================================
// WEATHER ANALYSIS & GPS LOCATION
// ============================================================================

export function updateUserMarkerOnMap(lat, lon, panMap = false) {
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

export function renderWeatherCardUI(info, locLabel) {
    if (!info) return;
    const weatherLocName = $('weather-loc-name');
    const weatherTemp = $('weather-temp');
    const weatherDesc = $('weather-desc');
    const weatherRainProb = $('weather-rain-prob');
    const weatherWind = $('weather-wind');
    const weatherHumidity = $('weather-humidity');
    const sidebarWeatherMini = $('sidebar-weather-mini');
    const weatherAdvice = $('weather-advice');

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

export async function analyzeWeatherAtCoords(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,precipitation_probability,weather_code,wind_speed_10m&hourly=precipitation_probability&timezone=auto`;
        const resp = await fetch(url);
        const data = await resp.json();
        const curr = data?.current;
        if (!curr) return;

        const temp = Math.round(curr.temperature_2m ?? 30);
        const humidity = Math.round(curr.relative_humidity_2m ?? 65);
        const wind = Math.round(curr.wind_speed_10m ?? 5);
        const code = curr.weather_code ?? 0;

        let rainProb = typeof curr.precipitation_probability === 'number' ? Math.round(curr.precipitation_probability) : 0;
        const hourlyProbs = data?.hourly?.precipitation_probability;
        const hourlyTimes = data?.hourly?.time;
        if (Array.isArray(hourlyProbs) && hourlyProbs.length > 0) {
            let hourIdx = -1;
            if (typeof curr.time === 'string' && Array.isArray(hourlyTimes)) {
                const currentHourPrefix = curr.time.slice(0, 13);
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
        } catch (_) {}

        renderWeatherCardUI(currentWeatherInfo, locLabel);

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
            emitTriggerNavAlert({
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

export function requestUserLocation(panMap = false, silent = false) {
    return new Promise((resolve) => {
        const gpsSpinIcon = $('gps-spin-icon');
        if (gpsSpinIcon) gpsSpinIcon.classList.add('fa-spin');

        const applyCoords = async (lat, lon, label, isFallback = false) => {
            if (gpsSpinIcon) gpsSpinIcon.classList.remove('fa-spin');
            userCoords = { lat, lon, label };
            const weatherLocName = $('weather-loc-name');
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
            } catch (_) {
                await applyCoords(13.7563, 100.5018, 'กรุงเทพมหานคร', true);
            }
        };

        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
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
    const windyRadarIframe = $('windy-radar-iframe');
    if (!windyRadarIframe) return;
    const lat = userCoords ? userCoords.lat : 13.7563;
    const lon = userCoords ? userCoords.lon : 100.5018;
    const targetSrc = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=8&overlay=radar&product=radar&level=surface&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&message=true`;
    if (windyRadarIframe.src !== targetSrc) {
        windyRadarIframe.src = targetSrc;
    }
}

export function setRadarViewMode(mode, sync = true) {
    radarViewMode = mode;
    const leafletRadarMapEl = $('leaflet-radar-map');
    const radarTimelineBar = $('radar-timeline-bar');
    const windyRadarIframe = $('windy-radar-iframe');
    const btnModeWindy = $('btn-mode-windy');
    const btnModeMapRadar = $('btn-mode-map-radar');

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

// ============================================================================
// COUNTRY-TO-USER RADAR ZOOM ANIMATION
// ============================================================================

export function clearWeatherZoomAnimation() {
    weatherZoomTimers.forEach(t => clearTimeout(t));
    weatherZoomTimers = [];
    const stageBadge = $('radar-zoom-stage-badge');
    if (stageBadge) stageBadge.classList.add('hidden');
    if (weatherAlertOverlayGroup && radarMap) {
        try { radarMap.removeLayer(weatherAlertOverlayGroup); } catch (_) {}
        weatherAlertOverlayGroup = null;
    }
}

export function animateWeatherRadarCountryToUserZoom(mode = 'rain') {
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

    weatherAlertOverlayGroup = L.layerGroup().addTo(radarMap);

    L.circle([targetLat, targetLon], {
        radius: isStorm ? 55000 : 42000,
        color: isStorm ? '#10b981' : '#06b6d4',
        weight: 1,
        opacity: 0.45,
        fillColor: isStorm ? '#10b981' : '#06b6d4',
        fillOpacity: 0.16
    }).addTo(weatherAlertOverlayGroup);

    L.circle([targetLat, targetLon], {
        radius: isStorm ? 28000 : 20000,
        color: '#facc15',
        weight: 1,
        opacity: 0.55,
        fillColor: '#facc15',
        fillOpacity: 0.22
    }).addTo(weatherAlertOverlayGroup);

    L.circle([targetLat, targetLon], {
        radius: isStorm ? 12000 : 8500,
        color: isStorm ? '#ef4444' : '#38bdf8',
        weight: 1.5,
        opacity: 0.75,
        fillColor: isStorm ? '#ef4444' : '#38bdf8',
        fillOpacity: 0.32
    }).addTo(weatherAlertOverlayGroup);

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
    } catch (_) {}

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
        } catch (_) {}
    }, 1850));

    weatherZoomTimers.push(setTimeout(() => {
        if (!radarMap) return;
        if (stageIcon && stageText) {
            stageIcon.className = isStorm
                ? 'fa-solid fa-triangle-exclamation text-red-400 animate-pulse'
                : 'fa-solid fa-location-dot text-emerald-400 animate-pulse';
            stageText.textContent = isStorm
                ? '⛈️ พิกัดของคุณ: ตรวจพบพายุฝนฟ้าคะนองรุนแรงในพื้นที่!'
                : '🌧️ พิกัดของคุณ: มีโอกาสเกิดฝนตกในพื้นที่ของคุณ';
        }
    }, 5150));
}

// ============================================================================
// 20-MINUTE AUTOMATIC RADAR SHOWCASE SCHEDULE (10s DISPLAY)
// ============================================================================

export function triggerRadarShowcase20s(broadcastToAll = false, customTitle = null, weatherZoomMode = null) {
    if (broadcastToAll) {
        emitTriggerNavAlert({
            type: 'showcase-20s',
            title: customTitle || '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ'
        });
    }

    if (!splitRadarOpen) {
        openSplitRadarPanel(false, true);
    }

    setRadarViewMode('map', false);
    radarOverlayVisible = true;
    const toggleRadarOverlay = $('toggle-radar-overlay');
    if (toggleRadarOverlay) toggleRadarOverlay.checked = true;
    showRadarFrame(currentRadarFrameIdx);

    document.body.classList.add('nav-radar-showcase');
    const radarShowcaseBanner = $('radar-showcase-banner');
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
    const showcaseCountdown = $('showcase-countdown');
    if (showcaseCountdown) showcaseCountdown.textContent = String(showcaseRemainingSec);

    const showcaseSubInfo = $('showcase-sub-info');
    if (showcaseSubInfo) {
        const navEtaMins = $('nav-eta-mins');
        const navRemDist = $('nav-rem-dist');
        if (pendingDestination && activeNavigation && !weatherZoomMode) {
            const etaText = navEtaMins ? navEtaMins.textContent : `${pendingDestination.durationMin || '--'} นาที`;
            const remText = navRemDist ? navRemDist.textContent : `${pendingDestination.distanceKm || '--'} กม.`;
            showcaseSubInfo.innerHTML = `เหลือ ${escapeHtml(etaText)} (${escapeHtml(remText)}) • กลับแผงควบคุมใน <strong id="showcase-countdown" class="text-emerald-300 font-mono animate-countdown-pop">${showcaseRemainingSec}</strong> วิ`;
        } else {
            showcaseSubInfo.innerHTML = `ซ่อนแผนที่และกลับไปโชว์แผงควบคุมใน <strong id="showcase-countdown" class="text-emerald-300 font-mono animate-countdown-pop">${showcaseRemainingSec}</strong> วินาที`;
        }
    }

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

export function stopRadarShowcase20s() {
    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = null;
    clearWeatherZoomAnimation();
    document.body.classList.remove('nav-radar-showcase');
    const radarShowcaseBanner = $('radar-showcase-banner');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');
    closeSplitRadarPanel(false);
}

function startAutoShowcaseSchedule() {
    clearInterval(autoShowcaseInterval);
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
    const radarShowcaseBanner = $('radar-showcase-banner');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');
}

export async function openSplitRadarPanel(focusInput = false, skipSync = false) {
    splitRadarOpen = true;
    const radarNavPanel = $('radar-nav-panel');
    if (radarNavPanel) radarNavPanel.classList.remove('hidden');
    document.body.classList.add('split-radar-active');

    initLeafletRadarMap();
    setTimeout(() => { if (radarMap) radarMap.invalidateSize(); }, 60);
    setTimeout(() => { if (radarMap) radarMap.invalidateSize(); }, 380);

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

    const routeLinkInput = $('route-link-input');
    if (focusInput && routeLinkInput) {
        setRadarViewMode('map', !skipSync);
        setTimeout(() => routeLinkInput.focus(), 220);
    }
}

export function closeSplitRadarPanel(skipSync = false) {
    clearInterval(showcaseCountdownTimer);
    showcaseCountdownTimer = null;
    clearWeatherZoomAnimation();
    splitRadarOpen = false;
    document.body.classList.remove('split-radar-active', 'nav-radar-showcase');
    const radarNavPanel = $('radar-nav-panel');
    if (radarNavPanel) radarNavPanel.classList.add('hidden');
    const radarShowcaseBanner = $('radar-showcase-banner');
    if (radarShowcaseBanner) radarShowcaseBanner.classList.add('hidden');

    const sidebarOpenNavBtn = $('sidebar-open-nav-btn');
    if (sidebarOpenNavBtn) {
        sidebarOpenNavBtn.classList.remove('animate-control-return');
        void sidebarOpenNavBtn.offsetWidth;
        sidebarOpenNavBtn.classList.add('animate-control-return');
    }

    if (!skipSync) {
        emitNavStatePatch({ panelOpen: false });
    }
}

// ============================================================================
// OSRM ROUTE & TURN-BY-TURN NAVIGATION
// ============================================================================

export function formatThaiManeuver(step) {
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

export async function fetchOsrmRoute(startLat, startLon, destLat, destLon) {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('ไม่สามารถคำนวณเส้นทางถนนไปยังจุดหมายนี้ได้');
    }
    return data.routes[0];
}

export function drawRouteOnMap(routeGeoJson, destLat, destLon, destName, fitView = true) {
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

export function renderNavStepUI(step) {
    const navStepInput = $('nav-step-input');
    const navStepPreview = $('nav-step-preview');
    const navStepActive = $('nav-step-active');
    if (navStepInput) navStepInput.classList.toggle('hidden', step !== 'input');
    if (navStepPreview) navStepPreview.classList.toggle('hidden', step !== 'preview');
    if (navStepActive) navStepActive.classList.toggle('hidden', step !== 'active');
}

export async function calculateAndPreviewRoute(destLat, destLon, destName) {
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

    const previewDestName = $('preview-dest-name');
    const previewRouteSummary = $('preview-route-summary');
    const previewDuration = $('preview-duration');
    const previewDistance = $('preview-distance');
    const routeLinkInput = $('route-link-input');

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

    analyzeRouteWeatherAhead(route.geometry, startLat, startLon, destLat, destLon, destName);
}

export async function processRouteLinkInput() {
    const routeLinkInput = $('route-link-input');
    const routeCheckIcon = $('route-check-icon');
    const routeCheckBtn = $('route-check-btn');

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

export function updateGpsButtonsStatus(isActive, etaMins, remKm) {
    const sidebarOpenNavBtn = $('sidebar-open-nav-btn');
    const headerRadarBtn = $('header-radar-btn');

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

export function updateLiveNavigationDOM(live) {
    if (!live) return;
    const navEtaMins = $('nav-eta-mins');
    const navRemDist = $('nav-rem-dist');
    const navArrivalTime = $('nav-arrival-time');
    const navNextInstruction = $('nav-next-instruction');
    const navRoadStatus = $('nav-road-status');
    const navProgressPct = $('nav-progress-pct');
    const navProgressFill = $('nav-progress-fill');

    if (navEtaMins) navEtaMins.textContent = `${live.etaMins} นาที`;
    if (navRemDist) navRemDist.textContent = `${live.remKm} กม.`;
    if (navArrivalTime) navArrivalTime.textContent = live.arrivalTime || '--:--';
    if (navNextInstruction) navNextInstruction.textContent = live.instructionText || 'มุ่งหน้าตามเส้นทางหลัก';
    if (navRoadStatus) navRoadStatus.textContent = live.roadStatus || 'สภาพเส้นทางปกติ';

    const pct = Math.min(100, Math.max(0, Number(live.progressPct) || 0));
    if (navProgressPct) navProgressPct.textContent = `${pct}%`;
    if (navProgressFill) navProgressFill.style.width = `${pct}%`;

    // D6. Sync Journey Strip on stage HUD (Compact In-Car Status)
    const stageJourneyStrip = $('stage-journey-strip');
    if (stageJourneyStrip) {
        stageJourneyStrip.classList.remove('hidden');
        const stripDest = $('strip-dest');
        const stripEta = $('strip-eta');
        const stripDist = $('strip-dist');
        const stripWeather = $('strip-weather');

        const destName = pendingDestination?.name || live.destinationName || 'ปลายทาง';
        if (stripDest) stripDest.textContent = `ปลายทาง: ${destName}`;
        if (stripEta) stripEta.textContent = `ถึง ~${live.arrivalTime || '--:--'} (${live.etaMins} นาที)`;
        if (stripDist) stripDist.textContent = `${live.remKm} กม.`;
        if (stripWeather && latestWeatherData?.temp !== undefined) {
            stripWeather.innerHTML = `<i class="fa-solid fa-cloud-sun text-amber-300"></i> ${latestWeatherData.temp}°C`;
        }
    }

    updateGpsButtonsStatus(true, live.etaMins, live.remKm);
}

export async function refreshLiveNavigationRoute() {
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

        emitNavStatePatch({
            step: 'active',
            userCoords,
            weatherInfo: currentWeatherInfo,
            destination: pendingDestination,
            liveRoute: livePayload,
            hasAlerted90Pct
        });

        // Arrival threshold <= 120m
        if (remKmNum <= 0.12) {
            speakThaiText(`คุณเดินทางถึงจุดหมาย ${pendingDestination.name} เรียบร้อยแล้ว`);
            showToast(`🎉 เดินทางถึงจุดหมาย: ${pendingDestination.name}`, 'info');
            cancelNavigation(true);
            return;
        }

        // 90% threshold alert
        if (progressPct >= 90 && !hasAlerted90Pct) {
            hasAlerted90Pct = true;
            playSoftAlertChime('near-90pct');
            const alertMsg = `ใกล้ถึงจุดหมายแล้ว ขณะนี้เดินทางแล้ว ${progressPct} เปอร์เซ็นต์ เหลือเวลาอีกประมาณ ${etaMins} นาที กับระยะทางอีก ${remKm} กิโลเมตร`;
            speakThaiText(alertMsg);
            showToast(`🏁 ใกล้ถึงจุดหมายแล้ว (${progressPct}%)! เหลืออีก ${etaMins} นาที (${remKm} กม.)`, 'info');
            triggerRadarShowcase20s(false, `🏁 ใกล้ถึงจุดหมายแล้ว (${progressPct}%)`);
            emitNavStatePatch({ hasAlerted90Pct: true });
            emitTriggerNavAlert({
                type: 'near-90pct',
                progressPct,
                etaMins,
                remKm,
                destName: pendingDestination.name
            });
            return;
        }

        // Periodic ETA voice reminder
        if (lastSpokenEtaMin === null || Math.abs(lastSpokenEtaMin - etaMins) >= 3) {
            lastSpokenEtaMin = etaMins;
            speakThaiText(`เหลือเวลาเดินทางอีกประมาณ ${etaMins} นาที ระยะทาง ${remKm} กิโลเมตร ${instructionText}`);
        }
    } catch (err) {
        console.warn('Live navigation route update failed:', err.message);
    }
}

export async function startActiveNavigation() {
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
    triggerRadarShowcase20s(true, `🧭 เริ่มนำทาง: ${pendingDestination.name}`);

    clearInterval(navPollTimer);
    navPollTimer = setInterval(() => {
        if (activeNavigation) {
            refreshLiveNavigationRoute();
        }
    }, 10000);
}

export function cancelNavigation(silent = false, skipSync = false) {
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

    const stageJourneyStrip = $('stage-journey-strip');
    if (stageJourneyStrip) stageJourneyStrip.classList.add('hidden');

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

// ============================================================================
// ROUTE WEATHER AHEAD (3-Point Forecast Along Entire Route)
// ============================================================================

export async function fetchQuickPointWeather(lat, lon) {
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

export function renderRouteWeatherAheadUI(routeWeather) {
    const routeWeatherAheadCard = $('route-weather-ahead-card');
    const routeWeatherSummaryBadge = $('route-weather-summary-badge');
    const routeWeatherPointsGrid = $('route-weather-points-grid');

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

export async function analyzeRouteWeatherAhead(routeGeometry, startLat, startLon, destLat, destLon, destName) {
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
            emitTriggerNavAlert({
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

// ============================================================================
// REMOTE NAV STATE RECONCILIATION
// ============================================================================

export async function applyRemoteNavState(remote, isInitial = false) {
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

        const routeLinkInput = $('route-link-input');
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

        if (remote.routeWeatherAhead) {
            renderRouteWeatherAheadUI(remote.routeWeatherAhead);
        } else if (!remote.destination) {
            const rCard = $('route-weather-ahead-card');
            if (rCard) rCard.classList.add('hidden');
        }

        hasAlerted90Pct = Boolean(remote.hasAlerted90Pct);

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

            const previewDestName = $('preview-dest-name');
            const previewRouteSummary = $('preview-route-summary');
            const previewDuration = $('preview-duration');
            const previewDistance = $('preview-distance');

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

// Getters
export function getUserCoords() { return userCoords; }
export function getPendingDestination() { return pendingDestination; }
export function isNavActive() { return activeNavigation; }

// ============================================================================
// INITIALIZATION & DOM BINDINGS
// ============================================================================

export function initMapSubsystem() {
    const headerRadarBtn = $('header-radar-btn');
    const sidebarOpenRadarBtn = $('sidebar-open-radar-btn');
    const sidebarOpenNavBtn = $('sidebar-open-nav-btn');
    const btnCloseRadar = $('btn-close-radar');
    const btnModeMapRadar = $('btn-mode-map-radar');
    const btnModeWindy = $('btn-mode-windy');
    const btnNavTts = $('btn-nav-tts');
    const btnRefreshGps = $('btn-refresh-gps');
    const routeCheckBtn = $('route-check-btn');
    const routeLinkInput = $('route-link-input');
    const navStartBtn = $('nav-start-btn');
    const navCancelPreviewBtn = $('nav-cancel-preview-btn');
    const navStopBtn = $('nav-stop-btn');
    const navPingNowBtn = $('nav-ping-now-btn');
    const btnTriggerShowcase = $('btn-trigger-showcase');
    const btnExitShowcase = $('btn-exit-showcase');
    const radarPlayBtn = $('radar-play-btn');
    const radarPlayIcon = $('radar-play-icon');
    const toggleRadarOverlay = $('toggle-radar-overlay');
    const btnMapStyle = $('btn-map-style');
    const settingsMapStyle = $('settings-map-style');
    const settingsNavTts = $('settings-nav-tts');
    const settingsRefreshGpsBtn = $('settings-refresh-gps-btn');

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
    const btnToggleFullRadar = $('btn-toggle-full-radar');
    if (btnToggleFullRadar) {
        btnToggleFullRadar.addEventListener('click', () => {
            if (splitRadarOpen) closeSplitRadarPanel();
            else openSplitRadarPanel(false);
        });
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
            if (settingsMapStyle) settingsMapStyle.value = next;
        });
    }
    if (settingsMapStyle) {
        settingsMapStyle.addEventListener('change', (e) => {
            initLeafletRadarMap();
            applyMapBaseLayer(e.target.value);
            showToast('เปลี่ยนรูปแบบแผนที่เรียบร้อย', 'info');
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
        });
    }
    if (settingsRefreshGpsBtn) {
        settingsRefreshGpsBtn.addEventListener('click', async () => {
            if (!splitRadarOpen) await openSplitRadarPanel(false);
            await requestUserLocation(true, false);
            showToast('รีเฟรชพิกัด GPS ปัจจุบันเรียบร้อยแล้ว', 'info');
        });
    }

    // Bind Test Lab Simulation Buttons
    const btnTestRainAlert = $('btn-test-rain-alert');
    const btnTest90PctAlert = $('btn-test-90pct-alert');
    const btnTest20mShowcase = $('btn-test-20m-showcase');
    const btnTestSimDrive = $('btn-test-sim-drive');
    const btnTestStormAlert = $('btn-test-storm-alert');
    const btnTestArrivedAlert = $('btn-test-arrived-alert');
    const testSyncAllToggle = $('test-sync-all-toggle');

    if (btnTestRainAlert) {
        btnTestRainAlert.addEventListener('click', async () => {
            const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
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
            emitTriggerNavAlert({
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

    if (btnTest90PctAlert) {
        btnTest90PctAlert.addEventListener('click', async () => {
            const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
            if (!splitRadarOpen) await openSplitRadarPanel(false, true);

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
            emitTriggerNavAlert({
                type: 'near-90pct',
                progressPct: 90,
                etaMins: 5,
                remKm: '2.4',
                destName,
                voiceText: voiceMsg
            });
        });
    }

    if (btnTest20mShowcase) {
        btnTest20mShowcase.addEventListener('click', () => {
            const voiceMsg = 'แสดงแผนที่นำทางและเรดาร์สภาพอากาศ 10 วินาที';
            playSoftAlertChime('rain');
            speakThaiText(voiceMsg, true);
            showToast('👁️ [ทดสอบ] โชว์แผนที่ + เรดาร์อากาศแทนแผงควบคุม 10 วินาที แล้วสลับกลับอัตโนมัติ!', 'info');
            triggerRadarShowcase20s(false, '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ');
            emitTriggerNavAlert({
                type: 'showcase-20s',
                title: '📡 แสดงแผนที่นำทาง & เรดาร์สภาพอากาศ',
                voiceText: voiceMsg
            });
        });
    }

    if (btnTestSimDrive) {
        btnTestSimDrive.addEventListener('click', async () => {
            const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
            clearInterval(simDriveTimer);
            if (!splitRadarOpen) await openSplitRadarPanel(false, true);

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
            emitTriggerNavAlert({
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
                    emitTriggerNavAlert({
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
                        emitTriggerNavAlert({
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

    if (btnTestStormAlert) {
        btnTestStormAlert.addEventListener('click', async () => {
            const syncAll = testSyncAllToggle ? Boolean(testSyncAllToggle.checked) : true;
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
            emitTriggerNavAlert({
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

    if (btnTestArrivedAlert) {
        btnTestArrivedAlert.addEventListener('click', () => {
            const destName = pendingDestination?.name || 'จุดหมายปลายทาง';
            const navProgressPct = $('nav-progress-pct');
            const navProgressFill = $('nav-progress-fill');
            if (navProgressPct) navProgressPct.textContent = '100%';
            if (navProgressFill) navProgressFill.style.width = '100%';
            updateGpsButtonsStatus(true, 0, '0.0');

            const voiceMsg = `คุณเดินทางถึงจุดหมาย ${destName} เรียบร้อยแล้ว`;
            playSoftAlertChime('near-90pct');
            speakThaiText(voiceMsg, true);
            triggerRadarShowcase20s(false, `🎉 ถึงจุดหมาย: ${destName}`);
            showToast(`🎉 [ทดสอบ 100%] เดินทางถึงจุดหมาย: ${destName} เรียบร้อยแล้ว!`, 'info');

            emitTriggerNavAlert({
                type: 'arrived-100pct',
                destName,
                voiceText: voiceMsg
            });
        });
    }

    // Inbound Socket listeners
    const socket = getSocket();
    if (socket) {
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
                const navProgressPct = $('nav-progress-pct');
                const navProgressFill = $('nav-progress-fill');
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
                if (payload.routeWeatherAhead) {
                    renderRouteWeatherAheadUI(payload.routeWeatherAhead);
                }
                showToast(`🌧️ พยากรณ์ตลอดเส้นทาง: ${payload.summary || 'พบโอกาสฝนตกระหว่างทาง'}`, 'info');
            }
        });
    }
}

// Dual alias for main bootstrapping compatibility
export const initMap = initMapSubsystem;
