const winston = require('winston');
const ImportHistory = require('../models/ImportHistory');
const JobSource = require('../models/JobSource');
const Job = require('../models/Job');

class LoggingService {
  constructor() {
    this.logger = this.createLogger();
    this.importMetrics = new Map();
  }

  // Create Winston logger instance
  createLogger() {
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
          msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
      })
    );

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: { service: 'job-importer' },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: consoleFormat,
          level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
        }),

        // File transport for error logs
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 10485760, // 10MB
          maxFiles: 5,
          format: logFormat
        }),

        // File transport for combined logs
        new winston.transports.File({
          filename: 'logs/combined.log',
          maxsize: 10485760, // 10MB
          maxFiles: 5,
          format: logFormat
        }),

        // File transport specifically for import logs
        new winston.transports.File({
          filename: 'logs/imports.log',
          level: 'info',
          maxsize: 10485760, // 10MB
          maxFiles: 5,
          format: logFormat
        })
      ]
    });
  }

  // Import session management
  async startImportSession(sourceId, config = {}) {
    try {
      const session = new ImportHistory({
        source: sourceId,
        status: 'running',
        startedAt: new Date(),
        totalJobs: 0,
        newJobs: 0,
        updatedJobs: 0,
        failedJobs: 0,
        duplicateJobs: 0,
        configuration: {
          batchSize: config.batchSize || 100,
          concurrency: config.concurrency || 5,
          filters: config.filters || {},
          retryAttempts: config.retryAttempts || 3
        },
        triggeredBy: config.triggeredBy || 'manual',
        triggeredByUser: config.triggeredByUser
      });

      await session.save();

      // Initialize metrics tracking
      this.importMetrics.set(session._id.toString(), {
        startTime: Date.now(),
        sourceId,
        batchCount: 0,
        processingTimes: []
      });

      this.logger.info('Import session started', {
        importId: session._id,
        source: sourceId,
        config: session.configuration
      });

      return session._id;

    } catch (error) {
      this.logger.error('Failed to start import session:', { sourceId, error: error.message });
      throw error;
    }
  }

  async updateImportStats(importId, action, jobId = null, context = {}) {
    try {
      const increment = {
        totalJobs: 1
      };

      switch (action) {
        case 'new':
          increment.newJobs = 1;
          break;
        case 'updated':
          increment.updatedJobs = 1;
          break;
        case 'duplicate':
          increment.duplicateJobs = 1;
          break;
        case 'failed':
          increment.failedJobs = 1;
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      const session = await ImportHistory.findByIdAndUpdate(
        importId,
        { $inc: increment },
        { new: true }
      );

      // Update internal metrics
      const metrics = this.importMetrics.get(importId.toString());
      if (metrics) {
        if (action !== 'duplicate' && action !== 'failed') {
          metrics.processingTimes.push(Date.now() - metrics.startTime);
        }
      }

      this.logger.info(`Job ${action}`, {
        importId,
        action,
        jobId,
        context,
        sessionStats: {
          total: session.totalJobs,
          new: session.newJobs,
          updated: session.updatedJobs,
          duplicate: session.duplicateJobs,
          failed: session.failedJobs
        }
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to update import stats:', { importId, action, error: error.message });
      throw error;
    }
  }

  async logImportError(importId, jobId, error, context = {}) {
    try {
      const errorLog = {
        jobId,
        externalId: context.externalId,
        error: {
          message: error.message,
          stack: error.stack
        },
        timestamp: new Date(),
        context
      };

      const session = await ImportHistory.findByIdAndUpdate(
        importId,
        {
          $push: { errors: errorLog },
          $inc: { failedJobs: 1, totalJobs: 1 }
        },
        { new: true }
      );

      this.logger.error('Import job failed', {
        importId,
        jobId,
        error: error.message,
        stack: error.stack,
        context
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to log import error:', { importId, jobId, error: error.message });
      throw error;
    }
  }

  async logImportBatch(importId, batchStats) {
    try {
      const { batchNumber, totalBatches, jobCount, processingTime, results } = batchStats;

      const logEntry = {
        level: 'info',
        message: `Batch ${batchNumber}/${totalBatches} processed`,
        timestamp: new Date(),
        metadata: {
          batchNumber,
          totalBatches,
          jobCount,
          processingTime,
          results
        }
      };

      const session = await ImportHistory.findByIdAndUpdate(
        importId,
        {
          $push: { logs: logEntry },
          $inc: {
            totalJobs: jobCount,
            newJobs: results.new || 0,
            updatedJobs: results.updated || 0,
            duplicateJobs: results.duplicate || 0,
            failedJobs: results.failed || 0
          }
        },
        { new: true }
      );

      // Update internal metrics
      const metrics = this.importMetrics.get(importId.toString());
      if (metrics) {
        metrics.batchCount++;
        if (processingTime) {
          metrics.processingTimes.push(processingTime);
        }
      }

      this.logger.info('Import batch completed', {
        importId,
        batchStats,
        cumulativeStats: {
          totalJobs: session.totalJobs,
          newJobs: session.newJobs,
          updatedJobs: session.updatedJobs,
          duplicateJobs: session.duplicateJobs,
          failedJobs: session.failedJobs
        }
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to log import batch:', { importId, error: error.message });
      throw error;
    }
  }

  async completeImportSession(importId, finalStats = {}) {
    try {
      const session = await ImportHistory.findById(importId);
      if (!session) {
        throw new Error('Import session not found');
      }

      const completedAt = new Date();
      const duration = completedAt - session.startedAt;

      const metrics = this.importMetrics.get(importId.toString());
      let processingStats = {};

      if (metrics) {
        const averageProcessingTime = metrics.processingTimes.length > 0
          ? metrics.processingTimes.reduce((a, b) => a + b, 0) / metrics.processingTimes.length
          : 0;

        processingStats = {
          jobsPerSecond: session.totalJobs > 0 ? (session.totalJobs / (duration / 1000)).toFixed(2) : 0,
          averageProcessingTime: Math.round(averageProcessingTime),
          batchCount: metrics.batchCount
        };
      }

      const updatedSession = await ImportHistory.findByIdAndUpdate(
        importId,
        {
          status: 'completed',
          completedAt,
          duration,
          processingStats: { ...processingStats, ...finalStats }
        },
        { new: true }
      );

      // Clean up metrics
      this.importMetrics.delete(importId.toString());

      this.logger.info('Import session completed', {
        importId,
        source: session.source,
        duration,
        totalJobs: session.totalJobs,
        newJobs: session.newJobs,
        updatedJobs: session.updatedJobs,
        duplicateJobs: session.duplicateJobs,
        failedJobs: session.failedJobs,
        successRate: session.successRate,
        processingStats
      });

      // Update source statistics
      await this.updateSourceStats(session.source, session);

      return updatedSession;

    } catch (error) {
      this.logger.error('Failed to complete import session:', { importId, error: error.message });
      throw error;
    }
  }

  async failImportSession(importId, error, context = {}) {
    try {
      const session = await ImportHistory.findById(importId);
      if (!session) {
        throw new Error('Import session not found');
      }

      const completedAt = new Date();
      const duration = completedAt - session.startedAt;

      const updatedSession = await ImportHistory.findByIdAndUpdate(
        importId,
        {
          status: 'failed',
          completedAt,
          duration,
          $push: {
            logs: {
              level: 'error',
              message: 'Import session failed',
              timestamp: new Date(),
              metadata: { error: error.message, context }
            }
          }
        },
        { new: true }
      );

      // Clean up metrics
      this.importMetrics.delete(importId.toString());

      this.logger.error('Import session failed', {
        importId,
        source: session.source,
        error: error.message,
        duration,
        totalJobs: session.totalJobs
      });

      // Update source health
      await this.updateSourceHealthOnFailure(session.source, error);

      return updatedSession;

    } catch (error) {
      this.logger.error('Failed to fail import session:', { importId, error: error.message });
      throw error;
    }
  }

  async cancelImportSession(importId, reason = 'User cancelled') {
    try {
      const session = await ImportHistory.findById(importId);
      if (!session) {
        throw new Error('Import session not found');
      }

      const completedAt = new Date();
      const duration = completedAt - session.startedAt;

      const updatedSession = await ImportHistory.findByIdAndUpdate(
        importId,
        {
          status: 'cancelled',
          completedAt,
          duration,
          $push: {
            logs: {
              level: 'info',
              message: 'Import session cancelled',
              timestamp: new Date(),
              metadata: { reason }
            }
          }
        },
        { new: true }
      );

      // Clean up metrics
      this.importMetrics.delete(importId.toString());

      this.logger.warn('Import session cancelled', {
        importId,
        source: session.source,
        reason,
        duration,
        totalJobs: session.totalJobs
      });

      return updatedSession;

    } catch (error) {
      this.logger.error('Failed to cancel import session:', { importId, error: error.message });
      throw error;
    }
  }

  // Source statistics updates
  async updateSourceStats(sourceName, importSession) {
    try {
      const jobCount = importSession.newJobs + importSession.updatedJobs;
      await JobSource.findOneAndUpdate(
        { name: sourceName },
        {
          lastImportAt: importSession.completedAt,
          $inc: {
            totalImports: 1,
            totalJobsImported: jobCount
          }
        }
      );

      this.logger.debug('Source statistics updated', {
        source: sourceName,
        jobsImported: jobCount,
        importId: importSession._id
      });

    } catch (error) {
      this.logger.error('Failed to update source stats:', { sourceName, error: error.message });
    }
  }

  async updateSourceHealthOnFailure(sourceName, error) {
    try {
      const source = await JobSource.findOne({ name: sourceName });
      if (source) {
        await source.updateHealth(false, 0, error);
      }
    } catch (error) {
      this.logger.error('Failed to update source health:', { sourceName, error: error.message });
    }
  }

  // Performance monitoring
  async logPerformanceMetrics(importId, metrics) {
    try {
      const session = await ImportHistory.findById(importId);
      if (!session) return;

      const processingStats = {
        ...session.processingStats,
        ...metrics,
        timestamp: new Date()
      };

      await ImportHistory.findByIdAndUpdate(
        importId,
        { processingStats }
      );

      this.logger.debug('Performance metrics logged', {
        importId,
        metrics
      });

    } catch (error) {
      this.logger.error('Failed to log performance metrics:', { importId, error: error.message });
    }
  }

  // Analytics and reporting
  async getImportStatistics(filters = {}) {
    try {
      const { days = 30, source, status } = filters;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const matchStage = { startedAt: { $gte: since } };
      if (source) matchStage.source = source;
      if (status) matchStage.status = status;

      const stats = await ImportHistory.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalImports: { $sum: 1 },
            successfulImports: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            failedImports: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
            },
            totalJobsProcessed: { $sum: '$totalJobs' },
            totalNewJobs: { $sum: '$newJobs' },
            totalUpdatedJobs: { $sum: '$updatedJobs' },
            totalFailedJobs: { $sum: '$failedJobs' },
            averageDuration: { $avg: '$duration' },
            minDuration: { $min: '$duration' },
            maxDuration: { $max: '$duration' }
          }
        }
      ]);

      return stats[0] || {
        totalImports: 0,
        successfulImports: 0,
        failedImports: 0,
        totalJobsProcessed: 0,
        totalNewJobs: 0,
        totalUpdatedJobs: 0,
        totalFailedJobs: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0
      };

    } catch (error) {
      this.logger.error('Failed to get import statistics:', { error: error.message });
      throw error;
    }
  }

  async getRecentImportLogs(limit = 50) {
    try {
      const logs = await ImportHistory.find()
        .sort({ startedAt: -1 })
        .limit(limit)
        .select('source status startedAt completedAt duration totalJobs newJobs updatedJobs failedJobs')
        .lean();

      return logs;

    } catch (error) {
      this.logger.error('Failed to get recent import logs:', { error: error.message });
      throw error;
    }
  }

  // Error analysis
  async getErrorAnalysis(days = 30) {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const errorAnalysis = await ImportHistory.aggregate([
        { $match: { startedAt: { $gte: since } } },
        { $unwind: { path: '$errors', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              source: '$source',
              errorType: '$errors.error.message'
            },
            count: { $sum: 1 },
            occurrences: {
              $push: {
                timestamp: '$errors.timestamp',
                externalId: '$errors.externalId'
              }
            }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]);

      return errorAnalysis;

    } catch (error) {
      this.logger.error('Failed to get error analysis:', { error: error.message });
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const recentImports = await ImportHistory.find({
        startedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
      });

      return {
        healthy: true,
        recentImportsCount: recentImports.length,
        activeMetricsCount: this.importMetrics.size,
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

module.exports = new LoggingService();