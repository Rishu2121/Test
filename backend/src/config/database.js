const mongoose = require('mongoose');
const winston = require('winston');

class DatabaseConnection {
  constructor() {
    this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/job-importer';
    this.options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      bufferMaxEntries: 0
    };
  }

  async connect() {
    try {
      const conn = await mongoose.connect(this.mongoUri, this.options);

      winston.info(`MongoDB Connected: ${conn.connection.host}`);

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        winston.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        winston.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        winston.info('MongoDB reconnected');
      });

      return conn;
    } catch (error) {
      winston.error('Database connection failed:', error);
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      await mongoose.connection.close();
      winston.info('MongoDB connection closed');
    } catch (error) {
      winston.error('Error closing MongoDB connection:', error);
    }
  }

  getConnectionState() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[mongoose.connection.readyState];
  }
}

module.exports = new DatabaseConnection();