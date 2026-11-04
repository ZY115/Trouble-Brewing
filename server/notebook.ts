import { randomUUID } from "node:crypto";
import type { Command } from "../shared/commands";
import type { NoteRevision } from "../shared/types";
import { validClaimInfo } from "../shared/claims";
import { roleById } from "../shared/roles";
import type { Room } from "./game";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export function notebookCommand(
  room: Room,
  owner: string,
  command: Extract<
    Command,
    { type: "save_notebook" | "add_note" | "edit_notebook" }
  >,
) {
  const entries = room.notebooks[owner] ?? [];
  const entryId = command.type === "add_note" ? undefined : command.entryId;
  const entry = entries.find((e) => e.id === entryId);
  check(!entryId || entry, "笔记不存在");
  const expectedVersion =
    command.type === "add_note" ? 0 : command.expectedVersion;
  check(
    (entry?.revisions.length ?? 0) === expectedVersion,
    "这条笔记已在其他页面修改，请重新打开后编辑",
  );
  const previous = entry?.revisions.at(-1);
  const kind =
    command.type === "edit_notebook"
      ? entry!.kind
      : command.type === "save_notebook"
        ? command.kind
        : command.roleId
          ? "claim"
          : "text";
  const target =
    command.type === "edit_notebook" ? entry!.target : (command.target ?? "");
  check(
    !entry || (entry.kind === kind && entry.target === target),
    "不能改变笔记的对象，请新建一条",
  );
  const revision: NoteRevision = {
    day: Math.max(1, room.day),
    period: room.phase === "DAY" || room.phase === "ENDED" ? "DAY" : "NIGHT",
    roleId: "",
    source: "suspected",
    body: "",
    info: {},
    ...(command.type === "edit_notebook" ? previous : {}),
    version: expectedVersion + 1,
    sequence:
      entries.reduce(
        (max, e) => Math.max(max, e.revisions.at(-1)?.sequence ?? 0),
        0,
      ) + 1,
    savedAt: new Date().toISOString(),
    seatNumbers: Object.fromEntries(room.seats.map((s) => [s.id, s.number])),
  };
  const fields = command.type === "edit_notebook" ? command.patch : command;
  for (const key of [
    "day",
    "period",
    "roleId",
    "source",
    "body",
    "info",
    "archived",
  ] as const) {
    if (key in fields && fields[key as keyof typeof fields] !== undefined)
      Object.assign(revision, { [key]: fields[key as keyof typeof fields] });
  }
  // A new role has a different information form. Keep the old form in history,
  // but never attach it to the new role implicitly.
  if (
    command.type === "edit_notebook" &&
    command.patch.roleId !== undefined &&
    command.patch.roleId !== previous!.roleId &&
    command.patch.info === undefined
  )
    revision.info = {};
  check(revision.day <= Math.max(1, room.day), "不能记录尚未到来的日期");
  const seatIds = room.seats.map((s) => s.id);
  check(!target || seatIds.includes(target), "玩家不存在");
  check(
    kind === "claim"
      ? !!target &&
          !!roleById(revision.roleId) &&
          validClaimInfo(revision.roleId, revision.info, seatIds)
      : !!revision.body &&
          revision.roleId === "" &&
          Object.keys(revision.info).length === 0,
    "笔记内容与所标注身份不一致",
  );
  if (entry) entry.revisions.push(revision);
  else entries.push({ id: randomUUID(), kind, target, revisions: [revision] });
  room.notebooks[owner] = entries;
  return "保存私人笔记版本";
}
