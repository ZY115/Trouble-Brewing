import type { LiveVote, PublicRecord } from "./types";

export function currentVoteRecord(vote: LiveVote, records: PublicRecord[]) {
  let record = records.find((r) => r.id === vote.recordId);
  const seen = new Set<string>();
  while (record && !seen.has(record.id)) {
    seen.add(record.id);
    const next = records.find((r) => r.supersedes === record!.id);
    if (!next) break;
    record = next;
  }
  return record;
}

/** Sort by original ballot position, not the time a historical correction was appended. */
export function latestVoteRecord(records: PublicRecord[]) {
  let latest: PublicRecord | undefined,
    latestIndex = -1;
  for (const record of records.filter(
    (r) => r.type === "vote" && !records.some((n) => n.supersedes === r.id),
  )) {
    let root = record;
    const seen = new Set<string>();
    while (root.supersedes && !seen.has(root.id)) {
      seen.add(root.id);
      const parent = records.find((r) => r.id === root.supersedes);
      if (!parent) break;
      root = parent;
    }
    const index = records.indexOf(root);
    if (index > latestIndex) {
      latest = record;
      latestIndex = index;
    }
  }
  return latest;
}

export function ballotStatus(
  vote: LiveVote | undefined,
  records: PublicRecord[],
  seatId: string,
): string {
  const active = vote && ["OPEN", "COUNTING"].includes(vote.status);
  const record = active ? undefined : latestVoteRecord(records);
  if (record) {
    if (record.voters?.includes(seatId)) return "已投 1 票";
    if (record.eligibleAtVote && !record.eligibleAtVote.includes(seatId))
      return "无可用死者票";
    return record.eligibleAtVote ? "未投 / 弃票" : "未投（资格未记录）";
  }
  if (!vote) return "—";
  if (vote.status === "CANCELLED") return "本次已取消";
  if (vote.counted[seatId]) return "已计 1 票";
  if (vote.eligibleAtVote && !vote.eligibleAtVote.includes(seatId))
    return "无可用死者票";
  if (seatId in vote.counted)
    return vote.counted[seatId] ? "已计 1 票" : "未投 / 弃票";
  return vote.hands[seatId] ? "已举手 · 待计票" : "未举手 · 待计票";
}

export function abstentionSummary(record: PublicRecord): string {
  if (record.type !== "vote" || !record.seatNumbers) return "";
  const all = Object.keys(record.seatNumbers);
  const missing = all.filter((id) => !record.voters?.includes(id));
  const names = (ids: string[]) =>
    ids.map((id) => `${record.seatNumbers![id]} 号`).join("、") || "无";
  if (!record.eligibleAtVote)
    return `未投票（当时资格未记录）：${names(missing)}`;
  return `未投 / 弃票：${names(missing.filter((id) => record.eligibleAtVote!.includes(id)))}；无可用死者票：${names(missing.filter((id) => !record.eligibleAtVote!.includes(id)))}`;
}
