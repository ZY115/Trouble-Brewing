import { isEvil, roleById, roleName } from "../shared/roles";
import type {
  InformationReference,
  NightAction,
  PlayerConditions,
} from "../shared/types";
import type { Room } from "./game";
export const emptyConditions = (): PlayerConditions => ({
  poisoned: false,
  drunk: false,
  protected: false,
  note: "",
});
export function informationReference(
  r: Room,
  a: NightAction,
): InformationReference {
  const roleId =
    a.referenceRoleId ?? r.assignments[a.seatId]?.perceivedRoleId ?? "";
  const conditions = r.conditions[a.seatId] ?? emptyConditions();
  const actor = r.seats.find((s) => s.id === a.seatId);
  const impaired =
    conditions.poisoned ||
    conditions.drunk ||
    r.assignments[a.seatId]?.actualRoleId === "drunk";
  const ref: InformationReference = {
    contextVersion: r.contextVersion,
    roleId,
    actual: "此行动没有自动计算项，请自定义反馈。",
    evidence: [],
    warnings: [],
    impaired,
  };
  const seats = [...r.seats].sort((a, b) => a.number - b.number);
  const role = (id: string) => r.assignments[id]?.actualRoleId ?? "";
  const description = (id: string) =>
    `${r.seats.find((s) => s.id === id)?.number} 号：${roleName(role(id))}（${isEvil(role(id)) ? "邪恶" : "善良"}）`;
  const special = (ids: string[]) => {
    const unusual = ids.filter((id) => ["spy", "recluse"].includes(role(id)));
    if (unusual.length)
      ref.warnings.push(
        `涉及 ${unusual.map(description).join("、")}，可能特殊登记；这里仅列真实身份，登记方式由你裁定。`,
      );
  };
  if (conditions.poisoned)
    ref.warnings.push(
      "该玩家已标记中毒，请自行填写反馈；真实结果不会自动填入裁定。",
    );
  if (conditions.drunk || role(a.seatId) === "drunk")
    ref.warnings.push("该玩家醉酒或真实身份为酒鬼，请自行填写反馈。");
  if (!actor?.alive && roleId !== "ravenkeeper")
    ref.warnings.push("该玩家已死亡，请确认本次行动是否应发生。");
  if (roleId && roleId !== r.assignments[a.seatId]?.perceivedRoleId)
    ref.warnings.push("本行动的参考身份与当前认知身份不同，请核对。");
  const targets = a.targets.filter((id) => r.seats.some((s) => s.id === id));
  switch (roleId) {
    case "chef": {
      const pairs = seats.flatMap((s, i) =>
        isEvil(role(s.id)) && isEvil(role(seats[(i + 1) % seats.length].id))
          ? [`${s.number} 号—${seats[(i + 1) % seats.length].number} 号`]
          : [],
      );
      ref.actual = `真实邪恶相邻对数：${pairs.length}`;
      ref.evidence = pairs.length ? pairs : ["按环形座位计算，包含首尾相邻。"];
      ref.suggestedResponse = String(pairs.length);
      special(seats.map((s) => s.id));
      if (a.night !== 1)
        ref.warnings.push("厨师通常仅首夜获得信息；这里计算的是当前状态。");
      break;
    }
    case "empath": {
      const at = seats.findIndex((s) => s.id === a.seatId);
      const neighbors = [-1, 1].map((direction) => {
        for (let n = 1; n < seats.length; n++) {
          const s = seats[(at + direction * n + seats.length) % seats.length];
          if (s.alive) return s.id;
        }
        return "";
      });
      if (!neighbors.every(Boolean) || new Set(neighbors).size !== 2) {
        ref.actual = "存活邻座不足两名，需人工裁定。";
        break;
      }
      const count = neighbors.filter((id) => isEvil(role(id))).length;
      ref.actual = `两名存活邻座中的真实邪恶人数：${count}`;
      ref.evidence = neighbors.map(description);
      ref.suggestedResponse = String(count);
      special(neighbors);
      ref.warnings.push("参考按当前生死计算；请先登记本夜死亡，再核对邻座。");
      break;
    }
    case "fortuneteller": {
      if (targets.length !== 2) {
        ref.actual = "等待玩家提交两个目标。";
        break;
      }
      const demons = targets.filter(
        (id) => roleById(role(id))?.team === "demon",
      );
      const herringHit = !!r.redHerring && targets.includes(r.redHerring);
      ref.actual = demons.length
        ? `选中真实恶魔：${demons.map(description).join("、")}`
        : herringHit
          ? `${r.seats.find((s) => s.id === r.redHerring)?.number} 号是误判目标，会被查成恶魔`
          : "两个目标中没有真实恶魔。";
      ref.evidence = targets.map(description);
      if (r.redHerring) {
        const hit = herringHit;
        ref.evidence.push(
          `占卜误判目标：${r.seats.find((s) => s.id === r.redHerring)?.number} 号${hit ? "（本次命中）" : "（本次未命中）"}`,
        );
        ref.suggestedResponse = demons.length || hit ? "是" : "否";
      } else
        ref.warnings.push(
          "尚未设置占卜误判目标，不能只凭真实恶魔判断最终结果。",
        );
      special(targets);
      break;
    }
    case "ravenkeeper": {
      if (targets.length !== 1) {
        ref.actual = "等待玩家提交一个目标。";
        break;
      }
      ref.actual = description(targets[0]);
      ref.suggestedResponse = roleName(role(targets[0]));
      special(targets);
      break;
    }
    case "undertaker": {
      const executions = r.executions.filter(
        (e) =>
          e.day === a.night - 1 &&
          e.died &&
          !e.voided &&
          !r.executions.some((next) => next.supersedes === e.id),
      );
      ref.evidence = executions.map(
        (e) =>
          `第 ${e.day} 天：${r.seats.find((s) => s.id === e.seatId)?.number} 号因处决死亡，当时真实身份为${roleName(e.actualRoleId)}`,
      );
      ref.actual = executions.length
        ? ref.evidence.join("；")
        : "没有上一白天因处决死亡的登记。";
      if (executions.length === 1)
        ref.suggestedResponse = roleName(executions[0].actualRoleId);
      if (executions.some((e) => ["spy", "recluse"].includes(e.actualRoleId)))
        ref.warnings.push("被处决者可能特殊登记，实际角色仅供核对。");
      if (executions.length > 1)
        ref.warnings.push("记录了多次处决死亡，请手动选择信息。");
      if (!executions.length)
        ref.warnings.push("不应把普通死亡当作处决；可取消待办或自定义说明。");
      break;
    }
    case "washerwoman":
    case "librarian":
    case "investigator": {
      const team =
        roleId === "washerwoman"
          ? "townsfolk"
          : roleId === "librarian"
            ? "outsider"
            : "minion";
      const candidates = seats.filter(
        (s) => s.id !== a.seatId && roleById(role(s.id))?.team === team,
      );
      ref.actual = `真实符合类型的玩家：${candidates.length} 人`;
      ref.evidence = candidates.map((s) => description(s.id));
      if (roleId === "librarian" && !candidates.length)
        ref.suggestedResponse = "0（没有外来者）";
      ref.warnings.push(
        "候选双人组合及给出的角色由说书人选择，不自动指定误导对象。",
      );
      special(seats.map((s) => s.id));
      if (a.night !== 1)
        ref.warnings.push("该身份通常首夜获得信息，请确认本次行动。");
      break;
    }
  }
  if (ref.suggestedResponse) ref.truth = ref.suggestedResponse;
  if (impaired || (!actor?.alive && roleId !== "ravenkeeper"))
    delete ref.suggestedResponse;
  return ref;
}
