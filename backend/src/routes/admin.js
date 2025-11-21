const express = require('express');
const rateLimit = require('express-rate-limit');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');

const router = express.Router();

// Apply authentication to all admin routes
router.use(authMiddleware.authenticate);

// Require admin access for all admin routes
router.use(authMiddleware.isAdmin);

// Rate limiting for admin operations
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    success: false,
    error: 'Too many admin requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

router.use(adminLimiter);

// System overview and monitoring
router.get('/overview',
  adminController.getSystemOverview
);

router.get('/error-analysis',
  validationMiddleware.validateDateRange(),
  adminController.getErrorAnalysis
);

// Job source management
router.get('/job-sources',
  validationMiddleware.validatePagination(),
  adminController.getJobSources
);

router.post('/job-sources',
  validationMiddleware.validateJobSourceCreate(),
  adminController.createJobSource
);

router.put('/job-sources/:id',
  validationMiddleware.validateObjectId('id'),
  validationMiddleware.validateJobSourceUpdate(),
  adminController.updateJobSource
);

router.delete('/job-sources/:id',
  validationMiddleware.validateObjectId('id'),
  adminController.deleteJobSource
);

router.post('/job-sources/:id/test',
  validationMiddleware.validateObjectId('id'),
  adminController.testJobSource
);

// Queue management
router.get('/queue/status',
  adminController.getQueueStatus
);

router.post('/queue/:queueName/pause',
  validationMiddleware.validateObjectId('queueName'),
  adminController.pauseQueue
);

router.post('/queue/:queueName/resume',
  validationMiddleware.validateObjectId('queueName'),
  adminController.resumeQueue
);

router.delete('/queue/:queueName/clear',
  validationMiddleware.validateObjectId('queueName'),
  validationMiddleware.validateQueueControl(),
  adminController.clearQueue
);

// Scheduler management
router.get('/scheduler/status',
  adminController.getSchedulerStatus
);

router.post('/scheduler/start',
  adminController.startScheduler
);

router.post('/scheduler/stop',
  adminController.stopScheduler
);

// System maintenance
router.post('/cleanup',
  validationMiddleware.validateCleanup(),
  adminController.cleanupSystem
);

module.exports = router;