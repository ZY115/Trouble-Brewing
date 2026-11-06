import PublishLifeButton from "../components/PublishLifeButton";
import { useState } from "react";
import type { NightPlanItem, RoomView, RuleNotice } from "../../shared/types";
import { isEvil, roleById, roleName } from "../../shared/roles";
import { phaseReview } from "../../shared/phase-review";
import type { Send } from "../useRoom";
import PhaseControls from "../components/PhaseControls";
import DayTimer from "../components/DayTimer";
import ActionTask from "./ActionTask";
import { executedToday } from "./tasks";
import { nominations, saintWarning, virginCheck } from "./rules";
import { draftVotes, voteEditKey, type VoteEdits } from "./voteDraft";
import { useCountdown } from "../components/useCountdown";
import { useLocalState } from "../localState";
import { Checks, TaskActions, TaskCard, TaskNote } from "./TaskCard";
import { SlayerTask } from "./SlayerShot";
import { BluffPickers, bluffSummary } from "./Bluffs";

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
  if (notice.kind === "effect") {
    const effects = notice.effects ?? [];
    const label = effects.map((e) => `${num(room, e.seatId)} 号${e.condition === "poisoned" ? "中毒" : "受保护"}`).join("、");
    return (
      <TaskCard eyebrow="规则提醒" title="持续效果应当结束">
        <TaskNote>{notice.text}</TaskNote>
        <TaskActions>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              let version = st.contextVersion;
              for (const e of effects) {
                if (!(await act({ type: "set_condition", seatId: e.seatId, condition: e.condition, value: false, expectedContextVersion: version }))) return;
                version++;
              }
            }}
          >
            解除：{label}
          </button>
          <button disabled={busy} onClick={() => void act({ type: "resolve_notice", noticeId: notice.id, ...guard })}>
            保持（我来裁定）
          </button>
        </TaskActions>
      </TaskCard>
    );
  }
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
      <TaskActions>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (await act({ type: "generate_night_plan", ...guard }))
              await act({ type: "start_all_plan", expectedPhaseVersion: st.phaseVersion, expectedPlanVersion: st.planVersion + 1 });
          }}
        >
          生成夜序并发给所有玩家
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
      <TaskCard
        eyebrow={eyebrow}
        title={
          item.roleId === "ravenkeeper"
            ? st.assignments[item.seatId]?.actualRoleId === "ravenkeeper"
              ? `${num(room, item.seatId)} 号守鸦人今晚死亡`
              : `${num(room, item.seatId)} 号今晚死亡（${roleName(st.assignments[item.seatId]?.actualRoleId)}，以为自己是守鸦人）`
            : `还没发给 ${num(room, item.seatId)} 号`
        }
      >
        {item.roleId === "ravenkeeper" && <TaskNote>唤醒他选一名玩家，告诉他该玩家的角色。</TaskNote>}
        <TaskActions>
          <button className="primary" disabled={busy} onClick={() => void op("start")}>
            发给 {num(room, item.seatId)} 号
          </button>
          <button disabled={busy} onClick={() => void op("skip")}>
            跳过
          </button>
        </TaskActions>
        <div className="task-links">
          <button className="link-button" disabled={busy} onClick={() => void op("start")}>
            线下进行，我来录入
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
          {minions.map((s) => `${s.number} 号`).join("、") || "无"}
          {st.evilInfoSent && ` · 假身份：${bluffSummary(room, roleName)}`}
        </p>
        {!st.evilInfoSent && (
          <>
            <span className="task-label">给恶魔的三个假身份</span>
            <BluffPickers room={room} send={send} />
          </>
        )}
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
          <button
            className={st.evilInfoSent ? "primary" : ""}
            disabled={busy}
            onClick={async () => {
              if (st.evilInfoSent || (await act({ type: "send_evil_info", offline: true, expectedContextVersion: st.contextVersion })))
                await op("offline");
            }}
          >
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
        <TaskNote>{item.note || "核对圆桌上的中毒、保护、醉酒标记。"}</TaskNote>
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
        {lines.filter((l) => !l.startsWith("清单还有 0 项")).slice(0, 5).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <TaskActions>
        <PhaseControls room={room} send={send} part="button" direct />
      </TaskActions>
    </TaskCard>
  );
}

