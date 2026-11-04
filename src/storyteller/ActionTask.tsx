import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { choiceSentence } from "../../shared/action-choice";
import { ROLES, roleName, type Team } from "../../shared/roles";
import { firstInformationTeam, randomFirstInformation } from "../../shared/first-information";
import type { Send } from "../useRoom";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import RulingCorrection from "../components/RulingCorrection";
import { Checks, TaskActions, TaskCard, TaskNote, type CheckItem } from "./TaskCard";
import { actorChecks, effectChecks } from "./checks";

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

function parsePair(room: RoomView, text: string) {
  const m = /^(\d+)号、(\d+)号中有一人是(.+)$/.exec(text);
  const seat = (n?: string) => room.seats.find((s) => String(s.number) === n)?.id ?? "";
  return { a: seat(m?.[1]), b: seat(m?.[2]), roleId: roleIdByName(m?.[3]) };
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

/** Pick the answer with the control that fits the role, pre-filled with the truth when healthy. */
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
  // The selects start from the suggested sentence, so they always say the same thing.
  const [pair, setPair] = useState(() => parsePair(room, value));
  const others = [...room.seats]
    .filter((s) => s.id !== action.seatId)
    .sort((x, y) => x.number - y.number);
  if (custom || kind === "text")
    return (
      <label className="field answer-text">
        发给 {room.seats.find((s) => s.id === action.seatId)?.number} 号的内容
        <input value={value} maxLength={2000} onChange={(e) => onChange(e.target.value)} placeholder="写下要告诉玩家的信息" />
      </label>
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
    setPair(next);
    if (next.a && next.b && next.a !== next.b && next.roleId) onChange(pairText(room, next.a, next.b, next.roleId));
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
        <button
          type="button"
          className="link-button"
          onClick={() => {
            const r = randomFirstInformation(room, action);
            if (r) update({ a: r.targets[0], b: r.targets[1], roleId: r.roleId });
          }}
        >
          随机换一组
        </button>
        {team === "outsider" && (
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
  const [answer, setAnswer] = useState(() => defaultAnswer(room, action));
  const [reply, setReply] = useState("已收到");
  const number = room.seats.find((s) => s.id === action.seatId)?.number;
  const kind = answerKind(action);
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  const resolve = (resolution: "OFFLINE" | "CANCELLED") =>
    act({
      type: "resolve_action",
      actionId: action.id,
      resolution,
      reason: resolution === "OFFLINE" ? "说书人线下处理" : "说书人取消",
    });
  const fallback = (
    <details className="task-more">
      <summary>线下处理或取消</summary>
      <div className="task-links">
        <button className="link-button" disabled={busy} onClick={() => void resolve("OFFLINE")}>
          已在线下处理
        </button>
        <button className="link-button" disabled={busy} onClick={() => void resolve("CANCELLED")}>
          取消这一项
        </button>
      </div>
    </details>
  );

  if (completedAction(action))
    return (
      <TaskCard eyebrow={eyebrow} title={action.status === "DELIVERED" ? `已回复 ${number} 号` : "已处理"}>
        {action.response && <div className="answer-sent">{action.response}</div>}
        {action.resolutionReason && <TaskNote>{action.resolutionReason}</TaskNote>}
        {action.status === "DELIVERED" && (
          <details className="task-more">
            <summary>更正这条回复</summary>
            <RulingCorrection room={room} action={action} send={send} />
          </details>
        )}
      </TaskCard>
    );

  if (action.status === "REQUESTED")
    return (
      <TaskCard eyebrow={eyebrow} title={`等待 ${number} 号选择…`} waiting>
        <TaskNote>{number} 号的手机上正在显示：{action.prompt}</TaskNote>
        <TaskActions>
          {onSkip && (
            <button onClick={onSkip}>先处理下一项</button>
          )}
        </TaskActions>
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
    const unusual = checks.some((c) => !c.ok) || action.choiceKind === "master";
    const target = room.seats.find((s) => s.id === action.targets[0])?.number;
    const effect = action.choiceKind as "poison" | "protect" | "kill";
    const effectLabel =
      effect === "kill" ? `${target} 号死亡` : effect === "poison" ? `${target} 号中毒` : `${target} 号受保护`;
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
        <TaskActions>
          {action.choiceKind === "master" ? (
            <button className="primary" disabled={busy} onClick={() => void apply(false)}>
              记下主人 · 回复「{reply || "已收到"}」
            </button>
          ) : unusual ? (
            <>
              <button className="primary" disabled={busy} onClick={() => void apply(false)}>
                不生效 · 回复「{reply || "已收到"}」
              </button>
              <button disabled={busy} onClick={() => void apply(true, true)}>
                仍然让{effectLabel}
              </button>
            </>
          ) : (
            <>
              <button className="primary" disabled={busy} onClick={() => void apply(true)}>
                {effectLabel} · 回复「{reply || "已收到"}」
              </button>
              <button disabled={busy} onClick={() => void apply(false)}>
                不生效，只回复
              </button>
            </>
          )}
        </TaskActions>
        <details className="task-more">
          <summary>改回复内容</summary>
          <input aria-label="回复内容" value={reply} maxLength={200} onChange={(e) => setReply(e.target.value)} />
        </details>
        {fallback}
      </TaskCard>
    );
  }

  const ref = action.reference;
  const checks: CheckItem[] = [
    ...actorChecks(room, action),
    ...(ref?.warnings ?? [])
      .filter((w) => w.includes("特殊登记") || w.includes("误判目标"))
      .map((w) => ({ ok: false, text: w.replace(/，.*$/, "") })),
  ];
  const impaired = !!ref?.impaired;
  return (
    <TaskCard eyebrow={eyebrow} title={title}>
      <Checks items={checks} />
      {ref && <p className="task-truth">真实情况：{ref.actual}</p>}
      <InformationAnswer room={room} action={action} value={answer} onChange={setAnswer} />
      <TaskActions>
        <button
          className="primary"
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
          {answer.trim() ? `发送「${answer.trim().length > 16 ? `${answer.trim().slice(0, 16)}…` : answer.trim()}」` : impaired ? "选择要给的（假）信息" : "选择答案"}
        </button>
      </TaskActions>
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

