import type { Collection, ConnectionProfile, MongoDocument } from "../types";

const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Connections
export async function listConnections(): Promise<ConnectionProfile[]> {
  return api<ConnectionProfile[]>("/connections");
}
export async function createConnection(payload: {
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
export async function testConnection(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/connections/${id}/test`, { method: "POST" });
}
export async function updateConnectionProfile(id: string, payload: Partial<ConnectionProfile>) {
  return api<ConnectionProfile>(`/connections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
export async function deleteConnectionProfile(id: string) {
  return api<{ ok: boolean }>(`/connections/${id}`, { method: "DELETE" });
}

// Data
export async function getCollections(profileId: string, db?: string): Promise<Collection[]> {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);
  return api<Collection[]>(`/collections?${params.toString()}`);
}
export async function getDocs(profileId: string, collection: string, db?: string, limit = 100) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);
  params.set("limit", String(limit));
  return api<MongoDocument[]>(`/collections/${collection}/docs?${params.toString()}`);
}
export async function createDoc(profileId: string, collection: string, db: string | undefined, doc: any) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);

  return api<MongoDocument>(`/collections/${collection}/docs?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
}
export async function deleteDoc(profileId: string, collection: string, db: string | undefined, id: string) {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (db) params.set("db", db);

  return api<{ deletedCount: number }>(`/collections/${collection}/docs/${id}?${params.toString()}`, {
    method: "DELETE",
  });
}
export async function updateDoc(
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
  return api<MongoDocument>(`/collections/${collection}/docs/${id}?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Collections admin
export async function createCollection(
  profileId: string,
  db: string,
  name: string,
  options?: { capped?: boolean; size?: number; max?: number }
) {
  const params = new URLSearchParams({ profile: profileId, db });
  return api(`/collections/_create?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, options }),
  });
}
export async function renameCollection(profileId: string, db: string, from: string, to: string) {
  const params = new URLSearchParams({ profile: profileId, db });
  return api<{ ok: boolean }>(`/collections/_rename?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
}
export async function dropCollection(profileId: string, db: string, name: string) {
  const params = new URLSearchParams({ profile: profileId, db });
  return api<{ ok: boolean }>(`/collections/${encodeURIComponent(name)}?${params.toString()}`, {
    method: "DELETE",
  });
}