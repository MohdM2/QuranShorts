import React from "react";
import { useCurrentFrame } from "remotion";
import { SAFE_AREA } from "../lib/theme";

type Props = {
  recitationStartFrame: number;
  recitationDurationFrames: number;
  showTimerRing: boolean;
  accent: string;
  safeTop?: number;
  safeLeft?: number;
};

// Progress indicator. We deliberately render only the timer ring: Instagram
// Reels and TikTok both draw their own seek bar across the bottom, so a second
// bottom bar of ours was redundant and was buried under the caption anyway. The
// ring lives in the top-left safe corner, clear of the top tabs/search and the
// right action rail.
export const ProgressTimer: React.FC<Props> = ({
  recitationStartFrame,
  recitationDurationFrames,
  showTimerRing,
  accent,
  safeTop,
  safeLeft,
}) => {
  const frame = useCurrentFrame();

  const elapsed = frame - recitationStartFrame;
  const progress = Math.max(0, Math.min(1, elapsed / recitationDurationFrames));

  if (!showTimerRing) return null;

  const top = safeTop ?? SAFE_AREA.top;
  const left = safeLeft ?? SAFE_AREA.left;
  const circumference = 2 * Math.PI * 22;

  return (
    <div style={{ position: "absolute", top, left }}>
      <svg width={52} height={52} viewBox="0 0 52 52">
        <circle
          cx={26}
          cy={26}
          r={22}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={2}
        />
        <circle
          cx={26}
          cy={26}
          r={22}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
          opacity={0.8}
        />
      </svg>
    </div>
  );
};
