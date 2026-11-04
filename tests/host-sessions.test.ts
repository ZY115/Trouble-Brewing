import { afterEach, it, expect, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("opens the explicitly selected host room in an embedded debug view instead of the last-used room", async () => {
  const a = { code: "ABC234", token: "a".repeat(43) }, b = { code: "DEF567", token: "b".repeat(43) };
  const data = new Map([
    ["clocktower.host.v2", JSON.stringify(b)],
    ["clocktower.host.rooms.v3", JSON.stringify({ [a.code]: a, [b.code]: b })],
  ]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null });
  for (const [code, expected] of [[a.code, a], ["ZZZ234", null]] as const) {
    vi.stubGlobal("location", { pathname: "/host", search: `?room=${code}&debugEmbed=1`, hash: "" });
    vi.resetModules();
    expect((await import("../src/session")).loadSession()).toEqual(expected);
  }
});
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

it("isolates multiple debug players from each other and from the normal player and host sessions", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const normal = { code: "ABC234", token: "n".repeat(43) };
  const host = { code: "ABC234", token: "h".repeat(43) };
  data.set("clocktower.player.ABC234", JSON.stringify(normal));
  data.set("clocktower.host.v2", JSON.stringify(host));
  for (const seat of ["seat-a", "seat-b"]) {
    vi.stubGlobal("location", {
      pathname: "/join/ABC234",
      search: `?debugSeat=${seat}`,
      hash: "",
    });
    vi.resetModules();
    const s = await import("../src/session");
    expect(s.loadSession()).toBeNull();
    s.saveSession({ code: "ABC234", token: seat.repeat(8) });
    expect(s.loadSession()?.token).toBe(seat.repeat(8));
  }
  vi.stubGlobal("location", {
    pathname: "/join/ABC234",
    search: "?debugSeat=seat-a",
    hash: "",
  });
  vi.resetModules();
  const a = await import("../src/session");
  expect(a.loadSession()?.token).toBe("seat-a".repeat(8));
  a.forgetSession(a.loadSession()!);
  expect(data.has("clocktower.debug.player.ABC234.seat-b")).toBe(true);
  expect(JSON.parse(data.get("clocktower.player.ABC234")!)).toEqual(normal);
  expect(a.hostSessions()).toEqual([host]);
});
