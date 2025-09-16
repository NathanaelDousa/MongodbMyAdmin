import type { DocHistoryItem } from "../types";

export function idToString(id: any): string {
  if (id == null) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object") {
    if ("$oid" in id) return (id as any)["$oid"];
    if ("oid" in id) return (id as any)["oid"];
    try { return String(id); } catch { return "[ObjectId]"; }
  }
  return String(id);
}

export function normalizeForDisplay(value: any): any {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

  if (typeof value === "object") {
    if ("$oid" in value) return (value as any)["$oid"];
    if ("$date" in value) {
      const d = (value as any)["$date"];
      if (typeof d === "string" || typeof d === "number") return new Date(d).toISOString();
      if (d && typeof d === "object" && "$numberLong" in d) return new Date(Number((d as any).$numberLong)).toISOString();
      return String(d);
    }
    if ("$numberDecimal" in value) return (value as any)["$numberDecimal"];
    if ("$numberLong" in value) return (value as any)["$numberLong"];
    if ("$binary" in value) return `Binary(${(value as any).$binary?.base64?.length ?? "?"}b)`;
    if ("$regex" in value) return `/${(value as any).$regex}/${(value as any).$options ?? ""}`;

    if (Array.isArray(value)) return value.map(normalizeForDisplay);

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeForDisplay(v);
    return out;
  }

  return String(value);
}

export function shortVal(v: any) {
  const val = normalizeForDisplay(v);
  if (val == null) return String(val);
  if (typeof val === "string") return val.length > 32 ? val.slice(0, 29) + "…" : val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === "object") return "{…}";
  return String(val);
}

export function safeStringify(obj: any, space = 2) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      obj,
      (_k, v) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      },
      space
    );
  } catch (e) {
    return "// Failed to stringify document\n" + String(e);
  }
}

export function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Local history helpers (per doc)
function histKey(collection: string, id: string) {
  return `mv_hist:${collection}:${id}`;
}
export function loadHistory(collection: string, id: string): DocHistoryItem[] {
  try {
    const raw = localStorage.getItem(histKey(collection, id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
export function pushHistory(collection: string, id: string, doc: any) {
  const arr = loadHistory(collection, id);
  arr.unshift({ ts: Date.now(), doc });
  localStorage.setItem(histKey(collection, id), JSON.stringify(arr.slice(0, 20)));
}

// Template helper for “Use previous structure”
export function buildTemplateFromDoc(src: any): any {
  if (src == null) return null;
  if (Array.isArray(src)) {
    if (src.length && typeof src[0] === "object") return [buildTemplateFromDoc(src[0])];
    return [];
  }
  if (typeof src !== "object") {
    if (typeof src === "string") return "";
    if (typeof src === "number") return 0;
    if (typeof src === "boolean") return false;
    return null;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "_id") continue;
    out[k] = buildTemplateFromDoc(v);
  }
  return out;
}
export function templateJsonFromDoc(src: any): string {
  try {
    return JSON.stringify(buildTemplateFromDoc(src) ?? {}, null, 2);
  } catch {
    return "{\n\n}";
  }
}

export function pickTitle(doc: any) {
  return doc?.name ?? doc?.title ?? doc?.email ?? doc?.sku ?? idToString(doc?._id) ?? "document";
}