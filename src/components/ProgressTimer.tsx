import React from "react";
import { useCurrentFrame } from "remotion";
import { SAFE_AREA } from "../lib/theme";

type Props = {
  recitationStartFrame: number;
  recitationDurationFrames: number;
  showTimerRing: boolean;
  accent: string;
  safeTop?: number;
  safeRight?: number;
};

// Progress indicator. We deliberately render only the timer ring: Instagram
// Reels and TikTok both draw their own seek bar across the bottom, so a second
// bottom bar of ours was redundant and was buried under the caption anyway. The
// ring lives in the top-right safe corner — inset by safeRight so it sits just
// inboard of the action rail (like/comment/share) and below the top tabs.
export const ProgressTimer: React.FC<Props> = ({
  recitationStartFrame,
  recitationDurationFrames,
  showTimerRing,
  accent,
  safeTop,
  safeRight,
}) => {
  const frame = useCurrentFrame();

  const elapsed = frame - recitationStartFrame;
  const progress = Math.max(0, Math.min(1, elapsed / recitationDurationFrames));

  if (!showTimerRing) return null;

  const top = safeTop ?? SAFE_AREA.top;
  const right = safeRight ?? SAFE_AREA.right;
  const size = 64; // a touch larger than before (was 52)
  const c = size / 2;
  const r = 26;
  const stroke = 4; // solid, bold ring (was a thin 2px line)
  const circumference = 2 * Math.PI * r;

  return (
    <div style={{ position: "absolute", top, right }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
    </div>
  );
};
