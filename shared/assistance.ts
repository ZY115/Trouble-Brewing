import type { NightAction } from "./types";
export const completedAction = (action: NightAction) =>
  ["DELIVERED", "CANCELLED", "OFFLINE"].includes(action.status);
export const privateToolCommands = new Set([
  "save_note",
  "save_notebook",
  "send_message",
  "create_group",
  "invite_group",
  "respond_invite",
  "leave_group",
]);
export const nightTemplate = (roleId: string) => {
  const selections: Record<string, [string, number]> = {
    fortuneteller: ["请选择今晚要查验的两位玩家。", 2],
    monk: ["请选择今晚要保护的一位其他玩家。", 1],
    poisoner: ["请选择今晚要投毒的一位玩家。", 1],
    imp: ["请选择今晚要袭击的一位玩家。", 1],
    butler: ["请选择今晚作为主人的一位其他玩家。", 1],
    ravenkeeper: ["请选择要查验的一位玩家。", 1],
  };
  const [prompt, targetCount] = selections[roleId] ?? [
    "请查看说书人发来的本夜信息。",
    0,
  ];
  return { prompt, targetCount };
};
