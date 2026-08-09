import assert from "node:assert/strict";
import test from "node:test";
import { allNouns } from "../app/lib/data.ts";
import { calculateDailyStreak, dayKey, previousDay } from "../app/lib/engine.ts";
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

test("even the heaviest possible progress stays pasteable", async () => {
  // Schlimmster Fall: jedes Wort berührt und die Tagesgrenze voll ausgereizt.
  const data = heavyLearner();
  let key = dayKey();
  for (let index = 0; index < transferDays + 100; index += 1) {
    data.days[key] = { answered: 25, correct: 23, totalMs: 90_000 };
    key = previousDay(key);
  }
  const code = await encodeProgress(data);
  assert.ok(code.startsWith("ddd1:"));
  assert.ok(code.length < 8000, `Code ist ${code.length} Zeichen lang`);

  const restored = await decodeProgress(code, emptyData);
  assert.ok(restored);
  assert.equal(Object.keys(restored.days).length, transferDays);
});

test("the daily streak survives a transfer", async () => {
  const source = heavyLearner();
  const days = Object.keys(source.days).length;
  const restored = await decodeProgress(await encodeProgress(source), emptyData);
  assert.ok(restored);
  // Die Tagesserie liest die ganze Historie — ein zu enger Deckel würde sie beim Umzug kappen.
  assert.equal(Object.keys(restored.days).length, days);
  assert.equal(calculateDailyStreak(restored.days), calculateDailyStreak(source.days));
  assert.ok(days < transferDays);
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

test("a compression bomb is refused instead of unpacked", async () => {
  // Gleichförmige Daten packt gzip tausendfach — der Link würde sonst beim
  // Öffnen zig Megabyte belegen, bevor überhaupt jemand zustimmt.
  const huge = new TextEncoder().encode(JSON.stringify({ v: 1, filler: "a".repeat(20_000_000) }));
  const packed = new Blob([huge as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(packed).arrayBuffer());
  const code = `ddd1:${Buffer.from(bytes).toString("base64url")}`;
  assert.ok(code.length < 64_000, `Bombe ist ${code.length} Zeichen klein`);
  assert.equal(await decodeProgress(code, emptyData), null);
});

test("an oversized code is refused before decoding", async () => {
  assert.equal(await decodeProgress(`ddd1:${"A".repeat(70_000)}`, emptyData), null);
});

test("a code written without gzip is still readable", async () => {
  const payload = { v: 1, totals: { answered: 3, correct: 2, totalMs: 900, points: 40 } };
  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const restored = await decodeProgress(`ddd0:${base64}`, emptyData);
  assert.ok(restored);
  assert.equal(restored.totals.answered, 3);
});
