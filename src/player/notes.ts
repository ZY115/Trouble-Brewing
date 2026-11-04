import { localKey, useLocalState } from "../localState";
import type {
  NotebookEntry,
  NoteRevision,
  PublicSeat,
  RoomView,
} from "../../shared/types";
import { claimFields } from "../../shared/claims";
import { roleName } from "../../shared/roles";

export interface NoteRef {
  entry: NotebookEntry;
  rev: NoteRevision;
}
export interface SeatNote {
  claim?: NoteRef;
  text?: NoteRef;
}

const newer = (a: NoteRevision, b: NoteRevision) =>
  (a.sequence ?? 0) !== (b.sequence ?? 0)
    ? (a.sequence ?? 0) > (b.sequence ?? 0)
    : a.savedAt > b.savedAt;

/** The latest live role note and free note this player keeps for each seat. */
export function seatNotes(room: RoomView) {
  return latestNotes(room.notebook);
}

export function latestNotes(
  entries: NotebookEntry[],
): Record<string, SeatNote> {
  const out: Record<string, SeatNote> = {};
  for (const entry of entries) {
    const rev = entry.revisions.at(-1);
    if (!rev || rev.archived || !entry.target) continue;
    const note = (out[entry.target] ??= {});
    const key = entry.kind === "claim" ? "claim" : "text";
    const old = note[key];
    if (!old || newer(rev, old.rev)) note[key] = { entry, rev };
  }
  return out;
}

/** "洗衣妇" for a claim, "洗衣妇?" for a guess. */
export const roleLabel = (rev?: NoteRevision) =>
  rev?.roleId
    ? `${roleName(rev.roleId)}${rev.source === "suspected" ? "?" : ""}`
    : "";

/** What they said they learned, in one line: "3、7 号 · 厨师". */
export function claimSummary(rev: NoteRevision, seats: PublicSeat[]) {
  const fields = claimFields(rev.roleId).filter((f) => rev.info[f.key]);
  const nums = fields
    .filter((f) => f.type === "seat")
    .map(
      (f) =>
        rev.seatNumbers[rev.info[f.key]] ??
        seats.find((s) => s.id === rev.info[f.key])?.number,
    )
    .filter(Boolean);
  const rest = fields
    .filter((f) => f.type === "choice")
    .map(
      (f) => f.options?.find((o) => o.value === rev.info[f.key])?.label ?? "",
    );
  return [nums.length ? `${nums.join("、")} 号` : "", ...rest]
    .filter(Boolean)
    .join(" · ");
}

export type Verdict = "good" | "evil";

/**
 * A quick good/evil read per seat. It lives only on this phone: it is a gut
 * feeling, and keeping it local means changing it is instant and silent.
 */
export function useVerdicts(room: RoomView) {
  const [verdicts, setVerdicts] = useLocalState<Record<string, Verdict>>(
    localKey(room, "verdicts"),
    {},
  );
  const setVerdict = (seatId: string, verdict: Verdict | "") => {
    setVerdicts((old) => {
      const next = { ...old };
      if (verdict) next[seatId] = verdict;
      else delete next[seatId];
      return next;
    });
  };
  return { verdicts, setVerdict };
}
