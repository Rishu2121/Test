const { Queue, Worker, QueueEvents } = require('bullmq');
const redisConnection = require('../config/redis');
const winston = require('winston');

class QueueService {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();
    this.connectionOptions = redisConnection.getConnectionOptions();
    this.defaultJobOptions = {
      removeOnComplete: 100,    // Keep last 100 completed jobs
      removeOnFail: 50,         // Keep last 50 failed jobs
      attempts: 3,              // Retry failed jobs 3 times
      backoff: {
        type: 'exponential',
        delay: 2000            // Start with 2 seconds
      }
    };
  }

  // Initialize all required queues
  async initializeQueues() {
    try {
      await this.createQueue('job-processing', {
        defaultJobOptions: {
          ...this.defaultJobOptions,
          concurrency: 5
        }
      });

      await this.createQueue('import-scheduling', {
        defaultJobOptions: {
          ...this.defaultJobOptions,
          delay: 1000,           // 1 second default delay for scheduled jobs
          repeat: {
            every: 21600000      // 6 hours repeat interval
          }
        }
      });

      await this.createQueue('cleanup-tasks', {
        defaultJobOptions: {
          ...this.defaultJobOptions,
          delay: 86400000        // 24 hours delay for cleanup tasks
        }
      });

      winston.info('All queues initialized successfully');
      return true;

    } catch (error) {
      winston.error('Failed to initialize queues:', error);
      throw error;
    }
  }

  // Create a new queue with custom configuration
  async createQueue(queueName, options = {}) {
    try {
      if (this.queues.has(queueName)) {
        winston.warn(`Queue ${queueName} already exists`);
        return this.queues.get(queueName);
      }

      const queue = new Queue(queueName, {
        connection: this.connectionOptions.connection,
        defaultJobOptions: {
          ...this.defaultJobOptions,
          ...options.defaultJobOptions
        },
        ...options
      });

      // Set up queue event listeners
      await this.setupQueueEvents(queueName);

      this.queues.set(queueName, queue);

      winston.info(`Queue ${queueName} created successfully`);
      return queue;

    } catch (error) {
      winston.error(`Failed to create queue ${queueName}:`, error);
      throw error;
    }
  }

  // Add jobs to the job-processing queue
  async addJobsToQueue(jobs, sourceId, importId, options = {}) {
    try {
      const queue = this.getQueue('job-processing');
      if (!queue) {
        throw new Error('Job processing queue not initialized');
      }

      const batchSize = options.batchSize || 100;
      const jobData = {
        sourceId,
        importId,
        timestamp: new Date().toISOString(),
        configuration: options.configuration || {}
      };

      // Process jobs in batches
      const batches = [];
      for (let i = 0; i < jobs.length; i += batchSize) {
        const batch = jobs.slice(i, i + batchSize);
        batches.push(batch);
      }

      const addedJobs = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchJobData = {
          ...jobData,
          batch: i + 1,
          totalBatches: batches.length,
          jobs: batch
        };

        // Determine job priority based on options
        const priority = options.priority || 'normal';
        const jobPriority = this.getJobPriority(priority);

        const job = await queue.add('process-job-batch', batchJobData, {
          priority: jobPriority,
          delay: options.delay || 0,
          removeOnComplete: 10,
          removeOnFail: 5
        });

        addedJobs.push({
          id: job.id,
          batch: i + 1,
          jobCount: batch.length
        });

        winston.info(`Added batch ${i + 1}/${batches.length} to queue: ${batch.length} jobs`);
      }

      winston.info(`Added ${addedJobs.length} batches (${jobs.length} total jobs) to job-processing queue`);

      return {
        success: true,
        totalJobs: jobs.length,
        totalBatches: batches.length,
        addedBatches: addedJobs,
        queueName: 'job-processing'
      };

    } catch (error) {
      winston.error('Failed to add jobs to queue:', error);
      throw error;
    }
  }

  // Add a single job to any queue
  async addJob(queueName, jobType, jobData, options = {}) {
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const job = await queue.add(jobType, jobData, {
        priority: this.getJobPriority(options.priority || 'normal'),
        delay: options.delay || 0,
        removeOnComplete: options.removeOnComplete || 10,
        removeOnFail: options.removeOnFail || 5,
        ...options
      });

      winston.info(`Added job ${job.id} to ${queueName} queue`);

      return {
        success: true,
        jobId: job.id,
        queueName,
        jobType
      };

    } catch (error) {
      winston.error(`Failed to add job to ${queueName}:`, error);
      throw error;
    }
  }

  // Schedule a delayed import job
  async scheduleDelayedImport(sourceId, delay, importId = null) {
    try {
      const jobData = {
        sourceId,
        importId,
        scheduledAt: new Date().toISOString(),
        type: 'scheduled-import'
      };

      return await this.addJob('import-scheduling', 'scheduled-import', jobData, {
        delay,
        priority: 'low'
      });

    } catch (error) {
      winston.error('Failed to schedule delayed import:', error);
      throw error;
    }
  }

  // Get queue by name
  getQueue(queueName) {
    return this.queues.get(queueName);
  }

  // Get all queue names
  getQueueNames() {
    return Array.from(this.queues.keys());
  }

  // Get queue status and statistics
  async getQueueStatus(queueName) {
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed()
      ]);

      const counts = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length
      };

      // Get queue configuration
      const queueConfig = {
        name: queueName,
        defaultJobOptions: queue.defaultJobOptions,
        connectionOptions: queue.opts.connection
      };

      // Get recent job samples
      const recentJobs = {
        active: active.slice(0, 5),
        completed: completed.slice(0, 5),
        failed: failed.slice(0, 5)
      };

      return {
        name: queueName,
        counts,
        config: queueConfig,
        recentJobs,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      winston.error(`Failed to get queue status for ${queueName}:`, error);
      throw error;
    }
  }

  // Get status for all queues
  async getAllQueuesStatus() {
    const queueNames = this.getQueueNames();
    const statuses = {};

    for (const queueName of queueNames) {
      try {
        statuses[queueName] = await this.getQueueStatus(queueName);
      } catch (error) {
        statuses[queueName] = {
          name: queueName,
          error: error.message,
          status: 'error'
        };
      }
    }

    return {
      queues: statuses,
      totalQueues: queueNames.length,
      timestamp: new Date().toISOString()
    };
  }

  // Queue control operations
  async pauseQueue(queueName) {
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      await queue.pause();
      winston.info(`Queue ${queueName} paused successfully`);

      return { success: true, queueName, status: 'paused' };

    } catch (error) {
      winston.error(`Failed to pause queue ${queueName}:`, error);
      throw error;
    }
  }

  async resumeQueue(queueName) {
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      await queue.resume();
      winston.info(`Queue ${queueName} resumed successfully`);

      return { success: true, queueName, status: 'resumed' };

    } catch (error) {
      winston.error(`Failed to resume queue ${queueName}:`, error);
      throw error;
    }
  }

  async clearQueue(queueName, options = {}) {
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const clearOptions = {
        count: options.count || 0, // 0 = all jobs
        queueState: options.queueState || 'all' // 'waiting', 'active', 'completed', 'failed', 'delayed', 'all'
      };

      await queue.clear(clearOptions);
      winston.info(`Queue ${queueName} cleared successfully`);

      return { success: true, queueName, cleared: clearOptions };

    } catch (error) {
      winston.error(`Failed to clear queue ${queueName}:`, error);
      throw error;
    }
  }

  // Worker management
  async createWorker(queueName, processor, options = {}) {
    try {
      if (this.workers.has(queueName)) {
        winston.warn(`Worker for queue ${queueName} already exists`);
        return this.workers.get(queueName);
      }

      const worker = new Worker(queueName, processor, {
        connection: this.connectionOptions.connection,
        concurrency: options.concurrency || 5,
        ...options
      });

      // Set up worker event listeners
      this.setupWorkerEvents(queueName, worker);

      this.workers.set(queueName, worker);

      winston.info(`Worker created for queue ${queueName}`);
      return worker;

    } catch (error) {
      winston.error(`Failed to create worker for ${queueName}:`, error);
      throw error;
    }
  }

  async closeWorker(queueName) {
    try {
      const worker = this.workers.get(queueName);
      if (!worker) {
        winston.warn(`No worker found for queue ${queueName}`);
        return { success: true, message: 'No worker to close' };
      }

      await worker.close();
      this.workers.delete(queueName);

      winston.info(`Worker closed for queue ${queueName}`);
      return { success: true, queueName };

    } catch (error) {
      winston.error(`Failed to close worker for ${queueName}:`, error);
      throw error;
    }
  }

  // Close all queues and workers
  async closeAll() {
    try {
      const closePromises = [];

      // Close all workers
      for (const [queueName, worker] of this.workers) {
        closePromises.push(
          worker.close()
            .then(() => winston.info(`Worker closed for ${queueName}`))
            .catch(error => winston.error(`Failed to close worker for ${queueName}:`, error))
        );
      }

      // Close all queues
      for (const [queueName, queue] of this.queues) {
        closePromises.push(
          queue.close()
            .then(() => winston.info(`Queue ${queueName} closed`))
            .catch(error => winston.error(`Failed to close queue ${queueName}:`, error))
        );
      }

      await Promise.all(closePromises);

      this.workers.clear();
      this.queues.clear();
      this.queueEvents.clear();

      winston.info('All queues and workers closed successfully');

    } catch (error) {
      winston.error('Error closing queues and workers:', error);
      throw error;
    }
  }

  // Utility methods
  getJobPriority(priority) {
    const priorities = {
      low: 1,
      normal: 5,
      high: 10,
      critical: 15
    };
    return priorities[priority] || priorities.normal;
  }

  // Set up queue event listeners
  async setupQueueEvents(queueName) {
    const queueEvents = new QueueEvents(queueName, {
      connection: this.connectionOptions.connection
    });

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      winston.info(`Job completed in ${queueName}:`, { jobId, result: returnvalue });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      winston.error(`Job failed in ${queueName}:`, { jobId, reason: failedReason });
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      winston.debug(`Job progress in ${queueName}:`, { jobId, progress: data });
    });

    this.queueEvents.set(queueName, queueEvents);
  }

  // Set up worker event listeners
  setupWorkerEvents(queueName, worker) {
    worker.on('completed', (job) => {
      winston.info(`Worker completed job:`, { queueName, jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      winston.error(`Worker failed job:`, {
        queueName,
        jobId: job?.id,
        error: err.message,
        attemptsMade: job?.attemptsMade
      });
    });

    worker.on('error', (err) => {
      winston.error(`Worker error:`, { queueName, error: err.message });
    });

    worker.on('stalled', (job) => {
      winston.warn(`Worker stalled job:`, { queueName, jobId: job.id });
    });
  }

  // Health check
  async healthCheck() {
    try {
      const redisConnected = await redisConnection.isConnected();
      const queueStatuses = await this.getAllQueuesStatus();

      const isHealthy = redisConnected && this.queues.size > 0;

      return {
        healthy: isHealthy,
        redisConnected,
        queueCount: this.queues.size,
        workerCount: this.workers.size,
        queues: queueStatuses,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      winston.error('Queue health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new QueueService();