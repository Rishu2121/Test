const express = require('express');
const rateLimit = require('express-rate-limit');
const importController = require('../controllers/importController');
const authMiddleware = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');

const router = express.Router();

// Rate limiting for import operations
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 import requests per windowMs
  message: {
    success: false,
    error: 'Too many import requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Apply authentication to all import routes
router.use(authMiddleware.authenticate);

// Import management routes
router.post('/start',
  importLimiter,
  validationMiddleware.validateImportStart(),
  importController.startImport
);

router.get('/',
  validationMiddleware.validatePagination(),
  validationMiddleware.validateDateRange(),
  importController.getImports
);

router.get('/running',
  importController.getRunningImports
);

router.get('/stats',
  importController.getImportStats
);

router.get('/:id',
  validationMiddleware.validateObjectId('id'),
  importController.getImport
);

router.post('/:id/cancel',
  validationMiddleware.validateObjectId('id'),
  importController.cancelImport
);

router.post('/:id/retry',
  importLimiter,
  validationMiddleware.validateObjectId('id'),
  importController.retryImport
);

router.get('/:id/errors',
  validationMiddleware.validateObjectId('id'),
  validationMiddleware.validatePagination(),
  importController.getImportErrors
);

router.delete('/cleanup',
  authMiddleware.isAdmin,
  validationMiddleware.validateCleanup(),
  importController.cleanupImports
);

module.exports = router;