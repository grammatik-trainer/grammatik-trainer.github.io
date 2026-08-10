import assert from "node:assert/strict";
import test from "node:test";
import { allNouns, challengeNouns, nouns, nounsForCategory } from "../app/lib/data.ts";
import {
  accuracy,
  calculateDailyStreak,
  cappedElapsedMs,
  countNewlyMastered,
  feedbackDelay,
  freshQuotaDeficit,
  masteredWordIds,
  maximumRepeatGap,
  minimumFreshPerSprint,
  minimumRepeatGap,
  nextSprintStreak,
  nextSprintProgress,
  pickNext,
  previousDay,
  randomRepeatGap,
  remainingReviewCount,
  reviewIsDue,
  scheduleReviewAt,
  scoreAnswer,
  shouldForceFreshWord,
  sprintLength,
  updateWordProgress,
} from "../app/lib/engine.ts";
import { hintAt, trainerHints } from "../app/lib/hints.ts";
import { emptyData, sanitizeData } from "../app/lib/storage.ts";

test("ships a large, balanced vocabulary", () => {
  assert.equal(nouns.length, 240);
  for (const article of ["der", "die", "das"]) {
    assert.equal(nouns.filter((noun) => noun.article === article).length, 80);
  }
  assert.equal(new Set(nouns.map((noun) => noun.id)).size, nouns.length);
  assert.equal(challengeNouns.length, 60);
  assert.equal(allNouns.length, 300);
  assert.equal(new Set(allNouns.map((noun) => noun.id)).size, allNouns.length);
  for (const article of ["der", "die", "das"]) {
    assert.equal(challengeNouns.filter((noun) => noun.article === article).length, 20);
  }
  assert.equal(nounsForCategory("all").length, 240);
  assert.equal(nounsForCategory("challenge").length, 60);
});

test("scores speed and streak without rewarding wrong answers", () => {
  assert.equal(scoreAnswer(700, 4, false), 0);
  assert.ok(scoreAnswer(700, 4, true) > scoreAnswer(2500, 0, true));
  assert.equal(accuracy(9, 10), 90);
  assert.equal(accuracy(0, 0), 0);
});

test("keeps wrong-answer feedback visible one second longer", () => {
  assert.equal(feedbackDelay(420, true), 420);
  assert.equal(feedbackDelay(420, false), 1420);
});

test("weighted scheduler avoids immediately repeating the same noun", () => {
  const next = pickNext(nouns.slice(0, 3), nouns[0].id, {}, () => 0);
  assert.notEqual(next.id, nouns[0].id);
});

test("scheduler keeps a three-question gap before repeats", () => {
  const pool = nouns.slice(0, 6);
  const next = pickNext(pool, pool[0].id, {}, () => 0, [pool[1].id, pool[2].id, pool[3].id]);
  assert.ok(!pool.slice(0, 4).some((noun) => noun.id === next.id));
});

test("two spaced correct answers master a word and a later mistake removes mastery", () => {
  const wrong = updateWordProgress(undefined, false);
  assert.equal(wrong.wrong, 2);
  assert.equal(updateWordProgress(wrong, true).wrong, 1);
  const once = updateWordProgress(undefined, true);
  assert.equal(once.mastered, false);
  const mastered = updateWordProgress(once, true);
  assert.equal(mastered.mastered, true);
  const review = updateWordProgress(mastered, false);
  assert.equal(review.mastered, false);
  assert.equal(review.wrong, 2);
  assert.equal(updateWordProgress(updateWordProgress(review, true), true).mastered, true);
});

test("a word missed in the current sprint stays unsafe until the next sprint", () => {
  const wrong = updateWordProgress(undefined, false);
  const firstReview = updateWordProgress(wrong, true, false);
  assert.equal(firstReview.mastered, false);
  const secondReview = updateWordProgress(firstReview, true, false);
  assert.equal(secondReview.wrong, 0);
  assert.equal(secondReview.correctRun, 2);
  assert.equal(secondReview.mastered, false);
  assert.equal(updateWordProgress(secondReview, true).mastered, true);
});

test("saved review progress preserves the remaining repetition after reload", () => {
  const wrong = updateWordProgress(undefined, false);
  const reviewedOnce = updateWordProgress(wrong, true);
  assert.equal(remainingReviewCount(wrong), 2);
  assert.equal(remainingReviewCount(reviewedOnce), 1);
});

