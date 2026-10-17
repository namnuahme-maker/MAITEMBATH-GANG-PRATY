/**
 * MAITEMBATH GANG PARTY - Avatars Module (public/js/avatars.js)
 * 
 * Provides:
 * - Curated neon/cyberpunk preset avatars as SVG Data URIs
 * - Client-side image cropping & resizing to lightweight avatar Data URLs
 * - Avatar fallback initials helper
 */

function svgToDataUrl(svgString) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim());
}

export const AVATAR_PRESETS = [
    {
        id: 'dj-cat',
        label: 'DJ Cat 🎧',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_cat" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#030712"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="g_cat" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="100%" stop-color="#A855F7"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_cat)" stroke="#00E5FF" stroke-width="2.5"/>
  <polygon points="26,38 36,16 46,34" fill="#A855F7"/>
  <polygon points="54,34 64,16 74,38" fill="#A855F7"/>
  <polygon points="30,36 37,22 43,34" fill="#f472b6"/>
  <polygon points="57,34 63,22 70,36" fill="#f472b6"/>
  <circle cx="50" cy="54" r="26" fill="url(#g_cat)"/>
  <path d="M 22 52 A 28 28 0 0 1 78 52" fill="none" stroke="#f43f5e" stroke-width="5" stroke-linecap="round"/>
  <rect x="18" y="44" width="8" height="18" rx="4" fill="#f43f5e"/>
  <rect x="74" y="44" width="8" height="18" rx="4" fill="#f43f5e"/>
  <rect x="33" y="47" width="14" height="10" rx="3" fill="#000" stroke="#00E5FF" stroke-width="1.5"/>
  <rect x="53" y="47" width="14" height="10" rx="3" fill="#000" stroke="#00E5FF" stroke-width="1.5"/>
  <line x1="47" y1="51" x2="53" y2="51" stroke="#00E5FF" stroke-width="2"/>
  <polygon points="48,63 52,63 50,65" fill="#f472b6"/>
  <path d="M 45 68 Q 50 72 55 68" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
</svg>`)
    },
    {
        id: 'cyber-astro',
        label: 'Astro 🚀',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_astro" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="g_visor" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="50%" stop-color="#ec4899"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_astro)" stroke="#38bdf8" stroke-width="2.5"/>
  <rect x="25" y="24" width="50" height="52" rx="22" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/>
  <rect x="31" y="32" width="38" height="32" rx="14" fill="url(#g_visor)" stroke="#000" stroke-width="2"/>
  <path d="M 36 38 Q 45 35 52 38" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="21" cy="50" r="5" fill="#00E5FF"/>
  <circle cx="79" cy="50" r="5" fill="#00E5FF"/>
  <path d="M 38 80 Q 50 84 62 80" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>
</svg>`)
    },
    {
        id: 'neon-fox',
        label: 'Neon Fox 🦊',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_fox" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18040d"/>
      <stop offset="100%" stop-color="#2d0617"/>
    </linearGradient>
    <linearGradient id="g_fox" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_fox)" stroke="#f43f5e" stroke-width="2.5"/>
  <polygon points="20,40 28,14 44,32" fill="url(#g_fox)"/>
  <polygon points="56,32 72,14 80,40" fill="url(#g_fox)"/>
  <polygon points="26,38 31,21 40,32" fill="#fed7aa"/>
  <polygon points="60,32 69,21 74,38" fill="#fed7aa"/>
  <polygon points="22,46 50,84 78,46" fill="url(#g_fox)"/>
  <polygon points="32,46 50,78 40,46" fill="#fff"/>
  <polygon points="68,46 50,78 60,46" fill="#fff"/>
  <ellipse cx="38" cy="50" rx="3.5" ry="4.5" fill="#000"/>
  <ellipse cx="62" cy="50" rx="3.5" ry="4.5" fill="#000"/>
  <circle cx="39" cy="49" r="1.2" fill="#fff"/>
  <circle cx="63" cy="49" r="1.2" fill="#fff"/>
  <circle cx="50" cy="76" r="3.5" fill="#18181b"/>
