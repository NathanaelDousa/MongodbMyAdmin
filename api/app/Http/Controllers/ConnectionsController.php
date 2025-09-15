<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use App\Models\ConnectionProfile;
use App\Services\MongoService;

class ConnectionsController extends Controller
{
    public function index()
    {
        // Haal alleen de velden die je wilt tonen en cast _id naar string
        $items = ConnectionProfile::select(['_id','name','engine','defaultDatabase'])->get();

        $out = $items->map(function ($doc) {
            return [
                '_id'             => (string) $doc->_id,          //  string
                'name'            => $doc->name,
                'engine'          => $doc->engine,
                'defaultDatabase' => $doc->defaultDatabase,
            ];
        });

        return response()->json($out, 200);
    }
    

   public function update(string $id, Request $r)
    {
        $conn = ConnectionProfile::find($id);
        if (!$conn) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $data = $r->validate([
            'name'            => 'sometimes|required|string',
            'engine'          => 'sometimes|required|in:driver,data_api',
            'uri'             => 'nullable|string',
            'defaultDatabase' => 'nullable|string',
        ]);

        // URI veilig opslaan (enkel nuttig bij engine=driver)
        if (array_key_exists('uri', $data)) {
            $nextEngine = $data['engine'] ?? $conn->engine;
            if ($nextEngine === 'driver' && !empty($data['uri'])) {
                $data['uri'] = Crypt::encryptString($data['uri']);
            } else {
                // bij switch naar data_api of lege uri -> leeg maken
                $data['uri'] = null;
            }
        }

        $conn->fill($data);
        $conn->save();

        // Geef een compacte, genormaliseerde payload terug
        return response()->json([
            '_id'             => (string) $conn->_id,
            'name'            => $conn->name,
            'engine'          => $conn->engine,
            'defaultDatabase' => $conn->defaultDatabase,
        ], 200);
    }
    

    public function show(string $id)
    {
        $conn = ConnectionProfile::find($id);
        if (!$conn) {
            return response()->json(['error' => 'Not found'], 404);
        }
        return response()->json($conn);
    }

        public function destroy(string $id)
    {
        $conn = ConnectionProfile::find($id);
        if (!$conn) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $conn->delete();

        return response()->json(['ok' => true], 200);
    }

    public function store(Request $r)
    {
        $data = $r->validate([
            'name'            => 'required|string',
            'engine'          => 'required|in:driver,data_api',
            'uri'             => 'required_if:engine,driver|string',
            'defaultDatabase' => 'nullable|string',
        ]);

        if ($data['engine'] === 'driver' && !empty($data['uri'])) {
            $data['uri'] = Crypt::encryptString($data['uri']);
        }

        $doc = ConnectionProfile::create($data);

        // 👇 stuur een compacte, genormaliseerde payload terug
        return response()->json([
            '_id'             => (string) $doc->_id,             // 👈 string
            'name'            => $doc->name,
            'engine'          => $doc->engine,
            'defaultDatabase' => $doc->defaultDatabase,
        ], 201);
    }

    public function test(string $id, MongoService $mongo)
    {
        // Probeert te verbinden met het profiel en default DB, simpele call als test
        $db = $mongo->db($id);
        $db->listCollections();

        return response()->json(['ok' => true], 200);
    }
}
