import type { MatchFingerprint } from "../../txline/src/replay.js";

export type PaperEntry = {
  id: string;
  label: string;
  fingerprint: MatchFingerprint;
};

export type PaperStanding = PaperEntry & {
  distance: number;
  rank: number;
  winner: boolean;
  hypotheticalPayout: string;
};

function validateFingerprint(value: MatchFingerprint, label: string): void {
  const valid = value.every((item, index) =>
    Number.isSafeInteger(item) && item >= 0 && item <= (index < 2 ? 20 : 40)
  );
  if (!valid) throw new Error(`${label} contains an invalid match fingerprint`);
}

export function fingerprintDistance(
  prediction: MatchFingerprint,
  actual: MatchFingerprint,
): number {
  validateFingerprint(prediction, "Prediction");
  validateFingerprint(actual, "Actual result");
  return prediction.reduce(
    (total, value, index) => total + Math.abs(value - actual[index]!) * (index < 2 ? 3 : 1),
    0,
  );
}

export function paperStandings(options: {
  entries: PaperEntry[];
  actual: MatchFingerprint;
  paperStake?: bigint;
}): PaperStanding[] {
  if (options.entries.length < 2 || options.entries.length > 16) {
    throw new Error("Paper pool must contain 2 to 16 entries");
  }
  const seen = new Set<string>();
  const scored = options.entries.map((entry) => {
    if (!entry.id || seen.has(entry.id)) throw new Error("Paper entry ids must be unique");
    seen.add(entry.id);
    return { ...entry, distance: fingerprintDistance(entry.fingerprint, options.actual) };
  });
  const uniqueDistances = [...new Set(scored.map(({ distance }) => distance))].sort((a, b) => a - b);
  const winningDistance = uniqueDistances[0]!;
  const winnerCount = scored.filter(({ distance }) => distance === winningDistance).length;
  const stake = options.paperStake ?? 1_000_000n;
  if (stake <= 0n) throw new Error("Paper stake must be positive");
  const payout = (stake * BigInt(scored.length)) / BigInt(winnerCount);
  return scored
    .map((entry) => ({
      ...entry,
      rank: uniqueDistances.indexOf(entry.distance) + 1,
      winner: entry.distance === winningDistance,
      hypotheticalPayout: entry.distance === winningDistance ? payout.toString() : "0",
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}
