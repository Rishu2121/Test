const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  externalId: {
    type: String,
    required: true,
    index: true
  },
  source: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  company: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  location: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 10000
  },
  salary: {
    min: {
      type: Number,
      min: 0
    },
    max: {
      type: Number,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      maxlength: 3
    }
  },
  jobType: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote'],
    default: 'full-time'
  },
  category: {
    type: String,
    trim: true,
    maxlength: 100
  },
  requirements: [{
    type: String,
    trim: true,
    maxlength: 500
  }],
  applicationUrl: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  postedAt: {
    type: Date,
    required: true
  },
  expiresAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  importedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'jobs'
});

// Compound indexes for better query performance
jobSchema.index({ externalId: 1, source: 1 }, { unique: true });
jobSchema.index({ source: 1, postedAt: -1 });
jobSchema.index({ company: 1, location: 1 });
jobSchema.index({ category: 1, isActive: 1 });
jobSchema.index({ jobType: 1, isActive: 1 });
jobSchema.index({ postedAt: -1, isActive: 1 });

// Pre-save middleware to update timestamps
jobSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Pre-update middleware to update timestamps
jobSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Static methods
jobSchema.statics.findBySource = function(source, options = {}) {
  const query = { source };
  if (options.activeOnly) {
    query.isActive = true;
  }
  return this.find(query)
    .sort({ postedAt: -1 })
    .limit(options.limit || 100);
};

jobSchema.statics.findByCompany = function(company, options = {}) {
  const query = { company: new RegExp(company, 'i') };
  if (options.activeOnly) {
    query.isActive = true;
  }
  return this.find(query)
    .sort({ postedAt: -1 })
    .limit(options.limit || 50);
};

jobSchema.statics.searchJobs = function(searchTerm, options = {}) {
  const query = {
    $or: [
      { title: new RegExp(searchTerm, 'i') },
      { company: new RegExp(searchTerm, 'i') },
      { description: new RegExp(searchTerm, 'i') },
      { location: new RegExp(searchTerm, 'i') }
    ]
  };

  if (options.activeOnly) {
    query.isActive = true;
  }

  if (options.jobType) {
    query.jobType = options.jobType;
  }

  if (options.category) {
    query.category = new RegExp(options.category, 'i');
  }

  return this.find(query)
    .sort({ postedAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

jobSchema.statics.getStatsBySource = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$source',
        totalJobs: { $sum: 1 },
        activeJobs: {
          $sum: { $cond: ['$isActive', 1, 0] }
        },
        avgSalaryMin: { $avg: '$salary.min' },
        avgSalaryMax: { $avg: '$salary.max' }
      }
    },
    {
      $sort: { totalJobs: -1 }
    }
  ]);
};

// Instance methods
jobSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

jobSchema.methods.updateFromSource = function(newData) {
  const updatableFields = [
    'title', 'company', 'location', 'description', 'salary',
    'jobType', 'category', 'requirements', 'applicationUrl',
    'postedAt', 'expiresAt', 'metadata'
  ];

  updatableFields.forEach(field => {
    if (newData[field] !== undefined) {
      this[field] = newData[field];
    }
  });

  return this.save();
};

jobSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Virtuals
jobSchema.virtual('daysSincePosted').get(function() {
  const now = new Date();
  const postedDate = new Date(this.postedAt);
  const diffTime = Math.abs(now - postedDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

jobSchema.virtual('hasSalary').get(function() {
  return this.salary && (this.salary.min > 0 || this.salary.max > 0);
});

jobSchema.virtual('salaryRange').get(function() {
  if (!this.hasSalary) return null;

  const parts = [];
  if (this.salary.min > 0) parts.push(`$${this.salary.min.toLocaleString()}`);
  if (this.salary.max > 0) parts.push(`$${this.salary.max.toLocaleString()}`);

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] + ` ${this.salary.currency}`;

  return `${parts.join(' - ')} ${this.salary.currency}`;
});

// Transform method for API responses
jobSchema.methods.toAPIResponse = function() {
  return {
    id: this._id,
    externalId: this.externalId,
    source: this.source,
    title: this.title,
    company: this.company,
    location: this.location,
    description: this.description,
    salary: this.hasSalary ? this.salaryRange : null,
    jobType: this.jobType,
    category: this.category,
    requirements: this.requirements,
    applicationUrl: this.applicationUrl,
    postedAt: this.postedAt,
    expiresAt: this.expiresAt,
    isActive: this.isActive,
    daysSincePosted: this.daysSincePosted,
    importedAt: this.importedAt,
    metadata: this.metadata
  };
};

module.exports = mongoose.model('Job', jobSchema);