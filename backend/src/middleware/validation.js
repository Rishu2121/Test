const Joi = require('joi');
const winston = require('winston');

class ValidationMiddleware {
  // Common validation schemas
  schemas = {
    pagination: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().default('createdAt'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    }),

    dateRange: Joi.object({
      startDate: Joi.date().iso(),
      endDate: Joi.date().iso().min(Joi.ref('startDate'))
    }),

    jobSource: Joi.object({
      name: Joi.string().trim().min(1).max(100).required(),
      url: Joi.string().uri().required(),
      apiKey: Joi.string().trim().max(500).optional(),
      format: Joi.string().valid('xml', 'json', 'rss').default('json'),
      isActive: Joi.boolean().default(true),
      settings: Joi.object({
        fetchInterval: Joi.number().integer().min(1).max(168).default(6),
        batchSize: Joi.number().integer().min(1).max(1000).default(100),
        concurrency: Joi.number().integer().min(1).max(20).default(3),
        timeout: Joi.number().integer().min(5000).max(300000).default(30000),
        retryAttempts: Joi.number().integer().min(0).max(10).default(3)
      }).optional(),
      fieldMapping: Joi.object({
        id: Joi.string().default('id'),
        title: Joi.string().default('title'),
        company: Joi.string().default('company'),
        location: Joi.string().default('location'),
        description: Joi.string().default('description'),
        salary: Joi.string().default('salary'),
        jobType: Joi.string().default('jobType'),
        category: Joi.string().default('category'),
        requirements: Joi.string().default('requirements'),
        applicationUrl: Joi.string().default('applicationUrl'),
        postedAt: Joi.string().default('postedAt')
      }).optional(),
      auth: Joi.object({
        type: Joi.string().valid('none', 'bearer', 'basic', 'apikey').default('none'),
        token: Joi.string().optional(),
        username: Joi.string().optional(),
        password: Joi.string().optional(),
        apiKeyHeader: Joi.string().default('X-API-Key')
      }).optional()
    }),

    importStart: Joi.object({
      sourceId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
      options: Joi.object({
        batchSize: Joi.number().integer().min(1).max(1000).optional(),
        concurrency: Joi.number().integer().min(1).max(20).optional(),
        priority: Joi.string().valid('low', 'normal', 'high', 'critical').default('normal'),
        filters: Joi.object().optional()
      }).optional()
    }),

    jobUpdate: Joi.object({
      title: Joi.string().trim().min(1).max(500).optional(),
      company: Joi.string().trim().min(1).max(200).optional(),
      location: Joi.string().trim().min(1).max(200).optional(),
      description: Joi.string().trim().min(10).max(10000).optional(),
      salary: Joi.object({
        min: Joi.number().min(0).optional(),
        max: Joi.number().min(0).optional(),
        currency: Joi.string().length(3).uppercase().optional()
      }).optional(),
      jobType: Joi.string().valid('full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote').optional(),
      category: Joi.string().trim().max(100).optional(),
      requirements: Joi.array().items(Joi.string().max(500)).optional(),
      applicationUrl: Joi.string().uri().optional(),
      postedAt: Joi.date().optional(),
      expiresAt: Joi.date().optional(),
      isActive: Joi.boolean().optional(),
      metadata: Joi.object().optional()
    }),

