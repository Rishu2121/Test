require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const winston = require('winston');
const databaseConnection = require('./config/database');
const redisConnection = require('./config/redis');
const queueService = require('./services/queueService');
const schedulerService = require('./services/schedulerService');
const authMiddleware = require('./middleware/auth');
const validationMiddleware = require('./middleware/validation');
const errorHandler = require('./utils/errorHandler');

// Import routes
const importsRouter = require('./routes/imports');
const jobsRouter = require('./routes/jobs');
const adminRouter = require('./routes/admin');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'job-importer-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      )
    }),
    new winston.transports.File({
      filename: 'logs/api-error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/api-combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// Create Express app
const app = express();

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS middleware
app.use(authMiddleware.cors);

// Security headers
app.use(authMiddleware.securityHeaders);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Request logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Input sanitization
app.use(validationMiddleware.sanitizeInput);

// Content type validation
app.use(validationMiddleware.checkContentType);

// Health check endpoint (before authentication)
app.get('/health', async (req, res) => {
  try {
    const [dbState, redisState, queueHealth] = await Promise.all([
      databaseConnection.getConnectionState(),
      redisConnection.isConnected(),
      queueService.healthCheck()
    ]);

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: {
          status: dbState,
          healthy: dbState === 'connected'
        },
        redis: {
          status: redisState ? 'connected' : 'disconnected',
          healthy: redisState
        },
        queues: queueHealth
      }
    };

    // Determine overall health
    const allHealthy = Object.values(health.services).every(service => service.healthy);
    health.status = allHealthy ? 'healthy' : 'degraded';

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API routes
app.use('/api/imports', importsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/admin', adminRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Job Importer API',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      imports: '/api/imports',
      jobs: '/api/jobs',
      admin: '/api/admin'
    },
    documentation: 'https://github.com/your-repo/job-importer-system'
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Job Importer API',
    version: process.env.npm_package_version || '1.0.0',
    description: 'API for managing job imports, job listings, and system administration',
    endpoints: {
      imports: {
        baseUrl: '/api/imports',
        methods: ['GET', 'POST'],
        description: 'Import management and history'
      },
      jobs: {
        baseUrl: '/api/jobs',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'Job listing management'
      },
      admin: {
        baseUrl: '/api/admin',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'System administration (admin access required)'
      }
    },
    authentication: 'Bearer token or API key required for most operations'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      '/health',
      '/',
      '/api',
      '/api/imports',
      '/api/jobs',
      '/api/admin'
    ]
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close queue service
    await queueService.closeAll();

    // Close scheduler service
    await schedulerService.cleanup();

    // Close database connections
    await databaseConnection.disconnect();

    // Close Redis connection
    await redisConnection.disconnect();

    logger.info('Graceful shutdown completed');
    process.exit(0);

  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  shutdown('SIGTERM');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('SIGTERM');
});

// Initialize services and start server
async function startServer() {
  try {
    // Connect to database
    await databaseConnection.connect();
    logger.info('Database connected successfully');

    // Connect to Redis
    await redisConnection.connect();
    logger.info('Redis connected successfully');

    // Initialize queue service
    await queueService.initializeQueues();
    logger.info('Queue service initialized');

    // Initialize scheduler service
    await schedulerService.initialize();
    await schedulerService.start();
    logger.info('Scheduler service started');

    // Create logs directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs', { recursive: true });
    }

    // Start the server
    const PORT = process.env.PORT || 3001;
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });

    // Store server reference for graceful shutdown
    app.server = server;

    return server;

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = app;