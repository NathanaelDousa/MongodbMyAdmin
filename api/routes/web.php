<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\{ ConnectionsController, DataController };

// Healthcheck 
Route::get('/ping', fn () => ['pong' => true]);


Route::withoutMiddleware([
    'web',
    \App\Http\Middleware\VerifyCsrfToken::class,
    \Illuminate\Session\Middleware\StartSession::class,
    \Illuminate\View\Middleware\ShareErrorsFromSession::class,
    \Illuminate\Cookie\Middleware\EncryptCookies::class,
    \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
])->middleware('api')->group(function () {

    // Connections
    Route::get   ('/connections',            [ConnectionsController::class, 'index']);
    Route::post  ('/connections',            [ConnectionsController::class, 'store']);
    Route::get   ('/connections/{id}',       [ConnectionsController::class, 'show']);   
    Route::patch ('/connections/{id}',       [ConnectionsController::class, 'update']);
    Route::delete('/connections/{id}',       [ConnectionsController::class, 'destroy']);
    Route::post  ('/connections/{id}/test',  [ConnectionsController::class, 'test']);

    // Data
    Route::get ('/collections',                    [DataController::class, 'collections']);
    Route::get ('/collections/{name}/docs',        [DataController::class, 'docs']);
    Route::get ('/collections/{name}/docs/{id}',   [DataController::class, 'show']);
    Route::post('/collections/{name}/docs',        [DataController::class, 'create']);
    Route::patch('/collections/{name}/docs/{id}',  [DataController::class, 'update']);
    Route::delete('/collections/{name}/docs/{id}', [DataController::class, 'destroy']);
    //Route::post('/collections', [DataController::class, 'createCollection']);

    Route::post('/collections/_create', [DataController::class, 'createCollection']);
    Route::post('/collections/_rename', [DataController::class, 'renameCollection']);
    Route::delete('/collections/{name}', [DataController::class, 'dropCollection']);

    // AI features
    Route::post('/ai/generate', [DataController::class, 'aiGenerate']);
    Route::post('/ai/run',      [DataController::class, 'aiRun']);
});
