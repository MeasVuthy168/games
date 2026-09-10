// js/themes.js — data-driven piece & board theme registries.
//
// pieceThemes has four entries, boardThemes has five. The shapes are
// deliberately generic (id/name + how to resolve an asset) so a theme can
// be appended here without touching any selection/UI code in ui.js or
// settings.js — nothing here is a placeholder for fake content.

const PIECE_FILE_KEY = { K: 'king', M: 'queen', S: 'bishop', R: 'rook', N: 'knight', P: 'pawn' };

// `colors` names each side by what this theme's pieces actually look like
// (Classic/Plain Wood keep the traditional ស/ខ្មៅ "White/Black" — Silver &
// Gold and Red & Blue clearly aren't either of those) — `short` matches the
// compact " · ខ្មៅ"-style suffix already used on the Play page header,
// `label` the fuller "ខ្មៅ (Black)" form used in the Home page's color-pick
// buttons, `hex` a representative swatch color for that same picker.
export const pieceThemes = [
  {
    id: 'classic', name: 'Classic', dir: 'assets/pieces',
    colors: {
      w: { short: 'ស', label: 'ស (White)', hex: '#fdfdfd' },
      b: { short: 'ខ្មៅ', label: 'ខ្មៅ (Black)', hex: '#20242c' },
    },
  },
  {
    id: 'plain-wood', name: 'Plain Wood', dir: 'assets/pieces-plain',
    colors: {
      w: { short: 'ស', label: 'ស (White)', hex: '#fdfdfd' },
      b: { short: 'ខ្មៅ', label: 'ខ្មៅ (Black)', hex: '#20242c' },
    },
  },
  {
    id: 'silver-gold', name: 'Silver & Gold', dir: 'assets/pieces-silver-gold',
    colors: {
      w: { short: 'ប្រាក់', label: 'ប្រាក់ (Silver)', hex: '#c7cdd6' },
      b: { short: 'មាស', label: 'មាស (Gold)', hex: '#c9971f' },
    },
  },
  {
    id: 'red-blue', name: 'Red & Blue', dir: 'assets/pieces-red-blue',
    colors: {
      w: { short: 'ខៀវ', label: 'ខៀវ (Blue)', hex: '#2255aa' },
      b: { short: 'ក្រហម', label: 'ក្រហម (Red)', hex: '#a3231f' },
    },
  },
];

export const boardThemes = [
  { id: 'wood', name: 'Wood', light: 'assets/board/wood_light.jpg', dark: 'assets/board/wood_dark.jpg' },
  { id: 'green', name: 'Classic Green', light: 'assets/board/green_light.jpg', dark: 'assets/board/green_dark.jpg' },
  { id: 'marble', name: 'Marble', light: 'assets/board/marble_light.jpg', dark: 'assets/board/marble_dark.jpg' },
  { id: 'walnut', name: 'Walnut', light: 'assets/board/walnut_light.jpg', dark: 'assets/board/walnut_dark.jpg' },
  { id: 'blue', name: 'Blue Tournament', light: 'assets/board/blue_light.jpg', dark: 'assets/board/blue_dark.jpg' },
];

// Resolves a piece image path for a given theme entry. `colorLetter` is
// 'w'|'b' (Game piece.c), `typeLetter` is one of PT's K/M/S/R/N/P codes.
export function pieceImageUrl(theme, colorLetter, typeLetter) {
  const key = PIECE_FILE_KEY[typeLetter] || 'pawn';
  const color = colorLetter === 'w' ? 'w' : 'b';
  return `${theme.dir}/${color}-${key}.png`;
}

// Clamp a persisted theme index against however many themes actually exist
// today, so an out-of-range/missing setting never breaks rendering.
export function clampThemeIndex(i, themes) {
  const n = i | 0;
  return n >= 0 && n < themes.length ? n : 0;
}

// The persisted piece-theme index, resolved to its actual theme entry
// (clamped, so a stale/out-of-range setting from before a theme was
// removed never throws) — the one lookup every consumer of `colors` needs.
export function activePieceTheme(pieceThemeIndex) {
  return pieceThemes[clampThemeIndex(pieceThemeIndex, pieceThemes)];
}

// js/ui.js's render() wipes and recreates every `.piece` div from scratch on
// every move (a fresh element with a fresh backgroundImage, never the same
// node reused/translated), so the first time a given piece image is ever
// referenced is often mid-animation. Warming every piece image into the
// browser's decoded-image cache as soon as the board loads (well before a
// first move can happen) means there's nothing left to fetch/decode by the
// time any move actually needs it.
export function preloadPieceImages(theme) {
  for (const color of ['w', 'b']) {
    for (const typeLetter of Object.keys(PIECE_FILE_KEY)) {
      const img = new Image();
      img.src = `./${pieceImageUrl(theme, color, typeLetter)}`;
      if (img.decode) img.decode().catch(() => {});
    }
  }
}
