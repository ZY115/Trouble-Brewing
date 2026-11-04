import type { Session } from "../shared/types";
export const joinCode = (
  location.pathname.match(/^\/join\/([A-Za-z2-9]{6})\/?$/)?.[1] ??
  new URLSearchParams(location.search).get("room") ??
  ""
).toUpperCase();
export const isHostEntry =
  location.pathname === "/host" || location.pathname === "/host/";
export const debugSeatId =
  !isHostEntry && joinCode
    ? (new URLSearchParams(location.search).get("debugSeat") ?? "")
    : "";
export const sessionKey = isHostEntry
  ? "clocktower.host.v2"
  : debugSeatId
    ? `clocktower.debug.player.${joinCode}.${debugSeatId}`
    : `clocktower.player.${joinCode}`;
export function hostSessions(): Session[] {
  try {
    const cached = JSON.parse(
      localStorage.getItem("clocktower.host.rooms.v3") ?? "{}",
    ) as Record<string, Session>;
    const legacy = JSON.parse(
      localStorage.getItem("clocktower.host.v2") ?? "null",
    );
    if (legacy?.code && legacy?.token) cached[legacy.code] = legacy;
    return Object.values(cached).filter(
      (s) => /^[A-Z2-9]{6}$/.test(s.code) && typeof s.token === "string",
    );
  } catch {
    return [];
  }
}
export function saveSession(s: Session) {
  if (isHostEntry) {
    const saved = Object.fromEntries(hostSessions().map((x) => [x.code, x]));
    saved[s.code] = s;
    localStorage.setItem("clocktower.host.rooms.v3", JSON.stringify(saved));
  }
  localStorage.setItem(sessionKey, JSON.stringify(s));
}
export function forgetSession(s: Session) {
  if (isHostEntry) {
    const saved = Object.fromEntries(
      hostSessions()
        .filter((x) => x.code !== s.code)
        .map((x) => [x.code, x]),
    );
    localStorage.setItem("clocktower.host.rooms.v3", JSON.stringify(saved));
  }
  localStorage.removeItem(sessionKey);
}
export function loadSession(): Session | null {
  if (isHostEntry && joinCode) return hostSessions().find(s => s.code === joinCode) ?? null;
  if (new URLSearchParams(location.hash.slice(1)).has("recover")) return null;
  if (!isHostEntry && !joinCode) return null;
  try {
    const value = JSON.parse(localStorage.getItem(sessionKey) ?? "null");
    return value?.code &&
      value?.token &&
      (isHostEntry || value.code === joinCode)
      ? value
      : null;
  } catch {
    return null;
  }
}
