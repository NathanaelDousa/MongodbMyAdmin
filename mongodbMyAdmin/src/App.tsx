import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background, Controls, MiniMap, applyNodeChanges, type NodeChange
} from "reactflow";
import type { Connection, Edge, Node, ReactFlowInstance } from "reactflow";
import "reactflow/dist/style.css";
import "bootstrap/dist/css/bootstrap.min.css";

import logo from "/src/assets/MongoDBMyAdmin-logo-no-bg.png";
import {
  ChevronRight, Search, Settings as SettingsIcon, Plus, X, Wand2, History,
  ListStart, Link as LinkIcon, Unlink, LayoutGrid, GalleryHorizontalEnd
} from "lucide-react";
import {
  Alert, Badge, Button, ButtonGroup, Card, Col, Dropdown,
  Form, Modal, Nav, Row, Table, ToggleButton, Tab
} from "react-bootstrap";

import type {
  Collection, ConnectionProfile, MongoDocument, Relation, ViewMode, DocHistoryItem
} from "./types";

import {
  listConnections, getCollections, getDocs, createDoc, deleteDoc, updateDoc,
  createCollection as apiCreateCollection
} from "./lib/api";
import {
  buildTemplateFromDoc, downloadJson, idToString, loadHistory, normalizeForDisplay,
  pushHistory, safeStringify, shortVal, templateJsonFromDoc
} from "./lib/helpers";
import {
  estimateNodeHeight, masonryNodes, relaxColumns, separateOverlaps, separateUsingDOM, keepPositions
} from "./lib/layout";
import {
  buildEdgesFromRelations, guessViaField, loadAllRelations, saveAllRelations
} from "./lib/relations";
import { useFitToNodes } from "./hooks/useFitToNodes";

import DocNode from "./components/DocNode";
import SettingsModal from "./components/SettingsModal";
import ConnectionWizard from "./components/ConnectionWizard";

// ——— mock data (alleen als geen backend) ———
const MOCK_COLLECTIONS: Collection[] = [
  { name: "users", count: 42 }, { name: "orders", count: 128 },
  { name: "products", count: 23 }, { name: "reviews", count: 311 },
];
const MOCK_DOCS: Record<string, MongoDocument[]> = {
  users: Array.from({ length: 10 }).map((_, i) => ({
    _id: `u_${i + 1}`,
    name: ["Maria","Jens","Amina","Noah","Léa","Sven"][i % 6] + " " + (100 + i),
    email: `user${i + 1}@example.com`,
    role: ["admin","editor","viewer"][i % 3],
  })),
  orders: Array.from({ length: 8 }).map((_, i) => ({
    _id: `o_${i + 1}`, userId: `u_${(i % 10) + 1}`,
    total: (Math.round(Math.random() * 20000) / 100).toFixed(2),
    status: ["pending","paid","shipped"][i % 3],
  })),
  products: Array.from({ length: 6 }).map((_, i) => ({
    _id: `p_${i + 1}`, sku: `SKU-${i + 1}`,
    title: ["Lamp","Chair","Table","Cable","Mouse","Plant"][i],
    price: (Math.round(Math.random() * 30000) / 100).toFixed(2),
  })),
  reviews: Array.from({ length: 10 }).map((_, i) => ({
    _id: `r_${i + 1}`, productId: `p_${(i % 6) + 1}`, userId: `u_${(i % 10) + 1}`,
    rating: (i % 5) + 1, text: "Nice! ".repeat((i % 4) + 1).trim(),
  })),
};

