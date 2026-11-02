import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { localKey, useLocalState } from "../localState";
import PhaseConfirmation from "./PhaseConfirmation";

export default function PhaseControls({
  room,
  send,
  part = "all",
}: {
  room: RoomView;
  send: Send;
  /** The top bar shows only the advance button; settings live in the "more" drawer. */
  part?: "all" | "button" | "settings";
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const st = room.storyteller!;
  const [publishLifeOnDawn, setPublishLifeOnDawn] = useLocalState(
    localKey(room, `dawn-publication:${st.phaseVersion}`),
    true,
  );
  const [draft, set, clear] = useLocalState(
    localKey(room, "phase-correction"),
    {
      phase:
        room.phase === "DAY"
          ? ("DAY" as const)
          : room.day === 1
            ? ("FIRST_NIGHT" as const)
            : ("OTHER_NIGHT" as const),
      day: Math.max(1, room.day),
      reason: "",
      version: st.phaseVersion,
      confirmed: false,
    },
  );
  const active = ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase);
  return (
    <div className="phase-controls">
      {part !== "settings" && (
        <button
          className="primary"
          disabled={busy || !active}
          onClick={() => setConfirming(true)}
        >
          {room.phase === "DAY"
            ? "进入下一夜"
            : publishLifeOnDawn
              ? "宣布天亮并公布生死"
              : "宣布天亮（暂不公布生死）"}
        </button>
      )}
      {confirming && (
        <PhaseConfirmation
          room={room}
          send={send}
          publishLifeOnDawn={publishLifeOnDawn}
          onClose={() => setConfirming(false)}
        />
      )}
      {active && part !== "button" && (
        <details className="phase-settings" open={part === "settings"}>
          <summary>阶段设置</summary>
          {active && room.phase !== "DAY" && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={publishLifeOnDawn}
                disabled={busy}
                onChange={(e) => setPublishLifeOnDawn(e.target.checked)}
              />
              天亮时统一公布生死（取消后可稍后手动公布）
            </label>
          )}
          {active && (
            <details>
              <summary>更正天数 / 阶段</summary>
              <p className="muted">
                保留历史、取消未完成夜间待办并清除计时。更正为白天也会公布待发布生死；已经公开的信息不会收回。
              </p>
              {draft.version !== st.phaseVersion && (
                <p className="notice">
                  阶段已改变。
                  <button
                    onClick={() =>
                      set({
                        ...draft,
                        version: st.phaseVersion,
                        confirmed: false,
                      })
                    }
                  >
                    已核对当前阶段
                  </button>
                </p>
              )}
              <div className="form-grid">
                <label className="field">
                  第几天 / 夜
                  <input
                    aria-label="更正阶段天数"
                    type="number"
                    min={1}
                    max={999}
                    value={draft.day}
                    onChange={(e) =>
                      set({
                        ...draft,
                        day: Number(e.target.value),
                        confirmed: false,
                      })
                    }
                  />
                </label>
                <label className="field">
                  阶段
                  <select
                    aria-label="更正阶段"
                    value={draft.phase}
                    onChange={(e) =>
                      set({
                        ...draft,
                        phase: e.target.value as typeof draft.phase,
                        confirmed: false,
                      })
                    }
                  >
                    <option value="FIRST_NIGHT">首夜</option>
                    <option value="DAY">白天</option>
                    <option value="OTHER_NIGHT">其他夜晚</option>
                  </select>
                </label>
              </div>
              <label className="field">
                公开更正原因
                <input
                  aria-label="阶段更正原因"
                  maxLength={200}
                  value={draft.reason}
                  onChange={(e) => set({ ...draft, reason: e.target.value })}
                />
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.confirmed}
                  onChange={(e) =>
                    set({ ...draft, confirmed: e.target.checked })
                  }
                />
                确认更正阶段并取消未完成待办
              </label>
              <button
                disabled={
                  busy ||
                  draft.version !== st.phaseVersion ||
                  !draft.reason.trim() ||
                  !draft.confirmed
                }
                onClick={async () => {
                  setBusy(true);
                  if (
                    await send({
                      type: "correct_phase",
                      phase: draft.phase,
                      day: draft.day,
                      reason: draft.reason,
                      expectedPhaseVersion: draft.version,
                    })
                  )
                    clear();
                  setBusy(false);
                }}
              >
                保存阶段更正
              </button>
            </details>
          )}
        </details>
      )}
    </div>
  );
}
