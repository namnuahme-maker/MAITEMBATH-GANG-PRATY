# BASE44 MASTER SPECIFICATION: MAITEMBATH GANG PARTY
> **Collaborative In-Car Cockpit Streamer & Road Trip Music/Video Player**  
> *Complete Single-File Blueprint for Base44 / AI App Builders*

---

## 1. Project Overview & Meta Prompt for Base44

### 1.1 Meta Prompt for Base44
```text
Act as an elite full-stack engineer and UI/UX designer. Build a complete, production-grade collaborative music and video player web application named "MAITEMBATH GANG PARTY". Follow all technical specifications, Socket.IO contracts, dual-mode client layouts, and design tokens outlined in this document.
```

### 1.2 Core Vision & Identity
* **Project Name:** `MAITEMBATH GANG PARTY` (Package name: `collaborative-queue-player`)
* **Theme / Creative North Star:** *"The In-Car Cockpit Streamer"*
* **Problem Solved:** Eliminates the friction of passing an unlocked phone or AUX cord around a vehicle during road trips or parties.
* **Dual-Experience Model:**
  1. **Host Cinema Display (Stage Mode):** Runs on a vehicle dashboard tablet, car infotainment screen, laptop, or party room TV. Displays high-definition video/audio playback, flying Danmaku comments, synchronized karaoke lyrics, and a live GPS weather radar map.
  2. **Passenger Remote Control (Client Mode):** Passengers scan a QR code on the host screen using their personal smartphones. Opens a lightweight, mobile-first web remote (zero app install required) to search YouTube, add songs, reorder queues, vote to skip, trigger DJ soundboard SFX, and fire floating emoji reactions in real-time.

---

## 2. System Architecture & Tech Stack

```
+-------------------------------------------------------------+
|                      CLIENT ECOSYSTEM                       |
|                                                             |
|  [Host Stage / Cinema View]        [Passenger Mobile View]  |
|  - HTML5 <video> / IFrame          - Bottom-Nav Remote UI   |
|  - Danmaku Canvas Layer            - Search & Add Songs     |
|  - Synced Lyrics Overlay           - Touch Queue Reorder    |
|  - Leaflet GPS Radar               - Soundboard & Reactions |
+------------------------------+------------------------------+
                               | WebSockets (Socket.IO)
                               v
+-------------------------------------------------------------+
|                     NODE.JS BACKEND                         |
|                                                             |
|  [Express Server]                                           |
|  - Static asset serving (public/)                           |
|  - QR Code generator endpoint (/api/qr)                     |
|  - Synced LRC lyrics endpoint (/api/lyrics)                 |
|  - Thai TTS announcement endpoint (/api/tts-thai)           |
|  - Route planning proxy (/api/resolve-route)                |
|                                                             |
|  [Socket.IO Real-time Orchestrator]                         |
|  - Central playback state (currentTime, isPlaying, volume)  |
|  - Collaborative queue & 50-item playback history store     |
|  - Dynamic vote-skip quorum calculator                      |
|  - User connection registry & rate-limiters                 |
|                                                             |
|  [Streaming & Extraction Engine]                            |
|  - yt-dlp & youtubei.js (Direct 1080p stream extraction)   |
|  - Stream URL LRU cache (with expiration)                   |
|  - YouTube IFrame API fallback                              |
+-------------------------------------------------------------+
```

### Technology Matrix
* **Runtime & Backend:** Node.js (v18+) with Express.
* **Real-time Protocol:** Socket.IO v4.
* **Stream Extractor:** `yt-dlp` CLI (primary) with `youtubei.js` (Innertube fallback).
* **Frontend Core:** Pure Vanilla JavaScript using modular ES6 Modules (`public/js/*.js`).
* **Styling & Icons:** Tailwind CSS + Lucide Icons / FontAwesome SVG.
* **Maps & Geo:** Leaflet.js with OpenStreetMap tiles, Open-Meteo API, and RainViewer radar overlays.
* **Audio Processing:** Web Audio API (for automatic music ducking during SFX/TTS and intro synthesizer).

---

## 3. Comprehensive Feature Specifications

