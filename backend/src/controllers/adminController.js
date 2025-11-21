const JobSource = require('../models/JobSource');
const Job = require('../models/Job');
const ImportHistory = require('../models/ImportHistory');
const queueService = require('../services/queueService');
const schedulerService = require('../services/schedulerService');
const loggingService = require('../services/loggingService');
const winston = require('winston');

class AdminController {
  // Get system overview and health
  async getSystemOverview(req, res) {
    try {
      const [jobSourceHealth, queueHealth, schedulerHealth, loggingHealth] = await Promise.all([
        JobSource.getHealthStats(),
        queueService.healthCheck(),
        schedulerService.healthCheck(),
        loggingService.healthCheck()
      ]);

      // Get basic statistics
      const [totalJobs, totalSources, totalImports] = await Promise.all([
        Job.countDocuments({ isActive: true }),
        JobSource.countDocuments({ isActive: true }),
        ImportHistory.countDocuments()
      ]);

      // Get recent activity
      const recentImports = await ImportHistory.find()
        .sort({ startedAt: -1 })
        .limit(5)
        .select('source status startedAt completedAt totalJobs newJobs')
        .lean();

      // Get currently running imports
      const runningImports = await ImportHistory.findRunningImports()
        .select('source startedAt totalJobs configuration')
        .lean();

      res.status(200).json({
        success: true,
        data: {
          health: {
            jobSources: jobSourceHealth[0] || {
              totalSources: 0,
              activeSources: 0,
              healthySources: 0
            },
            queues: queueHealth,
            scheduler: schedulerHealth,
            logging: loggingHealth
          },
          statistics: {
            totalJobs,
            totalSources,
            totalImports,
            runningImports: runningImports.length
          },
          activity: {
            recentImports,
            runningImports
          },
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      winston.error('Failed to get system overview:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch system overview',
        details: error.message
      });
    }
  }

  // Job source management
  async getJobSources(req, res) {
    try {
      const { activeOnly = false, page = 1, limit = 50 } = req.query;

      const filters = {};
      if (activeOnly === 'true') {
        filters.isActive = true;
      }

      const skip = (page - 1) * limit;

      const [sources, total] = await Promise.all([
        JobSource.find(filters)
          .sort({ name: 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        JobSource.countDocuments(filters)
      ]);

      const sourcesData = sources.map(source => new JobSource(source).toAPIResponse());

      res.status(200).json({
        success: true,
        data: {
          sources: sourcesData,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get job sources:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch job sources',
        details: error.message
      });
    }
  }

  async createJobSource(req, res) {
    try {
      const sourceData = req.body;

      // Check if source name already exists
      const existingSource = await JobSource.findOne({ name: sourceData.name });
      if (existingSource) {
        return res.status(400).json({
          success: false,
          error: 'Job source with this name already exists'
        });
      }

      const newSource = new JobSource(sourceData);
      await newSource.save();

      // Test connection if requested
      let connectionTest = null;
      if (req.body.testConnection) {
        connectionTest = await newSource.testConnection();
      }

      res.status(201).json({
        success: true,
        data: newSource.toAPIResponse(),
        connectionTest,
        message: 'Job source created successfully'
      });

      winston.info(`Job source created`, { sourceId: newSource._id, name: newSource.name });

    } catch (error) {
      winston.error('Failed to create job source:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create job source',
        details: error.message
      });
    }
  }

  async updateJobSource(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const source = await JobSource.findById(id);
      if (!source) {
        return res.status(404).json({
          success: false,
          error: 'Job source not found'
        });
      }

      // Update allowed fields
      const allowedFields = [
        'name', 'url', 'apiKey', 'format', 'isActive',
        'settings', 'fieldMapping', 'fieldDefaults',
        'headers', 'auth', 'validationRules'
      ];

      const updateObj = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateObj[field] = updateData[field];
        }
      }

      const updatedSource = await JobSource.findByIdAndUpdate(
        id,
        { $set: updateObj },
        { new: true, runValidators: true }
      ).lean();

      // Update scheduler if source settings changed
      if (updateData.settings || updateData.isActive !== undefined) {
        await schedulerService.updateSourceScheduler(new JobSource(updatedSource));
      }

      const sourceData = new JobSource(updatedSource).toAPIResponse();

      res.status(200).json({
        success: true,
        data: sourceData,
        message: 'Job source updated successfully'
      });

      winston.info(`Job source updated`, { sourceId: id, updatedFields: Object.keys(updateObj) });

    } catch (error) {
      winston.error('Failed to update job source:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update job source',
        details: error.message
      });
    }
  }

