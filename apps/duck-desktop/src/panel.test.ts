import { expect, it } from "vitest";
import { panelBounds } from "./panel";

it("expands around the duck while staying inside a monitor with a negative origin", () => {
  const bounds = panelBounds({ x: -100, y: 700, width: 120, height: 120 }, { x: -1920, y: 0, width: 1920, height: 1040 }, 1, true);
  expect(bounds).toEqual({ x: -400, y: 200, width: 400, height: 620 });
});

it("collapses to the duck without keeping a large transparent hit area", () => {
  expect(panelBounds({ x: 100, y: 100, width: 440, height: 740 }, { x: 0, y: 0, width: 1920, height: 1080 }, 1, false)).toEqual({ x: 260, y: 720, width: 120, height: 120 });
});

it("keeps the input view compact while preserving the duck's anchor", () => {
  expect(panelBounds({ x: 100, y: 200, width: 400, height: 620 }, { x: 0, y: 0, width: 1920, height: 1080 }, 1, true, "compose")).toEqual({ x: 100, y: 490, width: 400, height: 330 });
});

it("fits a short output bubble and caps long replies", () => {
  const current = { x: 100, y: 490, width: 400, height: 330 };
  const work = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(panelBounds(current, work, 1, true, "output", 300)).toEqual({ x: 100, y: 520, width: 400, height: 300 });
  expect(panelBounds(current, work, 1, true, "output", 10_000).height).toBe(620);
});
