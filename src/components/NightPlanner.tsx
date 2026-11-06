import { useState } from "react";
import Picker, { roleOptions, seatOptions, valueOptions } from "../ui/Picker";
import type { NightPlanItem, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { localKey, useLocalState } from "../localState";
import { completedAction } from "../../shared/assistance";

export default function NightPlanner({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const st = room.storyteller!;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft, clearDraft] = useLocalState(
    localKey(room, "plan-editor"),
    {
      id: "",
      seatId: "",
      roleId: "",
      prompt: "",
      targetCount: 0,
      note: "",
      phaseVersion: st.phaseVersion,
      planVersion: st.planVersion,
    },
  );
  const isNight = ["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase);
  const items = st.nightPlan.filter((i) => i.night === room.day);
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
  const edit = (i: NightPlanItem) =>
    setDraft({
      id: i.id,
      seatId: i.seatId,
      roleId: i.roleId,
      prompt: i.prompt,
      targetCount: i.targetCount,
      note: i.note,
      phaseVersion: st.phaseVersion,
      planVersion: st.planVersion,
    });
  if (!isNight) return null;
  return (
    <details className="panel night-plan">
      <summary>本夜建议清单（可选） · {items.length} 项</summary>
      {!items.length && (
        <button
          disabled={busy}
          onClick={() => void act({ type: "generate_night_plan", ...guard })}
        >
          按当前配板生成建议
        </button>
      )}
      <button
        disabled={
          busy ||
          !items.some(
            (i) => i.status === "planned" && i.seatId && !i.retiredReason,
          )
        }
        onClick={() => void act({ type: "start_all_plan", ...guard })}
      >
        全部开始玩家待办
      </button>
      <ol className="plan-items">
        {items.map((i, index) => {
          const action = room.actions.find((a) => a.id === i.actionId);
          const label =
            i.status === "started"
              ? action && completedAction(action)
                ? "关联待办已处理"
                : "已创建待办"
              : { planned: "待安排", skipped: "已跳过", offline: "已线下完成" }[
                  i.status
                ];
          return (
            <li key={i.id}>
              <div className="panel-heading">
                <strong>
                  {i.seatId
                    ? `${room.seats.find((s) => s.id === i.seatId)?.number} 号`
                    : "说书人"}{" "}
                  · {i.prompt}
                </strong>
                <small>{label}</small>
              </div>
              <p className="muted">{i.note}</p>
              {i.retiredReason && <p className="muted">{i.retiredReason}</p>}
              <div className="action-buttons">
                {i.status === "planned" && (
                  <>
                    <button
                      disabled={busy || !i.seatId}
                      onClick={() =>
                        void act({
                          type: "plan_item",
                          itemId: i.id,
                          operation: "start",
                          ...guard,
                        })
                      }
                    >
                      开始此项
                    </button>
                    <button onClick={() => edit(i)}>编辑</button>
                    {(
                      [
                        ["offline", "线下完成"],
                        ["skip", "跳过"],
                        ["delete", "删除"],
                      ] as const
                    ).map(([operation, text]) => (
                      <button
                        disabled={busy}
                        key={operation}
                        onClick={() =>
                          void act({
                            type: "plan_item",
                            itemId: i.id,
                            operation,
                            ...guard,
                          })
                        }
                      >
                        {text}
                      </button>
                    ))}
                  </>
                )}
                {["skipped", "offline"].includes(i.status) &&
                  !i.retiredReason && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act({
                          type: "plan_item",
                          itemId: i.id,
                          operation: "restore",
                          ...guard,
                        })
                      }
                    >
                      恢复待安排
                    </button>
                  )}
                <button
                  aria-label={`清单第 ${index + 1} 项上移`}
                  disabled={busy || index === 0}
                  onClick={() =>
                    void act({
                      type: "plan_item",
                      itemId: i.id,
                      operation: "up",
                      ...guard,
                    })
                  }
                >
                  ↑
                </button>
                <button
                  aria-label={`清单第 ${index + 1} 项下移`}
                  disabled={busy || index === items.length - 1}
                  onClick={() =>
                    void act({
                      type: "plan_item",
                      itemId: i.id,
                      operation: "down",
                      ...guard,
                    })
                  }
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <details open={!!draft.id}>
        <summary>{draft.id ? "编辑清单项" : "添加自定义清单项"}</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act({
                type: "save_plan_item",
                itemId: draft.id || undefined,
                seatId: draft.seatId,
                roleId: draft.roleId,
                prompt: draft.prompt,
                targetCount: draft.targetCount,
                note: draft.note,
                expectedPhaseVersion: draft.phaseVersion,
                expectedPlanVersion: draft.planVersion,
              })
            )
              clearDraft();
          }}
        >
          {(draft.phaseVersion !== st.phaseVersion ||
            draft.planVersion !== st.planVersion) && (
            <p className="notice">
              清单已更新，草稿保留。
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    phaseVersion: st.phaseVersion,
                    planVersion: st.planVersion,
                  })
                }
              >
                已核对最新清单
              </button>
            </p>
          )}
          <div className="form-grid">
            <Picker
              label="接收者"
              value={draft.seatId}
              options={[{ value: "", label: "仅说书人" }, ...seatOptions(room.seats)]}
              onChange={(v) => setDraft({ ...draft, seatId: v })}
              clearable={false}
            />
            <Picker
              label="参考角色"
              value={draft.roleId}
              options={[{ value: "", label: "自定义" }, ...roleOptions()]}
              onChange={(v) => setDraft({ ...draft, roleId: v })}
              clearable={false}
            />
          </div>
          <label className="field">
            行动提示
            <input
              required
              aria-label="清单行动提示"
              maxLength={500}
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>
          <Picker
            label="选择目标数"
            value={String(draft.targetCount)}
            options={valueOptions(["0", "1", "2"])}
            onChange={(v) => setDraft({ ...draft, targetCount: Number(v) })}
            clearable={false}
          />
          <label className="field">
            仅说书人备注
            <input
              maxLength={500}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <div className="action-buttons">
            <button
              disabled={
                busy ||
                !draft.prompt.trim() ||
                draft.phaseVersion !== st.phaseVersion ||
                draft.planVersion !== st.planVersion
              }
            >
              保存清单项
            </button>
            <button type="button" onClick={clearDraft}>
              取消编辑 / 清空
            </button>
          </div>
        </form>
      </details>
    </details>
  );
}
