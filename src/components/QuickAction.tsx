import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function QuickAction({
  room,
  action,
  send,
}: {
  room: RoomView;
  action: NightAction;
  send: Send;
}) {
  const [busy, setBusy] = useState(false),
    [force, setForce] = useState(false),
    [response, setResponse] = useState("已收到");
  const effect = action.choiceKind;
  if (
    !["poison", "protect", "kill"].includes(effect ?? "") ||
    action.targets.length !== 1
  )
    return null;
  const target = room.seats.find((s) => s.id === action.targets[0])!;
  const label =
    effect === "poison"
      ? `标记 ${target.number} 号中毒`
      : effect === "protect"
        ? `标记 ${target.number} 号受保护`
        : `标记 ${target.number} 号死亡`;
  async function act(effect: "poison" | "protect" | "kill" | "none") {
    setBusy(true);
    await send({
      type: "apply_action",
      actionId: action.id,
      effect,
      response,
      force,
      expectedVersion: action.selectionVersion ?? 0,
      expectedContextVersion: room.storyteller!.contextVersion,
    });
    setBusy(false);
    setForce(false);
  }
  return (
    <section className="quick-action">
      <strong>快捷处理</strong>
      <label className="field">
        玩家手机上显示
        <input
          aria-label={`给${room.seats.find((s) => s.id === action.seatId)?.number}号的快捷回执`}
          value={response}
          maxLength={2000}
          onChange={(e) => setResponse(e.target.value)}
        />
      </label>
      <div className="action-buttons">
        <button
          disabled={busy || !response.trim()}
          onClick={() => void act(effect as "poison" | "protect" | "kill")}
        >
          {label}
        </button>
        <button
          disabled={busy || !response.trim()}
          onClick={() => void act("none")}
        >
          不生效
        </button>
      </div>
      <details>
        <summary>特殊裁定</summary>
        <label>
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          我已核对，仍按这个效果执行
        </label>
      </details>
    </section>
  );
}
