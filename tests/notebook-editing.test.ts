import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../shared/commands";
import type { NoteRevision, RoomView } from "../shared/types";

const harness = vi.hoisted(() => ({ slots: [] as any[], index: 0, draft: null as any, effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: any) => {
    const i = harness.index++;
    if (!(i in harness.slots)) harness.slots[i] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[i], (value: any) => {
      harness.slots[i] = typeof value === "function" ? value(harness.slots[i]) : value;
    }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const i = harness.index++, previous = harness.slots[i];
    if (previous && deps.every((value, at) => value === previous[at])) return;
    harness.slots[i] = deps;
    harness.effects.push(effect);
  },
}));
vi.mock("../src/localState", () => ({
  localKey: () => "draft",
  useLocalState: () => [harness.draft, (value: unknown) => { harness.draft = value; }, () => { harness.draft = null; }],
  useUnread: () => ({ contactCount: () => 0 }),
}));

import SeatSheet from "../src/player/SeatSheet";
import { currentNoteDate, noteBaseline, noteChangedElsewhere, noteSaveCommands } from "../src/player/notebookEditing";
import { latestNotes } from "../src/player/notes";
import { notebookCommand } from "../server/notebook";
import type { Room } from "../server/game";

const revision = (version: number, body: string, number = "1"): NoteRevision => ({
  version, sequence: version, body, day: 1, period: "NIGHT", roleId: "empath", source: "claimed",
  info: { number }, seatNumbers: { s1: 1, s2: 2 }, savedAt: `2026-11-06T00:00:0${version}Z`,
});
const fixture = (): RoomView => ({
  code: "NOTES1", gameNo: 1, playId: "round-one", day: 2, phase: "OTHER_NIGHT",
  viewer: { kind: "player", seatId: "s1" },
  seats: [{ id: "s1", number: 1, alive: true }, { id: "s2", number: 2, alive: true }],
  notebook: [{ id: "claim", kind: "claim", target: "s2", revisions: [revision(1, "original")] }],
  messages: [], actions: [],
}) as unknown as RoomView;

const walk = (node: any): any[] => !node ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === "object" ? [node, ...walk(node.props?.children)] : [];
const text = (node: any): string => node == null ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const button = (tree: any, label: string) => {
  const found = walk(tree).find((n) => n.type === "button" && text(n) === label);
  expect(found, `button ${label}`).toBeDefined();
  return found;
};
const render = (room: RoomView, send = vi.fn(async (_command: Command) => true)) => {
  harness.index = 0;
  const tree = SeatSheet({ room, send, seatId: "s2", verdict: undefined, setVerdict: () => {}, onClose: vi.fn(), onChat: vi.fn() });
  harness.effects.splice(0).forEach((effect) => effect());
  return tree;
};
const finish = async (tree: any) => {
  button(tree, "完成").props.onClick();
  await new Promise<void>((resolve) => setImmediate(resolve));
};
const editBody = (tree: any, body: string) => walk(tree).find((n) => n.type === "textarea").props.onChange({ target: { value: body } });
const datePicker = (tree: any) => walk(tree).find((n) => n.props?.label === "信息发生时间");

beforeEach(() => { harness.slots = []; harness.index = 0; harness.draft = null; harness.effects = []; });

