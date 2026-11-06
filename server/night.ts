import { informationReference } from "./information";
import type { Command } from "../shared/commands";
import { completedAction } from "../shared/assistance";
import type { Room } from "./game";
export function nightCommand(
  r: Room,
  st: boolean,
  c: Command,
): string | undefined {
  if (
    c.type !== "resolve_action" &&
    c.type !== "send_action_response" &&
    c.type !== "correct_action_response" &&
    c.type !== "set_action_targets"
  )
    return;
  if (!st) throw new Error("此操作仅限说书人");
  const a = r.actions.find((a) => a.id === c.actionId);
  if (c.type === "correct_action_response") {
    if (!a || a.status !== "DELIVERED") throw new Error("只能更正已送达的反馈");
    if (c.expectedResponseVersion !== (a.responseVersion ?? 1))
      throw new Error("反馈已有新版本，请重新核对");
    if (c.expectedContextVersion !== r.contextVersion)
      throw new Error("真实状态已变化，请重新核对");
    a.responseHistory ??= [
      { version: a.responseVersion ?? 1, response: a.response!, sentAt: "" },
    ];
    a.responseVersion = (a.responseVersion ?? 1) + 1;
    a.response = c.response;
    a.responseHistory.push({
      version: a.responseVersion,
      response: c.response,
      reason: c.reason,
      sentAt: new Date().toISOString(),
    });
    return "已私密发送更正裁定，旧版保留并标记失效";
  }
  if (
    !a ||
    a.night !== r.day ||
    !["FIRST_NIGHT", "OTHER_NIGHT"].includes(r.phase) ||
    completedAction(a)
  )
    throw new Error("此待办已完成或不属于当前夜晚");
  if (c.type === "set_action_targets") {
    if (
      c.targets.length !== a.targetCount ||
      new Set(c.targets).size !== c.targets.length ||
      !c.targets.every((id) => r.seats.some((s) => s.id === id))
    )
      throw new Error("请选择正确数量的不重复目标");
    if (["protect", "master"].includes(a.choiceKind ?? "") && c.targets.includes(a.seatId))
      throw new Error("不能选择自己");
    if ((a.selectionVersion ?? 0) !== c.expectedVersion)
      throw new Error("目标已被修改，请查看最新状态");
    a.targets = c.targets;
    a.selectionVersion = (a.selectionVersion ?? 0) + 1;
    if (a.status === "REQUESTED") a.status = "SUBMITTED";
    const number = (id: string) => r.seats.find((s) => s.id === id)?.number;
    return `说书人录入 ${number(a.seatId)} 号的目标：${c.targets.map((id) => `${number(id)} 号`).join("、")}`;
  }
  if (c.type === "resolve_action") {
    a.status = c.resolution;
    a.resolutionReason = c.reason;
    delete a.response;
    return c.resolution === "CANCELLED"
      ? "取消夜间待办"
      : "确认夜间待办已在线下处理";
  }
  if (!["SUBMITTED", "ST_REVIEW", "APPROVED"].includes(a.status))
    throw new Error("请先等待玩家选择，或使用线下处理");
  if ((a.selectionVersion ?? 0) !== c.expectedVersion)
    throw new Error("玩家已修改目标，请重新核对后发送");
  if (
    c.expectedContextVersion !== undefined &&
    c.expectedContextVersion !== r.contextVersion
  )
    throw new Error("真实状态已变化，请重新核对参考结果");
  a.reference = informationReference(r, a);
  a.response = c.response;
  a.status = "DELIVERED";
  a.responseVersion = 1;
  a.responseHistory = [
    { version: 1, response: c.response, sentAt: new Date().toISOString() },
  ];
  return "说书人确认并私密发送夜间反馈";
}
