// js/themes.js — data-driven piece & board theme registries.
//
// Only one real piece art set and one real board skin ship with the app
// today, so each array below has exactly one entry. The shapes are
// deliberately generic (id/name + how to resolve an asset) so a future
// theme can be appended here without touching any selection/UI code in
// ui.js or settings.js — nothing here is a placeholder for fake content.

const PIECE_FILE_KEY = { K: 'king', M: 'queen', S: 'bishop', R: 'rook', N: 'knight', P: 'pawn' };

export const pieceThemes = [
  { id: 'classic', name: 'Classic', dir: 'assets/pieces' },
];

export const boardThemes = [
  { id: 'wood', name: 'Wood', light: 'assets/board/wood_light.jpg', dark: 'assets/board/wood_dark.jpg' },
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
