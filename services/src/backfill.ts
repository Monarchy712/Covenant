import { config } from "./config.js";
import { getCursor, setCursor, getSetting, setSetting, type DB } from "./db.js";
import { Indexer } from "./indexer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BackfillStatus {
  running: boolean;
  from: number | null;
  to: number | null;
  current: number | null;
  pct: number | null;
  etaSec: number | null;
  startedAt: number | null;
  done: boolean;
  error: string | null;
}

/// Historical gap-filler that runs INSIDE the hosted service (the DB lives on the Railway volume, so
/// a local script can't reach it). It uses its OWN Indexer instance (separate mandate/ts caches, no
/// SSE emit) and its OWN DB cursor ('backfill'), so it never disturbs the forward indexer and can
/// resume after a restart. Batched multi-address getLogs keeps RPC usage feasible (see
/// Indexer.indexSpanBatched). Progress is surfaced in /health.
export class BackfillController {
  private st: BackfillStatus = {
    running: false,
    from: null,
    to: null,
    current: null,
    pct: null,
    etaSec: null,
    startedAt: null,
    done: false,
    error: null,
  };
  private indexer: Indexer;

  constructor(private db: DB) {
    this.indexer = new Indexer(db); // no onEvent => historical events don't spam SSE
    this.indexer.loadMandates();
  }

  status(): BackfillStatus {
    return { ...this.st };
  }

  /// Start (or resume) a backfill over [from,to]. Persists the target range + a 'backfill' cursor
  /// so a crash/restart continues where it stopped. Returns immediately; the job runs in background.
  start(from: number, to: number): { ok: boolean; error?: string; resuming?: boolean; from?: number; to?: number } {
    if (this.st.running) return { ok: false, error: "backfill already running" };
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from)
      return { ok: false, error: "invalid range: need 0 <= fromBlock <= toBlock" };
    setSetting(this.db, "backfill_from", String(from));
    setSetting(this.db, "backfill_to", String(to));
    const prev = getCursor(this.db, "backfill");
    const resumeFrom = prev !== null && prev >= from && prev < to ? prev + 1 : from;
    void this.run(resumeFrom, to, from);
    return { ok: true, resuming: resumeFrom !== from, from: resumeFrom, to };
  }

  /// If a backfill was requested but hasn't finished, resume it on boot — including the case where
  /// the FIRST span never completed (no 'backfill' cursor yet): resume from the target's fromBlock.
  /// This makes a redeploy automatically re-kick the job (with the latest code) without re-POSTing.
  maybeResumeOnBoot(): void {
    const tgtFrom = Number(getSetting(this.db, "backfill_from", "NaN"));
    const tgtTo = Number(getSetting(this.db, "backfill_to", "NaN"));
    if (!Number.isFinite(tgtFrom) || !Number.isFinite(tgtTo)) return;
    const cur = getCursor(this.db, "backfill");
    if (cur !== null && cur >= tgtTo) return; // already complete
    const resumeFrom = cur !== null ? cur + 1 : tgtFrom;
    console.log(`[backfill] resuming on boot: ${resumeFrom}..${tgtTo}`);
    void this.run(resumeFrom, tgtTo, tgtFrom);
  }

  private async run(resumeFrom: number, to: number, origFrom: number): Promise<void> {
    this.st = {
      running: true,
      from: origFrom,
      to,
      current: resumeFrom,
      pct: resumeFrom > origFrom ? Math.round(((resumeFrom - origFrom) / (to - origFrom + 1)) * 1000) / 10 : 0,
      etaSec: null,
      startedAt: Math.floor(Date.now() / 1000),
      done: false,
      error: null,
    };
    const span = Math.max(config.chunkSize, config.backfillSpan);
    const total = to - origFrom + 1;
    const t0 = Date.now();
    console.log(`[backfill] start ${resumeFrom}..${to} (target ${origFrom}..${to}, span ${span})`);
    try {
      // pick up any mandates the forward indexer has since discovered
      this.indexer.loadMandates();
      for (let s = resumeFrom; s <= to; s += span) {
        const e = Math.min(s + span - 1, to);
        // Per-span retry: getLogsRetry already backs off on transient errors, but if a whole span
        // still fails (e.g. a longer RPC outage) retry it a few times here before aborting the job,
        // so one blip over a ~55k-call run doesn't throw away hours of progress.
        for (let spanAttempt = 0; ; spanAttempt++) {
          try {
            await this.indexer.indexSpanBatched(s, e);
            break;
          } catch (spanErr: unknown) {
            if (spanAttempt >= 5) throw spanErr;
            const backoff = Math.min(30_000, 1000 * 2 ** spanAttempt);
            console.warn(`[backfill] span ${s}..${e} failed (attempt ${spanAttempt + 1}): ${String((spanErr as any)?.shortMessage ?? (spanErr as any)?.message ?? spanErr)} — retrying in ${backoff}ms`);
            await sleep(backoff);
          }
        }
        setCursor(this.db, "backfill", e); // durable resume point
        this.st.current = e;
        const done = e - origFrom + 1;
        this.st.pct = Math.min(100, Math.round((done / total) * 1000) / 10);
        const elapsed = (Date.now() - t0) / 1000;
        const ratePerSec = (e - resumeFrom + 1) / Math.max(1, elapsed);
        this.st.etaSec = ratePerSec > 0 ? Math.round((to - e) / ratePerSec) : null;
        if (e < to) await sleep(config.backfillPauseMs); // breather for the public RPC
      }
      this.st.done = true;
      console.log(`[backfill] done ${origFrom}..${to} in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (err: unknown) {
      this.st.error = String((err as any)?.shortMessage ?? (err as any)?.message ?? err);
      console.error(
        `[backfill] error at block ${this.st.current}: ${this.st.error} — cursor persisted; ` +
          `POST /admin/backfill again (or a restart) resumes from here.`,
      );
    } finally {
      this.st.running = false;
    }
  }
}
