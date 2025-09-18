<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use App\Services\MongoService;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\BSON\Regex;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;


class DataController extends Controller
{
    // ============================================================
    // Helpers
    // ============================================================

    /**
     * Central DB resolver: vereist ?profile= en ?db= in de querystring.
     * Geeft een \MongoDB\Database terug of een 422 JSON error.
     */
    private function dbOrFail(Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        if (!$profileId) {
            abort(response()->json(['error' => 'Missing profile id (?profile=...)'], 422));
        }
        if (!$dbName) {
            abort(response()->json(['error' => 'Missing database name (?db=...)'], 422));
        }

        try {
            return $mongo->db($profileId, $dbName);
        } catch (\Throwable $e) {
            abort(response()->json(['error' => 'Failed to connect to database', 'detail' => $e->getMessage()], 500));
        }
    }

    /**
     * Recursief: zet Mongo Extended JSON om naar echte BSON types.
     * Ondersteunt: $oid, $date, $numberLong, $numberDecimal, $regex.
     */
    private function castExtendedJson($value)
    {
        if (is_array($value)) {
            // {"$oid": "..."}
            if (array_key_exists('$oid', $value) && is_string($value['$oid'])) {
                try { return new ObjectId($value['$oid']); } catch (\Throwable $e) { return $value; }
            }

            // {"$date": "..."} of {"$date":{"$numberLong":"1700000000000"}}
            if (array_key_exists('$date', $value)) {
                $d = $value['$date'];
                try {
                    if (is_string($d) || is_int($d)) {
                        return new UTCDateTime(new \DateTime($d));
                    }
                    if (is_array($d) && isset($d['$numberLong'])) {
                        return new UTCDateTime((int) $d['$numberLong']);
                    }
                } catch (\Throwable $e) {
                    return $value;
                }
            }

            // {"$numberLong":"123"}
            if (array_key_exists('$numberLong', $value) && is_string($value['$numberLong'])) {
                // laat als string of cast naar (int). Veel veiliger: string bewaren.
                return (string) $value['$numberLong'];
            }

            // {"$numberDecimal":"12.34"}
            if (array_key_exists('$numberDecimal', $value) && is_string($value['$numberDecimal'])) {
                // idem: als string terug; drivers kunnen Decimal128, maar string is veilig.
                return (string) $value['$numberDecimal'];
            }

            // {"$regex":"^foo","$options":"i"}
            if (array_key_exists('$regex', $value) && is_string($value['$regex'])) {
                $opts = isset($value['$options']) && is_string($value['$options']) ? $value['$options'] : '';
                try { return new Regex($value['$regex'], $opts); } catch (\Throwable $e) { return $value; }
            }

            // Recurse
            foreach ($value as $k => $v) {
                $value[$k] = $this->castExtendedJson($v);
            }
        }
        return $value;
    }

    /** Zorg dat _id voor de frontend altijd string is. */
    private function normalizeId(&$doc)
    {
        if (is_object($doc) && isset($doc->_id) && $doc->_id instanceof ObjectId) {
            $doc->_id = (string) $doc->_id;
        }
        return $doc;
    }

    // ============================================================
    // Collections (lijst)
    // ============================================================

    public function collections(Request $r, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);

