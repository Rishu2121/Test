const { Worker } = require('bullmq');
const redisConnection = require('../src/config/redis');
const Job = require('../src/models/Job');
const ImportHistory = require('../src/models/ImportHistory');
const JobSource = require('../src/models/JobSource');
const jobSourceService = require('../src/services/jobSourceService');
const loggingService = require('../src/services/loggingService');
const winston = require('winston');

class JobProcessor {
  constructor() {
    this.worker = null;
    this.connectionOptions = redisConnection.getConnectionOptions();
    this.concurrency = process.env.WORKER_CONCURRENCY || 5;
  }

  async initialize() {
    try {
      // Initialize the worker for job processing
      this.worker = new Worker(
        'job-processing',
        this.processJob.bind(this),
        {
          connection: this.connectionOptions.connection,
          concurrency: this.concurrency,
          removeOnComplete: 10,
          removeOnFail: 5
        }
      );

      // Set up event listeners
      this.setupEventListeners();

      // Initialize import processing worker
      await this.initializeImportWorker();

      winston.info(`Job processor initialized with concurrency: ${this.concurrency}`);
      return true;

    } catch (error) {
      winston.error('Failed to initialize job processor:', error);
      throw error;
    }
  }

  async initializeImportWorker() {
    const importWorker = new Worker(
      'import-scheduling',
      this.processImport.bind(this),
      {
        connection: this.connectionOptions.connection,
        concurrency: 2, // Lower concurrency for import scheduling
        removeOnComplete: 5,
        removeOnFail: 5
      }
    );

    importWorker.on('completed', (job) => {
      winston.info(`Import job completed:`, { jobId: job.id, importId: job.data.importId });
    });

    importWorker.on('failed', (job, err) => {
      winston.error(`Import job failed:`, {
        jobId: job?.id,
        importId: job?.data?.importId,
        error: err.message
      });
    });

    return importWorker;
  }

  setupEventListeners() {
    this.worker.on('completed', (job, result) => {
      winston.info('Job processing completed:', {
        jobId: job.id,
        result,
        processingTime: Date.now() - job.timestamp
      });
    });

    this.worker.on('failed', (job, err) => {
      winston.error('Job processing failed:', {
        jobId: job?.id,
        error: err.message,
        stack: err.stack,
        attemptsMade: job?.attemptsMade
      });
    });

    this.worker.on('error', (err) => {
      winston.error('Worker error:', { error: err.message });
    });

    this.worker.on('stalled', (job) => {
      winston.warn('Job stalled:', { jobId: job.id });
    });
  }

  // Process import scheduling jobs
  async processImport(job) {
    const { sourceId, importId, sourceConfig, options } = job.data;
    const startTime = Date.now();

    try {
      winston.info(`Starting import processing for source: ${sourceConfig.name}`);

      // Get source configuration
      const source = await JobSource.findById(sourceId);
      if (!source) {
        throw new Error(`Job source not found: ${sourceId}`);
      }

      // Fetch jobs from source
      const fetchResult = await jobSourceService.fetchFromSource(source, options);

      if (!fetchResult.success || fetchResult.jobs.length === 0) {
        // Complete import session with no jobs
        await loggingService.completeImportSession(importId, {
          jobsPerSecond: 0,
          averageProcessingTime: 0,
          batchCount: 0,
          sourceStats: fetchResult.metadata
        });

        return {
          success: true,
          source: source.name,
          jobsProcessed: 0,
          message: 'No jobs found to process'
        };
      }

      // Add jobs to processing queue in batches
      const queueService = require('../src/services/queueService');
      const batchResult = await queueService.addJobsToQueue(
        fetchResult.jobs,
        sourceId,
        importId,
        {
          batchSize: source.settings?.batchSize || 100,
          priority: options.priority || 'normal',
          configuration: options.configuration
        }
      );

      winston.info(`Added ${batchResult.totalJobs} jobs to processing queue for ${source.name}`);

      return {
        success: true,
        source: source.name,
        totalJobs: batchResult.totalJobs,
        totalBatches: batchResult.totalBatches,
        processingTime: Date.now() - startTime,
        queueStatus: batchResult
      };

    } catch (error) {
      winston.error(`Import processing failed for source ${sourceConfig?.name}:`, error);

      // Mark import session as failed
      await loggingService.failImportSession(importId, error, {
        sourceId,
        sourceName: sourceConfig?.name,
        processingTime: Date.now() - startTime
      });

      throw error;
    }
  }