export default function App() {
  // Refs
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Map<string, {x:number; y:number}>>(new Map());
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  // Fit hook
  const { fitToNodes, nodesRef, didInitialFitRef } = useFitToNodes();

  // App prefs
  const [appPrefs, setAppPrefs] = useState<{ theme: "light" | "dark"; defaultView: ViewMode; autoFit: boolean; gridGap: number }>({
    theme: (localStorage.getItem("mv_theme") as any) || "light",
    defaultView: (localStorage.getItem("mv_default_view") as any) || "list",
    autoFit: true,
    gridGap: 24,
  });

  // Connection / data state
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [db, setDb] = useState<string | undefined>(undefined);
  const [collections, setCollections] = useState<Collection[]>(MOCK_COLLECTIONS);
  const [activeCollection, setActiveCollection] = useState<string>(MOCK_COLLECTIONS[0]?.name ?? "");
  const [query, setQuery] = useState("");

  // UI state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Docs modal
  const [docDetail, setDocDetail] = useState<MongoDocument | null>(null);
  const [docCollection, setDocCollection] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editJson, setEditJson] = useState<string>("{}");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [docHistory, setDocHistory] = useState<DocHistoryItem[]>([]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createJson, setCreateJson] = useState<string>("{\n  \n}");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [lastTemplateDoc, setLastTemplateDoc] = useState<any | null>(null);

  // React Flow nodes/edges
  const [nodes, setNodes] = useState<Node[]>([]);
  const nodeTypes = useMemo(() => ({ doc: (props: any) => <DocNode {...props} /> }), []);
  const [relations, setRelations] = useState<Relation[]>([]);
  const edges: Edge[] = useMemo(() => buildEdgesFromRelations(nodes, relations), [nodes, relations]);

  // Other
  const [relationMode, setRelationMode] = useState<boolean>(false);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Create Collection modal state
    const [createColOpen, setCreateColOpen] = useState(false);
    const [colName, setColName] = useState("");
    const [colCapped, setColCapped] = useState(false);
    const [colSize, setColSize] = useState<number | "">("");
    const [colMax, setColMax] = useState<number | "">("");
    const [colCreating, setColCreating] = useState(false);
    const [colErr, setColErr] = useState<string | null>(null);

  // Persist & theme
  useEffect(() => {
    document.documentElement.setAttribute("data-bs-theme", appPrefs.theme);
    localStorage.setItem("mv_theme", appPrefs.theme);
    localStorage.setItem("mv_default_view", appPrefs.defaultView);
  }, [appPrefs]);

  // Init profiles
  useEffect(() => {
    listConnections().then((list) => {
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
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected?._id) localStorage.setItem("mv_profile_id", selected._id);
    else localStorage.removeItem("mv_profile_id");
  }, [selected?._id]);

  useEffect(() => {
    if (db) localStorage.setItem("mv_profile_db", db);
    else localStorage.removeItem("mv_profile_db");
  }, [db]);

  // Load collections
  useEffect(() => {
    if (!selected) {
      setCollections(MOCK_COLLECTIONS);
      setActiveCollection(MOCK_COLLECTIONS[0]?.name ?? "");
      return;
    }
    getCollections(selected._id, db)
      .then((cols) => {
        setCollections(cols);
        setActiveCollection(cols[0]?.name ?? "");
      })
      .catch((e) => console.error("[collections error]", e));
  }, [selected, db]);

  // Load docs for activeCollection
  useEffect(() => {
    setNodes([]);
    if (!activeCollection) return;

    const applyDocs = (docs: MongoDocument[]) => {
      const nodesNew = masonryNodes(docs, activeCollection, 4);
      const relaxed = relaxColumns(nodesNew, 36);
      const allRels = loadAllRelations();
      const hydrated = keepPositions(relaxed, posRef.current);
      setNodes(hydrated);
      setLastTemplateDoc(docs[0] ?? null);
      setRelations(allRels);

      didInitialFitRef.current = false;
      queueMicrotask(() => {
        if (!didInitialFitRef.current) {
          fitToNodes(rf);
          didInitialFitRef.current = true;
        }
      });

      nodesRef.current = hydrated;
    };

    if (!selected) {
      applyDocs(MOCK_DOCS[activeCollection] ?? []);
      return;
    }
    getDocs(selected._id, activeCollection, db, 100)
      .then(applyDocs)
      .catch((e) => console.error("[docs error]", e));
  }, [selected, db, activeCollection, rf, didInitialFitRef, fitToNodes, nodesRef]);

  // Search
  useEffect(() => {
    if (!query.trim()) {
      setNodes((prev) => prev.map((n) => ({ ...n, hidden: false })));
      nodesRef.current = nodesRef.current.map((n) => ({ ...n, hidden: false }));
      return;
    }
    const q = query.toLowerCase();
    setNodes((prev) => prev.map((n) => {
      const data: any = n.data ?? {};
      const doc = data.doc ?? data;
      const match = JSON.stringify(doc).toLowerCase().includes(q);
      return { ...n, hidden: !match };
    }));
  }, [query]);

  // List ↔ Canvas toggle: rebuild layout from current list (simple)
  useEffect(() => {
    setViewMode(appPrefs.defaultView);
  }, [appPrefs.defaultView]);

  // Node handlers
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      next.forEach(n => posRef.current.set(n.id, { x: n.position.x, y: n.position.y }));
      nodesRef.current = next;
      return next;
    });
  }, [setNodes]);

  async function handleCreateCollection() {
    if (!selected) { setColErr("Select a connection first."); return; }
    if (!db)       { setColErr("Database is required to create a collection."); return; }

    const name = (colName || "").trim();
    if (!name) { setColErr("Collection name is required."); return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        setColErr("Only letters, numbers, dot, underscore and hyphen are allowed.");
        return;
    }
    if (collections.some(c => c.name === name)) {
        setColErr("Collection already exists.");
        return;
    }
    if (colCapped) {
        if (!colSize || Number(colSize) <= 0) {
        setColErr("Capped collections require a positive 'size' (bytes).");
        return;
        }
    }

    try {
        setColCreating(true);
        setColErr(null);

        await apiCreateCollection(
        selected._id,
        db,
        name,
        colCapped ? { capped: true, size: Number(colSize), ...(colMax ? { max: Number(colMax) } : {}) } : undefined
        );

        // sidebar refresh + select nieuwe collection
        const cols = await getCollections(selected._id, db);
        setCollections(cols);
        setActiveCollection(name);

        // modal reset/close
        setCreateColOpen(false);
        setColName(""); setColCapped(false); setColSize(""); setColMax("");
    } catch (e: any) {
        setColErr(e.message || "Failed to create collection");
    } finally {
        setColCreating(false);
    }
    }

  const onNodeClick = useCallback((_e: any, node: Node) => {
    const maybe: any = node.data ?? {};
    const doc = maybe.doc ?? maybe;
    if (!doc || typeof doc !== "object") return;

    setDocDetail(doc as MongoDocument);
    setDocCollection((maybe.collection as string) || activeCollection);
    setLastTemplateDoc(doc);
    setIsEditing(false);
    setEditJson(safeStringify(doc, 2));
    const idStr = idToString((doc as any)._id);
    setDocHistory(loadHistory((maybe.collection as string) || activeCollection, idStr));
  }, [activeCollection]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!relationMode) return;

    const sourceId = connection.source!;
    const targetId = connection.target!;
    const sourceNode = nodes.find(n => n.id === sourceId);
    const targetNode = nodes.find(n => n.id === targetId);

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

    // optimistic edge
    setRelations((prev) => {
      if (prev.some((x) => x.sourceId === sourceId && x.targetId === targetId)) return prev;
      const next = [...prev, { sourceId, targetId, viaField: chosenField }];
      saveAllRelations(next);
      return next;
    });

    try {
      const [sCol2, sId] = sourceId.split(":");
      const [, tId] = targetId.split(":");
      await updateDoc(selected!._id, sCol2, db, sId, { [chosenField]: { $oid: tId } });

      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== sourceId) return n;
          const data: any = n.data ?? {};
          const doc = { ...(data.doc ?? {}) };
          doc[chosenField] = { $oid: tId };
          return { ...n, data: { ...data, doc } };
        })
      );
      setDocDetail((prev) => {
        if (!prev) return prev;
        const myId = idToString((prev as any)._id);
        if (myId !== sId) return prev;
        const next = { ...prev, [chosenField]: { $oid: tId } };
        setEditJson(safeStringify(next, 2));
        return next;
      });
    } catch (e) {
      // rollback
      setRelations((prev) => {
        const next = prev.filter((r) => !(r.sourceId === sourceId && r.targetId === targetId));
        saveAllRelations(next);
        return next;
      });
      alert("Failed to persist relation. Check console.");
    }
  }, [relationMode, nodes, activeCollection, selected, db]);

  const onEdgeClick = useCallback(async (_e: any, edge: Edge) => {
    const [sourceId, targetId] = [edge.source, edge.target];
    if (!confirm("Delete this relation?")) return;

    const rel = relations.find((r) => r.sourceId === sourceId && r.targetId === targetId);
    const viaField = rel?.viaField;

    setRelations((prev) => {
      const next = prev.filter((r) => !(r.sourceId === sourceId && r.targetId === targetId));
      saveAllRelations(next);
      return next;
    });

    try {
      if (viaField) {
        const [sCol, sId] = sourceId.split(":");
        await updateDoc(selected!._id, sCol, db, sId, { [viaField]: null });

        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== sourceId) return n;
            const data: any = n.data ?? {};
            const doc = { ...(data.doc ?? {}) };
            doc[viaField] = null;
            return { ...n, data: { ...data, doc } };
          })
        );

        setDocDetail((prev) => {
          if (!prev) return prev;
          const myId = idToString((prev as any)._id);
          const [, sId2] = sourceId.split(":");
          if (myId !== sId2) return prev;
          const next: any = { ...prev };
          next[viaField] = null;
          setEditJson(safeStringify(next, 2));
          return next;
        });
      }
    } catch {
      alert("Failed to clear relation field in DB. You may need to refresh.");
    }
  }, [relations, db, selected]);

  // Drag behaviour
  const onNodeDragStart = useCallback(() => setDragging(true), []);
  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    setDragging(false);
    posRef.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  // Fit guards (initial + on container resize)
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes, nodesRef]);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (viewMode === "canvas" && rf && nodes.length && !didInitialFitRef.current) {
        fitToNodes(rf);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rf, viewMode, nodes, didInitialFitRef, fitToNodes]);

  // Edit/save/clone/delete
  function handleStartEdit() {
    setIsEditing(true);
    setEditError(null);
    setEditJson(safeStringify(docDetail, 2));
  }
  async function handleSaveEdit() {
    if (!docDetail || !selected) return;
    if (!activeCollection) return;
    try {
      setEditSaving(true); setEditError(null);
      const idStr = idToString((docDetail as any)._id);
      const obj = JSON.parse(editJson || "{}");
      pushHistory(activeCollection, idStr, docDetail);
      setDocHistory(loadHistory(activeCollection, idStr));
      const saved = await updateDoc(selected._id, activeCollection, db, idStr, obj);
      setNodes((prev) => prev.map((n) => {
        if (!n.id.endsWith(`:${idStr}`)) return n;
        const data: any = n.data ?? {};
        return { ...n, data: { ...data, doc: saved } };
      }));
      setDocDetail(saved);
      setIsEditing(false);
      setEditJson(safeStringify(saved, 2));
    } catch (e: any) {
      setEditError(e.message || "Failed to save");
    } finally { setEditSaving(false); }
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
  downloadJson(`${docCollection ?? activeCollection}-${idStr}.json`, docDetail);
}

