import type { MongoDocument } from "../types";
import type { Node } from "reactflow";
import { Position } from "reactflow";
import { normalizeForDisplay } from "./helpers";

// ——— heights ———
export function estimateNodeHeight(doc: any): number {
  const base = 64;
  const lines = Math.min(6, Math.max(0, Object.keys(doc || {}).filter((k) => k !== "_id").length));
  const perLine = 28;
  return base + lines * perLine;
}

export function masonryNodes(
  docs: MongoDocument[],
  collection: string,
  cols = 4,
  opts?: { nodeWidth?: number; gapX?: number; gapY?: number }
): Node[] {
  const NODE_W = opts?.nodeWidth ?? 260;
  const gapX = opts?.gapX ?? 24;
  const gapY = opts?.gapY ?? 24;
  const stepX = NODE_W + gapX;

  const colHeights = new Array(cols).fill(0);
  const nodes: Node[] = [];

  docs.forEach((doc, i) => {
    const h = estimateNodeHeight(doc);
    const col = colHeights.indexOf(Math.min(...colHeights));
    const x = col * stepX;
    const y = colHeights[col];
    const raw = (normalizeForDisplay(doc?._id) as any) ?? String(i);

    nodes.push({
      id: `${collection}:${raw}`,
      type: "doc",
      data: { collection, doc, _id: raw },
      position: { x, y },
      draggable: true,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    colHeights[col] += h + gapY;
  });

  return nodes;
}

export function separateOverlaps(arr: Node[], gap: number): Node[] {
  const out = arr.map(n => ({ ...n, position: { ...n.position } }));
  const buckets = new Map<number, Node[]>();
  const keyX = (x: number) => Math.round(x);

  for (const n of out) {
    const k = keyX(n.position.x);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(n);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.position.y - b.position.y);
    let cursor = -Infinity;
    for (const n of list) {
      const h = estimateNodeHeight((n.data as any)?.doc ?? {});
      if (n.position.y < cursor) n.position.y = cursor;
      cursor = n.position.y + h + gap;
    }
  }
  return out;
}

export function separateUsingDOM(arr: Node[], gap: number): Node[] {
  const out = arr.map(n => ({ ...n, position: { ...n.position } }));
  const buckets = new Map<number, Node[]>();
  const keyX = (x: number) => Math.round(x);

  for (const n of out) {
    const k = keyX(n.position.x);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(n);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.position.y - b.position.y);
    let cursor = -Infinity;
    for (const n of list) {
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
      const hDom = el?.offsetHeight ?? estimateNodeHeight((n.data as any)?.doc ?? {});
      if (n.position.y < cursor) n.position.y = cursor;
      cursor = n.position.y + hDom + gap;
    }
  }
  return out;
}

export function relaxColumns(arr: Node[], extra = 36) {
  const buckets = new Map<number, Node[]>();
  const round = (x: number) => Math.round(x);
  for (const n of arr) {
    const key = round(n.position.x);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(n);
  }
  const out: Node[] = arr.map((n) => ({ ...n, position: { ...n.position } }));
  for (const [, list] of buckets.entries()) {
    list.sort((a, b) => a.position.y - b.position.y);
    let cursor = Math.min(...list.map((n) => n.position.y));
    for (const n of list) {
      const doc = (n.data as any)?.doc ?? {};
      const h = estimateNodeHeight(doc);
      const outNode = out.find((x) => x.id === n.id)!;
      outNode.position.y = cursor;
      cursor += h + extra;
    }
  }
  return out;
}

export function keepPositions(arr: Node[], posMap: Map<string, {x:number;y:number}>) {
  return arr.map(n => {
    const saved = posMap.get(n.id);
    return saved ? { ...n, position: { ...saved } } : n;
  });
}