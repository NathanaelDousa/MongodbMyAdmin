<?php
namespace App\Services;

use App\Models\ConnectionProfile;
use Illuminate\Support\Facades\Crypt;
use MongoDB\Client;

class MongoService
{
    public function client(string $profileId): Client
    {
        $profile = ConnectionProfile::findOrFail($profileId);

        if ($profile->engine === 'driver') {
            $uri = $profile->uri ? Crypt::decryptString($profile->uri) : null;
            if (!$uri) {
                throw new \RuntimeException('Missing URI for driver engine');
            }
            return new Client($uri, [], ['typeMap' => ['root' => 'array', 'document' => 'array']]);
        }

        // (optioneel) Data API engine zou je hier apart afhandelen
        throw new \RuntimeException('Only driver engine supported in this method');
    }

    public function db(string $profileId, ?string $dbName = null)
    {
        $profile = ConnectionProfile::findOrFail($profileId);
        $client  = $this->client($profileId);

        $db = $dbName ?: ($profile->defaultDatabase ?? null);
        if (!$db) {
            throw new \RuntimeException('Database name not provided and no defaultDatabase on profile');
        }

        return $client->selectDatabase($db);
    }
}
