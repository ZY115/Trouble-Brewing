import { writeFileSync } from "node:fs";
import {
  defaultBluffs,
  expectedCounts,
  validateSetup,
  randomSetup,
} from "../shared/setup";
import type { Preset } from "../shared/types";
const town = [
  "washerwoman",
  "chef",
  "empath",
  "fortuneteller",
  "undertaker",
  "monk",
  "soldier",
  "virgin",
  "slayer",
  "ravenkeeper",
  "mayor",
  "librarian",
  "investigator",
];
const presets: Preset[] = [];
for (const count of [10, 11, 12, 13]) {
  for (let variant = 0; variant < 3; variant++) {
    const baron = variant === 2;
    const [t, o, m] = expectedCounts(count, baron);
    const rotated =
      variant === 1 ? [...town.slice(3), ...town.slice(0, 3)] : town;
    const minions = baron
      ? ["baron", "poisoner", "scarletwoman"]
      : ["poisoner", "scarletwoman", "spy"];
    const outsiders =
      variant === 1
        ? ["drunk", "recluse", "saint", "butler"]
        : ["recluse", "saint", "butler", "drunk"];
    const roleIds = [
      ...rotated.slice(0, t),
      ...outsiders.slice(0, o),
      ...minions.slice(0, m),
      "imp",
    ];
    const drunkAs = roleIds.includes("drunk")
      ? town.find((id) => !roleIds.includes(id))!
      : "";
    const setup = {
      roleIds,
      drunkAs,
      bluffs: defaultBluffs(roleIds, drunkAs),
      overrideReason: "",
    };
    if (validateSetup(count, setup).some((i) => i.level === "error"))
      throw new Error(`Invalid preset ${count}/${variant}`);
    presets.push({
      id: `${count}-${variant}`,
      count,
      name: ["基础配置", "进阶配置", "男爵配置"][variant],
      description: [
        "信息角色较多；无男爵",
        roleIds.includes("drunk")
          ? "含酒鬼；减少首夜信息角色"
          : "增加白天能力，减少首夜信息角色",
        "含男爵；外来者增加两人",
      ][variant],
      setup,
    });
  }
}
let seed = 73019;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (const count of [10, 11, 12, 13]) {
  const seen = new Set(
    presets
      .filter((p) => p.count === count)
      .map((p) => [...p.setup.roleIds].sort().join(",")),
  );
  while (presets.filter((p) => p.count === count).length < 12) {
    const setup = randomSetup(count, rng),
      key = [...setup.roleIds].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const i = presets.filter((p) => p.count === count).length;
    presets.push({
      id: `${count}-${i}`,
      count,
      name: `变化配置 ${i - 2}`,
      description: `${setup.roleIds.includes("baron") ? "含男爵" : "无男爵"} · ${setup.roleIds.includes("drunk") ? "含酒鬼" : "无酒鬼"}；可继续修改`,
      setup,
    });
  }
}
writeFileSync(
  new URL("../shared/presets.json", import.meta.url),
  JSON.stringify(presets, null, 2) + "\n",
);
console.log(
  `Generated ${presets.length} validated presets; no runtime search.`,
);
