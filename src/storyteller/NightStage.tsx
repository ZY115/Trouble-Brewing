import { useState } from "react";
import type { NightAction, NightPlanItem, RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { choiceSentence } from "../../shared/action-choice";
import { roleName } from "../../shared/roles";
import type { Send } from "../useRoom";
import Grimoire, { type SeatRing } from "../ui/Grimoire";
import { ActionCard } from "../components/NightPanel";
import { seatNumber, storytellerSeats } from "./seats";

/** The same conditions the server checks before a one-tap effect, shown up front. */
function AutoCheck({ room, action }: { room: RoomView; action: NightAction }) {
  const st = room.storyteller!;
  if (completedAction(action) || action.status === "REQUESTED") return null;
  const n = (id: string) => seatNumber(room, id);
  const impaired = (id: string) =>
    !!st.conditions[id]?.poisoned ||
    !!st.conditions[id]?.drunk ||
    st.assignments[id]?.actualRoleId === "drunk";
  const items: { ok: boolean; text: string }[] = [];
  const target = action.targets[0];
  const actorDead = !room.seats.find((s) => s.id === action.seatId)?.alive;
  if (action.choiceKind === "kill" && target) {
    const role = st.assignments[target]?.actualRoleId;
    items.push(
      st.conditions[target]?.protected
        ? { ok: false, text: `${n(target)} 号受保护` }
        : { ok: true, text: `${n(target)} 号未受保护` },
      ["soldier", "mayor"].includes(role) && !impaired(target)
        ? { ok: false, text: `${n(target)} 号是${roleName(role)}，能力可能生效` }
        : { ok: true, text: `${n(target)} 号不是健康的士兵或镇长` },
    );
    if (room.day === 1) items.push({ ok: false, text: "首夜小恶魔通常不行动" });
  }
  if (action.choiceKind === "protect" && target === action.seatId)
    items.push({ ok: false, text: "僧侣不能保护自己" });
  items.push(
    impaired(action.seatId)
      ? { ok: false, text: `${n(action.seatId)} 号中毒或醉酒，结果由你决定` }
      : { ok: true, text: `${n(action.seatId)} 号未中毒、未醉酒` },
  );
  if (actorDead && action.referenceRoleId !== "ravenkeeper")
    items.push({ ok: false, text: `${n(action.seatId)} 号已死亡` });
  return (
    <div className="check-list" aria-label="自动核对">
      {items.map((i) => (
        <span key={i.text} className={`check-item ${i.ok ? "" : "warn"}`}>
          <i aria-hidden="true">{i.ok ? "✓" : "!"}</i>
          {i.text}
        </span>
      ))}
    </div>
  );
}

const SHORT: Record<string, string> = {
  核对本夜中毒醉酒保护与死亡状态: "入夜检查",
  发放首夜邪恶队友信息与假身份: "邪恶信息",
  核对猩红女郎继任: "猩红女郎检查",
};
const isEvilInfo = (i: NightPlanItem) => !i.seatId && i.prompt.includes("邪恶");

function shortLabel(room: RoomView, i: NightPlanItem) {
  if (i.seatId)
    return `${i.roleId ? roleName(i.roleId) : "自定义"} · ${seatNumber(room, i.seatId)}`;
  return SHORT[i.prompt.replace(/[、，,\s]/g, "")] ?? i.prompt.slice(0, 8);
}

export function itemDone(room: RoomView, i: NightPlanItem) {
  if (i.retiredReason || i.status === "skipped" || i.status === "offline")
    return true;
  if (i.status === "started") {
    const a = room.actions.find((x) => x.id === i.actionId);
    return !a || completedAction(a);
  }
  return false;
}

type Step =
  | { kind: "plan"; item: NightPlanItem }
  | { kind: "action"; action: NightAction };

function actionStatus(a?: NightAction) {
  if (!a) return "";
  if (completedAction(a)) return "";
  return a.status === "REQUESTED" ? "待选择" : "待裁定";
}

function StepCard({
  room,
  send,
  step,
  index,
  total,
}: {
  room: RoomView;
  send: Send;
  step?: Step;
  index: number;
  total: number;
}) {
  const st = room.storyteller!;
  const [busy, setBusy] = useState(false);
  const guard = {
    expectedPhaseVersion: st.phaseVersion,
    expectedPlanVersion: st.planVersion,
  };
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    const ok = await send(command);
    setBusy(false);
    return ok;
  }
  if (!step)
    return (
      <section className="step-card quiet stage-card" aria-label="本夜进度">
        <span className="step-who">
          {total ? "本夜清单已全部处理" : "还没有本夜清单"}
        </span>
        <span className="step-title">
          {total ? "可以宣布天亮" : "先生成清单"}
        </span>
        <p className="step-note">
          {total
            ? "点右上角「宣布天亮」，确认后所有玩家的屏幕会同时切到白天，并统一看到昨夜的信息。"
            : "清单按当前配板和夜序生成，可随时增删、调整。生成后一键发出全部玩家待办，所有人同时开始选择。"}
        </p>
      </section>
    );
  const item = step.kind === "plan" ? step.item : undefined;
  const action =
    step.kind === "action"
      ? step.action
      : room.actions.find((a) => a.id === item?.actionId);
  const seatId = item?.seatId ?? action?.seatId ?? "";
  const number = seatNumber(room, seatId);
  const who = item
    ? item.seatId
      ? `${roleName(item.roleId || st.assignments[seatId]?.perceivedRoleId)} · ${number} 号`
      : "说书人"
    : `${number} 号 · 自定义待办`;
  const title = action
    ? action.targets.length
      ? choiceSentence(action, room.seats, action.targets, "")
      : action.status === "REQUESTED"
        ? `等待 ${number} 号选择`
        : completedAction(action)
          ? "已处理"
          : "给信息"
    : item?.seatId
      ? `尚未发给 ${number} 号`
      : item
        ? shortLabel(room, item)
        : "";
  const done = item ? itemDone(room, item) : action && completedAction(action);
  return (
    <section className="step-card stage-card" aria-label={`当前步骤：${who}`}>
      <div className="step-head">
        <span className="step-badge">
          {index >= 0 ? `第 ${index + 1} 步` : "其他"}
        </span>
        <span className="step-who">{who}</span>
        {done && <span className="tag">已完成</span>}
      </div>
      <span className="step-title">{title}</span>
      {item?.note && !item.note.includes("请自行核对触发条件") && (
        <p className="step-note">{item.note}</p>
      )}
      {item?.retiredReason && <p className="step-note">{item.retiredReason}</p>}

      {item?.status === "planned" && item.seatId && (
        <div className="step-row">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void act({ type: "plan_item", itemId: item.id, operation: "start", ...guard })
            }
          >
            发给 {number} 号
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act({ type: "plan_item", itemId: item.id, operation: "offline", ...guard })
            }
          >
            线下完成
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act({ type: "plan_item", itemId: item.id, operation: "skip", ...guard })
            }
          >
            跳过
          </button>
        </div>
      )}
      {item?.status === "planned" && !item.seatId && (
        <div className="step-row">
          {isEvilInfo(item) && !st.evilInfoSent && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await act({
                    type: "send_evil_info",
                    expectedContextVersion: st.contextVersion,
                  })
                )
                  await act({
                    type: "plan_item",
                    itemId: item.id,
                    operation: "offline",
                    expectedPhaseVersion: st.phaseVersion,
                    expectedPlanVersion: st.planVersion,
                  });
              }}
            >
              一键私发邪恶信息与假身份
            </button>
          )}
          <button
            className={isEvilInfo(item) && !st.evilInfoSent ? "" : "primary"}
            disabled={busy}
            onClick={() =>
              void act({ type: "plan_item", itemId: item.id, operation: "offline", ...guard })
            }
          >
            {isEvilInfo(item) && !st.evilInfoSent ? "已线下告知" : "完成这一步"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act({ type: "plan_item", itemId: item.id, operation: "skip", ...guard })
            }
          >
            跳过
          </button>
        </div>
      )}
      {item &&
        ["skipped", "offline"].includes(item.status) &&
        !item.retiredReason && (
          <div className="step-row">
            <button
              disabled={busy}
              onClick={() =>
                void act({ type: "plan_item", itemId: item.id, operation: "restore", ...guard })
              }
            >
              恢复这一步
            </button>
          </div>
        )}
      {action && <AutoCheck room={room} action={action} />}
      {action && <ActionCard key={action.id} action={action} room={room} send={send} />}
    </section>
  );
}

