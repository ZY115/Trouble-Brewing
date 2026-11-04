import { useEffect, useRef, useState } from "react";
import type { NightPlanItem, RoomView, RuleNotice } from "../../shared/types";
import { isEvil, roleById, roleName } from "../../shared/roles";
import { phaseReview } from "../../shared/phase-review";
import type { Send } from "../useRoom";
import PhaseControls from "../components/PhaseControls";
import DayTimer from "../components/DayTimer";
import ActionTask from "./ActionTask";
import { Checks, TaskActions, TaskCard, TaskNote } from "./TaskCard";

const num = (room: RoomView, id?: string) => room.seats.find((s) => s.id === id)?.number;
const nightName = (room: RoomView) => (room.day === 1 ? "首夜" : `第 ${room.day} 夜`);

function useAct(send: Send) {
  const [busy, setBusy] = useState(false);
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    const ok = await send(command);
    setBusy(false);
    return ok;
  }
  return { busy, act };
}

export function NoticeTask({
  room,
  send,
  notice,
  onEnd,
}: {
  room: RoomView;
  send: Send;
  notice: RuleNotice;
  onEnd: () => void;
}) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const guard = { expectedContextVersion: st.contextVersion };
  const [first, ...rest] = notice.candidates;
  return (
    <TaskCard
      eyebrow="规则提醒 · 需要你裁定"
      title={notice.kind === "demon" ? "恶魔死亡" : notice.kind === "saint" ? "圣徒被处决" : notice.kind === "mayor" ? "镇长胜利条件" : "检查胜负"}
    >
      <TaskNote>{notice.text}</TaskNote>
      <TaskActions>
        {first && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void act({ type: "promote_imp", seatId: first, deathId: notice.deathId!, confirmed: true, ...guard })}
          >
            {num(room, first)} 号成为小恶魔
          </button>
        )}
        {rest.map((id) => (
          <button
            key={id}
            disabled={busy}
            onClick={() => void act({ type: "promote_imp", seatId: id, deathId: notice.deathId!, confirmed: true, ...guard })}
          >
            改为 {num(room, id)} 号继任
          </button>
        ))}
        {notice.canConfirmSelfKill && (
          <button
            disabled={busy}
            onClick={() => void act({ type: "confirm_self_kill", deathId: notice.deathId!, confirmed: true, ...guard })}
          >
            这是小恶魔自杀传位
          </button>
        )}
        <button
          className={first ? "" : "primary"}
          disabled={busy}
          onClick={() => void act({ type: "resolve_notice", noticeId: notice.id, ...guard })}
        >
          已核对，游戏继续
        </button>
      </TaskActions>
      <div className="task-links">
        <button className="link-button" onClick={onEnd}>
          已分出胜负，结束本局…
        </button>
      </div>
    </TaskCard>
  );
}

export function StaleTask({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const list = st.staleConditions.map(
    (x) => `${num(room, x.seatId)} 号${x.condition === "poisoned" ? "中毒" : "受保护"}`,
  );
  return (
    <TaskCard eyebrow={room.phase === "DAY" ? "天亮 · 标记到期" : `${nightName(room)} · 入夜`} title="上一轮的标记到期了">
      <Checks items={list.map((text) => ({ ok: false, text }))} />
      <TaskActions>
        <button className="primary" disabled={busy} onClick={() => void act({ type: "clear_expired_conditions", expectedContextVersion: st.contextVersion })}>
          清除这些标记
        </button>
        <button disabled={busy} onClick={() => void act({ type: "keep_expired_conditions", expectedContextVersion: st.contextVersion })}>
          保留
        </button>
      </TaskActions>
    </TaskCard>
  );
}

export function GenerateTask({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const guard = { expectedPhaseVersion: st.phaseVersion, expectedPlanVersion: st.planVersion };
  return (
    <TaskCard eyebrow={nightName(room)} title={`开始${nightName(room)}`}>
      <TaskNote>按配板和夜序列出今晚的每一步。有行动的玩家会同时在手机上收到选择，你再按顺序逐个处理。</TaskNote>
      <TaskActions>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (await act({ type: "generate_night_plan", ...guard }))
              await act({ type: "start_all_plan", expectedPhaseVersion: st.phaseVersion, expectedPlanVersion: st.planVersion + 1 });
          }}
        >
          生成夜序，同时发给所有玩家
        </button>
        <button disabled={busy} onClick={() => void act({ type: "generate_night_plan", ...guard })}>
          只生成，逐个发出
        </button>
      </TaskActions>
    </TaskCard>
  );
}

