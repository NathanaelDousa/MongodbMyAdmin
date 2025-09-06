<?php

namespace App\Models\Models;

use MongoDB\Laravel\Eloquent\Model;

class VisualRelation extends Model
{
    protected $connection = 'mongodb';
    protected $collection = '_visual_relations';
    protected $guarded = [];
}