  // Process individual job batches
  async processJob(job) {
    const { jobs, sourceId, importId, batch, totalBatches, configuration } = job.data;
    const startTime = Date.now();
    let batchResults = { new: 0, updated: 0, duplicate: 0, failed: 0 };

    try {
      winston.info(`Processing batch ${batch}/${totalBatches} with ${jobs.length} jobs`);

      const processingPromises = jobs.map(jobData =>
        this.processIndividualJob(jobData, sourceId, importId)
      );

      const results = await Promise.allSettled(processingPromises);

      // Aggregate batch results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          switch (result.value.action) {
            case 'created':
              batchResults.new++;
              break;
            case 'updated':
              batchResults.updated++;
              break;
            case 'duplicate':
              batchResults.duplicate++;
              break;
            case 'failed':
              batchResults.failed++;
              break;
          }
        } else {
          batchResults.failed++;
          winston.error('Individual job processing failed:', {
            error: result.reason.message
          });
        }
      }

      const processingTime = Date.now() - startTime;

      // Log batch completion
      await loggingService.logImportBatch(importId, {
        batchNumber: batch,
        totalBatches,
        jobCount: jobs.length,
        processingTime,
        results: batchResults
      });

      // Update performance metrics
      await loggingService.logPerformanceMetrics(importId, {
        jobsPerSecond: (jobs.length / (processingTime / 1000)).toFixed(2),
        batchProcessingTime: processingTime,
        batchSize: jobs.length
      });

      winston.info(`Batch ${batch} completed:`, {
        processed: jobs.length,
        new: batchResults.new,
        updated: batchResults.updated,
        duplicate: batchResults.duplicate,
        failed: batchResults.failed,
        processingTime
      });

      return {
        success: true,
        batch,
        results: batchResults,
        processingTime,
        jobsProcessed: jobs.length
      };

    } catch (error) {
      winston.error(`Batch ${batch} processing failed:`, error);
      throw error;
    }
  }

  // Process individual job
  async processIndividualJob(jobData, sourceId, importId) {
    try {
      // Check if job already exists (deduplication)
      const existingJob = await Job.findOne({
        externalId: jobData.externalId,
        source: jobData.source
      });

      if (existingJob) {
        // Check if job needs updating
        const needsUpdate = this.jobNeedsUpdate(existingJob, jobData);
        if (needsUpdate) {
          await existingJob.updateFromSource(jobData);
          await loggingService.updateImportStats(importId, 'updated', existingJob._id);
          return { action: 'updated', jobId: existingJob._id };
        } else {
          await loggingService.updateImportStats(importId, 'duplicate', existingJob._id);
          return { action: 'duplicate', jobId: existingJob._id };
        }
      } else {
        // Create new job
        const newJob = new Job({
          ...jobData,
          importedAt: new Date(),
          isActive: true
        });

        await newJob.save();
        await loggingService.updateImportStats(importId, 'new', newJob._id);
        return { action: 'created', jobId: newJob._id };
      }

    } catch (error) {
      // Log individual job failure
      await loggingService.logImportError(importId, jobData.externalId, error, {
        sourceId,
        jobData
      });
      return { action: 'failed', error: error.message };
    }
  }

  // Check if job needs updating
  jobNeedsUpdate(existingJob, newJobData) {
    // Always update if new job is more recent
    if (newJobData.postedAt && existingJob.postedAt) {
      if (new Date(newJobData.postedAt) > new Date(existingJob.postedAt)) {
        return true;
      }
    }

    // Check for significant changes in key fields
    const significantFields = ['title', 'description', 'salary', 'location', 'applicationUrl'];

    for (const field of significantFields) {
      if (newJobData[field] !== undefined) {
        const existingValue = existingJob[field];
        const newValue = newJobData[field];

        // Handle nested objects (like salary)
        if (typeof newValue === 'object' && newValue !== null) {
          if (JSON.stringify(existingValue) !== JSON.stringify(newValue)) {
            return true;
          }
        } else if (existingValue !== newValue) {
          return true;
        }
      }
    }

    return false;
  }

  // Graceful shutdown
  async close() {
    try {
      if (this.worker) {
        await this.worker.close();
        winston.info('Job processor closed successfully');
      }
    } catch (error) {
      winston.error('Error closing job processor:', error);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const redisConnected = await redisConnection.isConnected();
      const isRunning = this.worker && this.worker.running;

      return {
        healthy: redisConnected && isRunning,
        redisConnected,
        workerRunning: isRunning,
        concurrency: this.concurrency,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new JobProcessor();