/**
 * Write public/sitemap.xml and public/robots.txt from the category list.
 *
 * These used to be `app/robots.ts` and `app/sitemap.ts`, but vinext does not
 * emit metadata routes into a static export, so nothing reached the published
 * site. Generating them into public/ — which is copied verbatim — keeps them in
 * the output, and deriving them from the same category list keeps them honest.
 *
 * Run by `npm run build` before the app is built.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteOrigin = process.env.SITE_ORIGIN ?? "https://grammatik-trainer.github.io";

// Parse the ids out of the source rather than importing it: the module is
// TypeScript and drags in the whole word list.
const source = readFileSync(join(root, "app/lib/data.ts"), "utf8");
const categoryBlock = source.slice(source.indexOf("nounCategories"));
const ids = [...categoryBlock.matchAll(/id: "([a-z-]+)"/g)].map((match) => match[1]);
const uniqueIds = [...new Set(ids)];

if (uniqueIds.length === 0) {
  throw new Error("No categories found — has data.ts changed shape?");
}

// Mirrors trainingPath(); /review and /progress are noindex and stay out.
const urls = uniqueIds.map((id) => ({
  loc: id === "all" ? `${siteOrigin}/` : `${siteOrigin}/training/${id}/`,
  priority: id === "all" ? "1.0" : "0.8",
}));

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, priority }) =>
      `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${siteOrigin}/sitemap.xml
`;

writeFileSync(join(root, "public/sitemap.xml"), sitemap);
writeFileSync(join(root, "public/robots.txt"), robots);

console.log(`sitemap: ${urls.length} urls for ${siteOrigin}`);
