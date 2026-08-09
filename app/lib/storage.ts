import type { MistakeStat } from "./engine";
import type { CategoryId } from "./data";

const categoryIds = new Set<CategoryId>(["all", "life", "people", "travel", "nature", "challenge"]);

function isStoredCategory(value: unknown): value is CategoryId {
  return typeof value === "string" && categoryIds.has(value as CategoryId);
}

export type Theme = "light" | "dark";

export interface DayStat {
  answered: number;
  correct: number;
  totalMs: number;
}

export interface SprintStat {
  completed: number;
  passed: number;
  passStreak: number;
  bestCorrect: number;
  bestTimeMs: number | null;
}

export interface SprintData {
  version: 1;
  theme: Theme;
  settings: {
    sound: boolean;
    feedbackDelay: number;
    category: CategoryId;
    installHintDismissed: boolean;
  };
  totals: {
    answered: number;
    correct: number;
    totalMs: number;
    points: number;
  };
  best: {
    speedMs: number | null;
    score: number;
    streak: number;
  };
  sprints: SprintStat;
  days: Record<string, DayStat>;
  mistakes: Record<string, MistakeStat>;
  recentMistakes: string[];
}

export const STORAGE_KEY = "ddd-sprint:v1";

export const emptyData: SprintData = {
  version: 1,
  theme: "light",
  settings: { sound: false, feedbackDelay: 420, category: "all", installHintDismissed: false },
  totals: { answered: 0, correct: 0, totalMs: 0, points: 0 },
  best: { speedMs: null, score: 0, streak: 0 },
  sprints: { completed: 0, passed: 0, passStreak: 0, bestCorrect: 0, bestTimeMs: null },
  days: {},
  mistakes: {},
  recentMistakes: [],
};

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sanitizeMistakes(value: unknown): Record<string, MistakeStat> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const mistakes: Record<string, MistakeStat> = {};
  for (const [id, rawStat] of Object.entries(value)) {
    if (!rawStat || typeof rawStat !== "object" || Array.isArray(rawStat)) continue;
    const stat = rawStat as Partial<MistakeStat>;
    const wrong = nonNegativeInteger(stat.wrong);
    mistakes[id] = {
      wrong,
      seen: nonNegativeInteger(stat.seen),
      lastWrong: typeof stat.lastWrong === "string" ? stat.lastWrong : "",
      correctRun: nonNegativeInteger(stat.correctRun),
      mastered: stat.mastered === true && wrong === 0,
    };
  }
  return mistakes;
}

export function sanitizeData(value: unknown): SprintData {
  if (!value || typeof value !== "object") return structuredClone(emptyData);
  const candidate = value as Partial<SprintData>;
  if (candidate.version !== 1) return structuredClone(emptyData);
  const mistakes = sanitizeMistakes(candidate.mistakes);

  return {
    ...structuredClone(emptyData),
    ...candidate,
    version: 1,
    theme: candidate.theme === "dark" ? "dark" : "light",
    settings: {
      ...emptyData.settings,
      ...candidate.settings,
      category: isStoredCategory(candidate.settings?.category) ? candidate.settings.category : "all",
      installHintDismissed: candidate.settings?.installHintDismissed === true,
    },
    totals: { ...emptyData.totals, ...candidate.totals },
    best: { ...emptyData.best, ...candidate.best },
    sprints: { ...emptyData.sprints, ...candidate.sprints },
    days: candidate.days && typeof candidate.days === "object" ? candidate.days : {},
    mistakes,
    recentMistakes: Array.isArray(candidate.recentMistakes)
      ? candidate.recentMistakes.filter((id): id is string => typeof id === "string").slice(0, 12)
      : [],
  };
}

export function loadData(): SprintData {
  if (typeof window === "undefined") return structuredClone(emptyData);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeData(JSON.parse(raw)) : structuredClone(emptyData);
  } catch {
    return structuredClone(emptyData);
  }
}

export function saveData(data: SprintData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
