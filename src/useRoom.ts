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
export function useRoom(session: Session | null) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const owner = useRef<Session | null>(null);
  const latest = useRef<RoomView | null>(null);
  useEffect(() => {
    owner.current = session;
    latest.current = null;
    setRoom(null);
    setRevoked(false);
    setError("");
    setConnected(false);
    if (!session) return;
    const socket = io({ auth: session, reconnection: true });
    let active = true;
    socketRef.current = socket;
    const revoke = () => {
      if (!active) return;
      active = false;
      clearPlayerCache(session.code);
      setRevoked(true);
      setConnected(false);
      setRoom(null);
      socket.disconnect();
    };
    socket.on("session_revoked", revoke);
    socket.on("state", (incoming: RoomView) => {
      if (!active || !acceptRoomState(latest.current, incoming, session.code))
        return;
      const state = currentPlayerState(incoming);
      if (
        state.viewer.kind === "player" &&
        (!latest.current || localScope(latest.current) !== localScope(state))
      ) {
        clearPlayerCache(state.code, state);
        setError("");
      }
      latest.current = state;
      setRoom(state);
    });
    socket.on("connect", () => {
      if (!active) return;
      setConnected(true);
      setError("");
    });
    socket.on("disconnect", () => {
      if (!active) return;
      setConnected(false);
      setRoom(null);
    });
    socket.on("connect_error", (e) => {
      if (!active) return;
      if (e.message === "会话无效") {
        revoke();
      } else setError("连接中断，正在尝试重连…");
    });
    return () => {
      active = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);
  async function send(command: Command) {
    const socket = socketRef.current;
    const current = () =>
      owner.current === session &&
      !!room &&
      latest.current?.gameNo === room.gameNo &&
      latest.current?.playId === room.playId &&
      socketRef.current === socket;
    if (!socket?.connected || !current()) {
      setError("连接中断，请重连后再操作");
      return false;
    }
    setError("");
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const commandId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const envelope = {
      commandId,
      command: room ? commandWithContext(command, room) : command,
      gameNo: room?.gameNo,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!current()) return false;
      try {
        const response = await socket
          .timeout(5000)
          .emitWithAck("command", envelope);
        if (owner.current !== session || socketRef.current !== socket)
          return false;
        if (!current()) return response.ok === true;
        if (!response.ok) {
          setError(response.error);
          return false;
        }
        return true;
      } catch {
        if (!current()) return false;
        if (attempt === 0) socket.disconnect().connect();
        if (attempt === 1) setError("尚未收到确认，请查看重连后的状态再操作");
      }
    }
    return false;
  }
  return {
    room: owner.current === session ? room : null,
    connected,
    error,
    setError,
    send,
    revoked,
  };
}
export type Send = (command: Command) => Promise<boolean>;