async function handleDeleteCurrent() {
  if (!docDetail || !selected) return;
  if (!activeCollection) return;
  if (!confirm("Delete this document? This cannot be undone.")) return;

  try {
    const idStr = idToString((docDetail as any)._id);
    await deleteDoc(selected._id, activeCollection, db, idStr);
    setDocDetail(null);

    // herlaad docs van de huidige collection
    const docs = selected
      ? await getDocs(selected._id, activeCollection, db, 100)
      : (MOCK_DOCS[activeCollection] ?? []);
    const nodesNew = masonryNodes(docs, activeCollection, 4);
    const relaxed = relaxColumns(nodesNew, appPrefs.gridGap);
    const fixed = separateOverlaps(keepPositions(relaxed, posRef.current), appPrefs.gridGap);
    setNodes(fixed);
  } catch (e: any) {
    alert(e.message || "Delete failed");
  }
}

// Nieuwe doc aanmaken
async function handleCreateDocument() {
  if (!selected) { setCreateError("Select a connection first."); return; }
  if (!activeCollection) { setCreateError("Select a collection first."); return; }

  try {
    setCreating(true); setCreateError(null);
    const obj = JSON.parse(createJson || "{}");
    await createDoc(selected._id, activeCollection, db, obj);
    setCreateOpen(false);

    // herlaad docs
    const docs = await getDocs(selected._id, activeCollection, db, 100);
    const nodesNew = masonryNodes(docs, activeCollection, 4);
    const relaxed = relaxColumns(nodesNew, appPrefs.gridGap);
    const fixed = separateOverlaps(keepPositions(relaxed, posRef.current), appPrefs.gridGap);
    setNodes(fixed);

    // fit na create (eenmalig)
    didInitialFitRef.current = false;
    queueMicrotask(() => {
      if (!didInitialFitRef.current && rf) {
        fitToNodes(rf);
        didInitialFitRef.current = true;
      }
    });
  } catch (e: any) {
    setCreateError(e.message || "Failed to create document");
  } finally {
    setCreating(false);
  }
}

