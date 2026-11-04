import { beforeEach, expect, it, vi } from "vitest";
import type { RoomView, Session } from "../shared/types";

// Drive the hook's socket/effect boundary without a browser or real network.
const harness = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  sockets: [] as any[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = harness.index++;
    if (!(i in harness.slots)) harness.slots[i] = initial;
    return [
      harness.slots[i],
      (value: unknown) => {
        harness.slots[i] = value;
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
      on: (name: string, fn: (...args: any[]) => void) =>
        listeners.set(name, fn),
      disconnect: () => {
        socket.connected = false;
        listeners.get("disconnect")?.();
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

it("hides disconnected snapshots until an authoritative state arrives and ignores delayed old-round packets", () => {
  const session = { code: "ABCDEF", token: "player-a" };
  render(session);
  commit();
  const socket = harness.sockets[0];
  socket.listeners.get("state")(room(1));
  expect(render(session).room!.gameNo).toBe(1);
  socket.disconnect();
  expect(render(session).room).toBeNull();
  socket.listeners.get("connect")();
  expect(render(session).room).toBeNull();
  socket.listeners.get("state")(room(2));
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
  expect(render(b).room).toBeNull(); // Before effects have run.
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
