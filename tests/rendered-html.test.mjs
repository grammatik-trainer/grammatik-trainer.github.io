import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveMetadataOrigin, siteOrigin } from "../app/lib/site-origin.ts";

process.env.SITE_ORIGIN = "http://localhost:3000";

async function render(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(path, "http://localhost/"), { ...init, headers: { accept: "text/html", ...init.headers } }),
    {},
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the German training application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Der Die Das Sprint — German articles at speed<\/title>/i);
  assert.match(html, /Deutsch\. Schnell\. Sicher\./);
  assert.match(html, /Wähle den richtigen Artikel/);
  assert.match(html, /Wort wird geladen/);
  assert.match(html, /app-shell/);
  assert.match(html, /local-data/);
  assert.match(html, /Alle Wörter(?:<!-- -->)? · (?:<!-- -->)?240/);
  assert.match(html, /Schwer &amp; selten(?:<!-- -->)? · (?:<!-- -->)?60/);
  assert.match(html, /Sprint (?:<!-- -->)?0(?:<!-- -->)?\/(?:<!-- -->)?12/);
  assert.match(html, /Deine Session/);
  assert.match(html, /Sichere Wörter/);
  assert.match(html, /0(?:<!-- -->)?\/(?:<!-- -->)?240/);
  assert.match(html, /Wiederholen/);
  assert.match(html, /Fortschritt/);
  assert.match(html, /data-testid="answer-der"/);
  assert.match(html, /data-testid="answer-die"/);
  assert.match(html, /data-testid="answer-das"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /href="\/review\/"/);
  assert.match(html, /href="\/progress\/"/);
  assert.match(html, /href="https:\/\/github\.com\/grammatik-trainer\/grammatik-trainer\.github\.io"/);
  assert.doesNotMatch(html, /\.vinext\/fonts|\/Users\//);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("publishes crawlable category routes and keeps personal routes out of search", async () => {
  const category = await (await render("/training/challenge/")).text();
  assert.match(category, /<title>Schwer &amp; selten — Der Die Das Sprint<\/title>/);
  assert.match(category, /rel="canonical" href="http:\/\/localhost:3000\/training\/challenge\/"/);
  assert.match(category, /60 zusätzliche Wörter/);
  // Die Sitzungsstatistik zaehlt die gewaehlte Kategorie, nicht immer den Basiswortschatz.
  assert.match(category, /Sichere Wörter<\/span><strong>0(?:<!-- -->)?\/(?:<!-- -->)?60<\/strong>/);
  assert.doesNotMatch(category, /Sichere Wörter<\/span><strong>0(?:<!-- -->)?\/(?:<!-- -->)?240<\/strong>/);
  const review = await (await render("/review/")).text();
  assert.match(review, /Deine schwierigen Wörter/);
  assert.match(review, /rel="canonical" href="http:\/\/localhost:3000\/review\//);
  assert.match(review, /name="robots" content="noindex, nofollow"/);
  const progress = await (await render("/progress/")).text();
  assert.match(progress, /Dein Fortschritt/);
  assert.match(progress, /rel="canonical" href="http:\/\/localhost:3000\/progress\//);
  assert.match(progress, /name="robots" content="noindex, nofollow"/);
  assert.equal((await render("/training/not-a-category/")).status, 404);
});

test("ships a sitemap and robots covering the public categories only", async () => {
  // Generated into public/ by build/generate-sitemap.mjs: vinext does not emit
  // app/sitemap.ts style metadata routes into a static export.
  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  assert.match(sitemap, /<loc>https:\/\/grammatik-trainer\.github\.io\/training\/challenge\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/grammatik-trainer\.github\.io\/<\/loc>/);
  assert.doesNotMatch(sitemap, /\/review|\/progress/);

  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Disallow:/);
  assert.match(robots, /Sitemap: https:\/\/grammatik-trainer\.github\.io\/sitemap\.xml/);
});

test("builds metadata URLs from the configured origin", async () => {
  assert.equal(siteOrigin({ SITE_ORIGIN: "https://german.example.test" }), "https://german.example.test");
  // A static export has no request to negotiate an origin with, so an
  // unconfigured environment must not silently invent a public URL.
  assert.equal(siteOrigin({}), "http://localhost:3000");
  assert.equal(resolveMetadataOrigin("evil.example.test", "https", { SITE_ORIGIN: "https://german.example.test" }), "https://german.example.test");

  const html = await (await render("/training/life/")).text();
  assert.match(html, /rel="canonical" href="http:\/\/localhost:3000\/training\/life\/"/);
  assert.match(html, /property="og:image" content="http:\/\/localhost:3000\/og\.png"/);
});

test("publishes a correctly sized social card", async () => {
  const social = await readFile(new URL("../public/og.png", import.meta.url));
  assert.deepEqual([social.readUInt32BE(16), social.readUInt32BE(20)], [1200, 630]);
});

test("uses framework navigation so route metadata and robots stay synchronized", async () => {
  const component = await readFile(new URL("../app/components/trainer-app.tsx", import.meta.url), "utf8");
  assert.match(component, /router\.push\(path/);
  assert.match(component, /router\.replace\(trainingPath\(restoredCategory\)/);
  assert.doesNotMatch(component, /history\.(?:pushState|replaceState)/);
});
