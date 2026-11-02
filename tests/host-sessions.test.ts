import { afterEach, it, expect, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("keeps all host room credentials and migrates the old single-slot credential before creating another room", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("location", { pathname: "/host", search: "", hash: "" });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const a = { code: "ABC234", token: "a".repeat(43) },
    b = { code: "DEF567", token: "b".repeat(43) };
  data.set("clocktower.host.v2", JSON.stringify(a));
  vi.resetModules();
  const sessions = await import("../src/session");
  sessions.saveSession(b);
  expect(sessions.hostSessions()).toEqual([a, b]);
  expect(sessions.loadSession()).toEqual(b);
  sessions.saveSession(a);
  expect(sessions.hostSessions()).toEqual([a, b]);
  sessions.forgetSession(a);
  expect(sessions.hostSessions()).toEqual([b]);
});
