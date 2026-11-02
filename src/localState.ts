import { useMemo, useSyncExternalStore } from "react";
import type { RoomView } from "../shared/types";

const fallback = new Map<string, string | null>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function read(key: string) {
  if (fallback.has(key)) return fallback.get(key) ?? null;
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
export const localKey = (room: RoomView, name: string) =>
  `clocktower.local:${room.code}:${room.gameNo}:${room?.viewer.seatId ?? "host"}:${name}`;

/** Drafts and read markers stay in this browser tab, never in room state or host logs. */
export function useLocalState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((previous: T) => T)) => void, () => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key));
  const value = useMemo(() => parse(raw, initial), [raw, initial]);
  const put = (next: string | null) => {
    if (read(key) === next) return;
    fallback.set(key, next);
    try {
      if (next === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, next);
    } catch {
      /* in-memory fallback */
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
