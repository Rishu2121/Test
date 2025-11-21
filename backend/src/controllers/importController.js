const ImportHistory = require('../models/ImportHistory');
const JobSource = require('../models/JobSource');
const schedulerService = require('../services/schedulerService');
const queueService = require('../services/queueService');
const loggingService = require('../services/loggingService');
const winston = require('winston');

class ImportController {
  // Start a new import from a job source
  async startImport(req, res) {
    try {
      const { sourceId, options = {} } = req.body;
      const userId = req.user?.id; // Assuming user is available from auth middleware

      if (!sourceId) {
        return res.status(400).json({
          success: false,
          error: 'Source ID is required'
        });
      }

      const source = await JobSource.findById(sourceId);
      if (!source) {
        return res.status(404).json({
          success: false,
          error: 'Job source not found'
        });
      }

      if (!source.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Job source is not active'
        });
      }

      // Start the import
      const result = await schedulerService.triggerImport(sourceId, userId, options);

      res.status(200).json({
        success: true,
        data: {
          importId: result.importId,
          sourceId: sourceId,
          sourceName: source.name,
          status: 'queued',
          message: 'Import started successfully'
        }
      });

      winston.info(`Import started by user ${userId}`, { sourceId, importId: result.importId });

    } catch (error) {
      winston.error('Failed to start import:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start import',
        details: error.message
      });
    }
  }

  // Get all import sessions
  async getImports(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        source,
        status,
        startDate,
        endDate
      } = req.query;

      const filters = {};
      if (source) filters.source = source;
      if (status) filters.status = status;
      if (startDate || endDate) {
        filters.startedAt = {};
        if (startDate) filters.startedAt.$gte = new Date(startDate);
        if (endDate) filters.startedAt.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [imports, total] = await Promise.all([
        ImportHistory.find(filters)
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('triggeredByUser', 'username email')
          .lean(),
        ImportHistory.countDocuments(filters)
      ]);

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          imports: imports.map(imp => new ImportHistory(imp).toAPIResponse()),
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            itemsPerPage: parseInt(limit),
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get imports:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch imports',
        details: error.message
      });
    }
  }

  // Get specific import session details
  async getImport(req, res) {
    try {
      const { id } = req.params;

      const importSession = await ImportHistory.findById(id)
        .populate('triggeredByUser', 'username email')
        .lean();

      if (!importSession) {
        return res.status(404).json({
          success: false,
          error: 'Import session not found'
        });
      }

      const importData = new ImportHistory(importSession).toAPIResponse();

      // Add additional details for full view
      importData.logs = importSession.logs || [];
      importData.errors = importSession.errors || [];
      importData.configuration = importSession.configuration || {};

      res.status(200).json({
        success: true,
        data: importData
      });

    } catch (error) {
      winston.error('Failed to get import:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch import',
        details: error.message
      });
    }
  }

  // Cancel a running import
  async cancelImport(req, res) {
    try {
      const { id } = req.params;

      const importSession = await ImportHistory.findById(id);
      if (!importSession) {
        return res.status(404).json({
          success: false,
          error: 'Import session not found'
        });
      }

      if (importSession.status !== 'running') {
        return res.status(400).json({
          success: false,
          error: 'Import is not running and cannot be cancelled'
        });
      }

      // Cancel the import session
      await loggingService.cancelImportSession(id, 'Cancelled via API');

      res.status(200).json({
        success: true,
        data: {
          message: 'Import cancelled successfully',
          importId: id,
          status: 'cancelled'
        }
      });

      winston.info(`Import cancelled via API`, { importId: id });

    } catch (error) {
      winston.error('Failed to cancel import:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel import',
        details: error.message
      });
    }
  }

  // Get import errors
  async getImportErrors(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const importSession = await ImportHistory.findById(id);
      if (!importSession) {
        return res.status(404).json({
          success: false,
          error: 'Import session not found'
        });
      }

      const skip = (page - 1) * limit;
      const errors = importSession.errors || [];
      const total = errors.length;

      const paginatedErrors = errors
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(skip, skip + parseInt(limit));

      res.status(200).json({
        success: true,
        data: {
          importId: id,
          source: importSession.source,
          totalErrors: total,
          errors: paginatedErrors,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get import errors:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch import errors',
        details: error.message
      });
    }
  }

  // Get import statistics
  async getImportStats(req, res) {
    try {
      const { days = 30, source } = req.query;

      const stats = await loggingService.getImportStatistics({ days: parseInt(days), source });

      // Get source breakdown
      const sourceStats = await ImportHistory.aggregate([
        {
          $match: {
            startedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: '$source',
            totalImports: { $sum: 1 },
            successfulImports: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            totalJobs: { $sum: '$totalJobs' },
            newJobs: { $sum: '$newJobs' },
            updatedJobs: { $sum: '$updatedJobs' },
            failedJobs: { $sum: '$failedJobs' },
            averageDuration: { $avg: '$duration' }
          }
        },
        { $sort: { totalJobs: -1 } }
      ]);

      // Get recent trends
      const trends = await ImportHistory.getImportTrends(parseInt(days));

      res.status(200).json({
        success: true,
        data: {
          overview: stats,
          sourceBreakdown: sourceStats,
          trends,
          period: {
            days: parseInt(days),
            startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            endDate: new Date()
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get import stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch import statistics',
        details: error.message
      });
    }
  }

  // Get currently running imports
  async getRunningImports(req, res) {
    try {
      const runningImports = await ImportHistory.findRunningImports()
        .populate('triggeredByUser', 'username email')
        .lean();

      const importsData = runningImports.map(imp => new ImportHistory(imp).toAPIResponse());

      res.status(200).json({
        success: true,
        data: {
          runningImports: importsData,
          count: importsData.length
        }
      });

    } catch (error) {
      winston.error('Failed to get running imports:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch running imports',
        details: error.message
      });
    }
  }

  // Retry failed import
  async retryImport(req, res) {
    try {
      const { id } = req.params;

      const originalImport = await ImportHistory.findById(id);
      if (!originalImport) {
        return res.status(404).json({
          success: false,
          error: 'Import session not found'
        });
      }

      if (originalImport.status !== 'failed') {
        return res.status(400).json({
          success: false,
          error: 'Only failed imports can be retried'
        });
      }

      // Find the source
      const source = await JobSource.findOne({ name: originalImport.source });
      if (!source || !source.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Source not found or not active'
        });
      }

      // Start new import with same configuration
      const result = await schedulerService.triggerImport(source._id, req.user?.id, {
        ...originalImport.configuration,
        triggeredBy: 'manual-retry',
        originalImportId: id
      });

      res.status(200).json({
        success: true,
        data: {
          importId: result.importId,
          originalImportId: id,
          sourceId: source._id,
          sourceName: source.name,
          status: 'queued',
          message: 'Import retry started successfully'
        }
      });

      winston.info(`Import retry started`, {
        originalImportId: id,
        newImportId: result.importId,
        sourceName: source.name
      });

    } catch (error) {
      winston.error('Failed to retry import:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retry import',
        details: error.message
      });
    }
  }

  // Clean up old import records
  async cleanupImports(req, res) {
    try {
      const { days = 90, status } = req.query;
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const filter = {
        startedAt: { $lt: cutoffDate },
        status: { $in: ['completed', 'failed', 'cancelled'] }
      };

      if (status) {
        filter.status = status;
      }

      const result = await ImportHistory.deleteMany(filter);

      res.status(200).json({
        success: true,
        data: {
          deletedCount: result.deletedCount,
          filter: {
            olderThanDays: parseInt(days),
            cutoffDate,
            status: status || 'completed,failed,cancelled'
          }
        }
      });

      winston.info(`Import cleanup completed`, {
        deletedCount: result.deletedCount,
        days: parseInt(days)
      });

    } catch (error) {
      winston.error('Failed to cleanup imports:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup imports',
        details: error.message
      });
    }
  }
}

module.exports = new ImportController();