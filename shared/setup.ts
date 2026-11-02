import { ROLES, roleById, type Team } from "./roles";
export interface Setup {
  roleIds: string[];
  drunkAs: string;
  bluffs: string[];
  overrideReason: string;
}
export interface SetupIssue {
  level: "error" | "warning";
  message: string;
}
export const BASE_COUNTS: Record<number, number[]> = {
  10: [7, 0, 2, 1],
  11: [7, 1, 2, 1],
  12: [7, 2, 2, 1],
  13: [9, 0, 3, 1],
};
export const TEAMS: Team[] = ["townsfolk", "outsider", "minion", "demon"];
export function expectedCounts(count: number, baron: boolean) {
  const values = [...(BASE_COUNTS[count] ?? [0, 0, 0, 0])];
  if (baron) {
    values[0] -= 2;
    values[1] += 2;
  }
  return values;
}
export function validateSetup(count: number, setup: Setup): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const error = (message: string) => issues.push({ level: "error", message });
  if (!BASE_COUNTS[count]) error("仅支持 10–13 名玩家");
  if (setup.roleIds.length !== count)
    error(`需要 ${count} 个角色，当前 ${setup.roleIds.length} 个`);
  if (new Set(setup.roleIds).size !== setup.roleIds.length)
    error("角色不可重复");
  if (setup.roleIds.some((id) => !roleById(id)))
    error("包含暗流涌动以外的角色");
  const expected = expectedCounts(count, setup.roleIds.includes("baron"));
  TEAMS.forEach((team, index) => {
    const actual = setup.roleIds.filter(
      (id) => roleById(id)?.team === team,
    ).length;
    if (actual !== expected[index])
      error(
        `${["镇民", "外来者", "爪牙", "恶魔"][index]}应为 ${expected[index]} 人，当前 ${actual} 人`,
      );
  });
  if (
    setup.roleIds.includes("drunk") &&
    (roleById(setup.drunkAs)?.team !== "townsfolk" ||
      setup.roleIds.includes(setup.drunkAs))
  )
    error("酒鬼需认知为一个未在场的镇民角色");
  if (
    setup.bluffs.length !== 3 ||
    new Set(setup.bluffs).size !== 3 ||
    setup.bluffs.some(
      (id) =>
        !roleById(id) ||
        ["minion", "demon"].includes(roleById(id)!.team) ||
        setup.roleIds.includes(id) ||
        (setup.roleIds.includes("drunk") && setup.drunkAs === id),
    )
  )
    error("恶魔假身份需为三个不同的未使用善良角色（避开酒鬼认知身份）");
  const info = [
    "washerwoman",
    "librarian",
    "investigator",
    "chef",
    "empath",
    "fortuneteller",
    "undertaker",
  ].filter((id) => setup.roleIds.includes(id)).length;
  if (info < 3)
    issues.push({
      level: "warning",
      message: "持续推理的信息来源偏少，建议补充信息角色",
    });
  if (
    setup.roleIds.includes("drunk") &&
    setup.roleIds.includes("poisoner") &&
    setup.roleIds.includes("spy")
  )
    issues.push({
      level: "warning",
      message: "酒鬼、投毒者与间谍同时在场，信息干扰较多",
    });
  return issues;
}
export function defaultBluffs(roleIds: string[], drunkAs: string) {
  return ROLES.filter(
    (r) =>
      ["townsfolk", "outsider"].includes(r.team) &&
      !roleIds.includes(r.id) &&
      r.id !== drunkAs,
  )
    .slice(0, 3)
    .map((r) => r.id);
}

/** Random legal composition, not a balance or win-rate guarantee. */
export function randomSetup(
  count: number,
  random: () => number = Math.random,
): Setup {
  const shuffle = <T>(items: T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  if (!BASE_COUNTS[count]) throw new Error("仅支持10–13人");
  const minions = shuffle(
    ROLES.filter((r) => r.team === "minion").map((r) => r.id),
  ).slice(0, BASE_COUNTS[count][2]);
  const [t, o] = expectedCounts(count, minions.includes("baron"));
  const towns = shuffle(
    ROLES.filter((r) => r.team === "townsfolk").map((r) => r.id),
  );
  const roleIds = [
    ...towns.slice(0, t),
    ...shuffle(
      ROLES.filter((r) => r.team === "outsider").map((r) => r.id),
    ).slice(0, o),
    ...minions,
    "imp",
  ];
  const drunkAs = roleIds.includes("drunk") ? towns[t] : "";
  const bluffs = shuffle(
    ROLES.filter(
      (r) =>
        ["townsfolk", "outsider"].includes(r.team) &&
        !roleIds.includes(r.id) &&
        r.id !== drunkAs,
    ).map((r) => r.id),
  ).slice(0, 3);
  return { roleIds, drunkAs, bluffs, overrideReason: "" };
}
