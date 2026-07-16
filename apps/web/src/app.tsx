import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fingerprintDistance,
  paperStandings,
  type PaperEntry,
} from "../../../packages/stamp-sdk/src/scoring.js";
import type { MatchFingerprint, ReplayFrame } from "../../../packages/txline/src/replay.js";
import { fetchReplay } from "./api.js";
import type { ReplayResponse } from "./types.js";

type AppMode = "entry" | "replay" | "result";

const DEFAULT_STAMP: MatchFingerprint = [3, 2, 5, 2];
const PROOF_SIGNATURE = "42K7LbKD5zXPLDtXSkeM8E9haaV5z6fMGm8VFSKbKirLNf8jNC5vegPs6M5mzhVSf382RceoC76bvncoQ6v7DRsx";

const PAPER_FIELD: PaperEntry[] = [
  { id: "exact", label: "North Stand", fingerprint: [3, 2, 4, 2] },
  { id: "press", label: "Press Box", fingerprint: [2, 2, 4, 3] },
  { id: "away", label: "Away End", fingerprint: [3, 1, 5, 2] },
  { id: "upper", label: "Upper Tier", fingerprint: [2, 1, 6, 3] },
  { id: "touch", label: "Touchline", fingerprint: [4, 2, 7, 2] },
  { id: "tunnel", label: "Tunnel", fingerprint: [1, 1, 4, 4] },
  { id: "radio", label: "Radio Booth", fingerprint: [4, 0, 3, 1] },
];

