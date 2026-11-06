import { commandWithContext } from "../shared/command-context";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Command } from "../shared/commands";
import type { RoomView, Session } from "../shared/types";
import { clearPlayerCache, localScope } from "./localState";
import { acceptRoomState, currentPlayerState } from "./roomState";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "请求失败");
  return value;
}
export type ConnectionPhase = "connecting" | "reconnecting" | "syncing" | "ready" | "background";
export const connectionLabels: Record<ConnectionPhase, string> = {
  connecting: "正在连接房间…", reconnecting: "连接已中断，正在重连…",
  syncing: "已连接，正在同步最新对局…", ready: "已同步，可以继续操作",
  background: "页面在后台，回来后会自动同步…",
};
export function useRoom(session: Session | null) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("connecting");
  const [operationMessage, setOperationMessage] = useState("");
  const [error, setError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const owner = useRef<Session | null>(null);
  const latest = useRef<RoomView | null>(null);
  const ready = useRef(false);
  const sending = useRef(false);
  const pending = useRef<{ commandId: string; gameNo?: number } | null>(null);
  const retryRef = useRef<() => void>(() => {});
  const resolvePending = useRef<() => Promise<void>>(async () => {});
  const pendingKey = session ? `clocktower.pending:${session.code}:${session.token.slice(0, 12)}` : "";
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flash(message: string, ms = 4000) {
    clearTimeout(flashTimer.current);
    setOperationMessage(message);
    flashTimer.current = setTimeout(() => setOperationMessage((m) => (m === message ? "" : m)), ms);
  }
  function persistPending(value: typeof pending.current) {
    pending.current = value;
    try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch {}
  }
  useEffect(() => {
    owner.current = session; latest.current = null; ready.current = false;
    setRoom(null); setRevoked(false); setError(""); setConnected(false);
    setConnectionPhase("connecting"); setOperationMessage(""); clearTimeout(flashTimer.current); pending.current = null; sending.current = false;
    if (!session) return;
    try {
      const old = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      if (typeof old?.commandId === "string") pending.current = old;
    } catch {}
    const socket = io({ auth: session, reconnection: true });
    let active = true, generation = 0, syncing = false;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let receiptTimer: ReturnType<typeof setTimeout> | undefined;
    let receiptFlight: { commandId: string; promise: Promise<void> } | undefined;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    socketRef.current = socket;
    const phase = (value: ConnectionPhase) => { setConnectionPhase(value); ready.current = value === "ready"; setConnected(ready.current); };
    const revoke = () => {
      if (!active) return;
      active = false; generation++; clearTimeout(syncTimer); clearTimeout(receiptTimer);
      clearPlayerCache(session.code); persistPending(null);
      setRevoked(true); phase("reconnecting"); setRoom(null); socket.disconnect();
    };
    const receive = (incoming: RoomView) => {
      if (!active || !acceptRoomState(latest.current, incoming, session.code)) return;
      const state = currentPlayerState(incoming);
      if (state.viewer.kind === "player" && (!latest.current || localScope(latest.current) !== localScope(state))) {
        clearPlayerCache(session.code, state); setError("");
      }
      latest.current = state;
      socket.emit("state_ack", { gameNo: state.gameNo, revision: state.revision });
      if (visible() && !syncing) { setRoom(state); phase("ready"); }
    };
    const checkPending = async () => {
      clearTimeout(receiptTimer);
      const receipt = pending.current;
      if (!receipt || !active || !socket.connected || !visible()) return;
      if (receiptFlight?.commandId === receipt.commandId) return receiptFlight.promise;
      const flight = { commandId: receipt.commandId, promise: Promise.resolve() };
      receiptFlight = flight;
      flight.promise = Promise.resolve().then(async () => {
        try {
          if (!active || pending.current?.commandId !== receipt.commandId || !socket.connected || !visible()) return;
          const result = await socket.timeout(5000).emitWithAck("command_status", { commandId: receipt.commandId });
          if (!active || pending.current?.commandId !== receipt.commandId) return;
          if (!result.ok) throw Error();
          persistPending(null);
          if (result.applied) flash("刚才的操作已经生效。");
          else flash("刚才的操作没有生效，请看清当前情况再操作。", 8000);
        } catch {
          if (!active || pending.current?.commandId !== receipt.commandId) return;
          setOperationMessage("上次操作还没确认，连上后会自动检查，先别重复点。");
          clearTimeout(receiptTimer);
          if (socket.connected && visible()) receiptTimer = setTimeout(() => void checkPending(), 3000);
        } finally {
          if (receiptFlight === flight) receiptFlight = undefined;
        }
      });
      return flight.promise;
    };
    resolvePending.current = checkPending;
    const synchronize = async () => {
      if (!active || !visible()) return;
      clearTimeout(syncTimer);
      if (!socket.connected) { phase("reconnecting"); socket.connect(); return; }
      const request = ++generation;
      syncing = true; phase("syncing");
      socket.emit("visibility", true);
      try {
        const result = await socket.timeout(2500).emitWithAck("sync");
        if (!active || request !== generation || !visible()) return;
        if (!result.ok) { revoke(); return; }
        receive(result.room);
        syncing = false;
        setRoom(latest.current); phase("ready"); setError("");
        await checkPending();
      } catch {
        if (!active || request !== generation) return;
        phase("reconnecting");
        socket.disconnect().connect();
        syncTimer = setTimeout(() => void synchronize(), 4000);
      }
    };
    retryRef.current = () => { if (socket.connected) void synchronize(); else socket.connect(); };
    let hiddenAt = 0;
    const visibility = () => {
      if (!active) return;
      if (!visible()) {
        hiddenAt = Date.now();
        generation++; syncing = true; clearTimeout(syncTimer); clearTimeout(receiptTimer);
        phase("background");
        if (socket.connected) socket.emit("visibility", false);
      } else if (hiddenAt && Date.now() - hiddenAt > 10000 && socket.connected) {
        hiddenAt = 0;
        phase("reconnecting");
        socket.disconnect().connect();
      } else {
        hiddenAt = 0;
        void synchronize();
      }
    };
    socket.on("session_revoked", revoke);
    socket.on("state", receive);
    socket.on("connect", () => { if (!active) return; if (visible()) void synchronize(); else visibility(); });
    socket.on("disconnect", () => {
      if (!active) return;
      generation++; syncing = true; clearTimeout(syncTimer); clearTimeout(receiptTimer);
      phase(visible() ? "reconnecting" : "background");
    });
    socket.on("connect_error", (e) => {
      if (!active) return;
      if (e.message === "会话无效") revoke();
      else { phase("reconnecting"); setError(""); }
    });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
    if (typeof window !== "undefined") {
      window.addEventListener("online", retryRef.current);
      window.addEventListener("pageshow", retryRef.current);
    }
    return () => {
      active = false; generation++; ready.current = false; clearTimeout(syncTimer); clearTimeout(receiptTimer); clearTimeout(flashTimer.current);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", retryRef.current);
        window.removeEventListener("pageshow", retryRef.current);
      }
      socket.removeAllListeners(); socket.disconnect(); socketRef.current = null;
    };
  }, [session]);
  async function send(command: Command) {
    const socket = socketRef.current;
    const current = () => owner.current === session && !!room &&
      latest.current?.gameNo === room.gameNo && latest.current?.playId === room.playId && socketRef.current === socket;
    if (!socket?.connected || !ready.current || !current()) {
      setError("还没同步好，连上后再操作"); return false;
    }
    if (sending.current) { flash("正在发送，请稍候。", 2000); return false; }
    if (pending.current) { setOperationMessage("正在核实上一次操作，请稍候。"); await resolvePending.current(); return false; }
    setError(""); clearTimeout(flashTimer.current); setOperationMessage("");
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const commandId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    persistPending({ commandId, gameNo: room?.gameNo });
    sending.current = true;
    try {
      const response = await socket.timeout(5000).emitWithAck("command", {
        commandId, command: commandWithContext(command, room!), gameNo: room?.gameNo,
      });
      if (owner.current !== session || socketRef.current !== socket) return false;
      persistPending(null);
      if (!response.ok) { setError(response.error); return false; }
      return true;
    } catch {
      if (owner.current !== session || socketRef.current !== socket) return false;
      setOperationMessage("还没收到确认，正在核实，先别重复点。");
      retryRef.current();
      return false;
    } finally { if (owner.current === session) sending.current = false; }
  }
  return { room: owner.current === session ? room : null, connected, connectionPhase,
    operationMessage, retryConnection: () => retryRef.current(), error, setError, send, revoked };
}
export type Send = (command: Command) => Promise<boolean>;
