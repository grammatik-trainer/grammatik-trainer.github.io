export interface TrainerHint {
  headline: string;
  detail: string;
}

/** Die Regeln, die das Training sonst nirgends erklärt — Kernregeln zuerst. */
export const trainerHints: TrainerHint[] = [
  {
    headline: "Ein Wort wird sicher, wenn du es zweimal nacheinander richtig hast.",
    detail: "Hast du es im selben Sprint verpasst, zählt es frühestens im nächsten.",
  },
  {
    headline: "Dein Fortschritt liegt im lokalen Speicher deines Browsers.",
    detail: "Kein Konto nötig. Auf dem iPhone bleibt er nur erhalten, wenn du das Training auf den Startbildschirm legst.",
  },
  {
    headline: "Falsch beantwortete Wörter kommen nach 3–5 anderen Wörtern zurück.",
    detail: "So bleibt der Abstand groß genug, dass du dich wirklich erinnern musst.",
  },
  {
    headline: "Ein verpasstes Wort musst du zweimal richtig wiederholen.",
    detail: "Vorher endet der Sprint nicht, auch wenn das Ziel schon erreicht ist.",
  },
  {
    headline: "Jeder Sprint zeigt mindestens drei noch unsichere Wörter.",
    detail: "Auch wenn fast alles sitzt, kommt der Rest garantiert an die Reihe.",
  },
  {
    headline: "Ein Fehler nimmt einem sicheren Wort den Status sofort.",
    detail: "Die Serie beginnt wieder bei null — egal, wie oft das Wort vorher saß.",
  },
  {
    headline: "Sichere Wörter verschwinden nicht, sie kommen nur seltener.",
    detail: "Kurze Auffrischungen halten sie im Gedächtnis.",
  },
  {
    headline: "Zwölf richtige Antworten bringen den Sprint ins Ziel.",
    detail: "Ein Fehler wirft dich nur auf die vorherige Stufe bei 0, 4 oder 8 zurück.",
  },
  {
    headline: "Nach zehn Sekunden ohne Antwort pausiert die Zeit.",
    detail: "Pausen kosten dich nichts — gemessen wird nur, was du wirklich brauchst.",
  },
  {
    headline: "Kategorien wechseln den Wortschatz, nicht deinen Lernstand.",
    detail: "Jedes Wort behält seinen Fortschritt — nur der laufende Sprint beginnt neu.",
  },
];

export function hintAt(index: number): TrainerHint {
  const count = trainerHints.length;
  const safe = Number.isFinite(index) ? Math.floor(index) : 0;
  return trainerHints[((safe % count) + count) % count];
}
