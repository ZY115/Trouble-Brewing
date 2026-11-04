import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { RoomView, Session } from "../../shared/types";
import { PHASE_NAMES } from "../../shared/types";
import { roleName } from "../../shared/roles";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import PhaseControls from "../components/PhaseControls";
import StorytellerTable, { PlayerEditor } from "../components/StorytellerTable";
import NightPanel from "../components/NightPanel";
import Grimoire, { type MarkKind, type SeatRing } from "../ui/Grimoire";
import Drawer from "./Drawer";
import LobbyStage from "./LobbyStage";
import MoreDrawer from "./MoreDrawer";
import SeatPanel from "./SeatPanel";
import { storytellerSeats } from "./seats";
import {
  currentTask,
  dayTasks,
  isNightPhase,
  nightTasks,
  taskDone,
  taskWaiting,
  type Task,
} from "./tasks";
import {
  DawnTask,
  GenerateTask,
  NominateTask,
  NoticeTask,
  PlanTask,
  PublishTask,
  StaleTask,
  VerdictTask,
  VoteTask,
} from "./TaskViews";
import ActionTask from "./ActionTask";
import { EndGameDialog, EndTask } from "./EndGame";
import { NextRound } from "./NextRound";
import { RecapFacts, RecapTimeline, ResultBanner } from "../components/Recap";
const PublicPanel = lazy(() => import("../components/PublicPanel"));
const SetupPanel = lazy(() => import("../components/SetupPanel"));

type DrawerId = "" | "table" | "log" | "setup" | "plan" | "more";
const TITLES: Record<Exclude<DrawerId, "">, string> = {
  table: "总体表",
  log: "公开记录",
  setup: "配板工坊",
  plan: "编辑夜序",
  more: "更多",
};

const MOON = "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z";
const SUN = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const num = (room: RoomView, id?: string) => room.seats.find((s) => s.id === id)?.number;

function taskLabel(room: RoomView, t: Task) {
  const st = room.storyteller!;
  switch (t.kind) {
    case "end":
      return "结束条件";
    case "notice":
      return "规则提醒";
    case "stale":
      return "到期标记";
    case "generate":
      return "生成夜序";
    case "dawn":
      return "宣布天亮";
    case "action":
      return `自定义 · ${num(room, t.action.seatId)} 号`;
    case "plan":
      if (t.item.seatId)
        return `${roleName(t.item.roleId || st.assignments[t.item.seatId]?.perceivedRoleId)} · ${num(room, t.item.seatId)}`;
      return t.item.prompt.includes("邪恶")
        ? "邪恶信息"
        : t.item.prompt.includes("猩红女郎")
          ? "猩红女郎检查"
          : t.item.prompt.includes("中毒")
            ? "入夜检查"
            : t.item.prompt.slice(0, 8);
    default:
      return "";
  }
}

