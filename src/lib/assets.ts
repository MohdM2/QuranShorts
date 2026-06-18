import { staticFile } from "remotion";

export function resolveSrc(src: string): string {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}
