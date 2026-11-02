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