</svg>`)
    },
    {
        id: 'chill-panda',
        label: 'Panda 🐼',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_panda" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#022c22"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_panda)" stroke="#10b981" stroke-width="2.5"/>
  <circle cx="28" cy="30" r="12" fill="#18181b"/>
  <circle cx="72" cy="30" r="12" fill="#18181b"/>
  <circle cx="50" cy="56" r="28" fill="#f8fafc"/>
  <ellipse cx="38" cy="52" rx="7" ry="9" fill="#18181b" transform="rotate(-15 38 52)"/>
  <ellipse cx="62" cy="52" rx="7" ry="9" fill="#18181b" transform="rotate(15 62 52)"/>
  <circle cx="38" cy="51" r="2.5" fill="#10b981"/>
  <circle cx="62" cy="51" r="2.5" fill="#10b981"/>
  <ellipse cx="50" cy="65" rx="5" ry="3.5" fill="#18181b"/>
  <path d="M 45 72 Q 50 76 55 72" fill="none" stroke="#18181b" stroke-width="2" stroke-linecap="round"/>
</svg>`)
    },
    {
        id: 'rock-star',
        label: 'Rockstar 🎸',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_rock" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1f1300"/>
      <stop offset="100%" stop-color="#451a03"/>
    </linearGradient>
    <linearGradient id="g_flame" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="50%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_rock)" stroke="#fbbf24" stroke-width="2.5"/>
  <path d="M 50 16 Q 62 34 56 46 Q 66 38 72 52 Q 78 68 62 82 Q 50 90 38 82 Q 22 68 28 52 Q 34 38 44 46 Q 38 34 50 16 Z" fill="url(#g_flame)"/>
  <polygon points="50,34 55,47 69,47 58,56 62,69 50,60 38,69 42,56 31,47 45,47" fill="#fff"/>
  <circle cx="50" cy="54" r="5" fill="#000"/>
</svg>`)
    },
    {
        id: 'pixel-bot',
        label: 'Cyber Bot 👾',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_bot" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0c1b"/>
      <stop offset="100%" stop-color="#241442"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_bot)" stroke="#a855f7" stroke-width="2.5"/>
  <rect x="47" y="16" width="6" height="12" fill="#a855f7"/>
  <circle cx="50" cy="15" r="5" fill="#00E5FF"/>
  <rect x="26" y="28" width="48" height="42" rx="10" fill="#1e1b4b" stroke="#a855f7" stroke-width="2.5"/>
  <rect x="33" y="38" width="12" height="10" rx="3" fill="#00E5FF"/>
  <rect x="55" y="38" width="12" height="10" rx="3" fill="#00E5FF"/>
  <line x1="36" y1="58" x2="64" y2="58" stroke="#f43f5e" stroke-width="3" stroke-linecap="round"/>
  <rect x="18" y="44" width="8" height="12" rx="3" fill="#a855f7"/>
  <rect x="74" y="44" width="8" height="12" rx="3" fill="#a855f7"/>
</svg>`)
    },
    {
        id: 'star-singer',
        label: 'Pop Star 🎤',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_star" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e102d"/>
      <stop offset="100%" stop-color="#4a044e"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_star)" stroke="#ec4899" stroke-width="2.5"/>
  <circle cx="50" cy="38" r="16" fill="#f43f5e" stroke="#fff" stroke-width="2"/>
  <line x1="40" y1="38" x2="60" y2="38" stroke="#fff" stroke-width="1.5"/>
  <line x1="50" y1="28" x2="50" y2="48" stroke="#fff" stroke-width="1.5"/>
  <polygon points="44,52 56,52 52,78 48,78" fill="#a855f7"/>
  <polygon points="46,78 54,78 55,86 45,86" fill="#64748b"/>
  <!-- Sparkles -->
  <polygon points="26,30 28,34 32,36 28,38 26,42 24,38 20,36 24,34" fill="#fde047"/>
  <polygon points="74,26 75,29 78,30 75,31 74,34 73,31 70,30 73,29" fill="#00E5FF"/>
</svg>`)
    },
    {
        id: 'speed-racer',
        label: 'Driver 🚗',
        dataUrl: svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg_drive" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#021a24"/>
      <stop offset="100%" stop-color="#083344"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg_drive)" stroke="#06b6d4" stroke-width="2.5"/>
  <rect x="26" y="32" width="48" height="40" rx="14" fill="#0e7490"/>
  <path d="M 28 42 Q 50 36 72 42" stroke="#22d3ee" stroke-width="3" fill="none"/>
  <ellipse cx="40" cy="48" rx="8" ry="6" fill="#000" stroke="#00E5FF" stroke-width="2"/>
  <ellipse cx="60" cy="48" rx="8" ry="6" fill="#000" stroke="#00E5FF" stroke-width="2"/>
  <line x1="48" y1="48" x2="52" y2="48" stroke="#00E5FF" stroke-width="2"/>
  <path d="M 40 64 Q 50 69 60 64" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
</svg>`)
    }
];

/**
 * Resize and compress user-selected photo into a clean 128x128 square Data URL
 * @param {File|Blob} file 
 * @returns {Promise<string>} Base64 image data URL
 */
export function resizeImageToAvatarDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            return reject(new Error('ไฟล์ที่เลือกไม่ใช่รูปภาพที่ถูกต้อง'));
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('ไม่สามารถโหลดรูปภาพได้'));
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const size = 128;
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');

                    // Calculate center square crop
                    const minDim = Math.min(img.width, img.height);
                    const sx = (img.width - minDim) / 2;
                    const sy = (img.height - minDim) / 2;

                    ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                    // Export as JPEG with 0.85 quality for sharp look under 15KB
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    resolve(dataUrl);
                } catch (err) {
                    reject(err);
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Get display initial letter from username
 * @param {string} name 
 * @returns {string} 1 character
 */
export function getAvatarInitial(name) {
    if (!name || typeof name !== 'string') return 'U';
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : 'U';
}
