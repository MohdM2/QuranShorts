import React from "react";
import {
  Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import { resolveSrc } from "../lib/assets";
import { ARABIC_FONT, LATIN_FONT } from "../lib/fonts";
import { theme } from "../lib/theme";

type Props = {
  breathSrc: string;
  hookText: string;
  hookSubText: string;
  hookTextAr?: string;
  hookSubTextAr?: string;
  accent: string;
  breathColor?: string;
  breathInEndSeconds?: number;
  breathStartDelaySeconds?: number;
  durationInFrames: number;
};

const hexParts = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [212, 168, 83];
};
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexParts(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
// Mix toward white by t (0..1) for a soft, luminous top of the fill.
const lighten = (hex: string, t: number) => {
  const [r, g, b] = hexParts(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

export const BreatheHook: React.FC<Props> = ({
  breathSrc,
  hookText,
  hookSubText,
  hookTextAr = "خُذ نَفَسًا",
  hookSubTextAr = "وَأنصِت",
  accent,
  breathColor,
  breathInEndSeconds,
  breathStartDelaySeconds = 0.5,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const color = breathColor || accent;
  const CIRCLE_SIZE = 150;

  // Phase boundaries (frames), all clamped inside the hook span.
  const hookSec = durationInFrames / fps;
  const delaySec = Math.max(0, Math.min(breathStartDelaySeconds, hookSec - 0.2));
  const splitSec =
    breathInEndSeconds != null
      ? Math.min(Math.max(breathInEndSeconds, delaySec + 0.1), hookSec - 0.1)
      : delaySec + (hookSec - delaySec) * 0.6;
  const delayF = delaySec * fps;
  const splitF = splitSec * fps;
  const endF = durationInFrames;

  // Inhale fills the circle, exhale empties it — both eased for a natural,
  // breath-like ramp rather than a linear crawl.
  const ease = Easing.inOut(Easing.cubic);
  const fill =
    frame < splitF
      ? interpolate(frame, [delayF, splitF], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        })
      : interpolate(frame, [splitF, endF], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        });

  // Circle gently expands as it fills with breath.
  const scale = 0.94 + fill * 0.1;

  const fadeOut = interpolate(
    frame,
    [durationInFrames - fps * 0.8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Primary line breathes in with the inhale; "listen" arrives on the exhale.
  const primaryOpacity = interpolate(
    frame,
    [delayF, delayF + fps * 0.7],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const listenOpacity = interpolate(
    frame,
    [splitF, splitF + fps * 0.6],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      <Audio src={resolveSrc(breathSrc)} volume={0.5} />

      {/* Breathing circle: fills on inhale, empties on exhale */}
      <div
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: "50%",
          border: `1.5px solid ${rgba(color, 0.45)}`,
          overflow: "hidden",
          position: "relative",
          marginBottom: 60,
          transform: `scale(${scale})`,
          boxShadow: `0 0 ${60 * fill}px ${rgba(color, 0.5 * fill + 0.05)}, inset 0 0 28px ${rgba(color, 0.18)}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${fill * 100}%`,
            background: `linear-gradient(to top, ${color}, ${lighten(color, 0.35)})`,
            opacity: 0.92,
          }}
        />
        {/* Soft sheen riding the surface of the fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: `${fill * 100}%`,
            height: 5,
            transform: "translateY(2px)",
            background: rgba(lighten(color, 0.6), 0.7),
            opacity: fill > 0.03 && fill < 0.99 ? 0.55 : 0,
            filter: "blur(2px)",
          }}
        />
      </div>

      {/* Primary line — inhale ("Take a breath") */}
      <div style={{ opacity: primaryOpacity, textAlign: "center" }}>
        <div
          style={{
            fontFamily: ARABIC_FONT,
            fontSize: 64,
            fontWeight: 400,
            color: theme.text,
            direction: "rtl",
            lineHeight: 1.4,
          }}
        >
          {hookTextAr}
        </div>
        <div
          style={{
            fontFamily: LATIN_FONT,
            fontSize: 34,
            fontWeight: 300,
            color: theme.textMuted,
            marginTop: 6,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          {hookText}
        </div>
      </div>

      {/* Secondary line — exhale ("and listen") */}
      <div style={{ opacity: listenOpacity, marginTop: 22, textAlign: "center" }}>
        <div
          style={{
            fontFamily: ARABIC_FONT,
            fontSize: 36,
            fontWeight: 400,
            color,
            direction: "rtl",
            lineHeight: 1.5,
          }}
        >
          {hookSubTextAr}
        </div>
        <div
          style={{
            fontFamily: LATIN_FONT,
            fontSize: 22,
            fontWeight: 300,
            color,
            opacity: 0.85,
            marginTop: 4,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {hookSubText}
        </div>
      </div>
    </div>
  );
};
