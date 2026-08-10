import type { MistakeStat } from "./engine";
// Laufzeitimport statt reinem Typimport — deshalb mit Endung, damit Node die Tests direkt ausführen kann.
import { sprintLength } from "./engine.ts";
import { nounById, type CategoryId } from "./data.ts";

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

/** Ein abgeschlossener Sprint — daraus entstehen Tempo und Genauigkeit pro Sprint. */
export interface SprintRun {
  answered: number;
  correct: number;
  totalMs: number;
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
  sprintRuns: SprintRun[];
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
  sprintRuns: [],
  days: {},
  mistakes: {},
  recentMistakes: [],
};

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function optionalMilliseconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

// Was im localStorage steht, kann von einer älteren Version oder von Hand stammen.
// Ohne Zahlenprüfung würde aus totals.answered: "1" beim nächsten Treffer die
// Zeichenkette "11", und ein aufgeblähtes mistakes-Objekt könnte den Speicher sprengen.
function sanitizeMistakes(value: unknown): Record<string, MistakeStat> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const mistakes: Record<string, MistakeStat> = {};
  for (const [id, rawStat] of Object.entries(value)) {
    if (!nounById.has(id)) continue;
    if (!rawStat || typeof rawStat !== "object" || Array.isArray(rawStat)) continue;
    const stat = rawStat as Partial<MistakeStat>;
    const wrong = nonNegativeInteger(stat.wrong);
    mistakes[id] = {
      wrong,
      seen: nonNegativeInteger(stat.seen),
      correctRun: nonNegativeInteger(stat.correctRun),
      mastered: stat.mastered === true && wrong === 0,
    };
  }
  return mistakes;
}

// Ohne Deckel ist die Tageshistorie das einzige unbegrenzte Feld: ein kurzer Code
// könnte daraus Megabyte machen und saveData an der Speichergrenze scheitern lassen.
const maxStoredDays = 800;

function sanitizeDays(value: unknown): Record<string, DayStat> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, DayStat]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const day = raw as Partial<DayStat>;
    const answered = nonNegativeInteger(day.answered);
    entries.push([key, {
      answered,
      // Mehr richtige als gegebene Antworten gibt es nicht — sonst zeigt die Genauigkeit Unsinn.
      correct: Math.min(answered, nonNegativeInteger(day.correct)),
      totalMs: nonNegativeInteger(day.totalMs),
    }]);
  }
  // ISO-Datumsschlüssel sortieren sich als Text richtig, also bleiben die jüngsten Tage.
  entries.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
  return Object.fromEntries(entries.slice(0, maxStoredDays));
}

// Wie die Tageshistorie wächst auch die Sprintliste sonst unbegrenzt — die Diagramme
// zeigen ohnehin nur die letzten Sprints.
export const maxStoredSprints = 100;

function sanitizeSprintRuns(value: unknown): SprintRun[] {
  if (!Array.isArray(value)) return [];
  const runs: SprintRun[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const run = raw as Partial<SprintRun>;
    const answered = nonNegativeInteger(run.answered);
    // Ohne Antworten gäbe es weder Tempo noch Genauigkeit — so ein Eintrag wäre eine Lücke im Diagramm.
    if (answered === 0) continue;
    runs.push({
      answered,
      correct: Math.min(answered, nonNegativeInteger(run.correct)),
      totalMs: nonNegativeInteger(run.totalMs),
    });
  }
  // Gekappt wird am älteren Ende, damit die jüngsten Sprints im Diagramm bleiben.
  return runs.slice(-maxStoredSprints);
}

