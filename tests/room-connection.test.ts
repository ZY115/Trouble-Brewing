import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoomView, Session } from "../shared/types";

const harness = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  sockets: [] as any[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = harness.index++;
    if (!(i in harness.slots)) harness.slots[i] = typeof initial === "function" ? initial() : initial;
    return [
      harness.slots[i],
      (value: unknown) => {
        harness.slots[i] = typeof value === "function" ? value(harness.slots[i]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = harness.index++;
    return (harness.slots[i] ??= { current: initial });
  },
  useEffect: (effect: () => () => void, deps: unknown[]) => {
    const i = harness.index++,
      previous = harness.slots[i];
    if (previous && deps.every((v, at) => v === previous.deps[at])) return;
    harness.effects.push(() => {
      previous?.cleanup?.();
      harness.slots[i] = { deps, cleanup: effect() };
    });
  },
}));
vi.mock("../src/localState", () => ({
  clearPlayerCache: vi.fn(),
  localScope: (r: RoomView) =>
    `${r.code}:${r.gameNo}:${r.viewer.seatId}:${r.playId}`,
}));
vi.mock("socket.io-client", () => ({
  io: () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const socket = {
      connected: true,
      emit: vi.fn(),
      emitWithAck: vi.fn(() => new Promise(() => {})),
      timeout: () => socket,
      connect: () => { socket.connected = true; listeners.get("connect")?.(); return socket; },
      on: (name: string, fn: (...args: any[]) => void) =>
        listeners.set(name, fn),
      disconnect: () => {
        socket.connected = false;
        listeners.get("disconnect")?.();
        return socket;
      },
      removeAllListeners: () => listeners.clear(),
      listeners,
    };
    harness.sockets.push(socket);
    return socket;
  },
}));
import { useRoom } from "../src/useRoom";
import { clearPlayerCache } from "../src/localState";

afterEach(() => {
  for (const slot of harness.slots) slot?.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  harness.slots = [];
  harness.index = 0;
  harness.effects = [];
  harness.sockets = [];
  vi.clearAllMocks();
});
const render = (session: Session) => {
  harness.index = 0;
  return useRoom(session);
};
const commit = () => {
  harness.effects.splice(0).forEach((effect) => effect());
};
const room = (gameNo: number): RoomView =>
  ({
    code: "ABCDEF",
    gameNo,
    revision: gameNo * 10,
    playId: `play-${gameNo}`,
    phase: "FIRST_NIGHT",
    viewer: { kind: "player", seatId: "a" },
    messages: [],
    actions: [],
    notebook: [],
  }) as unknown as RoomView;

it("keeps the last snapshot on screen but inert until an authoritative state arrives, and ignores delayed old-round packets", async () => {
  const session = { code: "ABCDEF", token: "player-a" };
  render(session);
  commit();
  const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  expect(render(session).room!.gameNo).toBe(1);
  socket.disconnect();
  expect(render(session).room!.gameNo).toBe(1);
  expect(render(session).connected).toBe(false);
  let synced!: (v: unknown) => void;
  socket.emitWithAck.mockImplementation(() => new Promise(resolve => { synced = resolve; }));
  socket.connect();
  expect(render(session).connectionPhase).toBe("syncing");
  expect(await render(session).send({ type: "send_message", to: "storyteller", content: "stale" })).toBe(false);
  socket.listeners.get("state")(room(2));
  expect(render(session).room!.gameNo).toBe(1);
  synced({ ok: true, room: room(2) });
  await Promise.resolve();
  expect(render(session).room!.gameNo).toBe(2);
  socket.listeners.get("state")(room(1));
  expect(render(session).room!.gameNo).toBe(2);
  expect(clearPlayerCache).toHaveBeenCalledWith(
    "ABCDEF",
    expect.objectContaining({ gameNo: 2 }),
  );
});

it("does not show the previous player's snapshot while switching sessions or accept callbacks from the old connection", () => {
  const a = { code: "ABCDEF", token: "player-a" },
    b = { code: "ABCDEF", token: "player-b" };
  render(a);
  commit();
  const oldCallback = harness.sockets[0].listeners.get("state");
  oldCallback(room(1));
  expect(render(a).room).not.toBeNull();
  expect(render(b).room).toBeNull();
  commit();
  oldCallback(room(1));
  expect(render(b).room).toBeNull();
  harness.sockets[1].listeners.get("state")({
    ...room(2),
    viewer: { kind: "player", seatId: "b" },
  });
  expect(render(b).room!.viewer.seatId).toBe("b");
  harness.sockets[1].listeners.get("session_revoked")();
  harness.sockets[1].listeners.get("state")(room(2));
  expect(render(b).room).toBeNull();
  expect(clearPlayerCache).toHaveBeenLastCalledWith("ABCDEF");
});

it("keeps a backgrounded page mounted, synchronizes before enabling actions, and preserves the newest packet during resync", async () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  const session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
  expect(render(session).room!.revision).toBe(10);
  expect(render(session).connected).toBe(false);
  expect(render(session).connectionPhase).toBe("background");
  expect(socket.emit).toHaveBeenCalledWith("visibility", false);
  let sync!: (v: unknown) => void;
  socket.emitWithAck.mockImplementation(() => new Promise(resolve => { sync = resolve; }));
  document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange"));
  expect(await render(session).send({ type: "send_message", to: "storyteller", content: "must not send" })).toBe(false);
  socket.listeners.get("state")({ ...room(2), revision: 25 });
  sync({ ok: true, room: room(2) }); await Promise.resolve();
  expect(render(session).room?.revision).toBe(25);
  expect(render(session).connected).toBe(true);
  expect(socket.emitWithAck.mock.calls.filter((x: any[]) => x[0] === "command")).toHaveLength(0);
});

