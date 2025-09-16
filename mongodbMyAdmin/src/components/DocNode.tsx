import React from "react";
import { Handle, Position } from "reactflow";
import { normalizeForDisplay, pickTitle, shortVal } from "../lib/helpers";

export default function DocNode({ data }: any) {
  const doc = data.doc || {};
  const displayDoc = normalizeForDisplay(doc);
  const fields = Object.entries(displayDoc).filter(([k]) => k !== "_id").slice(0, 6);

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
        width: 260,
        boxSizing: "border-box",
        cursor: "pointer",
        marginBottom: 0,
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