test("every sprint owes at least three unsafe words, capped by what the pool still offers", () => {
  assert.equal(freshQuotaDeficit(0, 240), minimumFreshPerSprint);
  assert.equal(freshQuotaDeficit(2, 240), 1);
  assert.equal(freshQuotaDeficit(3, 240), 0);
  assert.equal(freshQuotaDeficit(5, 240), 0);
  // Ein fast fertiger Pool kann die volle Quote nicht mehr liefern und darf den Sprint nicht blockieren.
  assert.equal(freshQuotaDeficit(1, 2), 1);
  assert.equal(freshQuotaDeficit(0, 0), 0);
});

test("unsafe words are forced in only once the sprint would otherwise end without them", () => {
  assert.equal(shouldForceFreshWord(0, 11), false);
  assert.equal(shouldForceFreshWord(3, 8), false);
  assert.equal(shouldForceFreshWord(3, 9), true);
  assert.equal(shouldForceFreshWord(1, 11), true);
  assert.equal(shouldForceFreshWord(2, 12), true);
});

test("mistake reviews use a random gap from three to five questions", () => {
  assert.equal(randomRepeatGap(() => 0), minimumRepeatGap);
  assert.equal(randomRepeatGap(() => 0.5), 4);
  assert.equal(randomRepeatGap(() => 1), maximumRepeatGap);
  assert.equal(scheduleReviewAt(7, () => 0), 10);
  assert.equal(scheduleReviewAt(7, () => 1), 12);
  assert.equal(reviewIsDue(10, 9), false);
  assert.equal(reviewIsDue(10, 10), true);
});

test("a new sprint preserves the current answer streak", () => {
  assert.equal(nextSprintStreak(15), 15);
  assert.equal(nextSprintStreak(-3), 0);
});

test("newly mastered count is unique and excludes words mastered at sprint start", () => {
  const [known, learned] = nouns;
  const knownStat = { wrong: 0, seen: 2, correctRun: 2, mastered: true };
  const learnedStat = { ...knownStat };
  const mistakes = { [known.id]: knownStat, [learned.id]: learnedStat };
  const masteredAtStart = masteredWordIds({ [known.id]: knownStat });
  assert.equal(countNewlyMastered([known, learned], mistakes, masteredAtStart), 1);
});

test("question timing ignores inactivity after ten seconds", () => {
  assert.equal(cappedElapsedMs(1_000, 4_500), 3_500);
  assert.equal(cappedElapsedMs(1_000, 31_000), 10_000);
  assert.equal(sprintLength, 12);
});

test("a mistake drops sprint progress to the previous checkpoint", () => {
  assert.equal(nextSprintProgress(3, false, false), 0);
  assert.equal(nextSprintProgress(7, false, false), 4);
  assert.equal(nextSprintProgress(11, false, false), 8);
  assert.equal(nextSprintProgress(11, true, true), 11);
  assert.equal(nextSprintProgress(11, true, false), 12);
});

test("daily streak accepts today or yesterday as its anchor", () => {
  assert.equal(calculateDailyStreak({ "2026-08-04": { answered: 2 }, "2026-08-05": { answered: 3 }, "2026-08-06": { answered: 1 } }, "2026-08-06"), 3);
  assert.equal(calculateDailyStreak({ "2026-08-04": { answered: 2 }, "2026-08-05": { answered: 3 } }, "2026-08-06"), 2);
});

test("hints cycle without ever falling off the list", () => {
  assert.ok(trainerHints.length >= 6);
  assert.equal(hintAt(0), trainerHints[0]);
  assert.equal(hintAt(trainerHints.length), trainerHints[0]);
  assert.equal(hintAt(trainerHints.length + 2), trainerHints[2]);
  assert.equal(hintAt(-1), trainerHints[trainerHints.length - 1]);
  assert.equal(hintAt(Number.NaN), trainerHints[0]);
  for (const item of trainerHints) {
    assert.ok(item.headline.length > 0 && item.detail.length > 0);
  }
});

