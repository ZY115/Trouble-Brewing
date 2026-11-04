import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise the actual storage functions with synchronous hook
// snapshots. Browser rendering and React subscription lifecycle are separate QA.
vi.mock("react", () => ({
  useMemo: (calculate: () => unknown) => calculate(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
    getSnapshot(),
}));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it("keeps embedded debug-player drafts isolated without reading or purging shared tab storage", async () => {
  vi.stubGlobal("location", { search: "?debugEmbed=1&debugSeat=seat-a" });
  const touch = vi.fn(() => { throw new Error("shared storage must not be touched"); });
  const storage = { get length() { touch(); return 1; }, getItem: touch, setItem: touch, removeItem: touch };
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", storage);
  const { clearPlayerCache, localKey, useLocalState } = await import("../src/localState");
  const first = { code: "ABCDEF", gameNo: 1, playId: "first", viewer: { kind: "player", seatId: "seat-a" } } as import("../shared/types").RoomView;
  clearPlayerCache(first.code, first);
  const key = localKey(first, "chat");
  expect(useLocalState(key, "")[0]).toBe("");
  useLocalState(key, "")[1]("unsent draft");
  expect(useLocalState(key, "")[0]).toBe("unsent draft");
  clearPlayerCache(first.code, { ...first, gameNo: 2, playId: "second" });
  expect(useLocalState(key, "")[0]).toBe("");
  expect(touch).not.toHaveBeenCalled();
});

describe("local drafts survive storage failures within the current tab", () => {
  it("uses a newly written draft when persisted old data is readable but writes fail", async () => {
    const saved = new Map([["draft", JSON.stringify("old draft")]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (key: string) => saved.delete(key),
    });
    const { useLocalState } = await import("../src/localState");
    const [before, setDraft] = useLocalState("draft", "");
    expect(before).toBe("old draft");
    setDraft("new draft");
    expect(saved.get("draft")).toBe(JSON.stringify("old draft"));
    expect(useLocalState("draft", "")[0]).toBe("new draft");
    setDraft((current) => current + " continued");
    expect(useLocalState("draft", "")[0]).toBe("new draft continued");
  });

  it("does not resurrect old data after clearing when storage removal fails", async () => {
    const saved = new Map([["draft", JSON.stringify("old draft")]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { useLocalState } = await import("../src/localState");
    const [, setDraft, clearDraft] = useLocalState("draft", "");
    setDraft("new draft");
    clearDraft();
    expect(saved.get("draft")).toBe(JSON.stringify("old draft"));
    expect(useLocalState("draft", "")[0]).toBe("");
    // A functional update after clear must start with the initial state,
    // not either the stale persisted draft or the discarded new draft.
    setDraft((current) => current + "fresh");
    expect(useLocalState("draft", "")[0]).toBe("fresh");
  });

  it("keeps separate in-memory drafts when every storage operation is unavailable", async () => {
    const unavailable = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: unavailable,
      setItem: unavailable,
      removeItem: unavailable,
    });
    const { useLocalState } = await import("../src/localState");
    const [, setA, clearA] = useLocalState("chat:A", "");
    const [, setB] = useLocalState("chat:B", "");
    setA("for A");
    setB("for B");
    expect(useLocalState("chat:A", "")[0]).toBe("for A");
    expect(useLocalState("chat:B", "")[0]).toBe("for B");
    clearA();
    expect(useLocalState("chat:A", "")[0]).toBe("");
    expect(useLocalState("chat:B", "")[0]).toBe("for B");
  });

  it("still writes and clears browser storage normally when it is available", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    const { useLocalState } = await import("../src/localState");
    const [, setDraft, clearDraft] = useLocalState("draft", { body: "" });
    setDraft({ body: "saved locally" });
    expect(JSON.parse(saved.get("draft")!)).toEqual({ body: "saved locally" });
    expect(useLocalState("draft", { body: "" })[0]).toEqual({
      body: "saved locally",
    });
    clearDraft();
    expect(saved.has("draft")).toBe(false);
    expect(useLocalState("draft", { body: "" })[0]).toEqual({ body: "" });
  });
});