const ST_TITLES: [string, string][] = [
  ["邪恶", "首夜邪恶信息"],
  ["中毒", "入夜检查"],
  ["猩红女郎", "猩红女郎检查"],
];

export function PlanTask({
  room,
  send,
  item,
  step,
  total,
  onSkip,
}: {
  room: RoomView;
  send: Send;
  item: NightPlanItem;
  step: number;
  total: number;
  onSkip: () => void;
}) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const guard = { expectedPhaseVersion: st.phaseVersion, expectedPlanVersion: st.planVersion };
  const op = (operation: "start" | "skip" | "offline" | "restore") =>
    act({ type: "plan_item", itemId: item.id, operation, ...guard });
  const action = room.actions.find((a) => a.id === item.actionId);
  const who = item.seatId ? `${roleName(item.roleId || st.assignments[item.seatId]?.perceivedRoleId)} · ${num(room, item.seatId)} 号` : "说书人";
  const eyebrow = `${nightName(room)} · 第 ${step + 1} / ${total} 步 · ${who}`;
  if (action) return <ActionTask key={action.id} room={room} send={send} action={action} eyebrow={eyebrow} onSkip={onSkip} />;
  const conditional = item.note.includes("条件项");
  if (["skipped", "offline"].includes(item.status))
    return (
      <TaskCard eyebrow={eyebrow} title={item.status === "skipped" ? "已跳过" : "已线下完成"}>
        {!item.retiredReason && (
          <div className="task-links">
            <button className="link-button" disabled={busy} onClick={() => void op("restore")}>
              恢复这一步
            </button>
          </div>
        )}
      </TaskCard>
    );
  if (item.seatId)
    return (
      <TaskCard eyebrow={eyebrow} title={`还没发给 ${num(room, item.seatId)} 号`}>
        {conditional && <TaskNote>{item.note.replace(/^[^：]*：/, "")}</TaskNote>}
        <TaskActions>
          <button className="primary" disabled={busy} onClick={() => void op("start")}>
            发给 {num(room, item.seatId)} 号
          </button>
          <button disabled={busy} onClick={() => void op("skip")}>
            {conditional ? "今晚不触发，跳过" : "跳过"}
          </button>
        </TaskActions>
        <div className="task-links">
          <button className="link-button" disabled={busy} onClick={() => void op("offline")}>
            已在线下处理
          </button>
        </div>
      </TaskCard>
    );
  const title = ST_TITLES.find(([k]) => item.prompt.includes(k))?.[1] ?? item.prompt;
  if (title === "首夜邪恶信息") {
    const evil = room.seats.filter((s) => isEvil(st.assignments[s.id]?.actualRoleId));
    const minions = evil.filter((s) => roleById(st.assignments[s.id]?.actualRoleId)?.team === "minion");
    const demons = evil.filter((s) => st.assignments[s.id]?.actualRoleId === "imp");
    return (
      <TaskCard eyebrow={eyebrow} title={title}>
        <p className="task-truth">
          恶魔：{demons.map((s) => `${s.number} 号`).join("、") || "无"} · 爪牙：
          {minions.map((s) => `${s.number} 号`).join("、") || "无"} · 假身份：{st.setup.bluffs.map(roleName).join("、")}
        </p>
        <TaskActions>
          {!st.evilInfoSent && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await act({ type: "send_evil_info", expectedContextVersion: st.contextVersion })) await op("offline");
              }}
            >
              私发给邪恶玩家
            </button>
          )}
          <button className={st.evilInfoSent ? "primary" : ""} disabled={busy} onClick={() => void op("offline")}>
            {st.evilInfoSent ? "完成" : "已线下告知"}
          </button>
        </TaskActions>
      </TaskCard>
    );
  }
  const demonAlive = room.seats.some((s) => s.alive && st.assignments[s.id]?.actualRoleId === "imp");
  return (
    <TaskCard eyebrow={eyebrow} title={title}>
      {title === "猩红女郎检查" ? (
        <Checks items={[demonAlive ? { ok: true, text: "恶魔存活，无需继任" } : { ok: false, text: "没有存活的恶魔，先处理上方的规则提醒" }]} />
      ) : (
        <TaskNote>{item.note || "确认圆桌上的中毒、保护、醉酒标记都与实际一致。"}</TaskNote>
      )}
      <TaskActions>
        <button className="primary" disabled={busy} onClick={() => void op("offline")}>
          完成
        </button>
        <button disabled={busy} onClick={() => void op("skip")}>
          跳过
        </button>
      </TaskActions>
    </TaskCard>
  );
}

