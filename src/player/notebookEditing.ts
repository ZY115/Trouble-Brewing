import type { Command } from "../../shared/commands";
import type { NoteRevision, RoomView } from "../../shared/types";
import { seatNotes } from "./notes";

export type NoteDate = Pick<NoteRevision, "day" | "period">;
export type NoteFields = Pick<NoteRevision, "roleId" | "source" | "info" | "body">;
type EntryVersion = { id: string; version: number };
export interface NoteBaseline {
  fingerprint: string;
  claim?: EntryVersion;
  text?: EntryVersion;
  fields: NoteFields;
  date: NoteDate;
}
export type NoteDraft = NoteFields & { baseline?: NoteBaseline | null; date?: NoteDate };

export const currentNoteDate = (room: RoomView): NoteDate => ({
  day: Math.max(1, room.day),
  period: room.phase === "DAY" || room.phase === "ENDED" ? "DAY" : "NIGHT",
});
export const dateLabel = (date: NoteDate) => `第 ${date.day} ${date.period === "DAY" ? "天" : "夜"}`;
export const sameNoteDate = (a: NoteDate, b: NoteDate) => a.day === b.day && a.period === b.period;

function fingerprint(room: RoomView, seatId: string) {
  return JSON.stringify([
    room.code, room.gameNo, room.playId, seatId,
    room.notebook.filter((e) => e.target === seatId).map((e) => [e.id, e.revisions.length]).sort(),
  ]);
}

export function restoredNote(kind: string, rev: NoteRevision): NoteFields {
  return {
    roleId: kind === "claim" ? rev.roleId : "",
    source: kind === "claim" ? rev.source : "claimed",
    info: kind === "claim" ? { ...rev.info } : {},
    body: rev.body,
  };
}

export function noteBaseline(room: RoomView, seatId: string): NoteBaseline {
  const note = seatNotes(room)[seatId] ?? {};
  const current = note.claim ?? note.text;
  return {
    fingerprint: fingerprint(room, seatId),
    claim: note.claim && { id: note.claim.entry.id, version: note.claim.entry.revisions.length },
    text: note.text && { id: note.text.entry.id, version: note.text.entry.revisions.length },
    fields: current ? restoredNote(current.entry.kind, current.rev) : { roleId: "", source: "claimed", info: {}, body: "" },
    date: current ? { day: current.rev.day, period: current.rev.period } : currentNoteDate(room),
  };
}

export const noteChangedElsewhere = (baseline: NoteBaseline | null, room: RoomView, seatId: string) =>
  !baseline || baseline.fingerprint !== fingerprint(room, seatId);

export function noteSaveCommands(baseline: NoteBaseline, target: string, value: NoteFields, date: NoteDate): Command[] {
  const commands: Command[] = [];
  const edit = (entry: EntryVersion, patch: Extract<Command, { type: "edit_notebook" }>["patch"]) => {
    commands.push({ type: "edit_notebook", entryId: entry.id, expectedVersion: entry.version, patch });
  };
  const body = value.body.trim();
  if (value.roleId) {
    const fields = { ...value, body, ...date };
    if (baseline.claim) edit(baseline.claim, fields);
    else commands.push({ type: "add_note", target, ...fields });
    if (baseline.text) edit(baseline.text, { archived: true });
  } else {
    if (baseline.claim) edit(baseline.claim, { archived: true });
    if (body) {
      if (baseline.text) edit(baseline.text, { body, ...date });
      else commands.push({ type: "add_note", target, body, ...date });
    } else if (baseline.text) edit(baseline.text, { archived: true });
  }
  return commands;
}
