import React, { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import type { ConnectionProfile } from "../types";
import { createConnection, testConnection } from "../lib/api";
import { Wifi } from "lucide-react";

export default function ConnectionWizard({
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
    setStep(1); setEngine("driver"); setName("My Mongo"); setUri(""); setDefaultDb("");
    setSaving(false); setTesting(false); setError(null); setCreated(null);
  };

  useEffect(() => { if (!show) reset(); }, [show]);

  async function handleSave() {
    try {
      setSaving(true); setError(null);
      const prof = await createConnection({ name, engine, uri, defaultDatabase: defaultDb || undefined });
      setCreated(prof);
      setStep(3);
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally { setSaving(false); }
  }

  async function handleTest() {
    if (!created) return;
    try {
      setTesting(true); setError(null);
      const res = await testConnection(created._id);
      if (res.ok) onConnected(created);
    } catch (e: any) {
      setError(e.message || "Connection failed. Check URI / Atlas IP allowlist / credentials.");
    } finally { setTesting(false); }
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
                  <Form.Label>{engine === "driver" ? "Mongo URI (mongodb:// of mongodb+srv://)" : "Atlas Data API Endpoint"}</Form.Label>
                  <Form.Control as="textarea" rows={3} value={uri} onChange={(e) => setUri(e.target.value)} />
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