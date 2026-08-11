# Der Die Das Sprint — German article trainer

**→ [grammatik-trainer.github.io](https://grammatik-trainer.github.io/)**

A fast trainer for German noun genders. Pick **der**, **die** or
**das**, and the next word is already waiting — 300 nouns from A1 to B2 in the
nominative case, with your mistakes scheduled for extra repetition.

Nothing to install and no account: progress, settings, daily streak and personal
records live in your browser's `localStorage` and never leave the device.

## Categories

Training is split into crawlable category pages:

| Path | What is in it |
| --- | --- |
| `/` | The 240 core words, A1–A2 |
| `/training/challenge/` | 60 additional hard ones, B1–B2 |
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

## License

MIT. See [LICENSE](LICENSE).