  async deleteJobSource(req, res) {
    try {
      const { id } = req.params;

      const source = await JobSource.findByIdAndDelete(id);
      if (!source) {
        return res.status(404).json({
          success: false,
          error: 'Job source not found'
        });
      }

      // Stop scheduler for this source
      await schedulerService.stopSourceScheduler(id);

      res.status(200).json({
        success: true,
        message: 'Job source deleted successfully',
        deletedSource: {
          id: source._id,
          name: source.name
        }
      });

      winston.info(`Job source deleted`, { sourceId: id, name: source.name });

    } catch (error) {
      winston.error('Failed to delete job source:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete job source',
        details: error.message
      });
    }
  }

  async testJobSource(req, res) {
    try {
      const { id } = req.params;

      const source = await JobSource.findById(id);
      if (!source) {
        return res.status(404).json({
          success: false,
          error: 'Job source not found'
        });
      }

      const testResult = await source.testConnection();

      res.status(200).json({
        success: true,
        data: testResult,
        message: testResult.success ? 'Connection test successful' : 'Connection test failed'
      });

    } catch (error) {
      winston.error('Failed to test job source:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to test job source',
        details: error.message
      });
    }
  }

  // Queue management
  async getQueueStatus(req, res) {
    try {
      const { queueName } = req.query;

      let status;
      if (queueName) {
        status = await queueService.getQueueStatus(queueName);
      } else {
        status = await queueService.getAllQueuesStatus();
      }

      res.status(200).json({
        success: true,
        data: status
      });

    } catch (error) {
      winston.error('Failed to get queue status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch queue status',
        details: error.message
      });
    }
  }

  async pauseQueue(req, res) {
    try {
      const { queueName } = req.params;

      const result = await queueService.pauseQueue(queueName);

      res.status(200).json({
        success: true,
        data: result,
        message: `Queue ${queueName} paused successfully`
      });

    } catch (error) {
      winston.error('Failed to pause queue:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to pause queue',
        details: error.message
      });
    }
  }

  async resumeQueue(req, res) {
    try {
      const { queueName } = req.params;

      const result = await queueService.resumeQueue(queueName);

      res.status(200).json({
        success: true,
        data: result,
        message: `Queue ${queueName} resumed successfully`
      });

    } catch (error) {
      winston.error('Failed to resume queue:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resume queue',
        details: error.message
      });
    }
  }

  async clearQueue(req, res) {
    try {
      const { queueName } = req.params;
      const { count = 0, state = 'all' } = req.query;

      const result = await queueService.clearQueue(queueName, {
        count: parseInt(count),
        queueState: state
      });

      res.status(200).json({
        success: true,
        data: result,
        message: `Queue ${queueName} cleared successfully`
      });

    } catch (error) {
      winston.error('Failed to clear queue:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear queue',
        details: error.message
      });
    }
  }

  // Scheduler management
  async getSchedulerStatus(req, res) {
    try {
      const schedulerStatus = schedulerService.getSchedulerStatus();
      const nextScheduledRuns = await schedulerService.getNextScheduledRuns();

      res.status(200).json({
        success: true,
        data: {
          scheduler: schedulerStatus,
          nextRuns: nextScheduledRuns
        }
      });

    } catch (error) {
      winston.error('Failed to get scheduler status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch scheduler status',
        details: error.message
      });
    }
  }

  async startScheduler(req, res) {
    try {
      const result = await schedulerService.start();

      res.status(200).json({
        success: true,
        data: result,
        message: 'Scheduler started successfully'
      });

    } catch (error) {
      winston.error('Failed to start scheduler:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start scheduler',
        details: error.message
      });
    }
  }

  async stopScheduler(req, res) {
    try {
      const result = await schedulerService.stop();

      res.status(200).json({
        success: true,
        data: result,
        message: 'Scheduler stopped successfully'
      });

    } catch (error) {
      winston.error('Failed to stop scheduler:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to stop scheduler',
        details: error.message
      });
    }
  }

  // Error analysis and monitoring
  async getErrorAnalysis(req, res) {
    try {
      const { days = 30 } = req.query;

      const [errorAnalysis, importStats] = await Promise.all([
        loggingService.getErrorAnalysis(parseInt(days)),
        loggingService.getImportStatistics({ days: parseInt(days) })
      ]);

      res.status(200).json({
        success: true,
        data: {
          errors: errorAnalysis,
          overview: importStats,
          period: {
            days: parseInt(days),
            startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            endDate: new Date()
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get error analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch error analysis',
        details: error.message
      });
    }
  }

  // System maintenance operations
  async cleanupSystem(req, res) {
    try {
      const { jobsOlderThan = 365, importsOlderThan = 90 } = req.query;

      const results = {};

      // Clean up old inactive jobs
      if (jobsOlderThan) {
        const jobsCutoff = new Date(Date.now() - jobsOlderThan * 24 * 60 * 60 * 1000);
        const jobResult = await Job.deleteMany({
          isActive: false,
          importedAt: { $lt: jobsCutoff }
        });
        results.jobsDeleted = jobResult.deletedCount;
      }

      // Clean up old import history
      if (importsOlderThan) {
        const importsCutoff = new Date(Date.now() - importsOlderThan * 24 * 60 * 60 * 1000);
        const importResult = await ImportHistory.deleteMany({
          startedAt: { $lt: importsCutoff },
          status: { $in: ['completed', 'failed', 'cancelled'] }
        });
        results.importsDeleted = importResult.deletedCount;
      }

      res.status(200).json({
        success: true,
        data: results,
        message: 'System cleanup completed successfully'
      });

      winston.info(`System cleanup completed`, results);

    } catch (error) {
      winston.error('Failed to cleanup system:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup system',
        details: error.message
      });
    }
  }
}

module.exports = new AdminController();