test("invalid stored data falls back safely", () => {
  assert.deepEqual(sanitizeData({ version: 99 }), emptyData);
  assert.equal(sanitizeData({ version: 1, theme: "neon" }).theme, "light");
  assert.equal(sanitizeData({ version: 1, settings: { sound: false, feedbackDelay: 420, category: "unknown" as never } }).settings.category, "all");
  const sanitized = sanitizeData({ version: 1, mistakes: { broken: null, haus: { wrong: 1, seen: 3, lastWrong: "2026-08-01", mastered: true } } });
  assert.equal(sanitized.mistakes.haus.mastered, false);
  // Ältere Speicherstände tragen noch lastWrong — das Feld wird stillschweigend fallen gelassen.
  assert.equal("lastWrong" in sanitized.mistakes.haus, false);
  assert.equal("broken" in sanitized.mistakes, false);
});

test("a damaged storage payload cannot poison the counters", () => {
  const hostile = sanitizeData({
    version: 1,
    totals: { answered: "1", correct: -5, totalMs: Number.NaN, points: 7.9 },
    best: { speedMs: "fast", score: {}, streak: 3 },
    sprints: { completed: [], passed: 2, passStreak: null, bestCorrect: 12, bestTimeMs: -1 },
    days: { "2026-08-09": { answered: "99", correct: 1, totalMs: 5 }, "gestern": { answered: 4, correct: 4, totalMs: 5 } },
    mistakes: { erfundenes_wort: { wrong: 1, seen: 1 }, haus: { wrong: 2, seen: 2 } },
  } as never);
  assert.deepEqual(hostile.totals, { answered: 0, correct: 0, totalMs: 0, points: 7 });
  assert.deepEqual(hostile.best, { speedMs: null, score: 0, streak: 3 });
  // passed wird von completed gedeckelt, das hier auf 0 fällt.
  assert.deepEqual(hostile.sprints, { completed: 0, passed: 0, passStreak: 0, bestCorrect: 12, bestTimeMs: null });
  // Erfundene Tagesschlüssel und unbekannte Wörter fallen raus, sonst wüchse der Speicher unbegrenzt.
  assert.deepEqual(Object.keys(hostile.days), ["2026-08-09"]);
  assert.equal(hostile.days["2026-08-09"].answered, 0);
  assert.deepEqual(Object.keys(hostile.mistakes), ["haus"]);
});

test("nothing unknown survives sanitising into storage", () => {
  const smuggled = sanitizeData({
    version: 1,
    junk: "x".repeat(1000),
    settings: { sound: "yes", feedbackDelay: 9_000_000, category: "life", extra: true },
    recentMistakes: ["haus", "erfundenes_wort", 7],
  } as never);
  assert.deepEqual(Object.keys(smuggled).sort(), ["best", "days", "mistakes", "recentMistakes", "settings", "sprints", "theme", "totals", "version"]);
  assert.deepEqual(Object.keys(smuggled.settings).sort(), ["category", "feedbackDelay", "installHintDismissed", "sound"]);
  assert.equal(smuggled.settings.sound, false);
  // Ein riesiger Wert würde sonst als Timeout die nächste Frage nie erscheinen lassen.
  assert.equal(smuggled.settings.feedbackDelay, 3000);
  assert.deepEqual(smuggled.recentMistakes, ["haus"]);
});

test("the daily history is capped at the newest days", () => {
  const days: Record<string, { answered: number; correct: number; totalMs: number }> = {};
  // Deutlich mehr als die Obergrenze, sonst prüfte der Test gar nichts.
  let key = "2027-01-01";
  for (let index = 0; index < 1500; index += 1) {
    days[key] = { answered: 1, correct: 1, totalMs: 1 };
    key = previousDay(key);
  }
  assert.equal(Object.keys(days).length, 1500);

  const capped = sanitizeData({ version: 1, days } as never);
  const keys = Object.keys(capped.days).sort();
  assert.equal(keys.length, 800);
  // Gekappt wird am älteren Ende: der jüngste Tag bleibt, der älteste fällt weg.
  assert.equal(keys.at(-1), "2027-01-01");
  assert.equal(keys.includes("2022-11-23"), false);
});

test("counters that build on each other cannot contradict", () => {
  const skewed = sanitizeData({
    version: 1,
    totals: { answered: 1, correct: 1000, totalMs: 5, points: 5 },
    sprints: { completed: 2, passed: 99, passStreak: 1, bestCorrect: 12, bestTimeMs: 1000 },
    days: { "2026-08-09": { answered: 0, correct: 7, totalMs: 5 } },
  } as never);
  assert.equal(skewed.totals.correct, 1);
  assert.equal(skewed.sprints.passed, 2);
  assert.equal(skewed.days["2026-08-09"].correct, 0);
});
