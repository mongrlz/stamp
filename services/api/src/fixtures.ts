type FixtureRecord = Record<string, unknown>;

function records(input: unknown): FixtureRecord[] {
  if (Array.isArray(input)) return input.filter((item): item is FixtureRecord => Boolean(item) && typeof item === "object");
  if (input && typeof input === "object") {
    const object = input as Record<string, unknown>;
    const items = object.items ?? object.fixtures ?? object.Items ?? object.Fixtures;
    if (Array.isArray(items)) return records(items);
  }
  return [];
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export type PublicFixture = {
  fixtureId: number;
  competition: string | null;
  competitionId: number | null;
  startTime: number | null;
  participant1: string | null;
  participant1Id: number | null;
  participant2: string | null;
  participant2Id: number | null;
  participant1IsHome: boolean | null;
  gameState: number | null;
};

export function publicFixtures(input: unknown): PublicFixture[] {
  return records(input).flatMap((item) => {
    const fixtureId = number(item.FixtureId ?? item.fixtureId);
    if (fixtureId === null || !Number.isSafeInteger(fixtureId) || fixtureId <= 0) return [];
    return [{
      fixtureId,
      competition: string(item.Competition ?? item.competition),
      competitionId: number(item.CompetitionId ?? item.competitionId),
      startTime: number(item.StartTime ?? item.startTime),
      participant1: string(item.Participant1 ?? item.participant1),
      participant1Id: number(item.Participant1Id ?? item.participant1Id),
      participant2: string(item.Participant2 ?? item.participant2),
      participant2Id: number(item.Participant2Id ?? item.participant2Id),
      participant1IsHome: typeof (item.Participant1IsHome ?? item.participant1IsHome) === "boolean"
        ? Boolean(item.Participant1IsHome ?? item.participant1IsHome)
        : null,
      gameState: number(item.GameState ?? item.gameState),
    }];
  }).sort((a, b) => (a.startTime ?? Number.MAX_SAFE_INTEGER) - (b.startTime ?? Number.MAX_SAFE_INTEGER));
}
