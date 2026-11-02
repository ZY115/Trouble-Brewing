import { ROLES } from "./roles";
export interface ClaimField {
  key: string;
  label: string;
  type: "seat" | "choice";
  options?: { value: string; label: string }[];
}
const seat = (key: string, label: string): ClaimField => ({
  key,
  label,
  type: "seat",
});
const choice = (key: string, label: string, values: string[]): ClaimField => ({
  key,
  label,
  type: "choice",
  options: values.map((value) => ({ value, label: value })),
});
const learnedRole = (team?: string): ClaimField => ({
  key: "learnedRole",
  label: "报出的角色",
  type: "choice",
  options: ROLES.filter((r) => !team || r.team === team).map((r) => ({
    value: r.id,
    label: r.name,
  })),
});
export function claimFields(roleId: string): ClaimField[] {
  switch (roleId) {
    case "washerwoman":
      return [
        seat("a", "候选玩家一"),
        seat("b", "候选玩家二"),
        learnedRole("townsfolk"),
      ];
    case "librarian":
      return [
        choice("result", "报出的结果", ["有外来者线索", "没有外来者"]),
        seat("a", "候选玩家一"),
        seat("b", "候选玩家二"),
        learnedRole("outsider"),
      ];
    case "investigator":
      return [
        seat("a", "候选玩家一"),
        seat("b", "候选玩家二"),
        learnedRole("minion"),
      ];
    case "chef":
      return [
        choice(
          "number",
          "报出的相邻邪恶对数",
          Array.from({ length: 14 }, (_, i) => String(i)),
        ),
      ];
    case "empath":
      return [choice("number", "报出的邪恶邻座数", ["0", "1", "2"])];
    case "fortuneteller":
      return [
        seat("a", "查验玩家一"),
        seat("b", "查验玩家二"),
        choice("result", "报出的结果", ["是", "否"]),
      ];
    case "undertaker":
      return [seat("a", "被处决者"), learnedRole()];
    case "ravenkeeper":
      return [seat("a", "查验对象"), learnedRole()];
    case "monk":
      return [seat("a", "保护对象")];
    case "poisoner":
      return [seat("a", "投毒对象")];
    case "imp":
      return [seat("a", "袭击对象")];
    case "butler":
      return [seat("a", "选择的主人")];
    case "slayer":
      return [
        seat("a", "射击对象"),
        choice("result", "公开结果", ["死亡", "未死亡"]),
      ];
    case "virgin":
      return [
        seat("a", "首次提名者"),
        choice("result", "公开结果", ["触发处决", "未触发处决"]),
      ];
    default:
      return [];
  }
}
export function validClaimInfo(
  roleId: string,
  info: Record<string, string>,
  seats: string[],
) {
  const fields = claimFields(roleId);
  return Object.entries(info).every(([key, value]) => {
    const field = fields.find((f) => f.key === key);
    return (
      field &&
      (!value ||
        (field.type === "seat"
          ? seats.includes(value)
          : field.options?.some((o) => o.value === value)))
    );
  });
}
