export type Team = "townsfolk" | "outsider" | "minion" | "demon";
export interface Role {
  id: string;
  name: string;
  team: Team;
  hint: string;
}
export const TEAM_NAMES: Record<Team, string> = {
  townsfolk: "镇民",
  outsider: "外来者",
  minion: "爪牙",
  demon: "恶魔",
};
export const ROLES: Role[] = [
  {
    id: "washerwoman",
    name: "洗衣妇",
    team: "townsfolk",
    hint: "首夜获得镇民线索",
  },
  {
    id: "librarian",
    name: "图书管理员",
    team: "townsfolk",
    hint: "首夜获得外来者线索",
  },
  {
    id: "investigator",
    name: "调查员",
    team: "townsfolk",
    hint: "首夜获得爪牙线索",
  },
  { id: "chef", name: "厨师", team: "townsfolk", hint: "首夜获得相邻邪恶对数" },
  { id: "empath", name: "共情者", team: "townsfolk", hint: "夜晚感知存活邻座" },
  {
    id: "fortuneteller",
    name: "占卜师",
    team: "townsfolk",
    hint: "夜晚选择两人查验",
  },
  {
    id: "undertaker",
    name: "送葬者",
    team: "townsfolk",
    hint: "获知被处决者的角色",
  },
  { id: "monk", name: "僧侣", team: "townsfolk", hint: "非首夜选择他人保护" },
  {
    id: "ravenkeeper",
    name: "守鸦人",
    team: "townsfolk",
    hint: "夜间死亡后查验角色",
  },
  {
    id: "virgin",
    name: "贞洁者",
    team: "townsfolk",
    hint: "首次被提名时可能触发处决",
  },
  {
    id: "slayer",
    name: "猎手",
    team: "townsfolk",
    hint: "白天公开使用一次能力",
  },
  { id: "soldier", name: "士兵", team: "townsfolk", hint: "免疫恶魔的杀害" },
  {
    id: "mayor",
    name: "镇长",
    team: "townsfolk",
    hint: "三人存活时存在特殊胜利条件",
  },
  {
    id: "butler",
    name: "管家",
    team: "outsider",
    hint: "夜晚选择主人，投票受其影响",
  },
  { id: "drunk", name: "酒鬼", team: "outsider", hint: "认为自己是一个镇民" },
  {
    id: "recluse",
    name: "隐士",
    team: "outsider",
    hint: "可能被登记为邪恶角色",
  },
  {
    id: "saint",
    name: "圣徒",
    team: "outsider",
    hint: "被处决会使善良阵营落败",
  },
  { id: "poisoner", name: "投毒者", team: "minion", hint: "夜晚选择一人中毒" },
  {
    id: "spy",
    name: "间谍",
    team: "minion",
    hint: "查看魔典；可能被登记为善良",
  },
  {
    id: "scarletwoman",
    name: "猩红女郎",
    team: "minion",
    hint: "满足条件时接替恶魔",
  },
  { id: "baron", name: "男爵", team: "minion", hint: "配板时增加两名外来者" },
  { id: "imp", name: "小恶魔", team: "demon", hint: "非首夜选择一人杀害" },
];
export const roleById = (id: string) => ROLES.find((r) => r.id === id);
export const isEvil = (id: string) =>
  ["minion", "demon"].includes(roleById(id)?.team ?? "");
export const roleName = (id?: string) => roleById(id ?? "")?.name ?? "待分配";
