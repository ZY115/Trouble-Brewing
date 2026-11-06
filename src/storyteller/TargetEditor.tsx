import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import Picker, { seatOptions } from "../ui/Picker";

export default function TargetEditor({
  room,
  send,
  action,
  onDone,
}: {
  room: RoomView;
  send: Send;
  action: NightAction;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<string[]>(() =>
    Array.from({ length: action.targetCount }, (_, i) => action.targets[i] ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const noSelf = ["protect", "master"].includes(action.choiceKind ?? "");
  const seats = room.seats.filter((s) => !noSelf || s.id !== action.seatId);
  const label = action.choiceKind === "master" ? "主人" : "目标";
  const ready = targets.every(Boolean) && new Set(targets).size === targets.length;
  return (
    <div className="target-editor">
      {targets.map((t, i) => (
        <Picker
          key={i}
          label={action.targetCount > 1 ? `${label} ${i + 1}` : label}
          value={t}
          options={seatOptions(seats, targets.filter((x, j) => j !== i && x))}
          onChange={(v) => setTargets(targets.map((x, j) => (j === i ? v : x)))}
          clearable={false}
        />
      ))}
      <div className="task-actions">
        <button
          className="primary"
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            const ok = await send({
              type: "set_action_targets",
              actionId: action.id,
              targets,
              expectedVersion: action.selectionVersion ?? 0,
            });
            setBusy(false);
            if (ok) onDone();
          }}
        >
          确定
        </button>
        <button disabled={busy} onClick={onDone}>
          取消
        </button>
      </div>
    </div>
  );
}
