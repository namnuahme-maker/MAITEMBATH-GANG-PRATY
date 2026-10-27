# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary users are groups of friends, road-trippers, and party crews ("MAITEMBATH GANG") traveling together in vehicles or gathering for celebrations. In a shared vehicle cabin or party setting, one central host device serves as the primary stage and navigation console, while passengers and guests use their personal mobile phones as remote controls to queue songs, broadcast danmaku comments, trigger sound effects, and follow the trip progress.

## Product Purpose
MAITEMBATH GANG PARTY serves as a centralized, collaborative in-cabin party entertainment and journey console. It eliminates the friction of single-device AUX-cord djing and fragmented navigation during road trips by allowing every passenger in the vehicle to participate in real-time music curation, karaoke singing, screen banter, and route tracking without interrupting the driver.

## Positioning
Unlike generic playlist apps or isolated media players, MAITEMBATH GANG PARTY bridges synchronized YouTube video/music playback with road party rituals: flying danmaku bullet comments, Thai text-to-speech queue announcements, instant soundboard audio triggers, karaoke lyrics overlay, and live weather radar with GPS route navigation within a unified real-time ecosystem.

## Operating Context
- Central Display: Dashboard-mounted tablet, vehicle infotainment screen, or party room display running the host interface (video player, animated radar/map panel, danmaku canvas).
- Passenger Remotes: Mobile browsers connected over the local network via QR code pairing in dedicated client mode (`client-mode`) for searching/adding songs, adjusting volume, firing emojis, and triggering sound effects.
- Environment: Dynamic, moving automotive cabins or lively party gatherings requiring glanceable displays, high contrast, resilient playback fallback, and passenger-delegated interactions.

## Capabilities and Constraints
- Centralized real-time playback synchronization via Node.js and Socket.IO.
- YouTube video/audio stream extraction and direct playback with automatic fallback mechanisms (youtubei.js / yt-dlp).
- Flying Danmaku bullet comment engine across the main video viewport.
- Real-time soundboard audio triggers and animated floating emoji reactions.
- Synchronized lyrics display with toggleable karaoke mode.
- Thai Text-to-Speech (`/api/tts-thai`) automated voice announcements for queue additions and events.
- AutoDJ playlist generation and continuous party mix automation.
- Live GPS tracking, Leaflet map navigation, route resolution (`/api/resolve-route`), and weather radar overlay.
- Low-latency WebSocket controls with mobile-friendly remote client view.

## Brand Commitments
- Identity: "MAITEMBATH GANG PARTY" / "PNR JAPAN".
- Asset: `public/PNRJAPANLOGO.png` and `public/favicon.ico`.
- Typography: Kanit font family supporting modern Thai and English typography.
- Voice & Tone: High-energy, playful, communal, and direct Thai party/crew vibe.

## Evidence on Hand
- Incumbent full-stack web implementation:
  - `server.js`: Node.js Express backend with Socket.IO orchestration, YouTube stream resolution, Thai TTS, lyrics endpoint, and route planning.
  - `public/index.html`: Host and client remote UI layouts, responsive breakpoints, Tailwind styles, and visual assets.
  - `public/app.js`: Client-side logic for player management, socket synchronization, Leaflet maps, and danmaku rendering.
  - `public/PNRJAPANLOGO.png`: Brand mark and icon.
- Absence: No external production deployment URLs or formal customer testimonials currently committed.

## Product Principles
- Shared Cabin Ownership: Every passenger has an immediate voice in the music and atmosphere; no single person hoards the queue or passes around an unlocked phone.
- High-Energy Glanceability: Main screen data and media remain immediately readable at high speed and under varying lighting conditions with strong contrast and purposeful hierarchy.
- Unbroken Party Flow: Video and music playback fall back gracefully (AutoDJ, alternative stream resolvers) to prevent silence during network interruptions or YouTube throttling.
- Synchronized Dual-Role Experience: Seamless real-time coordination between the main Stage display and lightweight mobile Remote devices.

## Accessibility & Inclusion
- High legibility for Thai and Latin text via Kanit font with clear hierarchy and generous touch target sizes for mobile passengers in moving vehicles.
- Clear visual cues and audio confirmations for actions in high-noise environments.