export default function NightStage({
  room,
  send,
  onSeat,
  openPlan,
}: {
  room: RoomView;
  send: Send;
  onSeat: (seatId: string) => void;
  openPlan: () => void;
}) {
  const st = room.storyteller!;
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const items = st.nightPlan.filter((i) => i.night === room.day);
  const extras = room.actions.filter(
    (a) => a.night === room.day && !items.some((i) => i.actionId === a.id),
  );
  const steps: Step[] = [
    ...items.map((item) => ({ kind: "plan" as const, item })),
    ...extras.map((action) => ({ kind: "action" as const, action })),
  ];
  const stepId = (s: Step) => (s.kind === "plan" ? s.item.id : `action:${s.action.id}`);
  const stepDone = (s: Step) =>
    s.kind === "plan" ? itemDone(room, s.item) : completedAction(s.action);
  const current = steps.find((s) => !stepDone(s));
  const focused = steps.find((s) => stepId(s) === focus) ?? current;
  const focusedIndex = focused?.kind === "plan" ? items.indexOf(focused.item) : -1;
  const action =
    focused?.kind === "action"
      ? focused.action
      : room.actions.find((a) => a.id === focused?.item.actionId);
  const actorId = focused?.kind === "plan" ? focused.item.seatId : focused?.action.seatId;
  const rings: Record<string, SeatRing[]> = {};
  if (actorId) rings[actorId] = ["actor"];
  for (const t of action?.targets ?? []) rings[t] = [...(rings[t] ?? []), "target"];
  const lines = (action?.targets ?? [])
    .map((t) => ({ from: seatNumber(room, actorId) ?? 0, to: seatNumber(room, t) ?? 0, dashed: true }))
    .filter((l) => l.from && l.to && l.from !== l.to);
  const waiting = room.actions.filter(
    (a) => a.night === room.day && a.status === "REQUESTED",
  ).length;
  const guard = { expectedPhaseVersion: st.phaseVersion, expectedPlanVersion: st.planVersion };
  // Conditional roles are never bulk-started; the server skips them too.
  const canStartAll = items.some(
    (i) =>
      i.status === "planned" &&
      i.seatId &&
      !i.retiredReason &&
      !["undertaker", "ravenkeeper"].includes(i.roleId) &&
      room.seats.find((s) => s.id === i.seatId)?.alive,
  );
  const doneCount = steps.filter(stepDone).length;
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    const ok = await send(command);
    setBusy(false);
    return ok;
  }
  return (
    <>
      <nav className="st-rail" aria-label="夜序">
        <div className="rail-title">
          <span>{room.day === 1 ? "首夜" : `第 ${room.day} 夜`}</span>
          <span>{steps.length ? `${doneCount} / ${steps.length}` : ""}</span>
        </div>
        {steps.map((s, k) => {
          const id = stepId(s);
          const done = stepDone(s);
          const linked =
            s.kind === "action" ? s.action : room.actions.find((a) => a.id === s.item.actionId);
          const seat = s.kind === "plan" ? s.item.seatId : s.action.seatId;
          const poisoned = seat && st.conditions[seat]?.poisoned;
          return (
            <button
              key={id}
              className={`rail-item ${done ? "done" : ""} ${focused && stepId(focused) === id ? "current" : ""} ${s.kind === "plan" && s.item.status === "skipped" ? "skipped" : ""}`}
              onClick={() => setFocus(id)}
            >
              <span className="rail-dot">{done ? "✓" : k + 1}</span>
              {s.kind === "plan"
                ? shortLabel(room, s.item)
                : `自定义 · ${seatNumber(room, s.action.seatId)}`}
              <span className="rail-extra">
                {actionStatus(linked)}
                {poisoned && !done ? (
                  <span className="mark poison" style={{ marginLeft: 4 }}>毒</span>
                ) : null}
              </span>
            </button>
          );
        })}
        <div className="rail-actions">
          {!items.length && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await act({ type: "generate_night_plan", ...guard }))
                  await act({
                    type: "start_all_plan",
                    expectedPhaseVersion: st.phaseVersion,
                    expectedPlanVersion: st.planVersion + 1,
                  });
              }}
            >
              生成清单并全部发出
            </button>
          )}
          {canStartAll && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act({ type: "start_all_plan", ...guard })}
            >
              全部发出玩家待办
            </button>
          )}
          <button onClick={openPlan}>编辑清单 · 自定义待办</button>
          {focus && current && focused !== current && (
            <button className="ghost" onClick={() => setFocus("")}>
              回到当前一步
            </button>
          )}
        </div>
        <p className="step-note" style={{ marginTop: 12 }}>
          私聊即时送达；玩家统一在天亮后查看夜间裁定。
          {waiting ? ` 还有 ${waiting} 人未选择。` : ""}
        </p>
      </nav>
      <main className="st-stage">
        <div className="stage-row">
          <div className="stage-circle">
          <Grimoire
            label="魔典"
            capacity={room.capacity}
            seats={storytellerSeats(room, { rings })}
            lines={lines}
            onSeat={(s) => onSeat(s.key)}
            center={
              <>
                <span className="eyebrow">进行中</span>
                <span className="step-title" style={{ color: "var(--text)" }}>
                  {room.day === 1 ? "首夜" : `第 ${room.day} 夜`}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {steps.length ? `夜序 ${doneCount} / ${steps.length}` : "尚未生成清单"}
                </span>
              </>
            }
          />
          </div>
          <StepCard
            key={focused ? stepId(focused) : "none"}
            room={room}
            send={send}
            step={focused}
            index={focusedIndex}
            total={steps.length}
          />
        </div>
        <div className="st-hint">
          <span>实线圈 行动者</span>
          <span>虚线圈 目标</span>
          <span>点座位 快捷标记毒 / 护 / 醉</span>
        </div>
      </main>
    </>
  );
}
