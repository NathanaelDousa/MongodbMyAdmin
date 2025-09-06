<?php
namespace App\Models;

use MongoDB\Laravel\Eloquent\Model; // <- van mongodb/laravel-mongodb

class ConnectionProfile extends Model
{
    protected $connection = 'mongodb';
    protected $collection = '_connections';
    protected $guarded = [];
    protected $hidden = ['uri'];
}