        try {
            $list = [];
            foreach ($db->listCollections() as $info) {
                $name  = $info->getName();
                $count = $db->selectCollection($name)->countDocuments();
                $list[] = ['name' => $name, 'count' => $count];
            }
            usort($list, fn($a, $b) => strcmp($a['name'], $b['name']));
            return response()->json($list);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to list collections', 'detail' => $e->getMessage()], 500);
        }
    }

    // ============================================================
    // Documents
    // ============================================================

    public function docs(string $name, Request $r, MongoService $mongo)
    {
        $db    = $this->dbOrFail($r, $mongo);
        $limit = (int) $r->query('limit', 100);

        try {
            $coll   = $db->selectCollection($name);
            $cursor = $coll->find([], ['limit' => $limit]);
            $docs   = [];
            foreach ($cursor as $d) {
                $docs[] = $this->normalizeId($d);
            }
            return response()->json($docs);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to fetch documents', 'detail' => $e->getMessage()], 500);
        }
    }

    public function show(Request $r, string $name, string $id, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);

        try {
            $coll = $db->selectCollection($name);
            try { $filter = ['_id' => new ObjectId($id)]; }
            catch (\Throwable $e) { $filter = ['_id' => $id]; }

            $doc = $coll->findOne($filter);
            if ($doc) $this->normalizeId($doc);

            return response()->json($doc);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to fetch document', 'detail' => $e->getMessage()], 500);
        }
    }

    public function create(string $name, Request $r, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);

        $payload = json_decode($r->getContent(), true);
        if (!is_array($payload)) {
            return response()->json(['error' => 'Body must be a JSON object'], 422);
        }

        try {
            $payload = $this->castExtendedJson($payload);

            if (!isset($payload['_id'])) {
                $payload['_id'] = new ObjectId();
            } elseif (is_array($payload['_id']) && isset($payload['_id']['$oid'])) {
                try { $payload['_id'] = new ObjectId($payload['_id']['$oid']); } catch (\Throwable $e) {}
            }

            $db->selectCollection($name)->insertOne($payload);
            $this->normalizeId($payload);

            return response()->json($payload, 201);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to create document', 'detail' => $e->getMessage()], 500);
        }
    }

    public function update(Request $r, string $name, string $id, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);

        $payload = json_decode($r->getContent(), true);
        if (!is_array($payload)) {
            return response()->json(['error' => 'Body must be a JSON object'], 422);
        }

        try {
            $payload = Arr::except($payload, ['_id', 'db', 'profile']);
            $payload = $this->castExtendedJson($payload);

            try { $filter = ['_id' => new ObjectId($id)]; }
            catch (\Throwable $e) { $filter = ['_id' => $id]; }

            $coll = $db->selectCollection($name);

            // opruimen van eventuele meegeposte interne velden
            $coll->updateOne($filter, ['$unset' => ['db' => true, 'profile' => true]]);
            if (!empty($payload)) {
                $coll->updateOne($filter, ['$set' => $payload]);
            }

            $doc = $coll->findOne($filter);
            if ($doc) $this->normalizeId($doc);

            return response()->json($doc);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to update document', 'detail' => $e->getMessage()], 500);
        }
    }

    public function destroy(string $name, string $id, Request $r, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);

        try {
            try { $filter = ['_id' => new ObjectId($id)]; }
            catch (\Throwable $e) { $filter = ['_id' => $id]; }

            $res = $db->selectCollection($name)->deleteOne($filter);
            return response()->json(['deletedCount' => $res->getDeletedCount()]);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to delete document', 'detail' => $e->getMessage()], 500);
        }
        }

    // ============================================================
    // Collections admin (create / rename / drop)
    // ============================================================

    public function createCollection(Request $r, MongoService $mongo)
    {
        $db   = $this->dbOrFail($r, $mongo);
        $name = trim($r->input('name', ''));

        if ($name === '' || !preg_match('/^[a-zA-Z0-9._-]+$/', $name)) {
            return response()->json(['error' => 'Invalid collection name'], 422);
        }

        $opts    = [];
        $options = $r->input('options', []);
        if (!empty($options['capped'])) {
            $size = isset($options['size']) ? (int) $options['size'] : 0;
            if ($size <= 0) return response()->json(['error' => 'Capped collections require positive size'], 422);
            $opts['capped'] = true;
            $opts['size']   = $size;
            if (!empty($options['max'])) $opts['max'] = (int) $options['max'];
        }

        try {
            // bestaat al?
            foreach ($db->listCollections() as $info) {
                if ($info->getName() === $name) {
                    return response()->json(['ok' => true, 'created' => false, 'name' => $name], 200);
                }
            }
            $db->createCollection($name, $opts);
            return response()->json(['ok' => true, 'created' => true, 'name' => $name], 201);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to create collection', 'detail' => $e->getMessage()], 500);
        }
    }

    public function renameCollection(Request $r, MongoService $mongo)
    {
        $db   = $this->dbOrFail($r, $mongo);
        $from = trim($r->input('from', ''));
        $to   = trim($r->input('to', ''));

        if ($from === '' || $to === '' || $from === $to) {
            return response()->json(['error' => 'Invalid from/to'], 422);
        }

        try {
            $db->selectCollection($from)->rename(
                toCollectionName: $to,
                toDatabaseName: null,
                options: ['dropTarget' => false]
            );

            //  SUCCES
            return response()->json(['ok' => true]);
        } catch (\Throwable $e) {
            return response()->json([
                'error'  => 'Failed to rename collection',
                'detail' => $e->getMessage()
            ], 500);
        }
    }

    public function dropCollection(string $name, Request $r, MongoService $mongo)
    {
        $db = $this->dbOrFail($r, $mongo);
        try {
            $db->selectCollection($name)->drop();
            return response()->json(['ok' => true]);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to drop collection', 'detail' => $e->getMessage()], 500);
        }
    }

    //=================AI FEATURES==================
    /**
     * Collect up to $limit sample docs and flatten their field paths
     * (preserves original casing: "Name", "Adres", etc.).
     */
    private function sampleFieldNames(\MongoDB\Database $db, string $collection, int $limit = 50): array
    {
        $fields = [];
        try {
            $cursor = $db->selectCollection($collection)->find([], ['limit' => $limit]);
            foreach ($cursor as $doc) {
                $this->collectFieldsFromDoc($doc, $fields);
            }
        } catch (\Throwable $e) {
            // ignore sampling errors; we just won't have field hints
        }
        // unique while preserving order
        $seen = [];
        $out = [];
        foreach ($fields as $f) {
            if (!isset($seen[$f])) { $seen[$f] = true; $out[] = $f; }
        }
        return $out;
    }

    private function collectFieldsFromDoc($value, array &$fields, string $base = ''): void
    {
        if (is_object($value)) $value = (array) $value;
        if (!is_array($value)) return;

        foreach ($value as $k => $v) {
            if ($k === '_id') continue;
            $path = $base ? ($base . '.' . $k) : $k;
            $fields[] = $path;
            if (is_array($v) || is_object($v)) {
                $this->collectFieldsFromDoc($v, $fields, $path);
            }
        }
    }

    /** Map lowercased field name → canonical casing from samples. */
    private function buildCaseMap(array $fields): array
    {
        $map = [];
        foreach ($fields as $f) $map[strtolower($f)] = $f;
        return $map;
    }

    /** Recursively remap query object keys to canonical casing using $caseMap. */
    private function remapQueryKeysCaseInsensitive($query, array $caseMap)
    {
        if (!is_array($query)) return $query;

        // detect list vs assoc
        $isList = function(array $a): bool {
            if (function_exists('array_is_list')) return array_is_list($a);
            $i = 0; foreach ($a as $k => $_) { if ($k !== $i++) return false; } return true;
        };

        if ($isList($query)) {
            return array_map(fn($it) => $this->remapQueryKeysCaseInsensitive($it, $caseMap), $query);
        }

        $out = [];
        foreach ($query as $k => $v) {
            $targetKey = $caseMap[strtolower($k)] ?? $k;
            $out[$targetKey] = is_array($v)
                ? $this->remapQueryKeysCaseInsensitive($v, $caseMap)
                : $v;
        }
        return $out;
    }

    /**
     * Extract strict JSON from a model response:
     * - try raw
     * - try ```json fenced block
     * - try substring between first '{' and last '}'
     */
    private function parseModelJson(string $content): ?array
    {
        $tryDecode = function(string $s): ?array {
            $s = trim($s);
            $data = json_decode($s, true);
            return is_array($data) ? $data : null;
        };

        // 1) direct JSON
        if (strlen($content) && $content[0] === '{') {
            if ($out = $tryDecode($content)) return $out;
        }

        // 2) fenced ```json ... ```
        if (preg_match('/```(?:json)?\s*([\s\S]*?)```/i', $content, $m)) {
            if ($out = $tryDecode($m[1])) return $out;
        }

        // 3) first '{' … last '}'
        $first = strpos($content, '{'); $last = strrpos($content, '}');
        if ($first !== false && $last !== false && $last > $first) {
            if ($out = $tryDecode(substr($content, $first, $last - $first + 1))) return $out;
        }

        return null;
    }

    public function aiGenerate(Request $r, MongoService $mongo)
{
    // Ensure ?profile=&db= are valid; we don't use $db for generation,
    // but we keep it consistent with the rest of your API.
    $db = $this->dbOrFail($r, $mongo);

    $natural    = trim((string) $r->input('natural', ''));
    $mode       = $r->input('mode', 'find'); // 'find' | 'aggregate'
    $collection = trim((string) $r->input('collection', ''));

    if ($natural === '' || !in_array($mode, ['find', 'aggregate'], true)) {
        return response()->json(['error' => 'Invalid input'], 422);
    }

    // Sample schema fields (exact casing) to guide the model and for remapping
    $knownFields = [];
    if ($collection !== '') {
        try { $knownFields = $this->sampleFieldNames($db, $collection, 50); } catch (\Throwable $e) {}
    }

    $fieldsList = $knownFields ? implode(", ", $knownFields) : "(no sample available)";

    // System prompt: enforce strict JSON, no collection/db, reuse field names exactly
    $system = <<<SYS
You translate natural language into MongoDB queries.
Return ONLY strict JSON, no code fences, no prose.

If mode is "find": return {"query": { ... }}
If mode is "aggregate": return {"pipeline": [ ... ]}

Rules:
- Use exact field casing from SCHEMA FIELDS when possible.
- If the user says "contains"/"starts with"/"case-insensitive".
- NEVER output an empty. If you don't know the value, use equality or omit that condition.
- Do NOT include db/collection names. No comments, no trailing commas.
SYS;

    $user = ($mode === 'find')
        ? "Write a MongoDB find query (JSON only) for: {$natural}"
        : "Write a MongoDB aggregation pipeline (JSON only) for: {$natural}";

    if ($collection !== '') {
        $user .= "\nTarget collection: {$collection}";
    }

    try {
        $resp = Http::baseUrl(env('OLLAMA_BASE', 'http://localhost:11434'))
            ->timeout(30)
            ->post('/api/chat', [
                'model'    => env('OLLAMA_MODEL', 'qwen2.5-coder:latest'),
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user',   'content' => $user],
                ],
                'stream'   => false,
            ]);

        if (!$resp->ok()) {
            return response()->json(['error' => 'Ollama request failed', 'detail' => $resp->body()], 502);
        }

        $data    = $resp->json();
        $content = $data['message']['content'] ?? '';

        $json = $this->parseModelJson((string) $content);
        if (!is_array($json)) {
            return response()->json(['error' => 'Model did not return valid JSON', 'raw' => $content], 502);
        }

        // Whitelist and coerce shape
        $out = [];
        if (isset($json['query']) && is_array($json['query']))     $out['query']    = $json['query'];
        if (isset($json['pipeline']) && is_array($json['pipeline'])) $out['pipeline'] = $json['pipeline'];

        if (!$out) {
            return response()->json(['error' => 'No query/pipeline in model response', 'raw' => $json], 422);
        }

        // Some models mistakenly return query as an array → normalize to object
        if (isset($out['query']) && is_array($out['query'])) {
            $isList = function(array $a): bool {
                if (function_exists('array_is_list')) return array_is_list($a);
                $i = 0; foreach ($a as $k => $_) { if ($k !== $i++) return false; } return true;
            };
            if ($isList($out['query'])) {
                $out['query'] = $out['query'][0] ?? (object)[];
            }
            if ($out['query'] === []) $out['query'] = (object)[];
        }

        // Case-insensitive key remapping using sampled schema
        if (!empty($knownFields) && isset($out['query']) && is_array($out['query'])) {
            $out['query'] = $this->remapQueryKeysCaseInsensitive($out['query'], $this->buildCaseMap($knownFields));
        }

        return response()->json([
            'query'     => $out['query']    ?? null,
            'pipeline'  => $out['pipeline'] ?? null,
            'fields'    => $knownFields, // handy for UI display/debug
            'raw'       => $content,     // optional for debugging
        ]);
    } catch (\Throwable $e) {
        // Case-insensitive key remap had je al...
        if (!empty($knownFields) && isset($out['query']) && is_array($out['query'])) {
            $out['query'] = $this->remapQueryKeysCaseInsensitive(
                $out['query'],
                $this->buildCaseMap($knownFields)
            );
        }

        // Sanitize: verwijder lege $regex
        if (isset($out['query']) && is_array($out['query'])) {
            $removed = 0;
            $out['query'] = $this->sanitizeMongoQuery($out['query'], $removed);
            if ($removed > 0 && empty($out['query'])) {
                // Als hierdoor alles wegvalt: geef duidelijke fout (of vervang door {} als je all-docs wilt)
                return response()->json([
                    'error' => 'Model returned empty $regex; after sanitizing no conditions remained.',
                    'hint'  => 'Try a more specific prompt or exact match (e.g., Name equals "aa").',
                    'raw'   => $content,
                ], 422);
            }
        }
        return response()->json(['error' => 'Ollama request failed', 'detail' => $e->getMessage()], 500);
    }
}

