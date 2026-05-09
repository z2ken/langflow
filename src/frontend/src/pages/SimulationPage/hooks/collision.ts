import { BufferGeometry, Matrix4 } from "three";
import {
  MeshBVH,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { getActuatedJointNames } from "./urdfChain";

let bvhPatched = false;
function ensureBvhPatched(): void {
  if (bvhPatched) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  bvhPatched = true;
}

export interface LinkBVH {
  linkName: string;
  geometry: BufferGeometry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkObject: any;
}

const ADJACENT_THRESHOLD = 1;

export function intersectGeometryPair(
  a: BufferGeometry,
  worldA: Matrix4,
  b: BufferGeometry,
  worldB: Matrix4,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bvhA = (a as any).boundsTree as MeshBVH | undefined;
  if (!bvhA) {
    throw new Error("intersectGeometryPair: geometry A has no boundsTree");
  }
  const aInv = worldA.clone().invert();
  const transform = aInv.multiply(worldB);
  return bvhA.intersectsGeometry(b, transform);
}

export function buildLinkBVHs(robot: URDFRobot): LinkBVH[] {
  ensureBvhPatched();
  const out: LinkBVH[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links = (robot as any).links;
  if (!links) return out;

  // Walk all links in URDF declaration order; URDFs declare links serially
  // along the kinematic chain, so insertion order ≈ adjacency order, which
  // is what ADJACENT_THRESHOLD relies on.
  for (const name of Object.keys(links)) {
    const link = links[name];
    if (!link) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mesh: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    link.traverse((obj: any) => {
      if (!mesh && obj.isMesh && obj.geometry) mesh = obj;
    });
    if (!mesh) continue;
    const geom = mesh.geometry as BufferGeometry;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(geom as any).boundsTree) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (geom as any).computeBoundsTree();
    }
    out.push({ linkName: name, geometry: geom, linkObject: mesh });
  }
  return out;
}

export function collidingLinks(
  bvhs: LinkBVH[],
  robot: URDFRobot,
): Set<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (robot as any).updateMatrixWorld?.(true);

  const colliding = new Set<string>();
  for (let i = 0; i < bvhs.length; i++) {
    for (let j = i + 1; j < bvhs.length; j++) {
      if (j - i <= ADJACENT_THRESHOLD) continue;
      const a = bvhs[i];
      const b = bvhs[j];
      const wA = a.linkObject.matrixWorld as Matrix4;
      const wB = b.linkObject.matrixWorld as Matrix4;
      if (intersectGeometryPair(a.geometry, wA, b.geometry, wB)) {
        colliding.add(a.linkName);
        colliding.add(b.linkName);
      }
    }
  }
  return colliding;
}

export function checkCollisionsAt(
  robot: URDFRobot,
  bvhs: LinkBVH[],
  jointsRad: number[],
): Set<string> {
  const names = getActuatedJointNames(robot);
  for (let i = 0; i < names.length && i < jointsRad.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (robot as any).setJointValue?.(names[i], jointsRad[i]);
  }
  return collidingLinks(bvhs, robot);
}
