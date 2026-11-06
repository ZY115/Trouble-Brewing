import { localKey, useLocalState } from "../localState";
import PlayerConnection from "./PlayerConnection";
import { useEffect, useRef, useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { choiceSentence } from "../../shared/action-choice";
import { ROLES, roleById, roleName, type Team } from "../../shared/roles";
import { firstInformationTeam, randomFirstInformation } from "../../shared/first-information";
import type { Send } from "../useRoom";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import RulingCorrection from "../components/RulingCorrection";
import TargetEditor from "./TargetEditor";
import { Checks, TaskActions, TaskCard, TaskNote, type CheckItem } from "./TaskCard";
import { actorChecks, effectChecks, impaired as impairedSeat } from "./checks";

type Kind = "effect" | "yesno" | "number" | "role" | "pair" | "text";

function answerKind(a: NightAction): Kind {
  if (["poison", "protect", "kill", "master"].includes(a.choiceKind ?? "")) return "effect";
  switch (a.referenceRoleId) {
    case "fortuneteller":
      return "yesno";
    case "chef":
    case "empath":
      return "number";
    case "ravenkeeper":
    case "undertaker":
      return "role";
    case "washerwoman":
    case "librarian":
    case "investigator":
      return "pair";
    default:
      return "text";
  }
}

const roleIdByName = (name?: string) => ROLES.find((r) => r.name === name)?.id ?? "";
const pairText = (room: RoomView, a: string, b: string, roleId: string) =>
  `${room.seats.find((s) => s.id === a)?.number}号、${room.seats.find((s) => s.id === b)?.number}号中有一人是${roleName(roleId)}`;

function randomFalsePair(room: RoomView, action: NightAction) {
  const st = room.storyteller!;
  const team = firstInformationTeam(action.referenceRoleId ?? "");
  const roles = ROLES.filter((r) => r.team === team);
  if (!roles.length) return null;
  const role = roles[Math.floor(Math.random() * roles.length)];
  const pool = room.seats.filter((s) => s.id !== action.seatId && st.assignments[s.id]?.actualRoleId !== role.id);
  if (pool.length < 2) return null;
  const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const b = pool[Math.floor(Math.random() * pool.length)];
  return { targets: [a.id, b.id], roleId: role.id };
}

function grimoireSummary(room: RoomView) {
  const st = room.storyteller!;
  return [...room.seats]
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const a = st.assignments[s.id];
      const c = st.conditions[s.id];
      const notes = [
        a && a.perceivedRoleId !== a.actualRoleId ? `以为是${roleName(a.perceivedRoleId)}` : "",
        c?.poisoned ? "中毒" : "",
        c?.protected ? "受保护" : "",
        c?.drunk ? "醉酒" : "",
        st.redHerring === s.id ? "占卜误判" : "",
        s.alive ? "" : "已死亡",
      ].filter(Boolean);
      return `${s.number}号${roleName(a?.actualRoleId ?? "")}${notes.length ? `（${notes.join("、")}）` : ""}`;
    })
    .join("；");
}

function parsePair(room: RoomView, text: string) {
  const m = /^(\d+)号、(\d+)号中有一人是(.+)$/.exec(text);
  const seat = (n?: string) => room.seats.find((s) => String(s.number) === n)?.id ?? "";
  return { a: seat(m?.[1]), b: seat(m?.[2]), roleId: roleIdByName(m?.[3]) };
}

function pairHolds(room: RoomView, text: string) {
  const { a, b, roleId } = parsePair(room, text);
  if (!a || !b || !roleId) return true;
  const st = room.storyteller!;
  return [a, b].some((id) => st.assignments[id]?.actualRoleId === roleId);
}

