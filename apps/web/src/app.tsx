import type { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fingerprintDistance,
  paperStandings,
  type PaperEntry,
} from "../../../packages/stamp-sdk/src/scoring.js";
import type { MatchFingerprint, ReplayFrame } from "../../../packages/txline/src/replay.js";
import { LIVE_POOL_ADDRESS, fetchLivePool, fetchReplay } from "./api.js";
import { walletPoolAction, type BrowserPosition, type WalletPoolAction } from "./stamp-state.js";
import type { PublicPool, ReplayResponse } from "./types.js";
import { useStampWallet, WalletControl } from "./wallet.js";

type AppMode = "entry" | "replay" | "result";
type AppView = "play" | "replay" | "receipts";
type TransactionState = {
  phase: "idle" | "signing" | "confirmed" | "error";
  message: string;
  signature?: string;
};

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

function shortAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

function formatCountdown(target: string, now: number): string {
  const seconds = Math.max(0, Number(target) - Math.floor(now / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function formatArchiveDate(timestamp: number | null): string {
  if (timestamp === null) return "ARCHIVED MATCH";
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "ARCHIVED MATCH";
  return `${date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).toUpperCase()} · ARCHIVE`;
}

function useWalletPool(pool: PublicPool | null) {
  const { anchorWallet, connection, publicKey: owner } = useStampWallet();
  const [program, setProgram] = useState<Program | null>(null);
  const [position, setPosition] = useState<BrowserPosition | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProgram(null);
    setPosition(null);
    setPositionError(null);
    if (!anchorWallet || !owner || !pool) return () => { active = false; };
    import("./stamp-client.js")
      .then(async ({ createBrowserProgram, fetchWalletPosition }) => {
        const nextProgram = createBrowserProgram(connection, anchorWallet);
        const nextPosition = await fetchWalletPosition(nextProgram, new PublicKey(pool.address), owner);
        if (active) {
          setProgram(nextProgram);
          setPosition(nextPosition);
        }
      })
      .catch((reason: unknown) => {
        if (active) setPositionError(reason instanceof Error ? reason.message : "Position lookup failed");
      });
    return () => { active = false; };
  }, [anchorWallet, connection, owner, pool]);

  return {
    action: pool ? walletPoolAction(pool, owner, position) : "connect" as WalletPoolAction,
    owner,
    position,
    positionError,
    program,
  };
}

function Header({ view, onView }: { view: AppView; onView(value: AppView): void }) {
  return (
    <header className="stamp-header mx-auto flex w-full max-w-[1500px] items-center justify-between border-b border-ink px-5 py-5 md:px-8">
      <div className="stamp-brand flex min-w-0 items-baseline gap-5">
        <div className="stamp-wordmark font-display text-[2.8rem] font-black leading-none tracking-[-0.06em] md:text-[3.4rem]">STAMP</div>
        <div className="hidden font-mono text-xs tracking-[0.12em] lg:block">PICK THE MATCH. KEEP THE RECEIPT.</div>
      </div>
      <div className="stamp-header-actions flex items-center gap-3 sm:gap-5 md:gap-8">
        <nav aria-label="Primary" className="stamp-nav flex items-center gap-3 font-condensed text-xs font-bold tracking-[0.05em] sm:gap-5 sm:text-sm md:gap-9 md:text-base md:tracking-[0.08em]">
          <button className={`nav-link ${view === "play" ? "is-active" : ""}`} onClick={() => onView("play")} type="button">PLAY</button>
          <button className={`nav-link ${view === "replay" ? "is-active" : ""}`} onClick={() => onView("replay")} type="button">REPLAY</button>
          <button className={`nav-link ${view === "receipts" ? "is-active" : ""}`} onClick={() => onView("receipts")} type="button">RECEIPTS</button>
        </nav>
        <WalletControl />
      </div>
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
        <div className="number-control__actions">
          <button
            aria-label={`Decrease ${label}`}
            disabled={disabled || value <= 0}
            onClick={() => onChange(Math.max(0, value - 1))}
            type="button"
          >−</button>
          <button
            aria-label={`Increase ${label}`}
            disabled={disabled || value >= max}
            onClick={() => onChange(Math.min(max, value + 1))}
            type="button"
          >+</button>
        </div>
      </div>
      <span className="sr-only" id={`${label.replaceAll(" ", "-")}-help`}>Choose a value from zero to {max}.</span>
    </label>
  );
}

function PoolReceipt({ pool, owner }: { pool: PublicPool; owner: PublicKey | null }) {
  const entry = pool.entries.find(({ owner: entryOwner }) => entryOwner === owner?.toBase58())
    ?? pool.entries[0];
  return (
    <article className="receipt pool-receipt" aria-label="Locked devnet pool receipt">
      <div className="receipt__status"><StatusDot /> DEVNET · {pool.status.toUpperCase()}</div>
      <h2>STAMP RECEIPT</h2>
      <div className="receipt__rule" />
      <div className="receipt__match">FRANCE<br />— ENGLAND</div>
      <div className="receipt__rule" />
      <div className="receipt__label">POOL</div>
      <div className="receipt__value">{shortAddress(pool.address)}</div>
      <div className="receipt__label">ENTRY FEE</div>
      <div className="receipt__value">{formatPaperAmount(pool.entryFee)} TEST USDT</div>
      <div className="receipt__rule" />
      <div className="receipt__label">LOCKED STAMP</div>
      <div className="receipt__fingerprint">{entry?.forecast.join(" · ") ?? "— · — · — · —"}</div>
      <div className="receipt__legend">FRG · ENG · FRC · ENC</div>
      <div className="barcode" aria-hidden="true" />
      <div className="receipt__footer">TEST MODE · NO MAINNET FUNDS</div>
    </article>
  );
}

function PlayScreen({
  action,
  owner,
  pool,
  onReceipts,
  onWalletAction,
  transaction,
}: {
  action: WalletPoolAction;
  owner: PublicKey | null;
  pool: PublicPool;
  onReceipts(): void;
  onWalletAction(prediction: MatchFingerprint): void;
  transaction: TransactionState;
}) {
  const locked = pool.status !== "open";
  const entry = pool.entries.find(({ owner: entryOwner }) => entryOwner === owner?.toBase58())
    ?? pool.entries[0];
  const [prediction, setPrediction] = useState<MatchFingerprint>(entry?.forecast ?? DEFAULT_STAMP);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (entry) setPrediction(entry.forecast);
  }, [entry]);
  const update = (index: number, value: number) => {
    const next = [...prediction] as MatchFingerprint;
    next[index] = value;
    setPrediction(next);
  };
  const sendsTransaction = action === "enter" || action === "claim" || action === "refund";
  const primaryLabel = transaction.phase === "signing"
    ? "CHECK YOUR WALLET"
    : action === "enter"
      ? "STAMP MY RECEIPT"
      : action === "claim"
        ? "CLAIM TEST USDT"
        : action === "refund"
          ? "REFUND MY ENTRY"
          : action === "paid"
            ? "RECEIPT PAID"
            : action === "waiting"
              ? "VIEW YOUR RECEIPT"
              : locked
                ? "VIEW POOL RECEIPT"
                : "CONNECT WALLET ABOVE";
  const primaryDisabled = transaction.phase === "signing" || action === "paid" || (!locked && action === "connect");
  return (
    <main className="play-shell mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_430px]">
      <section className="min-w-0 border-ink px-5 py-8 md:px-8 lg:border-r lg:py-10">
        <div className="section-kicker"><StatusDot /> PLAY · DEVNET</div>
        <h1 className="match-title"><span>FRANCE</span><i>—</i><span>ENGLAND</span></h1>
        <div className="match-selector mt-7">
          <div className="match-selector__head"><strong>SELECT A MATCH</strong><span>TONIGHT</span><span>TOMORROW</span></div>
          <div className="match-option"><span>☆</span><strong>SPAIN — PORTUGAL</strong><time>20:00</time></div>
          <div className="match-option is-selected"><span>✓</span><strong>FRANCE — ENGLAND</strong><time>21:00</time></div>
          <div className="match-option"><span>☆</span><strong>GERMANY — ITALY</strong><time>22:00</time></div>
          <div className="match-option"><span>☆</span><strong>NETHERLANDS — BELGIUM</strong><time>22:45</time></div>
        </div>
        <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-sm tracking-[0.08em] text-blue">{locked ? "YOUR LOCKED STAMP" : "PICK THE FINAL FINGERPRINT"}</div>
            <div className="mt-2 font-mono text-xs">GOALS ×3 · CORNERS ×1 · LOWEST DISTANCE WINS</div>
          </div>
          <div className="font-mono text-xs text-green">TXLINE FIXTURE {pool.fixtureId}</div>
        </div>
        <div className="fingerprint-grid mt-7">
          <NumberControl disabled={locked} label="FRANCE GOALS" max={20} onChange={(value) => update(0, value)} value={prediction[0]} />
          <NumberControl disabled={locked} label="ENGLAND GOALS" max={20} onChange={(value) => update(1, value)} value={prediction[1]} />
          <NumberControl disabled={locked} label="FRANCE CORNERS" max={40} onChange={(value) => update(2, value)} value={prediction[2]} />
          <NumberControl disabled={locked} label="ENGLAND CORNERS" max={40} onChange={(value) => update(3, value)} value={prediction[3]} />
        </div>
        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.38fr]">
          <button
            className="primary-action physical-button"
            disabled={primaryDisabled}
            onClick={() => sendsTransaction ? onWalletAction(prediction) : onReceipts()}
            type="button"
          >{primaryLabel}</button>
          <button className="danger-action physical-button" disabled={locked} onClick={() => setPrediction(DEFAULT_STAMP)} type="button">{locked ? "POOL LOCKED" : "RESET PICK"}</button>
        </div>
        {transaction.phase !== "idle" && (
          <div className={`transaction-notice is-${transaction.phase}`} role={transaction.phase === "error" ? "alert" : "status"}>
            <strong>{transaction.phase === "confirmed" ? "CONFIRMED ON DEVNET" : transaction.phase.toUpperCase()}</strong>
            <span>{transaction.message}</span>
            {transaction.signature && <a href={`https://explorer.solana.com/tx/${transaction.signature}?cluster=devnet`} rel="noreferrer" target="_blank">VIEW TRANSACTION</a>}
          </div>
        )}
      </section>
      <aside className="space-y-7 px-5 py-8 md:px-8 lg:py-10">
        <div className="pool-status">
          <div className="section-kicker"><StatusDot green /> POOL STATUS</div>
          <div className="pool-metrics">
            <div><strong>{pool.entryCount}</strong><span>OF {pool.maxEntries}<br />ENTERED</span></div>
            <div><strong>{formatPaperAmount((BigInt(pool.entryFee) * BigInt(pool.entryCount)).toString())}</strong><span>TEST USDT<br />IN VAULT</span></div>
          </div>
          <div className="pool-lock"><span>SETTLEMENT OPENS</span><strong>{formatCountdown(pool.settleAfter, now)}</strong><em>DEVNET · TEST FUNDS</em></div>
          <div className="participant-list">
            <div className="font-mono text-xs tracking-[0.08em]">POOL PARTICIPANTS</div>
            {pool.entries.map((item) => (
              <div className="participant-row" key={item.owner}>
                <span>{item.index + 1}</span><strong>{shortAddress(item.owner)}</strong><em>{item.forecast.join("–")}</em>
              </div>
            ))}
          </div>
        </div>
        <PoolReceipt owner={owner} pool={pool} />
      </aside>
    </main>
  );
}

