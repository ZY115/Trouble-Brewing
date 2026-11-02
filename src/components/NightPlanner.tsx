import { useState } from "react";
import type { NightPlanItem, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { ROLES } from "../../shared/roles";
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
      <p className="muted">
        仅说书人可见，可调整顺序、增删或跳过。点击“开始此项”才创建玩家待办；未开始的建议不阻止天亮。条件与先后顺序仍由你核对。
      </p>
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
      <p className="muted">
        可并行收集选择；说书人仍按夜序处理效果和发送信息，猩红女郎等检查项不会发给玩家；未触发的守鸦人/送葬者及死亡玩家不批量开始，可核对后单独开始。
      </p>
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
            <label className="field">
              接收者
              <select
                aria-label="清单接收者"
                value={draft.seatId}
                onChange={(e) => setDraft({ ...draft, seatId: e.target.value })}
              >
                <option value="">仅说书人</option>
                {room.seats.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} 号
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              参考角色
              <select
                value={draft.roleId}
                onChange={(e) => setDraft({ ...draft, roleId: e.target.value })}
              >
                <option value="">自定义</option>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
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
          <label className="field">
            选择目标数
            <select
              value={draft.targetCount}
              onChange={(e) =>
                setDraft({ ...draft, targetCount: Number(e.target.value) })
              }
            >
              {[0, 1, 2].map((n) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
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