it("isolates registration drafts, dealt games, rooms and players while retaining legacy active-game drafts", async () => {
  const { localKey, useLocalState } = await import("../src/localState");
  const waiting = {
    code: "ABCDEF",
    gameNo: 1,
    viewer: { kind: "player", seatId: "seat-a" },
  } as import("../shared/types").RoomView;
  const key = (room: typeof waiting) => localKey(room, "notebook-draft");
  const [, save] = useLocalState(key(waiting), "");
  save("old registration draft");
  const first = { ...waiting, playId: "first-deal" };
  expect(useLocalState(key(first), "")[0]).toBe("");
  const [, saveGame] = useLocalState(key(first), "");
  saveGame("real game draft");
  expect(useLocalState(key({ ...first }), "")[0]).toBe("real game draft");
  for (const other of [
    { ...first, playId: "next-deal" },
    { ...first, gameNo: 2 },
    { ...first, code: "QWERTY" },
    { ...first, viewer: { kind: "player" as const, seatId: "seat-b" } },
  ])
    expect(useLocalState(key(other), "")[0]).toBe("");
  expect(key(waiting)).toBe("clocktower.local:ABCDEF:1:seat-a:notebook-draft");
});

it("cleans old-round and legacy caches, preserves current drafts and credentials, and prevents late writes from resurrecting them", async () => {
  const persisted = new Map<string, string>();
  const tab = new Map<string, string>();
  const storage = (data: Map<string, string>) => ({
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubGlobal("localStorage", storage(persisted));
  vi.stubGlobal("sessionStorage", storage(tab));
  const { clearPlayerCache, localKey, useLocalState } = await import(
    "../src/localState"
  );
  const { useVerdicts } = await import("../src/player/notes");
  const first = {
    code: "ABCDEF",
    gameNo: 1,
    playId: "deal-one",
    viewer: { kind: "player", seatId: "seat-a" },
  } as import("../shared/types").RoomView;
  const oldKey = localKey(first, "notebook-draft");
  persisted.set("clocktower.player.ABCDEF", "session credential");
  persisted.set("clocktower.host.v2", "host credential");
  persisted.set("clocktower.verdicts:ABCDEF:1:seat-a", '{"seat-b":"evil"}');
  tab.set("clocktower.local:ABCDEF:1:host:setup", '"host draft"');
  tab.set("clocktower.local:OTHERX:1:seat-a:chat", '"other room"');
  clearPlayerCache(first.code, first);
  const [, saveOld] = useLocalState(oldKey, "");
  saveOld("old-round draft");
  useVerdicts(first).setVerdict("seat-b", "evil");
  expect(useVerdicts(first).verdicts).toEqual({ "seat-b": "evil" });
  const next = { ...first, gameNo: 2, playId: "deal-two" };
  clearPlayerCache(next.code, next);
  expect(useVerdicts(next).verdicts).toEqual({});
  expect(useLocalState(localKey(next, "notebook-draft"), "")[0]).toBe("");
  expect(tab.has(oldKey)).toBe(false);
  expect(persisted.has("clocktower.verdicts:ABCDEF:1:seat-a")).toBe(false);
  saveOld("late old-round callback");
  expect(useLocalState(oldKey, "")[0]).toBe("");
  expect(tab.has(oldKey)).toBe(false);
  const currentKey = localKey(next, "chat-draft:storyteller");
  useLocalState(currentKey, "")[1]("current draft");
  clearPlayerCache(next.code, next);
  expect(useLocalState(currentKey, "")[0]).toBe("current draft");
  expect(persisted.get("clocktower.player.ABCDEF")).toBe("session credential");
  expect(persisted.get("clocktower.host.v2")).toBe("host credential");
  expect(tab.has("clocktower.local:ABCDEF:1:host:setup")).toBe(true);
  expect(tab.has("clocktower.local:OTHERX:1:seat-a:chat")).toBe(true);
  vi.resetModules();
  const reloaded = await import("../src/localState");
  reloaded.clearPlayerCache(next.code, next);
  expect(reloaded.useLocalState(currentKey, "")[0]).toBe("current draft");
  reloaded.clearPlayerCache(next.code);
  expect(reloaded.useLocalState(currentKey, "")[0]).toBe("");
});

it("does not read obsolete private drafts even if storage deletion fails", async () => {
  const { localKey, clearPlayerCache, useLocalState } = await import(
    "../src/localState"
  );
  const old = {
    code: "ABCDEF",
    gameNo: 1,
    playId: "one",
    viewer: { kind: "player", seatId: "a" },
  } as import("../shared/types").RoomView;
  const key = localKey(old, "notebook-draft");
  vi.stubGlobal("sessionStorage", {
    length: 1,
    key: () => key,
    getItem: () => '"old secret"',
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  clearPlayerCache(old.code, { ...old, gameNo: 2, playId: "two" });
  expect(useLocalState(key, "")[0]).toBe("");
  useLocalState(key, "")[1]("late write");
  expect(useLocalState(key, "")[0]).toBe("");
});