function Chips({
  options,
  value,
  onPick,
  label,
}: {
  options: string[];
  value: string;
  onPick: (v: string) => void;
  label: string;
}) {
  return (
    <div className="answer-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function InformationAnswer({
  room,
  action,
  value,
  onChange,
}: {
  room: RoomView;
  action: NightAction;
  value: string;
  onChange: (v: string) => void;
}) {
  const kind = answerKind(action);
  const [custom, setCustom] = useState(false);
  const [pairDraft, setPairDraft] = useState(() => ({ value, pair: parsePair(room, value) }));
  const pair = pairDraft.value === value ? pairDraft.pair : parsePair(room, value);
  if (pairDraft.value !== value) setPairDraft({ value, pair });
  const others = [...room.seats]
    .filter((s) => s.id !== action.seatId)
    .sort((x, y) => x.number - y.number);
  if (custom || kind === "text")
    return (
      <>
        <label className="field answer-text">
          发给 {room.seats.find((s) => s.id === action.seatId)?.number} 号的内容
          <input value={value} maxLength={2000} onChange={(e) => onChange(e.target.value)} placeholder="写下要告诉玩家的信息" />
        </label>
        {action.referenceRoleId === "spy" && (
          <div className="task-links">
            <button type="button" className="link-button" onClick={() => onChange(grimoireSummary(room))}>
              填入魔典摘要
            </button>
          </div>
        )}
      </>
    );
  const switchToText = (
    <button type="button" className="link-button" onClick={() => setCustom(true)}>
      改用自定义文字
    </button>
  );
  if (kind === "yesno")
    return (
      <>
        <Chips label="查验结果" options={["是", "否"]} value={value} onPick={onChange} />
        {switchToText}
      </>
    );
  if (kind === "number") {
    const max = action.referenceRoleId === "empath" ? 2 : 5;
    return (
      <>
        <Chips label="数字" options={Array.from({ length: max + 1 }, (_, i) => String(i))} value={value} onPick={onChange} />
        {switchToText}
      </>
    );
  }
  if (kind === "role") {
    return (
      <>
        <Picker
          label="告诉玩家的角色"
          value={value}
          options={roleOptions(ROLES, "name")}
          onChange={onChange}
          placeholder="选择角色"
          clearable={false}
        />
        {switchToText}
      </>
    );
  }
  const team = firstInformationTeam(action.referenceRoleId ?? "") as Team;
  const update = (next: typeof pair) => {
    const answer = next.a && next.b && next.a !== next.b && next.roleId
      ? pairText(room, next.a, next.b, next.roleId)
      : "";
    setPairDraft({ value: answer, pair: next });
    onChange(answer);
  };
  return (
    <>
      <div className="pair-editor">
        <Picker
          label="玩家一"
          value={pair.a}
          options={seatOptions(others, [pair.b])}
          onChange={(v) => update({ ...pair, a: v })}
          placeholder="选号码"
          clearable={false}
        />
        <Picker
          label="玩家二"
          value={pair.b}
          options={seatOptions(others, [pair.a])}
          onChange={(v) => update({ ...pair, b: v })}
          placeholder="选号码"
          clearable={false}
        />
        <Picker
          label="其中一人是"
          value={pair.roleId}
          options={roleOptions(ROLES.filter((r) => r.team === team))}
          onChange={(v) => update({ ...pair, roleId: v })}
          placeholder="选角色"
          clearable={false}
        />
      </div>
      <div className="task-links">
        {action.reference?.impaired && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const r = randomFalsePair(room, action);
              if (r) update({ a: r.targets[0], b: r.targets[1], roleId: r.roleId });
            }}
          >
            随机一组假信息
          </button>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            const r = randomFirstInformation(room, action);
            if (r) update({ a: r.targets[0], b: r.targets[1], roleId: r.roleId });
          }}
        >
          {action.reference?.impaired ? "随机一组真信息" : "随机换一组"}
        </button>
        {team === "outsider" &&
          (action.reference?.impaired ||
            !room.seats.some((s) => roleById(room.storyteller!.assignments[s.id]?.actualRoleId)?.team === "outsider")) && (
          <button type="button" className="link-button" onClick={() => onChange("0（没有外来者）")}>
            告诉他没有外来者
          </button>
        )}
        {switchToText}
      </div>
    </>
  );
}

function defaultAnswer(room: RoomView, a: NightAction) {
  const ref = a.reference;
  if (!ref || ref.impaired) return "";
  if (answerKind(a) === "pair") {
    const r = randomFirstInformation(room, a);
    if (r) return pairText(room, r.targets[0], r.targets[1], r.roleId);
  }
  return ref.suggestedResponse ?? "";
}

const DEAD_RULE = "在他的回合前已经死亡，不再醒来（守鸦人除外）";

