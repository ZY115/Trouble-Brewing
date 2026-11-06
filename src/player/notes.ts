import type { Send } from "../useRoom";
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

export const roleLabel = (rev?: NoteRevision) =>
  rev?.roleId
    ? `${roleName(rev.roleId)}${rev.source === "suspected" ? "?" : ""}`
    : "";

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

export function useVerdicts(room: RoomView, send: Send) {
  const verdicts = room.self?.verdicts ?? {};
  const setVerdict = (seatId: string, verdict: Verdict | "") =>
    void send({ type: "set_verdict", target: seatId, verdict: verdict || null });
  return { verdicts, setVerdict };
}