### 3.1 Hybrid Video/Audio Streaming Engine
* **Direct HD Video Playback:** Resolves direct MP4 / WebM stream URLs up to 1080p / 1440p 60fps directly into an HTML5 `<video>` tag.
* **YouTube IFrame API Fallback:** If YouTube throttles or blocks direct stream extraction, the player automatically toggles to an embedded YouTube IFrame player without stopping playback or disconnecting clients.
* **Stream URL Cache:** In-memory LRU map caching direct video/audio URLs for 2-4 hours to ensure instantaneous playback when tracks are repeated.
* **Web Audio API Ducking:** When a DJ sound effect or Thai TTS announcement is triggered:
  1. Primary music volume smoothly ramps down to 25% over 150ms.
  2. The sound effect or voice announcement plays at full volume.
  3. Once completed, music volume smoothly ramps back up to 100% over 300ms.

### 3.2 Collaborative Queue Suite
* **Multi-User FIFO Queue:** Accepts YouTube URLs (standard, `youtu.be`, mobile, Shorts, YouTube Music) and query searches.
* **Visual Drag & Drop + Touch Reordering:**
  * Desktop: HTML5 Drag & Drop on queue cards.
  * Mobile: Touch grip handles (`⋮⋮`) with touch-drag support.
  * Host Quick Controls: Dedicated Move Up / Move Down buttons on each queue item.
* **Conflict-Free Atomicity:** When an item is moved, the client sends `reorder-queue` with ordered IDs. The server validates, reconciles against concurrent additions, and broadcasts `state-update`.
* **AutoDJ Continuous Mix:** When the queue reaches 0 tracks, AutoDJ fetches related YouTube tracks based on the last played song to prevent awkward silence.
* **Playback History (50 Tracks):** Stores up to 50 recently played tracks on the server with timestamp and adder metadata. Features a 1-click "Re-queue" button.
* **Local Favorites Drawer:** Allows passengers to bookmark tracks in their device's `localStorage` and rapidly enqueue them to the live room.

### 3.3 Democratic Vote-to-Skip Quorum
* Any passenger can toggle their vote to skip the current track (`vote-skip`).
* **Dynamic Quorum Calculation:**
  $$\text{Required Votes} = \max\left(1, \left\lfloor \frac{\text{Connected Passengers}}{2} \right\rfloor + 1\right)$$
* If a passenger disconnects while having an active vote, the server automatically decrements their vote and re-evaluates the quorum immediately.

### 3.4 Party Screen Banter & Interactivity
* **Flying Danmaku Bullet Comments:**
  * Messages fly horizontally across the video viewport from right to left in randomly assigned vertical lanes.
  * Customizable colors (Neon Cyan, Pink, Lime, Gold, White).
  * Rate limited to 1 message per second per client to prevent spamming.
  * Strict HTML/XSS sanitization before DOM injection.
* **Floating Emoji Reactions:** Tapping emoji buttons (🔥, ❤️, 😂, 🎉, 🚀) spawns animated floating icons drifting upward on all screens.
* **DJ Soundboard:** 6-12 instant sound triggers (Airhorn, Siren, DJ Scratch, Laugh, Rimshot, Thai EDM whistle) with automatic audio ducking.
* **Thai Text-to-Speech (TTS):** Server-side `/api/tts-thai` generates automated voice cues (e.g., *"คุณ Alice ได้เพิ่มเพลง ทรงอย่างแบด เข้าสู่คิวแล้วค่ะ"*).

### 3.5 Synced Karaoke Lyrics
* Automatic fetching of `.lrc` synced lyrics via `/api/lyrics?title=...&artist=...`.
* **100ms Karaoke Ticker:** High-frequency timer checks `currentTime` against timestamps.
* **Visual Text Wipe:** Active lyric line highlights with a left-to-right gradient wipe matching singer timing.

### 3.6 In-Car Cockpit Map & Weather Radar
* Embedded Leaflet.js map tracking vehicle GPS location and speed (km/h).
* **Live Weather Radar Overlay:** Integrates RainViewer radar tile layers and Open-Meteo precipitation forecasts.
* **Hazard & Turn Alerts:** Driver/Host or passengers can broadcast road hazard warnings ("โค้งอันตราย", "ข้างหน้ามีด่าน", "ฝนตกหนัก") directly to all passenger phones.

