import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoomView, Session } from "../shared/types";

const harness = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[], sockets: [] as any[] }));
vi.mock("react", () => ({
  useState: (initial: any) => {
    const i = harness.index++;
    if (!(i in harness.slots)) harness.slots[i] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[i], (value: any) => { harness.slots[i] = typeof value === "function" ? value(harness.slots[i]) : value; }];
  },
  useRef: (initial: any) => harness.slots[harness.index++] ??= { current: initial },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = harness.index++, previous = harness.slots[i];
    if (previous && deps.every((value, at) => value === previous.deps[at])) return;
    harness.effects.push(() => { previous?.cleanup?.(); harness.slots[i] = { deps, cleanup: effect() }; });
  },
}));
vi.mock("../src/localState", () => ({
  clearPlayerCache: vi.fn(), localScope: (room: RoomView) => `${room.code}:${room.gameNo}:${room.viewer.seatId}:${room.playId}`,
}));
vi.mock("socket.io-client", () => ({
  io: () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const socket = {
      connected: true, listeners, emit: vi.fn(), emitWithAck: vi.fn(),
      timeout: () => socket,
      on: (name: string, callback: (...args: any[]) => void) => listeners.set(name, callback),
      connect: () => { socket.connected = true; listeners.get("connect")?.(); return socket; },
      disconnect: () => { socket.connected = false; listeners.get("disconnect")?.(); return socket; },
      removeAllListeners: () => listeners.clear(),
    };
    harness.sockets.push(socket);
    return socket;
  },
}));
import { useRoom } from "../src/useRoom";

const room = {
  code: "ABCDEF", gameNo: 1, revision: 10, playId: "play-one", phase: "FIRST_NIGHT",
  viewer: { kind: "player", seatId: "player-one" }, actions: [], messages: [], notebook: [],
} as unknown as RoomView;
const session: Session = { code: room.code, token: "player-token" };
const render = (identity: Session = session) => { harness.index = 0; return useRoom(identity); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  harness.slots = []; harness.index = 0; harness.effects = []; harness.sockets = [];
  const storage = new Map<string, string>([[`clocktower.pending:${session.code}:${session.token.slice(0, 12)}`, JSON.stringify({ commandId: "pending-receipt", gameNo: 1 })]]);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  harness.slots.forEach((slot) => slot?.cleanup?.());
  vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers();
});

async function fixture() {
  render(); harness.effects.splice(0).forEach((effect) => effect());
  const socket = harness.sockets[0];
  const requests: { resolve: (value: unknown) => void; reject: (error?: unknown) => void }[] = [];
  socket.emitWithAck.mockImplementation((name: string) => name === "sync"
    ? Promise.resolve({ ok: true, room })
    : new Promise((resolve, reject) => requests.push({ resolve, reject })));
  socket.listeners.get("connect")(); await flush();
  expect(render().connected).toBe(true);
  expect(requests).toHaveLength(1);
  return { socket, requests };
}

it("shares one receipt query across repeated recovery events and pending-operation clicks", async () => {
  const { socket, requests } = await fixture();
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("pageshow"));
  const attempts = [render().send({ type: "save_note", note: "a" }), render().send({ type: "save_note", note: "b" })];
  await flush();
  const requestCount = requests.length;
  requests.forEach(({ resolve }) => resolve({ ok: true, applied: true }));
  await Promise.all(attempts); await flush();
  expect(requestCount).toBe(1);
  expect(socket.emitWithAck.mock.calls.filter(([name]: [string]) => name === "command")).toHaveLength(0);
  expect(sessionStorage.getItem(`clocktower.pending:${session.code}:${session.token.slice(0, 12)}`)).toBeNull();
});

it("schedules only one retry after overlapping receipt failures and clears it on hide", async () => {
  const { requests } = await fixture();
  const attempts = [render().send({ type: "save_note", note: "a" }), render().send({ type: "save_note", note: "b" })];
  await flush();
  requests.forEach(({ reject }) => reject(new Error("temporary receipt failure")));
  await Promise.all(attempts); await flush();
  const timers = vi.getTimerCount();
  Object.assign(document, { visibilityState: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(timers).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10000);
  expect(requests).toHaveLength(1);
});

it("ignores a previous session's outstanding receipt result and creates no retry after cleanup", async () => {
  const { requests } = await fixture();
  const other = { code: room.code, token: "other-player" };
  render(other); harness.effects.splice(0).forEach((effect) => effect());
  requests[0].reject(new Error("old request failed")); await flush();
  expect(render(other).operationMessage).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});

it("releases a query cancelled before its microtask starts so returning to the page can check again", async () => {
  render(); harness.effects.splice(0).forEach((effect) => effect());
  const socket = harness.sockets[0];
  let receiptReply!: (value: unknown) => void;
  socket.emitWithAck.mockImplementation((name: string) => name === "sync"
    ? Promise.resolve({ ok: true, room })
    : new Promise((resolve) => { receiptReply = resolve; }));
  socket.listeners.get("state")(room);
  const attempt = render().send({ type: "save_note", note: "not sent" });
  Object.assign(document, { visibilityState: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  await attempt; await flush();
  expect(socket.emitWithAck).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  Object.assign(document, { visibilityState: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(socket.emitWithAck.mock.calls.filter(([name]: [string]) => name === "command_status")).toHaveLength(1);
  receiptReply({ ok: true, applied: true }); await flush();
  expect(render().operationMessage).toContain("已经生效");
  expect(socket.emitWithAck.mock.calls.filter(([name]: [string]) => name === "command")).toHaveLength(0);
});
