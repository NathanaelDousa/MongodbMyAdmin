// src/components/AiBar.tsx
import { useState } from "react";
import { Button, ButtonGroup, Collapse, Form, InputGroup, Spinner } from "react-bootstrap";
import { aiGenerate, aiRun } from "../lib/api";

export default function AiBar({
  profileId, db, activeCollection,
  onResults
}: {
  profileId?: string | null;
  db?: string | null;
  activeCollection: string;
  onResults: (docs: any[]) => void;
}) {
  const [natural, setNatural] = useState("");
  const [mode, setMode] = useState<"find" | "aggregate">("find");
  const [limit, setLimit] = useState<number>(100);

  const [gen, setGen] = useState<{query?: any; pipeline?: any} | null>(null);
  const [openPreview, setOpenPreview] = useState(false);

  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);      // success/info
  const [error, setError] = useState<string | null>(null);  // errors

  const canUse = !!profileId && !!db;

  function normalizeGen(out: any): { query?: any; pipeline?: any } {
  const res: any = {};
  if (out?.pipeline && Array.isArray(out.pipeline)) res.pipeline = out.pipeline;

  if (out?.query != null) {
    if (Array.isArray(out.query)) {
      // pick the first object if the model wrapped it in an array
      res.query = (out.query[0] && typeof out.query[0] === "object") ? out.query[0] : {};
    } else if (typeof out.query === "object") {
      res.query = out.query;
        }
    }
    return res;
    }
  async function handleGenerate() {
    setMsg(null); setError(null); setGen(null);
    if (!canUse) { setError("Select a connection & database first."); return; }
    if (!natural.trim()) { setError("Enter a question / instruction."); return; }

    try {
        const raw = await aiGenerate(profileId!, db!, { natural, mode, collection: activeCollection });
        const out = normalizeGen(raw);
        console.debug("[aiGenerate] normalized:", out);
        setGen(out);
        setOpenPreview(true);
        setMsg("Generated query.");
        await handleRun(out);
    } catch (e: any) {
      setError(e.message || "Generate failed");
    } finally {
      setLoadingGen(false);
    }
  }

  async function handleRun(existing?: {query?: any; pipeline?: any} | null) {
    setMsg(null); setError(null);
    if (!canUse) { setError("Select a connection & database first."); return; }
    const payload = existing ?? gen;
    if (!payload?.query && !payload?.pipeline) {
      setError("Nothing to run yet. Generate first.");
      return;
    }

    try {
      setLoadingRun(true);
      const docs = await aiRun(profileId!, db!, {
        collection: activeCollection,
        query: payload.query,
        pipeline: payload.pipeline,
        limit
      });
      console.debug("[aiRun] results:", docs);
      onResults(docs);
      setMsg(docs?.length ? `Got ${docs.length} result(s).` : "No results.");
      if (!docs?.length) setOpenPreview(true); // keep preview visible if empty
    } catch (e: any) {
      setError(e.message || "Run failed");
    } finally {
      setLoadingRun(false);
    }
  }

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <InputGroup size="sm" style={{ minWidth: 320, maxWidth: 560 }}>
        <InputGroup.Text>AI</InputGroup.Text>
        <Form.Select
          size="sm"
          value={mode}
          onChange={e => setMode(e.currentTarget.value as "find" | "aggregate")}
          style={{ maxWidth: 120 }}
        >
          <option value="find">find()</option>
          <option value="aggregate">aggregate()</option>
        </Form.Select>
        <Form.Control
          size="sm"
          placeholder={`Ask about ${activeCollection}...`}
          value={natural}
          onChange={e => setNatural(e.target.value)}
        />
        <Button size="sm" variant="outline-secondary" onClick={handleGenerate} disabled={loadingGen || !canUse}>
          {loadingGen ? <Spinner animation="border" size="sm" /> : "Generate"}
        </Button>
      </InputGroup>

      <InputGroup size="sm" style={{ width: 140 }}>
        <InputGroup.Text>Limit</InputGroup.Text>
        <Form.Control
          size="sm"
          type="number"
          min={1}
          value={limit}
          onChange={e => setLimit(Number(e.target.value) || 100)}
        />
      </InputGroup>

      <ButtonGroup size="sm">
        <Button variant="primary" onClick={() => handleRun(null)} disabled={loadingRun || !gen || !canUse}>
          {loadingRun ? <Spinner animation="border" size="sm" /> : "Run"}
        </Button>
        <Button variant="outline-secondary" onClick={() => { setGen(null); setMsg(null); setError(null); }} disabled={!gen}>Clear</Button>
        <Button
          variant={openPreview ? "secondary" : "outline-secondary"}
          onClick={() => setOpenPreview(v => !v)}
          disabled={!gen}
        >
          Preview
        </Button>
      </ButtonGroup>

      {msg && <div className="text-success small">{msg}</div>}
      {error && <div className="text-danger small">{error}</div>}

      <div className="w-100" />
      <Collapse in={openPreview}>
        <div className="mt-1" style={{ maxWidth: 720 }}>
          {gen && (
            <pre className="small mb-0 border rounded p-2 bg-body-tertiary" style={{ maxHeight: 180, overflow: "auto" }}>
              {JSON.stringify(gen, null, 2)}
            </pre>
          )}
        </div>
      </Collapse>
    </div>
  );
}