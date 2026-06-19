import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import {
  resolveArabicFont,
  resolveLatinFont,
  ARABIC_FONT_SIZE,
  LATIN_FONT_SIZE,
} from "../lib/fonts";
import { theme, SAFE_AREA } from "../lib/theme";

type Props = {
  arabic: string;
  translation: string;
  accent: string;
  arabicFont?: string;
  englishFont?: string;
  arabicFontSize?: number;
  englishFontSize?: number;
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
};

export const AyahText: React.FC<Props> = ({
  arabic,
  translation,
  accent,
  arabicFont,
  englishFont,
  arabicFontSize,
  englishFontSize,
  safeTop,
  safeRight,
  safeBottom,
  safeLeft,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const riseProgress = spring({
    frame,
    fps,
    config: { mass: 1.2, damping: 22, stiffness: 60 },
  });

  const fadeIn = interpolate(frame, [0, fps * 0.8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - fps * 0.5, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = fadeIn * fadeOut;
  const translateY = interpolate(riseProgress, [0, 1], [30, 0]);

  const arabicFamily = resolveArabicFont(arabicFont);
  const latinFamily = resolveLatinFont(englishFont);
  const arabicSize = arabicFontSize && arabicFontSize > 0 ? arabicFontSize : ARABIC_FONT_SIZE;
  const latinSize = englishFontSize && englishFontSize > 0 ? englishFontSize : LATIN_FONT_SIZE;

  // Staggered reveal for translation
  const translationFade = interpolate(frame, [fps * 0.4, fps * 1.2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Divider width animates in
  const dividerWidth = interpolate(frame, [fps * 0.3, fps * 0.9], [0, 60], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Keep the text inside the platform-safe box so the action rail (right) and
  // caption/seek bar (bottom) never sit on top of it. Horizontal padding is
  // symmetric (the larger of left/right on BOTH sides) so the block stays
  // visually centered in the frame while still clearing the right action rail.
  const padTop = safeTop ?? SAFE_AREA.top;
  const padBottom = safeBottom ?? SAFE_AREA.bottom;
  const padX = Math.max(safeLeft ?? SAFE_AREA.left, safeRight ?? SAFE_AREA.right);
  const hasTranslation = Boolean(translation && translation.trim());

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `${padTop}px ${padX}px ${padBottom}px ${padX}px`,
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      {/* Arabic text */}
      <div
        style={{
          fontFamily: arabicFamily,
          fontSize: arabicSize,
          fontWeight: 400,
          color: theme.text,
          direction: "rtl",
          textAlign: "center",
          lineHeight: 1.85,
          marginBottom: hasTranslation ? 44 : 0,
          textShadow: `0 2px 20px rgba(0,0,0,0.5)`,
        }}
      >
        {arabic}
      </div>

      {/* Divider + translation are hidden when there's no translation — e.g.
          phrase mode shows Arabic sentences alone (no per-phrase translation). */}
      {hasTranslation && (
        <>
          {/* Animated divider */}
          <div
            style={{
              width: dividerWidth,
              height: 1.5,
              background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
              marginBottom: 36,
              opacity: fadeOut,
            }}
          />

          {/* Translation */}
          <div
            style={{
              fontFamily: latinFamily,
              fontSize: latinSize,
              fontWeight: 300,
              color: theme.textMuted,
              textAlign: "center",
              lineHeight: 1.7,
              maxWidth: 780,
              opacity: translationFade * fadeOut,
              letterSpacing: "0.01em",
            }}
          >
            {translation}
          </div>
        </>
      )}
    </div>
  );
};
