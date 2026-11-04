import { lazy, Suspense, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type { RoomView, Session } from "../shared/types";
import { useRoom, type Send } from "./useRoom";
import Entry from "./components/Entry";
import { useJoinLink } from "./components/Invitation";
import { loadSession, saveSession, forgetSession, debugSeatId } from "./session";
import DebugEntry from "./components/DebugEntry";
const StorytellerApp = lazy(() => import("./storyteller/StorytellerApp"));
const PlayerApp = lazy(() => import("./player/PlayerApp"));
const DebugWorkbench = lazy(() => import("./debug/Workbench"));

function Brand() {
  return (
    <span className="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <strong>暗流涌动</strong>
    </span>
  );
}

/** Join QR only: safe to turn the tablet towards the players. */
function ScanOnly({
  room,
  send,
  error,
  onBack,
}: {
  room: RoomView;
  send: Send;
  error: string;
  onBack: () => void;
}) {
  const { link } = useJoinLink(room);
  const lobby = ["LOBBY", "SETUP"].includes(room.phase);
  return (
    <main className="scan-only">
      <Brand />
      <div className="qr-box">
        <QRCode value={link} size={260} fgColor="#17140d" bgColor="#ece6da" />
      </div>
      <span className="room-code">{room.code}</span>
      <p className="muted">
        扫码后只填自己的座位号 · {room.seats.length} / {room.capacity} 人已登记 ·{" "}
        {room.registration.open ? "等待号码填写完成" : lobby ? "尚未开放入场" : "本局已开始"}
      </p>
      {error && (
        <p role="alert" className="error">
          无法完成操作，请返回说书人界面检查设置。
        </p>
      )}
      <div className="action-buttons" style={{ justifyContent: "center" }}>
        {lobby && (
          <button
            onClick={() =>
              void send({ type: room.registration.open ? "close_registration" : "open_registration" })
            }
          >
            {room.registration.open ? "暂停入场" : "确认配板并开放入场"}
          </button>
        )}
        <button onClick={onBack}>返回说书人界面</button>
      </div>
    </main>
  );
}

export default function App() {
  if (location.pathname === "/debug") return <Suspense fallback={<p>正在打开调试台…</p>}><DebugWorkbench /></Suspense>;
  return <GameApp />;
}

function GameApp() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [scanRoom, setScanRoom] = useState(
    () => sessionStorage.getItem("clocktower.scanRoom") ?? "",
  );
  function scan(code: string) {
    sessionStorage.setItem("clocktower.scanRoom", code);
    setScanRoom(code);
  }
  const { room, connected, error, setError, send, revoked } = useRoom(session);
  useEffect(() => {
    if (revoked) {
      if (session) forgetSession(session);
      setSession(null);
    }
  }, [revoked]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [session]);
  function enter(next: Session) {
    saveSession(next);
    setSession(next);
  }
  const leave = () => debugSeatId ? location.assign("/host") : setSession(null);
  if (!session) return debugSeatId ? <DebugEntry onSession={enter} /> : <Entry onSession={enter} />;
  if (!room)
    return (
      <div className="loading">
        <Brand />
        <p>{error || "正在连接房间…"}</p>
        <button onClick={leave}>返回入口</button>
      </div>
    );
  const loading = (
    <div className="loading">
      <Brand />
      <p>正在载入…</p>
    </div>
  );
  if (room.storyteller) {
    if (scanRoom === room.code)
      return <ScanOnly room={room} send={send} error={error} onBack={() => scan("")} />;
    return (
      <Suspense fallback={loading}>
        <StorytellerApp
          key={`${room.code}-${room.gameNo}`}
          room={room}
          send={send}
          session={session}
          connected={connected}
          error={error}
          setError={setError}
          onLeave={leave}
          onScan={() => scan(room.code)}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={loading}>
      {debugSeatId && <div className="notice" style={{ margin: "8px 16px" }}>
        单人调试 · {room.seats.find((s) => s.id === room.viewer.seatId)?.number} 号玩家
        <a href="/host">返回说书人</a>
      </div>}
      <PlayerApp
        key={`${room.code}-${room.gameNo}-${room.viewer.seatId}-${room.playId ?? "waiting"}`}
        room={room}
        send={send}
        connected={connected}
        error={error}
        setError={setError}
        onLeave={leave}
      />
    </Suspense>
  );
}
