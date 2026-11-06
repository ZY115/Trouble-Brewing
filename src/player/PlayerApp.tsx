import { Suspense, useEffect, useState, type ReactNode } from "react";
import type { RoomView } from "../../shared/types";
import { roleById, roleName, TEAM_NAMES } from "../../shared/roles";
import { toggleChoice } from "../../shared/action-choice";
import type { Send } from "../useRoom";
import { localKey, useLocalState, useUnread } from "../localState";
import Registration from "../components/Registration";
import { RecapFacts, RecapTimeline, ResultBanner, TruthCircle } from "../components/Recap";
import HoldReveal from "./HoldReveal";
import Shield, { ShieldContext, useAutoHide, useShieldPreference } from "./Shield";
import NightCard, { tonightActions } from "./NightCard";
import { NoteCircle, NotesTable } from "./NoteCircle";
import SeatSheet from "./SeatSheet";
import { PlayerVote, TodayList } from "./PlayerDay";
import { isNight, visibleRoom } from "./visibility";
import InformationHistory, { MyInfo } from "./InformationHistory";
import PlayerRecords from "./PlayerRecords";
import { useVerdicts } from "./notes";
import ChatPanel from "../components/ChatPanel";
import { contactName } from "../components/chat";

type SheetId = "" | "chat" | "records" | "menu";
type RecordTab = "notes" | "public" | "info";
const NO_PICK = { id: "", targets: [] as string[] };

function Sheet({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-head">
        <button className="icon-button ghost" aria-label="返回" onClick={onClose}>
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
        <Suspense fallback={<p className="muted">加载中…</p>}>{children}</Suspense>
      </div>
    </div>
  );
}

