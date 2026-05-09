import { BoxGeometry, Matrix4 } from "three";
import { computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { intersectGeometryPair } from "../hooks/collision";

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BoxGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BoxGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
});

describe("intersectGeometryPair", () => {
  it("detects two overlapping unit cubes at the origin", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const identity = new Matrix4().identity();
    expect(intersectGeometryPair(a, identity, b, identity)).toBe(true);
  });

  it("returns false for two unit cubes 5 units apart", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const wA = new Matrix4().identity();
    const wB = new Matrix4().makeTranslation(5, 0, 0);
    expect(intersectGeometryPair(a, wA, b, wB)).toBe(false);
  });

  it("detects edge contact within tolerance", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const wA = new Matrix4().identity();
    const wB = new Matrix4().makeTranslation(0.99, 0, 0);
    expect(intersectGeometryPair(a, wA, b, wB)).toBe(true);
  });
});
