import React from "react";
import { OffthreadVideo, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { resolveSrc } from "../lib/assets";
import { theme } from "../lib/theme";

type Props = {
  src: string;
  // Frames into the source video to start from (used when the recitation video
  // doubles as the background). Clamped to >= 0.
  startFrom?: number;
  // Time-stretch factor: <1 slows the clip down, >1 speeds it up, so the source
  // plays through exactly once over the background span.
  playbackRate?: number;
  // Length of the span this background covers (frames), used for the Ken Burns
  // zoom so it completes over the visible duration rather than the whole comp.
  spanFrames?: number;
  // Frames over which the background fades up from black at the start.
  fadeInFrames?: number;
  // Frames over which the background fades back to black at the end of its span.
  fadeOutFrames?: number;
  // When true, the clip is pre-graded (blur/darken baked in by the Composer):
  // skip the live CSS blur + dark overlay so it just decodes (fast + accurate).
  baked?: boolean;
};

export const BackgroundVideo: React.FC<Props> = ({
  src,
  startFrom = 0,
  playbackRate = 1,
  spanFrames,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  baked = false,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const span = spanFrames ?? durationInFrames;

  const zoomScale = interpolate(frame, [0, span], [1.0, 1.12], {
    extrapolateRight: "clamp",
  });

  // Fade up from the black breath screen at the start of the span.
  const fadeIn =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  // Fade back to black over the last frames of the span.
  const fadeOut =
    fadeOutFrames > 0
      ? interpolate(frame, [span - fadeOutFrames, span], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const opacity = Math.max(0, Math.min(1, fadeIn * fadeOut));

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity }}>
      <OffthreadVideo
        src={resolveSrc(src)}
        muted
        trimBefore={Math.max(0, Math.round(startFrom))}
        playbackRate={playbackRate}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoomScale})`,
          // Baked clips already carry the grade; live filtering only for raw clips.
          filter: baked ? "none" : "blur(4px) saturate(0.6) brightness(0.5)",
        }}
      />

      {/* Deep darkening — only for raw clips; baked clips have it burned in. */}
      {!baked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(10, 10, 15, 0.55)",
          }}
        />
      )}

      {/* Framing layers below are cheap and always applied (not part of the grade). */}
      {/* Top vignette */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "40%",
          background: `linear-gradient(to bottom, ${theme.bg}, transparent)`,
        }}
      />
      {/* Bottom vignette */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "40%",
          background: `linear-gradient(to top, ${theme.bg}, transparent)`,
        }}
      />
      {/* Subtle warm glow from center */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%, ${theme.accentGlow}, transparent 70%)`,
        }}
      />
    </div>
  );
};
