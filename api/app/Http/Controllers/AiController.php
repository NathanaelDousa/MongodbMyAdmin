<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use GuzzleHttp\Client;
use MongoDB\BSON\ObjectId;
use App\Services\MongoService;

class AiController extends Controller
{
    // === Config ===
    private string $ollamaBase = 'http://127.0.0.1:11434'; // standaard Ollama
    private string $model      = 'llama3.1';               // kies jouw local model

    /**
     * POST /ai/nl2mongo
     * body: { profile, db, collection, natural, mode? ("find"|"aggregate"), sampleFields? string[] }
     * return: { ok, kind, query|pipeline, warnings?, raw }
     */
    public function nl2mongo(Request $r)
    {
        $collection = trim($r->input('collection', ''));
        $natural    = trim($r->input('natural', ''));
        $mode       = $r->input('mode', 'find'); // default
        $sample     = $r->input('sampleFields', []); // optioneel: lijstje strings

        if ($collection === '' || $natural === '') {
            return response()->json(['ok' => false, 'error' => 'collection/natural required'], 422);
        }

        // System prompt (kort, dwing JSON-structuur af)
        $system = <<<SYS
Je bent een vertaler van natuurlijke taal naar MongoDB-query's. 
Geef **strikt JSON** met OF:
- { "kind":"find", "filter":{}, "projection":{}, "sort":{}, "limit": number }
OF:
- { "kind":"aggregate", "pipeline":[ {...}, ... ], "limit": number }

Gebruik geen $where of JavaScript. Voeg geen uitleg toe. Houd limit <= 100.
SYS;

        // Few-shot stijl + context
        $user = [
            'task'       => 'translate-natural-to-mongo',
            'mode'       => $mode,
            'collection' => $collection,
            'natural'    => $natural,
            'hints'      => [
                'fields' => $sample,     // helpt het model
                'defaults' => ['limit' => 50]
            ],
            'output'     => 'strict-json'
        ];

        try {
            $client = new Client(['base_uri' => $this->ollamaBase, 'timeout' => 30]);

            // Ollama /api/generate met JSON-output
            $resp = $client->post('/api/generate', [
                'json' => [
                    'model'  => $this->model,
                    'prompt' => json_encode($user, JSON_UNESCAPED_UNICODE),
                    'system' => $system,
                    'stream' => false,
                    'format' => 'json', // <-- laat Ollama JSON forceren
                ]
            ]);

            $json = json_decode((string) $resp->getBody(), true);
            // Ollama antwoord bevat { "response": "...string..." }
            $responseRaw = $json['response'] ?? '';
            $parsed = json_decode($responseRaw, true);

            if (!is_array($parsed) || !isset($parsed['kind'])) {
                return response()->json(['ok' => false, 'error' => 'Model returned invalid JSON', 'raw' => $json], 500);
            }

            // Sanitise/guard
            $danger = ['$where', '$function'];
            $check  = function($arr) use ($danger) {
                $str = json_encode($arr);
                foreach ($danger as $d) {
                    if (str_contains($str, $d)) return false;
                }
                return true;
            };

            if ($parsed['kind'] === 'find') {
                $filter     = $parsed['filter']     ?? [];
                $projection = $parsed['projection'] ?? null;
                $sort       = $parsed['sort']       ?? null;
                $limit      = min(max((int)($parsed['limit'] ?? 50), 1), 100);

                if (!$check($filter) || !$check($projection ?? []) || !$check($sort ?? [])) {
                    return response()->json(['ok' => false, 'error' => 'Blocked dangerous operator'], 400);
                }

                return response()->json([
                    'ok' => true,
                    'kind' => 'find',
                    'query' => compact('filter','projection','sort','limit'),
                    'raw' => $json,
                ]);
            }

            if ($parsed['kind'] === 'aggregate') {
                $pipeline = $parsed['pipeline'] ?? [];
                $limit    = min(max((int)($parsed['limit'] ?? 50), 1), 100);

                if (!$check($pipeline)) {
                    return response()->json(['ok' => false, 'error' => 'Blocked dangerous operator'], 400);
                }

                return response()->json([
                    'ok' => true,
                    'kind' => 'aggregate',
                    'pipeline' => $pipeline,
                    'limit' => $limit,
                    'raw' => $json,
                ]);
            }

            return response()->json(['ok' => false, 'error' => 'Unknown kind', 'raw' => $json], 500);
        } catch (\Throwable $e) {
            return response()->json(['ok' => false, 'error' => 'Ollama error', 'detail' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /ai/execute
     * body: { profile, db, collection, kind, query?, pipeline?, limit? }
     */
    public function execute(Request $r, MongoService $mongo)
    {
        $db         = $this->dbOrFail($r, $mongo);
        $collection = trim($r->input('collection', ''));
        $kind       = $r->input('kind', 'find');
        $limit      = min(max((int)$r->input('limit', 50), 1), 100);

        if ($collection === '') {
            return response()->json(['ok' => false, 'error' => 'collection required'], 422);
        }

        try {
            $coll = $db->selectCollection($collection);

            if ($kind === 'find') {
                $q   = $r->input('query', []);
                $filter     = $q['filter']     ?? [];
                $projection = $q['projection'] ?? null;
                $sort       = $q['sort']       ?? null;

                $cursor = $coll->find(
                    $this->castExtended($filter),
                    array_filter([
                        'limit' => $limit,
                        'projection' => $projection,
                        'sort' => $sort,
                    ])
                );

                $docs = [];
                foreach ($cursor as $d) {
                    if (isset($d->_id) && $d->_id instanceof ObjectId) $d->_id = (string)$d->_id;
                    $docs[] = $d;
                }
                return response()->json(['ok' => true, 'docs' => $docs, 'count' => count($docs)]);
            }

            if ($kind === 'aggregate') {
                $pipeline = $r->input('pipeline', []);
                // hard append $limit als veiligheid
                $pipeline[] = ['$limit' => $limit];

                $cursor = $coll->aggregate($this->castExtended($pipeline));
                $docs = [];
                foreach ($cursor as $d) {
                    if (isset($d->_id) && $d->_id instanceof ObjectId) $d->_id = (string)$d->_id;
                    $docs[] = $d;
                }
                return response()->json(['ok' => true, 'docs' => $docs, 'count' => count($docs)]);
            }

            return response()->json(['ok' => false, 'error' => 'Unknown kind'], 422);
        } catch (\Throwable $e) {
            return response()->json(['ok' => false, 'error' => 'Execute failed', 'detail' => $e->getMessage()], 500);
        }
    }

    // --- helpers (kleine kopie van je DataController) ---
    private function dbOrFail(Request $r, MongoService $mongo)
    {
        $profileId = $r->query('profile');
        $dbName    = $r->query('db');
        if (!$profileId || !$dbName) {
            abort(response()->json(['error' => 'Missing profile/db'], 422));
        }
        return $mongo->db($profileId, $dbName);
    }

    private function castExtended($value) {
        // Hier mag je dezelfde castExtendedJson-logic hergebruiken als in DataController
        return $value;
    }
}