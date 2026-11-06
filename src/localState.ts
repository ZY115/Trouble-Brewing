import { useMemo, useSyncExternalStore } from "react";
import type { RoomView } from "../shared/types";

const fallback = new Map<string, string | null>();
const debugFrame = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("debugEmbed") === "1" &&
  !!new URLSearchParams(location.search).get("debugSeat");
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function read(key: string) {
  if (obsolete(key)) return null;
  if (fallback.has(key)) return fallback.get(key) ?? null;
  if (debugFrame) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function parse<T>(raw: string | null, initial: T): T {
  try {
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}
export const localScope = (room: RoomView) =>
  `clocktower.local:${room.code}:${room.gameNo}:${room.viewer.seatId ?? "host"}${room.playId ? `:play:${room.playId}` : ""}:`;
export const localKey = (room: RoomView, name: string) =>
  localScope(room) + name;
const activePlayerScopes = new Map<string, string | null>();
function obsolete(key: string) {
  const parts = key.split(":");
  return (
    parts[0] === "clocktower.local" &&
    parts[3] !== "host" &&
    activePlayerScopes.has(parts[1]) &&
    !key.startsWith(activePlayerScopes.get(parts[1]) ?? "\0")
  );
}

export function clearPlayerCache(code: string, current?: RoomView) {
  activePlayerScopes.set(code, current ? localScope(current) : null);
  const stale = (key: string) =>
    key.startsWith(`clocktower.verdicts:${code}:`) ||
    (key.startsWith(`clocktower.local:${code}:`) && obsolete(key));
  for (const key of fallback.keys()) if (stale(key)) fallback.set(key, null);
  for (const getStorage of debugFrame ? [] : [() => sessionStorage, () => localStorage]) {
    try {
      const storage = getStorage();
      const keys = Array.from({ length: storage.length }, (_, i) =>
        storage.key(i),
      );
      for (const key of keys)
        if (key && stale(key)) {
          fallback.set(key, null);
          try {
            storage.removeItem(key);
          } catch {
          }
        }
    } catch {
    }
  }
  listeners.forEach((fn) => fn());
}

export function useLocalState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((previous: T) => T)) => void, () => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key));
  const value = useMemo(() => parse(raw, initial), [raw, initial]);
  const put = (next: string | null) => {
    if (obsolete(key)) return;
    if (read(key) === next) return;
    fallback.set(key, next);
    try {
      if (!debugFrame) {
        if (next === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, next);
      }
    } catch {
    }
    listeners.forEach((fn) => fn());
  };
  return [
    value,
    (next) =>
      put(
        JSON.stringify(
          typeof next === "function"
            ? (next as (v: T) => T)(parse(read(key), initial))
            : next,
        ),
      ),
    () => put(null),
  ];
}

export function useUnread(room: RoomView | null) {
  const [seen, setSeen] = useLocalState<Record<string, number>>(
    room ? localKey(room, "read") : "clocktower.local:none",
    {},
  );
  const me = room?.viewer.seatId ?? "storyteller";
  const messages = (room?.messages ?? []).filter(
    (m) => m.from !== me && !seen[`m:${m.id}`],
  );
  const actions = room?.storyteller
    ? []
    : (room?.actions ?? []).filter(
        (a) =>
          a.status === "DELIVERED" &&
          (seen[`a:${a.id}`] ?? 0) < (a.responseVersion ?? 1),
      );
  const markMessages = (ids: string[]) =>
    setSeen((old) => ({
      ...old,
      ...Object.fromEntries(ids.map((id) => [`m:${id}`, 1])),
    }));
  const markActions = () =>
    setSeen((old) => ({
      ...old,
      ...Object.fromEntries(
        (room?.actions ?? [])
          .filter((a) => a.status === "DELIVERED")
          .map((a) => [`a:${a.id}`, a.responseVersion ?? 1]),
      ),
    }));
  const contactCount = (id: string) =>
    messages.filter((m) =>
      id === "evil" || id.startsWith("group:") ? m.to === id : m.from === id,
    ).length;
  return { messages, actions, markMessages, markActions, contactCount };
}
