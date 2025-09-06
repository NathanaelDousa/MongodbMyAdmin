<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Services\MongoService;
use App\Models\ConnectionProfile;  
use MongoDB\BSON\ObjectId;

class DataController extends Controller
{
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

        // Fallback naar defaultDatabase als db niet meegegeven is
        $dbName = $dbName ?: ($profile->defaultDatabase ?? null);
        if (!$dbName) {
            return response()->json(['error' => 'Database not specified and no defaultDatabase set on profile'], 422);
        }

        $db = $mongo->db($profileId, $dbName);

        // Haal collecties op + counts
        $list = [];
        foreach ($db->listCollections() as $info) {
            $name = $info->getName();
            // countDocuments kan duur zijn; voor demo oké
            $count = $db->selectCollection($name)->countDocuments();
            $list[] = ['name' => $name, 'count' => $count];
        }

        // sorteer op naam voor consistentie
        usort($list, fn($a, $b) => strcmp($a['name'], $b['name']));

        return response()->json($list);
    }

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
            // cast _id naar string voor frontend
            if (isset($d->_id) && $d->_id instanceof ObjectId) {
                $d->_id = (string) $d->_id;
            }
            $docs[] = $d;
        }

        return response()->json($docs);
    }

    public function show(Request $r, string $name, string $id, MongoService $mongo)
    {
        $db = $mongo->db((string)$r->query('profile'), $r->query('db'));
        return $db->$name->findOne(['_id' => new ObjectId($id)]);
    }

    public function create(string $name, Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        $payload = $r->json()->all(); // verwacht raw JSON object
        if (!is_array($payload)) {
            return response()->json(['error' => 'Body must be a JSON object'], 422);
        }

        // _id optioneel: maak er één als hij ontbreekt
        if (!isset($payload['_id'])) {
            $payload['_id'] = new ObjectId();
        } else {
            // laat string _id door, maar als het $oid-achtig is → ObjectId
            if (is_array($payload['_id']) && isset($payload['_id']['$oid'])) {
                $payload['_id'] = new ObjectId($payload['_id']['$oid']);
            }
        }

        $col = $mongo->db($profileId, $dbName)->selectCollection($name);
        $col->insertOne($payload);

        // Stuur terug als Extended JSON-ish
        return response()->json($payload, 201);
    }

    public function update(Request $r, string $name, string $id, MongoService $mongo)
    {
        $db = $mongo->db((string)$r->query('profile'), $r->query('db'));
        $db->$name->updateOne(['_id' => new ObjectId($id)], ['$set' => $r->all()]);
        return ['ok' => true];
    }


    public function destroy(string $name, string $id, Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');

        // probeer $id als ObjectId, anders als string
        $filter = [];
        try {
            $filter = ['_id' => new ObjectId($id)];
        } catch (\Throwable $e) {
            $filter = ['_id' => $id];
        }

        $col = $mongo->db($profileId, $dbName)->selectCollection($name);
        $res = $col->deleteOne($filter);

        return ['deletedCount' => $res->getDeletedCount()];
    }
}
