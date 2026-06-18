import React from "react";
import { Audio, Sequence, interpolate, useVideoConfig } from "remotion";
import { CompositionProps } from "./Root";
import { resolveSrc } from "./lib/assets";
import { BackgroundVideo } from "./components/BackgroundVideo";
import { BreatheHook } from "./components/BreatheHook";
import { AyahText } from "./components/AyahText";
import { ProgressTimer } from "./components/ProgressTimer";
import { GrainOverlay } from "./components/GrainOverlay";

const FPS = 30;
const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS);

export const AyahVideo: React.FC<CompositionProps> = (props) => {
  const { verses } = props;
  const { durationInFrames } = useVideoConfig();
  const hookFrames = Math.round(props.hookDurationInSeconds * FPS);

  // The range starts at recitationStartMs within the source; verse timings are
  // relative to that. recitationFrames spans to the last verse's end.
  const startFrames = msToFrames(props.recitationStartMs || 0);
  const recitationFrames = verses.length ? msToFrames(verses[verses.length - 1].toMs) : 0;

  // The background occupies everything after the hook (recitation + tail).
  // Baked clips are already graded and paced to this span, so they play at 1×.
  // Raw clips are time-stretched to play through exactly once across the span.
  const bgSpanFrames = Math.max(1, durationInFrames - hookFrames);
  // Background fades up from black at the start of its span and back to black at
  // the end (defaults: 0.9s in, 1s out), both tunable from the Composer.
  const bgFadeInFrames = Math.round((props.bgFadeInSeconds ?? 0.9) * FPS);
  const bgFadeOutFrames = Math.round((props.bgFadeOutSeconds ?? 1) * FPS);
  const bgDurSeconds = props.backgroundDurationInSeconds || 0;
  const bgPlaybackRate =
    props.backgroundBaked || props.useVideoAsBackground || bgDurSeconds <= 0
      ? 1
      : bgDurSeconds / (bgSpanFrames / FPS);

  // Voice fade envelope: ramp up over the first fadeInSeconds and down over the
  // last fadeOutSeconds of the recitation (frame is relative to the recitation
  // Sequence, so 0 = voice start, recitationFrames = voice end).
  const fadeInFrames = Math.round((props.fadeInSeconds ?? 0) * FPS);
  const fadeOutFrames = Math.round((props.fadeOutSeconds ?? 0) * FPS);
  const recitationVolume = (f: number) => {
    const fadeIn =
      fadeInFrames > 0
        ? interpolate(f, [0, fadeInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : 1;
    const fadeOut =
      fadeOutFrames > 0 && recitationFrames > 0
        ? interpolate(f, [recitationFrames - fadeOutFrames, recitationFrames], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 1;
    return Math.max(0, Math.min(1, fadeIn * fadeOut));
  };

  return (
    <div style={{ flex: 1, background: "#000" }}>
      {/* Background lives only after the hook, so the breath plays on pure
          black and the scene fades in with the recitation. */}
      <Sequence from={hookFrames} name="Background">
        <BackgroundVideo
          src={props.useVideoAsBackground ? props.recitationSrc : props.backgroundSrc}
          startFrom={props.useVideoAsBackground ? startFrames : 0}
          playbackRate={bgPlaybackRate}
          spanFrames={bgSpanFrames}
          fadeInFrames={bgFadeInFrames}
          fadeOutFrames={bgFadeOutFrames}
          baked={Boolean(props.backgroundBaked) && !props.useVideoAsBackground}
        />
      </Sequence>
      <GrainOverlay />

      {/* "Take a breath" intro — on black */}
      <Sequence durationInFrames={hookFrames} name="BreatheHook">
        <BreatheHook
          breathSrc={props.breathSrc}
          hookText={props.hookText}
          hookSubText={props.hookSubText}
          hookTextAr={props.hookTextAr}
          hookSubTextAr={props.hookSubTextAr}
          accent={props.accent}
          breathColor={props.breathColor}
          breathInEndSeconds={props.breathInEndSeconds}
          breathStartDelaySeconds={props.breathStartDelaySeconds}
          durationInFrames={hookFrames}
        />
      </Sequence>

      {/* One continuous recitation; verse text is synced to its timestamps. */}
      <Sequence from={hookFrames} name="Recitation">
        <Audio
          src={resolveSrc(props.recitationSrc)}
          trimBefore={startFrames}
          volume={recitationVolume}
        />

        {verses.map((verse) => {
          const from = msToFrames(verse.fromMs);
          const duration = msToFrames(verse.toMs - verse.fromMs);
          return (
            <Sequence
              key={verse.ayahNumber}
              from={from}
              durationInFrames={duration}
              name={`Verse-${verse.ayahNumber}`}
            >
              <AyahText
                arabic={verse.arabic}
                translation={verse.translation}
                accent={props.accent}
                arabicFont={props.arabicFont}
                englishFont={props.englishFont}
                arabicFontSize={props.arabicFontSize}
                englishFontSize={props.englishFontSize}
                safeTop={props.safeTop}
                safeRight={props.safeRight}
                safeBottom={props.safeBottom}
                safeLeft={props.safeLeft}
              />
            </Sequence>
          );
        })}

        <ProgressTimer
          recitationStartFrame={0}
          recitationDurationFrames={recitationFrames}
          showTimerRing={props.showTimerRing}
          accent={props.accent}
          safeTop={props.safeTop}
          safeLeft={props.safeLeft}
        />
      </Sequence>
    </div>
  );
};
