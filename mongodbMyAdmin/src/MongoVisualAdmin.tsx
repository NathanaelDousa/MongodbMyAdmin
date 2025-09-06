import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  MarkerType,
  Position,
  useNodesState,
  useEdgesState,
  Handle,
} from "reactflow";
import type { Connection, Edge, Node } from "reactflow";
import "reactflow/dist/style.css";

import {
  ChevronRight,
  Database,
  Link2,
  Search,
  Settings,
  Plus,
  X,
  Wifi,
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
      if (d && typeof d === "object" && "$numberLong" in d) return new Date(Number(d.$numberLong)).toISOString();
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

// Safe stringify for modal JSON (avoids crash on circular/bigint)
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

// ============================================================
// Custom Node for documents (no [Object Object])
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
  const fields = Object.entries(displayDoc).filter(([k]) => k !== "_id").slice(0, 3);
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 8px 18px -10px rgba(0,0,0,.25)",
        minWidth: 220,
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {data.collection}: {pickTitle(doc)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {fields.map(([k, v]) => (
          <span
            key={k}
            style={{
              fontSize: 12,
              background: "#f3f4f6",
              borderRadius: 8,
              padding: "2px 8px",
            }}
          >
            {k}: {shortVal(v)}
          </span>
        ))}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================
function gridNodes(docs: MongoDocument[], collection: string): Node[] {
  const gapX = 260;
  const gapY = 140;
  return docs.map((doc, i) => ({
    id: idToString((doc as any)._id) || String(i),
    type: "doc", // 👈 custom node type
    data: { collection, doc },
    position: { x: (i % 4) * gapX, y: Math.floor(i / 4) * gapY },
    draggable: true,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
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
      setError(
        e.message ||
          "Connection failed. Check URI / Atlas IP allowlist / credentials."
      );
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
              <Button
                variant={engine === "driver" ? "primary" : "outline-secondary"}
                onClick={() => setEngine("driver")}
              >
                MongoDB Driver (Local or Atlas)
              </Button>
              <Button
                variant={engine === "data_api" ? "primary" : "outline-secondary"}
                onClick={() => setEngine("data_api")}
              >
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
                  <Form.Control
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. My Atlas Prod"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Default Database</Form.Label>
                  <Form.Control
                    value={defaultDb}
                    onChange={(e) => setDefaultDb(e.target.value)}
                    placeholder="e.g. appdb"
                  />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group>
                  <Form.Label>
                    {engine === "driver"
                      ? "Mongo URI (mongodb:// or mongodb+srv://)"
                      : "Atlas Data API Endpoint"}
                  </Form.Label>
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
                  <Form.Text className="text-muted">
                    Credentials are stored encrypted on the server.
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        )}
        {step === 3 && (
          <div>
            <h6 className="mb-3">Test Connection</h6>
            <p className="text-muted">
              We saved your profile. Now test the connection to make sure it
              works.
            </p>
            <Button onClick={handleTest} disabled={testing}>
              {testing ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Testing...
                </>
              ) : (
                "Run Test"
              )}
            </Button>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <div className="me-auto small text-muted">
          Engine: <code>{engine}</code>
        </div>
        {step > 1 && (
          <Button
            variant="light"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}
          >
            Back
          </Button>
        )}
        {step < 3 && (
          <Button
            onClick={() => (step === 1 ? setStep(2) : handleSave())}
            disabled={(step === 2 && !uri) || saving}
          >
            {step === 1 ? "Continue" : saving ? <>Saving...</> : "Save Profile"}
          </Button>
        )}
        <Button variant="outline-secondary" onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ============================================================
// Main App with Connection Switcher + Canvas
// ============================================================
export default function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [db, setDb] = useState<string | undefined>(undefined);
  const [wizardOpen, setWizardOpen] = useState(false);

  // data
  const [collections, setCollections] = useState<Collection[]>(MOCK_COLLECTIONS);
  const [activeCollection, setActiveCollection] = useState<string>(
    MOCK_COLLECTIONS[0]?.name ?? ""
  );
  const [query, setQuery] = useState("");
  const [docDetail, setDocDetail] = useState<MongoDocument | null>(null);

  // nodes/edges
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);

  // custom node types
  const nodeTypes = useMemo(() => ({ doc: DocNode }), []);

  // ---------- Init: load profiles + restore selected/db from localStorage ----------
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

  // ---------- Load docs when activeCollection changes (reset canvas first) ----------
  useEffect(() => {
    setNodes([]); // reset
    setEdges([]); // reset
    if (!activeCollection) return;

    if (!selected) {
      const docs = MOCK_DOCS[activeCollection] ?? [];
      setNodes(gridNodes(docs, activeCollection));
      return;
    }
    getDocs(selected._id, activeCollection, db, 100)
      .then((docs) => setNodes(gridNodes(docs, activeCollection)))
      .catch((e) => console.error("[docs error]", e));
  }, [selected, db, activeCollection, setNodes, setEdges]);

  // Switch collection → alleen state veranderen; loading gebeurt in effect
  const handleSelectCollection = useCallback((name: string) => {
    setActiveCollection(name);
  }, []);

  // Open modal robust (werkt voor DB & mock docs)
  const openDocFromNode = useCallback((node: Node) => {
    try {
      const maybe = (node as any)?.data;
      const doc = maybe?.doc ?? maybe; // gridNodes zet { collection, doc }
      if (!doc || typeof doc !== "object") return;
      setDocDetail(doc as MongoDocument);
    } catch (err) {
      console.error("[openDocFromNode]", err, node);
    }
  }, []);

  // Fallback: single click & double click
  const onNodeClick = useCallback((_e: any, node: Node) => {
    openDocFromNode(node);
  }, [openDocFromNode]);
  const onNodeDoubleClick = useCallback((_e: any, node: Node) => {
    openDocFromNode(node);
  }, [openDocFromNode]);

  // connect edges (visual-only)
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) =>
      addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, eds)
    );
  }, []);

  // search filter (client-side)
  const filteredNodes = useMemo(() => {
    if (!query.trim()) return nodes;
    const q = query.toLowerCase();
    return nodes.map((n) => ({
      ...n,
      hidden: !JSON.stringify((n.data as any).doc ?? (n.data as any))
        .toLowerCase()
        .includes(q),
    }));
  }, [nodes, query]);

  return (
    <div className="container-fluid vh-100">
      <Row className="h-100">
        {/* Sidebar */}
        <Col md={3} lg={2} className="border-end py-3 d-flex flex-column">
          <div className="d-flex align-items-center gap-2 px-2 mb-2">
            <Database size={18} />
            <strong>Collections</strong>
          </div>

          <div className="flex-grow-1 overflow-auto pe-2">
            {collections.map((c) => (
              <Button
                key={c.name}
                variant={activeCollection === c.name ? "primary" : "light"}
                className="w-100 d-flex justify-content-between align-items-center mb-2 text-start"
                onClick={() => handleSelectCollection(c.name)}
              >
                <span className="text-truncate">{c.name}</span>
                <small className="opacity-75">{c.count}</small>
              </Button>
            ))}
          </div>

          <Button variant="outline-secondary" className="mt-2">
            <Plus size={16} className="me-1" /> New collection
          </Button>
        </Col>

        {/* Main panel */}
        <Col md={9} lg={10} className="position-relative">
          <div className="p-3">
            <Card className="shadow-sm">
              <Card.Header className="py-2">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <Card.Title
                    as="h6"
                    className="mb-0 d-flex align-items-center gap-2"
                  >
                    <ChevronRight size={18} /> {activeCollection}
                  </Card.Title>
                  <div className="d-flex align-items-center gap-2">
                    {/* Connection switcher */}
                    <Dropdown>
                      <Dropdown.Toggle
                        size="sm"
                        variant={selected ? "success" : "outline-secondary"}
                      >
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

                    {/* DB input (optional) */}
                    <Form.Control
                      size="sm"
                      style={{ width: 160 }}
                      placeholder="Database (optional)"
                      value={db || ""}
                      onChange={(e) => setDb(e.target.value || undefined)}
                    />

                    <div className="position-relative">
                      <Search
                        size={16}
                        className="position-absolute"
                        style={{ left: 8, top: 8, opacity: 0.6 }}
                      />
                      <Form.Control
                        style={{ paddingLeft: 28, width: 220 }}
                        size="sm"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search documents"
                      />
                    </div>
                    <Button variant="outline-secondary" size="sm">
                      <Link2 size={14} className="me-1" /> Create relation
                    </Button>
                    <Button size="sm">
                      <Plus size={14} className="me-1" /> New document
                    </Button>
                    <Button variant="outline-secondary" size="sm">
                      <Settings size={14} className="me-1" /> Settings
                    </Button>
                  </div>
                </div>
              </Card.Header>
              <Card.Body className="p-0">
                <div
                  style={{ height: "72vh" }}
                  className="border rounded-bottom overflow-hidden"
                >
                  <ReactFlow
                    key={`${selected?._id ?? "mock"}:${activeCollection}`} // force remount on switch
                    nodeTypes={nodeTypes}
                    nodes={filteredNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onNodeDoubleClick={onNodeDoubleClick}
                    fitView
                  >
                    <MiniMap pannable zoomable />
                    <Controls />
                    <Background gap={24} />
                  </ReactFlow>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>

      {/* Mock badge when disconnected */}
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
                  <Button size="sm">Edit</Button>
                  <Button size="sm" variant="outline-secondary">
                    Clone
                  </Button>
                  <Button size="sm" variant="outline-secondary">
                    Export JSON
                  </Button>
                  <Button size="sm" variant="danger">
                    Delete
                  </Button>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} md={8}>
              <Tab.Container defaultActiveKey="json">
                <Nav variant="tabs">
                  <Nav.Item>
                    <Nav.Link eventKey="json">JSON</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="schema">Schema</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="history">History</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="relations">Relations</Nav.Link>
                  </Nav.Item>
                </Nav>
                <Tab.Content
                  className="border border-top-0 rounded-bottom p-3"
                  style={{ height: 360, overflow: "auto" }}
                >
                  <Tab.Pane eventKey="json">
                    <pre className="small mb-0">
                      {safeStringify(docDetail, 2)}
                    </pre>
                  </Tab.Pane>
                  <Tab.Pane eventKey="schema" className="text-muted small">
                    (Future) Inferred schema, field types, indexes.
                  </Tab.Pane>
                  <Tab.Pane eventKey="history" className="text-muted small">
                    (Future) Document revision history (Change Streams of audit
                    log).
                  </Tab.Pane>
                  <Tab.Pane eventKey="relations" className="text-muted small">
                    (Future) Related documents based on edges drawn on the
                    canvas.
                  </Tab.Pane>
                </Tab.Content>
              </Tab.Container>
            </Col>
          </Row>
        </Modal.Body>
        <Button
          variant="light"
          className="position-absolute top-0 end-0 m-2"
          onClick={() => setDocDetail(null)}
        >
          <X size={16} />
        </Button>
      </Modal>

      {/* Connection wizard */}
      <ConnectionWizard
        show={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onConnected={(p) => {
          setWizardOpen(false);
          setSelected(p);
          if (p.defaultDatabase) setDb(p.defaultDatabase); // auto DB invullen
        }}
      />
    </div>
  );
}
