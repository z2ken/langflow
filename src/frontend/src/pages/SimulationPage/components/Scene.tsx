// src/frontend/src/pages/SimulationPage/components/Scene.tsx
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { ReactNode } from "react";

export function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas
      camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}
      shadows
      style={{ background: "#1a1a1a" }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[3, 5, 2]} intensity={1.0} castShadow />
      <Grid
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.5}
        sectionSize={1}
        sectionThickness={1}
        infiniteGrid
      />
      <axesHelper args={[0.5]} />
      <OrbitControls makeDefault />
      {children}
    </Canvas>
  );
}
