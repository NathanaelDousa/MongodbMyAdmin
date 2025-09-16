// src/components/SettingsModal.tsx
import React, { useEffect, useState } from "react";
import { Modal, Button, Alert, Table, Form, Row, Col, Nav, Tab, ToggleButton } from "react-bootstrap";
import type { Collection, ConnectionProfile, ViewMode } from "../types";
import { createCollection, renameCollection, dropCollection, updateConnectionProfile, deleteConnectionProfile } from "../lib/api";

export default function SettingsModal({
  show,
  onClose,
  profiles,
  onProfileUpdated,
  onProfileDeleted,
  selected,
  db,
  collections,
  onCollectionsChanged,
  prefs,
  onPrefsChange,
}: {
  show: boolean;
  onClose: () => void;
  profiles: ConnectionProfile[];
  onProfileUpdated: (p: ConnectionProfile) => void;
  onProfileDeleted: (id: string) => void;
  selected: ConnectionProfile | null;
  db?: string;
  collections: Collection[];
  onCollectionsChanged: () => void;
  prefs: { theme: "light" | "dark"; defaultView: ViewMode; autoFit: boolean; gridGap: number };
  onPrefsChange: (next: typeof prefs) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const [renFrom, setRenFrom] = useState("");
  const [renTo, setRenTo] = useState("");
  const [dropping, setDropping] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editDefaultDb, setEditDefaultDb] = useState("");

  useEffect(() => {
    if (!editing) return;
    setEditName(editing.name);
    setEditDefaultDb(editing.defaultDatabase || "");
  }, [editing]);

  const canDbActions = !!(selected && db);

  async function handleCreateCollection() {
    if (!selected || !db || !newName.trim()) return;
    try {
      setCreating(true); setErr(null);
      await createCollection(selected._id, db, newName.trim());
      setNewName("");
      onCollectionsChanged();
    } catch (e: any) {
      setErr(e.message || "Failed to create collection");
    } finally { setCreating(false); }
  }

  async function handleRenameCollection() {
    if (!selected || !db || !renFrom || !renTo || renFrom === renTo) return;
    try {
      setErr(null);
      await renameCollection(selected._id, db, renFrom, renTo);
      setRenFrom(""); setRenTo("");
      onCollectionsChanged();
    } catch (e: any) {
      setErr(e.message || "Failed to rename collection");
    }
  }

  async function handleDropCollection(name: string) {
    if (!selected || !db) return;
    if (!confirm(`Drop collection "${name}"? This cannot be undone.`)) return;
    try {
      setDropping(name); setErr(null);
      await dropCollection(selected._id, db, name);
      onCollectionsChanged();
    } catch (e: any) {
      setErr(e.message || "Failed to drop collection");
    } finally { setDropping(null); }
  }

  async function handleSaveProfile() {
    if (!editing) return;
    try {
      const updated = await updateConnectionProfile(editing._id, {
        name: editName,
        defaultDatabase: editDefaultDb || undefined,
      });
      onProfileUpdated(updated);
      setEditing(null);
    } catch (e: any) {
      setErr(e.message || "Failed to update profile");
    }
  }

  async function handleDeleteProfile(id: string) {
    if (!confirm("Delete this connection profile?")) return;
    try {
      await deleteConnectionProfile(id);
      onProfileDeleted(id);
    } catch (e: any) {
      setErr(e.message || "Failed to delete profile");
    }
  }

  return (
    <Modal show={show} onHide={onClose} size="lg" centered>
      <Modal.Header closeButton><Modal.Title>Settings</Modal.Title></Modal.Header>
      <Modal.Body>
        {err && <Alert variant="danger" className="mb-3">{err}</Alert>}

        {/* Belangrijk: mountOnEnter/unmountOnExit zodat niet alle panes tegelijk zichtbaar zijn */}
        <Tab.Container defaultActiveKey="profiles" mountOnEnter unmountOnExit>
          <Nav variant="tabs">
            <Nav.Item><Nav.Link eventKey="profiles">Profiles</Nav.Link></Nav.Item>
            <Nav.Item><Nav.Link eventKey="app">App</Nav.Link></Nav.Item>
            <Nav.Item><Nav.Link eventKey="database" disabled={!canDbActions}>Database</Nav.Link></Nav.Item>
          </Nav>

          <Tab.Content className="border border-top-0 rounded-bottom p-3" style={{ maxHeight: 480, overflow: "auto" }}>
            {/* PROFILES */}
            <Tab.Pane eventKey="profiles">
              {!profiles.length ? (
                <div className="text-muted">No profiles yet.</div>
              ) : (
                <Table hover size="sm" className="align-middle">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Engine</th>
                      <th>Default DB</th>
                      <th style={{width: 220}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map(p => (
                      <tr key={p._id}>
                        <td>{p.name}{selected?._id === p._id && <span className="ms-2 badge bg-success">active</span>}</td>
                        <td><span className="badge bg-light text-dark">{p.engine}</span></td>
                        <td><code>{p.defaultDatabase || "-"}</code></td>
                        <td>
                          <div className="btn-group btn-group-sm">
                            <Button variant="outline-secondary" onClick={() => setEditing(p)}>Edit</Button>
                            <Button variant="outline-danger" onClick={() => handleDeleteProfile(p._id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}

              {editing && (
                <div className="mt-3">
                  <h6>Edit profile</h6>
                  <Row className="g-2">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Name</Form.Label>
                        <Form.Control value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Default database</Form.Label>
                        <Form.Control value={editDefaultDb} onChange={(e) => setEditDefaultDb(e.target.value)} />
                      </Form.Group>
                    </Col>
                  </Row>
                  <div className="d-flex gap-2 mt-2">
                    <Button onClick={handleSaveProfile}>Save</Button>
                    <Button variant="light" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </Tab.Pane>

            {/* APP */}
            <Tab.Pane eventKey="app">
              <div className="d-grid gap-3">
                <Form.Group>
                  <Form.Label>Theme</Form.Label>
                  <div className="d-flex gap-2">
                    <ToggleButton
                      id="theme-light" type="radio" size="sm"
                      variant={prefs.theme === "light" ? "primary" : "outline-secondary"}
                      checked={prefs.theme === "light"} value="light"
                      onChange={() => onPrefsChange({ ...prefs, theme: "light" })}
                    >Light</ToggleButton>
                    <ToggleButton
                      id="theme-dark" type="radio" size="sm"
                      variant={prefs.theme === "dark" ? "primary" : "outline-secondary"}
                      checked={prefs.theme === "dark"} value="dark"
                      onChange={() => onPrefsChange({ ...prefs, theme: "dark" })}
                    >Dark</ToggleButton>
                  </div>
                </Form.Group>

                <Form.Group>
                  <Form.Label>Default view</Form.Label>
                  <div className="d-flex gap-2">
                    <ToggleButton
                      id="view-list" type="radio" size="sm"
                      variant={prefs.defaultView === "list" ? "primary" : "outline-secondary"}
                      checked={prefs.defaultView === "list"} value="list"
                      onChange={() => onPrefsChange({ ...prefs, defaultView: "list" })}
                    >List</ToggleButton>
                    <ToggleButton
                      id="view-canvas" type="radio" size="sm"
                      variant={prefs.defaultView === "canvas" ? "primary" : "outline-secondary"}
                      checked={prefs.defaultView === "canvas"} value="canvas"
                      onChange={() => onPrefsChange({ ...prefs, defaultView: "canvas" })}
                    >Canvas</ToggleButton>
                  </div>
                </Form.Group>

                <Form.Group>
                  <Form.Label>Canvas grid gap</Form.Label>
                  <Form.Range min={8} max={48} step={1} value={prefs.gridGap}
                    onChange={(e) => onPrefsChange({ ...prefs, gridGap: Number(e.currentTarget.value) })} />
                  <div className="small text-muted">Current: <strong>{prefs.gridGap}px</strong></div>
                </Form.Group>

                <div>
                  <Button
                    variant="outline-danger"
                    onClick={() => {
                      if (!confirm("Clear local cache (layout, history, relations, canvas pool)?")) return;
                      localStorage.removeItem("mv_profile_id");
                      localStorage.removeItem("mv_profile_db");
                      localStorage.removeItem("mv_canvas_pool:v1");
                      localStorage.removeItem("mv_relations:v1");
                      Object.keys(localStorage).filter(k => k.startsWith("mv_hist:")).forEach(k => localStorage.removeItem(k));
                      alert("Cleared local cache.");
                    }}
                  >
                    Clear local cache
                  </Button>
                </div>
              </div>
            </Tab.Pane>

            {/* DATABASE */}
            <Tab.Pane eventKey="database">
              {!canDbActions ? (
                <div className="text-muted">Select a connection & database first.</div>
              ) : (
                <>
                  <h6>Create collection</h6>
                  <div className="d-flex gap-2 align-items-center mb-3">
                    <Form.Control placeholder="collection name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <Button onClick={handleCreateCollection} disabled={creating || !newName.trim()}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>

                  <h6>Rename collection</h6>
                  <div className="d-flex gap-2 align-items-center mb-3">
                    <Form.Select value={renFrom} onChange={(e) => setRenFrom(e.target.value)} style={{maxWidth: 280}}>
                      <option value="">Choose collection…</option>
                      {collections.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </Form.Select>
                    <span className="mx-1">→</span>
                    <Form.Control placeholder="new name" value={renTo} onChange={(e) => setRenTo(e.target.value)} />
                    <Button variant="outline-secondary" onClick={handleRenameCollection} disabled={!renFrom || !renTo || renFrom === renTo}>
                      Rename
                    </Button>
                  </div>

                  <h6 className="mb-2">Collections</h6>
                  <Table hover size="sm" className="align-middle">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th style={{width: 120}}>Docs</th>
                        <th style={{width: 140}}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collections.map(c => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td>{c.count}</td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <Button variant="outline-secondary" onClick={() => { setRenFrom(c.name); }}>Rename</Button>
                              <Button
                                variant="outline-danger"
                                disabled={dropping === c.name}
                                onClick={() => handleDropCollection(c.name)}
                              >
                                {dropping === c.name ? "Dropping…" : "Drop"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </Tab.Pane>
          </Tab.Content>
        </Tab.Container>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}