export function PublishTask({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const pending = room.seats.filter((s) => s.alive !== st.publishedAlive[s.id]);
  return (
    <TaskCard eyebrow={`第 ${room.day} 天`} title="有生死变化还没公布">
      <Checks items={pending.map((s) => ({ ok: false, text: `${s.number} 号${s.alive ? "恢复存活" : "死亡"}` }))} />
      <TaskActions>
        <PublishLifeButton room={room} send={send} seatIds={pending.map((s) => s.id)} label="现在公布" primary />
      </TaskActions>
    </TaskCard>
  );
}

const COUNTDOWN = 10;

export function VoteTask({ room, send }: { room: RoomView; send: Send }) {
  const vote = room.liveVote!;
  const { busy, act } = useAct(send);
  const [cancel, setCancel] = useState("");
  const [edits, setEdits] = useLocalState<VoteEdits>(voteEditKey(room, vote.id), {});
  const left = useCountdown(vote.status === "OPEN" ? vote.closesInMs : undefined);
  const living = room.seats.filter((s) => s.alive).length;
  const needed = Math.ceil(living / 2);
  const locked = vote.status === "COUNTING";
  const draft = draftVotes(room, vote, edits);
  const raised = vote.order.filter((id) => vote.hands[id] && draft.eligible(id)).length;
  const count = locked ? draft.voters.length : raised;
  const butlerNotes = Object.values(draft.butler);
  return (
    <TaskCard
      eyebrow={`第 ${room.day} 天 · ${locked ? "举手已锁定" : "投票"}`}
      title={`${num(room, vote.nominator)} 号提名 ${num(room, vote.nominee)} 号`}
    >
      <div className="vote-tally">
        <span className="tally">{count}</span>
        <span className="muted">
          {locked ? "票" : "人举手"} · 处决至少 {needed} 票
        </span>
        {left !== null && <span className="vote-countdown">{left} 秒后锁定</span>}
      </div>
      <div className={`vote-grid${locked ? " editable" : ""}`} role="group" aria-label={locked ? "核对票数" : "举手情况"}>
        {vote.order.map((id) => {
          const eligible = draft.eligible(id);
          const on = locked ? draft.votes(id) : !!vote.hands[id] && eligible;
          const dead = vote.deadAtVote.includes(id) ? " dead" : "";
          const tag = !eligible
            ? "无票"
            : locked && draft.butler[id]
              ? "管家"
              : locked && draft.changed(id)
                ? "已改"
                : dead && on
                  ? "死者票"
                  : "";
          const label = `${num(room, id)} 号${on ? "投票" : "未投"}${tag ? `（${tag}）` : ""}`;
          return locked ? (
            <button
              key={id}
              className={`${on ? "on" : ""}${tag === "已改" ? " changed" : ""}${dead}`}
              aria-pressed={on}
              aria-label={label}
              disabled={busy || !eligible}
              onClick={() => setEdits(draft.toggle(id))}
            >
              {num(room, id)}
              {tag && <small>{tag}</small>}
            </button>
          ) : (
            <span key={id} className={`${on ? "on" : ""}${dead}`} aria-label={label}>
              {num(room, id)}
              {tag && <small>{tag}</small>}
            </span>
          );
        })}
      </div>
      {locked && butlerNotes.length > 0 && <Checks items={butlerNotes.map((text) => ({ ok: false, text }))} />}
      {locked && <TaskNote>点号码可以改票。</TaskNote>}
      <TaskActions>
        {locked ? (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (await act({ type: "finish_vote", voteId: vote.id, voters: draft.voters })) setEdits({});
            }}
          >
            确认 {draft.voters.length} 票
          </button>
        ) : left === null ? (
          <>
            <button className="primary" disabled={busy} onClick={() => void act({ type: "start_countdown", voteId: vote.id, seconds: COUNTDOWN })}>
              全体倒计时 {COUNTDOWN} 秒
            </button>
            <button disabled={busy} onClick={() => void act({ type: "lock_vote", voteId: vote.id })}>
              立即锁定
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={() => void act({ type: "lock_vote", voteId: vote.id })}>
            立即锁定
          </button>
        )}
      </TaskActions>
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

export function VerdictTask({
  room,
  send,
  recordId,
  onDismiss,
}: {
  room: RoomView;
  send: Send;
  recordId: string;
  onDismiss: () => void;
}) {
  const st = room.storyteller!;
  const { busy, act } = useAct(send);
  const living = room.seats.filter((s) => s.alive).length;
  const needed = Math.ceil(living / 2);
  const effective = room.publicRecords.filter(
    (r) => r.type === "vote" && r.day === room.day && !room.publicRecords.some((n) => n.supersedes === r.id),
  );
  const record = room.publicRecords.find((r) => r.id === recordId);
  const nomineeId = record?.nominee ?? "";
  const votes = record?.voters?.length ?? 0;
  const others = effective.filter((r) => r.id !== recordId && r.nominee !== nomineeId);
  const otherMax = Math.max(0, ...others.map((r) => r.voters?.length ?? 0));
  const hasExecution = !!executedToday(room);
  const leads = votes >= needed && votes > otherMax && !hasExecution;
  const nominee = room.seats.find((s) => s.id === nomineeId);
  const execute = () =>
    act({ type: "execute_player", seatId: nomineeId, reason: `得票 ${votes} 票`, confirmed: true, expectedContextVersion: st.contextVersion });
  return (
    <TaskCard eyebrow={`第 ${room.day} 天 · 计票结束`} title={`${nominee?.number} 号得 ${votes} 票`}>
      <Checks
        items={[
          votes >= needed ? { ok: true, text: `票数够处决（至少 ${needed} 票）` } : { ok: false, text: `票数不够处决（至少 ${needed} 票）` },
          ...(otherMax ? [votes > otherMax ? { ok: true, text: `高于今天其他提名（最高 ${otherMax} 票）` } : { ok: false, text: `今天另有提名得 ${otherMax} 票，${votes === otherMax ? "平票时通常无人被处决" : "票数更高"}` }] : []),
          ...(hasExecution ? [{ ok: false, text: "今天已经处决过" }] : []),
          ...(saintWarning(room, nomineeId) ? [{ ok: false, text: saintWarning(room, nomineeId) }] : []),
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
  const today = nominations(room).filter((r) => r.day === room.day);
  const virgin = nominator && nominee ? virginCheck(room, nominator, nominee) : null;
  const st = room.storyteller!;
  const [shooting, setShooting] = useState(false);
  if (shooting && !picking && !nominator) return <SlayerTask room={room} send={send} onDone={() => setShooting(false)} />;
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
            ...(virgin ? [{ ok: false, text: virgin.text }] : []),
          ]}
        />
        <TaskActions>
          {(virgin?.trigger || virgin?.optional) && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await act({
                    type: "execute_player",
                    seatId: nominator,
                    nominee,
                    reason: "提名贞洁者",
                    confirmed: true,
                    expectedContextVersion: st.contextVersion,
                  })
                )
                  onReset();
              }}
            >
              处决 {num(room, nominator)} 号（贞洁者）
            </button>
          )}
          <button
            className={virgin?.trigger || virgin?.optional ? "" : "primary"}
            disabled={busy || !nominator || !nominee}
            onClick={async () => {
              if (await act({ type: "open_vote", nominator, nominee })) onReset();
            }}
          >
            {virgin?.trigger ? "不触发，开始举手投票" : "开始举手投票"}
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
  const executed = executedToday(room);
  if (executed)
    return (
      <TaskCard eyebrow={`第 ${room.day} 天`} title={`今天已处决 ${num(room, executed.seatId)} 号`}>
        <TaskActions>
          <PhaseControls room={room} send={send} part="button" direct />
          <button onClick={onPick}>仍要继续提名</button>
          <button onClick={() => setShooting(true)}>猎手开枪…</button>
        </TaskActions>
      </TaskCard>
    );
  return (
    <TaskCard eyebrow={`第 ${room.day} 天`} title={today.length ? "继续讨论与提名" : "自由讨论"}>
      <DayTimer room={room} send={send} />
      <TaskActions>
        <button className="primary" onClick={onPick}>
          发起提名
        </button>
        <button onClick={() => setShooting(true)}>猎手开枪…</button>
        <PhaseControls room={room} send={send} part="button" quiet />
      </TaskActions>
    </TaskCard>
  );
}
