/** Pure history helpers: merge by seq, derive last-tick results, build the log blocks. */
import type { FloorState, RobotId, RobotTickResult } from '@fleet/engine';
import type { HistoryEntry } from '@fleet/protocol';
import {
  eventLine,
  resultLine,
  robotNum,
  tickSummary,
  type EventLine,
  type OutcomeGroup,
  outcomeGroup,
} from './copy';

export function lastSeq(history: readonly HistoryEntry[]): number {
  const last = history[history.length - 1];
  return last ? last.seq : 0;
}

export interface MergeResult {
  readonly merged: readonly HistoryEntry[];
  /** Entries whose seq was not held before, ascending. */
  readonly added: readonly HistoryEntry[];
}

/** Dedupe by seq and keep the list sorted ascending. Returns the same array when nothing is new. */
export function mergeHistory(
  existing: readonly HistoryEntry[],
  incoming: readonly HistoryEntry[],
): MergeResult {
  if (incoming.length === 0) {
    return { merged: existing, added: [] };
  }
  const sorted = [...incoming].sort((a, b) => a.seq - b.seq);
  const tail = lastSeq(existing);
  // Fast path: everything strictly newer than what we hold (the common live-update case).
  if (sorted[0] !== undefined && sorted[0].seq > tail) {
    const added = dedupeSorted(sorted);
    return { merged: existing.concat(added), added };
  }
  const known = new Set(existing.map((e) => e.seq));
  const added = dedupeSorted(sorted.filter((e) => !known.has(e.seq)));
  if (added.length === 0) {
    return { merged: existing, added };
  }
  const merged = existing.concat(added).sort((a, b) => a.seq - b.seq);
  return { merged, added };
}

function dedupeSorted(sorted: readonly HistoryEntry[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of sorted) {
    if (out.length === 0 || out[out.length - 1]!.seq !== e.seq) {
      out.push(e);
    }
  }
  return out;
}

/**
 * UI_SPEC section 2: the newest TICK_RESOLVED entry T; keep each of its results unless a
 * ROBOT_PLACED / ROBOT_REMOVED for that id or any FLOOR_CREATED has seq > T.seq, or the robot
 * is no longer on the floor.
 */
export function deriveLastResults(
  history: readonly HistoryEntry[],
  state: FloorState,
): Map<RobotId, RobotTickResult> {
  const out = new Map<RobotId, RobotTickResult>();
  const touched = new Set<RobotId>();
  let floorReset = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]!;
    const ev = entry.event;
    if (ev.type === 'TICK_RESOLVED') {
      if (floorReset) {
        return out;
      }
      const alive = new Set(state.robots.map((r) => r.id));
      for (const result of ev.results) {
        if (!touched.has(result.id) && alive.has(result.id)) {
          out.set(result.id, result);
        }
      }
      return out;
    }
    if (ev.type === 'FLOOR_CREATED') {
      floorReset = true;
    } else if (ev.type === 'ROBOT_PLACED' || ev.type === 'ROBOT_REMOVED') {
      touched.add(ev.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Log blocks
// ---------------------------------------------------------------------------

export interface LineView extends EventLineBase {
  readonly key: string;
  readonly seq: number;
  readonly at: string;
}

interface EventLineBase {
  readonly dataType: EventLine['type'] | 'TICK_RESULT';
  readonly glyph: string;
  readonly text: string;
  readonly code?: string;
  readonly robot?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly group?: OutcomeGroup;
}

export interface TickBlock {
  readonly kind: 'tick';
  readonly seq: number;
  readonly tick: number;
  readonly at: string;
  readonly summary: string;
  readonly lines: readonly LineView[];
  readonly empty: boolean;
}

export interface LineBlock {
  readonly kind: 'line';
  readonly seq: number;
  readonly line: LineView;
}

export type Block = TickBlock | LineBlock;

export interface BlocksResult {
  readonly blocks: readonly Block[];
  readonly hasMore: boolean;
}

/** Newest-first blocks, at most `max` of them; one block per history entry. */
export function buildBlocks(
  history: readonly HistoryEntry[],
  showIdle: boolean,
  max: number,
): BlocksResult {
  const blocks: Block[] = [];
  let i = history.length - 1;
  for (; i >= 0 && blocks.length < max; i--) {
    const entry = history[i]!;
    const ev = entry.event;
    if (ev.type === 'TICK_RESOLVED') {
      const results = [...ev.results].sort((a, b) => robotNum(a.id) - robotNum(b.id));
      const lines: LineView[] = [];
      for (const r of results) {
        if (r.outcome === 'IDLE' && !showIdle) {
          continue;
        }
        const line = resultLine(r, results);
        lines.push({
          key: `${entry.seq}-${r.id}`,
          seq: entry.seq,
          at: entry.at,
          dataType: 'TICK_RESULT',
          glyph: line.glyph,
          text: line.text,
          ...(line.code ? { code: line.code } : {}),
          robot: r.id,
          outcome: r.outcome,
          ...(r.reason ? { reason: r.reason } : {}),
          group: outcomeGroup(r.outcome),
        });
      }
      blocks.push({
        kind: 'tick',
        seq: entry.seq,
        tick: ev.tick,
        at: entry.at,
        summary: tickSummary(ev.tick, results, showIdle),
        lines,
        empty: lines.length === 0,
      });
    } else {
      const line = eventLine(ev);
      blocks.push({
        kind: 'line',
        seq: entry.seq,
        line: {
          key: String(entry.seq),
          seq: entry.seq,
          at: entry.at,
          dataType: line.type,
          glyph: line.glyph,
          text: line.text,
          ...(line.robot ? { robot: line.robot } : {}),
        },
      });
    }
  }
  return { blocks, hasMore: i >= 0 };
}

/** "HH:MM:SS" in the viewer's local time. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
