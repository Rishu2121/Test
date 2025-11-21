const axios = require('axios');
const xmlParser = require('../utils/xmlParser');
const dataValidator = require('../utils/dataValidator');
const winston = require('winston');
const _ = require('lodash');

class JobSourceService {
  constructor() {
    this.timeout = 30000; // 30 seconds default timeout
  }

  async fetchFromSource(sourceConfig, options = {}) {
    const startTime = Date.now();
    let response;

    try {
      winston.info(`Fetching jobs from source: ${sourceConfig.name}`);

      // Make HTTP request
      response = await this.makeHttpRequest(sourceConfig, options);

      const responseTime = Date.now() - startTime;
      winston.info(`Source ${sourceConfig.name}: Fetched data in ${responseTime}ms`);

      // Parse response based on format
      let rawData;
      if (sourceConfig.format === 'xml') {
        rawData = await this.parseXMLResponse(response.data, sourceConfig);
      } else if (sourceConfig.format === 'json') {
        rawData = this.parseJSONResponse(response.data, sourceConfig);
      } else if (sourceConfig.format === 'rss') {
        rawData = await this.parseRSSResponse(response.data, sourceConfig);
      } else {
        throw new Error(`Unsupported format: ${sourceConfig.format}`);
      }

      // Extract and transform jobs
      const jobs = this.extractJobs(rawData, sourceConfig);
      const transformedJobs = this.transformJobs(jobs, sourceConfig);

      // Validate jobs
      const validationResults = dataValidator.validateImportBatch(transformedJobs, sourceConfig);

      winston.info(`Source ${sourceConfig.name}: Processed ${validationResults.total} jobs, ${validationResults.valid.length} valid`);

      return {
        success: true,
        source: sourceConfig.name,
        jobs: validationResults.valid,
        errors: validationResults.invalid,
        metadata: {
          responseTime,
          totalFetched: jobs.length,
          validJobs: validationResults.valid.length,
          invalidJobs: validationResults.invalid.length,
          format: sourceConfig.format
        }
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      winston.error(`Failed to fetch from source ${sourceConfig.name}:`, {
        error: error.message,
        responseTime,
        status: response?.status
      });

      // Update source health metrics
      if (sourceConfig.updateHealth) {
        await sourceConfig.updateHealth(false, responseTime, error);
      }

      throw new Error(`Source fetch failed for ${sourceConfig.name}: ${error.message}`);
    }
  }

  async makeHttpRequest(sourceConfig, options = {}) {
    const headers = this.buildHeaders(sourceConfig);

    const config = {
      method: 'GET',
      url: sourceConfig.url,
      headers,
      timeout: options.timeout || sourceConfig.settings?.timeout || this.timeout,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
      ...options
    };

    const response = await axios(config);

    // Update health metrics for successful request
    const responseTime = Date.now();
    if (sourceConfig.updateHealth) {
      await sourceConfig.updateHealth(true, responseTime);
    }

    return response;
  }

  buildHeaders(sourceConfig) {
    const headers = { ...sourceConfig.headers };

    // Add authentication headers
    if (sourceConfig.auth) {
      switch (sourceConfig.auth.type) {
        case 'bearer':
          if (sourceConfig.auth.token) {
            headers['Authorization'] = `Bearer ${sourceConfig.auth.token}`;
          }
          break;
        case 'apikey':
          if (sourceConfig.apiKey) {
            headers[sourceConfig.auth.apiKeyHeader || 'X-API-Key'] = sourceConfig.apiKey;
          }
          break;
        case 'basic':
          if (sourceConfig.auth.username && sourceConfig.auth.password) {
            const auth = Buffer.from(`${sourceConfig.auth.username}:${sourceConfig.auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
          }
          break;
      }
    }

    // Set appropriate accept header based on format
    if (sourceConfig.format === 'xml') {
      headers['Accept'] = 'application/xml, text/xml, */*';
    } else if (sourceConfig.format === 'json') {
      headers['Accept'] = 'application/json, */*';
    }

    return headers;
  }

  async parseXMLResponse(xmlData, sourceConfig) {
    try {
      const parsedData = await xmlParser.parse(xmlData, {
        extractPath: sourceConfig.jsonConfig?.jobPath
      });

      return parsedData;
    } catch (error) {
      winston.error('XML parsing failed:', { error: error.message, source: sourceConfig.name });
      throw new Error(`XML parsing failed: ${error.message}`);
    }
  }

  parseJSONResponse(jsonData, sourceConfig) {
    try {
      let data = jsonData;

      // Handle string data (might need to be parsed)
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      // Extract jobs using jsonConfig
      if (sourceConfig.jsonConfig && sourceConfig.jsonConfig.jobPath) {
        data = _.get(data, sourceConfig.jsonConfig.jobPath);
      }

      // Handle array wrapping
      if (sourceConfig.jsonConfig?.isArray === false && !Array.isArray(data)) {
        data = [data];
      } else if (sourceConfig.jsonConfig?.isArray === true && !Array.isArray(data)) {
        data = [data];
      }

      return data;
    } catch (error) {
      winston.error('JSON parsing failed:', { error: error.message, source: sourceConfig.name });
      throw new Error(`JSON parsing failed: ${error.message}`);
    }
  }

  async parseRSSResponse(rssData, sourceConfig) {
    // RSS is essentially XML with specific structure
    return this.parseXMLResponse(rssData, sourceConfig);
  }

  extractJobs(rawData, sourceConfig) {
    let jobs = [];

    if (sourceConfig.format === 'xml') {
      jobs = xmlParser.extractJobs(rawData, sourceConfig);
    } else if (sourceConfig.format === 'json' || sourceConfig.format === 'rss') {
      if (Array.isArray(rawData)) {
        jobs = rawData;
      } else if (rawData && typeof rawData === 'object') {
        // Try common field names for job arrays
        const jobArrayFields = ['jobs', 'job_listings', 'postings', 'items', 'data'];
        for (const field of jobArrayFields) {
          if (Array.isArray(rawData[field])) {
            jobs = rawData[field];
            break;
          }
        }

        // If still empty, try to detect job-like objects
        if (jobs.length === 0) {
          jobs = this.detectJobObjects(rawData);
        }
      }
    }

    winston.info(`Extracted ${jobs.length} jobs from ${sourceConfig.name}`);
    return jobs;
  }

  detectJobObjects(obj) {
    const jobs = [];
    const jobIndicators = ['title', 'position', 'role', 'company', 'employer'];

    if (Array.isArray(obj)) {
      return obj.filter(item => this.looksLikeJob(item));
    } else if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (jobIndicators.some(indicator =>
          key.toLowerCase().includes(indicator.toLowerCase()))) {

          if (Array.isArray(value)) {
            jobs.push(...value);
          } else if (this.looksLikeJob(value)) {
            jobs.push(value);
          }
        } else if (Array.isArray(value)) {
          jobs.push(...this.detectJobObjects(value));
        }
      }
    }

    return jobs;
  }

  looksLikeJob(obj) {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const hasTitle = obj.title || obj.position || obj.job_title || obj.role;
    const hasCompany = obj.company || obj.employer || obj.organization;
    const hasDescription = obj.description || obj.description_text || obj.details;

    return hasTitle && (hasCompany || hasDescription);
  }

  transformJobs(jobs, sourceConfig) {
    const fieldMapping = sourceConfig.fieldMapping || {};
    const transformers = sourceConfig.transformers || {};

    return jobs.map((job, index) => {
      try {
        // Map fields according to configuration
        const mappedJob = this.mapFields(job, fieldMapping, sourceConfig.name);

        // Apply custom transformers
        const transformedJob = this.applyTransformers(mappedJob, transformers);

        // Add source information
        transformedJob.source = sourceConfig.name;

        // Generate external ID if not present
        if (!transformedJob.externalId) {
          transformedJob.externalId = this.generateExternalId(transformedJob, index, sourceConfig.name);
        }

        // Validate required fields
        this.validateRequiredFields(transformedJob, sourceConfig);

        return transformedJob;

      } catch (error) {
        winston.error(`Job transformation failed for ${sourceConfig.name}:`, {
          error: error.message,
          jobIndex: index,
          externalId: job.externalId || `index-${index}`
        });
        throw error;
      }
    });
  }

  mapFields(job, fieldMapping, sourceName) {
    const mapped = {};

    // Standard field mappings
    const standardMappings = {
      externalId: ['id', 'job_id', 'uuid', 'external_id', 'reference'],
      title: ['title', 'job_title', 'position', 'role', 'position_title'],
      company: ['company', 'company_name', 'employer', 'organization', 'org'],
      location: ['location', 'job_location', 'city', 'address'],
      description: ['description', 'job_description', 'details', 'summary', 'content'],
      salary: ['salary', 'salary_range', 'compensation', 'pay'],
      jobType: ['job_type', 'employment_type', 'type', 'employment'],
      category: ['category', 'job_category', 'department', 'sector'],
      requirements: ['requirements', 'skills', 'qualifications', 'required_skills'],
      applicationUrl: ['application_url', 'apply_url', 'apply_link', 'url', 'link'],
      postedAt: ['posted_at', 'posted_date', 'publish_date', 'date', 'created_at'],
      expiresAt: ['expires_at', 'expiration_date', 'expiry_date', 'closing_date']
    };

    // Apply mapped fields
    for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
      if (job[sourceField] !== undefined) {
        mapped[targetField] = job[sourceField];
      }
    }

    // Apply standard mappings for unmapped fields
    for (const [targetField, possibleSourceFields] of Object.entries(standardMappings)) {
      if (mapped[targetField] === undefined) {
        for (const sourceField of possibleSourceFields) {
          if (job[sourceField] !== undefined) {
            mapped[targetField] = job[sourceField];
            break;
          }
        }
      }
    }

    // Include metadata for unmapped fields
    const metadata = {};
    for (const [key, value] of Object.entries(job)) {
      if (!Object.values(fieldMapping).includes(key) &&
          !Object.values(standardMappings).flat().includes(key)) {
        metadata[key] = value;
      }
    }

    if (Object.keys(metadata).length > 0) {
      mapped.metadata = metadata;
    }

    return mapped;
  }

  applyTransformers(job, transformers) {
    const transformed = { ...job };

    for (const [field, transformer] of Object.entries(transformers)) {
      if (typeof transformer === 'function' && job[field] !== undefined) {
        try {
          transformed[field] = transformer(job[field]);
        } catch (error) {
          winston.warn(`Transformer failed for field ${field}:`, error.message);
        }
      }
    }

    return transformed;
  }

  generateExternalId(job, index, sourceName) {
    // Use available fields to generate a stable ID
    const idComponents = [
      job.title,
      job.company,
      job.location,
      String(index)
    ];

    // Create hash from components
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(idComponents.join('|')).digest('hex');

    return `${sourceName}-${hash}`;
  }

  validateRequiredFields(job, sourceConfig) {
    const validationRules = sourceConfig.validationRules || {};
    const requiredFields = validationRules.requiredFields || ['title', 'company', 'description'];

    for (const field of requiredFields) {
      if (!job[field] || (typeof job[field] === 'string' && job[field].trim().length === 0)) {
        throw new Error(`Required field '${field}' is missing or empty`);
      }
    }
  }

  // Utility methods for common transformations
  static transformers = {
    salary: (salaryString) => {
      return dataValidator.validateSalary(salaryString);
    },

    location: (locationString) => {
      return dataValidator.validateLocation(locationString);
    },

    requirements: (requirementsData) => {
      return dataValidator.validateRequirements(requirementsData);
    },

    normalizeDate: (dateString) => {
      if (!dateString) return null;
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date;
    },

    normalizeBoolean: (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
      }
      if (typeof value === 'number') {
        return value !== 0;
      }
      return Boolean(value);
    },

    normalizeArray: (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
      }
      if (value) return [value];
      return [];
    },

    extractNumbers: (text) => {
      if (!text || typeof text !== 'string') return [];
      return text.match(/\d+/g)?.map(Number) || [];
    }
  };
}

module.exports = new JobSourceService();