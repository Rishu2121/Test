const cron = require('node-cron');
const redisConnection = require('../config/redis');
const queueService = require('./queueService');
const JobSource = require('../models/JobSource');
const ImportHistory = require('../models/ImportHistory');
const winston = require('winston');

class SchedulerService {
  constructor() {
    this.schedulers = new Map();
    this.isRunning = false;
    this.defaultCronPattern = '0 */6 * * *'; // Every 6 hours
    this.distributedLockTimeout = 300000; // 5 minutes
    this.lockRetryInterval = 30000; // 30 seconds
  }

  // Initialize the scheduler service
  async initialize() {
    try {
      await redisConnection.connect();
      winston.info('Scheduler service initialized');
      return true;
    } catch (error) {
      winston.error('Failed to initialize scheduler service:', error);
      throw error;
    }
  }

  // Start all scheduled jobs
  async start() {
    try {
      if (this.isRunning) {
        winston.warn('Scheduler service is already running');
        return { success: true, message: 'Already running' };
      }

      // Start global scheduler for periodic checks
      await this.startGlobalScheduler();

      // Start per-source schedulers
      await this.startSourceSpecificSchedulers();

      this.isRunning = true;
      winston.info('Scheduler service started successfully');

      return {
        success: true,
        message: 'Scheduler service started',
        schedulersActive: this.schedulers.size
      };

    } catch (error) {
      winston.error('Failed to start scheduler service:', error);
      throw error;
    }
  }

  // Stop all scheduled jobs
  async stop() {
    try {
      if (!this.isRunning) {
        winston.warn('Scheduler service is not running');
        return { success: true, message: 'Not running' };
      }

      // Stop all schedulers
      for (const [name, scheduler] of this.schedulers) {
        scheduler.stop();
        winston.info(`Stopped scheduler: ${name}`);
      }

      this.schedulers.clear();
      this.isRunning = false;

      winston.info('Scheduler service stopped successfully');

      return {
        success: true,
        message: 'Scheduler service stopped'
      };

    } catch (error) {
      winston.error('Failed to stop scheduler service:', error);
      throw error;
    }
  }

