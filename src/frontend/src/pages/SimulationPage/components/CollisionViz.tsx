import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  /** Set of colliding link names, from useCollision().check(...) */
  colliding: Set<string>;
}

/**
 * For each colliding link, emit a translucent red mesh that shares the
 * link's geometry. The robot's existing visuals stay; we just overlay.
 */
export function CollisionViz({ robot, colliding }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const linkMeshes = useMemo(() => {
    if (colliding.size === 0) return [];
    const links = (robot as any).links;
    if (!links) return [];
    const out: { name: string; geom: any; obj: any }[] = [];
    Array.from(colliding).forEach((name) => {
      const link = links[name];
      if (!link) return;
      let firstMesh: any = null;
      link.traverse((o: any) => {
        if (!firstMesh && o.isMesh && o.geometry) firstMesh = o;
      });
      if (firstMesh) out.push({ name, geom: firstMesh.geometry, obj: firstMesh });
    });
    return out;
  }, [robot, colliding]);

  if (linkMeshes.length === 0) return null;

  return (
    <>
      {linkMeshes.map(({ name, geom, obj }) => (
        <mesh
          key={name}
          geometry={geom as any}
          position={obj.getWorldPosition(new Vector3())}
          quaternion={obj.getWorldQuaternion(new Quaternion())}
        >
          <meshBasicMaterial
            color="#ff3333"
            transparent
            opacity={0.4}
            depthTest={false}
          />
        </mesh>
      ))}
    </>
  );
}
