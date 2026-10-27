---
name: MAITEMBATH GANG PARTY
description: Collaborative In-Car & Night Party Queue Player
colors:
  primary: "#00E5FF"
  primary-deep: "#0284c7"
  base-bg: "#000000"
  surface-card: "#0c111c"
  surface-card-hover: "#131b2c"
  border-subtle: "rgba(56, 189, 248, 0.16)"
  text-primary: "#ffffff"
  text-secondary: "#94a3b8"
  accent-glow: "rgba(0, 229, 255, 0.25)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, Kanit, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "Plus Jakarta Sans, Kanit, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Plus Jakarta Sans, Kanit, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Plus Jakarta Sans, Kanit, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Plus Jakarta Sans, Kanit, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.base-bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-pill:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
  card-panel:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
---

# Design System: MAITEMBATH GANG PARTY

## Overview

**Creative North Star: "The In-Car Cockpit Streamer"**

MAITEMBATH GANG PARTY is an ultra-responsive, collaborative music playback environment engineered for night-time road trips, party sessions, and multi-device in-car environments. The visual language blends pure OLED pitch-black contrast with electric Cyber Cyan accents (inspired by high-end streaming apps such as Tidal and Spotify), eliminating nighttime screen glare while keeping controls crystal clear in glanceable 5-second intervals.

Surfaces exist on deep, semi-translucent glass layers with ultra-thin precision borders. Secondary noise is suppressed so the passenger remote and the host cinema screen provide effortless, friction-free music queueing, democratic vote-skipping, and synchronized road navigation.

**Key Characteristics:**
- **Zero-Glare OLED Pitch Black**: Maximizes battery life on mobile devices and prevents blinding glare in dark car cabins.
- **Glanceable Cyan Visual Hierarchy**: Current playback state, active timers, and primary actions resolve in under 5 seconds without reading small text.
- **Bilingual Typographic Harmony**: Combines geometric `Plus Jakarta Sans` for track timestamps and controls with soft-cornered `Kanit` for Thai lyrics.

## Colors

The palette is anchored by pitch black (`#000000`) and high-luminance Cyber Cyan (`#00E5FF`), balanced by cool slate grays.

### Primary
- **Cyber Sky Blue / Cyan** (`#00E5FF`): The primary active voice of the system. Used strictly for active playback buttons, playhead sliders, dynamic equalizer bars, and focused state borders.
- **Deep Cyan** (`#0284c7`): Hover and pressed states for primary interactive controls.

### Neutral
- **OLED Pitch Black** (`#000000`): The base screen canvas across host cinema mode and mobile client screens.
- **Deep Slate Glass** (`#0c111c` / `rgba(12, 17, 28, 0.88)`): Elevated card panels (`.glass-panel`) housing the queue, now playing details, and navigation controls.
- **Border Cyan Subtle** (`rgba(56, 189, 248, 0.16)`): Crisp, 1px structural frame separating cards without heavy drop-shadow clutter.
- **Text Primary** (`#FFFFFF`): High-contrast song titles, modal headings, and player timestamps.
- **Text Secondary** (`#94A3B8` / `#E2F1FF`): Artist names, helper descriptions, and unselected tab icons.

### Named Rules
**The Rarity Rule.** The primary accent (`#00E5FF`) covers no more than 8% of the surface area at any time. Its exclusivity is what guarantees 5-second glanceability.

## Typography

**Display / Latin Font:** Plus Jakarta Sans (with system fallbacks)  
**Thai & Lyric Font:** Kanit (Google Fonts)  
**Character:** Clean, international geometric clarity with friendly humanist warmth for Thai text.

### Hierarchy
- **Display** (700, 2rem / 32px, 1.25): Modal titles and hero splash screen headings.
- **Headline** (700, 1.5rem / 24px, 1.3): Host cinema video titles and section headers.
- **Title** (600, 1.125rem / 18px, 1.4): Active track title in sidebar and now-playing card.
- **Body** (400/500, 0.875rem / 14px, 1.4): Queue item track titles, settings labels, and lyric lines.
- **Label** (600, 0.75rem / 12px, 0.05em tracking): Badge pills, duration counters (`03:42`), and quality tags (`1080p`).

### Named Rules
**The No-Mystery Numerals Rule.** All counters, track durations, and speed badges must render in monospaced or tabular numerical forms using `Plus Jakarta Sans` to prevent layout jitter during live playback.

## Layout

- **Desktop & Host Viewport**: Split layout with a flexible video cinema area on the left (`#player-area`) and an elevated 380px command sidebar on the right (`#sidebar`).
- **Mobile In-Car Client**: Full-height bottom-nav app shell (`calc(100dvh - 52px)`) with fixed 3-tab navigation (`#mobile-nav-bar`) eliminating nested scrolling.
- **Rhythm**: Base 4px scale, with `8px` (`sm`), `12px` (`md`), and `16px` (`lg`) standard spacing. Containers require a minimum of `12px` (`px-3`) internal padding to prevent cramped borders.

## Elevation & Depth

Surfaces rely on structural tonal layering and frosted glassmorphism rather than muddy drop-shadows.

### Shadow Vocabulary
- **Card Panel Elevation** (`box-shadow: 0 10px 30px 0 rgba(0, 0, 0, 0.75), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)`): Standard elevated glass panel.
- **Active Glow** (`box-shadow: 0 0 12px rgba(0, 229, 255, 0.35)`): Only applied to active playhead thumbs and live recording/sync indicators.

### Named Rules
**The Flat-at-Rest Rule.** All cards and queue rows remain flat at rest with subtle 1px border outlines. Atmospheric glow appears only on active interaction or active playing indicators.

## Shapes

- **Card Panels**: Medium-large rounded corners (`14px` / `rounded-xl`).
- **Action Buttons & Inputs**: Medium rounded corners (`8px` to `10px`).
- **Pills & Badges**: Fully rounded capsules (`9999px` / `rounded-full`).

## Components

### Primary Buttons
- **Shape**: Rounded capsule (`rounded-full`) or smooth rounded rectangle (`rounded-lg`).
- **Primary**: Solid Cyan `#00E5FF` background with black text `#000000`, 8px 16px padding.
- **Hover/Active**: Transition `scale-95 duration-150` with slight brightness shift.

### Pill Badges
- **Style**: Ultra-thin border (`border border-cyan-500/30`), background `rgba(12, 17, 28, 0.9)`, text `#00E5FF`.
- **Purpose**: Displays live stream quality, vote-skip threshold, and lyrics overlay status.

### Queue Rows
- **Layout**: Horizontal flex with thumbnail (48x36px), title, duration, and one-click vote/move actions.
- **Playing Row**: Bordered with active cyan accent and animated 8-bar SVG waveform equalizer.

## Do's and Don'ts

### Do:
- **Do** use `rgba(12, 17, 28, 0.88)` for card backgrounds with `border: 1px solid rgba(56, 189, 248, 0.16)`.
- **Do** provide at least 12px padding inside fixed header and sticky container wrappers.
- **Do** use `animate-pulse` for subtle radar pins and beacon indicators instead of `animate-bounce`.

### Don't:
- **Don't** use colored neon halos or heavy blurred glow on inactive elements.
- **Don't** use pure white backgrounds anywhere in the application interface.
- **Don't** introduce nested scrollbars inside the mobile client remote view.
