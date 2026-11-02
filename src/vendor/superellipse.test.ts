import { describe, it, expect } from "vitest";
import { superellipseSeatAngles, superellipsePosition } from "./superellipse";

describe("superellipseSeatAngles", () => {
  it("returns a single seat at angle 0 for one player", () => {
    expect(superellipseSeatAngles(1, 40, 38, 1.3)).toEqual([0]);
    expect(superellipseSeatAngles(0, 40, 38, 1.3)).toEqual([0]);
  });

  it("returns one finite, distinct angle per seat", () => {
    const angles = superellipseSeatAngles(8, 40, 38, 1.3);
    expect(angles).toHaveLength(8);
    angles.forEach((a) => expect(Number.isFinite(a)).toBe(true));
    expect(new Set(angles.map((a) => a.toFixed(4))).size).toBe(8);
  });

  it("is deterministic for the same inputs", () => {
    expect(superellipseSeatAngles(12, 42, 40, 1.24)).toEqual(
      superellipseSeatAngles(12, 42, 40, 1.24),
    );
  });
});

describe("superellipsePosition", () => {
  it("maps cardinal angles to the expected board-relative percentages", () => {
    expect(superellipsePosition(0, 40, 38)).toEqual({ left: 90, top: 50 });
    const left = superellipsePosition(Math.PI, 40, 38);
    expect(left.left).toBeCloseTo(10, 6);
    expect(left.top).toBeCloseTo(50, 6);
    const bottom = superellipsePosition(Math.PI / 2, 40, 38);
    expect(bottom.left).toBeCloseTo(50, 6);
    expect(bottom.top).toBeCloseTo(88, 6);
  });
});
