const mongoose = require('mongoose');

const jobSourceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 100
  },
  url: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  apiKey: {
    type: String,
    trim: true,
    maxlength: 500
  },
  format: {
    type: String,
    enum: ['xml', 'json', 'rss'],
    required: true,
    default: 'json'
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastImportAt: {
    type: Date,
    index: true
  },
  totalImports: {
    type: Number,
    default: 0,
    min: 0
  },
  totalJobsImported: {
    type: Number,
    default: 0,
    min: 0
  },
  settings: {
    fetchInterval: {
      type: Number,
      default: 6, // hours
      min: 1,
      max: 168 // 1 week
    },
    batchSize: {
      type: Number,
      default: 100,
      min: 1,
      max: 1000
    },
    concurrency: {
      type: Number,
      default: 3,
      min: 1,
      max: 20
    },
    timeout: {
      type: Number,
      default: 30000, // 30 seconds
      min: 5000,
      max: 300000 // 5 minutes
    },
    retryAttempts: {
      type: Number,
      default: 3,
      min: 0,
      max: 10
    },
    retryDelay: {
      type: Number,
      default: 1000, // 1 second
      min: 100,
      max: 60000 // 1 minute
    }
  },
  fieldMapping: {
    id: {
      type: String,
      default: 'id'
    },
    title: {
      type: String,
      default: 'title'
    },
    company: {
      type: String,
      default: 'company'
    },
    location: {
      type: String,
      default: 'location'
    },
    description: {
      type: String,
      default: 'description'
    },
    salary: {
      type: String,
      default: 'salary'
    },
    jobType: {
      type: String,
      default: 'jobType'
    },
    category: {
      type: String,
      default: 'category'
    },
    requirements: {
      type: String,
      default: 'requirements'
    },
    applicationUrl: {
      type: String,
      default: 'applicationUrl'
    },
    postedAt: {
      type: String,
      default: 'postedAt'
    },
    expiresAt: {
      type: String,
      default: 'expiresAt'
    }
  },
  fieldDefaults: {
    jobType: {
      type: String,
      enum: ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote'],
      default: 'full-time'
    },
    currency: {
      type: String,
      uppercase: true,
      maxlength: 3,
      default: 'USD'
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    }
  },
  // JSON-specific configurations
  jsonConfig: {
    isArray: {
      type: Boolean,
      default: true
    },
    jobPath: {
      type: String,
      default: ''
    },
    itemWrapper: {
      type: String,
      default: ''
    }
  },
  // XML-specific configurations
  xmlConfig: {
    rootElement: {
      type: String,
      default: 'jobs'
    },
    jobElement: {
      type: String,
      default: 'job'
    },
    namespace: {
      type: String,
      default: ''
    }
  },
  // Headers for API requests
  headers: {
    'User-Agent': {
      type: String,
      default: 'JobImporter/1.0'
    },
    'Accept': {
      type: String,
      default: 'application/json'
    }
  },
  // Authentication configuration
  auth: {
    type: {
      type: String,
      enum: ['none', 'bearer', 'basic', 'apikey'],
      default: 'none'
    },
    token: String,
    username: String,
    password: String,
    apiKeyHeader: {
      type: String,
      default: 'X-API-Key'
    }
  },
  // Validation rules for this source
  validationRules: {
    requiredFields: [{
      type: String,
      enum: ['title', 'company', 'location', 'description', 'applicationUrl']
    }],
    uniqueFields: [{
      type: String,
      enum: ['title', 'company', 'location', 'externalId']
    }]
  },
  // Statistics and health metrics
  health: {
    lastSuccessfulConnection: Date,
    lastFailure: Date,
    consecutiveFailures: {
      type: Number,
      default: 0,
      min: 0
    },
    averageResponseTime: Number, // milliseconds
    totalResponseTime: Number, // milliseconds (for calculating average)
    connectionCount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastError: {
      message: String,
      code: String,
      timestamp: Date
    }
  }
}, {
  timestamps: true,
  collection: 'job_sources'
});

// Indexes for better query performance
jobSourceSchema.index({ name: 1 });
jobSourceSchema.index({ isActive: 1, lastImportAt: -1 });
jobSourceSchema.index({ format: 1, isActive: 1 });

// Virtuals
jobSourceSchema.virtual('isHealthy').get(function() {
  const maxFailures = 3;
  const maxFailureAge = 24 * 60 * 60 * 1000; // 24 hours

  if (this.health.consecutiveFailures >= maxFailures) {
    return false;
  }

  if (this.health.lastFailure) {
    const timeSinceLastFailure = Date.now() - this.health.lastFailure.getTime();
    if (timeSinceLastFailure < maxFailureAge) {
      return false;
    }
  }

  return true;
});

jobSourceSchema.virtual('nextScheduledImport').get(function() {
  if (!this.lastImportAt) return new Date();

  const intervalMs = this.settings.fetchInterval * 60 * 60 * 1000;
  return new Date(this.lastImportAt.getTime() + intervalMs);
});

