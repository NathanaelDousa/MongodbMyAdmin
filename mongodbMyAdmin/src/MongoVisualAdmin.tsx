import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Position,
  useNodesState,
  Handle,
  applyNodeChanges,
  type NodeChange,
} from "reactflow";
import type { Connection, Edge, Node, ReactFlowInstance } from "reactflow";
import "reactflow/dist/style.css";
import logo from "/src/assets/MongoDBMyAdmin-logo-no-bg.png";

import {
  ChevronRight,
  Search,
  Settings,
  Plus,
  X,
  Wifi,
  Wand2,
  History,
  ListStart,
  Link as LinkIcon,
  Unlink,
  LayoutGrid,
  GalleryHorizontalEnd,
} from "lucide-react";
import {
  Button,
  Card,
  Form,
  Modal,
  Nav,
  Tab,
  Row,
  Col,
  Dropdown,
  Spinner,
  Alert,
  ButtonGroup,
  ToggleButton,
  Badge,
  Table,
} from "react-bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";

// ============================================================
// Types
// ============================================================
type MongoDocument = { _id: any; [key: string]: any };
type Collection = { name: string; count: number };

type ConnectionProfile = {
  _id: string;
  name: string;
  engine: "driver" | "data_api";
  defaultDatabase?: string;
};

type Relation = {
  sourceId: string;   // "collection:docId"
  targetId: string;   // "collection:docId"
  viaField?: string;  // optioneel: userId, authorId, ...
};

// ============================================================
// Mock data (used when no backend connection is selected)
// ============================================================
const MOCK_COLLECTIONS: Collection[] = [
  { name: "users", count: 42 },
  { name: "orders", count: 128 },
  { name: "products", count: 23 },
  { name: "reviews", count: 311 },
];

const MOCK_DOCS: Record<string, MongoDocument[]> = {
  users: Array.from({ length: 10 }).map((_, i) => ({
    _id: `u_${i + 1}`,
    name: ["Maria", "Jens", "Amina", "Noah", "Léa", "Sven"][i % 6] + " " + (100 + i),
    email: `user${i + 1}@example.com`,
    role: ["admin", "editor", "viewer"][i % 3],
  })),
  orders: Array.from({ length: 8 }).map((_, i) => ({
    _id: `o_${i + 1}`,
    userId: `u_${(i % 10) + 1}`,
    total: (Math.round(Math.random() * 20000) / 100).toFixed(2),
    status: ["pending", "paid", "shipped"][i % 3],
  })),
  products: Array.from({ length: 6 }).map((_, i) => ({
    _id: `p_${i + 1}`,
    sku: `SKU-${i + 1}`,
    title: ["Lamp", "Chair", "Table", "Cable", "Mouse", "Plant"][i],
    price: (Math.round(Math.random() * 30000) / 100).toFixed(2),
  })),
  reviews: Array.from({ length: 10 }).map((_, i) => ({
    _id: `r_${i + 1}`,
    productId: `p_${(i % 6) + 1}`,
    userId: `u_${(i % 10) + 1}`,
    rating: (i % 5) + 1,
    text: "Nice! ".repeat((i % 4) + 1).trim(),
  })),
};