type ReceiptFilter = "all" | "live" | "won" | "missed" | "paper";
type ReceiptId = "live-france" | "paper-belgium";

function ArchiveReceipt({ id, owner, pool, replay }: { id: ReceiptId; owner: PublicKey | null; pool: PublicPool; replay: ReplayResponse }) {
  const live = id === "live-france";
  const liveEntry = pool.entries.find(({ owner: entryOwner }) => entryOwner === owner?.toBase58())
    ?? pool.entries[0];
  const vector = live ? liveEntry?.forecast ?? [0, 0, 0, 0] : DEFAULT_STAMP;
  const actual = replay.finalFingerprint ?? [0, 0, 0, 0];
  return (
    <article className="receipt archive-detail" aria-label={live ? "Live France England receipt" : "Belgium Senegal paper receipt"}>
      <div className="receipt__status"><StatusDot green={!live} /> {live ? `DEVNET · ${pool.status.toUpperCase()}` : "PAPER RESULT · VERIFIED DATA"}</div>
      <h2>STAMP RECEIPT</h2>
      <div className="receipt__rule" />
      <div className="receipt__match">{live ? <>FRANCE<br />— ENGLAND</> : <>BELGIUM<br />— SENEGAL</>}</div>
      <div className="receipt__rule" />
      <div className="receipt__label">YOUR FINGERPRINT</div>
      <div className="receipt__fingerprint">{vector.join(" · ")}</div>
      <div className="receipt__legend">P1G · P2G · P1C · P2C</div>
      {!live && (
        <>
          <div className="receipt__rule" />
          <div className="receipt__label">MATCH FINAL</div>
          <div className="receipt__value">{actual.join(" · ")}</div>
          <div className="receipt__stamp">MISSED BY {fingerprintDistance(vector, actual)}</div>
          <div className="receipt__label">HYPOTHETICAL PAYOUT</div>
          <div className="receipt__payout">+0 PAPER USDT</div>
        </>
      )}
      {live && <div className="receipt__stamp is-blue">LOCKED ON DEVNET</div>}
      <div className="barcode" aria-hidden="true" />
      <div className="receipt__footer">{live ? shortAddress(pool.address) : `TxLINE SEQ ${replay.finalSequence}`}</div>
    </article>
  );
}