jobSourceSchema.virtual('isOverdueForImport').get(function() {
  if (!this.isActive || !this.lastImportAt) return true;

  return Date.now() > this.nextScheduledImport.getTime();
});

jobSourceSchema.virtual('averageJobsPerImport').get(function() {
  if (this.totalImports === 0) return 0;
  return Math.round(this.totalJobsImported / this.totalImports);
});

// Static methods
jobSourceSchema.statics.findActive = function() {
  return this.find({ isActive: true })
    .sort({ lastImportAt: 1 }); // Oldest first
};

jobSourceSchema.statics.findOverdueForImport = function() {
  return this.find({
    isActive: true,
    $or: [
      { lastImportAt: null },
      {
        lastImportAt: {
          $lt: new mongoose.Types.Date(Date.now() - this.settings.fetchInterval * 60 * 60 * 1000)
        }
      }
    ]
  })
  .sort({ lastImportAt: 1 });
};

jobSourceSchema.statics.findByFormat = function(format) {
  return this.find({ format, isActive: true })
    .sort({ name: 1 });
};

jobSourceSchema.statics.getHealthStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalSources: { $sum: 1 },
        activeSources: {
          $sum: { $cond: ['$isActive', 1, 0] }
        },
        healthySources: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$isActive', true] },
                  { $lt: ['$health.consecutiveFailures', 3] }
                ]
              },
              1,
              0
            ]
          }
        },
        totalImports: { $sum: '$totalImports' },
        totalJobsImported: { $sum: '$totalJobsImported' },
        averageResponseTime: { $avg: '$health.averageResponseTime' }
      }
    }
  ]);
};

// Instance methods
jobSourceSchema.methods.updateHealth = function(success, responseTime, error = null) {
  this.health.connectionCount += 1;
  this.health.totalResponseTime += responseTime || 0;
  this.health.averageResponseTime = this.health.totalResponseTime / this.health.connectionCount;

  if (success) {
    this.health.lastSuccessfulConnection = new Date();
    this.health.consecutiveFailures = 0;
    if (this.health.lastError) {
      delete this.health.lastError;
    }
  } else {
    this.health.lastFailure = new Date();
    this.health.consecutiveFailures += 1;
    if (error) {
      this.health.lastError = {
        message: error.message,
        code: error.code || 'UNKNOWN',
        timestamp: new Date()
      };
    }
  }

  return this.save();
};

jobSourceSchema.methods.incrementImportStats = function(jobCount) {
  this.lastImportAt = new Date();
  this.totalImports += 1;
  this.totalJobsImported += jobCount;
  return this.save();
};

jobSourceSchema.methods.testConnection = async function() {
  const axios = require('axios');
  const startTime = Date.now();

  try {
    const headers = { ...this.headers };

    // Add authentication
    if (this.auth.type === 'bearer' && this.auth.token) {
      headers['Authorization'] = `Bearer ${this.auth.token}`;
    } else if (this.auth.type === 'apikey' && this.apiKey) {
      headers[this.auth.apiKeyHeader] = this.apiKey;
    } else if (this.auth.type === 'basic' && this.auth.username && this.auth.password) {
      const auth = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await axios.get(this.url, {
      headers,
      timeout: this.settings.timeout,
      maxRedirects: 5
    });

    const responseTime = Date.now() - startTime;
    await this.updateHealth(true, responseTime);

    return {
      success: true,
      responseTime,
      statusCode: response.status,
      contentType: response.headers['content-type']
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    await this.updateHealth(false, responseTime, error);

    return {
      success: false,
      responseTime,
      error: error.message,
      statusCode: error.response?.status
    };
  }
};

jobSourceSchema.methods.getAuthHeaders = function() {
  const headers = { ...this.headers };

  switch (this.auth.type) {
    case 'bearer':
      if (this.auth.token) {
        headers['Authorization'] = `Bearer ${this.auth.token}`;
      }
      break;
    case 'apikey':
      if (this.apiKey) {
        headers[this.auth.apiKeyHeader] = this.apiKey;
      }
      break;
    case 'basic':
      if (this.auth.username && this.auth.password) {
        const auth = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }
      break;
  }

  return headers;
};

jobSourceSchema.methods.toAPIResponse = function() {
  return {
    id: this._id,
    name: this.name,
    url: this.url,
    format: this.format,
    isActive: this.isActive,
    lastImportAt: this.lastImportAt,
    nextScheduledImport: this.nextScheduledImport,
    isOverdueForImport: this.isOverdueForImport,
    totalImports: this.totalImports,
    totalJobsImported: this.totalJobsImported,
    averageJobsPerImport: this.averageJobsPerImport,
    settings: this.settings,
    isHealthy: this.isHealthy,
    health: {
      lastSuccessfulConnection: this.health.lastSuccessfulConnection,
      lastFailure: this.health.lastFailure,
      consecutiveFailures: this.health.consecutiveFailures,
      averageResponseTime: this.health.averageResponseTime,
      lastError: this.health.lastError
    }
  };
};

module.exports = mongoose.model('JobSource', jobSourceSchema);