describe("seat notebook editing", () => {
  it("preserves unfinished edits if the browser reloads the page after a lock", () => {
    const room = fixture(), send = vi.fn(async (_command: Command) => true);
    let tree = render(room, send);
    editBody(tree, "unsaved before lock");
    render(room, send);
    expect(harness.draft?.body).toBe("unsaved before lock");
    expect(harness.draft?.baseline.claim.version).toBe(1);
    harness.slots = [];
    tree = render(room, send);
    expect(walk(tree).find((node) => node.type === "textarea").props.value).toBe("unsaved before lock");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the observation time when an unfinished edit spans a phase change", async () => {
    const room = fixture(), send = vi.fn(async (_command: Command) => true);
    let tree = render(room, send);
    editBody(tree, "noted before dawn");
    render(room, send);
    tree = render({ ...room, phase: "DAY" }, send);
    expect(datePicker(tree).props.value).toBe("2:NIGHT");
    await finish(tree);
    expect(send.mock.calls[0][0]).toMatchObject({ patch: { day: 2, period: "NIGHT" } });
  });

  it("blocks an old open form and persisted draft after another page updates the note", async () => {
    const room = fixture(), send = vi.fn(async (_command: Command) => true);
    let tree = render(room, send);
    editBody(tree, "my unsaved draft");
    const latest = structuredClone(room);
    latest.notebook[0].revisions.push(revision(2, "other page", "2"));
    tree = render(latest, send);
    expect(text(tree)).toContain("已有新版本");
    expect(button(tree, "完成").props.disabled).toBe(true);
    await finish(tree);
    expect(send).not.toHaveBeenCalled();
    button(tree, "保留草稿退出").props.onClick();
    expect(harness.draft.baseline.claim.version).toBe(1);
    harness.slots = [];
    tree = render(latest, send);
    expect(text(tree)).toContain("已有新版本");
    expect(walk(tree).find((n) => n.type === "textarea").props.value).toBe("my unsaved draft");
    button(tree, "放弃本次修改，加载最新版").props.onClick();
    tree = render(latest, send);
    expect(text(tree)).not.toContain("已有新版本");
    editBody(tree, "explicitly edit latest");
    tree = render(latest, send);
    await finish(tree);
    expect(send.mock.calls[0][0]).toMatchObject({ type: "edit_notebook", expectedVersion: 2, patch: { info: { number: "2" } } });
  });

  it("uses the original version even when a newer update arrives after the client conflict check", () => {
    const room = fixture(), base = noteBaseline(room, "s2");
    const server = { ...room, notebooks: { s1: structuredClone(room.notebook) } } as unknown as Room;
    const newer: Command = { type: "edit_notebook", entryId: "claim", expectedVersion: 1, patch: { info: { number: "2" } } };
    notebookCommand(server, "s1", newer);
    const stale = noteSaveCommands(base, "s2", { ...base.fields, body: "late draft" }, currentNoteDate(room))[0];
    expect(stale.type).toBe("edit_notebook");
    expect(() => notebookCommand(server, "s1", stale as typeof newer)).toThrow(/其他页面/);
    expect(server.notebooks.s1[0].revisions.at(-1)?.info).toEqual({ number: "2" });
  });

  it("dates newly changed information to this night and lets a correction retain its original date", async () => {
    const room = fixture(), send = vi.fn(async (_command: Command) => true);
    let tree = render(room, send);
    expect(datePicker(tree).props.value).toBe("1:NIGHT");
    editBody(tree, "new information tonight");
    tree = render(room, send);
    expect(datePicker(tree).props.value).toBe("2:NIGHT");
    await finish(tree);
    expect(send.mock.calls[0][0]).toMatchObject({ patch: { day: 2, period: "NIGHT" } });
    datePicker(tree).props.onChange("1:NIGHT");
    tree = render(room, send);
    await finish(tree);
    expect(send.mock.calls[1][0]).toMatchObject({ patch: { day: 1, period: "NIGHT" } });
  });

  it("restores pure text without retaining a later role, result or date", async () => {
    const room = fixture();
    const oldText = { ...revision(1, "old plain note"), roleId: "", info: {} };
    room.notebook.unshift({ id: "text", kind: "text", target: "s2", revisions: [oldText, { ...oldText, version: 2, archived: true }] });
    room.notebook[1].revisions[0].day = 2;
    const server = { ...room, notebooks: { s1: structuredClone(room.notebook) } } as unknown as Room;
    const send = vi.fn(async (command: Command) => {
      notebookCommand(server, "s1", command as Parameters<typeof notebookCommand>[2]);
      return true;
    });
    let tree = render(room, send);
    const row = walk(tree).find((n) => n.type === "li" && text(n).includes("old plain note"));
    button(row, "恢复这个版本").props.onClick();
    tree = render(room, send);
    expect(datePicker(tree).props.value).toBe("1:NIGHT");
    await finish(tree);
    const restored = latestNotes(server.notebooks.s1).s2;
    expect(restored.claim).toBeUndefined();
    expect(restored.text?.rev).toMatchObject({ roleId: "", info: {}, body: "old plain note", day: 1, period: "NIGHT" });
    expect(server.notebooks.s1.find((e) => e.id === "claim")!.revisions[0].info).toEqual({ number: "1" });
  });

  it("keeps offline drafts with their edit baseline and observation date", async () => {
    const room = fixture(), send = vi.fn(async (_command: Command) => false);
    let tree = render(room, send);
    editBody(tree, "offline draft");
    tree = render(room, send);
    await finish(tree);
    tree = render(room, send);
    button(tree, "保留草稿退出").props.onClick();
    harness.slots = [];
    tree = render({ ...room, day: 3 }, send);
    expect(text(tree)).not.toContain("已有新版本");
    expect(datePicker(tree).props.value).toBe("2:NIGHT");
    expect(walk(tree).find((n) => n.type === "textarea").props.value).toBe("offline draft");
    expect(noteChangedElsewhere(harness.draft.baseline, room, "s2")).toBe(false);
  });

  it("does not replay a partially saved role/text conversion or claim it was an external edit", async () => {
    const room = fixture();
    let attempts = 0;
    const send = vi.fn(async (_command: Command) => ++attempts === 1);
    let tree = render(room, send);
    button(tree, "清除").props.onClick();
    tree = render(room, send);
    await finish(tree);
    expect(send).toHaveBeenCalledTimes(2);
    tree = render(room, send);
    expect(text(tree)).toContain("已有部分修改保存");
    expect(button(tree, "完成").props.disabled).toBe(true);
    await finish(tree);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("requires review of a legacy draft that has no baseline", () => {
    harness.draft = { roleId: "empath", source: "claimed", info: { number: "0" }, body: "legacy unsaved" };
    const tree = render(fixture());
    expect(text(tree)).toContain("旧草稿缺少版本信息");
    expect(button(tree, "完成").props.disabled).toBe(true);
  });
});