### 3.7 Resilient Network Reconnection
* Automatic Socket.IO reconnection with exponential backoff when passing through tunnels or dead zones.
* On `'connect'`, client immediately re-emits cached `set-profile` and emits `request-state`.
* If local playback drifts by $> 2.0$ seconds from the server state, client seeks smoothly to align.

---

## 4. UI/UX Design System: "Zero-Glare OLED Cockpit"

### 4.1 Color Tokens
```yaml
colors:
  base-bg: "#000000"                # 100% OLED pitch black canvas (no night glare)
  primary-cyan: "#00E5FF"           # Cyber Sky Blue (active controls, playhead, active tab)
  primary-hover: "#0284c7"          # Pressed/hover cyan
  surface-card: "rgba(12, 17, 28, 0.88)" # Frosted slate glassmorphism
  border-subtle: "rgba(56, 189, 248, 0.16)" # 1px crisp card borders
  text-primary: "#FFFFFF"           # High contrast headers and active song titles
  text-secondary: "#94A3B8"         # Artist names, unselected tabs, secondary captions
```

### 4.2 The 8% Rarity Rule
> **Crucial Rule:** The high-luminance Cyber Cyan accent (`#00E5FF`) must NEVER cover more than 8% of the viewport area at any time. This guarantees instant 5-second glanceability without blinding the driver at night.

### 4.3 Typography
* **Latin / Numerals / Timestamps:** `Plus Jakarta Sans` (Tabular / Monospaced numerals to eliminate layout jitter during live playback).
* **Thai / Lyrics / Banter:** `Kanit` (Google Fonts, friendly humanist warmth and supreme legibility).

### 4.4 Viewport Layout Specs
* **Desktop / Host Cinema Mode:**
  * Left area: Flexible video stage with overlay layers (Danmaku canvas, lyrics pill, radar PIP).
  * Right area: Elevated 380px command sidebar housing Now Playing card, live queue list, and room QR code.
* **Mobile Passenger View:**
  * Viewport locked to `100dvh` (Zero double-scrollbars).
  * Fixed bottom navigation bar with 3 primary tabs:
    1. `Queue` (List, Reorder, Vote Skip)
    2. `Search & Add` (YouTube search, Paste URL, Favorites)
    3. `Party FX` (Soundboard, Danmaku input, Emojis, Driver Alerts)

---

## 5. Socket.IO Protocol Specification (API Contract)

### 5.1 Client -> Server Events
| Event Name | Payload Format | Description |
|---|---|---|
| `set-profile` | `{ name: string, color: string, avatar: string }` | Registers passenger name, color theme, and icon. |
| `add-to-queue` | `{ url: string, addedBy: string }` | Enqueues a track from YouTube URL or ID. |
| `reorder-queue` | `{ queueIds: string[] }` | Submits complete reordered array of queue item IDs. |
| `move-track` | `{ itemId: string, direction: "up" \| "down" }` | Moves a single queue item up or down. |
| `remove-track` | `{ itemId: string }` | Removes track from queue. |
| `clear-queue` | `{}` | Clears all pending tracks in queue. |
| `play-control` | `{ action: "play" \| "pause" \| "seek", time?: number }` | Controls active playback state. |
| `vote-skip` | `{}` | Toggles sender's vote to skip current song. |
| `send-danmaku` | `{ text: string, color: string }` | Broadcasts bullet comment across host screen. |
| `send-reaction` | `{ emoji: string }` | Fires floating emoji animation. |
| `trigger-sfx` | `{ sfxId: string }` | Triggers DJ sound effect and music ducking. |
| `request-state` | `{}` | Requests full state snapshot upon reconnect. |
| `autodj-config` | `{ enabled: boolean }` | Toggles AutoDJ continuous mix mode. |

