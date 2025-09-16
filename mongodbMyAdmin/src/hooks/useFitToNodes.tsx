import { useCallback, useRef } from "react";
import type { ReactFlowInstance, Node } from "reactflow";
import { estimateNodeHeight } from "../lib/layout";

export function useFitToNodes() {
  const didInitialFitRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const pendingFitRef = useRef(false);

  const fitToNodes = useCallback((rf: ReactFlowInstance | null) => {
    if (!rf || didInitialFitRef.current) return;
    const visible = (nodesRef.current || []).filter(n => !n.hidden);
    if (!visible.length) return;

    const NODE_W = 260;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visible) {
      const h = estimateNodeHeight((n.data as any)?.doc ?? {});
      const x1 = n.position.x, y1 = n.position.y, x2 = x1 + NODE_W, y2 = y1 + h;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    const margin = 200;
    const bounds = {
      x: minX - margin,
      y: minY - margin,
      width: (maxX - minX) + margin * 2,
      height: (maxY - minY) + margin * 2,
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitBounds(bounds, { padding: 0.15, duration: 0 });
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        rf.setCenter(cx, cy, { zoom: Math.max(0.35, rf.getZoom() * 0.9), duration: 0 });
        didInitialFitRef.current = true;
        pendingFitRef.current = false;
      });
    });
  }, []);

  return {
    nodesRef,
    didInitialFitRef,
    pendingFitRef,
    fitToNodes,
  };
}