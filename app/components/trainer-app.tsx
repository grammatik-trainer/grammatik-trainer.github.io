"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  challengeNouns,
  nounById,
  nounCategories,
  nouns,
  nounsForCategory,
  type Article,
  type CategoryId,
  type Noun,
} from "../lib/data";
import {
  accuracy,
  articles,
  cappedElapsedMs,
  calculateDailyStreak,
  countNewlyMastered,
  dayKey,
  feedbackDelay,
  formatSeconds,
  freshQuotaDeficit,
  inactivityLimitMs,
  masteredWordIds,
  minimumRepeatGap,
  nextSprintStreak,
  nextSprintProgress,
  pickNext,
  remainingReviewCount,
  reviewIsDue,
  scheduleReviewAt,
  scoreAnswer,
  shouldForceFreshWord,
  sprintLength,
  updateWordProgress,
} from "../lib/engine";
import { hintAt } from "../lib/hints";
import { emptyData, loadData, saveData, type SprintData } from "../lib/storage";
import { routeState, trainingPath, viewPath, type TrainerView } from "../lib/routes";

interface SessionState {
  answered: number;
  correct: number;
  totalMs: number;
  streak: number;
  points: number;
  progress: number;
  pendingReviews: number;
  freshRemaining: number;
}

interface Feedback {
  choice: Article;
  correct: boolean;
  elapsedMs: number;
}

interface ReviewItem {
  id: string;
  dueAtAnswered: number;
}