### 5.2 Server -> Client Events
| Event Name | Payload Format | Description |
|---|---|---|
| `state-update` | `{ currentVideo: object, isPlaying: boolean, currentTime: number, queue: array, history: array, autoDjEnabled: boolean }` | Broadcasted on any playback, queue, or history mutation. |
| `users-update` | `{ [socketId]: { name: string, color: string, avatar: string } }` | Connected passenger roster. |
| `vote-skip-update` | `{ current: number, required: number, votedUsers: string[] }` | Real-time vote skip progress. |
| `danmaku-broadcast` | `{ id: string, text: string, color: string, senderName: string }` | Renders bullet comment on video. |
| `reaction-broadcast` | `{ emoji: string, senderColor: string }` | Spawns floating emoji particle. |
| `sfx-broadcast` | `{ sfxId: string, duckAudio: boolean }` | Plays sound effect on connected audio devices. |
| `show-toast-broadcast` | `string` | Displays toast message (e.g. vote quorum reached). |

---

## 6. Project Directory & Modular Code Layout

```
├── server.js                        # Express & Socket.IO backend + Stream Resolver
├── package.json                     # Dependencies (express, socket.io, youtubei.js, qrcode)
├── public/
│   ├── index.html                   # Dual-mode single page app (Host & Mobile remote)
│   ├── PNRJAPANLOGO.png             # Logo mark
│   ├── favicon.ico
│   ├── style.css                    # Custom CSS & keyframe animations
│   └── js/                          # Modular ES Architecture
│       ├── main.js                  # Entry bootstrapper & module coordinator
│       ├── state.js                 # Centralized reactive state store
│       ├── socket.js                # Socket.IO connection & auto-reconciliation
│       ├── audio.js                 # Dual-player (HTML5 Video + IFrame + Web Audio Ducking)
│       ├── queue.js                 # Queue rendering, Drag-and-Drop, Touch reordering
│       ├── history.js               # 50-item playback history drawer & 1-click re-queue
│       ├── favorites.js             # LocalStorage bookmarks drawer
│       ├── lyrics.js                # LRC parser & Karaoke visual text wipe
│       ├── map.js                   # Leaflet GPS tracker, Weather radar & Route alerts
│       ├── ui.js                    # Danmaku bullet engine, Floating emojis, Soundboard
│       └── avatars.js               # Passenger avatar generator & color presets
```

---

## 7. Step-by-Step Implementation Guide for Base44

1. **Step 1: Backend Foundation (`server.js`)**
   * Set up Express app and HTTP server wrapped with Socket.IO.
   * Implement stream extractor with `yt-dlp` spawn and `youtubei.js` fallback.
   * Implement state store (`state = { currentVideo, isPlaying, currentTime, queue, history, autoDjEnabled }`).
   * Bind Socket.IO handlers matching Section 5.

2. **Step 2: Dual Viewport Architecture (`public/index.html`)**
   * Build responsive layout with CSS media queries and URL parameter toggle (`?mode=remote` or dynamic viewport detection).
   * Include video player container (`#player-area`) with overlaid Danmaku canvas (`#danmaku-layer`) and lyrics container.
   * Create mobile bottom-navigation app shell for passengers.

3. **Step 3: Core Client State & Networking (`public/js/state.js`, `socket.js`)**
   * Implement reactive pub/sub event bus in `state.js`.
   * Connect to Socket.IO with auto-reconnect listeners in `socket.js`.
   * Re-emit profile and trigger `request-state` on every reconnect.

4. **Step 4: Hybrid Audio & Video Player (`public/js/audio.js`)**
   * Initialize native `<video>` element and hidden YouTube IFrame fallback.
   * Wire Web Audio API `GainNode` to handle audio ducking when soundboard effects play.

5. **Step 5: Queue Suite & Democracy (`public/js/queue.js`, `history.js`, `favorites.js`)**
   * Render queue items with drag handles, delete, and move buttons.
   * Wire HTML5 and Touch drag-and-drop to emit `reorder-queue`.
   * Hook up vote-to-skip button with animated progress bar reflecting quorum.

6. **Step 6: Party Interactivity & Danmaku (`public/js/ui.js`, `lyrics.js`)**
   * Implement Danmaku comment flight animation using CSS transforms (`translateX`).
   * Add floating emoji reaction generator.
   * Implement 100ms lyrics ticker with left-to-right visual text wipe.

7. **Step 7: In-Car Navigation & Weather (`public/js/map.js`)**
   * Initialize Leaflet map with dark OpenStreetMap tiles.
   * Overlay RainViewer precipitation radar layer.
   * Add GPS speedometer and route hazard alert triggers.
