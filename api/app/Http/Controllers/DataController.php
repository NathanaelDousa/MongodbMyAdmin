<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use App\Services\MongoService;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\BSON\Regex;

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
            $db->selectCollection($from)->rename($to, ['dropTarget' => false]);
            return response()->json(['ok' => true]);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to rename collection', 'detail' => $e->getMessage()], 500);
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
}