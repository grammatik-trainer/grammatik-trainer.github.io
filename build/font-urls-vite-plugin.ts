import type { Plugin } from "vite";

const namespace = "_vinext_fonts";
const fontCacheMarker = "/.vinext/fonts";
const pathDelimiters = new Set([" ", "\t", "\r", "\n", '"', "'", "`", "(", ")", "<", ">", "="]);

export function rewriteFontCachePaths(code: string, servedPrefix: string) {
  if (!code.includes(fontCacheMarker)) return null;
  const chunks: string[] = [];
  let cursor = 0;
  let markerIndex = code.indexOf(fontCacheMarker);
  while (markerIndex !== -1) {
    let pathStart = markerIndex;
    while (pathStart > cursor && !pathDelimiters.has(code[pathStart - 1])) pathStart -= 1;
    chunks.push(code.slice(cursor, pathStart), servedPrefix);
    cursor = markerIndex + fontCacheMarker.length;
    markerIndex = code.indexOf(fontCacheMarker, cursor);
  }
  chunks.push(code.slice(cursor));
  return chunks.join("");
}

export function fontUrls(): Plugin {
  let servedPrefix = `/assets/${namespace}`;
  return {
    name: "german-grammar-race:font-urls",
    enforce: "post",
    configResolved(config) {
      servedPrefix = `/${config.build?.assetsDir || "assets"}/${namespace}`;
    },
    transform(code) {
      const rewritten = rewriteFontCachePaths(code, servedPrefix);
      return rewritten === null ? null : { code: rewritten, map: null };
    },
  };
}
