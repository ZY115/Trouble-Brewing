import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { RoomView } from "../../shared/types";
import { roleById, roleName, TEAM_NAMES } from "../../shared/roles";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import Registration from "../components/Registration";
import SeatChanges from "../components/SeatChanges";
import HoldReveal from "./HoldReveal";
import PlayerNight from "./PlayerNight";
import { PlayerVote, PublicCircle, TodayList } from "./PlayerDay";
import { isNight, visibleRoom } from "./visibility";
import InformationHistory, { MyInfo } from "./InformationHistory";
import PlayerRecords from "./PlayerRecords";
const ChatPanel = lazy(() => import("../components/ChatPanel"));
const NotebookPanel = lazy(() => import("../components/NotebookPanel"));

type SheetId = "" | "chat" | "notes" | "records" | "menu" | "information";

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-head">
        <button
          className="icon-button ghost"
          aria-label="返回"
          onClick={onClose}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <b>{title}</b>
        <span style={{ width: 44 }} />
      </div>
      <div className="sheet-body">
        <Suspense fallback={<p className="muted">加载中…</p>}>
          {children}
        </Suspense>
      </div>
    </div>
  );
}

function Identity({ room }: { room: RoomView }) {
  const role = roleById(room.self?.perceivedRoleId ?? "");
  if (!role) return <span className="pl-small">身份尚未发放。</span>;
  const num = (id: string) => room.seats.find((s) => s.id === id)?.number;
  return (
    <>
      <span className="pl-small">{TEAM_NAMES[role.team]}</span>
      <span className="role-name">{role.name}</span>
      <span className="pl-small">{role.hint}</span>
      {room.evilEnabled && room.evilMembers && (
        <span className="pl-small">
          邪恶阵营：{room.evilMembers.map((id) => `${num(id)} 号`).join("、")}
        </span>
      )}
      {room.self?.bluffs && (
        <span className="pl-small">
          不在场的善良角色：{room.self.bluffs.map(roleName).join("、")}
        </span>
      )}
    </>
  );
}

export default function PlayerApp({
  room,
  send,
  connected,
  error,
  setError,
  onLeave,
}: {
  room: RoomView;
  send: Send;
  connected: boolean;
  error: string;
  setError: (v: string) => void;
  onLeave: () => void;
}) {
  const [sheet, setSheet] = useState<SheetId>("");
  useEffect(() => {
    if (sheet !== "information") return;
    const hide = () => setSheet("");
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sheet]);
  const view = visibleRoom(room);
  const unread = useUnread(view);
  const me = room.seats.find((s) => s.id === room.viewer.seatId);
  const night = isNight(room);
  const lobby = room.phase === "LOBBY" || room.phase === "SETUP";
  const voting =
    !!room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status);
  const phase = lobby
    ? "等待入座"
    : room.phase === "ENDED"
      ? "本局已结束"
      : night
        ? room.day === 1
          ? "首夜"
          : `第 ${room.day} 夜`
        : `第 ${room.day} 天`;
  // Counts stay hidden at night: a badge appearing on one phone is a tell.
  const chatCount = night ? 0 : unread.messages.length;
  return (
    <div className="pl-shell">
      <header className="pl-top">
        <span>{phase}</span>
        <span>· {me?.number ?? "?"} 号</span>
        <span className="spacer" />
        {!connected && <span>重新连接中</span>}
        <button
          className="icon-button ghost"
          aria-label="菜单"
          onClick={() => setSheet("menu")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>
      <main className="pl-main">
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {lobby && (
          <>
            <span className="pl-title">等待入座</span>
            <Registration room={room} send={send} />
            <span className="pl-small">
              号码齐全且不重复时，所有人同时收到身份。
            </span>
          </>
        )}
        {night && (
          <>
            <span className="pl-title">夜晚</span>
            <PlayerNight room={room} send={send} />
          </>
        )}
        {room.phase === "DAY" && (
          <>
            {voting && (
              <PlayerVote key={room.liveVote!.id} room={room} send={send} />
            )}
            <PublicCircle room={room} />
            <TodayList room={room} />
          </>
        )}
        {room.phase === "ENDED" && (
          <>
            <span className="pl-title">本局已结束</span>
            <PublicCircle room={room} />
            <SeatChanges room={room} send={send} />
          </>
        )}
        {!lobby && (
          <>
            <span style={{ flex: 1 }} />
            <HoldReveal label="按住查看身份">
              <Identity room={room} />
            </HoldReveal>
            <HoldReveal label="按住查看我收到的信息">
              <MyInfo room={room} />
            </HoldReveal>
          </>
        )}
      </main>
      <nav className="pl-quiet" aria-label="其他">
        <button onClick={() => setSheet("chat")}>
          私聊{chatCount ? <span className="count"> · {chatCount}</span> : null}
        </button>
        <button onClick={() => setSheet("notes")}>笔记</button>
        <button onClick={() => setSheet("records")}>记录</button>
      </nav>
      {sheet === "chat" && (
        <Sheet title="私聊" onClose={() => setSheet("")}>
          <ChatPanel room={view} send={send} />
        </Sheet>
      )}
      {sheet === "notes" && (
        <Sheet title="我的笔记" onClose={() => setSheet("")}>
          <NotebookPanel room={room} send={send} />
        </Sheet>
      )}
      {sheet === "records" && (
        <Sheet title="公开记录" onClose={() => setSheet("")}>
          <PlayerRecords room={room} />
        </Sheet>
      )}
      {sheet === "information" && (
        <Sheet title="我的信息记录" onClose={() => setSheet("")}>
          <InformationHistory room={room} />
        </Sheet>
      )}
      {sheet === "menu" && (
        <Sheet title="菜单" onClose={() => setSheet("")}>
          <div className="pl-card">
            <span className="pl-small">
              房间 {room.code} · 第 {room.gameNo} 局 · 你是 {me?.number} 号
            </span>
            <span className="pl-small">
              这个界面刻意保持安静：不震动、不出声、不闪烁。夜间裁定在天亮后查看；私聊即时送达，未读提示只在白天显示。
            </span>
          </div>
          {!lobby && (
            <button onClick={() => setSheet("information")}>
              查看完整信息记录
            </button>
          )}
          {!lobby && room.phase !== "ENDED" ? null : (
            <SeatChanges room={room} send={send} />
          )}
          <button onClick={onLeave}>返回入口（保留本机身份）</button>
        </Sheet>
      )}
    </div>
  );
}
