<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\{ ConnectionsController, DataController };

// Healthcheck (mag onder web blijven)
Route::get('/ping', fn () => ['pong' => true]);

// ✅ JSON endpoints: GEEN 'web' middleware, WEL 'api' middleware
Route::withoutMiddleware([
    'web',
    \App\Http\Middleware\VerifyCsrfToken::class,
    \Illuminate\Session\Middleware\StartSession::class,
    \Illuminate\View\Middleware\ShareErrorsFromSession::class,
    \Illuminate\Cookie\Middleware\EncryptCookies::class,
    \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
])->middleware('api')->group(function () {

    // Connections
    Route::get ('/connections',            [ConnectionsController::class, 'index']);
    Route::post('/connections',            [ConnectionsController::class, 'store']);
    Route::post('/connections/{id}/test',  [ConnectionsController::class, 'test']);

    // Data
    Route::get ('/collections',                    [DataController::class, 'collections']);
    Route::get ('/collections/{name}/docs',        [DataController::class, 'docs']);
    Route::get ('/collections/{name}/docs/{id}',   [DataController::class, 'show']);
    Route::post('/collections/{name}/docs',        [DataController::class, 'create']);
    Route::patch('/collections/{name}/docs/{id}',  [DataController::class, 'update']);
    Route::delete('/collections/{name}/docs/{id}', [DataController::class, 'destroy']);
});
