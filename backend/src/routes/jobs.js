const express = require('express');
const rateLimit = require('express-rate-limit');
const jobController = require('../controllers/jobController');
const authMiddleware = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');

const router = express.Router();

// Rate limiting for job operations
const jobLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Apply rate limiting to all job routes
router.use(jobLimiter);

// Optional authentication for public job viewing
router.use(authMiddleware.optionalAuth);

// Public job viewing routes
router.get('/',
  validationMiddleware.validatePagination(),
  jobController.getJobs
);

router.get('/search',
  validationMiddleware.checkContentType,
  jobController.searchJobs
);

router.get('/stats',
  jobController.getJobStats
);

router.get('/:id',
  validationMiddleware.validateObjectId('id'),
  jobController.getJob
);

// Protected routes (require authentication)
router.use(authMiddleware.authenticate);

// Job management routes (authenticated users)
router.put('/:id',
  validationMiddleware.validateObjectId('id'),
  validationMiddleware.validateJobUpdate(),
  jobController.updateJob
);

router.delete('/:id',
  validationMiddleware.validateObjectId('id'),
  jobController.deleteJob
);

// Bulk operations (require admin access)
router.post('/bulk-update',
  authMiddleware.isAdmin,
  validationMiddleware.checkContentType,
  validationMiddleware.validateBulkJobUpdate(),
  jobController.bulkUpdateJobs
);

module.exports = router;