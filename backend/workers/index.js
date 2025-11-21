require('dotenv').config();
const winston = require('winston');
const jobProcessor = require('./jobProcessor');
const databaseConnection = require('../src/config/database');
const redisConnection = require('../src/config/redis');
const loggingService = require('../src/services/loggingService');

// Setup process-level event handlers
process.on('uncaughtException', (error) => {
  winston.error('Uncaught Exception:', error);
  shutdown('SIGTERM');
});

process.on('unhandledRejection', (reason, promise) => {
  winston.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('SIGTERM');
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Global variables
let isShuttingDown = false;

// Configure logger for worker process
winston.configure({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'job-worker' },
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
      filename: 'logs/worker-error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/worker.log'
    })
  ]
});

async function initializeWorker() {
  try {
    winston.info('Initializing job worker...');

    // Connect to database
    await databaseConnection.connect();
    winston.info('Database connected successfully');

    // Connect to Redis
    await redisConnection.connect();
    winston.info('Redis connected successfully');

    // Initialize job processor
    await jobProcessor.initialize();
    winston.info('Job processor initialized successfully');

    // Create logs directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs', { recursive: true });
    }

    // Start health check monitoring
    startHealthMonitoring();

    winston.info('Worker process initialized successfully');

    // Set up periodic health checks
    setInterval(async () => {
      try {
        const health = await jobProcessor.healthCheck();
        if (!health.healthy) {
          winston.warn('Worker health check failed:', health);
        }
      } catch (error) {
        winston.error('Health check error:', error);
      }
    }, 60000); // Check every minute

  } catch (error) {
    winston.error('Failed to initialize worker:', error);
    process.exit(1);
  }
}

async function startHealthMonitoring() {
  const healthCheckInterval = setInterval(async () => {
    if (isShuttingDown) {
      clearInterval(healthCheckInterval);
      return;
    }

    try {
      // Monitor memory usage
      const memUsage = process.memoryUsage();
      const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Log memory usage if it's getting high
      if (memUsageMB > 500) { // 500MB threshold
        winston.warn('High memory usage detected:', {
          heapUsed: `${memUsageMB} MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
          external: `${Math.round(memUsage.external / 1024 / 1024)} MB`
        });
      }

      // Monitor event loop lag
      const start = process.hrtime.bigint();
      await new Promise(resolve => setImmediate(resolve));
      const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms

      if (lag > 100) { // 100ms threshold
        winston.warn('High event loop lag detected:', { lag: `${lag.toFixed(2)} ms` });
      }

    } catch (error) {
      winston.error('Health monitoring error:', error);
    }
  }, 30000); // Check every 30 seconds
}

async function shutdown(signal) {
  if (isShuttingDown) {
    winston.info('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  winston.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Stop accepting new jobs
    winston.info('Stopping job processor...');
    await jobProcessor.close();
    winston.info('Job processor stopped');

    // Close database connection
    winston.info('Closing database connection...');
    await databaseConnection.disconnect();
    winston.info('Database connection closed');

    // Close Redis connection
    winston.info('Closing Redis connection...');
    await redisConnection.disconnect();
    winston.info('Redis connection closed');

    // Log final shutdown message
    winston.info('Graceful shutdown completed');

    // Wait a moment for any remaining logs to be written
    setTimeout(() => {
      process.exit(0);
    }, 1000);

  } catch (error) {
    winston.error('Error during shutdown:', error);
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
}

// Start the worker if this file is run directly
if (require.main === module) {
  initializeWorker().catch(error => {
    winston.error('Failed to start worker:', error);
    process.exit(1);
  });
}

module.exports = {
  initializeWorker,
  shutdown,
  jobProcessor
};