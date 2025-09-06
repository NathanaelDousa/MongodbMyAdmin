<?php

namespace App\Models\Models;

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

class VisualLayout extends Model
{
    protected $connection = 'mongodb';
    protected $collection = '_visual_layouts';
    protected $guarded = [];
}
