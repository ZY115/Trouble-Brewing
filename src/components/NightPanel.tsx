import QuickAction from "./QuickAction";
import Picker, { roleOptions } from "../ui/Picker";
import FirstInformation from "./FirstInformation";
import Conversation from "./Conversation";
import {
  CHOICE_KINDS,
  choiceKindForRole,
  choiceLabels,
  choiceSentence,
  toggleChoice,
  type ChoiceKind,
} from "../../shared/action-choice";
import NightPlanner from "./NightPlanner";
import RulingCorrection from "./RulingCorrection";
import { localKey, useLocalState, useUnread } from "../localState";
import { useEffect, useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import { ROLES, roleName } from "../../shared/roles";
import { completedAction, nightTemplate } from "../../shared/assistance";
import type { Send } from "../useRoom";
const labels = {
  REQUESTED: "等待选择",
  SUBMITTED: "等待反馈",
  ST_REVIEW: "等待填写反馈",
  APPROVED: "已审核 · 未发送",
  DELIVERED: "已送达",
  CANCELLED: "已取消",
  OFFLINE: "已线下处理",
};
export function ActionCard({
  action,
  room,
  send,
}: {
  action: NightAction;
  room: RoomView;
  send: Send;
}) {
  const context = action.reference?.contextVersion ?? 0,
    selection = action.selectionVersion ?? 0;
  const initial = {
    response: action.response ?? action.reference?.suggestedResponse ?? "",
    context,
    selection,
  };
  const [draft, setDraft, clearDraft] = useLocalState(
    localKey(room, `ruling:${action.id}`),
    initial,
  );
  const response = draft.response;
  const setResponse = (response: string) => setDraft({ ...draft, response });
  const stale = draft.context !== context || draft.selection !== selection;
  const [targetDraft, setTargetDraft, clearTargets] = useLocalState(
    localKey(room, `targets:${action.id}`),
    { targets: action.targets, version: selection },
  );
  const targets = targetDraft.targets;
  const setTargets = (targets: string[]) =>
    setTargetDraft({ ...targetDraft, targets });
  const [reason, setReason] = useLocalState(
    localKey(room, `resolve:${action.id}`),
    "",
  );
  const [busy, setBusy] = useState(false);
  const st = !!room.storyteller;
  const seat = room.seats.find((s) => s.id === action.seatId)!;
  const active =
    ["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase) &&
    action.night === room.day &&
    !completedAction(action);
  async function act(c: Parameters<Send>[0]) {
    setBusy(true);
    if (await send(c)) {
      if (c.type === "submit_action") clearTargets();
      else if (c.type === "send_action_response" || c.type === "resolve_action")
        clearDraft();
    }
    setBusy(false);
  }
  return (
    <article className="panel action-card">
      <div className="panel-heading">
        <h3>
          {st
            ? `${seat.number} 号 · 第 ${action.night} 夜`
            : `第 ${action.night} 夜的行动`}
        </h3>
        <span className="tag">
          {room.phase === "ENDED" && !completedAction(action)
            ? "本局已结束 · 未完成"
            : labels[action.status]}
        </span>
      </div>
      {(st ||
        !active ||
        !action.canChangeTargets ||
        !ROLES.some(
          (role) => nightTemplate(role.id).prompt === action.prompt,
        )) && <p>{action.prompt}</p>}
      {st && (
        <small className="muted">
          真实身份：
          {roleName(room.storyteller?.assignments[seat.id]?.actualRoleId)}
        </small>
      )}
      {!!action.targets.length &&
        (st ||
          !active ||
          !action.canChangeTargets ||
          targets.length !== action.targets.length ||
          targets.some((id) => !action.targets.includes(id))) && (
          <div className="target-line">
            {choiceSentence(
              action,
              room.seats,
              action.targets,
              st ? `${seat.number} 号：` : "已提交：",
            )}
          </div>
        )}
      {!st && active && action.canChangeTargets && (
        <>
          {targetDraft.version !== selection && (
            <p role="alert" className="notice">
              目标已在其他页面修改。
              <button onClick={clearTargets}>载入最新目标</button>
            </p>
          )}
          <p className="choice-sentence" aria-live="polite">
            {choiceSentence(action, room.seats, targets)}
          </p>
          <p className="muted">
            点选 {action.targetCount} 个号码，再确认发送。
            {action.targetCount > 1
              ? "点已选号码可取消。"
              : "点其他号码可更换。"}
          </p>
          <div
            className="target-options"
            role="group"
            aria-label="行动目标号码"
          >
            {room.seats.map((s) => (
              <button
                aria-pressed={targets.includes(s.id)}
                className={targets.includes(s.id) ? "selected" : ""}
                key={s.id}
                disabled={busy || targetDraft.version !== selection}
                onClick={() =>
                  setTargets(toggleChoice(targets, s.id, action.targetCount))
                }
              >
                {s.number} 号
              </button>
            ))}
          </div>
          <button
            className="primary"
            disabled={
              busy ||
              targets.length !== action.targetCount ||
              targetDraft.version !== selection
            }
            onClick={() =>
              void act({
                type: "submit_action",
                actionId: action.id,
                targets,
                expectedVersion: targetDraft.version,
              })
            }
          >
            {action.status === "SUBMITTED" ? "确认修改并发送" : "确认发送行动"}
          </button>
        </>
      )}
      {st && action.reference && (
        <section
          className="information-reference"
          aria-label={`给 ${seat.number} 号的真实参考`}
        >
          <strong>
            {completedAction(action) ? "发送时真实参考" : "真实状态参考"} ·{" "}
            {action.reference.roleId
              ? roleName(action.reference.roleId)
              : "自定义"}
          </strong>
          <p>{action.reference.actual}</p>
          {!!action.reference.evidence.length && (
            <ul>
              {action.reference.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {action.reference.warnings.map((w, i) => (
            <p className="reference-warning" key={i}>
              {w}
            </p>
          ))}
        </section>
      )}
      {st &&
        active &&
        ["SUBMITTED", "ST_REVIEW", "APPROVED"].includes(action.status) && (
          <>
            {stale && (
              <div role="alert" className="notice">
                状态或目标有变化，草稿还在，核对后再发。
                <button
                  onClick={() => setDraft({ ...draft, context, selection })}
                >
                  已核对最新参考，保留草稿
                </button>
              </div>
            )}
            {!stale && <QuickAction room={room} action={action} send={send} />}
            <FirstInformation
              room={room}
              action={action}
              onResponse={setResponse}
            />
            <button
              onClick={() =>
                setDraft({
                  response: action.reference?.suggestedResponse ?? "",
                  context,
                  selection,
                })
              }
            >
              重新采用参考
            </button>
            <label className="field">
              发布给玩家的裁定
              <textarea
                aria-label={`给 ${seat.number} 号的反馈`}
                maxLength={2000}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="填写数字、是/否、角色或自定义信息"
              />
            </label>
            <button
              className="primary"
              disabled={busy || stale || !response.trim()}
              onClick={() =>
                void act({
                  type: "send_action_response",
                  actionId: action.id,
                  response,
                  expectedVersion: draft.selection,
                  expectedContextVersion: draft.context,
                })
              }
            >
              确认并发送
            </button>
          </>
        )}
      {st && active && (
        <details className="action-resolution">
          <summary>取消 / 已在线下处理</summary>
          <label className="field">
            原因
            <input
              aria-label={`处理 ${seat.number} 号待办的原因`}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="action-buttons">
            <button
              disabled={busy || !reason.trim()}
              onClick={() =>
                void act({
                  type: "resolve_action",
                  actionId: action.id,
                  resolution: "OFFLINE",
                  reason,
                })
              }
            >
              已在线下处理
            </button>
            <button
              disabled={busy || !reason.trim()}
              onClick={() =>
                void act({
                  type: "resolve_action",
                  actionId: action.id,
                  resolution: "CANCELLED",
                  reason,
                })
              }
            >
              取消此待办
            </button>
          </div>
        </details>
      )}
      {action.status === "DELIVERED" && (
        <div className="ruling-history">
          <small>
            {(action.responseVersion ?? 1) > 1
              ? `最新裁定 · 第 ${action.responseVersion} 版`
              : "当前裁定"}
          </small>
          <div className="delivered-response">{action.response}</div>
          {action.responseHistory?.at(-1)?.reason && (
            <p>更正说明：{action.responseHistory.at(-1)!.reason}</p>
          )}
          {(action.responseHistory?.length ?? 0) > 1 && (
            <details>
              <summary>查看已更正的旧反馈</summary>
              {action.responseHistory!.slice(0, -1).map((h) => (
                <p className="superseded" key={h.version}>
                  第 {h.version} 版（已失效）：{h.response}
                </p>
              ))}
            </details>
          )}
          {st && room.phase !== "ENDED" && (
            <RulingCorrection room={room} action={action} send={send} />
          )}
        </div>
      )}
      {st && action.resolutionReason && (
        <p className="muted">处理原因：{action.resolutionReason}</p>
      )}
    </article>
  );
}
export default function NightPanel({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const [request, setRequest, clearRequest] = useLocalState(
    localKey(room, "request-draft"),
    {
      seatId: room.seats[0]?.id ?? "",
      ...nightTemplate(
        room.storyteller?.assignments[room.seats[0]?.id]?.perceivedRoleId ?? "",
      ),
      choiceKind: "auto",
      referenceRoleId: "auto",
      phaseVersion: room.storyteller?.phaseVersion,
    },
  );
  const { seatId, prompt, targetCount, referenceRoleId, choiceKind } = request;
  const setSeatId = (seatId: string) =>
    setRequest((prev) => ({
      ...prev,
      seatId,
      ...nightTemplate(
        room.storyteller?.assignments[seatId]?.perceivedRoleId ?? "",
      ),
      choiceKind: "auto",
      referenceRoleId: "auto",
    }));
  const setPrompt = (prompt: string) =>
    setRequest((prev) => ({ ...prev, prompt }));
  const setTargetCount = (targetCount: number) =>
    setRequest((prev) => ({ ...prev, targetCount }));
  const setReferenceRoleId = (referenceRoleId: string) =>
    setRequest((prev) => ({ ...prev, referenceRoleId }));
  const requestStale = request.phaseVersion !== room.storyteller?.phaseVersion;
  const unread = useUnread(room);
  const deliveredKey = room.actions
    .filter((a) => a.status === "DELIVERED")
    .map((a) => `${a.id}:${a.responseVersion ?? 1}`)
    .join(",");
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === "visible" && !room.storyteller)
        unread.markActions();
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [deliveredKey]);
  const [busy, setBusy] = useState(false);
  const isNight = ["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase);
  const pending =
    room.phase === "ENDED"
      ? []
      : room.actions.filter((a) => !completedAction(a));
  const completed =
    room.phase === "ENDED"
      ? room.actions
      : room.actions.filter(completedAction);
  const card = (action: NightAction) => (
    <ActionCard key={action.id} action={action} room={room} send={send} />
  );
  return (
    <div>
      <div className="section-title">
        <div>
          <h2>{room.storyteller ? "夜间工作台" : "夜间信息"}</h2>
          <p>
            {room.storyteller
              ? `待处理 ${pending.length} 项`
              : "点号码确认行动。"}
          </p>
        </div>
      </div>
      {room.storyteller && <NightPlanner room={room} send={send} />}
      {room.storyteller && (
        <details className="request-disclosure">
          <summary>新建夜间待办</summary>
          <form
            className="panel request-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              if (
                await send({
                  type: "request_action",
                  expectedPhaseVersion: request.phaseVersion,
                  seatId,
                  prompt,
                  targetCount,
                  choiceKind:
                    choiceKind === "auto"
                      ? choiceKindForRole(
                          room.storyteller!.assignments[seatId]
                            ?.perceivedRoleId ?? "",
                        )
                      : (choiceKind as ChoiceKind),
                  referenceRoleId:
                    referenceRoleId === "auto" ? undefined : referenceRoleId,
                })
              )
                clearRequest();
              setBusy(false);
            }}
          >
            {requestStale && (
              <p role="alert" className="notice">
                阶段已改变，原待办草稿已保留。
                <button
                  type="button"
                  onClick={() =>
                    setRequest({
                      ...request,
                      phaseVersion: room.storyteller!.phaseVersion,
                    })
                  }
                >
                  确认用于当前夜晚
                </button>
              </p>
            )}
            <div className="two-columns">
              <Picker
                label="接收玩家"
                value={seatId}
                options={[...room.seats]
                  .sort((a, b) => a.number - b.number)
                  .map((s) => ({
                    value: s.id,
                    label: `${s.number} 号 · ${roleName(room.storyteller?.assignments[s.id]?.actualRoleId)}`,
                    text: `${s.number} 号`,
                  }))}
                onChange={setSeatId}
                clearable={false}
              />
              <Picker
                label="需要选择的目标"
                value={String(targetCount)}
                options={[
                  { value: "0", label: "无需选择，直接给信息" },
                  { value: "1", label: "选择 1 人" },
                  { value: "2", label: "选择 2 人" },
                ]}
                onChange={(v) => setTargetCount(Number(v))}
                clearable={false}
              />
            </div>
            <button
              type="button"
              disabled={!isNight}
              onClick={() => {
                const t = nightTemplate(
                  room.storyteller!.assignments[seatId]?.perceivedRoleId ?? "",
                );
                setRequest((prev) => ({ ...prev, ...t, choiceKind: "auto" }));
              }}
            >
              按认知身份填入常用提示
            </button>
            <Picker
              label="玩家动作句"
              value={choiceKind}
              options={[
                { value: "auto", label: "按玩家认知身份" },
                ...CHOICE_KINDS.map((kind) => ({ value: kind, label: choiceLabels[kind] })),
              ]}
              onChange={(v) => setRequest((prev) => ({ ...prev, choiceKind: v }))}
              clearable={false}
            />
            <Picker
              label="查验参考"
              value={referenceRoleId}
              options={[
                { value: "auto", label: "按玩家认知身份" },
                { value: "", label: "自定义信息（不计算）" },
                ...roleOptions(),
              ]}
              onChange={setReferenceRoleId}
              clearable={false}
            />
            <label className="field">
              行动提示
              <input
                required
                maxLength={500}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="可自由修改提示和目标数量"
              />
            </label>
            <button
              className="primary"
              disabled={!isNight || !seatId || busy || requestStale}
            >
              创建待办
            </button>
          </form>
        </details>
      )}
      {room.storyteller ? (
        <div className="seat-inbox-list">
          {[...room.seats]
            .sort((a, b) => a.number - b.number)
            .map((seat) => {
              const current = room.actions.filter(
                (a) => a.seatId === seat.id && a.night === room.day,
              );
              const history = room.actions.filter(
                (a) => a.seatId === seat.id && a.night !== room.day,
              );
              const count = current.filter((a) => !completedAction(a)).length;
              return (
                <section
                  key={seat.id}
                  className="panel seat-inbox"
                  aria-label={`${seat.number}号行动与私聊`}
                >
                  <header className="panel-heading">
                    <h3>{seat.number} 号</h3>
                    <span className="muted">
                      {count ? `${count} 项待处理` : "无待处理行动"}
                      {unread.contactCount(seat.id) > 0
                        ? ` · ${unread.contactCount(seat.id)} 条未读私聊`
                        : ""}
                    </span>
                  </header>
                  <div className="seat-inbox-columns">
                    <div className="seat-actions">
                      {current.length ? (
                        current.map((a) => (
                          <details
                            key={a.id}
                            className="inbox-action"
                            open={
                              !completedAction(a) && a.status !== "REQUESTED"
                            }
                          >
                            <summary>
                              {a.targetCount
                                ? choiceSentence(
                                    a,
                                    room.seats,
                                    a.targets,
                                    `${seat.number} 号：`,
                                  )
                                : `${seat.number} 号：接收信息`}{" "}
                              · {labels[a.status]}
                            </summary>
                            {card(a)}
                          </details>
                        ))
                      ) : (
                        <p className="muted">本夜暂无行动</p>
                      )}
                      {!!history.length && (
                        <details className="inbox-history">
                          <summary>以往夜间行动（{history.length}）</summary>
                          {[...history].reverse().map(card)}
                        </details>
                      )}
                    </div>
                    <Conversation
                      room={room}
                      send={send}
                      recipient={seat.id}
                      compact
                    />
                  </div>
                </section>
              );
            })}
        </div>
      ) : (
        <>
          <div className="action-list">{pending.map(card)}</div>
          <section className="panel player-host-chat">
            <h3>私聊说书人</h3>
            <Conversation
              room={room}
              send={send}
              recipient="storyteller"
              compact
            />
          </section>
        </>
      )}
      {!room.storyteller && completed.length > 0 && (
        <details className="completed-actions" open={!room.storyteller}>
          <summary>已处理与历史信息（{completed.length}）</summary>
          {[...completed].reverse().map(card)}
        </details>
      )}
      {!pending.length && !completed.length && !room.storyteller && (
        <p className="muted">暂无需要处理的夜间行动。</p>
      )}
    </div>
  );
}
