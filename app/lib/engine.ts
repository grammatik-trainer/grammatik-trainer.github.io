import type { Article, Noun } from "./data";

export const articles: Article[] = ["der", "die", "das"];
export const wrongAnswerExtraDelayMs = 1000;
export const sprintLength = 12;
export const inactivityLimitMs = 10_000;
export const masteryTarget = 2;
export const minimumFreshPerSprint = 3;
export const minimumRepeatGap = 3;
export const maximumRepeatGap = 5;

export function randomRepeatGap(random = Math.random): number {
  const value = Math.min(0.999999, Math.max(0, random()));
  return minimumRepeatGap + Math.floor(value * (maximumRepeatGap - minimumRepeatGap + 1));
}

export function scheduleReviewAt(answered: number, random = Math.random): number {
  const safeAnswered = Number.isFinite(answered) ? Math.max(0, Math.floor(answered)) : 0;
  return safeAnswered + randomRepeatGap(random);
}

export function reviewIsDue(dueAtAnswered: number, answered: number): boolean {
  return dueAtAnswered <= answered;
}

export function nextSprintStreak(streak: number): number {
  return Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0;
}

export function nextSprintProgress(progress: number, correct: boolean, hasPendingReviews: boolean): number {
  if (!correct) return Math.max(0, Math.floor((Math.max(0, progress) - 1) / 4) * 4);
  return Math.min(hasPendingReviews ? sprintLength - 1 : sprintLength, Math.max(0, progress) + 1);
}

/** Wie viele noch unsichere Wörter dem Sprint bis zur Mindestquote fehlen. */
export function freshQuotaDeficit(freshSeen: number, availableFresh: number): number {
  const target = Math.min(minimumFreshPerSprint, Math.max(0, Math.floor(availableFresh)));
  return Math.max(0, target - Math.max(0, Math.floor(freshSeen)));
}

/** Ab wann der Sprint gezielt unsichere Wörter nachziehen muss, statt frei zu würfeln. */
export function shouldForceFreshWord(deficit: number, progress: number): boolean {
  return deficit > 0 && sprintLength - Math.max(0, progress) <= deficit;
}

export interface MistakeStat {
  wrong: number;
  seen: number;
  correctRun?: number;
  mastered?: boolean;
}

export function cappedElapsedMs(startedAt: number, answeredAt = Date.now()): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(answeredAt)) return 100;
  return Math.min(inactivityLimitMs, Math.max(100, answeredAt - startedAt));
}

export function updateWordProgress(
  stat: MistakeStat | undefined,
  correct: boolean,
  masteryAllowed = true,
): MistakeStat {
  const previous = stat ?? { wrong: 0, seen: 0, correctRun: 0, mastered: false };
  const wrong = correct ? Math.max(0, previous.wrong - 1) : masteryTarget;
  const correctRun = correct ? Math.min(masteryTarget, (previous.correctRun ?? 0) + 1) : 0;
  return {
    seen: previous.seen + 1,
    wrong,
    correctRun,
    mastered: masteryAllowed && correct && wrong === 0 && correctRun >= masteryTarget,
  };
}

export function remainingReviewCount(stat: MistakeStat | undefined): number {
  if (!stat || !Number.isFinite(stat.wrong)) return 0;
  return Math.min(masteryTarget, Math.max(0, Math.floor(stat.wrong)));
}

export function masteredWordIds(mistakes: Record<string, MistakeStat>): Set<string> {
  return new Set(Object.entries(mistakes).filter(([, stat]) => stat.mastered).map(([id]) => id));
}

export function countNewlyMastered(pool: Noun[], mistakes: Record<string, MistakeStat>, masteredAtStart: ReadonlySet<string>): number {
  return pool.filter((noun) => mistakes[noun.id]?.mastered && !masteredAtStart.has(noun.id)).length;
}

export function scoreAnswer(elapsedMs: number, streak: number, correct: boolean): number {
  if (!correct) return 0;
  const speed = Math.max(10, 90 - Math.floor(Math.max(0, elapsedMs - 500) / 35));
  return speed + Math.min(40, streak * 2);
}

export function feedbackDelay(baseDelayMs: number, correct: boolean): number {
  return baseDelayMs + (correct ? 0 : wrongAnswerExtraDelayMs);
}

export function pickNext(
  pool: Noun[],
  currentId: string,
  mistakes: Record<string, MistakeStat>,
  random = Math.random,
  recentIds: string[] = [],
): Noun {
  const blocked = new Set([currentId, ...recentIds.slice(-minimumRepeatGap)]);
  let candidates = pool.filter((noun) => !blocked.has(noun.id));
  if (candidates.length === 0) candidates = pool.filter((noun) => noun.id !== currentId);
  if (candidates.length === 0) return pool[0];

  const weighted = candidates.map((noun) => {
    const stat = mistakes[noun.id];
    const unseenBoost = stat?.seen ? 0 : 4;
    const learningBoost = stat?.mastered ? 0 : 2;
    const mistakeBoost = Math.min(12, stat?.wrong ?? 0) * 3;
    return { noun, weight: 1 + unseenBoost + learningBoost + mistakeBoost };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.noun;
  }
  return weighted[weighted.length - 1].noun;
}

export function accuracy(correct: number, answered: number): number {
  return answered === 0 ? 0 : Math.round((correct / answered) * 100);
}

export function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

export function dayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day - 1);
  return dayKey(date);
}

export function calculateDailyStreak(days: Record<string, { answered: number }>, today = dayKey()): number {
  let key = days[today]?.answered ? today : previousDay(today);
  let streak = 0;
  while (days[key]?.answered) {
    streak += 1;
    key = previousDay(key);
  }
  return streak;
}
