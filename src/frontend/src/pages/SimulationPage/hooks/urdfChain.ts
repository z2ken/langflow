import type { URDFRobot } from "urdf-loader/src/URDFClasses";

export function getActuatedJointNames(robot: URDFRobot): string[] {
  const joints = (robot as any).joints ?? {};
  return Object.entries<any>(joints)
    .filter(([, j]) => j?.jointType && j.jointType !== "fixed")
    .map(([name]) => name);
}

export function getEndEffectorLinkName(robot: URDFRobot): string | null {
  const actuated = getActuatedJointNames(robot);
  if (actuated.length === 0) return null;
  const lastJoint = (robot as any).joints?.[actuated[actuated.length - 1]];
  const firstLinkChild = lastJoint?.children?.find((c: any) => c?.isURDFLink);
  if (!firstLinkChild?.name) return null;

  let link: string = firstLinkChild.name;
  const allJoints: Record<string, any> = (robot as any).joints ?? {};
  const visited = new Set<string>();
  while (!visited.has(link)) {
    visited.add(link);
    let advanced = false;
    for (const j of Object.values(allJoints)) {
      if (j?.jointType !== "fixed") continue;
      if (j?.parent?.name !== link) continue;
      const c = j.children?.find((x: any) => x?.isURDFLink);
      if (c?.name) {
        link = c.name;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  return link;
}
