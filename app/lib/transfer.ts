// Anders als die Nachbarmodule zieht diese Datei Werte statt nur Typen herüber.
// Node braucht dafür die Endung, wenn die Tests sie direkt ausführen.
import { dayKey, previousDay, type MistakeStat } from "./engine.ts";
import { emptyData, sanitizeData, type SprintData } from "./storage.ts";

// Ein Code sieht so aus: "ddd1:<base64url>" mit gzip, "ddd0:<base64url>" ohne.
// Der Präfix trennt die beiden Fälle, damit ein Gerät ohne CompressionStream
// trotzdem lesen kann, was ein anderes geschrieben hat.
const GZIP_PREFIX = "ddd1:";
const PLAIN_PREFIX = "ddd0:";

/**
 * Die Tagesserie zählt über die gesamte Historie, deshalb muss sie mitwandern —
 * ein Deckel von zwei Wochen hätte aus einer 60-Tage-Serie beim Umzug eine
 * 14-Tage-Serie gemacht. Zwei Jahre reichen und begrenzen die Codelänge.
 */
export const transferDays = 730;

interface TransferPayload {
  v: 1;
  totals: SprintData["totals"];
  best: SprintData["best"];
  sprints: SprintData["sprints"];
  days: SprintData["days"];
  mistakes: Record<string, MistakeStat>;
  recentMistakes: string[];
}

function recentDays(days: SprintData["days"], today = dayKey()): SprintData["days"] {
  const wanted = new Set<string>();
  let key = today;
  for (let index = 0; index < transferDays; index += 1) {
    wanted.add(key);
    key = previousDay(key);
  }
  return Object.fromEntries(Object.entries(days).filter(([day]) => wanted.has(day)));
}

/** Wörter ohne jede Historie tragen nichts bei und blähen den Code nur auf. */
function usedMistakes(mistakes: Record<string, MistakeStat>): Record<string, MistakeStat> {
  return Object.fromEntries(Object.entries(mistakes).filter(([, stat]) => stat.seen > 0 || stat.wrong > 0));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// Ein Fortschrittscode aus fremder Hand wird beim Öffnen eines Links sofort
// gelesen. gzip packt gleichförmige Daten tausendfach, deshalb bekommt sowohl
// die Eingabe als auch das entpackte Ergebnis eine harte Grenze.
const maxCodeLength = 64_000;
const maxDecodedBytes = 1_000_000;

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entpackt und bricht ab, sobald die Grenze überschritten ist — ohne alles zu behalten. */
async function inflateBounded(bytes: Uint8Array): Promise<Uint8Array | null> {
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxDecodedBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function encodeProgress(data: SprintData): Promise<string> {
  const payload: TransferPayload = {
    v: 1,
    totals: data.totals,
    best: data.best,
    sprints: data.sprints,
    days: recentDays(data.days),
    mistakes: usedMistakes(data.mistakes),
    recentMistakes: data.recentMistakes,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") return PLAIN_PREFIX + toBase64Url(bytes);
  return GZIP_PREFIX + toBase64Url(await pipe(bytes, new CompressionStream("gzip")));
}

/** Baut den Link, der den Fortschritt in einem anderen Browser öffnet. */
export function progressLink(code: string, origin: string): string {
  // Das Fragment erreicht weder Server noch Statistik — anders als eine Query.
  return `${origin}/#progress=${encodeURIComponent(code)}`;
}

/**
 * Nimmt entgegen, was Leute wirklich einfügen: den nackten Code, den ganzen Link
 * mit dem Code darin, und beides gern mit Zeilenumbrüchen, die ein Messenger
 * oder eine Mail hineingesetzt hat.
 */
export function normalizeTransferCode(input: string): string {
  const fromLink = /[#?&]progress=([^&\s]+)/.exec(input);
  const value = fromLink ? fromLink[1] : input;
  // Aus einem Link kommt der Code prozentkodiert zurück; ein roher Code besteht
  // nur aus base64url-Zeichen und dem Präfix, enthält also nie ein Prozentzeichen.
  if (!value.includes("%")) return value.replace(/\s+/g, "");
  try {
    return decodeURIComponent(value).replace(/\s+/g, "");
  } catch {
    // Abgeschnittene Escape-Sequenz: der Code ist ohnehin unvollständig.
    return "";
  }
}

/**
 * Gibt die eingelesenen Daten zurück oder null, wenn der Code nicht zu dieser App
 * gehört, abgeschnitten wurde oder das Gerät kein gzip lesen kann.
 */
export async function decodeProgress(code: string, current: SprintData = emptyData): Promise<SprintData | null> {
  if (code.length > maxCodeLength) return null;
  const trimmed = normalizeTransferCode(code);
  const gzipped = trimmed.startsWith(GZIP_PREFIX);
  if (!gzipped && !trimmed.startsWith(PLAIN_PREFIX)) return null;

  try {
    const raw = fromBase64Url(trimmed.slice(GZIP_PREFIX.length));
    if (gzipped && typeof DecompressionStream === "undefined") return null;
    const bytes = gzipped ? await inflateBounded(raw) : raw;
    if (!bytes) return null;
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TransferPayload>;
    if (payload.v !== 1) return null;
    // Theme und Einstellungen gehören zum Gerät, nicht zum Lernstand.
    return sanitizeData({ ...payload, version: 1, theme: current.theme, settings: current.settings });
  } catch {
    return null;
  }
}
