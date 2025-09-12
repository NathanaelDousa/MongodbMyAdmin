<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use App\Services\MongoService;
use App\Models\ConnectionProfile;  
use MongoDB\BSON\ObjectId;

class DataController extends Controller
{
    // ============================================================
    // Helpers
    // ============================================================

    /** Recursief: zet {"$oid":"…"} om naar ObjectId */
    private function castExtendedJson($value)
    {
        if (is_array($value)) {
            if (array_key_exists('$oid', $value) && is_string($value['$oid'])) {
                try { return new ObjectId($value['$oid']); } catch (\Throwable $e) {}
            }
            foreach ($value as $k => $v) {
                $value[$k] = $this->castExtendedJson($v);
            }
        }
        return $value;
    }

    /** Zorg dat _id altijd string is voor frontend */
    private function normalizeId(&$doc)
    {
        if (isset($doc->_id) && $doc->_id instanceof ObjectId) {
            $doc->_id = (string) $doc->_id;
        }
        return $doc;
    }

    // ============================================================
    // Collections
    // ============================================================

    public function collections(Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        if (!$profileId) {
            return response()->json(['error' => 'Missing profile id'], 422);
        }

        $profile = ConnectionProfile::find($profileId);
        if (!$profile) {
            return response()->json(['error' => 'Profile not found'], 404);
        }

        // Fallback naar defaultDatabase
        $dbName = $dbName ?: ($profile->defaultDatabase ?? null);
        if (!$dbName) {
            return response()->json(['error' => 'Database not specified and no defaultDatabase set on profile'], 422);
        }

        $db = $mongo->db($profileId, $dbName);

        $list = [];
        foreach ($db->listCollections() as $info) {
            $name = $info->getName();
            $count = $db->selectCollection($name)->countDocuments();
            $list[] = ['name' => $name, 'count' => $count];
        }

        usort($list, fn($a, $b) => strcmp($a['name'], $b['name']));
        return response()->json($list);
    }

    // ============================================================
    // Docs
    // ============================================================

    public function docs(string $name, Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');
        $limit     = (int) ($r->query('limit', 100));

        if (!$profileId) {
            return response()->json(['error' => 'Missing profile id'], 422);
        }

        $profile = ConnectionProfile::find($profileId);
        if (!$profile) {
            return response()->json(['error' => 'Profile not found'], 404);
        }

        $dbName = $dbName ?: ($profile->defaultDatabase ?? null);
        if (!$dbName) {
            return response()->json(['error' => 'Database not specified and no defaultDatabase set on profile'], 422);
        }

        $db   = $mongo->db($profileId, $dbName);
        $coll = $db->selectCollection($name);

        $cursor = $coll->find([], ['limit' => $limit]);
        $docs   = [];
        foreach ($cursor as $d) {
            $docs[] = $this->normalizeId($d);
        }

        return response()->json($docs);
    }

    public function show(Request $r, string $name, string $id, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        $db   = $mongo->db($profileId, $dbName);
        $coll = $db->selectCollection($name);

        try { $filter = ['_id' => new ObjectId($id)]; }
        catch (\Throwable $e) { $filter = ['_id' => $id]; }

        $doc = $coll->findOne($filter);
        if ($doc) $this->normalizeId($doc);

        return response()->json($doc);
    }

    public function create(string $name, Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        $payload = json_decode($r->getContent(), true);
        if (!is_array($payload)) {
            return response()->json(['error' => 'Body must be a JSON object'], 422);
        }

        $payload = $this->castExtendedJson($payload);

        if (!isset($payload['_id'])) {
            $payload['_id'] = new ObjectId();
        } elseif (is_array($payload['_id']) && isset($payload['_id']['$oid'])) {
            $payload['_id'] = new ObjectId($payload['_id']['$oid']);
        }

        $col = $mongo->db($profileId, $dbName)->selectCollection($name);
        $col->insertOne($payload);

        $this->normalizeId($payload);
        return response()->json($payload, 201);
    }

    public function update(Request $r, string $name, string $id, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        if (!$profileId) return response()->json(['error' => 'Missing profile id'], 422);

        if (!$dbName) {
            $profile = ConnectionProfile::find($profileId);
            $dbName  = $profile->defaultDatabase ?? null;
            if (!$dbName) {
                return response()->json(['error' => 'Database not specified and no defaultDatabase set on profile'], 422);
            }
        }

        $payload = json_decode($r->getContent(), true);
        if (!is_array($payload)) return response()->json(['error' => 'Body must be a JSON object'], 422);

        // 🚫 verwijder interne keys
        $payload = Arr::except($payload, ['_id', 'db', 'profile']);
        $payload = $this->castExtendedJson($payload);

        try { $filter = ['_id' => new ObjectId($id)]; }
        catch (\Throwable $e) { $filter = ['_id' => $id]; }

        $col = $mongo->db($profileId, $dbName)->selectCollection($name);

        // cleanup oude keys
        $col->updateOne($filter, ['$unset' => ['db' => true, 'profile' => true]]);

        if (!empty($payload)) {
            $col->updateOne($filter, ['$set' => $payload]);
        }

        $doc = $col->findOne($filter);
        if ($doc) $this->normalizeId($doc);

        return response()->json($doc);
    }

    public function destroy(string $name, string $id, Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        try { $filter = ['_id' => new ObjectId($id)]; }
        catch (\Throwable $e) { $filter = ['_id' => $id]; }

        $col = $mongo->db($profileId, $dbName)->selectCollection($name);
        $res = $col->deleteOne($filter);

        return ['deletedCount' => $res->getDeletedCount()];
    }
}