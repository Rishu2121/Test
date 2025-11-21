const redis = require('redis');
const winston = require('winston');

class RedisConnection {
  constructor() {
    this.client = null;
    this.config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000
    };
  }

  async connect() {
    try {
      this.client = redis.createClient({
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectTimeout,
          keepAlive: this.config.keepAlive
        },
        password: this.config.password,
        retry_delay_on_failover: this.config.retryDelayOnFailover,
        max_retries_per_request: this.config.maxRetriesPerRequest
      });

      this.client.on('error', (err) => {
        winston.error('Redis connection error:', err);
      });

      this.client.on('connect', () => {
        winston.info('Redis connected successfully');
      });

      this.client.on('ready', () => {
        winston.info('Redis ready for commands');
      });

      this.client.on('end', () => {
        winston.warn('Redis connection ended');
      });

      this.client.on('reconnecting', () => {
        winston.info('Redis reconnecting...');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      winston.error('Redis connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
        winston.info('Redis connection closed');
      } catch (error) {
        winston.error('Error closing Redis connection:', error);
      }
    }
  }

  getClient() {
    return this.client;
  }

  getConnectionOptions() {
    return {
      connection: {
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        connectTimeout: this.config.connectTimeout,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest
      }
    };
  }

  async isConnected() {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new RedisConnection();