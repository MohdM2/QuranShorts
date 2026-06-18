import React from "react";
import { Composition } from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";
import { AyahVideo } from "./AyahVideo";
import { VideoProps } from "./lib/types";
import { resolveSrc } from "./lib/assets";
import propsData from "../data/props.json";

const FPS = 30;

const allProps = propsData as VideoProps[];

export type CompositionProps = VideoProps;

const calculateMetadata = async ({ props }: { props: CompositionProps }) => {
  // Hook length is baked into props by the Composer (measured from the breath
  // audio at save time). Using the stored value keeps duration deterministic —
  // measuring async here made it flaky (succeeds on load, can fail at render,
  // shifting durationInFrames and breaking the Studio frame range).
  const hookSeconds = props.hookDurationInSeconds || 3;

  // Recitation length = the range's span, i.e. the last verse's end timestamp
  // (relative to the range start). We don't use the media file's own duration
  // because recitationSrc may be a full-surah source longer than the range.
  const recitationSeconds = props.verses.length
    ? props.verses[props.verses.length - 1].toMs / 1000
    : 0;

  const totalSeconds = hookSeconds + recitationSeconds + (props.tailPaddingInSeconds || 0);

  // Measure the background clip so AyahVideo can time-stretch it to fill the
  // whole post-hook span exactly once (no loop, no freeze). Skipped when the
  // recitation video doubles as the background (already 1:1 with the audio).
  let backgroundDurationInSeconds = props.backgroundDurationInSeconds;
  if (!props.useVideoAsBackground && !props.backgroundBaked) {
    try {
      const meta = await getVideoMetadata(resolveSrc(props.backgroundSrc));
      backgroundDurationInSeconds = meta.durationInSeconds;
    } catch {
      // leave undefined → AyahVideo falls back to playbackRate 1
    }
  }

  return {
    durationInFrames: Math.ceil(totalSeconds * FPS),
    // Bake the resolved hook length back in so AyahVideo positions the
    // recitation at the same offset used for the total duration.
    props: { ...props, hookDurationInSeconds: hookSeconds, backgroundDurationInSeconds },
  };
};

const pad = (n: number, len = 3) => String(n).padStart(len, "0");

// A stable, Studio-safe composition id for a saved entry, e.g. "Ayah-035-034-038".
const entryId = (p: VideoProps) =>
  `Ayah-${pad(p.surahNumber)}-${pad(p.fromAyah)}-${pad(p.toAyah)}`;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Generic composition used by the CLI / render:all (driven by inputProps). */}
      {allProps[0] && (
        <Composition
          id="AyahVideo"
          component={AyahVideo}
          fps={FPS}
          width={1080}
          height={1920}
          durationInFrames={FPS * 10}
          defaultProps={allProps[0]}
          calculateMetadata={calculateMetadata}
        />
      )}

      {/* One composition per saved range, so every marked video is selectable
          and previewable in the Studio sidebar. */}
      {allProps.map((p) => (
        <Composition
          key={entryId(p)}
          id={entryId(p)}
          component={AyahVideo}
          fps={FPS}
          width={1080}
          height={1920}
          durationInFrames={FPS * 10}
          defaultProps={p}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
};