  // Start global scheduler for periodic import checks
  async startGlobalScheduler() {
    const task = cron.schedule(this.defaultCronPattern, async () => {
      await this.executeWithDistributedLock('global-import-check', async () => {
        await this.checkAndStartOverdueImports();
      });
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    task.start();
    this.schedulers.set('global-import-check', task);

    winston.info('Global import scheduler started');
  }

  // Start per-source schedulers with custom intervals
  async startSourceSpecificSchedulers() {
    try {
      const activeSources = await JobSource.find({ isActive: true });

      for (const source of activeSources) {
        await this.startSourceScheduler(source);
      }

      winston.info(`Started ${activeSources.length} source-specific schedulers`);

    } catch (error) {
      winston.error('Failed to start source-specific schedulers:', error);
      throw error;
    }
  }

  // Start scheduler for a specific source
  async startSourceScheduler(source) {
    try {
      // Stop existing scheduler for this source if it exists
      const existingSchedulerName = `source-${source._id}`;
      if (this.schedulers.has(existingSchedulerName)) {
        this.schedulers.get(existingSchedulerName).stop();
        this.schedulers.delete(existingSchedulerName);
      }

      // Calculate cron pattern based on source settings
      const intervalHours = source.settings?.fetchInterval || 6;
      const cronPattern = this.calculateCronPattern(intervalHours);

      const task = cron.schedule(cronPattern, async () => {
        const lockKey = `source-import-${source._id}`;
        await this.executeWithDistributedLock(lockKey, async () => {
          await this.startImportForSource(source);
        });
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      task.start();
      this.schedulers.set(existingSchedulerName, task);

      winston.info(`Started scheduler for source ${source.name}: ${cronPattern}`);

      return { success: true, sourceName: source.name, pattern: cronPattern };

    } catch (error) {
      winston.error(`Failed to start scheduler for source ${source.name}:`, error);
      throw error;
    }
  }

  // Stop scheduler for a specific source
  async stopSourceScheduler(sourceId) {
    const schedulerName = `source-${sourceId}`;

    if (this.schedulers.has(schedulerName)) {
      this.schedulers.get(schedulerName).stop();
      this.schedulers.delete(schedulerName);

      winston.info(`Stopped scheduler for source: ${sourceId}`);
      return { success: true, sourceId };
    }

    return { success: true, message: 'No scheduler found for source' };
  }

  // Check for overdue imports and start them
  async checkAndStartOverdueImports() {
    try {
      winston.info('Checking for overdue imports...');

      const overdueSources = await JobSource.findOverdueForImport();

      if (overdueSources.length === 0) {
        winston.info('No overdue imports found');
        return { success: true, message: 'No overdue imports', sourcesChecked: 0 };
      }

      winston.info(`Found ${overdueSources.length} overdue sources`);

      const importPromises = overdueSources.map(source =>
        this.startImportForSource(source).catch(error => {
          winston.error(`Failed to start import for ${source.name}:`, error);
          return { success: false, source: source.name, error: error.message };
        })
      );

      const results = await Promise.all(importPromises);
      const successful = results.filter(r => r.success).length;

      winston.info(`Started ${successful}/${overdueSources.length} overdue imports`);

      return {
        success: true,
        overdueSourcesFound: overdueSources.length,
        importsStarted: successful,
        results
      };

    } catch (error) {
      winston.error('Failed to check overdue imports:', error);
      throw error;
    }
  }

  // Start import for a specific source
  async startImportForSource(source, options = {}) {
    try {
      winston.info(`Starting import for source: ${source.name}`);

      // Check if source is healthy
      if (!source.isHealthy) {
        throw new Error(`Source ${source.name} is not healthy`);
      }

      // Create import history record
      const importHistory = new ImportHistory({
        source: source.name,
        status: 'running',
        startedAt: new Date(),
        configuration: {
          batchSize: source.settings?.batchSize || 100,
          concurrency: source.settings?.concurrency || 3,
          ...options.configuration
        },
        triggeredBy: options.triggeredBy || 'scheduled'
      });

      await importHistory.save();

      // Add import job to queue
      const jobData = {
        sourceId: source._id.toString(),
        importId: importHistory._id.toString(),
        sourceConfig: source,
        options: {
          ...options,
          configuration: importHistory.configuration
        }
      };

      await queueService.addJob(
        'import-scheduling',
        'start-import',
        jobData,
        {
          priority: options.priority || 'normal',
          delay: options.delay || 0
        }
      );

      winston.info(`Import job queued for ${source.name} (Import ID: ${importHistory._id})`);

      // Update source stats
      await source.incrementImportStats(0);

      return {
        success: true,
        sourceName: source.name,
        importId: importHistory._id,
        jobId: jobData.importId,
        status: 'queued'
      };

    } catch (error) {
      winston.error(`Failed to start import for ${source.name}:`, error);
      throw error;
    }
  }

  // Manual trigger for import
  async triggerImport(sourceId, userId = null, options = {}) {
    try {
      const source = await JobSource.findById(sourceId);
      if (!source) {
        throw new Error('Job source not found');
      }

      if (!source.isActive) {
        throw new Error('Job source is not active');
      }

      const importOptions = {
        ...options,
        triggeredBy: 'manual',
        priority: 'high'
      };

      if (userId) {
        importOptions.triggeredByUser = userId;
      }

      return await this.startImportForSource(source, importOptions);

    } catch (error) {
      winston.error('Failed to trigger manual import:', error);
      throw error;
    }
  }

  // Get scheduler status and information
  getSchedulerStatus() {
    const sourceSchedulers = [];
    const globalSchedulers = [];

    for (const [name, scheduler] of this.schedulers) {
      if (name.startsWith('source-')) {
        sourceSchedulers.push({
          name,
          sourceId: name.replace('source-', ''),
          running: scheduler.running
        });
      } else {
        globalSchedulers.push({
          name,
          running: scheduler.running
        });
      }
    }

    return {
      isRunning: this.isRunning,
      totalSchedulers: this.schedulers.size,
      sourceSchedulers,
      globalSchedulers,
      defaultCronPattern: this.defaultCronPattern,
      timestamp: new Date().toISOString()
    };
  }

  // Update scheduler for a source (e.g., when settings change)
  async updateSourceScheduler(source) {
    try {
      if (source.isActive) {
        await this.startSourceScheduler(source);
      } else {
        await this.stopSourceScheduler(source._id);
      }

      return { success: true, sourceName: source.name, updated: true };

    } catch (error) {
      winston.error(`Failed to update scheduler for ${source.name}:`, error);
      throw error;
    }
  }

  // Execute function with distributed lock to prevent conflicts across multiple instances
  async executeWithDistributedLock(lockKey, fn, timeout = this.distributedLockTimeout) {
    const client = redisConnection.getClient();
    if (!client) {
      throw new Error('Redis connection not available for distributed locking');
    }

    const lockValue = `${Date.now()}-${Math.random()}`;

    try {
      // Try to acquire lock
      const acquired = await client.set(lockKey, lockValue, 'PX', timeout, 'NX');

      if (acquired) {
        winston.debug(`Acquired distributed lock: ${lockKey}`);

        try {
          // Execute the function
          const result = await fn();
          return result;
        } finally {
          // Release the lock (only if it's still ours)
          const currentValue = await client.get(lockKey);
          if (currentValue === lockValue) {
            await client.del(lockKey);
            winston.debug(`Released distributed lock: ${lockKey}`);
          }
        }
      } else {
        winston.info(`Distributed lock not acquired for ${lockKey}, another instance is running`);
        return { success: true, message: 'Lock not acquired, skipping execution' };
      }

    } catch (error) {
      winston.error(`Error executing with distributed lock ${lockKey}:`, error);
      throw error;
    }
  }

  // Calculate cron pattern based on interval in hours
  calculateCronPattern(intervalHours) {
    if (intervalHours >= 24) {
      // Daily or longer
      const days = Math.floor(intervalHours / 24);
      if (days === 1) {
        return '0 2 * * *'; // Daily at 2 AM
      } else if (days === 7) {
        return '0 2 * * 0'; // Weekly on Sunday at 2 AM
      } else {
        return `0 2 */${days} * *`; // Every N days at 2 AM
      }
    } else if (intervalHours >= 12) {
      return '0 */12 * * *'; // Every 12 hours
    } else if (intervalHours >= 6) {
      return '0 */6 * * *'; // Every 6 hours
    } else if (intervalHours >= 4) {
      return '0 */4 * * *'; // Every 4 hours
    } else if (intervalHours >= 2) {
      return '0 */2 * * *'; // Every 2 hours
    } else {
      return '0 * * * *'; // Every hour
    }
  }

  // Get next scheduled run times for all sources
  async getNextScheduledRuns() {
    try {
      const activeSources = await JobSource.find({ isActive: true });

      const schedules = activeSources.map(source => ({
        sourceId: source._id,
        sourceName: source.name,
        nextScheduledImport: source.nextScheduledImport,
        isOverdue: source.isOverdueForImport,
        fetchInterval: source.settings?.fetchInterval || 6
      }));

      return {
        sources: schedules,
        totalSources: schedules.length,
        overdueCount: schedules.filter(s => s.isOverdue).length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      winston.error('Failed to get next scheduled runs:', error);
      throw error;
    }
  }

  // Cleanup finished schedulers and resources
  async cleanup() {
    try {
      await this.stop();

      // Clean up any remaining distributed locks
      const client = redisConnection.getClient();
      if (client) {
        const lockKeys = await client.keys('source-import-*');
        if (lockKeys.length > 0) {
          await client.del(...lockKeys);
          winston.info(`Cleaned up ${lockKeys.length} distributed locks`);
        }
      }

      winston.info('Scheduler service cleanup completed');

    } catch (error) {
      winston.error('Error during scheduler cleanup:', error);
      throw error;
    }
  }

  // Health check for scheduler service
  async healthCheck() {
    try {
      const redisConnected = redisConnection.isConnected();

      return {
        healthy: this.isRunning && redisConnected,
        isRunning: this.isRunning,
        redisConnected,
        activeSchedulers: this.schedulers.size,
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

module.exports = new SchedulerService();