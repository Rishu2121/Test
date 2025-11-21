const winston = require('winston');

class ErrorHandler {
  constructor() {
    this.logger = winston;
  }

  // Global error handling middleware
  handle() {
    return (error, req, res, next) => {
      // Log the error
      this.logError(error, req);

      // Handle different types of errors
      if (error.name === 'ValidationError') {
        return this.handleValidationError(error, res);
      }

      if (error.name === 'CastError') {
        return this.handleCastError(error, res);
      }

      if (error.code === 11000) {
        return this.handleDuplicateKeyError(error, res);
      }

      if (error.name === 'JsonWebTokenError') {
        return this.handleJWTError(error, res);
      }

      if (error.name === 'TokenExpiredError') {
        return this.handleJWTExpiredError(error, res);
      }

      if (error.name === 'MulterError') {
        return this.handleMulterError(error, res);
      }

      // Handle custom application errors
      if (error.isOperational) {
        return this.handleOperationalError(error, res);
      }

      // Default error response
      this.handleDefaultError(error, res);
    };
  }

  // Log error details
  logError(error, req) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      user: req.user ? { id: req.user.id, role: req.user.role } : null,
      body: req.body,
      query: req.query,
      params: req.params
    };

    if (error.status >= 500) {
      this.logger.error('Server Error:', errorDetails);
    } else {
      this.logger.warn('Client Error:', errorDetails);
    }
  }

  // Validation error handler
  handleValidationError(error, res) {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));

    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors
    });
  }

  // Cast error handler (MongoDB ObjectId casting)
  handleCastError(error, res) {
    const message = `Invalid ${error.path}: ${error.value}`;
    res.status(400).json({
      success: false,
      error: message,
      code: 'INVALID_ID'
    });
  }

  // Duplicate key error handler
  handleDuplicateKeyError(error, res) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    const message = `Duplicate value for ${field}: ${value}`;

    res.status(409).json({
      success: false,
      error: message,
      code: 'DUPLICATE_VALUE',
      field,
      value
    });
  }

  // JWT error handler
  handleJWTError(error, res) {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }

  // JWT expired error handler
  handleJWTExpiredError(error, res) {
    res.status(401).json({
      success: false,
      error: 'Token expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  // Multer (file upload) error handler
  handleMulterError(error, res) {
    let message = 'File upload error';
    let code = 'FILE_UPLOAD_ERROR';

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File too large';
        code = 'FILE_TOO_LARGE';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files';
        code = 'TOO_MANY_FILES';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        code = 'UNEXPECTED_FILE';
        break;
    }

    res.status(400).json({
      success: false,
      error: message,
      code
    });
  }

  // Operational error handler (custom application errors)
  handleOperationalError(error, res) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'APPLICATION_ERROR',
      ...(error.details && { details: error.details })
    });
  }

  // Default error handler
  handleDefaultError(error, res) {
    // Don't expose internal error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      ...(isDevelopment && {
        details: {
          message: error.message,
          stack: error.stack
        }
      })
    });
  }

  // Custom error classes
  static createError(message, statusCode = 500, code = 'ERROR', details = null) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    error.isOperational = true;
    return error;
  }

  static createValidationError(message, field, value) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    error.field = field;
    error.value = value;
    error.isOperational = true;
    return error;
  }

  static createNotFoundError(resource = 'Resource') {
    const error = new Error(`${resource} not found`);
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    error.isOperational = true;
    return error;
  }

  static createUnauthorizedError(message = 'Unauthorized') {
    const error = new Error(message);
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    error.isOperational = true;
    return error;
  }

  static createForbiddenError(message = 'Forbidden') {
    const error = new Error(message);
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    error.isOperational = true;
    return error;
  }

  static createConflictError(message = 'Conflict') {
    const error = new Error(message);
    error.statusCode = 409;
    error.code = 'CONFLICT';
    error.isOperational = true;
    return error;
  }

  static createRateLimitError(message = 'Rate limit exceeded') {
    const error = new Error(message);
    error.statusCode = 429;
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.isOperational = true;
    return error;
  }
}

// Create and export singleton instance
module.exports = new ErrorHandler();