/** Chrome reicht die Installation über dieses Event durch; Safari kennt es nicht. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

// Auf iOS löscht Safari den Fortschritt nach etwa einer Woche ohne Besuch, auf dem
// Startbildschirm nicht — dort ist der Hinweis eine Warnung und darf früher kommen.
const sprintsBeforeInstallHint = 3;
const sprintsBeforeInstallHintIos = 1;

const emptySession: SessionState = { answered: 0, correct: 0, totalMs: 0, streak: 0, points: 0, progress: 0, pendingReviews: 0, freshRemaining: 0 };

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function dateOffset(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function TrainerApp({ initialView = "training", initialCategory }: { initialView?: TrainerView; initialCategory?: CategoryId }) {
  const router = useRouter();
  const [view, setView] = useState<TrainerView>(initialView);
  const [data, setData] = useState<SprintData>(emptyData);
  const [session, setSession] = useState<SessionState>(emptySession);
  const [current, setCurrent] = useState<Noun>(() => nounsForCategory(initialCategory ?? "all")[0] ?? nouns[0]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [sprintFinished, setSprintFinished] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const installPrompt = useRef<InstallPromptEvent | null>(null);
  const [category, setCategory] = useState<CategoryId>(initialCategory ?? "all");
  const pool = useMemo(() => nounsForCategory(category), [category]);
  const startedAt = useRef(0);
  const lastActiveAt = useRef(0);
  const recentIds = useRef<string[]>([]);
  const reviewQueue = useRef<ReviewItem[]>([]);
  const reviewNeeds = useRef<Record<string, number>>({});
  const wrongThisSprint = useRef<Set<string>>(new Set());
  const freshThisSprint = useRef<Set<string>>(new Set());
  const [masteredAtSprintStart, setMasteredAtSprintStart] = useState<Set<string>>(() => new Set());
  const nextTimer = useRef<number | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = loadData();
      const restoredCategory = initialCategory ?? saved.settings.category;
      const restoredData = restoredCategory === saved.settings.category ? saved : { ...saved, settings: { ...saved.settings, category: restoredCategory } };
      setData(restoredData);
      document.documentElement.dataset.theme = restoredData.theme;
      setCategory(restoredCategory);
      if (restoredData !== saved) saveData(restoredData);
      if (initialView === "training" && initialCategory === undefined && restoredCategory !== "all") {
        router.replace(trainingPath(restoredCategory), { scroll: false });
      }
      const savedPool = nounsForCategory(restoredCategory);
      const poolIds = new Set(savedPool.map((noun) => noun.id));
      const pendingIds = restoredData.recentMistakes.filter((id) => poolIds.has(id) && remainingReviewCount(restoredData.mistakes[id]) > 0);
      reviewQueue.current = pendingIds.map((id) => ({ id, dueAtAnswered: 0 }));
      reviewNeeds.current = Object.fromEntries(pendingIds.map((id) => [id, remainingReviewCount(restoredData.mistakes[id])]));
      setMasteredAtSprintStart(masteredWordIds(restoredData.mistakes));
      setHintIndex(restoredData.sprints.completed);
      if (pendingIds.length) setSession({ ...emptySession, pendingReviews: pendingIds.length });
      setCurrent(pickNext(savedPool, "", restoredData.mistakes));
      startedAt.current = Date.now();
      lastActiveAt.current = Date.now();
      setReady(true);
    });
    return () => { active = false; };
  }, [initialCategory, initialView, router]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (view === "training" && !sprintFinished && document.visibilityState === "visible" && Date.now() - lastActiveAt.current < inactivityLimitMs) {
        setSeconds((value) => value + 1);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [sprintFinished, view]);

  useEffect(() => () => {
    if (nextTimer.current !== null) window.clearTimeout(nextTimer.current);
  }, []);

  useEffect(() => {
    // Im Dev-Server würde der Cache die ungehashten Modul-URLs von Vite festhalten.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ohne Service Worker läuft alles weiter, nur eben ohne Offline-Betrieb.
    });
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const readPlatform = () => {
      // Safari meldet den Homescreen-Modus über eine eigene, nicht standardisierte Eigenschaft.
      setIsStandalone(standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
      // iPadOS meldet sich als Mac, verrät sich aber über die Touchpunkte.
      const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || touchMac);
    };
    readPlatform();
    const capture = (event: Event) => {
      event.preventDefault();
      installPrompt.current = event as InstallPromptEvent;
      setCanInstall(true);
    };
    const installed = () => {
      installPrompt.current = null;
      setCanInstall(false);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    standalone.addEventListener("change", readPlatform);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
      standalone.removeEventListener("change", readPlatform);
    };
  }, []);

  const persist = useCallback((next: SprintData) => {
    setData(next);
    saveData(next);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    queueMicrotask(() => menuButtonRef.current?.focus());
  }, []);

  const dismissInstallHint = useCallback(() => {
    setData((current) => {
      const next = { ...current, settings: { ...current.settings, installHintDismissed: true } };
      saveData(next);
      return next;
    });
  }, []);

  const runInstall = useCallback(async () => {
    const event = installPrompt.current;
    if (!event) return;
    // Ein Prompt-Event lässt sich nur einmal verwenden; Chrome schickt bei Bedarf ein neues.
    await event.prompt().catch(() => undefined);
    installPrompt.current = null;
    setCanInstall(false);
  }, []);

  const openSettings = useCallback(() => {
    setMenuOpen(false);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    // Im Menü versteckt sich der Zahnrad-Knopf, sobald das Menü zuklappt — dann trägt der Menüknopf den Fokus.
    queueMicrotask(() => (settingsButtonRef.current?.offsetParent ? settingsButtonRef : menuButtonRef).current?.focus());
  }, []);

  const playTone = useCallback((correct: boolean) => {
    if (!data.settings.sound) return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = correct ? 620 : 180;
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
    } catch {
      // Sound is optional; training must continue when audio is unavailable.
    }
  }, [data.settings.sound]);

  const answer = useCallback((choice: Article) => {
    if (!ready || view !== "training" || feedback || sprintFinished) return;
    const answeredAt = Date.now();
    const elapsedMs = cappedElapsedMs(startedAt.current, answeredAt);
    lastActiveAt.current = answeredAt;
    const correct = choice === current.article;
    const nextStreak = correct ? session.streak + 1 : 0;
    const points = scoreAnswer(elapsedMs, nextStreak, correct);
    const today = dayKey();
    const oldDay = data.days[today] ?? { answered: 0, correct: 0, totalMs: 0 };
    const oldMistake = data.mistakes[current.id];
    // Ein in diesem Sprint verpasstes Wort kann erst im nächsten Sprint wieder sicher werden.
    const masteryAllowed = !wrongThisSprint.current.has(current.id);
    const nextMistake = updateWordProgress(oldMistake, correct, masteryAllowed);
    if (!correct) wrongThisSprint.current.add(current.id);
    const nextAnswered = session.answered + 1;
    const nextCorrect = session.correct + (correct ? 1 : 0);
    const previousReviewNeed = reviewNeeds.current[current.id] ?? 0;
    reviewQueue.current = reviewQueue.current.filter((item) => item.id !== current.id);
    if (!correct) {
      reviewNeeds.current[current.id] = 2;
      reviewQueue.current.push({ id: current.id, dueAtAnswered: scheduleReviewAt(nextAnswered) });
    } else if (previousReviewNeed > 0) {
      const remaining = previousReviewNeed - 1;
      if (remaining > 0) {
        reviewNeeds.current[current.id] = remaining;
        reviewQueue.current.push({ id: current.id, dueAtAnswered: scheduleReviewAt(nextAnswered) });
      } else {
        delete reviewNeeds.current[current.id];
      }
    }
    const hasPendingReviews = Object.values(reviewNeeds.current).some((remaining) => remaining > 0);
    const pendingReviews = Object.values(reviewNeeds.current).filter((remaining) => remaining > 0).length;
    // Jeder Sprint muss mindestens drei noch unsichere Wörter zeigen, solange es sie gibt.
    if (!oldMistake?.mastered) freshThisSprint.current.add(current.id);
    const nextMistakes = { ...data.mistakes, [current.id]: nextMistake };
    // Die Quote zählt gegen den Sprintstart — sonst senkt jedes neu gemeisterte Wort das eigene Ziel.
    const availableFresh = pool.filter((noun) => !masteredAtSprintStart.has(noun.id)).length;
    const freshDeficit = freshQuotaDeficit(freshThisSprint.current.size, availableFresh);
    const progress = nextSprintProgress(session.progress, correct, hasPendingReviews || freshDeficit > 0);
    const nextSession = {
      answered: nextAnswered,
      correct: nextCorrect,
      totalMs: session.totalMs + elapsedMs,
      streak: nextStreak,
      points: session.points + points,
      progress,
      pendingReviews,
      freshRemaining: freshDeficit,
    };
    const completesSprint = progress >= sprintLength && !hasPendingReviews && freshDeficit === 0;
    const nextData: SprintData = {
      ...data,
      totals: {
        answered: data.totals.answered + 1,
        correct: data.totals.correct + (correct ? 1 : 0),
        totalMs: data.totals.totalMs + elapsedMs,
        points: data.totals.points + points,
      },
      best: {
        speedMs: correct && (data.best.speedMs === null || elapsedMs < data.best.speedMs) ? elapsedMs : data.best.speedMs,
        score: Math.max(data.best.score, nextSession.points),
        streak: Math.max(data.best.streak, nextStreak),
      },
      sprints: completesSprint ? {
        completed: data.sprints.completed + 1,
        passed: data.sprints.passed + 1,
        passStreak: data.sprints.passStreak + 1,
        bestCorrect: sprintLength,
        bestTimeMs: data.sprints.bestTimeMs === null || nextSession.totalMs < data.sprints.bestTimeMs
          ? nextSession.totalMs
          : data.sprints.bestTimeMs,
      } : data.sprints,
      days: {
        ...data.days,
        [today]: {
          answered: oldDay.answered + 1,
          correct: oldDay.correct + (correct ? 1 : 0),
          totalMs: oldDay.totalMs + elapsedMs,
        },
      },
      mistakes: nextMistakes,
      recentMistakes: correct && nextMistake.wrong === 0
        ? data.recentMistakes.filter((id) => id !== current.id)
        : correct
          ? data.recentMistakes
          : [current.id, ...data.recentMistakes.filter((id) => id !== current.id)].slice(0, 12),
    };

    setFeedback({ choice, correct, elapsedMs });
    setSession(nextSession);
    persist(nextData);
    playTone(correct);
    if (completesSprint) lastActiveAt.current = 0;
    nextTimer.current = window.setTimeout(() => {
      setFeedback(null);
      setShowHint(false);
      if (completesSprint) {
        setSprintFinished(true);
        return;
      }
      recentIds.current = [...recentIds.current, current.id].slice(-minimumRepeatGap);
      const blocked = new Set(recentIds.current);
      const reviewIndex = reviewQueue.current.findIndex((item) => reviewIsDue(item.dueAtAnswered, nextSession.answered) && item.id !== current.id && !blocked.has(item.id));
      const reviewItem = reviewIndex >= 0 ? reviewQueue.current.splice(reviewIndex, 1)[0] : null;
      const duePool = pool.filter((noun) => !reviewNeeds.current[noun.id]);
      const basePool = duePool.length ? duePool : pool;
      const unmastered = basePool.filter((noun) => !nextMistakes[noun.id]?.mastered);
      // Ein Quotenpool, der nur das gerade beantwortete Wort enthält, würde es sofort wiederholen.
      const quotaUsable = unmastered.some((noun) => noun.id !== current.id);
      const quotaPool = shouldForceFreshWord(freshDeficit, progress) && quotaUsable ? unmastered : basePool;
      setCurrent((reviewItem && nounById.get(reviewItem.id)) || pickNext(quotaPool, current.id, nextData.mistakes, Math.random, recentIds.current));
      startedAt.current = Date.now();
      lastActiveAt.current = Date.now();
    }, feedbackDelay(nextData.settings.feedbackDelay, correct));
  }, [current, data, feedback, masteredAtSprintStart, persist, playTone, pool, ready, session, sprintFinished, view]);

  const startNextSprint = useCallback(() => {
    recentIds.current = [];
    wrongThisSprint.current = new Set();
    freshThisSprint.current = new Set();
    setHintIndex((index) => index + 1);
    setMasteredAtSprintStart(masteredWordIds(data.mistakes));
    setSession({ ...emptySession, streak: nextSprintStreak(session.streak) });
    setSeconds(0);
    setSprintFinished(false);
    setFeedback(null);
    setShowHint(false);
    const reviewItem = reviewQueue.current.shift();
    setCurrent((reviewItem && nounById.get(reviewItem.id)) || pickNext(pool, current.id, data.mistakes));
    startedAt.current = Date.now();
    lastActiveAt.current = Date.now();
  }, [current.id, data.mistakes, pool, session.streak]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (settingsOpen) {
        if (event.key === "Escape") closeSettings();
        return;
      }
      if (menuOpen) {
        if (event.key === "Escape") closeMenu();
        return;
      }
      if (sprintFinished && event.key === "Enter") {
        event.preventDefault();
        startNextSprint();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.matches("input, select, textarea, button, a, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const map: Record<string, Article> = { "1": "der", j: "der", "2": "die", k: "die", "3": "das", l: "das" };
      if (map[key]) {
        event.preventDefault();
        answer(map[key]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [answer, closeMenu, closeSettings, menuOpen, settingsOpen, sprintFinished, startNextSprint]);

  const changeTheme = () => {
    const theme = data.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    persist({ ...data, theme });
  };

  const changeCategory = useCallback((nextCategory: CategoryId, historyMode: "push" | "none" = "push") => {
    if (nextTimer.current !== null) window.clearTimeout(nextTimer.current);
    const nextPool = nounsForCategory(nextCategory);
    const nextData = { ...data, settings: { ...data.settings, category: nextCategory } };
    reviewQueue.current = [];
    reviewNeeds.current = {};
    wrongThisSprint.current = new Set();
    freshThisSprint.current = new Set();
    setMasteredAtSprintStart(masteredWordIds(nextData.mistakes));
    recentIds.current = [];
    setCategory(nextCategory);
    setSession(emptySession);
    setSeconds(0);
    setFeedback(null);
    setShowHint(false);
    setSprintFinished(false);
    setCurrent(pickNext(nextPool, "", nextData.mistakes));
    startedAt.current = Date.now();
    lastActiveAt.current = Date.now();
    persist(nextData);
    const path = trainingPath(nextCategory);
    if (historyMode === "push" && window.location.pathname !== path) router.push(path, { scroll: false });
  }, [data, persist, router]);

  useEffect(() => {
    const handlePopState = () => {
      const next = routeState(window.location.pathname);
      if (!next) return;
      setView(next.view);
      if (next.category && next.category !== category) changeCategory(next.category, "none");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [category, changeCategory]);

  const navigateView = (nextView: TrainerView) => {
    setView(nextView);
    setMenuOpen(false);
    const path = viewPath(nextView, category);
    if (window.location.pathname !== path) router.push(path, { scroll: false });
  };

  const handleViewLink = (event: MouseEvent<HTMLAnchorElement>, nextView: TrainerView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateView(nextView);
  };

  const handleCategoryLink = (event: MouseEvent<HTMLAnchorElement>, nextCategory: CategoryId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setView("training");
    if (nextCategory === category) navigateView("training");
    else changeCategory(nextCategory);
  };

  const resetProgress = () => {
    if (!window.confirm("Gesamten Lernfortschritt wirklich zurücksetzen?")) return;
    const nextData: SprintData = {
      ...structuredClone(emptyData),
      theme: data.theme,
      settings: { ...data.settings },
    };
    reviewQueue.current = [];
    reviewNeeds.current = {};
    wrongThisSprint.current = new Set();
    freshThisSprint.current = new Set();
    setMasteredAtSprintStart(new Set());
    recentIds.current = [];
    setSession(emptySession);
    setSeconds(0);
    setFeedback(null);
    setShowHint(false);
    setSprintFinished(false);
    setSettingsOpen(false);
    setCurrent(pickNext(pool, "", {}));
    startedAt.current = Date.now();
    lastActiveAt.current = Date.now();
    persist(nextData);
  };

  const reviewNouns = useMemo(() => Object.entries(data.mistakes)
    .filter(([, stat]) => stat.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .map(([id, stat]) => ({ noun: nounById.get(id), stat }))
    .filter((item): item is { noun: Noun; stat: typeof item.stat } => Boolean(item.noun)), [data.mistakes]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = dateOffset(index - 6);
    const key = dayKey(date);
    return { key, label: new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date).slice(0, 2), value: data.days[key]?.answered ?? 0 };
  }), [data.days]);
  const maxDay = Math.max(1, ...week.map((day) => day.value));
  const dailyStreak = calculateDailyStreak(data.days);
  const masteredCount = nouns.filter((noun) => data.mistakes[noun.id]?.mastered).length;
  const challengeMastered = challengeNouns.filter((noun) => data.mistakes[noun.id]?.mastered).length;
  const currentMastered = pool.filter((noun) => data.mistakes[noun.id]?.mastered).length;
  const newMasteredCount = countNewlyMastered(pool, data.mistakes, masteredAtSprintStart);
  const currentCategory = nounCategories.find((item) => item.id === category) ?? nounCategories[0];
  const hint = hintAt(hintIndex);
  // Erst nach ein paar geschafften Sprints fragen — vorher weiß niemand, ob die App etwas taugt.
  // Ohne Prompt und ohne iOS-Teilen-Menü gäbe es nichts anzubieten — etwa in Desktop-Firefox.
  const installOffered = !isStandalone && (canInstall || isIos);
  const showInstallHint = ready && installOffered && !data.settings.installHintDismissed
    && data.sprints.completed >= (isIos ? sprintsBeforeInstallHintIos : sprintsBeforeInstallHint);
  const sessionAccuracy = accuracy(session.correct, session.answered);
  const sessionAverage = session.answered ? session.totalMs / session.answered : 0;
  const totalAccuracy = accuracy(data.totals.correct, data.totals.answered);
  const mistakesThisSprint = session.answered - session.correct;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "EducationalApplication",
    name: "Der Die Das Sprint",
    description: currentCategory.description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: "de",
    educationalLevel: "A1–B2",
    isAccessibleForFree: true,
  };

  return (
    <div className={`app-shell${ready ? " data-ready" : ""}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <a className="skip-link" href="#main-content">Zum Training springen</a>
      <header className="topbar">
        <a className="brand" href={trainingPath(category)} onClick={(event) => handleViewLink(event, "training")} aria-label="Der Die Das Sprint — Training">
          <span className="wordmark"><b>Der</b><i>/</i><b>Die</b><i>/</i><b>Das</b></span>
          <small>Deutsch. Schnell. Sicher.</small>
        </a>

        <button ref={menuButtonRef} className="menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Menü schließen" : "Menü öffnen"} aria-expanded={menuOpen} aria-controls="topbar-menu">{menuOpen ? "✕" : "☰"}</button>

        <div className={`topbar-menu${menuOpen ? " open" : ""}`} id="topbar-menu">
          <nav aria-label="Hauptnavigation">
            <a href={trainingPath(category)} className={view === "training" ? "active" : ""} aria-current={view === "training" ? "page" : undefined} onClick={(event) => handleViewLink(event, "training")}><Icon>ϟ</Icon>Training</a>
            <a href="/review/" className={view === "review" ? "active" : ""} aria-current={view === "review" ? "page" : undefined} onClick={(event) => handleViewLink(event, "review")}><Icon>◎</Icon>Wiederholen</a>
            <a href="/progress/" className={view === "progress" ? "active" : ""} aria-current={view === "progress" ? "page" : undefined} onClick={(event) => handleViewLink(event, "progress")}><Icon>▥</Icon>Fortschritt</a>
          </nav>

          <div className="header-actions">
            <button ref={settingsButtonRef} className="round-button" type="button" onClick={openSettings} aria-label="Einstellungen"><span aria-hidden="true">⚙</span><span className="action-label">Einstellungen</span></button>
            <button className="round-button theme-button local-data" type="button" onClick={changeTheme} aria-label={`${data.theme === "light" ? "Dunkles" : "Helles"} Farbschema aktivieren`}><span aria-hidden="true">{data.theme === "light" ? "☼" : "☾"}</span><span className="action-label">Farbschema</span></button>
          </div>
        </div>
      </header>

      {menuOpen && <div className="menu-backdrop" role="presentation" onMouseDown={closeMenu} />}

      <main id="main-content" tabIndex={-1}>
        {view === "training" && showInstallHint && (
          <section className="install-note local-data" aria-label="App installieren">
            <Icon>⤓</Icon>
            <p><strong>Leg dir das Training auf den Startbildschirm.</strong><br />{canInstall ? "Ein Tippen — danach startet es ohne Browserleiste." : "Teilen → Zum Home-Bildschirm. Nur dort bleibt dein Fortschritt dauerhaft: Safari löscht ihn nach etwa einer Woche ohne Besuch."}</p>
            {canInstall && <button className="install-button" type="button" onClick={runInstall}>Installieren</button>}
            <button className="round-button" type="button" onClick={dismissInstallHint} aria-label="Hinweis ausblenden">×</button>
          </section>
        )}

        {view === "training" && (
          <div className="training-layout">
            <aside className="session-column" aria-label="Sitzungsstatistik">
              <section className="card session-card">
                <div className="card-heading"><h2>Deine Session</h2><span className="pill">Heute</span></div>
                <div className="metric-grid local-data">
                  <div><Icon>◷</Icon><span>Tempo</span><strong>{formatSeconds(sessionAverage)}</strong><small>pausiert nach 10 s</small></div>
                  <div><Icon>◎</Icon><span>Genauigkeit</span><strong>{session.answered ? `${sessionAccuracy}%` : "—"}</strong><small>richtig</small></div>
                  <div><Icon>ϟ</Icon><span>Antwortserie</span><strong>{session.streak}</strong><small>richtig in Folge</small></div>
                  <div><Icon>✓</Icon><span>Sichere Wörter</span><strong>{currentMastered}/{pool.length}</strong><small>{currentCategory.label}</small></div>
                </div>
              </section>

              <section className="focus-note" aria-label="Trainingshinweis">
                <Icon>➜</Icon>
                <p className="local-data" aria-live="polite"><strong>{hint.headline}</strong><br />{hint.detail}</p>
                <button className="hint-next" type="button" onClick={() => setHintIndex((index) => index + 1)} aria-label="Nächster Hinweis">›</button>
              </section>

              <section className="card personal-card">
                <div className="card-heading"><h2>Bestleistung</h2></div>
                <div className="personal-grid local-data">
                  <div><span>Sprints</span><strong>{data.sprints.completed || "—"}</strong></div>
                  <div><span>Längste Antwortserie</span><strong>{data.best.streak || "—"}</strong></div>
                </div>
                <div className="daily-streak local-data"><span>Tage in Folge</span><strong>♨ {dailyStreak}</strong><small>{dailyStreak ? "Weiter so!" : "Heute starten"}</small></div>
              </section>
            </aside>

            <section className="trainer-card card" aria-labelledby="trainer-title">
              <div className="trainer-meta">
                <div className="local-data">
                  <label className="category-picker">
                    <span className="sr-only">Kategorie wählen</span>
                    <select value={category} onChange={(event) => changeCategory(event.target.value as CategoryId)}>
                      {nounCategories.map((item) => {
                        // Die Zusatzliste braucht den Hinweis, dass sie zum Basiswortschatz hinzukommt.
                        const note = item.id === "challenge" ? " (zusätzlich)" : "";
                        return <option value={item.id} key={item.id}>{item.label} · {nounsForCategory(item.id).length}{note}</option>;
                      })}
                    </select>
                  </label>
                  <strong>{currentCategory.description}</strong>
                </div>
                <div className="question-meta local-data"><span>Ziel<strong>{session.progress}/{sprintLength}</strong></span><span>Zeit<strong>{formatClock(seconds)}</strong></span></div>
              </div>

              {sprintFinished ? (
                <div className="sprint-result" aria-live="polite">
                  <span className="result-badge passed">✓ Sprint geschafft</span>
                  <h1 id="trainer-title">12<small>/12</small></h1>
                  <p>{mistakesThisSprint ? "Alle Fehler wurden zweimal richtig wiederholt." : "Fehlerfrei — stärker geht es nicht."}</p>
                  <div className="result-metrics">
                    <span><small>Fragen</small><strong>{session.answered}</strong></span>
                    <span><small>Fehler</small><strong>{mistakesThisSprint}</strong></span>
                    <span><small>Zeit</small><strong>{formatClock(seconds)}</strong></span>
                    <span><small>Neu sicher</small><strong>+{newMasteredCount}</strong></span>
                  </div>
                  <button className="primary-button" type="button" onClick={startNextSprint}>Nächster Sprint</button>
                </div>
              ) : (
                <>
                  <div className="prompt">
                    <p id="trainer-title">Wähle den richtigen Artikel</p>
                    <h1 aria-busy={!ready}>
                      <span aria-hidden="true">___</span>
                      {ready ? ` ${current.word}` : <span className="sr-only">Wort wird geladen</span>}
                    </h1>
                    <div className={`hint${showHint ? " visible" : ""}`}>{showHint ? `${current.translation} · Plural: ${current.plural}` : ""}</div>
                  </div>

                  <div className="answers" aria-label="Antwortmöglichkeiten">
                    {articles.map((article, index) => {
                      const state = feedback
                        ? article === current.article ? "correct" : article === feedback.choice ? "wrong" : "muted"
                        : "";
                      const revealedCorrect = feedback && !feedback.correct && article === current.article;
                      return <button data-testid={`answer-${article}`} className={`answer answer-${article} ${state}${revealedCorrect ? " revealed-correct" : ""}`} type="button" disabled={!ready || Boolean(feedback)} onClick={() => answer(article)} aria-label={`${article}${revealedCorrect ? " — richtige Antwort" : ""}`} key={article}><kbd>{index + 1}</kbd><strong>{article}</strong><small>{["J", "K", "L"][index]}</small></button>;
                    })}
                  </div>

                  <div className="feedback-row" aria-live="polite">
                    {feedback ? <span className={feedback.correct ? "success" : "error"}>{feedback.correct ? `Richtig · ${formatSeconds(feedback.elapsedMs)}` : `Fast — ${current.article} ${current.word}`}</span> : <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><em>oder</em><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd></span>}
                    <button type="button" onClick={() => setShowHint((value) => !value)} aria-pressed={showHint}>Hinweis</button>
                  </div>
                </>
              )}
              <div className="sprint-progress" aria-label={`Sprint-Fortschritt: ${session.progress} von ${sprintLength}`} role="progressbar" aria-valuemin={0} aria-valuemax={sprintLength} aria-valuenow={session.progress}>
                <div className="local-data"><span>Sprint {session.progress}/{sprintLength}</span><strong>{session.pendingReviews ? `${session.pendingReviews} im Wiederholen` : session.freshRemaining ? `${session.freshRemaining} ${session.freshRemaining === 1 ? "unsicheres Wort" : "unsichere Wörter"} offen` :`${currentMastered}/${pool.length} sicher`}</strong></div>
                <span className="sprint-progress-track"><i style={{ width: `${(session.progress / sprintLength) * 100}%` }} /></span>
              </div>
            </section>

            <section className="card week-card">
              <div className="card-heading"><h2>Diese Woche</h2><button type="button" onClick={() => navigateView("progress")}>Alle Details</button></div>
              <div className="mini-chart local-data">{week.map((day) => <div key={day.key}><span><i style={{ height: `${Math.max(day.value ? 16 : 3, (day.value / maxDay) * 100)}%` }} /></span><small>{day.label}</small></div>)}</div>
            </section>

            <section className="card mistakes-card">
              <div className="card-heading"><h2>Zuletzt verwechselt</h2><button type="button" onClick={() => navigateView("review")}>Alle zeigen</button></div>
              <div className="mistake-list local-data">{data.recentMistakes.slice(0, 3).map((id) => {
                const noun = nounById.get(id);
                if (!noun) return null;
                return <div key={id}><b className={`tag tag-${noun.article}`}>{noun.article}</b><span>{noun.word}</span><small>{data.mistakes[id]?.wrong ?? 0}× offen</small></div>;
              })}{data.recentMistakes.length === 0 && <p className="empty-copy">Noch keine Fehler. Leg einfach los.</p>}</div>
            </section>
          </div>
        )}

        {view === "review" && (
          <section className="content-page">
            <div className="page-heading"><span>Gezielt trainieren</span><h1>Deine schwierigen Wörter</h1><p>Fehler kommen im Training automatisch häufiger zurück.</p></div>
            <div className="review-grid local-data">{reviewNouns.map(({ noun, stat }) => <article className="card review-card" key={noun.id}><b className={`tag tag-${noun.article}`}>{noun.article}</b><h2>{noun.word}</h2><p>{noun.translation} · Plural: {noun.plural}</p><span>{stat.wrong}× noch unsicher</span></article>)}</div>
            {reviewNouns.length === 0 && <div className="card empty-state local-data"><Icon>◎</Icon><h2>Noch nichts zu wiederholen</h2><p>Deine falschen Antworten erscheinen hier.</p><button className="primary-button" onClick={() => navigateView("training")}>Training starten</button></div>}
          </section>
        )}

        {view === "progress" && (
          <section className="content-page">
            <div className="page-heading"><span>Nur auf diesem Gerät gespeichert</span><h1>Dein Fortschritt</h1><p className="local-data">{masteredCount} von {nouns.length} Basiswörtern sitzen bereits sicher.</p></div>
            <div className="summary-grid local-data">
              <article className="card summary-card"><Icon>✓</Icon><span>Basiswörter</span><strong>{masteredCount}/{nouns.length}</strong></article>
              <article className="card summary-card"><Icon>◆</Icon><span>Schwer & selten</span><strong>{challengeMastered}/{challengeNouns.length}</strong></article>
              <article className="card summary-card"><Icon>◎</Icon><span>Genauigkeit</span><strong>{data.totals.answered ? `${totalAccuracy}%` : "—"}</strong></article>
              <article className="card summary-card"><Icon>⚑</Icon><span>Sprints geschafft</span><strong>{data.sprints.passed}</strong></article>
            </div>
            <article className="card large-chart-card local-data"><div className="card-heading"><h2>Letzte sieben Tage</h2><span className="pill">Antworten</span></div><div className="large-chart">{week.map((day) => <div key={day.key}><strong>{day.value || ""}</strong><span><i style={{ height: `${Math.max(day.value ? 12 : 2, (day.value / maxDay) * 100)}%` }} /></span><small>{day.label}</small></div>)}</div></article>
            <article className="card reference-card"><div><span>Mini-Spickzettel</span><h2>Das Grundmuster</h2></div><div><b className="tag tag-der">der</b><span>häufig: -er, -en, -ig, -ling</span></div><div><b className="tag tag-die">die</b><span>häufig: -ung, -heit, -keit, -schaft</span></div><div><b className="tag tag-das">das</b><span>häufig: -chen, -lein, -ment, -um</span></div></article>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <p>300 deutsche Substantive von A1 bis B2.<br />Kein Konto — dein Fortschritt bleibt im lokalen Speicher des Browsers.<br />Im selben Browser lernst du einfach weiter.</p>
        <nav aria-label="Trainingskategorien">
          {nounCategories.map((item) => <a key={item.id} href={trainingPath(item.id)} onClick={(event) => handleCategoryLink(event, item.id)}>{item.label}</a>)}
        </nav>
        <p><a href="https://github.com/grammatik-trainer/grammatik-trainer.github.io" target="_blank" rel="noopener noreferrer">GitHub</a> — mitmachen &amp; Fehler melden</p>
      </footer>

      {settingsOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="card-heading"><h2 id="settings-title">Einstellungen</h2><button className="round-button" onClick={closeSettings} aria-label="Einstellungen schließen" autoFocus>×</button></div>
            <label className="setting-row"><span><strong>Töne</strong><small>Kurzes Feedback nach jeder Antwort</small></span><input type="checkbox" checked={data.settings.sound} onChange={(event) => persist({ ...data, settings: { ...data.settings, sound: event.target.checked } })} /></label>
            <label className="setting-row"><span><strong>Tempo</strong><small>Wie schnell die nächste Frage erscheint</small></span><select value={data.settings.feedbackDelay} onChange={(event) => persist({ ...data, settings: { ...data.settings, feedbackDelay: Number(event.target.value) } })}><option value="250">Schnell</option><option value="420">Normal</option><option value="700">Ruhig</option></select></label>
            {installOffered && (
              <div className="setting-row">
                <span><strong>Zum Startbildschirm</strong><small>{canInstall ? "Als App ohne Browserleiste öffnen" : "Teilen → Zum Home-Bildschirm. Safari löscht den Fortschritt sonst nach etwa einer Woche ohne Besuch."}</small></span>
                {canInstall && <button className="install-button" type="button" onClick={runInstall}>Installieren</button>}
              </div>
            )}
            <button className="reset-button" type="button" onClick={resetProgress}>Lernfortschritt zurücksetzen</button>
            <p className="privacy-note">Dein Fortschritt bleibt ausschließlich im Browser dieses Geräts.</p>
          </section>
        </div>
      )}
    </div>
  );
}
