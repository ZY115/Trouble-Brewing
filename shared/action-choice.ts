import type { NightAction, RoomView } from "./types";

export const CHOICE_KINDS = [
  "inspect",
  "poison",
  "kill",
  "protect",
  "master",
  "select",
] as const;
export type ChoiceKind = (typeof CHOICE_KINDS)[number];
export const choiceLabels: Record<ChoiceKind, string> = {
  inspect: "查验",
  poison: "下毒",
  kill: "击杀",
  protect: "保护",
  master: "选择主人",
  select: "选择",
};
export function choiceKindForRole(roleId: string): ChoiceKind {
  return (
    (
      {
        fortuneteller: "inspect",
        ravenkeeper: "inspect",
        poisoner: "poison",
        imp: "kill",
        monk: "protect",
        butler: "master",
      } as Record<string, ChoiceKind>
    )[roleId] ?? "select"
  );
}
export function choiceSentence(
  action: NightAction,
  seats: RoomView["seats"],
  targets = action.targets,
  subject = "我要",
) {
  const numbers = targets.map(
    (id) => `${seats.find((s) => s.id === id)?.number ?? "?"} 号`,
  );
  while (numbers.length < action.targetCount) numbers.push("__ 号");
  const kind = action.choiceKind ?? "select";
  return kind === "master"
    ? `${subject}选择 ${numbers.join("、")} 作为主人`
    : `${subject}${choiceLabels[kind]} ${numbers.join("、")}`;
}

/** Single-choice taps replace the old selection; two-choice slots remain distinct. */
export function toggleChoice(targets: string[], id: string, count: number) {
  if (targets.includes(id)) return targets.filter((target) => target !== id);
  if (count === 1) return [id];
  return targets.length < count ? [...targets, id] : targets;
}
