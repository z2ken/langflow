import { useEffect, useState } from "react";
import URDFLoader from "urdf-loader";
import { URDFRobot } from "urdf-loader/src/URDFClasses";
import { LoadingManager, Mesh, MeshStandardMaterial } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

interface UrdfState {
  robot: URDFRobot | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

// Simple in-memory cache keyed by robotId to avoid redundant parses.
const robotCache = new Map<string, URDFRobot>();

export function useUrdf(robotId: string | null): UrdfState {
  const [state, setState] = useState<UrdfState>({
    robot: null,
    status: "idle",
    error: null,
  });

  useEffect(() => {
    if (!robotId) {
      setState({ robot: null, status: "idle", error: null });
      return;
    }

    // Return cached robot immediately if available.
    const cached = robotCache.get(robotId);
    if (cached) {
      setState({ robot: cached, status: "ready", error: null });
      return;
    }

    let cancelled = false;
    setState({ robot: null, status: "loading", error: null });

    (async () => {
      try {
        const res = await fetch(`/api/v1/robots/${robotId}/urdf`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(
            (detail as { detail?: string }).detail ?? `HTTP ${res.status}`,
          );
        }
        const { urdf_xml, mesh_base_url } = (await res.json()) as {
          urdf_xml: string;
          mesh_base_url: string;
        };
        if (cancelled) return;

        const manager = new LoadingManager();
        const loader = new URDFLoader(manager);

        // Cast loadMeshCb assignment to any because the loader's declared
        // signature uses Object3D for the done callback, but Three.js loaders
        // hand back subclasses (Mesh, Scene) that are not always typed that way.
        (loader as any).loadMeshCb = (
          path: string,
          mgr: LoadingManager,
          done: (obj: any, err?: Error) => void,
        ) => {
          // Strip any package:// or absolute prefix; map to mesh_base_url.
          const filename = path.replace(/^.*\//, "");
          const url = `${mesh_base_url}/${filename}`;
          const ext = filename.split(".").pop()?.toLowerCase();

          if (ext === "stl") {
            new STLLoader(mgr).load(url, (geo: any) => {
              // geo is a BufferGeometry at runtime; cast to any to satisfy
              // the Mesh constructor overload that expects BufferGeometry.
              done(new Mesh(geo, new MeshStandardMaterial({ color: 0x999999 })));
            });
          } else if (ext === "dae") {
            new ColladaLoader(mgr).load(url, (col: any) => done(col.scene));
          } else {
            // Unsupported mesh format — signal loader to skip gracefully.
            done(null as any);
          }
        };

        const robot = loader.parse(urdf_xml);
        if (cancelled) return;

        robotCache.set(robotId, robot);
        setState({ robot, status: "ready", error: null });
      } catch (e: any) {
        if (!cancelled) {
          setState({ robot: null, status: "error", error: e.message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [robotId]);

  return state;
}