public function aiRun(Request $r, MongoService $mongo)
{
    $db = $this->dbOrFail($r, $mongo);

    $collection = trim((string) $r->input('collection', ''));
    $query      = $r->input('query', null);
    $pipeline   = $r->input('pipeline', null);
    $limit      = (int) $r->input('limit', 100);
    $ci         = filter_var($r->input('ci', true), FILTER_VALIDATE_BOOL);
    $fuzzy      = filter_var($r->input('fuzzy', false), FILTER_VALIDATE_BOOL); // <— NEW

    if ($collection === '') {
        return response()->json(['error' => 'Missing collection'], 422);
    }

    try {
        $coll = $db->selectCollection($collection);

        if (is_array($pipeline)) {
            $casted = $this->castExtendedJson($pipeline);
            $cursor = $coll->aggregate($casted, ['allowDiskUse' => true]);
        } else {
            // optional fuzzy transform BEFORE casting
            if ($fuzzy && is_array($query)) {
                $query = $this->makeFuzzy($query);
            }

            $casted  = is_array($query) ? $this->castExtendedJson($query) : [];
            $options = ['limit' => $limit > 0 ? $limit : 100];

            // equality-only case-insensitive collation (doesn't affect regex)
            if ($ci) {
                $options['collation'] = ['locale' => 'en', 'strength' => 2];
            }

            $cursor = $coll->find($casted, $options);
        }

        $docs = [];
        foreach ($cursor as $d) { $docs[] = $this->normalizeId($d); }
        return response()->json($docs);
    } catch (\Throwable $e) {
        return response()->json(['error' => 'Failed to run query', 'detail' => $e->getMessage()], 500);
    }
}
/** Walk a query object and fix/remove invalid operators (e.g., empty $regex). */
private function sanitizeMongoQuery($q, &$removedEmptyRegex = 0) {
    if (!is_array($q)) return $q;

    // list vs assoc
    $isList = function(array $a): bool {
        if (function_exists('array_is_list')) return array_is_list($a);
        $i = 0; foreach ($a as $k => $_) { if ($k !== $i++) return false; } return true;
    };

    if ($isList($q)) {
        return array_map(fn($v) => $this->sanitizeMongoQuery($v, $removedEmptyRegex), $q);
    }

    $out = [];
    foreach ($q as $k => $v) {
        if (is_array($v)) {
            // detect {$regex: "...", $options: "..."} objectjes
            if (array_key_exists('$regex', $v)) {
                $pattern = $v['$regex'];
                if (!is_string($pattern) || trim($pattern) === '') {
                    // verwijder leeg regex-blok
                    $removedEmptyRegex++;
                    // skip hele key (effectief dit criterium weggooien)
                    continue;
                }
                // normaliseer $options
                if (isset($v['$options']) && !is_string($v['$options'])) {
                    $v['$options'] = (string) $v['$options'];
                }
                $out[$k] = $this->sanitizeMongoQuery($v, $removedEmptyRegex);
                continue;
            }

            $out[$k] = $this->sanitizeMongoQuery($v, $removedEmptyRegex);
        } else {
            $out[$k] = $v;
        }
    }
    return $out;
}
/** Escape a user string so it’s safe inside a regex literal. */
private function escapeRegex(string $s): string {
    return preg_quote($s, '/');
}

/** Recursively convert plain string equals into { $regex, $options:"i" } if fuzzy=true */
private function makeFuzzy($q) {
    if (!is_array($q)) return $q;

    $isList = function(array $a): bool {
        if (function_exists('array_is_list')) return array_is_list($a);
        $i = 0; foreach ($a as $k => $_) { if ($k !== $i++) return false; } return true;
    };

    if ($isList($q)) {
        return array_map(fn($v) => $this->makeFuzzy($v), $q);
    }

    $out = [];
    foreach ($q as $k => $v) {
        if (is_array($v)) {
            // leave operators ($and, $or, $in, $regex, etc.) alone, but recurse
            $out[$k] = $this->makeFuzzy($v);
        } else {
            if (is_string($v)) {
                $out[$k] = [
                    '$regex'   => $this->escapeRegex($v),
                    '$options' => 'i',
                ];
            } else {
                $out[$k] = $v;
            }
        }
    }
    return $out;
}
}