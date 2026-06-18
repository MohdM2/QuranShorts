export const theme = {
  bg: "#0a0a0f",
  surface: "#12121a",
  accent: "#c9a227",
  accentRose: "#b8860b",
  accentGlow: "rgba(201, 162, 39, 0.15)",
  text: "#f0ece2",
  textMuted: "rgba(240, 236, 226, 0.7)",
  textDim: "rgba(240, 236, 226, 0.4)",
  grain: 0.03,
};

// Default platform safe-area insets (px on the 1080×1920 canvas) that clear the
// Instagram Reels / TikTok overlay chrome. Right = action rail, bottom =
// caption + audio ticker + native seek bar, top = tabs/search, left = margin.
// Overridable per-video via VideoProps.safe* .
export const SAFE_AREA = { top: 130, right: 150, bottom: 340, left: 48 };
