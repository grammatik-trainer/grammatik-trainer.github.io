import assert from "node:assert/strict";
import test from "node:test";
import { allNouns } from "../app/lib/data.ts";
import { dayKey, previousDay } from "../app/lib/engine.ts";
import { emptyData, type SprintData } from "../app/lib/storage.ts";
import { decodeProgress, encodeProgress, transferDays } from "../app/lib/transfer.ts";

function heavyLearner(): SprintData {
  const data = structuredClone(emptyData);
  // wrong und mastered dürfen sich nicht widersprechen — sanitizeData räumt das sonst auf.
  for (const noun of allNouns) data.mistakes[noun.id] = { wrong: 0, seen: 7, correctRun: 2, mastered: true };
  let key = dayKey();
  for (let index = 0; index < 60; index += 1) {
    data.days[key] = { answered: 25, correct: 23, totalMs: 90_000 };
    key = previousDay(key);
  }
  data.recentMistakes = allNouns.slice(0, 12).map((noun) => noun.id);
  data.totals = { answered: 5000, correct: 4600, totalMs: 9_000_000, points: 120_000 };
  data.best = { speedMs: 640, score: 1800, streak: 42 };
  data.sprints = { completed: 30, passed: 28, passStreak: 4, bestCorrect: 12, bestTimeMs: 71_000 };
  return data;
}

test("a transfer code survives the round trip", async () => {
  const source = heavyLearner();
  const code = await encodeProgress(source);
  const restored = await decodeProgress(code, emptyData);
  assert.ok(restored);
  assert.deepEqual(restored.totals, source.totals);
  assert.deepEqual(restored.best, source.best);
  assert.deepEqual(restored.sprints, source.sprints);
  assert.deepEqual(restored.recentMistakes, source.recentMistakes);
  assert.equal(Object.keys(restored.mistakes).length, allNouns.length);
  assert.deepEqual(restored.mistakes[allNouns[0].id], source.mistakes[allNouns[0].id]);
});

test("a transfer code stays short enough to paste", async () => {
  const code = await encodeProgress(heavyLearner());
  assert.ok(code.startsWith("ddd1:"));
  // Selbst der schwerste Stand muss in ein Textfeld und in eine Adresszeile passen.
  assert.ok(code.length < 4000, `Code ist ${code.length} Zeichen lang`);
});

test("only the last two weeks of daily history travel along", async () => {
  const restored = await decodeProgress(await encodeProgress(heavyLearner()), emptyData);
  assert.ok(restored);
  assert.equal(Object.keys(restored.days).length, transferDays);
  assert.ok(restored.days[dayKey()]);
});

test("untouched words are left out of the code", async () => {
  const data = structuredClone(emptyData);
  data.mistakes = {
    [allNouns[0].id]: { wrong: 2, seen: 3, correctRun: 0, mastered: false },
    [allNouns[1].id]: { wrong: 0, seen: 0, correctRun: 0, mastered: false },
  };
  const restored = await decodeProgress(await encodeProgress(data), emptyData);
  assert.ok(restored);
  assert.deepEqual(Object.keys(restored.mistakes), [allNouns[0].id]);
});

test("the device keeps its own theme and settings on import", async () => {
  const source = structuredClone(emptyData);
  source.theme = "dark";
  source.settings = { sound: true, feedbackDelay: 250, category: "challenge", installHintDismissed: true };
  const device: SprintData = { ...structuredClone(emptyData), theme: "light" };
  const restored = await decodeProgress(await encodeProgress(source), device);
  assert.ok(restored);
  assert.equal(restored.theme, "light");
  assert.deepEqual(restored.settings, device.settings);
});

test("unreadable codes are rejected instead of wiping progress", async () => {
  const valid = await encodeProgress(heavyLearner());
  assert.equal(await decodeProgress("", emptyData), null);
  assert.equal(await decodeProgress("hallo", emptyData), null);
  assert.equal(await decodeProgress("ddd1:%%%%", emptyData), null);
  assert.equal(await decodeProgress("ddd9:AAAA", emptyData), null);
  // Abgeschnitten beim Kopieren — der häufigste Fehler von Hand.
  assert.equal(await decodeProgress(valid.slice(0, valid.length - 40), emptyData), null);
});

test("a code written without gzip is still readable", async () => {
  const payload = { v: 1, totals: { answered: 3, correct: 2, totalMs: 900, points: 40 } };
  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const restored = await decodeProgress(`ddd0:${base64}`, emptyData);
  assert.ok(restored);
  assert.equal(restored.totals.answered, 3);
});