export function sanitizeData(value: unknown): SprintData {
  if (!value || typeof value !== "object") return structuredClone(emptyData);
  const candidate = value as Partial<SprintData>;
  if (candidate.version !== 1) return structuredClone(emptyData);
  const mistakes = sanitizeMistakes(candidate.mistakes);
  // Zähler, die aufeinander aufbauen, werden aneinander gedeckelt.
  const totalsAnswered = nonNegativeInteger(candidate.totals?.answered);
  const sprintsCompleted = nonNegativeInteger(candidate.sprints?.completed);

  // Bewusst Feld für Feld statt mit Spread: ein geteilter Code darf keine
  // unbekannten Schlüssel in den Speicher schmuggeln.
  return {
    version: 1,
    theme: candidate.theme === "dark" ? "dark" : "light",
    settings: {
      sound: candidate.settings?.sound === true,
      feedbackDelay: typeof candidate.settings?.feedbackDelay === "number" && Number.isFinite(candidate.settings.feedbackDelay)
        ? Math.min(3000, Math.max(0, Math.floor(candidate.settings.feedbackDelay)))
        : emptyData.settings.feedbackDelay,
      category: isStoredCategory(candidate.settings?.category) ? candidate.settings.category : "all",
      installHintDismissed: candidate.settings?.installHintDismissed === true,
    },
    totals: {
      answered: totalsAnswered,
      correct: Math.min(totalsAnswered, nonNegativeInteger(candidate.totals?.correct)),
      totalMs: nonNegativeInteger(candidate.totals?.totalMs),
      points: nonNegativeInteger(candidate.totals?.points),
    },
    best: {
      speedMs: optionalMilliseconds(candidate.best?.speedMs),
      score: nonNegativeInteger(candidate.best?.score),
      streak: nonNegativeInteger(candidate.best?.streak),
    },
    sprints: {
      completed: sprintsCompleted,
      passed: Math.min(sprintsCompleted, nonNegativeInteger(candidate.sprints?.passed)),
      passStreak: nonNegativeInteger(candidate.sprints?.passStreak),
      bestCorrect: nonNegativeInteger(candidate.sprints?.bestCorrect),
      bestTimeMs: optionalMilliseconds(candidate.sprints?.bestTimeMs),
    },
    sprintRuns: sanitizeSprintRuns(candidate.sprintRuns),
    days: sanitizeDays(candidate.days),
    mistakes,
    recentMistakes: Array.isArray(candidate.recentMistakes)
      ? candidate.recentMistakes.filter((id): id is string => typeof id === "string" && nounById.has(id)).slice(0, 12)
      : [],
  };
}

/**
 * Der laufende Sprint. Jede Ansicht ist eine eigene Route, also wird die Komponente
 * beim Wechsel zu "Wiederholen" neu aufgebaut — ohne diese Momentaufnahme wären
 * Tempo, Genauigkeit und Sprintfortschritt danach weg, genau wie nach einem Neuladen.
 */
export interface ActiveSprint {
  category: CategoryId;
  answered: number;
  correct: number;
  totalMs: number;
  streak: number;
  points: number;
  progress: number;
  seconds: number;
  currentId: string;
  finished: boolean;
  wrongIds: string[];
  freshIds: string[];
  masteredAtStart: string[];
  recentIds: string[];
  reviews: Array<{ id: string; remaining: number; dueAtAnswered: number }>;
}

export const ACTIVE_KEY = "ddd-sprint:active:v1";

function knownIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // Der Deckel ist das Wörterbuch selbst: mehr verschiedene Wörter kann ein Sprint nicht berühren.
  return value.filter((id): id is string => typeof id === "string" && nounById.has(id)).slice(0, nounById.size);
}

export function sanitizeActiveSprint(value: unknown): ActiveSprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ActiveSprint>;
  if (!isStoredCategory(candidate.category)) return null;
  // Ohne gültiges aktuelles Wort gäbe es keine Frage, an der der Sprint weiterliefe.
  if (typeof candidate.currentId !== "string" || !nounById.has(candidate.currentId)) return null;
  const answered = nonNegativeInteger(candidate.answered);
  return {
    category: candidate.category,
    answered,
    correct: Math.min(answered, nonNegativeInteger(candidate.correct)),
    totalMs: nonNegativeInteger(candidate.totalMs),
    streak: nonNegativeInteger(candidate.streak),
    points: nonNegativeInteger(candidate.points),
    // Ein zu großer Fortschritt würde den Sprint sofort als geschafft zählen.
    progress: Math.min(sprintLength, nonNegativeInteger(candidate.progress)),
    seconds: nonNegativeInteger(candidate.seconds),
    currentId: candidate.currentId,
    finished: candidate.finished === true,
    wrongIds: knownIds(candidate.wrongIds),
    freshIds: knownIds(candidate.freshIds),
    masteredAtStart: knownIds(candidate.masteredAtStart),
    recentIds: knownIds(candidate.recentIds),
    reviews: Array.isArray(candidate.reviews)
      ? candidate.reviews
        .filter((item): item is ActiveSprint["reviews"][number] => Boolean(item) && typeof item === "object" && typeof item.id === "string" && nounById.has(item.id))
        .map((item) => ({ id: item.id, remaining: Math.min(2, nonNegativeInteger(item.remaining)), dueAtAnswered: nonNegativeInteger(item.dueAtAnswered) }))
        .filter((item) => item.remaining > 0)
        .slice(0, nounById.size)
      : [],
  };
}

export function loadActiveSprint(): ActiveSprint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? sanitizeActiveSprint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveActiveSprint(sprint: ActiveSprint): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(sprint));
  } catch {
    // Wie beim Lernstand: voller Speicher darf das Training nicht abbrechen.
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Voller oder gesperrter Speicher darf das Training nicht abbrechen —
    // die Sitzung läuft dann eben nur im Arbeitsspeicher weiter.
  }
}