// List-rows (zichtbare nodes)
const listRows = useMemo(() => nodes.filter(n => !n.hidden), [nodes]);

// ==== UI consts
const SIDEBAR_W = 156;

return (
    <div className="container-fluid vh-100 vw-100" style={{ marginTop: "25px"}}>
    <div className="row g-0 h-100" style={{ minHeight: 0, overflow: "hidden" }}>
      {/* Sidebar */}
    <aside
      className="col-auto d-flex flex-column border-end"
      style={{ width: SIDEBAR_W, paddingTop: 8, overflow: "hidden" }}
    >
        <div className="px-2 mb-3 d-flex flex-column align-items-center gap-2" style={{ marginTop: -8 }}>
          <img src={logo} alt="MongoDB MyAdmin"
               style={{ width: "100%", maxWidth: SIDEBAR_W - 24, height: "auto", objectFit: "contain" }} />
        </div>

        <div className="flex-grow-1 pe-2" style={{ paddingBottom: "3rem", minHeight: 0, overflow: "auto" }}>
          {collections.map((c) => (
            <Button
              key={c.name}
              variant={activeCollection === c.name ? "primary" : "outline-secondary"}
              className="w-100 d-flex justify-content-between align-items-center mb-2 text-start"
              onClick={() => setActiveCollection(c.name)}
            >
              <span className="text-truncate">{c.name}</span>
              <small className="opacity-75">{c.count}</small>
            </Button>
          ))}
        </div>
        <div className="p-2 border-top">
        <Button
            variant="outline-secondary"
            className="w-100"
            onClick={() => { setColErr(null); setCreateColOpen(true); }}
            disabled={!selected || !db}
            title={!selected ? "Select a connection first" : (!db ? "Enter/select a database" : "Create collection")}
        >
            <Plus size={16} className="me-1" /> New collection
        </Button>
        </div>
      </aside>

      {/* Main */}
    <main
      className="col d-flex flex-column"
      style={{ minWidth: 0, padding: 8, overflow: "hidden" }}
    >
        <Card className="shadow-sm d-flex flex-column" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <Card.Header className="py-2">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                {/* LINKERKANT: titel + connection + database */}
                <div className="d-flex align-items-center gap-2 flex-wrap">
                <Card.Title as="h6" className="mb-0 d-flex align-items-center gap-2">
                    <ChevronRight size={18} /> {activeCollection}
                </Card.Title>

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
                </div>

                {/* RECHTERKANT: search + acties */}
                <div className="d-flex align-items-center gap-2 flex-wrap">
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

                <Button variant="outline-secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                    <SettingsIcon size={14} className="me-1" /> Settings
                </Button>
                </div>
            </div>
            </Card.Header>

          <Card.Body className="p-0 d-flex flex-column" style={{ minHeight: 0, overflow: "hidden" }}>
            {/* LIST VIEW */}
            {viewMode === "list" && (
              <div className="d-flex flex-column" style={{ padding: 8, minHeight: 0, overflow: "hidden" }}>
                <div className="d-flex align-items-center justify-content-between pb-3">
                  <div className="small text-muted">Documents: <strong>{listRows.length}</strong></div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
                  <Table hover responsive={false} size="sm" className="align-middle" style={{ whiteSpace: "nowrap" }}>
                    <thead className={appPrefs.theme === "dark" ? "table-dark" : "table-light"}>
                      <tr>
                        <th style={{width:'25%'}}>Document</th>
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listRows.map(n => {
                        const data: any = n.data ?? {};
                        const doc = (data.doc ?? {}) as any;
                        const title = doc.name ?? doc.title ?? doc.email ?? data._id ?? n.id.split(":")[1];
                        const preview = JSON.stringify(
                          Object.fromEntries(Object.entries(doc).filter(([k]) => k !== '_id').slice(0, 3))
                        );
                        return (
                          <tr key={n.id} onClick={() => onNodeClick(null as any, n)} style={{ cursor: "pointer" }}>
                            <td className="text-truncate" style={{maxWidth: 420}}>
                              <code className="me-1">{data.collection}</code>{title}
                              <div className="small text-muted">{n.id}</div>
                            </td>
                            <td className="text-truncate" style={{maxWidth: 800}}>
                              <span className="text-muted">{preview}</span>
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
              <div ref={canvasWrapRef} style={{ flex: 1, minHeight: 0, color: "black" }} className="overflow-hidden">
                <ReactFlow
                  nodeTypes={nodeTypes}
                  autoPanOnNodeDrag={false}
                  panOnDrag
                  zoomOnScroll
                  panOnScroll
                  zoomOnPinch
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  nodesDraggable
                  onNodeClick={onNodeClick}
                  onConnect={onConnect}
                  onEdgeClick={onEdgeClick}
                  onNodeDragStart={() => setDragging(true)}
                  onNodeDragStop={(_e, node) => {
                    setDragging(false);
                    posRef.current.set(node.id, { x: node.position.x, y: node.position.y });
                  }}
                  defaultViewport={{ x: 0, y: 0, zoom: 0.65 }}
                  minZoom={0.2}
                  maxZoom={1.5}
                  onInit={(inst) => {
                    setRf(inst);
                    requestAnimationFrame(() => requestAnimationFrame(() => fitToNodes(inst)));
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
      </main>
    </div>

    {!selected && (
      <div
        style={{
          position: "fixed", top: 8, right: 8, zIndex: 9999, fontSize: 12,
          padding: "6px 8px", borderRadius: 8, background: "#e6ffed",
          border: "1px solid #b7eb8f", color: "black"
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
              <Card.Header className="py-2"><strong>Actions</strong></Card.Header>
              <Card.Body className="d-grid gap-2">
                {!isEditing ? (
                  <Button size="sm" onClick={handleStartEdit}>Edit</Button>
                ) : (
                  <Button size="sm" variant="success" disabled={editSaving} onClick={handleSaveEdit}>
                    {editSaving ? "Saving..." : "Save changes"}
                  </Button>
                )}
                <Button size="sm" variant="outline-secondary" onClick={handleClone}>Clone</Button>
                <Button size="sm" variant="outline-secondary" onClick={handleExport}>Export JSON</Button>
                <Button size="sm" variant="danger" onClick={handleDeleteCurrent}>Delete</Button>
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
              </Nav>

              <Tab.Content className="border border-top-0 rounded-bottom p-3" style={{ height: 360, overflow: "auto" }}>
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
                        Hint: Leave <code>_id</code> intact or use the same type as your backend expects.
                      </Form.Text>
                    </Form.Group>
                  )}
                </Tab.Pane>

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
                          {Object.entries(docDetail).flatMap(([k, v]) => {
                            const isObj = v && typeof v === "object" && !Array.isArray(v);
                            if (isObj) {
                              return [
                                [k, "object", "{…}"],
                                ...Object.entries(v as any).map(([k2, v2]) => [`${k}.${k2}`, typeof v2, String(shortVal(v2))])
                              ];
                            }
                            const isArr = Array.isArray(v);
                            return [[k, isArr ? "array" : typeof v, isArr ? `[${(v as any[])[0] ? typeof (v as any[])[0] : ""}]` : String(shortVal(v))]];
                          }).map(([path, type, sample]) => (
                            <tr key={String(path)}>
                              <td><code>{String(path)}</code></td>
                              <td><span className="badge bg-light text-dark">{String(type)}</span></td>
                              <td className="text-truncate">{String(sample)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (<div className="text-muted small">(No document)</div>)}
                </Tab.Pane>

                <Tab.Pane eventKey="history">
                  {docDetail ? (
                    docHistory.length ? (
                      <div className="small">
                        {docHistory.map((h, i) => (
                          <details key={i} className="mb-2">
                            <summary>{new Date(h.ts).toLocaleString()}
                              <span className="text-muted ms-2">(previous version)</span>
                            </summary>
                            <pre className="mt-2">{safeStringify(h.doc, 2)}</pre>
                          </details>
                        ))}
                      </div>
                    ) : <div className="text-muted small">No history yet. Save an edit to create a version.</div>
                  ) : (<div className="text-muted small">(No document)</div>)}
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
      <Modal.Header closeButton><Modal.Title>New document in {activeCollection}</Modal.Title></Modal.Header>
      <Modal.Body>
        {createError && <Alert variant="danger" className="mb-2">{createError}</Alert>}

        <div className="d-flex align-items-center gap-2 mb-2">
          <span className="text-muted small">Template:</span>
          <ButtonGroup size="sm">
            <Button variant="outline-secondary" onClick={() => setCreateJson("{\n  \n}")}>Empty</Button>
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
                  const docs = selected
                    ? await getDocs(selected._id, activeCollection, db, 1)
                    : (MOCK_DOCS[activeCollection] ?? []).slice(0,1);
                  setCreateJson(templateJsonFromDoc((Array.isArray(docs) ? docs[0] : docs)));
                } catch {
                  setCreateJson("{\n  \n}");
                }
              }}
            >
              <ListStart size={14} className="me-1" /> First in list
            </Button>
          </ButtonGroup>
          <span className="ms-2 text-muted small">
            <Wand2 size={14} className="me-1" /> fills keys, clears values, omits <code>_id</code>
          </span>
        </div>

        <Form.Group>
          <Form.Label>JSON</Form.Label>
          <Form.Control
            as="textarea" rows={14}
            value={createJson}
            onChange={(e) => setCreateJson(e.target.value)}
            spellCheck={false}
          />
          <Form.Text className="text-muted">
            Hint: leave out your <code>_id</code> to automatically get an ObjectId.
          </Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="light" onClick={() => setCreateOpen(false)}>Cancel</Button>
        <Button onClick={handleCreateDocument} disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
      </Modal.Footer>
    </Modal>

    {/* Settings */}
    <SettingsModal
    show={settingsOpen}
    onClose={() => setSettingsOpen(false)}
    profiles={profiles}
    onProfileUpdated={(p) => {
        setProfiles(prev => prev.map(x => x._id === p._id ? p : x));
        if (selected?._id === p._id) setSelected(p);
    }}
    onProfileDeleted={(id) => {
        setProfiles(prev => prev.filter(x => x._id !== id));
        if (selected?._id === id) { setSelected(null); setDb(undefined); }
    }}
    selected={selected}
    db={db}
    collections={collections}
    onCollectionsChanged={async () => {
        if (!selected) return;
        const cols = await getCollections(selected._id, db);
        setCollections(cols);
    }}
    prefs={appPrefs}
    onPrefsChange={setAppPrefs}
    />

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