export function DawnTask({ room, send }: { room: RoomView; send: Send }) {
  const lines = phaseReview(room, true).lines;
  return (
    <TaskCard eyebrow={nightName(room)} title="本夜处理完了">
      <ul className="task-plain">
        {lines.slice(0, 5).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <TaskActions>
        <PhaseControls room={room} send={send} part="button" />
      </TaskActions>
      <TaskNote>确认后所有玩家的屏幕同时切到白天。</TaskNote>
    </TaskCard>
  );
}

export function PublishTask({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const pending = room.seats.filter((s) => s.alive !== st.publishedAlive[s.id]);
  return (
    <TaskCard eyebrow={`第 ${room.day} 天`} title="有生死变化还没公布">
      <Checks items={pending.map((s) => ({ ok: false, text: `${s.number} 号${s.alive ? "恢复存活" : "死亡"}` }))} />
      <TaskActions>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act({ type: "publish_life", seatIds: pending.map((s) => s.id), expectedContextVersion: st.contextVersion })}
        >
          现在公布
        </button>
      </TaskActions>
    </TaskCard>
  );
}

export function VoteTask({ room, send }: { room: RoomView; send: Send }) {
  const vote = room.liveVote!;
  const { busy, act } = useAct(send);
  const [auto, setAuto] = useState(false);
  const [cancel, setCancel] = useState("");
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const pause = () => setAuto(false);
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("blur", pause);
    };
  }, []);
  useEffect(() => {
    if (!auto || vote.status !== "COUNTING") return;
    const timer = window.setTimeout(async () => {
      if (!(await sendRef.current({ type: "count_vote", voteId: vote.id, cursor: vote.cursor }))) setAuto(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [auto, vote.id, vote.cursor, vote.status]);
  const living = room.seats.filter((s) => s.alive).length;
  const tally = Object.values(vote.counted).filter(Boolean).length;
  const raised = Object.values(vote.hands).filter(Boolean).length;
  const current = vote.order[vote.cursor];
  const hand = !!vote.hands[current];
  return (
    <TaskCard eyebrow={`第 ${room.day} 天 · 投票`} title={`${num(room, vote.nominator)} 号提名 ${num(room, vote.nominee)} 号`}>
      <div className="vote-tally">
        <span className="tally">{tally}</span>
        <span className="muted">票 · 过半需 {Math.ceil(living / 2)} 票</span>
      </div>
      <TaskNote>
        {vote.status === "OPEN"
          ? `玩家正在手机上举手，目前 ${raised} 人举手。准备好后开始逐座计票。`
          : `正在计 ${num(room, current)} 号：手机上${hand ? "已举手" : "未举手"}`}
      </TaskNote>
      <TaskActions>
        {vote.status === "OPEN" ? (
          <button className="primary" disabled={busy} onClick={() => void act({ type: "start_count", voteId: vote.id })}>
            开始计票
          </button>
        ) : (
          <button className="primary" disabled={busy || auto} onClick={() => void act({ type: "count_vote", voteId: vote.id, cursor: vote.cursor })}>
            计入 {num(room, current)} 号{hand ? "一票" : "未投"}
          </button>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            if (auto) return setAuto(false);
            if (vote.status === "COUNTING" || (await act({ type: "start_count", voteId: vote.id }))) setAuto(true);
          }}
        >
          {auto ? "暂停自动计票" : "自动计票 · 每人 3 秒"}
        </button>
      </TaskActions>
      {vote.status === "COUNTING" && !auto && (
        <div className="task-links">
          <span className="muted">按现场举手代录 {num(room, current)} 号：</span>
          <button className="link-button" disabled={busy} onClick={() => void act({ type: "count_vote", voteId: vote.id, cursor: vote.cursor, offlineVote: true })}>
            举了手
          </button>
          <button className="link-button" disabled={busy} onClick={() => void act({ type: "count_vote", voteId: vote.id, cursor: vote.cursor, offlineVote: false })}>
            没举手
          </button>
        </div>
      )}
      <details className="task-more">
        <summary>取消这次投票</summary>
        <div className="inline-form">
          <input aria-label="取消原因（公开）" placeholder="公开原因" value={cancel} maxLength={200} onChange={(e) => setCancel(e.target.value)} />
          <button disabled={busy || !cancel.trim()} onClick={() => void act({ type: "cancel_vote", voteId: vote.id, reason: cancel })}>
            取消投票
          </button>
        </div>
      </details>
    </TaskCard>
  );
}

export function VerdictTask({ room, send, onDismiss }: { room: RoomView; send: Send; onDismiss: () => void }) {
  const st = room.storyteller!;
  const vote = room.liveVote!;
  const { busy, act } = useAct(send);
  const living = room.seats.filter((s) => s.alive).length;
  const needed = Math.ceil(living / 2);
  const effective = room.publicRecords.filter(
    (r) => r.type === "vote" && r.day === room.day && !room.publicRecords.some((n) => n.supersedes === r.id),
  );
  const record = effective.find((r) => r.id === vote.recordId) ?? effective.at(-1);
  const votes = record?.voters?.length ?? 0;
  const others = effective.filter((r) => r.id !== record?.id && r.nominee !== vote.nominee);
  const otherMax = Math.max(0, ...others.map((r) => r.voters?.length ?? 0));
  const executedToday = st.executions.some((e) => e.day === room.day && !e.voided);
  const leads = votes >= needed && votes > otherMax && !executedToday;
  const nominee = room.seats.find((s) => s.id === vote.nominee);
  const execute = () =>
    act({ type: "execute_player", seatId: vote.nominee, reason: `得票 ${votes} 票`, confirmed: true, expectedContextVersion: st.contextVersion });
  return (
    <TaskCard eyebrow={`第 ${room.day} 天 · 计票结束`} title={`${nominee?.number} 号得 ${votes} 票`}>
      <Checks
        items={[
          votes >= needed ? { ok: true, text: `达到半数（需 ${needed} 票）` } : { ok: false, text: `未达到半数（需 ${needed} 票）` },
          ...(otherMax ? [votes > otherMax ? { ok: true, text: `高于今天其他提名（最高 ${otherMax} 票）` } : { ok: false, text: `今天另有提名得 ${otherMax} 票，${votes === otherMax ? "平票时通常无人被处决" : "票数更高"}` }] : []),
          ...(executedToday ? [{ ok: false, text: "今天已经处决过" }] : []),
        ]}
      />
      <TaskActions>
        {leads ? (
          <>
            <button className="primary" disabled={busy} onClick={() => void execute()}>
              处决 {nominee?.number} 号
            </button>
            <button disabled={busy} onClick={onDismiss}>
              继续提名
            </button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy} onClick={onDismiss}>
              继续提名
            </button>
            <button disabled={busy} onClick={() => void execute()}>
              仍然处决 {nominee?.number} 号
            </button>
          </>
        )}
      </TaskActions>
      <TaskNote>处决一般在白天结束前决定；票数最高且过半者被处决。</TaskNote>
    </TaskCard>
  );
}

export function NominateTask({
  room,
  send,
  picking,
  nominator,
  nominee,
  onPick,
  onReset,
  openLog,
}: {
  room: RoomView;
  send: Send;
  picking: boolean;
  nominator: string;
  nominee: string;
  onPick: () => void;
  onReset: () => void;
  openLog: () => void;
}) {
  const { busy, act } = useAct(send);
  const today = room.publicRecords.filter(
    (r) => r.type === "vote" && r.day === room.day && !room.publicRecords.some((n) => n.supersedes === r.id),
  );
  if (picking || (nominator && nominee))
    return (
      <TaskCard
        eyebrow={`第 ${room.day} 天 · 提名`}
        title={!nominator ? "在圆桌上点提名者" : !nominee ? `${num(room, nominator)} 号提名…点被提名者` : `${num(room, nominator)} 号提名 ${num(room, nominee)} 号`}
      >
        <Checks
          items={[
            ...(nominator && !room.seats.find((s) => s.id === nominator)?.alive ? [{ ok: false, text: "提名者已死亡，死者不能提名" }] : []),
            ...(today.some((r) => r.nominator === nominator && nominator) ? [{ ok: false, text: "提名者今天已经提名过" }] : []),
            ...(today.some((r) => r.nominee === nominee && nominee) ? [{ ok: false, text: "被提名者今天已经被提名过" }] : []),
          ]}
        />
        <TaskActions>
          <button
            className="primary"
            disabled={busy || !nominator || !nominee}
            onClick={async () => {
              if (await act({ type: "open_vote", nominator, nominee })) onReset();
            }}
          >
            开始举手投票
          </button>
          <button onClick={onReset}>取消</button>
        </TaskActions>
        <div className="task-links">
          <button className="link-button" onClick={openLog}>
            改为直接登记现场投票…
          </button>
        </div>
      </TaskCard>
    );
  return (
    <TaskCard eyebrow={`第 ${room.day} 天`} title={today.length ? "继续讨论与提名" : "自由讨论"}>
      <DayTimer room={room} send={send} />
      <TaskActions>
        <button className="primary" onClick={onPick}>
          发起提名
        </button>
      </TaskActions>
      <TaskNote>
        讨论结束后点右上角「进入下一夜」。特殊处决（如贞洁者）请点那名玩家的座位登记。
      </TaskNote>
    </TaskCard>
  );
}