it("checks a lost command acknowledgement after sync without replaying the action", async () => {
  const session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  socket.emitWithAck.mockImplementation(async (name: string) => {
    if (name === "command") throw Error("lost ack");
    if (name === "sync") return { ok: true, room: room(1) };
    if (name === "command_status") return { ok: true, applied: true };
  });
  await render(session).send({ type: "send_message", to: "storyteller", content: "once" });
  await Promise.resolve(); await Promise.resolve();
  expect(render(session).operationMessage).toContain("已经生效");
  expect(socket.emitWithAck.mock.calls.filter((x: any[]) => x[0] === "command")).toHaveLength(1);
  expect(socket.emitWithAck.mock.calls.some((x: any[]) => x[0] === "command_status")).toBe(true);
});

function lifecycle() {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  const saved = new Map<string, string>();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  return { document, window, saved, visibility: (value: string) => {
    document.visibilityState = value;
    document.dispatchEvent(new Event("visibilitychange"));
  } };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

it("reopens a stale transport after a long lock, keeps the latest round, and ignores a pre-lock sync reply", async () => {
  vi.useFakeTimers();
  const life = lifecycle(), session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  const replies: ((v: unknown) => void)[] = [];
  socket.emitWithAck.mockImplementation(() => new Promise(resolve => replies.push(resolve)));
  life.window.dispatchEvent(new Event("pageshow"));
  life.visibility("hidden");
  await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
  socket.listeners.get("state")(room(2));
  expect(render(session).room?.gameNo).toBe(1);
  life.visibility("visible");
  expect(replies).toHaveLength(2);
  expect(render(session).connected).toBe(false);
  replies[0]({ ok: true, room: room(1) }); await flush();
  expect(render(session).connected).toBe(false);
  replies[1]({ ok: true, room: room(2) }); await flush();
  expect(render(session).room?.gameNo).toBe(2);
  expect(render(session).connected).toBe(true);
});

it("does not unlock a hidden page when an earlier synchronization finishes", async () => {
  const life = lifecycle(), session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  let reply!: (v: unknown) => void;
  socket.emitWithAck.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  life.window.dispatchEvent(new Event("pageshow"));
  life.visibility("hidden");
  reply({ ok: true, room: room(2) }); await flush();
  expect(render(session).connectionPhase).toBe("background");
  expect(render(session).connected).toBe(false);
  expect(await render(session).send({ type: "send_message", to: "storyteller", content: "hidden" })).toBe(false);
});

it("recovers a failed synchronization and online event without enabling stale actions", async () => {
  vi.useFakeTimers();
  const life = lifecycle(), session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1)); socket.disconnect();
  socket.emitWithAck.mockRejectedValueOnce(new Error("sync timed out"))
    .mockResolvedValue({ ok: true, room: room(2) });
  expect(await render(session).send({ type: "send_message", to: "storyteller", content: "offline" })).toBe(false);
  life.window.dispatchEvent(new Event("online")); await flush();
  expect(render(session).room?.gameNo).toBe(2);
  expect(render(session).connected).toBe(true);
  expect(socket.emitWithAck.mock.calls.some((call: any[]) => call[0] === "command")).toBe(false);
});

it.each([true, false])("checks a persisted uncertain command after page reload (applied=%s) without resending", async (applied) => {
  const life = lifecycle(), session = { code: "ABCDEF", token: "player-a" };
  const key = `clocktower.pending:ABCDEF:player-a`;
  life.saved.set(key, JSON.stringify({ commandId: "uncertain-command", gameNo: 1 }));
  render(session); commit(); const socket = harness.sockets[0];
  socket.emitWithAck.mockImplementation(async (name: string) => name === "sync"
    ? { ok: true, room: room(2) } : { ok: true, applied });
  socket.connect(); await flush();
  expect(render(session).operationMessage).toContain(applied ? "已经生效" : "没有生效");
  expect(life.saved.has(key)).toBe(false);
  expect(socket.emitWithAck.mock.calls.map((call: any[]) => call[0])).toEqual(["sync", "command_status"]);
});

it("sends only one command for simultaneous taps and ignores acknowledgements after session revocation", async () => {
  lifecycle(); const session = { code: "ABCDEF", token: "player-a" };
  render(session); commit(); const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  let reply!: (v: unknown) => void;
  socket.emitWithAck.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  const command = { type: "send_message", to: "storyteller", content: "once" } as const;
  const first = render(session).send(command);
  expect(await render(session).send(command)).toBe(false);
  expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  socket.listeners.get("session_revoked")();
  reply({ ok: true });
  await first;
  expect(render(session).room).toBeNull();
  expect(render(session).connected).toBe(false);
  expect(render(session).revoked).toBe(true);
});

it("automatically retries a lost receipt lookup after reconnection without replaying the command", async () => {
  vi.useFakeTimers();
  const life = lifecycle(), session = { code: "ABCDEF", token: "player-a" };
  life.saved.set("clocktower.pending:ABCDEF:player-a", JSON.stringify({ commandId: "uncertain", gameNo: 1 }));
  render(session); commit(); const socket = harness.sockets[0];
  let lookups = 0;
  socket.emitWithAck.mockImplementation(async (name: string) => {
    if (name === "sync") return { ok: true, room: room(1) };
    if (++lookups === 1) throw Error("receipt acknowledgement lost");
    return { ok: true, applied: true };
  });
  socket.connect(); await flush();
  expect(render(session).operationMessage).toContain("上次操作还没确认");
  await vi.advanceTimersByTimeAsync(4000);
  expect(render(session).operationMessage).toContain("已经生效");
  expect(lookups).toBe(2);
  expect(socket.emitWithAck.mock.calls.some((call: any[]) => call[0] === "command")).toBe(false);
});
