import React from "react";
import { Modal, Button, Card, Alert, Row, Col, Form, Nav, Tab } from "react-bootstrap";
import { X } from "lucide-react";
import type { MongoDocument, DocHistoryItem } from "../types";
import { idToString, safeStringify, shortVal } from "../lib/helpers";

type Props = {
  show: boolean;
  doc: MongoDocument | null;
  collection?: string | null;

  // edit state
  isEditing: boolean;
  editJson: string;
  editSaving: boolean;
  editError: string | null;
  history: DocHistoryItem[];

  // handlers
  onStartEdit: () => void;
  onChangeEditJson: (next: string) => void;
  onSaveEdit: () => void;
  onClone: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function DocumentModal({
  show,
  doc,
  collection,
  isEditing,
  editJson,
  editSaving,
  editError,
  history,
  onStartEdit,
  onChangeEditJson,
  onSaveEdit,
  onClone,
  onExport,
  onDelete,
  onClose,
}: Props) {
  const titleId = idToString((doc as any)?._id);

  return (
    <Modal show={show} onHide={onClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          Document: {titleId}
          {collection && <small className="text-muted ms-2">({collection})</small>}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Row className="g-3">
          <Col xs={12} md={4}>
            <Card>
              <Card.Header className="py-2"><strong>Actions</strong></Card.Header>
              <Card.Body className="d-grid gap-2">
                {!isEditing ? (
                  <Button size="sm" onClick={onStartEdit}>Edit</Button>
                ) : (
                  <Button size="sm" variant="success" disabled={editSaving} onClick={onSaveEdit}>
                    {editSaving ? "Saving..." : "Save changes"}
                  </Button>
                )}
                <Button size="sm" variant="outline-secondary" onClick={onClone}>Clone</Button>
                <Button size="sm" variant="outline-secondary" onClick={onExport}>Export JSON</Button>
                <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
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
                {/* JSON */}
                <Tab.Pane eventKey="json">
                  {!isEditing ? (
                    <pre className="small mb-0">{safeStringify(doc, 2)}</pre>
                  ) : (
                    <Form.Group>
                      <Form.Label className="small text-muted">Edit JSON</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={14}
                        value={editJson}
                        onChange={(e) => onChangeEditJson(e.target.value)}
                        spellCheck={false}
                      />
                      <Form.Text className="text-muted">
                        Hint: Leave <code>_id</code> intact or use the same type as your backend expects.
                      </Form.Text>
                    </Form.Group>
                  )}
                </Tab.Pane>

                {/* Schema */}
                <Tab.Pane eventKey="schema">
                  {doc ? (
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
                          {Object.entries(doc).flatMap(([k, v]) => {
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
                  ) : (
                    <div className="text-muted small">(No document)</div>
                  )}
                </Tab.Pane>

                {/* History */}
                <Tab.Pane eventKey="history">
                  {doc ? (
                    history.length ? (
                      <div className="small">
                        {history.map((h, i) => (
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
              </Tab.Content>
            </Tab.Container>
          </Col>
        </Row>
      </Modal.Body>

      <Button variant="light" className="position-absolute top-0 end-0 m-2" onClick={onClose}>
        <X size={16} />
      </Button>
    </Modal>
  );
}