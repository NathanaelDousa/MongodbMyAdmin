export type MongoDocument = { _id: any; [key: string]: any };
export type Collection = { name: string; count: number };

export type ConnectionProfile = {
  _id: string;
  name: string;
  engine: "driver" | "data_api";
  defaultDatabase?: string;
};

export type Relation = {
  sourceId: string;   // "collection:docId"
  targetId: string;   // "collection:docId"
  viaField?: string;  // optioneel: userId, authorId, ...
};

export type ViewMode = "list" | "canvas";

export type FieldRow = { path: string; type: string; sample: string };
export type DocHistoryItem = { ts: number; doc: any };