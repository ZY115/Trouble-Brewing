import { commandWithContext } from "../shared/command-context";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Command } from "../shared/commands";
import type { RoomView, Session } from "../shared/types";
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
  useEffect(() => {
    setRoom(null);
    setRevoked(false);
    setError("");
    setConnected(false);
    if (!session) return;
    const socket = io({ auth: session, reconnection: true });
    socketRef.current = socket;
    socket.on("session_revoked", () => {
      setRevoked(true);
      setRoom(null);
      socket.disconnect();
    });
    socket.on("state", (state: RoomView) => setRoom(state));
    socket.on("connect", () => {
      setConnected(true);
      setError("");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => {
      if (e.message === "会话无效") {
        setRevoked(true);
        setRoom(null);
        socket.disconnect();
      } else setError("连接中断，正在尝试重连…");
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);
  async function send(command: Command) {
    if (!socketRef.current?.connected) {
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
      try {
        const response = await socketRef.current
          .timeout(5000)
          .emitWithAck("command", envelope);
        if (!response.ok) {
          setError(response.error);
          return false;
        }
        return true;
      } catch {
        if (attempt === 0) socketRef.current?.disconnect().connect();
        if (attempt === 1) setError("尚未收到确认，请查看重连后的状态再操作");
      }
    }
    return false;
  }
  return { room, connected, error, setError, send, revoked };
}
export type Send = (command: Command) => Promise<boolean>;