function MayorBounce({
  room,
  mayor,
  busy,
  onPick,
}: {
  room: RoomView;
  mayor: string;
  busy: boolean;
  onPick: (seatId: string, dies: boolean) => void;
}) {
  const st = room.storyteller!;
  const [other, setOther] = useState("");
  const n = room.seats.find((s) => s.id === other)?.number;
  const safe = !other
    ? ""
    : st.conditions[other]?.protected
      ? `${n} 号受保护`
      : st.assignments[other]?.actualRoleId === "soldier" && !impairedSeat(room, other)
        ? `${n} 号是士兵`
        : "";
  return (
    <div className="mayor-bounce">
      <Picker
        label="谁代替镇长死亡"
        value={other}
        options={seatOptions(room.seats.filter((s) => s.alive && s.id !== mayor))}
        onChange={setOther}
        clearable={false}
      />
      {other && (
        <button className="primary" disabled={busy} onClick={() => onPick(other, !safe)}>
          {safe ? `无人死亡（${safe}）` : `${n} 号代替镇长死亡`}
        </button>
      )}
    </div>
  );
}

export default function ActionTask({
  room,
  send,
  action,
  eyebrow,
  onSkip,
}: {
  room: RoomView;
  send: Send;
  action: NightAction;
  eyebrow: string;
  onSkip?: () => void;
}) {
  const st = room.storyteller!;
  const [busy, setBusy] = useState(false);
  const selection = `${action.selectionVersion ?? 0}:${action.reference ? 1 : 0}`;
  const pairKind = answerKind(action) === "pair";
  const [drawnPair, setDrawnPair] = useLocalState<string | null>(localKey(room, `auto:${action.id}:${selection}`), null);
  const drawn = useRef<{ key: string; value: string } | null>(null);
  if (pairKind && drawn.current?.key !== selection)
    drawn.current = { key: selection, value: drawnPair ?? defaultAnswer(room, action) };
  const truthful = pairKind && !action.reference?.impaired;
  const stalePair = truthful && !!drawnPair && !pairHolds(room, drawnPair);
  if (stalePair && drawn.current) drawn.current = { key: selection, value: defaultAnswer(room, action) };
  const suggested = pairKind ? ((stalePair ? drawn.current?.value : drawnPair) ?? drawn.current?.value ?? "") : defaultAnswer(room, action);
  useEffect(() => {
    if (pairKind && (drawnPair === null || stalePair) && suggested) setDrawnPair(suggested);
  }, [selection, stalePair]);
  const [manual, setAnswer] = useLocalState<string | null>(localKey(room, `manual:${action.id}:${selection}`), null);
  const answer = manual ?? suggested;
  const outdated = !pairKind && manual !== null && !!suggested && manual.trim() !== suggested;
  const brokenPair = truthful && manual !== null && !pairHolds(room, manual);
  const [reply, setReply] = useLocalState(localKey(room, `reply:${action.id}`), "已收到");
  const [bouncing, setBouncing] = useState(false);
  const [editing, setEditing] = useState(false);
  const number = room.seats.find((s) => s.id === action.seatId)?.number;
  const kind = answerKind(action);
  const actor = room.seats.find((s) => s.id === action.seatId);
  const gone =
    !!actor && !actor.alive && (action.referenceRoleId ?? st.assignments[action.seatId]?.perceivedRoleId) !== "ravenkeeper";
  const skipDead = () =>
    act({ type: "resolve_action", actionId: action.id, resolution: "CANCELLED", reason: "玩家已死亡，本夜不再行动" });
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  const fallback = (
    <details className="task-more">
      <summary>取消这一项</summary>
      <div className="task-links">
        <button
          className="link-button"
          disabled={busy}
          onClick={() =>
            void act({ type: "resolve_action", actionId: action.id, resolution: "CANCELLED", reason: "说书人取消" })
          }
        >
          确认取消，今晚不处理
        </button>
      </div>
    </details>
  );
  const editor = editing && action.targetCount > 0 && (
    <TargetEditor room={room} send={send} action={action} onDone={() => setEditing(false)} />
  );
  const changeTargets = action.targetCount > 0 && !editing && (
    <div className="task-links">
      <button className="link-button" disabled={busy} onClick={() => setEditing(true)}>
        {action.choiceKind === "master" ? "改主人…" : "改目标…"}
      </button>
    </div>
  );

  if (completedAction(action))
    return (
      <TaskCard
        eyebrow={eyebrow}
        title={action.status !== "DELIVERED" ? "已处理" : kind === "effect" ? `${number} 号这一步已完成` : `已告诉 ${number} 号`}
      >
        {action.response && (kind !== "effect" || action.response !== "已收到") && (
          <div className="answer-sent">{action.response}</div>
        )}
        {action.resolutionReason && <TaskNote>{action.resolutionReason}</TaskNote>}
        {action.status === "DELIVERED" && (
          <RulingCorrection room={room} action={action} send={send} />
        )}
      </TaskCard>
    );

  if (action.status === "REQUESTED")
    return (
      <TaskCard eyebrow={eyebrow} title={gone ? `${number} 号今晚已死亡` : `等待 ${number} 号选择…`} waiting={!gone}>
        {gone ? (
          <Checks items={[{ ok: false, text: DEAD_RULE }]} />
        ) : (
          <TaskNote>{`${number} 号尚未提交选择。待办内容：${action.prompt}`}</TaskNote>
        )}
        {!gone && <PlayerConnection room={room} seatId={action.seatId} />}
        {editor || (
          <TaskActions>
            {gone && (
              <button className="primary" disabled={busy} onClick={() => void skipDead()}>
                跳过：{number} 号已死亡
              </button>
            )}
            {!gone && action.targetCount > 0 && (
              <button disabled={busy} onClick={() => setEditing(true)}>
                替他选择…
              </button>
            )}
            {onSkip && <button onClick={onSkip}>先处理下一项</button>}
          </TaskActions>
        )}
        {fallback}
      </TaskCard>
    );

  const title = action.targets.length
    ? choiceSentence(action, room.seats, action.targets, `${number} 号 `)
    : action.referenceRoleId
      ? `给 ${number} 号（${roleName(action.referenceRoleId)}）信息`
      : `给 ${number} 号信息`;
  const version = action.selectionVersion ?? 0;

  if (kind === "effect") {
    const checks = effectChecks(room, action);
    const victim = action.targets[0];
    const mayor =
      action.choiceKind === "kill" &&
      st.assignments[victim]?.actualRoleId === "mayor" &&
      !st.conditions[victim]?.protected &&
      !impairedSeat(room, victim) &&
      st.assignments[action.seatId]?.actualRoleId === "imp" &&
      !impairedSeat(room, action.seatId) &&
      !!actor?.alive &&
      room.day > 1;
    const unusual = !mayor && (checks.some((c) => !c.ok) || action.choiceKind === "master");
    const target = room.seats.find((s) => s.id === action.targets[0])?.number;
    const actorRole = st.assignments[action.seatId]?.actualRoleId;
    const expectedRole = { poison: "poisoner", protect: "monk", kill: "imp" }[action.choiceKind as "poison" | "protect" | "kill"];
    const why = !actor?.alive
      ? `${number} 号已死亡`
      : expectedRole && actorRole !== expectedRole && actorRole !== "drunk"
        ? `${number} 号没有这个能力`
        : actorRole === "drunk"
        ? `${number} 号是酒鬼`
        : st.conditions[action.seatId]?.poisoned
          ? `${number} 号中毒`
          : st.conditions[action.seatId]?.drunk
            ? `${number} 号醉酒`
            : action.choiceKind === "kill" && st.conditions[victim]?.protected
              ? `${target} 号受保护`
              : action.choiceKind === "kill" && st.assignments[victim]?.actualRoleId === "soldier"
                ? `${target} 号是士兵`
                : mayor
                  ? `${target} 号是镇长`
                  : action.choiceKind === "protect" && victim === action.seatId
                    ? "不能保护自己"
                    : room.day === 1
                      ? "首夜不行动"
                      : "";
    const effect = action.choiceKind as "poison" | "protect" | "kill";
    const effectLabel =
      effect === "kill"
        ? `${target} 号死亡${victim === action.seatId ? "（自杀传位）" : ""}`
        : effect === "poison"
          ? `${target} 号中毒`
          : `${target} 号受保护`;
    const apply = (withEffect: boolean, force = false) =>
      act({
        type: "apply_action",
        actionId: action.id,
        effect: withEffect ? effect : "none",
        response: reply.trim() || "已收到",
        force,
        expectedVersion: version,
        expectedContextVersion: st.contextVersion,
      });
    return (
      <TaskCard eyebrow={eyebrow} title={title}>
        <Checks items={checks} />
        {editor || (
        <TaskActions>
          {mayor ? (
            <>
              <button className="primary" disabled={busy} onClick={() => void apply(true)}>
                {effectLabel}
              </button>
              <button disabled={busy} aria-expanded={bouncing} onClick={() => setBouncing(!bouncing)}>
                改为另一名玩家死亡…
              </button>
            </>
          ) : action.choiceKind === "master" ? (
            <button className="primary" disabled={busy} onClick={() => void apply(false)}>
              记下：{target} 号是主人
            </button>
          ) : unusual ? (
            <>
              <button className="primary" disabled={busy} onClick={() => void apply(false)}>
                不生效{why ? `（${why}）` : ""}
              </button>
              <button disabled={busy} onClick={() => void apply(true, true)}>
                仍然让 {effectLabel}
              </button>
            </>
          ) : (
            <>
              <button className="primary" disabled={busy} onClick={() => void apply(true)}>
                {effectLabel}
              </button>
              <button disabled={busy} onClick={() => void apply(false)}>
                不生效
              </button>
            </>
          )}
        </TaskActions>
        )}
        {changeTargets}
        {mayor && bouncing && (
          <MayorBounce
            room={room}
            mayor={action.targets[0]}
            busy={busy}
            onPick={async (other, dies) => {
              setBusy(true);
              const spared = await send({
                type: "apply_action",
                actionId: action.id,
                effect: "none",
                response: reply.trim() || "已收到",
                force: false,
                expectedVersion: version,
                expectedContextVersion: st.contextVersion,
              });
              if (spared && dies) await send({ type: "set_alive", seatId: other, alive: false, reason: `代替 ${target} 号镇长死亡` });
              setBusy(false);
            }}
          />
        )}
        <details className="task-more">
          <summary>玩家手机上显示「{reply.trim() || "已收到"}」 · 修改</summary>
          <input aria-label="发给玩家的回复" value={reply} maxLength={200} onChange={(e) => setReply(e.target.value)} />
        </details>
        {fallback}
      </TaskCard>
    );
  }

  const ref = action.reference;
  const checks: CheckItem[] = [
    ...(gone ? [{ ok: false, text: DEAD_RULE }] : []),
    ...(gone ? [] : actorChecks(room, action)),
    ...(ref?.warnings ?? [])
      .filter((w) => w.includes("特殊登记") || w.includes("误判目标"))
      .map((w) => ({ ok: false, text: w.replace(/，.*$/, "") })),
  ];
  const impaired = !!ref?.impaired;
  const answerControls = (
    <>
      {ref && kind !== "pair" && !ref.actual.includes("没有自动计算项") && <p className="task-truth">真实情况：{ref.actual}</p>}
      <InformationAnswer key={selection} room={room} action={action} value={answer} onChange={setAnswer} />
      {brokenPair ? (
        <div className="task-links">
          <span className="muted">身份有变化，这组信息现在不成立</span>
          <button className="link-button" onClick={() => setAnswer(null)}>
            换成新的建议
          </button>
        </div>
      ) : outdated ? (
        <div className="task-links">
          <span className="muted">你改过答案，按现在的情况系统建议「{suggested}」</span>
          <button className="link-button" onClick={() => setAnswer(null)}>
            改用建议
          </button>
        </div>
      ) : (
        !pairKind && manual === null && !!suggested && <p className="answer-source">自动建议</p>
      )}
      <TaskActions>
        <button
          className={gone ? "" : "primary"}
          disabled={busy || !answer.trim()}
          onClick={() =>
            void act({
              type: "send_action_response",
              actionId: action.id,
              response: answer.trim(),
              expectedVersion: version,
              expectedContextVersion: st.contextVersion,
            })
          }
        >
          {answer.trim()
            ? `发送「${answer.trim().length > 16 ? `${answer.trim().slice(0, 16)}…` : answer.trim()}」`
            : kind === "text"
              ? "填写内容后发送"
              : impaired
                ? "选择要给的（假）信息"
                : "选择答案"}
        </button>
      </TaskActions>
    </>
  );
  return (
    <TaskCard eyebrow={eyebrow} title={title}>
      <Checks items={checks} />
      {gone ? (
        <>
          <TaskActions>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void skipDead()}
            >
              跳过：{number} 号已死亡
            </button>
          </TaskActions>
          <details className="task-more">
            <summary>仍要给他信息…</summary>
            {answerControls}
          </details>
        </>
      ) : (
        editor || answerControls
      )}
      {!gone && changeTargets}
      {!!ref?.evidence.length && (
        <details className="task-more">
          <summary>查看依据</summary>
          <ul className="task-evidence">
            {ref.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {fallback}
    </TaskCard>
  );
}

