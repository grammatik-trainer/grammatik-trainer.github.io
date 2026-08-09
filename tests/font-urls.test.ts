import assert from "node:assert/strict";
import test from "node:test";
import { rewriteFontCachePaths } from "../build/font-urls-vite-plugin.ts";

test("rewrites macOS and Windows vinext font-cache paths", () => {
  const prefix = "/assets/_vinext_fonts";
  assert.equal(
    rewriteFontCachePaths('src: url("/Users/example/project/.vinext/fonts/geist.woff2")', prefix),
    'src: url("/assets/_vinext_fonts/geist.woff2")',
  );
  assert.equal(
    rewriteFontCachePaths('src: url("C:\\Users\\example\\project/.vinext/fonts/geist.woff2")', prefix),
    'src: url("/assets/_vinext_fonts/geist.woff2")',
  );
});
