// MongoDB initialization script
// This script runs when the MongoDB container first starts

// Switch to the job-importer database
db = db.getSiblingDB('job-importer');

// Create collections with indexes
print('Creating collections and indexes...');

// Jobs collection
db.createCollection('jobs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['externalId', 'source', 'title', 'company', 'location', 'description', 'postedAt'],
      properties: {
        externalId: { bsonType: 'string' },
        source: { bsonType: 'string' },
        title: { bsonType: 'string' },
        company: { bsonType: 'string' },
        location: { bsonType: 'string' },
        description: { bsonType: 'string' },
        salary: {
          bsonType: 'object',
          properties: {
            min: { bsonType: 'number', minimum: 0 },
            max: { bsonType: 'number', minimum: 0 },
            currency: { bsonType: 'string' }
          }
        },
        jobType: { enum: ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote'] },
        category: { bsonType: 'string' },
        requirements: { bsonType: 'array', items: { bsonType: 'string' } },
        applicationUrl: { bsonType: 'string' },
        postedAt: { bsonType: 'date' },
        expiresAt: { bsonType: 'date' },
        isActive: { bsonType: 'bool' },
        importedAt: { bsonType: 'date' },
        metadata: { bsonType: 'object' }
      }
    }
  }
});

// Create indexes for jobs collection
db.jobs.createIndex({ externalId: 1, source: 1 }, { unique: true });
db.jobs.createIndex({ source: 1, postedAt: -1 });
db.jobs.createIndex({ company: 1, location: 1 });
db.jobs.createIndex({ category: 1, isActive: 1 });
db.jobs.createIndex({ jobType: 1, isActive: 1 });
db.jobs.createIndex({ postedAt: -1, isActive: 1 });
db.jobs.createIndex({ isActive: 1 });
db.jobs.createIndex({ importedAt: -1 });

// ImportHistory collection
db.createCollection('import_history', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['source', 'status', 'startedAt'],
      properties: {
        source: { bsonType: 'string' },
        status: { enum: ['running', 'completed', 'failed', 'cancelled'] },
        startedAt: { bsonType: 'date' },
        completedAt: { bsonType: 'date' },
        duration: { bsonType: 'number' },
        totalJobs: { bsonType: 'number', minimum: 0 },
        newJobs: { bsonType: 'number', minimum: 0 },
        updatedJobs: { bsonType: 'number', minimum: 0 },
        duplicateJobs: { bsonType: 'number', minimum: 0 },
        failedJobs: { bsonType: 'number', minimum: 0 },
        configuration: { bsonType: 'object' },
        triggeredBy: { enum: ['manual', 'scheduled', 'api'] },
        logs: { bsonType: 'array' },
        processingStats: { bsonType: 'object' }
      }
    }
  }
});

// Create indexes for import_history collection
db.import_history.createIndex({ source: 1, startedAt: -1 });
db.import_history.createIndex({ status: 1, startedAt: -1 });
db.import_history.createIndex({ triggeredBy: 1, startedAt: -1 });
db.import_history.createIndex({ startedAt: -1 });

// JobSources collection
db.createCollection('job_sources', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'url', 'format'],
      properties: {
        name: { bsonType: 'string' },
        url: { bsonType: 'string' },
        apiKey: { bsonType: 'string' },
        format: { enum: ['xml', 'json', 'rss'] },
        isActive: { bsonType: 'bool' },
        lastImportAt: { bsonType: 'date' },
        totalImports: { bsonType: 'number', minimum: 0 },
        totalJobsImported: { bsonType: 'number', minimum: 0 },
        settings: { bsonType: 'object' },
        fieldMapping: { bsonType: 'object' },
        fieldDefaults: { bsonType: 'object' },
        jsonConfig: { bsonType: 'object' },
        xmlConfig: { bsonType: 'object' },
        headers: { bsonType: 'object' },
        auth: { bsonType: 'object' },
        validationRules: { bsonType: 'object' },
        health: { bsonType: 'object' }
      }
    }
  }
});

// Create indexes for job_sources collection
db.job_sources.createIndex({ name: 1 }, { unique: true });
db.job_sources.createIndex({ isActive: 1, lastImportAt: -1 });
db.job_sources.createIndex({ format: 1, isActive: 1 });

// Insert sample job source for testing
print('Inserting sample job source...');
db.job_sources.insertOne({
  name: 'example-jobs-api',
  url: 'https://example.com/api/jobs',
  format: 'json',
  isActive: false, // Disabled by default
  totalImports: 0,
  totalJobsImported: 0,
  settings: {
    fetchInterval: 6, // hours
    batchSize: 100,
    concurrency: 3,
    timeout: 30000, // 30 seconds
    retryAttempts: 3
  },
  fieldMapping: {
    id: 'id',
    title: 'title',
    company: 'company',
    location: 'location',
    description: 'description',
    salary: 'salary',
    jobType: 'type',
    category: 'category',
    requirements: 'requirements',
    applicationUrl: 'apply_url',
    postedAt: 'posted_date'
  },
  fieldDefaults: {
    jobType: 'full-time',
    currency: 'USD'
  },
  auth: {
    type: 'none'
  },
  health: {
    consecutiveFailures: 0,
    connectionCount: 0,
    totalResponseTime: 0
  }
});

// Create users collection for admin authentication (optional)
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['username', 'email', 'role'],
      properties: {
        username: { bsonType: 'string' },
        email: { bsonType: 'string' },
        password: { bsonType: 'string' }, // Will be hashed
        role: { enum: ['admin', 'user'] },
        isActive: { bsonType: 'bool' },
        createdAt: { bsonType: 'date' },
        lastLogin: { bsonType: 'date' }
      }
    }
  }
});

// Create indexes for users collection
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });

// Insert default admin user (password: admin123)
// In production, change this password or create users through the API
print('Creating default admin user...');
const bcrypt = require('bcrypt');
const hashedPassword = bcrypt.hashSync('admin123', 10);

db.users.insertOne({
  username: 'admin',
  email: 'admin@jobimporter.com',
  password: hashedPassword,
  role: 'admin',
  isActive: true,
  createdAt: new Date()
});

print('MongoDB initialization completed successfully!');
print('Database: job-importer');
print('Default admin user: admin / admin123');
print('Sample job source: example-jobs-api (inactive)');