import type { Edge, Node } from "reactflow";
import { MarkerType } from "reactflow";
import type { Relation } from "../types";
import { idToString } from "./helpers";

const REL_KEY = "mv_relations:v1";

export function loadAllRelations(): Relation[] {
  try {
    const raw = localStorage.getItem(REL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
export function saveAllRelations(rels: Relation[]) {
  localStorage.setItem(REL_KEY, JSON.stringify(rels));
}

export function buildEdgesFromRelations(nodes: Node[], rels: Relation[]): Edge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return rels
    .filter((r) => ids.has(r.sourceId) && ids.has(r.targetId))
    .map((r) => ({
      id: `e:${r.sourceId}->${r.targetId}`,
      source: r.sourceId,
      target: r.targetId,
      label: r.viaField ?? "",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
      labelBgBorderRadius: 6,
      labelBgPadding: [2, 4] as any,
      labelBgStyle: { fill: "#fff" },
      animated: false,
    }));
}

export function guessViaField(sourceDoc: any, targetDoc: any, srcCol: string, tgtCol: string): string | undefined {
  const srcId = idToString(sourceDoc?._id);
  const tgtId = idToString(targetDoc?._id);

  for (const [k, v] of Object.entries(sourceDoc || {})) {
    if (k === "_id") continue;
    if (idToString(v) === tgtId) return k;
  }
  for (const [k, v] of Object.entries(targetDoc || {})) {
    if (k === "_id") continue;
    if (idToString(v) === srcId) return k;
  }
  const candidates = [
    `${tgtCol}Id`,
    `${tgtCol.slice(0, -1)}Id`,
    `ref${tgtCol[0].toUpperCase()}${tgtCol.slice(1)}Id`,
  ];
  for (const c of candidates) {
    if (c in (sourceDoc || {})) return c;
  }
  return undefined;
}