function ReceiptsScreen({
  action,
  owner,
  pool,
  replay,
  onReplay,
  onWalletAction,
  transaction,
}: {
  action: WalletPoolAction;
  owner: PublicKey | null;
  pool: PublicPool;
  replay: ReplayResponse;
  onReplay(): void;
  onWalletAction(prediction: MatchFingerprint): void;
  transaction: TransactionState;
}) {
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const [selected, setSelected] = useState<ReceiptId>("live-france");
  const liveEntry = pool.entries.find(({ owner: entryOwner }) => entryOwner === owner?.toBase58())
    ?? pool.entries[0];
  const items = [
    { id: "live-france" as const, match: "FRANCE — ENGLAND", fingerprint: liveEntry?.forecast ?? [0, 0, 0, 0], status: pool.status.toUpperCase(), kind: "live" as const, distance: null },
    { id: "paper-belgium" as const, match: "BELGIUM — SENEGAL", fingerprint: DEFAULT_STAMP, status: "PAPER", kind: "paper" as const, distance: fingerprintDistance(DEFAULT_STAMP, replay.finalFingerprint!) },
  ];
  const visible = items.filter((item) => filter === "all" || item.kind === filter || (filter === "missed" && item.distance !== null && item.distance > 0));
  const selectedLive = selected === "live-france";
  const proofHref = selectedLive
    ? `https://explorer.solana.com/address/${LIVE_POOL_ADDRESS}?cluster=devnet`
    : `https://explorer.solana.com/tx/${PROOF_SIGNATURE}?cluster=devnet`;
  return (
    <main className="receipts-shell mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_430px]">
      <section className="min-w-0 border-ink px-5 py-8 md:px-8 lg:border-r lg:py-10">
        <h1 className="archive-title">MY RECEIPTS</h1>
        <p className="archive-subtitle">EVERY PICK. EVERY PROOF.</p>
        <div className="receipt-filters" role="group" aria-label="Receipt filters">
          {(["all", "live", "won", "missed", "paper"] as const).map((value) => (
            <button
              className={filter === value ? "is-active" : ""}
              key={value}
              onClick={() => {
                setFilter(value);
                const firstVisible = items.find((item) => value === "all" || item.kind === value || (value === "missed" && item.distance !== null && item.distance > 0));
                if (firstVisible) setSelected(firstVisible.id);
              }}
              type="button"
            >{value.toUpperCase()}</button>
          ))}
        </div>
        <div className="receipt-list">
          {visible.map((item) => (
            <button className={`receipt-row ${selected === item.id ? "is-selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)} type="button">
              <div><strong>{item.match}</strong><small>{item.id === "live-france" ? "JUL 18, 2026 · 21:00 UTC" : formatArchiveDate(replay.startTime)}</small></div>
              <div><span>FINGERPRINT</span><strong>{item.fingerprint.join("–")}</strong></div>
              <div><span>STATUS</span><strong className={item.kind === "paper" ? "text-blue" : "text-green"}>{item.status}</strong></div>
              <div><span>DISTANCE</span><strong>{item.distance ?? "—"}</strong></div>
              <div className="mini-barcode"><span aria-hidden="true" /><small>#{item.id === "live-france" ? "1047" : "1046"}</small></div>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="archive-empty"><strong>NO RECEIPTS HERE YET.</strong><span>This filter will fill when a matching STAMP settles.</span></div>
          )}
        </div>
      </section>
      <aside className="space-y-4 px-5 py-8 md:px-8 lg:py-10">
        <ArchiveReceipt id={selected} owner={owner} pool={pool} replay={replay} />
        {selectedLive && (action === "claim" || action === "refund") && (
          <button
            className="primary-action physical-button"
            disabled={transaction.phase === "signing"}
            onClick={() => onWalletAction(liveEntry?.forecast ?? DEFAULT_STAMP)}
            type="button"
          >{transaction.phase === "signing" ? "CHECK YOUR WALLET" : action === "claim" ? "CLAIM TEST USDT" : "REFUND MY ENTRY"}</button>
        )}
        <a className="primary-action physical-button is-link" href={proofHref} rel="noreferrer" target="_blank">{selectedLive ? "VIEW DEVNET POOL" : "VIEW SOLANA PROOF"}</a>
        <button className="secondary-action physical-button" onClick={onReplay} type="button">OPEN PAPER REPLAY</button>
        {transaction.phase !== "idle" && selectedLive && (
          <div className={`transaction-notice is-${transaction.phase}`} role={transaction.phase === "error" ? "alert" : "status"}>
            <strong>{transaction.phase === "confirmed" ? "CONFIRMED ON DEVNET" : transaction.phase.toUpperCase()}</strong>
            <span>{transaction.message}</span>
          </div>
        )}
      </aside>
    </main>
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
      <div className="transport-grid grid grid-cols-3">
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
    <main className="replay-shell mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px]">
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
            <button className="primary-action physical-button mt-7" onClick={onStamp} type="button">STAMP MY PAPER RECEIPT</button>
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
          <button className="secondary-action physical-button" onClick={onRestart} type="button">RESTART</button>
          <a className="primary-action physical-button is-link" href={`https://explorer.solana.com/tx/${PROOF_SIGNATURE}?cluster=devnet`} rel="noreferrer" target="_blank">VIEW VERIFIED PROOF</a>
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
        <div className="section-kicker"><StatusDot /> STAMP DATA UNAVAILABLE</div>
        <h1 className="font-display text-5xl font-black tracking-[-0.04em] md:text-7xl">THE DATA<br />DIDN&apos;T LOAD.</h1>
        <p className="mt-6 max-w-xl font-mono text-sm leading-relaxed">{message}. Start the STAMP API and try again; the interface never substitutes fabricated pool or match data.</p>
        <button className="primary-action physical-button mt-7 max-w-sm" onClick={retry} type="button">RETRY STAMP</button>
      </div>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<AppView>("play");
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [pool, setPool] = useState<PublicPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [mode, setMode] = useState<AppMode>("entry");
  const [prediction, setPrediction] = useState<MatchFingerprint>(DEFAULT_STAMP);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [transaction, setTransaction] = useState<TransactionState>({
    phase: "idle",
    message: "",
  });
  const walletPool = useWalletPool(pool);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([fetchReplay(controller.signal), fetchLivePool(controller.signal)])
      .then(([nextReplay, nextPool]) => {
        setReplay(nextReplay);
        setPool(nextPool);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unknown STAMP data error");
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode, view]);

  const restart = useCallback(() => {
    setMode("entry");
    setFrameIndex(0);
    setPlaying(false);
  }, []);

  const executeWalletAction = useCallback(async (values: MatchFingerprint) => {
    if (!pool || !walletPool.owner || !walletPool.program) {
      setTransaction({ phase: "error", message: "Connect a devnet wallet before signing a STAMP action." });
      return;
    }
    setTransaction({ phase: "signing", message: "Review the exact STAMP instruction in your wallet." });
    try {
      const client = await import("./stamp-client.js");
      const signature = walletPool.action === "enter"
        ? await client.enterPool(walletPool.program, pool, walletPool.owner, values)
        : walletPool.action === "claim"
          ? await client.claimPrize(walletPool.program, pool, walletPool.owner)
          : walletPool.action === "refund"
            ? await client.refundEntry(walletPool.program, pool, walletPool.owner)
            : null;
      if (!signature) throw new Error("No wallet transaction is available for this receipt state");
      setTransaction({
        phase: "confirmed",
        message: "The wallet-signed transaction reached confirmed commitment.",
        signature,
      });
      setLoadKey((value) => value + 1);
    } catch (reason: unknown) {
      setTransaction({
        phase: "error",
        message: reason instanceof Error ? reason.message : "Wallet transaction failed",
      });
    }
  }, [pool, walletPool.action, walletPool.owner, walletPool.program]);

  const body = useMemo(() => {
    if (error) return <ErrorScreen message={error} retry={() => setLoadKey((value) => value + 1)} />;
    if (!replay || !pool) return <LoadingScreen />;
    if (view === "play") return (
      <PlayScreen
        action={walletPool.action}
        onReceipts={() => setView("receipts")}
        onWalletAction={executeWalletAction}
        owner={walletPool.owner}
        pool={pool}
        transaction={transaction}
      />
    );
    if (view === "receipts") return (
      <ReceiptsScreen
        action={walletPool.action}
        onReplay={() => { restart(); setView("replay"); }}
        onWalletAction={executeWalletAction}
        owner={walletPool.owner}
        pool={pool}
        replay={replay}
        transaction={transaction}
      />
    );
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
  }, [error, executeWalletAction, frameIndex, mode, playing, pool, prediction, replay, restart, transaction, view, walletPool.action, walletPool.owner]);

  return (
    <div className="paper-app min-h-[100dvh] text-ink">
      <Header onView={setView} view={view} />
      {body}
      <footer className="mx-auto flex w-full max-w-[1500px] flex-wrap justify-between gap-3 border-t border-ink px-5 py-4 font-mono text-[0.65rem] tracking-[0.08em] md:px-8">
        <span>STAMP · TxLINE · SOLANA DEVNET</span>
        <span>PAPER REPLAY IS SIMULATION · MATCH DATA IS AUTHENTIC</span>
      </footer>
    </div>
  );
}