// ============================================================
// API Client (Laravel endpoints). Set VITE_API_URL in your frontend .env
// ============================================================
const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Connections
async function listConnections(): Promise<ConnectionProfile[]> {
  return api<ConnectionProfile[]>("/connections");
}
async function createConnection(payload: {
  name: string;
  engine: "driver" | "data_api";
  uri?: string;
  defaultDatabase?: string;
}): Promise<ConnectionProfile> {
  return api<ConnectionProfile>("/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
async function testConnection(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/connections/${id}/test`, { method: "POST" });
}

// Data
async function getCollections(profileId: string, db?: string): Promise<Collection[]> {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);
  return api<Collection[]>(`/collections?${params.toString()}`);
}
async function getDocs(profileId: string, collection: string, db?: string, limit = 100) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);
  params.set("limit", String(limit));
  return api<MongoDocument[]>(`/collections/${collection}/docs?${params.toString()}`);
}
async function createDoc(profileId: string, collection: string, db: string | undefined, doc: any) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);

  return api<MongoDocument>(`/collections/${collection}/docs?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
}
async function deleteDoc(profileId: string, collection: string, db: string | undefined, id: string) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);

  return api<{ deletedCount: number }>(`/collections/${collection}/docs/${id}?${params.toString()}`, {
    method: "DELETE",
  });
}
// Update (Edit) – PATCH i.p.v. PUT (volgens Allow-header)
async function updateDoc(
  profileId: string,
  collection: string,
  db: string | undefined,
  id: string,
  doc: any
) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);

  const { _id, ...payload } = doc ?? {}; // _id niet terugsturen
  return api<MongoDocument>(
    `/collections/${collection}/docs/${id}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

// ============================================================
// Helpers (Mongo Extended JSON → display-safe)
// ============================================================
function idToString(id: any): string {
  if (id == null) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object") {
    if ("$oid" in id) return (id as any)["$oid"];
    if ("oid" in id) return (id as any)["oid"];
    try { return String(id); } catch { return "[ObjectId]"; }
  }
  return String(id);
}

function normalizeForDisplay(value: any): any {
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

// Safe stringify voor modal JSON
function safeStringify(obj: any, space = 2) {
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

// Export helper
function downloadJson(filename: string, data: any) {
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
type DocHistoryItem = { ts: number; doc: any };
function loadHistory(collection: string, id: string): DocHistoryItem[] {
  try {
    const raw = localStorage.getItem(histKey(collection, id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function pushHistory(collection: string, id: string, doc: any) {
  const arr = loadHistory(collection, id);
  arr.unshift({ ts: Date.now(), doc });
  localStorage.setItem(histKey(collection, id), JSON.stringify(arr.slice(0, 20)));
}

// Template helper for “Use previous structure”
function buildTemplateFromDoc(src: any): any {
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
function templateJsonFromDoc(src: any): string {
  try {
    return JSON.stringify(buildTemplateFromDoc(src) ?? {}, null, 2);
  } catch {
    return "{\n\n}";
  }
}

// ============================================================
// Relations: storage + helpers
// ============================================================
const REL_KEY = "mv_relations:v1"; // globale store (collection-overschrijdend)

function loadAllRelations(): Relation[] {
  try {
    const raw = localStorage.getItem(REL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveAllRelations(rels: Relation[]) {
  localStorage.setItem(REL_KEY, JSON.stringify(rels));
}

function buildEdgesFromRelations(nodes: Node[], rels: Relation[]): Edge[] {
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

// Heuristiek: probeer viaField af te leiden
function guessViaField(sourceDoc: any, targetDoc: any, srcCol: string, tgtCol: string): string | undefined {
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

// ============================================================
// Custom Node (vertical UI)
// ============================================================
function pickTitle(doc: any) {
  return doc?.name ?? doc?.title ?? doc?.email ?? doc?.sku ?? idToString(doc?._id) ?? "document";
}
function shortVal(v: any) {
  const val = normalizeForDisplay(v);
  if (val == null) return String(val);
  if (typeof val === "string") return val.length > 32 ? val.slice(0, 29) + "…" : val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === "object") return "{…}";
  return String(val);
}
function DocNode({ data }: any) {
  const doc = data.doc || {};
  const displayDoc = normalizeForDisplay(doc);
  const fields = Object.entries(displayDoc)
    .filter(([k]) => k !== "_id")
    .slice(0, 6);

  const handleStyle: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: 7,
    border: "2px solid #0d6efd",
    background: "#fff",
  };

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 8px 18px -10px rgba(0,0,0,.25)",
        minWidth: 240,
        cursor: "pointer",
        marginBottom: 70,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {data.collection}: {pickTitle(doc)}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {fields.map(([k, v]) => (
          <div
            key={k}
            style={{
              fontSize: 12,
              background: "#f8fafc",
              border: "1px solid #eef2f7",
              borderRadius: 8,
              padding: "6px 8px",
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={`${k}: ${shortVal(v)}`}
          >
            <strong style={{ opacity: 0.75 }}>{k}</strong>
            <span style={{ opacity: 0.5 }}> : </span>
            <span>{shortVal(v)}</span>
          </div>
        ))}
      </div>

      <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -7 }} />
      <Handle type="source" position={Position.Right} style={{ ...handleStyle, right: -7 }} />
    </div>
  );
}

// ============================================================
// Masonry helpers (voorkomt overlap door kolom-hoogtes)
// ============================================================
function estimateNodeHeight(doc: any): number {
  const base = 64;
  const lines = Math.min(6, Math.max(0, Object.keys(doc || {}).filter((k) => k !== "_id").length));
  const perLine = 28;
  return base + lines * perLine;
}
function masonryNodes(docs: MongoDocument[], collection: string, cols = 4): Node[] {
  const gapX = 280;
  const gapY = 24;
  const colHeights = new Array(cols).fill(0);
  const nodes: Node[] = [];

  docs.forEach((doc, i) => {
    const h = estimateNodeHeight(doc);
    const col = colHeights.indexOf(Math.min(...colHeights));
    const x = col * gapX;
       const y = colHeights[col];
    const raw = idToString(doc?._id) || String(i);

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

// ============================================================
// Connection Wizard (Bootstrap)
// ============================================================
function ConnectionWizard({
  show,
  onClose,
  onConnected,
}: {
  show: boolean;
  onClose: () => void;
  onConnected: (profile: ConnectionProfile) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [engine, setEngine] = useState<"driver" | "data_api">("driver");
  const [name, setName] = useState("My Mongo");
  const [uri, setUri] = useState("");
  const [defaultDb, setDefaultDb] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ConnectionProfile | null>(null);

  const reset = () => {
    setStep(1);
    setEngine("driver");
    setName("My Mongo");
    setUri("");
    setDefaultDb("");
    setSaving(false);
    setTesting(false);
    setError(null);
    setCreated(null);
  };

  useEffect(() => {
    if (!show) reset();
  }, [show]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const prof = await createConnection({
        name,
        engine,
        uri,
        defaultDatabase: defaultDb || undefined,
      });
      setCreated(prof);
      setStep(3);
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!created) return;
    try {
      setTesting(true);
      setError(null);
      const res = await testConnection(created._id);
      if (res.ok) onConnected(created);
    } catch (e: any) {
      setError(e.message || "Connection failed. Check URI / Atlas IP allowlist / credentials.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal show={show} onHide={onClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <Wifi size={18} className="me-2" /> Add Connection
          <small className="text-muted ms-2">Step {step} of 3</small>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {step === 1 && (
          <div>
            <h6 className="mb-3">Choose Source</h6>
            <div className="d-grid gap-2">
              <Button variant={engine === "driver" ? "primary" : "outline-secondary"} onClick={() => setEngine("driver")}>
                MongoDB Driver (Local or Atlas)
              </Button>
              <Button variant={engine === "data_api" ? "primary" : "outline-secondary"} onClick={() => setEngine("data_api")}>
                Atlas Data API (HTTP)
              </Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <Form>
            <h6 className="mb-3">Enter Details</h6>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Name</Form.Label>
                  <Form.Control value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Atlas Prod" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Default Database</Form.Label>
                  <Form.Control value={defaultDb} onChange={(e) => setDefaultDb(e.target.value)} placeholder="e.g. appdb" />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group>
                  <Form.Label>{engine === "driver" ? "Mongo URI (mongodb:// or mongodb+srv://)" : "Atlas Data API Endpoint"}</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                    placeholder={
                      engine === "driver"
                        ? "mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority"
                        : "https://data.mongodb-api.com/app/.../endpoint/data/v1/action/find"
                    }
                  />
                  <Form.Text className="text-muted">Credentials are stored encrypted on the server.</Form.Text>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        )}
        {step === 3 && (
          <div>
            <h6 className="mb-3">Test Connection</h6>
            <p className="text-muted">We saved your profile. Now test the connection to make sure it works.</p>
            <Button onClick={handleTest} disabled={testing}>
              {testing ? (<><Spinner size="sm" className="me-2" />Testing...</>) : "Run Test"}
            </Button>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <div className="me-auto small text-muted">Engine: <code>{engine}</code></div>
        {step > 1 && <Button variant="light" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}>Back</Button>}
        {step < 3 && (
          <Button onClick={() => (step === 1 ? setStep(2) : handleSave())} disabled={(step === 2 && !uri) || saving}>
            {step === 1 ? "Continue" : saving ? <>Saving...</> : "Save Profile"}
          </Button>
        )}
        <Button variant="outline-secondary" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ============================================================
// Schema (simple inference)
// ============================================================
type FieldRow = { path: string; type: string; sample: string };

function inferType(val: any): string {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  const t = typeof val;
  if (t === "object") return "object";
  return t; // string, number, boolean
}

function walkSchemaRows(obj: any, base = ""): FieldRow[] {
  if (!obj || typeof obj !== "object") return [];
  const rows: FieldRow[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = base ? `${base}.${k}` : k;
    const t = inferType(v);
    if (t === "object") {
      rows.push({ path, type: "object", sample: "{…}" });
      rows.push(...walkSchemaRows(v, path));
    } else if (t === "array") {
      const sample = (v as any[])[0];
      rows.push({ path, type: "array", sample: sample == null ? "[]" : `[${inferType(sample)}]` });
      if (sample && typeof sample === "object" && !Array.isArray(sample)) {
        rows.push(...walkSchemaRows(sample, `${path}[]`));
      }
    } else {
      rows.push({ path, type: t, sample: String(shortVal(v)) });
    }
  }
  return rows;
}

// ============================================================
// Main App with List ↔ Canvas (+ Relations)
// ============================================================
type ViewMode = "list" | "canvas";

export default function App() {
  // Pan/drag behaviour
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const onNodeDragStart = useCallback(() => setDragging(true), []);
  const onNodeDragStop  = useCallback(() => setDragging(false), []);

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [db, setDb] = useState<string | undefined>(undefined);
  const [wizardOpen, setWizardOpen] = useState(false);

  // data
  const [collections, setCollections] = useState<Collection[]>(MOCK_COLLECTIONS);
  const [activeCollection, setActiveCollection] = useState<string>(MOCK_COLLECTIONS[0]?.name ?? "");
  const [query, setQuery] = useState("");
  const [docDetail, setDocDetail] = useState<MongoDocument | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createJson, setCreateJson] = useState<string>("{\n  \n}");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Template memory
  const [lastTemplateDoc, setLastTemplateDoc] = useState<any | null>(null);

  // React Flow nodes (one source of truth for the canvas/list we render)
  const [nodes, setNodes] = useNodesState([] as Node[]);
  const nodeTypes = useMemo(() => ({ doc: DocNode }), []);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  // === one-time fit machinery ===
  const didInitialFitRef = useRef(false);
  const pendingFitRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => { nodesRef.current = nodes as Node[]; }, [nodes]);

  // Relations
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationMode, setRelationMode] = useState<boolean>(false);

  // Edit modal state (for doc)
  const [isEditing, setIsEditing] = useState(false);
  const [editJson, setEditJson] = useState<string>("{}");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [docHistory, setDocHistory] = useState<DocHistoryItem[]>([]);

  // layout trigger (kan blijven bestaan voor andere doeleinden)
  const [layoutTick, setLayoutTick] = useState(0);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ---- spacing per kolom ----
  const relaxColumns = useCallback((arr: Node[], extra = 36) => {
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
  }, []);

  // === GEEN stubs: laat nodes ongemoeid ===
  const ensureRelationCounterparts = useCallback((baseNodes: Node[], _rels: Relation[]) => {
    return baseNodes;
  }, []);

  // ---------- helpers voor relation persist ----------
  const splitNodeId = useCallback((nodeId: string) => {
    const idx = nodeId.indexOf(":");
    if (idx === -1) return { col: activeCollection, id: nodeId };
    return { col: nodeId.slice(0, idx), id: nodeId.slice(idx + 1) };
  }, [activeCollection]);

  const refreshActiveAfterChange = useCallback(async () => {
    if (!activeCollection) return;
    if (!selected) {
      const docs = MOCK_DOCS[activeCollection] ?? [];
      const nodesNew = masonryNodes(docs, activeCollection, 4);
      const relaxed = relaxColumns(nodesNew, 36);
      const withNoStubs = ensureRelationCounterparts(relaxed, relations);
      setNodes(withNoStubs);
      setLastTemplateDoc(docs[0] ?? null);

      // reset one-shot fit en voer hem 1x uit
      didInitialFitRef.current = false;
      queueMicrotask(() => {
        if (!didInitialFitRef.current) {
          fitToNodes();
          didInitialFitRef.current = true;
        }
      });

      setLayoutTick((t) => t + 1);
      return;
    }
    const docs = await getDocs(selected._id, activeCollection, db, 100);
    const nodesNew = masonryNodes(docs, activeCollection, 4);
    const relaxed = relaxColumns(nodesNew, 36);
    const withNoStubs = ensureRelationCounterparts(relaxed, relations);
    setNodes(withNoStubs);
    setLastTemplateDoc(docs[0] ?? null);

    // reset one-shot fit en voer hem 1x uit
    didInitialFitRef.current = false;
    queueMicrotask(() => {
      if (!didInitialFitRef.current) {
        fitToNodes();
        didInitialFitRef.current = true;
      }
    });

    setLayoutTick((t) => t + 1);
  }, [activeCollection, selected, db, relaxColumns, relations, ensureRelationCounterparts, setNodes]);

  const persistRelation = useCallback(async (sourceNodeId: string, targetNodeId: string, chosenField: string) => {
    if (!selected) return;
    const { col: sCol, id: sId } = splitNodeId(sourceNodeId);
    const { id: tId } = splitNodeId(targetNodeId);
    await updateDoc(selected._id, sCol, db, sId, { [chosenField]: { $oid: tId } });
  }, [selected, db, splitNodeId]);

  const clearRelationField = useCallback(async (sourceNodeId: string, viaField?: string) => {
    if (!selected || !viaField) return;
    const { col: sCol, id: sId } = splitNodeId(sourceNodeId);
    await updateDoc(selected._id, sCol, db, sId, { [viaField]: null });
  }, [selected, db, splitNodeId]);

  // ---------- Init: load profiles + restore selected/db ----------
  useEffect(() => {
    listConnections()
      .then((list) => {
        setProfiles(list);
        const savedId = localStorage.getItem("mv_profile_id");
        const savedDb = localStorage.getItem("mv_profile_db") || undefined;
        if (savedDb) setDb(savedDb);
        if (savedId) {
          const match = list.find((p) => p._id === savedId);
          if (match) {
            setSelected(match);
            if (!savedDb && match.defaultDatabase) setDb(match.defaultDatabase);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ---------- Persist selection & db ----------
  useEffect(() => {
    if (selected?._id) localStorage.setItem("mv_profile_id", selected._id);
    else localStorage.removeItem("mv_profile_id");
  }, [selected?._id]);

  useEffect(() => {
    if (db) localStorage.setItem("mv_profile_db", db);
    else localStorage.removeItem("mv_profile_db");
  }, [db]);

  // ---------- Load collections when selected/db changes ----------
  useEffect(() => {
    if (!selected) {
      setCollections(MOCK_COLLECTIONS);
      setActiveCollection(MOCK_COLLECTIONS[0]?.name ?? "");
      return;
    }
    getCollections(selected._id, db)
      .then((cols) => {
        setCollections(cols);
        const next = cols[0]?.name ?? "";
        setActiveCollection(next);
      })
      .catch((e) => console.error("[collections error]", e));
  }, [selected, db]);

  // ---------- Load docs when activeCollection changes ----------
  useEffect(() => {
    setNodes([] as any[]);
    if (!activeCollection) return;

    const applyDocs = (docs: MongoDocument[]) => {
      const nodesNew = masonryNodes(docs, activeCollection, 4);
      const relaxed = relaxColumns(nodesNew, 36);
      const allRels = loadAllRelations();
      const withNoStubs = ensureRelationCounterparts(relaxed, allRels);
      setNodes(withNoStubs);
      setLastTemplateDoc(docs[0] ?? null);
      setRelations(allRels);

      // reset one-shot fit en voer hem 1x uit
      didInitialFitRef.current = false;
      queueMicrotask(() => {
        if (!didInitialFitRef.current) {
          fitToNodes();
          didInitialFitRef.current = true;
        }
      });

      setLayoutTick((t) => t + 1);
    };

    if (!selected) {
      const docs = MOCK_DOCS[activeCollection] ?? [];
      applyDocs(docs);
      return;
    }
    getDocs(selected._id, activeCollection, db, 100)
      .then(applyDocs)
      .catch((e) => console.error("[docs error]", e));
  }, [selected, db, activeCollection, relaxColumns, setNodes, ensureRelationCounterparts]);

  // ---------- Search filter (client-side) : reflect in nodes state so drag keeps working ----------
  useEffect(() => {
    if (!query.trim()) {
      setNodes((prev) => prev.map((n) => ({ ...n, hidden: false })));
      return;
    }
    const q = query.toLowerCase();
    setNodes((prev) =>
      prev.map((n) => {
        const data: any = n.data ?? {};
        const doc = data.doc ?? data;
        const match = JSON.stringify(doc).toLowerCase().includes(q);
        return { ...n, hidden: !match };
      })
    );
  }, [query, setNodes]);

// ---------- Auto-fit helper (one-shot, meer uitgezoomd) ----------
const fitToNodes = useCallback(() => {
    if (!rf || didInitialFitRef.current) return;

    const base = (nodesRef.current || []).filter(n => !n.hidden);
    if (!base.length) return;

    // bounds berekenen
    const NODE_W = 260;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of base) {
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

    // pas fit toe nádat ReactFlow canvas geverfd is
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitBounds(bounds, { padding: 0.15, duration: 0 });

        // centreer expliciet + klein tikje uitzoomen voor lucht
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        rf.setCenter(cx, cy, { zoom: Math.max(0.35, rf.getZoom() * 0.9), duration: 0 });

        didInitialFitRef.current = true;
        pendingFitRef.current = false;
      });
    });
  }, [rf]);

  // =============== List → Canvas bridge state ===============
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  type CanvasItem = { id: string; collection: string; doc: any };
  const [canvasPool, setCanvasPool] = useState<Map<string, CanvasItem>>(new Map());

  const CANVAS_KEY = "mv_canvas_pool:v1";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CANVAS_KEY);
      if (raw) {
        const arr: CanvasItem[] = JSON.parse(raw);
        setCanvasPool(new Map(arr.map(it => [it.id, it])));
      }
    } catch {}
  }, []);
  useEffect(() => {
    const arr = Array.from(canvasPool.values());
    localStorage.setItem(CANVAS_KEY, JSON.stringify(arr));
  }, [canvasPool]);

  const nodeToItem = (n: Node): CanvasItem | null => {
    const data: any = n.data ?? {};
    const doc = data.doc ?? {};
    if (!n.id) return null;
    return { id: n.id, collection: data.collection, doc };
  };

  const addItemsToCanvas = (items: CanvasItem[]) => {
    setCanvasPool(prev => {
      const next = new Map(prev);
      items.forEach(it => next.set(it.id, it));
      return next;
    });
  };
  const clearCanvas = () => setCanvasPool(new Map());

  // Build canvas nodes from canvasPool (cross-collection)
  const buildCanvasNodesFromPool = useCallback((): Node[] => {
    if (!canvasPool.size) return nodes as Node[];

    const groups = new Map<string, MongoDocument[]>();
    canvasPool.forEach(it => {
      const arr = groups.get(it.collection) ?? [];
      arr.push(it.doc);
      groups.set(it.collection, arr);
    });

    const out: Node[] = [];
    let xOffset = 0;
    const COLS_PER_GROUP = 2;
    const GROUP_GAP_X = 120;

    for (const [collection, docs] of groups.entries()) {
      const part = masonryNodes(docs, collection, COLS_PER_GROUP);
      part.forEach(n => {
        n.position.x += xOffset;
      });
      out.push(...part);
      xOffset += COLS_PER_GROUP * 280 + GROUP_GAP_X;
    }
    return out;
  }, [canvasPool, nodes]);
  // put this below buildCanvasNodesFromPool (and above edges memo is fine)
useEffect(() => {
  if (viewMode === "canvas") {
    // render the canvas pool as the current nodes
    const next = buildCanvasNodesFromPool();
    setNodes(next);

    // reset + fit after the canvas & nodes have actually painted
    didInitialFitRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitToNodes();
      });
    });
  } else {
    // back to list → restore list layout and do its one-time fit
    didInitialFitRef.current = false;
    refreshActiveAfterChange();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [viewMode, buildCanvasNodesFromPool]);

  // When switching to canvas, render canvas-pool as current nodes
  useEffect(() => {
    if (viewMode !== "canvas") return;

    const el = canvasWrapRef.current;
    if (!el) return;

    const maybeRun = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (nodesRef.current?.length ?? 0) > 0) {
        fitToNodes();
      }
    };

    // eerste check direct
    maybeRun();

    // daarna op size-veranderingen
    const ro = new ResizeObserver(() => maybeRun());
    ro.observe(el);

    return () => ro.disconnect();
  }, [viewMode, fitToNodes]);

  // Extra guard: zodra nodes veranderen en we in canvas zitten, doe (eenmalig) fit
  useEffect(() => {
    if (viewMode !== "canvas") return;
    if (!rf) return;
    if (!nodes.length) return;
    if (didInitialFitRef.current) return;
    fitToNodes();
  }, [nodes, rf, viewMode, fitToNodes]);

  // Edges derived from current nodes + relations
  const edges: Edge[] = useMemo(
    () => buildEdgesFromRelations(nodes as Node[], relations),
    [nodes, relations]
  );

  // Relation summary for list (counts)
  const relSummary = useMemo(() => {
    type Sum = { total: number; out: Record<string, number>; in: Record<string, number> };
    const sums: Record<string, Sum> = {};
    for (const n of nodes) {
      sums[n.id] = { total: 0, out: {}, in: {} };
    }
    for (const r of relations) {
      if (sums[r.sourceId]) {
        sums[r.sourceId].total += 1;
        const col = r.targetId.split(":")[0];
        sums[r.sourceId].out[col] = (sums[r.sourceId].out[col] ?? 0) + 1;
      }
      if (sums[r.targetId]) {
        sums[r.targetId].total += 1;
        const col = r.sourceId.split(":")[0];
        sums[r.targetId].in[col] = (sums[r.targetId].in[col] ?? 0) + 1;
      }
    }
    return sums;
  }, [nodes, relations]);

  // ---------- add/remove relation (edges only, no layout reset) ----------
  const addRelation = useCallback((r: Relation) => {
    setRelations((prev) => {
      if (prev.some((x) => x.sourceId === r.sourceId && x.targetId === r.targetId)) return prev;
      const next = [...prev, r];
      saveAllRelations(next);
      return next;
    });
  }, []);

  const removeRelation = useCallback((sourceId: string, targetId: string) => {
    setRelations((prev) => {
      const next = prev.filter((r) => !(r.sourceId === sourceId && r.targetId === targetId));
      saveAllRelations(next);
      return next;
    });
  }, []);

  // ---------- Open doc modal ----------
  const openDocFromNode = useCallback((node: Node) => {
    try {
      const maybe = (node as any)?.data;
      const doc = maybe?.doc ?? maybe;
      if (!doc || typeof doc !== "object") return;
      setDocDetail(doc as MongoDocument);
      setLastTemplateDoc(doc);
      setIsEditing(false);
      setEditJson(safeStringify(doc, 2));
      const idStr = idToString((doc as any)._id);
      setDocHistory(loadHistory((maybe?.collection as string) || activeCollection, idStr));
    } catch (err) {
      console.error("[openDocFromNode]", err, node);
    }
  }, [activeCollection]);

  const onNodeClick = useCallback((_e: any, node: Node) => openDocFromNode(node), [openDocFromNode]);
  const onNodeDoubleClick = useCallback((_e: any, node: Node) => openDocFromNode(node), [openDocFromNode]);

  // ---------- React Flow handlers ----------
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, [setNodes]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!relationMode) return;

    const sourceId = connection.source!;
    const targetId = connection.target!;
    const sourceNode = (nodes as Node[]).find(n => n.id === sourceId);
    const targetNode = (nodes as Node[]).find(n => n.id === targetId);

    let viaField: string | undefined;
    let sCol = activeCollection, tCol = activeCollection;

    if (sourceNode && targetNode) {
      sCol = (sourceNode.data as any).collection;
      tCol = (targetNode.data as any).collection;
      const sDoc = (sourceNode.data as any).doc;
      const tDoc = (targetNode.data as any).doc;
      viaField = guessViaField(sDoc, tDoc, sCol, tCol);
    }

    const fallback = tCol.endsWith("s") ? `${tCol.slice(0, -1)}Id` : `${tCol}Id`;
    const chosenField = viaField || fallback;

    // Optimistic UI: voeg edge toe
    addRelation({ sourceId, targetId, viaField: chosenField });

    // Persist + update bron-doc lokaal zodat JSON meteen klopt
    try {
      const { id: tId } = splitNodeId(targetId);
      await persistRelation(sourceId, targetId, chosenField);

      // update nodes bron-document
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== sourceId) return n;
          const data: any = n.data ?? {};
          const doc = { ...(data.doc ?? {}) };
          doc[chosenField] = { $oid: tId };
          return { ...n, data: { ...data, doc } };
        })
      );

      // update geopende modal (indien dit het bron-doc is)
      setDocDetail((prev) => {
        if (!prev) return prev;
        const myId = idToString((prev as any)._id);
        const { id: sId } = splitNodeId(sourceId);
        if (myId !== sId) return prev;
        const next = { ...prev, [chosenField]: { $oid: tId } };
        setEditJson(safeStringify(next, 2));
        return next;
      });
    } catch (e) {
      console.error("[persistRelation failed]", e);
      removeRelation(sourceId, targetId);
      alert("Failed to persist relation. Check console.");
    }
  }, [relationMode, nodes, activeCollection, addRelation, removeRelation, persistRelation, splitNodeId]);

  const onEdgeClick = useCallback(async (_e: any, edge: Edge) => {
    const [sourceId, targetId] = [edge.source, edge.target];
    if (!confirm("Delete this relation?")) return;

    const rel = relations.find((r) => r.sourceId === sourceId && r.targetId === targetId);
    const viaField = rel?.viaField;

    removeRelation(sourceId, targetId);

    try {
      await clearRelationField(sourceId, viaField);

      if (viaField) {
        // update nodes bron-document
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== sourceId) return n;
            const data: any = n.data ?? {};
            const doc = { ...(data.doc ?? {}) };
            doc[viaField] = null;
            return { ...n, data: { ...data, doc } };
          })
        );

        // update geopende modal (indien dit het bron-doc is)
        setDocDetail((prev) => {
          if (!prev) return prev;
          const myId = idToString((prev as any)._id);
          const { id: sId } = splitNodeId(sourceId);
          if (myId !== sId) return prev;
          const next: any = { ...prev };
          next[viaField] = null;
          setEditJson(safeStringify(next, 2));
          return next;
        });
      }
    } catch (e) {
      console.error("[clearRelationField failed]", e);
      alert("Failed to clear relation field in DB. You may need to refresh.");
    }
  }, [relations, removeRelation, clearRelationField, splitNodeId]);

  // ---------- Create / Edit / Export / Delete ----------
  async function handleCreateDocument() {
    if (!selected) { setCreateError("Select a connection first."); return; }
    if (!activeCollection) { setCreateError("Select a collection first."); return; }

    try {
      setCreating(true); setCreateError(null);
      let obj: any;
      try { obj = JSON.parse(createJson || "{}"); } catch (e: any) { throw new Error("Invalid JSON: " + e.message); }
      await createDoc(selected._id, activeCollection, db, obj);
      setCreateOpen(false);
      await refreshActiveAfterChange();
    } catch (e: any) {
      setCreateError(e.message || "Failed to create document");
    } finally {
      setCreating(false);
    }
  }

  function handleStartEdit() {
    setIsEditing(true);
    setEditError(null);
    setEditJson(safeStringify(docDetail, 2));
  }

  async function handleSaveEdit() {
    if (!docDetail) return;
    if (!selected) { alert("Select a connection first."); return; }
    if (!activeCollection) { alert("Select a collection first."); return; }

    try {
      setEditSaving(true);
      setEditError(null);

      const idStr = idToString((docDetail as any)._id);
      let obj: any;
      try { obj = JSON.parse(editJson || "{}"); }
      catch (e: any) { throw new Error("Invalid JSON: " + e.message); }

      pushHistory(activeCollection, idStr, docDetail);
      setDocHistory(loadHistory(activeCollection, idStr));

      const saved = await updateDoc(selected._id, activeCollection, db, idStr, obj);

      // update in nodes (zodat JSON/preview meteen updaten)
      setNodes((prev) =>
        prev.map((n) => {
          if (!n.id.endsWith(`:${idStr}`)) return n;
          const data: any = n.data ?? {};
          return { ...n, data: { ...data, doc: saved } };
        })
      );

      setDocDetail(saved);
      setIsEditing(false);
      setEditJson(safeStringify(saved, 2));
      setLayoutTick((t) => t + 1);
    } catch (e: any) {
      setEditError(e.message || "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  function handleClone() {
    if (!docDetail) return;
    const cloneBody = buildTemplateFromDoc(docDetail);
    setCreateJson(JSON.stringify(cloneBody, null, 2));
    setCreateOpen(true);
  }

  function handleExport() {
    if (!docDetail) return;
    const idStr = idToString((docDetail as any)._id);
    downloadJson(`${activeCollection}-${idStr}.json`, docDetail);
  }

  async function handleDeleteCurrent() {
    if (!docDetail) return;
    if (!selected) { alert("Select a connection first."); return; }
    if (!activeCollection) { alert("Select a collection first."); return; }
    if (!confirm("Delete this document? This cannot be undone.")) return;

    try {
      const idStr = idToString((docDetail as any)._id);
      await deleteDoc(selected._id, activeCollection, db, idStr);
      setDocDetail(null);
      await refreshActiveAfterChange();
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  // ======= UI: LIST rows built from current nodes (respecting hidden) =======
  const listRows = useMemo(() => {
    return (nodes as Node[]).filter(n => !n.hidden);
  }, [nodes]);

  // ======= RENDER =======
  return (
    <div className="container-fluid vh-100">
      <Row className="h-100">
        {/* Sidebar */}
        <Col
          md={3}
          lg={2}
          className="border-end d-flex flex-column"
          style={{ paddingTop: "8px" }}
        >
          <div
            className="px-2 mb-3 d-flex flex-column align-items-center gap-2"
            style={{ marginTop: "-8px" }}
          >
            <img
              src={logo}
              alt="MongoDB MyAdmin"
              style={{ height: 130, objectFit: "contain" }}
            />
          </div>

          <div className="flex-grow-1 overflow-auto pe-2" style={{ paddingBottom: "3rem" }}>
            {collections.map((c) => (
              <Button
                key={c.name}
                variant={activeCollection === c.name ? "primary" : "light"}
                className="w-100 d-flex justify-content-between align-items-center mb-2 text-start"
                onClick={() => setActiveCollection(c.name)}
              >
                <span className="text-truncate">{c.name}</span>
                <small className="opacity-75">{c.count}</small>
              </Button>
            ))}
          </div>

          <Button variant="outline-secondary" className="mt-2 mb-3 mx-2">
            <Plus size={16} className="me-1" /> New collection
          </Button>
        </Col>

        {/* Main panel */}
        <Col md={9} lg={10} className="position-relative">
          <div className="p-3">
            <Card className="shadow-sm">
              <Card.Header className="py-2">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <Card.Title as="h6" className="mb-0 d-flex align-items-center gap-2">
                    <ChevronRight size={18} /> {activeCollection}
                    {relationMode && <Badge bg="info" className="ms-2">Relation mode</Badge>}
                  </Card.Title>
                  <div className="d-flex align-items-center gap-2">
                    <Dropdown>
                      <Dropdown.Toggle size="sm" variant={selected ? "success" : "outline-secondary"}>
                        {selected ? selected.name : "No connection"}
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        {profiles.map((p) => (
                          <Dropdown.Item
                            key={p._id}
                            onClick={() => {
                              setSelected(p);
                              if (p.defaultDatabase) setDb(p.defaultDatabase);
                            }}
                          >
                            {p.name}
                          </Dropdown.Item>
                        ))}
                        <Dropdown.Divider />
                        <Dropdown.Item onClick={() => setWizardOpen(true)}>
                          + Add connection
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>

                    <Form.Control
                      size="sm"
                      style={{ width: 160 }}
                      placeholder="Database (optional)"
                      value={db || ""}
                      onChange={(e) => setDb(e.target.value || undefined)}
                    />

                    <div className="position-relative">
                      <Search size={16} className="position-absolute" style={{ left: 8, top: 8, opacity: 0.6 }} />
                      <Form.Control
                        style={{ paddingLeft: 28, width: 220 }}
                        size="sm"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search documents"
                      />
                    </div>

                    <Button
                      size="sm"
                      onClick={() => {
                        setCreateError(null);
                        setCreateJson("{\n  \n}");
                        setCreateOpen(true);
                      }}
                    >
                      <Plus size={14} className="me-1" /> New document
                    </Button>

                    <ToggleButton
                      id="relation-mode"
                      type="checkbox"
                      variant={relationMode ? "primary" : "outline-secondary"}
                      size="sm"
                      value="1"
                      checked={relationMode}
                      onChange={(e) => setRelationMode(e.currentTarget.checked)}
                      title="Draw an edge between two docs to create a relation"
                    >
                      {relationMode ? <Unlink size={14} className="me-1" /> : <LinkIcon size={14} className="me-1" />}
                      {relationMode ? "Stop relating" : "Create relation"}
                    </ToggleButton>

                    {/* View mode switch */}
                    <ButtonGroup size="sm">
                      <Button
                        variant={viewMode === "list" ? "primary" : "outline-secondary"}
                        onClick={() => setViewMode("list")}
                        title="List view"
                      >
                        <LayoutGrid size={14} className="me-1" /> List
                      </Button>
                      <Button
                        variant={viewMode === "canvas" ? "primary" : "outline-secondary"}
                        onClick={() => setViewMode("canvas")}
                        title="Canvas view"
                      >
                        <GalleryHorizontalEnd size={14} className="me-1" /> Canvas
                      </Button>
                    </ButtonGroup>

                    <Button variant="outline-secondary" size="sm">
                      <Settings size={14} className="me-1" /> Settings
                    </Button>
                  </div>
                </div>
              </Card.Header>

              {/* BODY */}
              <Card.Body className="p-0">
                {/* LIST VIEW */}
                {viewMode === "list" && (
                  <div className="p-2">
                    {/* Actionbar */}
                    <div className="d-flex align-items-center justify-content-between p-2 pb-3">
                      <div className="d-flex gap-2 align-items-center">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!selectedRowIds.size}
                          onClick={() => {
                            const items = (listRows as Node[])
                              .filter(n => selectedRowIds.has(n.id))
                              .map(nodeToItem)
                              .filter(Boolean) as {id: string; collection: string; doc: any}[];
                            addItemsToCanvas(items);
                          }}
                        >
                          Add selected to canvas ({selectedRowIds.size})
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => setViewMode("canvas")}
                        >
                          Open canvas
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => setSelectedRowIds(new Set())}
                          disabled={!selectedRowIds.size}
                        >
                          Clear selection
                        </Button>
                      </div>
                      <div className="small text-muted">
                        Canvas: <strong>{canvasPool.size}</strong> item(s)
                        {canvasPool.size ? (
                          <>
                            {" · "}
                            <Button size="sm" variant="link" onClick={clearCanvas}>clear</Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {/* Table */}
                    <div style={{ maxHeight: "72vh", overflow: "auto" }}>
                      <Table hover responsive size="sm" className="align-middle">
                        <thead className="table-light">
                          <tr>
                            <th style={{width:'1%'}}><Form.Check disabled /></th>
                            <th style={{width:'25%'}}>Document</th>
                            <th>Preview</th>
                            <th style={{width:'1%'}}>Rel</th>
                            <th style={{width:'1%'}}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(listRows as Node[]).map(n => {
                            const data: any = n.data ?? {};
                            const doc = data.doc ?? {};
                            const nodeId = n.id;
                            const title = doc.name ?? doc.title ?? doc.email ?? data._id ?? nodeId.split(":")[1];
                            const preview = JSON.stringify(
                              Object.fromEntries(Object.entries(doc).filter(([k]) => k !== '_id').slice(0, 3))
                            );
                            const checked = selectedRowIds.has(nodeId);
                            const sum = relSummary[nodeId];

                            return (
                              <tr key={nodeId}>
                                <td>
                                  <Form.Check
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = new Set(selectedRowIds);
                                      if (e.currentTarget.checked) next.add(nodeId); else next.delete(nodeId);
                                      setSelectedRowIds(next);
                                    }}
                                  />
                                </td>
                                <td className="text-truncate">
                                  <code className="me-1">{data.collection}</code>
                                  {title}
                                  <div className="small text-muted">{nodeId}</div>
                                </td>
                                <td className="text-truncate">
                                  <span className="text-muted">{preview}</span>
                                </td>
                                <td>
                                  <span className="badge bg-light text-dark">{sum?.total ?? 0}</span>
                                </td>
                                <td>
                                  <div className="btn-group btn-group-sm">
                                    <Button
                                      variant="outline-secondary"
                                      onClick={() => {
                                        const it = nodeToItem(n);
                                        if (it) addItemsToCanvas([it]);
                                      }}
                                    >
                                      Add to canvas
                                    </Button>
                                    <Button
                                      variant="outline-secondary"
                                      onClick={() => openDocFromNode(n)}
                                    >
                                      Open
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* CANVAS VIEW */}
                {viewMode === "canvas" && (
                <div
                    ref={canvasWrapRef}  // <<< CHANGED: koppelt de ResizeObserver aan dit element
                    style={{ height: "72vh" }}
                    className="border rounded-bottom overflow-hidden"
                  >
                    <ReactFlow
                      key={`${selected?._id ?? "mock"}:${activeCollection}:canvas`}
                      nodeTypes={nodeTypes}
                      autoPanOnNodeDrag={false}
                      panOnDrag
                      zoomOnScroll={!dragging}
                      panOnScroll={!dragging}
                      zoomOnPinch={!dragging}
                      nodes={nodes}
                      edges={edges}
                      onNodesChange={onNodesChange}
                      nodesDraggable
                      onNodeClick={onNodeClick}
                      onNodeDoubleClick={onNodeDoubleClick}
                      onConnect={onConnect}
                      onEdgeClick={onEdgeClick}
                      onNodeDragStart={onNodeDragStart}
                      onNodeDragStop={onNodeDragStop}
                      defaultViewport={{ x: 0, y: 0, zoom: 0.65 }}
                      minZoom={0.2}
                      maxZoom={1.5}
                      onInit={(inst) => {
                        setRf(inst);
                        requestAnimationFrame(() => requestAnimationFrame(() => fitToNodes()));
                        if (pendingFitRef.current) {
                          requestAnimationFrame(() => fitToNodes());
                        }
                      }}
                    >
                      <MiniMap pannable zoomable />
                      <Controls />
                      <Background gap={24} />
                    </ReactFlow>
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>

      {!selected && (
        <div
          style={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 9999,
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 8,
            background: "#e6ffed",
            border: "1px solid #b7eb8f",
          }}
        >
          Mock mode (no backend)
        </div>
      )}

      {/* Document modal */}
      <Modal show={!!docDetail} onHide={() => setDocDetail(null)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Document: {idToString(docDetail?._id)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="g-3">
            <Col xs={12} md={4}>
              <Card>
                <Card.Header className="py-2">
                  <strong>Actions</strong>
                </Card.Header>
                <Card.Body className="d-grid gap-2">
                  {!isEditing ? (
                    <Button size="sm" onClick={handleStartEdit}>Edit</Button>
                  ) : (
                    <Button size="sm" variant="success" disabled={editSaving} onClick={handleSaveEdit}>
                      {editSaving ? "Saving..." : "Save changes"}
                    </Button>
                  )}

                  <Button size="sm" variant="outline-secondary" onClick={handleClone}>
                    Clone
                  </Button>

                  <Button size="sm" variant="outline-secondary" onClick={handleExport}>
                    Export JSON
                  </Button>

                  <Button size="sm" variant="danger" onClick={handleDeleteCurrent}>
                    Delete
                  </Button>

                  {editError && <Alert className="mt-2 mb-0" variant="danger">{editError}</Alert>}
                </Card.Body>
              </Card>
            </Col>

            <Col xs={12} md={8}>
              <Tab.Container defaultActiveKey="json">
                <Nav variant="tabs">
                  <Nav.Item><Nav.Link eventKey="json">JSON</Nav.Link></Nav.Item>
                  <Nav.Item><Nav.Link eventKey="schema">Schema</Nav.Link></Nav.Item>
                  <Nav.Item><Nav.Link eventKey="history">History</Nav.Link></Nav.Item>
                  <Nav.Item><Nav.Link eventKey="relations">Relations</Nav.Link></Nav.Item>
                </Nav>

                <Tab.Content className="border border-top-0 rounded-bottom p-3" style={{ height: 360, overflow: "auto" }}>
                  {/* JSON */}
                  <Tab.Pane eventKey="json">
                    {!isEditing ? (
                      <pre className="small mb-0">{safeStringify(docDetail, 2)}</pre>
                    ) : (
                      <Form.Group>
                        <Form.Label className="small text-muted">Edit JSON</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={14}
                          value={editJson}
                          onChange={(e) => setEditJson(e.target.value)}
                          spellCheck={false}
                        />
                        <Form.Text className="text-muted">
                          Tip: laat <code>_id</code> intact of gebruik hetzelfde type als je backend verwacht.
                        </Form.Text>
                      </Form.Group>
                    )}
                  </Tab.Pane>

                  {/* Schema */}
                  <Tab.Pane eventKey="schema">
                    {docDetail ? (
                      <div className="small">
                        <table className="table table-sm align-middle">
                          <thead>
                            <tr>
                              <th style={{ width: "55%" }}>Field</th>
                              <th style={{ width: "20%" }}>Type</th>
                              <th>Sample</th>
                            </tr>
                          </thead>
                          <tbody>
                            {walkSchemaRows(docDetail).map((r) => (
                              <tr key={r.path}>
                                <td><code>{r.path}</code></td>
                                <td><span className="badge bg-light text-dark">{r.type}</span></td>
                                <td className="text-truncate">{r.sample}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-muted small">(No document)</div>
                    )}
                  </Tab.Pane>

                  {/* History */}
                  <Tab.Pane eventKey="history">
                    {docDetail ? (
                      docHistory.length ? (
                        <div className="small">
                          {docHistory.map((h, i) => (
                            <details key={i} className="mb-2">
                              <summary>
                                {new Date(h.ts).toLocaleString()}
                                <span className="text-muted ms-2">(previous version)</span>
                              </summary>
                              <pre className="mt-2">{safeStringify(h.doc, 2)}</pre>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted small">No history yet. Save an edit to create a version.</div>
                      )
                    ) : (
                      <div className="text-muted small">(No document)</div>
                    )}
                  </Tab.Pane>

                  {/* Relations */}
                  <Tab.Pane eventKey="relations" className="small">
                    {docDetail ? (
                      (() => {
                        const myId = `${activeCollection}:${idToString((docDetail as any)._id)}`;
                        const rels = relations.filter((r) => r.sourceId === myId || r.targetId === myId);
                        if (!rels.length) return <div className="text-muted">No relations.</div>;
                        return (
                          <ul className="list-unstyled mb-0">
                            {rels.map((r, idx) => {
                              return (
                                <li key={idx} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
                                  <div>
                                    {r.sourceId} → {r.targetId} {r.viaField && <em>({r.viaField})</em>}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline-danger"
                                    onClick={() => removeRelation(r.sourceId, r.targetId)}
                                  >
                                    Unlink
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()
                    ) : (
                      <div className="text-muted small">(No document)</div>
                    )}
                  </Tab.Pane>
                </Tab.Content>
              </Tab.Container>
            </Col>
          </Row>
        </Modal.Body>
        <Button variant="light" className="position-absolute top-0 end-0 m-2" onClick={() => setDocDetail(null)}>
          <X size={16} />
        </Button>
      </Modal>

      {/* Create document modal */}
      <Modal show={createOpen} onHide={() => setCreateOpen(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>New document in {activeCollection}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {createError && <Alert variant="danger" className="mb-2">{createError}</Alert>}

          <div className="d-flex align-items-center gap-2 mb-2">
            <span className="text-muted small">Template:</span>
            <ButtonGroup size="sm">
              <Button variant="outline-secondary" onClick={() => setCreateJson("{\n  \n}")}>
                Empty
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => setCreateJson(templateJsonFromDoc(lastTemplateDoc))}
                disabled={!lastTemplateDoc}
                title={lastTemplateDoc ? "Use last opened document structure" : "Open a document first"}
              >
                <History size={14} className="me-1" /> Last opened
              </Button>
              <Button
                variant="outline-secondary"
                onClick={async () => {
                  try {
                    if (!selected) {
                      const d = (MOCK_DOCS[activeCollection] ?? [])[0];
                      setCreateJson(templateJsonFromDoc(d));
                      return;
                    }
                    const docs = await getDocs(selected._id, activeCollection, db, 1);
                    setCreateJson(templateJsonFromDoc(docs[0]));
                  } catch {
                    setCreateJson("{\n  \n}");
                  }
                }}
              >
                <ListStart size={14} className="me-1" /> First in list
              </Button>
            </ButtonGroup>
            <span className="ms-2 text-muted small">
              <Wand2 size={14} className="me-1" />
              fills keys, clears values, omits <code>_id</code>
            </span>
          </div>

          <Form.Group>
            <Form.Label>JSON</Form.Label>
            <Form.Control
              as="textarea"
              rows={14}
              value={createJson}
              onChange={(e) => setCreateJson(e.target.value)}
              spellCheck={false}
            />
            <Form.Text className="text-muted">
              Tip: laat <code>_id</code> weg om automatisch een ObjectId te krijgen.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="light" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateDocument} disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Connection wizard */}
      <ConnectionWizard
        show={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onConnected={(p) => {
          setWizardOpen(false);
          setSelected(p);
          if (p.defaultDatabase) setDb(p.defaultDatabase);
        }}
      />
    </div>
  );
}