function formatClock(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function formatAction(action: string): string {
  return action.replaceAll("_", " ").toUpperCase();
}

function formatPaperAmount(baseUnits: string): string {
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function Header({ mode }: { mode: AppMode }) {
  return (
    <header className="mx-auto flex w-full max-w-[1500px] items-center justify-between border-b border-ink px-5 py-5 md:px-8">
      <div className="flex min-w-0 items-baseline gap-5">
        <div className="font-display text-[2.8rem] font-black leading-none tracking-[-0.06em] md:text-[3.4rem]">STAMP</div>
        <div className="hidden font-mono text-xs tracking-[0.12em] lg:block">PICK THE MATCH. KEEP THE RECEIPT.</div>
      </div>
      <nav aria-label="Primary" className="flex items-center gap-5 font-condensed text-sm font-bold tracking-[0.08em] md:gap-9 md:text-base">
        <button className="nav-link" type="button">PLAY</button>
        <button className={`nav-link ${mode !== "entry" ? "is-active" : ""}`} type="button">REPLAY</button>
        <button className="nav-link hidden sm:block" type="button">RECEIPTS</button>
      </nav>
    </header>
  );
}

function StatusDot({ green = false }: { green?: boolean }) {
  return <span aria-hidden="true" className={`status-dot ${green ? "is-green" : ""}`} />;
}

function NumberControl({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="number-control">
      <span>{label}</span>
      <div className="number-control__body">
        <button
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          type="button"
        >−</button>
        <input
          aria-describedby={`${label.replaceAll(" ", "-")}-help`}
          disabled={disabled}
          inputMode="numeric"
          max={max}
          min={0}
          onChange={(event) => onChange(Math.min(max, Math.max(0, Number(event.target.value) || 0)))}
          type="number"
          value={value}
        />
        <button
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          type="button"
        >+</button>
      </div>
      <span className="sr-only" id={`${label.replaceAll(" ", "-")}-help`}>Choose a value from zero to {max}.</span>
    </label>
  );
}

function Receipt({
  replay,
  prediction,
  mode,
  frame,
  distance,
  payout,
}: {
  replay: ReplayResponse;
  prediction: MatchFingerprint;
  mode: AppMode;
  frame: ReplayFrame;
  distance?: number;
  payout?: string;
}) {
  const team1 = replay.fixture?.participant1 ?? `TEAM ${replay.participant1Id ?? 1}`;
  const team2 = replay.fixture?.participant2 ?? `TEAM ${replay.participant2Id ?? 2}`;
  return (
    <article className="receipt" aria-label="Paper replay receipt">
      <div className="receipt__status"><StatusDot green={mode === "result"} /> {mode === "result" ? "REPLAY COMPLETE" : "REPLAY · PAPER"}</div>
      <h2>RECEIPT #18179550-P</h2>
      <div className="receipt__rule" />
      <div className="receipt__match">{team1}<br />— {team2}</div>
      <div className="receipt__rule" />
      <div className="receipt__label">YOUR STAMP</div>
      <div className="receipt__fingerprint">{prediction.join(" · ")}</div>
      <div className="receipt__legend">P1G · P2G · P1C · P2C</div>
      <div className="receipt__rule" />
      <div className="receipt__label">SEQUENCE</div>
      <div className="receipt__value">{frame.sequence.toString().padStart(4, "0")} / {replay.finalSequence}</div>
      <div className="receipt__label">MATCH CLOCK</div>
      <div className="receipt__value">{formatClock(frame.clockSeconds)}</div>
      {mode === "result" ? (
        <>
          <div className="receipt__stamp">PAPER RESULT</div>
          <div className="receipt__label">DISTANCE</div>
          <div className="receipt__result">{distance}</div>
          <div className="receipt__label">HYPOTHETICAL PAYOUT</div>
          <div className="receipt__payout">+{payout} PAPER USDT</div>
        </>
      ) : (
        <div className="receipt__stamp is-blue">PAPER ENTRY</div>
      )}
      <div className="barcode" aria-hidden="true" />
      <div className="receipt__footer">TxLINE · NO WALLET · NO STAKE</div>
    </article>
  );
}

function EventRail({ replay, index }: { replay: ReplayResponse; index: number }) {
  const frames = replay.frames.slice(Math.max(0, index - 5), index + 1).reverse();
  return (
    <section className="event-rail" aria-label="Replay event history">
      <div className="section-kicker"><StatusDot /> LAST {frames.length} EVENTS</div>
      <div className="divide-y divide-ink/30 border-y border-ink">
        {frames.map((frame) => (
          <div className="event-row" key={frame.sequence}>
            <time>{formatClock(frame.clockSeconds)}</time>
            <div>
              <strong>{formatAction(frame.action)}</strong>
              <span>SEQ {frame.sequence}</span>
            </div>
            <div className="event-vector">{frame.fingerprint.join("–")}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplayControls({
  replay,
  index,
  playing,
  onIndex,
  onPlaying,
}: {
  replay: ReplayResponse;
  index: number;
  playing: boolean;
  onIndex(value: number): void;
  onPlaying(value: boolean): void;
}) {
  const frame = replay.frames[index]!;
  return (
    <section className="replay-controls" aria-label="Replay controls">
      <div className="flex items-center justify-between gap-3 font-mono text-sm">
        <div className="section-kicker mb-0"><StatusDot /> SEQUENCE</div>
        <div>{frame.sequence.toString().padStart(4, "0")} / {replay.finalSequence}</div>
      </div>
      <input
        aria-label="Replay position"
        className="replay-range"
        max={replay.frames.length - 1}
        min={0}
        onChange={(event) => onIndex(Number(event.target.value))}
        type="range"
        value={index}
      />
      <div className="flex items-center justify-between font-mono text-sm">
        <span>{formatClock(frame.clockSeconds)}</span>
        <span>{formatAction(frame.action)}</span>
      </div>
      <div className="grid grid-cols-3 border-y border-ink">
        <button className="transport" onClick={() => onIndex(Math.max(0, index - 1))} type="button" aria-label="Previous replay event">PREV</button>
        <button className="transport is-primary" onClick={() => onPlaying(!playing)} type="button">{playing ? "PAUSE" : "PLAY"}</button>
        <button className="transport" onClick={() => onIndex(Math.min(replay.frames.length - 1, index + 1))} type="button" aria-label="Next replay event">NEXT</button>
      </div>
    </section>
  );
}

function EntryWorkspace({
  replay,
  prediction,
  setPrediction,
  frameIndex,
  playing,
  onFrameIndex,
  onPlaying,
  onStamp,
}: {
  replay: ReplayResponse;
  prediction: MatchFingerprint;
  setPrediction(value: MatchFingerprint): void;
  frameIndex: number;
  playing: boolean;
  onFrameIndex(value: number): void;
  onPlaying(value: boolean): void;
  onStamp(): void;
}) {
  const frame = replay.frames[frameIndex]!;
  const team1 = replay.fixture?.participant1 ?? "PARTICIPANT 1";
  const team2 = replay.fixture?.participant2 ?? "PARTICIPANT 2";
  const inReplay = frameIndex > 0 || playing;
  const liveDistance = fingerprintDistance(prediction, frame.fingerprint);
  const update = (index: number, value: number) => {
    const next = [...prediction] as MatchFingerprint;
    next[index] = value;
    setPrediction(next);
  };
  return (
    <main className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="min-w-0 border-ink px-5 py-8 md:px-8 lg:border-r lg:py-10">
        <div className="section-kicker"><StatusDot /> REPLAY · PAPER</div>
        <h1 className="match-title"><span>{team1}</span><i>—</i><span>{team2}</span></h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-dashed border-ink pb-6 font-mono text-xs tracking-[0.08em] md:text-sm">
          <span>{replay.fixture?.competition ?? "WORLD CUP"}</span>
          <span>FIXTURE {replay.fixtureId}</span>
          <span>NO WALLET · NO STAKE</span>
        </div>

        {!inReplay ? (
          <div className="pt-8">
            <h2 className="font-mono text-base tracking-[0.08em] md:text-lg">PICK THE FINAL MATCH FINGERPRINT</h2>
            <div className="fingerprint-grid mt-7">
              <NumberControl label={`${team1} GOALS`} max={20} onChange={(value) => update(0, value)} value={prediction[0]} />
              <NumberControl label={`${team2} GOALS`} max={20} onChange={(value) => update(1, value)} value={prediction[1]} />
              <NumberControl label={`${team1} CORNERS`} max={40} onChange={(value) => update(2, value)} value={prediction[2]} />
              <NumberControl label={`${team2} CORNERS`} max={40} onChange={(value) => update(3, value)} value={prediction[3]} />
            </div>
            <div className="scoring-line">GOALS ×3 <span>·</span> CORNERS ×1 <span>·</span> LOWEST DISTANCE WINS</div>
            <button className="primary-action mt-7" onClick={onStamp} type="button">STAMP MY PAPER RECEIPT</button>
          </div>
        ) : (
          <div className="pt-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="font-mono text-sm tracking-[0.08em] text-blue">LIVE REPLAY FINGERPRINT</div>
                <div className="live-vector">{frame.fingerprint.join(" · ")}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm tracking-[0.08em]">CURRENT DISTANCE</div>
                <div className="distance-number">{liveDistance}</div>
              </div>
            </div>
            <div className="comparison-grid mt-7">
              <div><span>YOUR STAMP</span><strong>{prediction.join(" · ")}</strong></div>
              <div><span>MATCH NOW</span><strong>{frame.fingerprint.join(" · ")}</strong></div>
              <div><span>SCORING</span><strong>G ×3 · C ×1</strong></div>
            </div>
            <EventRail index={frameIndex} replay={replay} />
          </div>
        )}
      </section>
      <aside className="space-y-8 px-5 py-8 md:px-8 lg:py-10">
        <ReplayControls
          index={frameIndex}
          onIndex={onFrameIndex}
          onPlaying={onPlaying}
          playing={playing}
          replay={replay}
        />
        <Receipt frame={frame} mode="replay" prediction={prediction} replay={replay} />
      </aside>
    </main>
  );
}

function ResultScreen({
  replay,
  prediction,
  onRestart,
}: {
  replay: ReplayResponse;
  prediction: MatchFingerprint;
  onRestart(): void;
}) {
  const actual = replay.finalFingerprint!;
  const standings = paperStandings({
    actual,
    entries: [{ id: "me", label: "You", fingerprint: prediction }, ...PAPER_FIELD],
    paperStake: 1_000_000n,
  });
  const mine = standings.find(({ id }) => id === "me")!;
  const frame = replay.frames.at(-1)!;
  const weights = [3, 3, 1, 1];
  const team1 = replay.fixture?.participant1 ?? "PARTICIPANT 1";
  const team2 = replay.fixture?.participant2 ?? "PARTICIPANT 2";
  const labels = [`${team1} GOALS`, `${team2} GOALS`, `${team1} CORNERS`, `${team2} CORNERS`];
  const payout = formatPaperAmount(mine.hypotheticalPayout);

  return (
    <main className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-0 px-5 py-8 md:px-8 lg:grid-cols-[350px_minmax(0,1fr)_330px] lg:py-10">
      <div className="lg:pr-8"><Receipt distance={mine.distance} frame={frame} mode="result" payout={payout} prediction={prediction} replay={replay} /></div>
      <section className="border-ink py-8 lg:border-x lg:px-8 lg:py-0">
        <div className="text-center font-mono text-lg tracking-[0.08em]">{team1} {actual[0]} — {actual[1]} {team2}</div>
        <h1 className="result-title">{mine.distance === 0 ? "EXACT STAMP" : <>YOUR STAMP<br />MISSED BY <em>{mine.distance}</em></>}</h1>
        <div className="result-table mt-7">
          <div className="result-table__row is-label"><span />{labels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="result-table__row"><span>MATCH FINAL</span>{actual.map((value, index) => <strong key={index}>{value}</strong>)}</div>
          <div className="result-table__row"><span>YOUR STAMP</span>{prediction.map((value, index) => <strong key={index}>{value}</strong>)}</div>
          <div className="result-table__row"><span>DIMENSION MISS</span>{prediction.map((value, index) => <strong key={index}>{Math.abs(value - actual[index]!)}</strong>)}</div>
        </div>
        <div className="distance-formula mt-5">
          {prediction.map((value, index) => `${weights[index]}×${Math.abs(value - actual[index]!)}`).join("  +  ")}  =  DISTANCE <strong>{mine.distance}</strong>
        </div>
        <div className="result-summary mt-5">
          <div><span>YOUR RANK</span><strong>{mine.rank}{mine.rank === 1 ? "ST" : mine.rank === 2 ? "ND" : mine.rank === 3 ? "RD" : "TH"} OF 8</strong></div>
          <div><span>HYPOTHETICAL PAYOUT</span><strong>+{payout} PAPER USDT</strong></div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button className="secondary-action" onClick={onRestart} type="button">RESTART</button>
          <a className="primary-action is-link" href={`https://explorer.solana.com/tx/${PROOF_SIGNATURE}?cluster=devnet`} rel="noreferrer" target="_blank">VIEW VERIFIED PROOF</a>
        </div>
      </section>
      <aside className="pt-8 lg:pl-8 lg:pt-0">
        <div className="section-kicker"><StatusDot /> REPLAY RECEIPT</div>
        <ol className="proof-steps">
          <li><span>1</span><div><strong>MATCH FINAL</strong><small>{actual.join(" · ")}</small></div></li>
          <li><span>2</span><div><strong>TxLINE PROOF</strong><small>SEQUENCE {replay.finalSequence}</small></div></li>
          <li><span>3</span><div><strong>SOLANA VERIFIED</strong><small>NO ADMIN RESULT</small></div></li>
        </ol>
        <div className="mt-7 border-y border-ink py-5 font-mono text-sm leading-relaxed">
          PAPER MODE NEVER MOVED FUNDS.<br />THE FINAL FINGERPRINT IS REAL.<br />THE PAYOUT IS HYPOTHETICAL.
        </div>
        <div className="mt-7">
          <div className="font-mono text-xs tracking-[0.08em] text-blue">PAPER LEADERBOARD</div>
          <div className="mt-3 divide-y divide-ink/25 border-y border-ink">
            {standings.slice(0, 4).map((standing) => (
              <div className={`leader-row ${standing.id === "me" ? "is-me" : ""}`} key={standing.id}>
                <span>{standing.rank}</span><strong>{standing.label}</strong><span>D {standing.distance}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

function LoadingScreen() {
  return (
    <div className="mx-auto grid w-full max-w-[1500px] flex-1 animate-pulse grid-cols-1 gap-10 px-5 py-10 lg:grid-cols-[1fr_390px]">
      <div className="space-y-8">
        <div className="h-5 w-40 bg-ink/10" />
        <div className="h-28 w-4/5 bg-ink/10" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((item) => <div className="h-48 border border-ink/20 bg-ink/5" key={item} />)}</div>
      </div>
      <div className="h-[600px] bg-ink/5" />
    </div>
  );
}

function ErrorScreen({ message, retry }: { message: string; retry(): void }) {
  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 items-center px-5 py-16 md:px-8">
      <div className="max-w-2xl border-y border-ink py-10">
        <div className="section-kicker"><StatusDot /> REPLAY UNAVAILABLE</div>
        <h1 className="font-display text-5xl font-black tracking-[-0.04em] md:text-7xl">THE ARCHIVE<br />DIDN&apos;T LOAD.</h1>
        <p className="mt-6 max-w-xl font-mono text-sm leading-relaxed">{message}. Start the STAMP API and try again; paper mode never substitutes fabricated match data.</p>
        <button className="primary-action mt-7 max-w-sm" onClick={retry} type="button">RETRY REPLAY</button>
      </div>
    </main>
  );
}

export function App() {
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [mode, setMode] = useState<AppMode>("entry");
  const [prediction, setPrediction] = useState<MatchFingerprint>(DEFAULT_STAMP);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchReplay(controller.signal)
      .then((value) => setReplay(value))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unknown replay error");
      });
    return () => controller.abort();
  }, [loadKey]);

  useEffect(() => {
    if (!playing || !replay || mode !== "replay") return;
    const timeout = window.setTimeout(() => {
      setFrameIndex((current) => {
        if (current >= replay.frames.length - 1) {
          setPlaying(false);
          setMode("result");
          return current;
        }
        return current + 1;
      });
    }, 540);
    return () => window.clearTimeout(timeout);
  }, [frameIndex, mode, playing, replay]);

  const restart = useCallback(() => {
    setMode("entry");
    setFrameIndex(0);
    setPlaying(false);
  }, []);

  const body = useMemo(() => {
    if (error) return <ErrorScreen message={error} retry={() => setLoadKey((value) => value + 1)} />;
    if (!replay) return <LoadingScreen />;
    if (mode === "result") return <ResultScreen onRestart={restart} prediction={prediction} replay={replay} />;
    return (
      <EntryWorkspace
        frameIndex={frameIndex}
        onFrameIndex={(value) => {
          setFrameIndex(value);
          setPlaying(false);
          if (value === replay.frames.length - 1) setMode("result");
          else if (mode === "entry" && value > 0) setMode("replay");
        }}
        onPlaying={(value) => {
          setMode("replay");
          setPlaying(value);
        }}
        onStamp={() => {
          setMode("replay");
          setFrameIndex(0);
          setPlaying(true);
        }}
        playing={playing}
        prediction={prediction}
        replay={replay}
        setPrediction={setPrediction}
      />
    );
  }, [error, frameIndex, mode, playing, prediction, replay, restart]);

  return (
    <div className="paper-app min-h-[100dvh] text-ink">
      <Header mode={mode} />
      {body}
      <footer className="mx-auto flex w-full max-w-[1500px] flex-wrap justify-between gap-3 border-t border-ink px-5 py-4 font-mono text-[0.65rem] tracking-[0.08em] md:px-8">
        <span>STAMP · TxLINE · SOLANA DEVNET</span>
        <span>PAPER REPLAY IS SIMULATION · MATCH DATA IS AUTHENTIC</span>
      </footer>
    </div>
  );
}
