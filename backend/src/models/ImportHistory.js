const mongoose = require('mongoose');

const importHistorySchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed', 'cancelled'],
    default: 'running',
    index: true
  },
  startedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  completedAt: {
    type: Date
  },
  duration: {
    type: Number // milliseconds
  },
  totalJobs: {
    type: Number,
    default: 0,
    min: 0
  },
  newJobs: {
    type: Number,
    default: 0,
    min: 0
  },
  updatedJobs: {
    type: Number,
    default: 0,
    min: 0
  },
  duplicateJobs: {
    type: Number,
    default: 0,
    min: 0
  },
  failedJobs: {
    type: Number,
    default: 0,
    min: 0
  },
  errors: [{
    jobId: String,
    externalId: String,
    error: {
      message: String,
      stack: String
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    context: mongoose.Schema.Types.Mixed
  }],
  configuration: {
    batchSize: {
      type: Number,
      default: 100,
      min: 1
    },
    concurrency: {
      type: Number,
      default: 5,
      min: 1
    },
    filters: mongoose.Schema.Types.Mixed,
    retryAttempts: {
      type: Number,
      default: 3,
      min: 0
    }
  },
  triggeredBy: {
    type: String,
    enum: ['manual', 'scheduled', 'api'],
    default: 'manual'
  },
  triggeredByUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  logs: [{
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'debug'],
      default: 'info'
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: mongoose.Schema.Types.Mixed
  }],
  processingStats: {
    jobsPerSecond: Number,
    averageProcessingTime: Number, // milliseconds per job
    peakMemoryUsage: Number, // bytes
    queuedJobs: Number,
    processedJobs: Number
  }
}, {
  timestamps: true,
  collection: 'import_history'
});

// Indexes for better query performance
importHistorySchema.index({ source: 1, startedAt: -1 });
importHistorySchema.index({ status: 1, startedAt: -1 });
importHistorySchema.index({ triggeredBy: 1, startedAt: -1 });
importHistorySchema.index({ startedAt: -1 });

// Pre-save middleware to calculate duration
importHistorySchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
    this.duration = this.completedAt - this.startedAt;
  }
  next();
});

// Virtuals
importHistorySchema.virtual('isRunning').get(function() {
  return this.status === 'running';
});

importHistorySchema.virtual('successRate').get(function() {
  if (this.totalJobs === 0) return 0;
  return ((this.newJobs + this.updatedJobs) / this.totalJobs * 100).toFixed(2);
});

importHistorySchema.virtual('failureRate').get(function() {
  if (this.totalJobs === 0) return 0;
  return (this.failedJobs / this.totalJobs * 100).toFixed(2);
});

importHistorySchema.virtual('durationFormatted').get(function() {
  if (!this.duration) return null;

  const seconds = Math.floor(this.duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
});

// Static methods
importHistorySchema.statics.findByStatus = function(status, limit = 50) {
  return this.find({ status })
    .sort({ startedAt: -1 })
    .limit(limit)
    .populate('triggeredByUser', 'username email');
};

importHistorySchema.statics.findBySource = function(source, limit = 50) {
  return this.find({ source })
    .sort({ startedAt: -1 })
    .limit(limit);
};

importHistorySchema.statics.findRunningImports = function() {
  return this.find({ status: 'running' })
    .sort({ startedAt: -1 });
};

importHistorySchema.statics.getStatsBySource = function(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.aggregate([
    { $match: { startedAt: { $gte: since } } },
    {
      $group: {
        _id: '$source',
        totalImports: { $sum: 1 },
        successfulImports: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        totalJobsProcessed: { $sum: '$totalJobs' },
        totalNewJobs: { $sum: '$newJobs' },
        totalUpdatedJobs: { $sum: '$updatedJobs' },
        averageDuration: { $avg: '$duration' },
        lastImport: { $max: '$startedAt' }
      }
    },
    {
      $sort: { totalJobsProcessed: -1 }
    }
  ]);
};

importHistorySchema.statics.getImportTrends = function(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.aggregate([
    { $match: { startedAt: { $gte: since } } },
    {
      $group: {
        _id: {
          year: { $year: '$startedAt' },
          month: { $month: '$startedAt' },
          day: { $dayOfMonth: '$startedAt' }
        },
        totalImports: { $sum: 1 },
        totalJobs: { $sum: '$totalJobs' },
        successfulImports: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

// Instance methods
importHistorySchema.methods.addLog = function(level, message, metadata = {}) {
  this.logs.push({
    level,
    message,
    timestamp: new Date(),
    metadata
  });
  return this.save();
};

importHistorySchema.methods.addError = function(error, context = {}) {
  const errorEntry = {
    jobId: context.jobId,
    externalId: context.externalId,
    error: {
      message: error.message,
      stack: error.stack
    },
    timestamp: new Date(),
    context
  };

  this.errors.push(errorEntry);
  this.failedJobs += 1;
  return this.save();
};

importHistorySchema.methods.markAsCompleted = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  this.duration = this.completedAt - this.startedAt;
  return this.save();
};

importHistorySchema.methods.markAsFailed = function() {
  this.status = 'failed';
  this.completedAt = new Date();
  this.duration = this.completedAt - this.startedAt;
  return this.save();
};

importHistorySchema.methods.markAsCancelled = function() {
  this.status = 'cancelled';
  this.completedAt = new Date();
  this.duration = this.completedAt - this.startedAt;
  return this.save();
};

importHistorySchema.methods.updateStats = function(action) {
  this.totalJobs += 1;

  switch (action) {
    case 'new':
      this.newJobs += 1;
      break;
    case 'updated':
      this.updatedJobs += 1;
      break;
    case 'duplicate':
      this.duplicateJobs += 1;
      break;
    case 'failed':
      this.failedJobs += 1;
      break;
  }

  return this.save();
};

importHistorySchema.methods.updateProcessingStats = function(stats) {
  this.processingStats = {
    ...this.processingStats,
    ...stats
  };
  return this.save();
};

// Transform method for API responses
importHistorySchema.methods.toAPIResponse = function() {
  return {
    id: this._id,
    source: this.source,
    status: this.status,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    duration: this.duration,
    durationFormatted: this.durationFormatted,
    totalJobs: this.totalJobs,
    newJobs: this.newJobs,
    updatedJobs: this.updatedJobs,
    duplicateJobs: this.duplicateJobs,
    failedJobs: this.failedJobs,
    successRate: parseFloat(this.successRate),
    failureRate: parseFloat(this.failureRate),
    errorCount: this.errors.length,
    configuration: this.configuration,
    triggeredBy: this.triggeredBy,
    processingStats: this.processingStats,
    isRunning: this.isRunning
  };
};

module.exports = mongoose.model('ImportHistory', importHistorySchema);