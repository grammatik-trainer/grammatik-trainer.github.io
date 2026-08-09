export interface TrainerHint {
  headline: string;
  detail: string;
}

/** Die Regeln, die das Training sonst nirgends erklärt — Kernregeln zuerst. */
export const trainerHints: TrainerHint[] = [
  {
    headline: "Zweimal richtig hintereinander — dann gilt ein Wort als sicher.",
    detail: "Ein Fehler setzt die Serie zurück; das Wort beginnt wieder bei null.",
  },
  {
    headline: "Falsch beantwortete Wörter kommen nach 3–5 anderen Wörtern zurück.",
    detail: "So bleibt der Abstand groß genug, dass du dich wirklich erinnern musst.",
  },
  {
    headline: "Ein Wort, das du im laufenden Sprint verpasst hast, wird frühestens im nächsten sicher.",
    detail: "Die zwei Wiederholungen holen es zurück — den Titel gibt es erst danach.",
  },
  {
    headline: "Jeder Sprint zeigt mindestens drei noch unsichere Wörter.",
    detail: "Auch wenn fast alles sitzt, kommt der Rest garantiert an die Reihe.",
  },
  {
    headline: "Ein Fehler nimmt einem sicheren Wort den Status sofort.",
    detail: "Egal, wie oft es vorher saß — es zählt wieder als unsicher.",
  },
  {
    headline: "Sichere Wörter verschwinden nicht, sie kommen nur rund dreimal seltener.",
    detail: "Kurze Auffrischungen halten sie im Gedächtnis.",
  },
  {
    headline: "Zwölf richtige Antworten bringen den Sprint ins Ziel.",
    detail: "Ein Fehler wirft dich auf die letzte Vierermarke zurück, nicht auf null.",
  },
  {
    headline: "Nach zehn Sekunden ohne Antwort pausiert die Zeit.",
    detail: "Pausen kosten dich nichts — gemessen wird nur, was du wirklich brauchst.",
  },
  {
    headline: "Der Hinweis zeigt Übersetzung und Plural.",
    detail: "Er kostet nichts — nutze ihn, statt zu raten.",
  },
  {
    headline: "Mit 1/2/3 oder J/K/L antwortest du ohne Maus.",
    detail: "Das spart bei jedem Wort einen Sekundenbruchteil.",
  },
  {
    headline: "Kategorien wechseln den Wortschatz, nicht deinen Fortschritt.",
    detail: "Der Lernstand jedes Wortes bleibt erhalten.",
  },
  {
    headline: "Schon eine Antwort pro Tag hält deine Tagesserie am Leben.",
    detail: "Länge zählt hier mehr als Menge.",
  },
];

export function hintAt(index: number): TrainerHint {
  const count = trainerHints.length;
  const safe = Number.isFinite(index) ? Math.floor(index) : 0;
  return trainerHints[((safe % count) + count) % count];
}
