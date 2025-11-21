const jwt = require('jsonwebtoken');
const winston = require('winston');

class AuthMiddleware {
  constructor() {
    this.secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    this.tokenExpiry = process.env.JWT_EXPIRY || '15m';
  }

  // JWT Authentication middleware
  authenticate(req, res, next) {
    try {
      const token = this.extractToken(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Access token required',
          code: 'TOKEN_REQUIRED'
        });
      }

      const decoded = jwt.verify(token, this.secret);
      req.user = decoded;
      req.token = token;

      winston.debug('User authenticated', { userId: decoded.id, username: decoded.username });
      next();

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      } else {
        winston.error('Authentication error:', error);
        return res.status(500).json({
          success: false,
          error: 'Authentication failed',
          code: 'AUTH_ERROR'
        });
      }
    }
  }

  // Optional authentication - doesn't fail if no token provided
  optionalAuth(req, res, next) {
    try {
      const token = this.extractToken(req);

      if (token) {
        const decoded = jwt.verify(token, this.secret);
        req.user = decoded;
        req.token = token;
      }

      next();

    } catch (error) {
      // For optional auth, we don't fail on token errors
      winston.warn('Optional authentication failed:', error.message);
      next();
    }
  }

  // Role-based authorization
  authorize(roles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      if (roles.length > 0 && !roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredRoles: roles,
          userRole: req.user.role
        });
      }

      next();
    };
  }

  // API Key authentication
  authenticateApiKey(req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;

      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: 'API key required',
          code: 'API_KEY_REQUIRED'
        });
      }

      // In a real application, you would validate against a database
      const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];

      if (!validApiKeys.includes(apiKey)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      req.apiKey = apiKey;
      next();

    } catch (error) {
      winston.error('API key authentication error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
  }

  // Generate JWT token
  generateToken(payload) {
    try {
      return jwt.sign(payload, this.secret, {
        expiresIn: this.tokenExpiry,
        issuer: 'job-importer',
        audience: 'job-importer-api'
      });
    } catch (error) {
      winston.error('Token generation error:', error);
      throw new Error('Failed to generate token');
    }
  }

  // Verify token without authentication middleware
  verifyToken(token) {
    try {
      return jwt.verify(token, this.secret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Extract token from request
  extractToken(req) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  // Check if user is admin
  isAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED'
      });
    }

    next();
  }

  // Request rate limiting based on user type
  checkRateLimit(req, res, next) {
    // This would integrate with a rate limiting library
    // For now, just pass through
    next();
  }

  // CORS middleware
  cors(req, res, next) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  }

  // Security headers middleware
  securityHeaders(req, res, next) {
    // Security headers
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content security policy (adjust as needed)
    res.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");

    next();
  }
}

module.exports = new AuthMiddleware();