import type { PublicSeat } from "./types";
export function registrationStatus(
  capacity: number,
  seats: PublicSeat[],
  open: boolean,
) {
  const counts = new Map<number, number>();
  for (const seat of seats)
    counts.set(seat.number, (counts.get(seat.number) ?? 0) + 1);
  const duplicateNumbers = [...counts]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((a, b) => a - b);
  const missingNumbers = Array.from(
    { length: capacity },
    (_, i) => i + 1,
  ).filter((number) => !counts.has(number));
  return {
    open,
    joined: seats.length,
    duplicateNumbers,
    missingNumbers,
    ready:
      seats.length === capacity &&
      duplicateNumbers.length === 0 &&
      missingNumbers.length === 0,
  };
}