function Identity({ room }: { room: RoomView }) {
  const role = roleById(room.self?.perceivedRoleId ?? "");
  if (!role) return <span className="pl-small">身份尚未发放。</span>;
  const num = (id: string) => room.seats.find((s) => s.id === id)?.number;
  const mine = room.evilBluffs?.claims[room.viewer.seatId ?? ""];
  return (
    <>
      <span className="pl-small">{TEAM_NAMES[role.team]}</span>
      <span className="role-name">{role.name}</span>
      <span className="pl-small">{role.hint}</span>
      {room.evilEnabled && room.evilMembers && (
        <span className="pl-small">邪恶阵营：{room.evilMembers.map((id) => `${num(id)} 号`).join("、")}</span>
      )}
      {room.self?.bluffs && (
        <span className="pl-small">不在场的善良角色：{room.self.bluffs.map(roleName).join("、")}</span>
      )}
      {mine && <span className="pl-small">我要扮演：{roleName(mine)}</span>}
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
  const [tab, setTab] = useLocalState<RecordTab>(localKey(room, "records-tab"), "notes");
  const [noteSeat, setNoteSeat] = useState("");
  const [chatWith, setChatWith] = useState("");
  const { verdicts, setVerdict } = useVerdicts(room, send);
  const view = visibleRoom(room);
  const unread = useUnread(view);
  const me = room.seats.find((s) => s.id === room.viewer.seatId);
  const night = isNight(room);
  const lobby = room.phase === "LOBBY" || room.phase === "SETUP";
  const privateOpen = sheet === "records" && tab === "info";
  const [shielded, setShielded] = useShieldPreference();
  const [revealed, setRevealed] = useState(false);
  useAutoHide(revealed, () => setRevealed(false));
  useEffect(() => setRevealed(false), [room.phase, room.day, shielded]);
  const nightHidden = shielded && !revealed;

  useEffect(() => {
    if (!privateOpen) return;
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
  }, [privateOpen]);
  useEffect(() => {
    setSheet("");
    setNoteSeat("");
  }, [lobby, room.code, room.gameNo, room.viewer.seatId]);

  const { open } = tonightActions(room);
  const [draft, setDraft, clearDraft] = useLocalState(localKey(room, `night-pick:${room.day}`), NO_PICK);
  const [noting, setNoting] = useState(false);
  useEffect(() => setNoting(false), [open?.id]);
  const picking = night && !!open && !noting && !nightHidden;
  const picked = open && draft.id === open.id ? draft.targets : open?.status === "SUBMITTED" ? open.targets : [];
  const tapSeat = (seatId: string) => {
    if (picking && open) setDraft({ id: open.id, targets: toggleChoice(picked, seatId, open.targetCount) });
    else setNoteSeat(seatId);
  };

  const voting = !!room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status);
  const phase = lobby
    ? "等待入座"
    : room.phase === "ENDED"
      ? "本局已结束"
      : night
        ? room.day === 1
          ? "首夜"
          : `第 ${room.day} 夜`
        : `第 ${room.day} 天`;
  const chatCount = unread.messages.length;
  const invites = room.invitations.filter((i) => i.to === room.viewer.seatId && i.status === "pending").length;
  const chatNote = invites ? `${invites} 个群聊邀请` : chatCount ? `${chatCount} 条新消息` : "";
  return (
    <ShieldContext.Provider value={shielded}>
    <div className="pl-shell">
      <header className="pl-top">
        <span className="pl-phase">{phase}</span>
        {me && <span>{me.number} 号</span>}
        <span className="spacer" />
        {!connected && <span>同步中…</span>}
        {!lobby && (
          <button className="pl-shield" aria-pressed={shielded} onClick={() => setShielded(!shielded)}>
            {shielded ? "显示私密" : "隐藏私密"}
          </button>
        )}
        <button className="icon-button ghost" aria-label="菜单" onClick={() => setSheet("menu")}>
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
        {lobby ? (
          <>
            <span className="pl-title">等待入座</span>
            <Registration room={room} send={send} />
          </>
        ) : (
          <>
            {room.phase === "ENDED" && room.recap ? (
              <TruthCircle room={room} recap={room.recap} />
            ) : (
              <NoteCircle
                room={room}
                verdicts={verdicts}
                picked={picked}
                picking={picking}
                noSelf={["protect", "master"].includes(open?.choiceKind ?? "")}
                onSeat={tapSeat}
              />
            )}
            {night &&
              (nightHidden ? (
                <button className="pl-card shield-cover" onClick={() => setRevealed(true)}>
                  今晚的信息已隐藏 · 点一下显示
                </button>
              ) : (
                <>
                  <NightCard
                    room={room}
                    send={send}
                    picked={picked}
                    selecting={picking}
                    onToggleMode={() => setNoting(!noting)}
                    onSubmitted={clearDraft}
                  />
                  {shielded && (
                    <button className="link-button shield-close" onClick={() => setRevealed(false)}>
                      收起今晚的信息
                    </button>
                  )}
                </>
              ))}
            {room.phase === "DAY" && voting && <PlayerVote key={room.liveVote!.id} room={room} send={send} />}
            {room.phase === "DAY" && <TodayList room={room} />}
            {room.phase === "ENDED" && (
              <>
                <section className="pl-card pl-result">
                  <ResultBanner result={room.result} />
                  {room.recap && <RecapFacts recap={room.recap} />}
                </section>
                {room.recap && (
                  <section className="pl-card" aria-label="复盘">
                    <span className="pl-small">复盘</span>
                    <RecapTimeline recap={room.recap} room={room} />
                  </section>
                )}
                <span className="pl-small pl-waiting">等待说书人开始下一局</span>
              </>
            )}
          </>
        )}
      </main>
      {!lobby && (
        <nav className="pl-dock" aria-label="我的">
          <HoldReveal label="身份">
            <Identity room={room} />
          </HoldReveal>
          <HoldReveal label="信息">
            <MyInfo room={room} />
          </HoldReveal>
          <button
            className={chatNote ? "has-unread" : ""}
            onClick={() => {
              setChatWith("");
              setSheet("chat");
            }}
          >
            私聊
            {chatNote ? (
              <small className="dock-unread">{chatNote}</small>
            ) : (
              <small aria-hidden="true">&nbsp;</small>
            )}
          </button>
          <button onClick={() => setSheet("records")}>
            记录
            <small aria-hidden="true">笔记 · 公开</small>
          </button>
        </nav>
      )}

      {!lobby && noteSeat && (
        <SeatSheet
          key={noteSeat}
          room={room}
          send={send}
          seatId={noteSeat}
          verdict={verdicts[noteSeat]}
          setVerdict={(v) => setVerdict(noteSeat, v)}
          onClose={() => setNoteSeat("")}
          onChat={() => {
            setChatWith(noteSeat);
            setNoteSeat("");
            setSheet("chat");
          }}
        />
      )}
      {!lobby && sheet === "chat" && (
        <Sheet
          title={chatWith ? contactName(view, chatWith) : "私聊"}
          className={chatWith ? "thread-open" : ""}
          onClose={() => (chatWith ? setChatWith("") : setSheet(""))}
        >
          <ChatPanel room={view} send={send} recipient={chatWith} onOpen={setChatWith} />
        </Sheet>
      )}
      {!lobby && sheet === "records" && (
        <Sheet title="记录" onClose={() => setSheet("")}>
          <div className="segmented records-tabs" role="tablist" aria-label="记录">
            {(
              [
                ["notes", "笔记总表"],
                ["public", "公开记录"],
                ["info", "我的信息"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "notes" && <NotesTable room={room} verdicts={verdicts} onOpen={setNoteSeat} />}
          {tab === "public" && <PlayerRecords room={room} />}
          {tab === "info" && (
            <Shield label="我的信息">
              <InformationHistory room={room} />
            </Shield>
          )}
        </Sheet>
      )}
      {sheet === "menu" && (
        <Sheet title="菜单" onClose={() => setSheet("")}>
          <div className="pl-card">
            <span className="pl-small">
              房间 {room.code} · 第 {room.gameNo} 局{me ? ` · 你是 ${me.number} 号` : ""}
            </span>
          </div>
          <button onClick={onLeave}>返回入口（保留本机身份）</button>
        </Sheet>
      )}
    </div>
    </ShieldContext.Provider>
  );
}
