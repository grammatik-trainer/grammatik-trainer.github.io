# Der Die Das Sprint — German article trainer

**→ [grammatik-trainer.github.io](https://grammatik-trainer.github.io/)**

A fast, keyboard-first trainer for German noun genders. Pick **der**, **die** or
**das**, and the next word is already waiting — 240 A1/A2 nouns in the
nominative case, with your mistakes scheduled for extra repetition.

Nothing to install and no account: progress, settings, daily streak and personal
records live in your browser's `localStorage` and never leave the device.

## Categories

Training is split into crawlable category pages:

| Path | What is in it |
| --- | --- |
| `/` | All 240 words |
| `/training/challenge/` | 60 hard and irregular ones |
| `/training/people/`, `/training/life/`, `/training/nature/`, `/training/travel/` | Thematic sets |

`/review/` drills the words you got wrong, `/progress/` shows your streak and
records. Both are personal views and are excluded from search indexing.

## Local development

```sh
npm install
npm run dev
```

`npm test` runs type checking, linting, the production build, the engine
contracts and an HTML smoke test.

## Deployment

The site is a static export deployed to GitHub Pages by
[.github/workflows/deploy.yml](.github/workflows/deploy.yml) on every push to
`main`. Two things are worth knowing before changing the setup:

- `SITE_ORIGIN` must be set at build time — it is what canonical URLs, Open
  Graph tags and the sitemap are built from. Without it the build falls back to
  `http://localhost:3000` silently.
- `robots.txt` and `sitemap.xml` are generated into `public/` by
  [build/generate-sitemap.mjs](build/generate-sitemap.mjs) rather than by
  `app/robots.ts` and `app/sitemap.ts`, because a static export does not emit
  metadata routes.

## License

MIT. See [LICENSE](LICENSE).