function taskState(room: RoomView, t: Task) {
  if (taskDone(room, t)) return t.kind === "plan" && t.item.status === "skipped" ? "跳过" : "✓";
  if (taskWaiting(t)) return "等待选择";
  if (t.kind === "plan" && t.item.status === "planned" && t.item.seatId) return "未发出";
  return "";
}

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
  const [editing, setEditing] = useState("");
  const [focus, setFocus] = useState("");
  const [dismissed, setDismissed] = useState<{ phase: number; ids: string[] }>({ phase: st.phaseVersion, ids: [] });
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [nominator, setNominator] = useState("");
  const [nominee, setNominee] = useState("");
  const unread = useUnread(room);
  const night = isNightPhase(room);
  const day = room.phase === "DAY";
  const lobby = room.phase === "LOBBY" || room.phase === "SETUP";
  const dismissedIds = dismissed.phase === st.phaseVersion ? dismissed.ids : [];
  const dismiss = (id: string) => setDismissed({ phase: st.phaseVersion, ids: [...dismissedIds, id] });
  const tasks = night ? nightTasks(room) : day ? dayTasks(room) : [];
  const current = tasks.length ? currentTask(room, tasks, dismissedIds) : undefined;
  const focused = tasks.find((t) => t.id === focus) ?? current;
  // When the next card replaces a finished one, bring its title back under the top bar.
  const side = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = side.current?.firstElementChild;
    const top = card?.getBoundingClientRect().top ?? 0;
    if (card && top < 72) window.scrollBy({ top: top - 84, behavior: "smooth" });
  }, [focused?.id, seatId]);
  const steps = tasks.filter((t) => t.kind === "plan" || t.kind === "action");
  const stepsDone = steps.filter((t) => taskDone(room, t)).length;

  // What the focused task is about, drawn on the grimoire.
  const rings: Record<string, SeatRing[]> = {};
  const marks: Record<string, { text: string; kind: MarkKind }[]> = {};
  const ring = (id: string | undefined, r: SeatRing) => {
    if (id) rings[id] = [...(rings[id] ?? []), r];
  };
  let lines: { from: number; to: number; dashed?: boolean }[] = [];
  const focusAction =
    focused?.kind === "plan" ? focused.action : focused?.kind === "action" ? focused.action : undefined;
  if (focused?.kind === "plan" && focused.item.seatId) ring(focused.item.seatId, "actor");
  if (focusAction) {
    if (focused?.kind === "action") ring(focusAction.seatId, "actor");
    focusAction.targets.forEach((t) => ring(t, "target"));
    lines = focusAction.targets
      .filter((t) => t !== focusAction.seatId)
      .map((t) => ({ from: num(room, focusAction.seatId) ?? 0, to: num(room, t) ?? 0, dashed: true }));
  }
  const vote = room.liveVote;
  if (day && vote && ["OPEN", "COUNTING"].includes(vote.status)) {
    ring(vote.nominator, "actor");
    ring(vote.nominee, "target");
    if (vote.status === "COUNTING") ring(vote.order[vote.cursor], "focus");
    lines = [{ from: num(room, vote.nominator) ?? 0, to: num(room, vote.nominee) ?? 0 }];
    for (const s of room.seats) {
      if (s.id in vote.counted)
        marks[s.id] = [vote.counted[s.id] ? { text: "票", kind: "vote" } : { text: "弃", kind: "tag" }];
      else if (vote.hands[s.id]) marks[s.id] = [{ text: "举", kind: "hand" }];
    }
  } else if (day && (picking || nominee)) {
    ring(nominator, "actor");
    ring(nominee, "target");
    if (nominator && nominee) lines = [{ from: num(room, nominator) ?? 0, to: num(room, nominee) ?? 0, dashed: true }];
  }
  if (seatId) ring(seatId, "focus");
  const badges = Object.fromEntries(
    room.seats.filter((s) => unread.contactCount(s.id) > 0).map((s) => [s.id, String(unread.contactCount(s.id))]),
  );

  function tapSeat(id: string) {
    if (day && picking) {
      if (!nominator) setNominator(id);
      else if (id !== nominator) {
        setNominee(id);
        setPicking(false);
      }
      return;
    }
    setSeatId(id === seatId ? "" : id);
  }
  const resetNomination = () => {
    setPicking(false);
    setNominator("");
    setNominee("");
  };

  function renderTask(t: Task) {
    switch (t.kind) {
      case "end":
        return <EndTask key={t.id} room={room} onEnd={() => setEnding(true)} onDismiss={() => dismiss(t.id)} />;
      case "notice":
        return <NoticeTask key={t.id} room={room} send={send} notice={t.notice} onEnd={() => setEnding(true)} />;
      case "stale":
        return <StaleTask room={room} send={send} />;
      case "generate":
        return <GenerateTask room={room} send={send} />;
      case "plan":
        return (
          <PlanTask
            key={t.id}
            room={room}
            send={send}
            item={t.item}
            step={t.step}
            total={steps.length}
            onSkip={() => {
              dismiss(t.id);
              setFocus("");
            }}
          />
        );
      case "action":
        return <ActionTask key={t.id} room={room} send={send} action={t.action} eyebrow={`自定义待办 · ${num(room, t.action.seatId)} 号`} />;
      case "dawn":
        return <DawnTask room={room} send={send} />;
      case "publish":
        return <PublishTask room={room} send={send} />;
      case "vote":
        return <VoteTask key={t.id} room={room} send={send} />;
      case "verdict":
        return <VerdictTask key={t.id} room={room} send={send} onDismiss={() => dismiss(t.id)} />;
      case "nominate":
        return (
          <NominateTask
            room={room}
            send={send}
            picking={picking}
            nominator={nominator}
            nominee={nominee}
            onPick={() => {
              setSeatId("");
              setPicking(true);
            }}
            onReset={resetNomination}
            openLog={() => {
              resetNomination();
              setDrawer("log");
            }}
          />
        );
    }
  }

  const phaseLabel = day
    ? `第 ${room.day} 天`
    : night
      ? room.day === 1
        ? "首夜"
        : `第 ${room.day} 夜`
      : PHASE_NAMES[room.phase];
  const living = room.seats.filter((s) => s.alive).length;
  const firstUnread = room.seats.find((s) => unread.contactCount(s.id) > 0);
  const secondary: { id: Exclude<DrawerId, "">; label: string; show: boolean }[] = [
    { id: "table", label: "总表", show: !lobby },
    { id: "log", label: "记录", show: !lobby },
    { id: "plan", label: "编辑夜序", show: night },
    { id: "setup", label: "配板", show: lobby },
  ];
  const today = room.publicRecords.filter(
    (r) => r.day === room.day && r.period === "DAY" && r.type !== "phase" && !room.publicRecords.some((n) => n.supersedes === r.id),
  );

  return (
    <div className="st-shell">
      <header className="st-top">
        <span className="brand">
          <Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />
          <strong>暗流涌动</strong>
        </span>
        <span className="phase-pill">
          {(day || night) && <Icon d={day ? SUN : MOON} />}
          <b>{phaseLabel}</b>
          {night && steps.length > 0 && (
            <span className="progress" aria-label={`已完成 ${stepsDone} / ${steps.length} 步`}>
              {steps.map((t) => (
                <i key={t.id} className={taskDone(room, t) ? "done" : focused?.id === t.id ? "now" : ""} />
              ))}
            </span>
          )}
          {day && <span className="muted">{living} 人存活</span>}
        </span>
        {!connected && (
          <span className="conn offline">
            <i />
            重新连接中
          </span>
        )}
        <span className="spacer" />
        {firstUnread && (
          <button className="top-chip accent" onClick={() => setSeatId(firstUnread.id)}>
            私聊 {unread.messages.length}
          </button>
        )}
        <span className="top-secondary">
          {secondary
            .filter((s) => s.show)
            .map((s) => (
              <button key={s.id} className="top-chip" onClick={() => setDrawer(s.id)}>
                {s.label}
              </button>
            ))}
          {st.debug && (
            <button className="top-chip" onClick={() => setDrawer("more")}>
              调试玩家
            </button>
          )}
        </span>
        <button className="icon-button" aria-label="更多" onClick={() => setDrawer("more")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {st.endReview?.available && (
          <button
            className={`top-end${st.endReview.buttonLabel === "结束游戏" ? " met" : ""}`}
            onClick={() => setEnding(true)}
          >
            {st.endReview.buttonLabel}
          </button>
        )}
        {(night || day) && <PhaseControls room={room} send={send} part="button" />}
      </header>

      {error && (
        <div className="st-alerts">
          <div role="alert" className="error">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        </div>
      )}

      {lobby ? (
        <div className="st-body lobby">
          <LobbyStage room={room} send={send} openSetup={() => setDrawer("setup")} onScan={onScan} />
        </div>
      ) : (
        <div className="st-main">
          <section className="st-board" aria-label="魔典">
            <div className="board-circle">
              <Grimoire
                label="魔典"
                capacity={room.capacity}
                seats={storytellerSeats(room, { rings, marks, badges })}
                lines={lines}
                onSeat={(s) => tapSeat(s.key)}
                center={
                  <>
                    <span className="eyebrow">{room.phase === "ENDED" ? "本局已结束" : phaseLabel}</span>
                    <span className="board-count">{living}</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      人存活{day ? ` · 过半 ${Math.ceil(living / 2)} 票` : ""}
                    </span>
                  </>
                }
              />
            </div>
            <p className="board-hint">
              {picking ? "依次点提名者、被提名者" : "点座位查看这名玩家：身份、标记、私聊、行动"}
            </p>
          </section>

          <aside className="st-side" ref={side}>
            {seatId ? (
              <SeatPanel
                key={seatId}
                room={room}
                send={send}
                seatId={seatId}
                onClose={() => setSeatId("")}
                onEdit={() => setEditing(seatId)}
              />
            ) : room.phase === "ENDED" ? (
              <>
                <section className="task-card ended-card">
                  <ResultBanner result={room.result} />
                  {(st.recapPreview ?? room.recap) && <RecapFacts recap={(st.recapPreview ?? room.recap)!} />}
                </section>
                {(st.recapPreview ?? room.recap) && (
                  <section className="recap-card" aria-label="复盘">
                    <div className="recap-card-head">
                      <h3>复盘</h3>
                      <span className="muted">{room.recap ? "玩家手机上同步显示" : "提前结束，只有你能看到"}</span>
                    </div>
                    <RecapTimeline recap={(st.recapPreview ?? room.recap)!} room={room} send={send} editable />
                  </section>
                )}
                <NextRound send={send} />
              </>
            ) : (
              focused && renderTask(focused)
            )}

            {!seatId && night && steps.length > 0 && (
              <nav className="queue" aria-label="夜序">
                <div className="queue-title">
                  夜序 <span>{stepsDone} / {steps.length}</span>
                </div>
                {tasks
                  .filter((t) => t.kind !== "dawn")
                  .map((t) => {
                    const state = taskState(room, t);
                    return (
                      <button
                        key={t.id}
                        className={`queue-row ${state === "✓" || state === "跳过" ? "done" : ""} ${focused?.id === t.id ? "current" : ""}`}
                        onClick={() => setFocus(t.id === current?.id ? "" : t.id)}
                      >
                        <span>{taskLabel(room, t)}</span>
                        <span className="queue-state">{state}</span>
                      </button>
                    );
                  })}
                {focus && focused?.id !== current?.id && (
                  <button className="link-button" onClick={() => setFocus("")}>
                    回到当前一步
                  </button>
                )}
              </nav>
            )}
            {!seatId && day && today.length > 0 && (
              <nav className="queue" aria-label="今天">
                <div className="queue-title">今天</div>
                {[...today].reverse().map((r) => (
                  <div key={r.id} className="queue-row done static">
                    <span>{r.text}</span>
                  </div>
                ))}
              </nav>
            )}
          </aside>
        </div>
      )}

      <nav className="st-tabs" aria-label="其他">
        {secondary
          .filter((s) => s.show)
          .map((s) => (
            <button key={s.id} onClick={() => setDrawer(s.id)}>
              {s.label}
            </button>
          ))}
        <button onClick={() => setDrawer("more")}>更多</button>
      </nav>

      {ending && st.endReview?.available && (
        <EndGameDialog room={room} send={send} onClose={() => setEnding(false)} />
      )}
      {editing && st.assignments[editing] && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="改身份或写备注">
          <PlayerEditor key={editing} room={room} seatId={editing} send={send} close={() => setEditing("")} />
        </div>
      )}
      {drawer && (
        <Drawer title={TITLES[drawer]} onClose={() => setDrawer("")}>
          <Suspense fallback={<p className="muted">加载中…</p>}>
            {drawer === "table" && <StorytellerTable room={room} send={send} navigate={() => setDrawer("")} />}
            {drawer === "log" && <PublicPanel room={room} send={send} />}
            {drawer === "setup" && <SetupPanel room={room} send={send} showQr={onScan} />}
            {drawer === "plan" && <NightPanel room={room} send={send} />}
            {drawer === "more" && (
              <MoreDrawer
                room={room}
                send={send}
                session={session}
                onScan={onScan}
                onLeave={onLeave}
                onEnd={() => {
                  setDrawer("");
                  setEnding(true);
                }}
              />
            )}
          </Suspense>
        </Drawer>
      )}
    </div>
  );
}
