import { randomUUID } from "node:crypto";
import type { PublicRecord } from "../shared/types";
import type { Room } from "./game";
export function publicRecord(
  r: Room,
  entry: Omit<PublicRecord, "id" | "day" | "period" | "createdAt">,
) {
  r.publicRecords.push({
    id: randomUUID(),
    day: r.day,
    period: r.phase === "DAY" ? "DAY" : "NIGHT",
    createdAt: new Date().toISOString(),
    ...entry,
  });
}