    bulkJobUpdate: Joi.object({
      jobIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).min(1).required(),
      updateData: Joi.object({
        isActive: Joi.boolean().optional(),
        category: Joi.string().trim().max(100).optional(),
        jobType: Joi.string().valid('full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote').optional()
      }).min(1).required()
    }),

    jobSearch: Joi.object({
      q: Joi.string().trim().min(1).max(100).required(),
      filters: Joi.object({
        source: Joi.string().optional(),
        category: Joi.string().optional(),
        jobType: Joi.string().optional(),
        location: Joi.string().optional(),
        activeOnly: Joi.boolean().default(true),
        minSalary: Joi.number().min(0).optional(),
        maxSalary: Joi.number().min(0).optional()
      }).optional()
    }),

    queueControl: Joi.object({
      count: Joi.number().integer().min(0).default(0),
      state: Joi.string().valid('waiting', 'active', 'completed', 'failed', 'delayed', 'all').default('all')
    }),

    cleanup: Joi.object({
      jobsOlderThan: Joi.number().integer().min(1).default(365),
      importsOlderThan: Joi.number().integer().min(1).default(90),
      status: Joi.string().valid('completed', 'failed', 'cancelled', 'all').default('all')
    })
  };

  // Generic validation middleware factory
  validate(schema, source = 'body') {
    return (req, res, next) => {
      try {
        const data = source === 'params' ? req.params :
                     source === 'query' ? req.query :
                     req.body;

        const { error, value } = schema.validate(data, {
          abortEarly: false,
          allowUnknown: true,
          stripUnknown: true
        });

        if (error) {
          const validationErrors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
          }));

          winston.warn('Validation failed:', {
            url: req.url,
            method: req.method,
            errors: validationErrors,
            input: data
          });

          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: validationErrors,
            code: 'VALIDATION_ERROR'
          });
        }

        // Replace the original data with validated and cleaned data
        if (source === 'params') {
          req.params = { ...req.params, ...value };
        } else if (source === 'query') {
          req.query = { ...req.query, ...value };
        } else {
          req.body = value;
        }

        next();

      } catch (error) {
        winston.error('Validation middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Validation processing failed',
          code: 'VALIDATION_PROCESSING_ERROR'
        });
      }
    };
  }

  // Specific validation middleware for common operations
  validateObjectId(paramName = 'id') {
    return this.validate(
      Joi.object({
        [paramName]: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required()
      }),
      'params'
    );
  }

  validatePagination() {
    return this.validate(this.schemas.pagination, 'query');
  }

  validateDateRange() {
    return this.validate(this.schemas.dateRange, 'query');
  }

  validateJobSourceCreate() {
    return this.validate(this.schemas.jobSource);
  }

  validateJobSourceUpdate() {
    return this.validate(
      this.schemas.jobSource.fork(['name', 'url'], (schema) => schema.optional())
    );
  }

  validateImportStart() {
    return this.validate(this.schemas.importStart);
  }

  validateJobUpdate() {
    return this.validate(this.schemas.jobUpdate);
  }

  validateBulkJobUpdate() {
    return this.validate(this.schemas.bulkJobUpdate);
  }

  validateJobSearch() {
    return this.validate(this.schemas.jobSearch);
  }

  validateQueueControl() {
    return this.validate(this.schemas.queueControl, 'query');
  }

  validateCleanup() {
    return this.validate(this.schemas.cleanup, 'query');
  }

  // Custom validation functions
  validateMongoId(id) {
    const pattern = /^[0-9a-fA-F]{24}$/;
    return pattern.test(id);
  }

  validateUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  validateEmail(email) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
  }

  validatePassword(password) {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
    return passwordPattern.test(password);
  }

  validatePhoneNumber(phone) {
    // Basic international phone number validation
    const phonePattern = /^\+?[1-9]\d{1,14}$/;
    return phonePattern.test(phone);
  }

  validateSalaryRange(salary) {
    if (typeof salary !== 'object' || salary === null) {
      return false;
    }

    const { min, max, currency } = salary;

    // At least one of min or max should be present
    if ((min === undefined || min === null) && (max === undefined || max === null)) {
      return false;
    }

    // Validate numeric values
    if (min !== undefined && (typeof min !== 'number' || min < 0)) {
      return false;
    }

    if (max !== undefined && (typeof max !== 'number' || max < 0)) {
      return false;
    }

    // Max should be greater than or equal to min
    if (min !== undefined && max !== undefined && max < min) {
      return false;
    }

    // Validate currency if provided
    if (currency !== undefined && currency !== null) {
      if (typeof currency !== 'string' || currency.length !== 3) {
        return false;
      }
    }

    return true;
  }

  validateJobType(jobType) {
    const validTypes = ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote'];
    return validTypes.includes(jobType);
  }

  validateImportStatus(status) {
    const validStatuses = ['running', 'completed', 'failed', 'cancelled'];
    return validStatuses.includes(status);
  }

  validateQueueName(queueName) {
    const validQueues = ['job-processing', 'import-scheduling', 'cleanup-tasks'];
    return validQueues.includes(queueName);
  }

  validateSortFields(fields, allowedFields) {
    if (!Array.isArray(fields)) {
      return false;
    }

    return fields.every(field => allowedFields.includes(field));
  }

  // Middleware for sanitizing input
  sanitizeInput(req, res, next) {
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;
      return str.trim().replace(/[<>]/g, ''); // Basic XSS protection
    };

    const sanitizeObject = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;

      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          sanitized[key] = sanitizeString(value);
        } else if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            typeof item === 'string' ? sanitizeString(item) : sanitizeObject(item)
          );
        } else if (typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    next();
  }

  // Middleware for checking content type
  checkContentType(req, res, next) {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const contentType = req.headers['content-type'];

      if (!contentType || !contentType.includes('application/json')) {
        return res.status(415).json({
          success: false,
          error: 'Content-Type must be application/json',
          code: 'UNSUPPORTED_MEDIA_TYPE'
        });
      }
    }

    next();
  }
}

module.exports = new ValidationMiddleware();