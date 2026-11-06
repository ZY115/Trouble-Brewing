import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { RoomView } from "../shared/types";
import type { Command } from "../shared/commands";

const harness = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: any) => {
    const i = harness.index++;
    if (!(i in harness.slots)) harness.slots[i] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[i], (value: any) => { harness.slots[i] = typeof value === "function" ? value(harness.slots[i]) : value; }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const i = harness.index++, previous = harness.slots[i];
    if (previous && deps.every((value, at) => value === previous[at])) return;
    harness.slots[i] = deps;
    harness.effects.push(effect);
  },
  useMemo: (compute: () => unknown) => compute(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
import SeatSheet from "../src/player/SeatSheet";
import { clearPlayerCache, localKey } from "../src/localState";
import { notebookCommand } from "../server/notebook";
import type { Room } from "../server/game";

const fixture = (): RoomView => ({
  code: "DRAFTS", gameNo: 1, playId: "draft-one", day: 1, phase: "FIRST_NIGHT",
  viewer: { kind: "player", seatId: "owner" },
  seats: [{ id: "owner", number: 1, alive: true }, { id: "target", number: 2, alive: true }],
  notebook: [], messages: [], actions: [],
}) as unknown as RoomView;
const walk = (node: any): any[] => !node ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === "object" ? [node, ...walk(node.props?.children)] : [];
const text = (node: any): string => node == null ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const flush = () => harness.effects.splice(0).forEach((effect) => effect());
function render(room: RoomView, send: (command: Command) => Promise<boolean>, close = vi.fn(), commit = true) {
  harness.index = 0;
  const tree = SeatSheet({ room, send, seatId: "target", verdict: undefined, setVerdict: () => {}, onClose: close, onChat: vi.fn() });
  if (commit) flush();
  return tree;
}
const edit = (tree: any, value: string) => walk(tree).find((node) => node.type === "textarea").props.onChange({ target: { value } });
const draftKey = (room: RoomView) => localKey(room, "note-draft:target");

beforeEach(() => {
  harness.slots = []; harness.index = 0; harness.effects = [];
  const storage = new Map<string, string>();
  const memoryStorage = {
    get length() { return storage.size; }, key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  };
  vi.stubGlobal("sessionStorage", memoryStorage);
  vi.stubGlobal("localStorage", memoryStorage);
  clearPlayerCache("DRAFTS");
});
afterEach(() => { clearPlayerCache("DRAFTS"); vi.unstubAllGlobals(); });

it("clears a successfully saved draft and reopens the persisted latest note without a draft warning", async () => {
  const room = fixture(); clearPlayerCache(room.code, room);
  const server = { ...room, notebooks: { owner: [] } } as unknown as Room;
  const close = vi.fn(), send = vi.fn(async (command: Command) => {
    notebookCommand(server, "owner", command as Parameters<typeof notebookCommand>[2]);
    return true;
  });
  let tree = render(room, send, close);
  edit(tree, "输入后暂存，完成后清除"); tree = render(room, send, close);
  expect(JSON.parse(sessionStorage.getItem(draftKey(room))!).body).toBe("输入后暂存，完成后清除");
  walk(tree).find((node) => node.type === "button" && text(node) === "完成").props.onClick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(close).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(draftKey(room))).toBeNull();
  harness.slots = [];
  tree = render({ ...room, notebook: server.notebooks.owner }, send, close);
  expect(walk(tree).find((node) => node.type === "textarea").props.value).toBe("输入后暂存，完成后清除");
  expect(text(tree)).not.toContain("上次的修改还没保存");
  expect(sessionStorage.getItem(draftKey(room))).toBeNull();
  expect(send).toHaveBeenCalledOnce();
});

it("blocks late draft effects from an old round and restores no old information after remount", () => {
  const old = fixture(); clearPlayerCache(old.code, old);
  const send = vi.fn(async (_command: Command) => true);
  let tree = render(old, send);
  edit(tree, "OLD_ROUND_DRAFT"); render(old, send, vi.fn(), false);
  expect(harness.effects).toHaveLength(1);
  const current = { ...old, gameNo: 2, playId: "draft-two" };
  clearPlayerCache(current.code, current);
  flush();
  expect(sessionStorage.getItem(draftKey(old))).toBeNull();
  expect(sessionStorage.getItem(draftKey(current))).toBeNull();
  harness.slots = [];
  tree = render(current, send);
  expect(walk(tree).find((node) => node.type === "textarea").props.value).toBe("");
  expect(send).not.toHaveBeenCalled();
});
