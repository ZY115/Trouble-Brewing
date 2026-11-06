let advanced: { from: number; done: Promise<boolean> } | null = null;
export function markAdvance(from: number, done: Promise<boolean>) {
  advanced = { from, done };
  return done;
}
export const advancedHere = (from: number) => (advanced?.from === from ? advanced.done : null);
