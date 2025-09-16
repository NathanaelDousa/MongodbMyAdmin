import React from "react";
import { Modal, Button, ButtonGroup, Alert, Form } from "react-bootstrap";
import { History, ListStart, Wand2 } from "lucide-react";
import type { MongoDocument } from "../types";

type Props = {
  show: boolean;
  activeCollection: string;
  createJson: string;
  creating: boolean;
  createError: string | null;
  lastTemplateDoc: MongoDocument | null;

  onUseEmpty: () => void;
  onUseLastOpened: () => void;
  onUseFirstInList: () => Promise<void> | void;
  onChangeJson: (next: string) => void;
  onCreate: () => void;
  onClose: () => void;
};

export default function CreateDocumentModal({
  show,
  activeCollection,
  createJson,
  creating,
  createError,
  lastTemplateDoc,
  onUseEmpty,
  onUseLastOpened,
  onUseFirstInList,
  onChangeJson,
  onCreate,
  onClose,
}: Props) {
  return (
    <Modal show={show} onHide={onClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>New document in {activeCollection}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {createError && <Alert variant="danger" className="mb-2">{createError}</Alert>}

        <div className="d-flex align-items-center gap-2 mb-2">
          <span className="text-muted small">Template:</span>
          <ButtonGroup size="sm">
            <Button variant="outline-secondary" onClick={onUseEmpty}>Empty</Button>
            <Button
              variant="outline-secondary"
              onClick={onUseLastOpened}
              disabled={!lastTemplateDoc}
              title={lastTemplateDoc ? "Use last opened document structure" : "Open a document first"}
            >
              <History size={14} className="me-1" /> Last opened
            </Button>
            <Button variant="outline-secondary" onClick={() => onUseFirstInList()}>
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
            onChange={(e) => onChangeJson(e.target.value)}
            spellCheck={false}
          />
          <Form.Text className="text-muted">
            Hint: leave out your <code>_id</code> to automatically get an ObjectId.
          </Form.Text>
        </Form.Group>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="light" onClick={onClose}>Cancel</Button>
        <Button onClick={onCreate} disabled={creating}>
          {creating ? "Creating..." : "Create"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}