import { lazy, Suspense, useState } from "react";
import type { RoomView, Session } from "../../shared/types";
import { PHASE_NAMES } from "../../shared/types";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import { completedAction } from "../../shared/assistance";
import PhaseControls from "../components/PhaseControls";
import RuleReminders from "../components/RuleReminders";
import LifeAnnouncements from "../components/LifeAnnouncements";
import StorytellerTable, { PlayerEditor } from "../components/StorytellerTable";
import NightPanel from "../components/NightPanel";
import Drawer from "./Drawer";
import SeatBar from "./SeatBar";
import NightStage, { itemDone } from "./NightStage";
import DayStage from "./DayStage";
import LobbyStage from "./LobbyStage";
import MoreDrawer from "./MoreDrawer";
import ChatDrawer from "./ChatDrawer";
const PublicPanel = lazy(() => import("../components/PublicPanel"));
const SetupPanel = lazy(() => import("../components/SetupPanel"));

type DrawerId = "" | "table" | "chat" | "log" | "setup" | "plan" | "more";
const TITLES: Record<Exclude<DrawerId, "">, string> = {
  table: "总体表",
  chat: "私聊与行动",
  log: "公开记录",
  setup: "配板工坊",
  plan: "夜间清单与自定义待办",
  more: "更多",
};

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const MOON = "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z";
const SUN = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";

export default function StorytellerApp({
  room,
  send,
  session,
  connected,
  error,
  setError,
  onLeave,
  onScan,
}: {
  room: RoomView;
  send: Send;
  session: Session;
  connected: boolean;
  error: string;
  setError: (v: string) => void;
  onLeave: () => void;
  onScan: () => void;
}) {
  const st = room.storyteller!;
  const [drawer, setDrawer] = useState<DrawerId>("");
  const [seatId, setSeatId] = useState("");
  const [detail, setDetail] = useState("");
  const [chatSeat, setChatSeat] = useState("");
  const unread = useUnread(room);
  const night = room.phase === "FIRST_NIGHT" || room.phase === "OTHER_NIGHT";
  const playing = night || room.phase === "DAY";
  const lobby = room.phase === "LOBBY" || room.phase === "SETUP";
  const plan = st.nightPlan.filter((i) => i.night === room.day);
  const planDone = plan.filter((i) => itemDone(room, i)).length;
  const pendingActions = room.actions.filter((a) => a.night === room.day && !completedAction(a)).length;
  const phaseLabel =
    room.phase === "DAY"
      ? `第 ${room.day} 天`
      : night
        ? room.day === 1
          ? "首夜"
          : `第 ${room.day} 夜`
        : PHASE_NAMES[room.phase];
  const tabs: { id: Exclude<DrawerId, "">; label: string; count?: number; show: boolean }[] = [
    { id: "table", label: "总体表", show: playing || room.phase === "ENDED" },
    { id: "chat", label: "私聊", count: unread.messages.length, show: !lobby },
    { id: "log", label: "记录", show: !lobby },
    { id: "plan", label: "清单", count: pendingActions, show: night },
    { id: "setup", label: "配板", show: lobby },
    { id: "more", label: "更多", show: true },
  ];
  const openChat = (id: string) => {
    setChatSeat(id);
    setSeatId("");
    setDrawer("chat");
  };
  return (
    <div className="st-shell">
      <header className="st-top">
        <span className="brand">
          <Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />
          <strong>暗流涌动</strong>
        </span>
        <span className="phase-pill">
          <Icon d={room.phase === "DAY" ? SUN : MOON} />
          <b>{phaseLabel}</b>
          {night && plan.length > 0 && <span className="muted">· {planDone} / {plan.length}</span>}
          {room.phase === "DAY" && (
            <span className="muted">· {room.seats.filter((s) => s.alive).length} 人存活</span>
          )}
        </span>
        <span className={`conn ${connected ? "" : "offline"}`}>
          <i />
          {connected ? `房间 ${room.code}` : "重新连接中"}
        </span>
        <span className="spacer" />
        {playing && <PhaseControls room={room} send={send} part="button" />}
        <button className="icon-button" aria-label="更多" onClick={() => setDrawer("more")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </header>

      <div className="st-alerts">
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {playing && <RuleReminders room={room} send={send} />}
        {playing && <LifeAnnouncements room={room} send={send} />}
      </div>

      <div className="st-body">
        {lobby && (
          <LobbyStage room={room} send={send} openSetup={() => setDrawer("setup")} onScan={onScan} />
        )}
        {night && (
          <NightStage room={room} send={send} onSeat={setSeatId} openPlan={() => setDrawer("plan")} />
        )}
        {room.phase === "DAY" && (
          <DayStage room={room} send={send} onSeat={setSeatId} openLog={() => setDrawer("log")} />
        )}
        {room.phase === "ENDED" && (
          <main className="st-stage" style={{ gridColumn: "1 / 3" }}>
            <section className="step-card quiet stage-card">
              <span className="step-who">本局已结束</span>
              <span className="step-title">准备下一局</span>
              <p className="step-note">
                默认保留房间、号码和配板。玩家无需重新扫码；需要换座的人可以在手机上申请，你在「更多」里确认。
              </p>
              <div className="step-row">
                <button className="primary" onClick={() => void send({ type: "new_round" })}>
                  准备下一局（保留号码）
                </button>
                <button onClick={() => setDrawer("log")}>查看本局记录</button>
                <button onClick={() => setDrawer("table")}>查看身份总表</button>
              </div>
            </section>
          </main>
        )}
        <div className="st-drawers" aria-label="抽屉">
          {tabs
            .filter((t) => t.show && t.id !== "more")
            .map((t) => (
              <button
                key={t.id}
                className={`drawer-tab ${t.count ? "has-items" : ""}`}
                onClick={() => setDrawer(t.id)}
              >
                {t.label}
                {t.count ? ` ${t.count}` : ""}
              </button>
            ))}
        </div>
      </div>

      <nav className="st-tabs" aria-label="说书人导航">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.id} className={drawer === t.id ? "active" : ""} onClick={() => setDrawer(t.id)}>
              {t.label}
              {t.count ? <span className="nav-count">{t.count}</span> : null}
            </button>
          ))}
      </nav>

      {seatId && !drawer && (
        <SeatBar
          key={seatId}
          room={room}
          send={send}
          seatId={seatId}
          onClose={() => setSeatId("")}
          onChat={() => openChat(seatId)}
          onDetail={() => {
            setDetail(seatId);
            setSeatId("");
          }}
        />
      )}
      {detail && room.storyteller?.assignments[detail] && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="玩家详情">
          <PlayerEditor key={detail} room={room} seatId={detail} send={send} close={() => setDetail("")} />
        </div>
      )}
      {drawer && (
        <Drawer title={TITLES[drawer]} onClose={() => setDrawer("")}>
          <Suspense fallback={<p className="muted">加载中…</p>}>
            {drawer === "table" && (
              <StorytellerTable room={room} send={send} navigate={() => setDrawer("")} />
            )}
            {drawer === "chat" && (
              <ChatDrawer room={room} send={send} seatId={chatSeat} setSeatId={setChatSeat} />
            )}
            {drawer === "log" && <PublicPanel room={room} send={send} />}
            {drawer === "setup" && <SetupPanel room={room} send={send} showQr={onScan} />}
            {drawer === "plan" && <NightPanel room={room} send={send} />}
            {drawer === "more" && (
              <MoreDrawer room={room} send={send} session={session} onScan={onScan} onLeave={onLeave} />
            )}
          </Suspense>
        </Drawer>
      )}
    </div>
  );
}
