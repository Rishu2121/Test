const Joi = require('joi');
const winston = require('winston');

class DataValidator {
  constructor() {
    // Base job validation schema
    this.jobSchema = Joi.object({
      externalId: Joi.string().required(),
      title: Joi.string().required().max(500).trim(),
      company: Joi.string().required().max(200).trim(),
      location: Joi.string().required().max(200).trim(),
      description: Joi.string().required().max(10000).trim(),
      salary: Joi.object({
        min: Joi.number().min(0).optional(),
        max: Joi.number().min(0).optional(),
        currency: Joi.string().length(3).uppercase().optional()
      }).optional(),
      jobType: Joi.string().valid('full-time', 'part-time', 'contract', 'temporary', 'internship', 'remote').optional(),
      category: Joi.string().max(100).trim().optional(),
      requirements: Joi.array().items(Joi.string().max(500).trim()).optional(),
      applicationUrl: Joi.string().uri().max(1000).trim().optional(),
      postedAt: Joi.date().required(),
      expiresAt: Joi.date().optional(),
      metadata: Joi.object().optional()
    });

    // Job source validation schema
    this.jobSourceSchema = Joi.object({
      name: Joi.string().required().max(100).trim(),
      url: Joi.string().uri().required().max(1000).trim(),
      apiKey: Joi.string().max(500).optional(),
      format: Joi.string().valid('xml', 'json', 'rss').required(),
      fieldMapping: Joi.object({
        id: Joi.string().optional(),
        title: Joi.string().optional(),
        company: Joi.string().optional(),
        location: Joi.string().optional(),
        description: Joi.string().optional(),
        salary: Joi.string().optional(),
        jobType: Joi.string().optional(),
        category: Joi.string().optional(),
        requirements: Joi.string().optional(),
        applicationUrl: Joi.string().optional(),
        postedAt: Joi.string().optional(),
        expiresAt: Joi.string().optional()
      }).optional(),
      settings: Joi.object({
        fetchInterval: Joi.number().min(1).max(168).optional(),
        batchSize: Joi.number().min(1).max(1000).optional(),
        concurrency: Joi.number().min(1).max(20).optional(),
        timeout: Joi.number().min(5000).max(300000).optional(),
        retryAttempts: Joi.number().min(0).max(10).optional()
      }).optional()
    });
  }

  validateJob(jobData, sourceConfig = {}) {
    try {
      // Apply defaults from source configuration
      const processedData = this.applyDefaults(jobData, sourceConfig);

      // Validate against schema
      const { error, value } = this.jobSchema.validate(processedData, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        winston.warn('Job validation failed:', { validationErrors, jobData: processedData });
        return {
          isValid: false,
          errors: validationErrors,
          data: processedData
        };
      }

      // Additional business logic validation
      const businessValidation = this.validateBusinessRules(value);
      if (!businessValidation.isValid) {
        return {
          isValid: false,
          errors: businessValidation.errors,
          data: value
        };
      }

      return {
        isValid: true,
        data: value
      };

    } catch (error) {
      winston.error('Job validation error:', error);
      return {
        isValid: false,
        errors: [{ field: 'general', message: 'Validation processing error' }],
        data: jobData
      };
    }
  }

  validateJobSource(sourceData) {
    try {
      const { error, value } = this.jobSourceSchema.validate(sourceData, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        return {
          isValid: false,
          errors: validationErrors,
          data: sourceData
        };
      }

      return {
        isValid: true,
        data: value
      };

    } catch (error) {
      winston.error('Job source validation error:', error);
      return {
        isValid: false,
        errors: [{ field: 'general', message: 'Validation processing error' }],
        data: sourceData
      };
    }
  }

  validateImportBatch(jobs, sourceConfig) {
    const results = {
      valid: [],
      invalid: [],
      total: jobs.length
    };

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const validation = this.validateJob(job, sourceConfig);

      if (validation.isValid) {
        results.valid.push(validation.data);
      } else {
        results.invalid.push({
          index: i,
          job,
          errors: validation.errors,
          externalId: job.externalId || `index-${i}`
        });
      }
    }

    winston.info(`Batch validation complete: ${results.valid.length} valid, ${results.invalid.length} invalid`);
    return results;
  }

  validateBusinessRules(jobData) {
    const errors = [];

    // Check for reasonable dates
    if (jobData.postedAt && jobData.postedAt > new Date()) {
      errors.push({
        field: 'postedAt',
        message: 'Posted date cannot be in the future'
      });
    }

    if (jobData.expiresAt && jobData.expiresAt <= new Date()) {
      errors.push({
        field: 'expiresAt',
        message: 'Expiration date must be in the future'
      });
    }

    if (jobData.postedAt && jobData.expiresAt && jobData.expiresAt <= jobData.postedAt) {
      errors.push({
        field: 'expiresAt',
        message: 'Expiration date must be after posted date'
      });
    }

    // Salary validation
    if (jobData.salary) {
      if (jobData.salary.min && jobData.salary.max && jobData.salary.min > jobData.salary.max) {
        errors.push({
          field: 'salary.min',
          message: 'Minimum salary cannot be greater than maximum salary'
        });
      }
    }

    // Application URL validation
    if (jobData.applicationUrl) {
      const blockedDomains = ['spam.com', 'fake.com'];
      const urlDomain = new URL(jobData.applicationUrl).hostname;

      if (blockedDomains.some(blocked => urlDomain.includes(blocked))) {
        errors.push({
          field: 'applicationUrl',
          message: 'Application URL contains blocked domain'
        });
      }
    }

    // Content quality checks
    if (jobData.description && jobData.description.length < 50) {
      errors.push({
        field: 'description',
        message: 'Description is too short (minimum 50 characters)'
      });
    }

    // Check for spam-like content
    const spamIndicators = ['urgent', 'apply now', 'limited time', 'click here'];
    const titleLower = jobData.title?.toLowerCase() || '';
    const descriptionLower = jobData.description?.toLowerCase() || '';

    const spamCount = spamIndicators.filter(indicator =>
      titleLower.includes(indicator) || descriptionLower.includes(indicator)
    ).length;

    if (spamCount > 2) {
      errors.push({
        field: 'content',
        message: 'Content appears to be spam-like'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  applyDefaults(jobData, sourceConfig) {
    const defaults = sourceConfig.fieldDefaults || {};
    const result = { ...jobData };

    // Apply default values
    if (defaults.jobType && !result.jobType) {
      result.jobType = defaults.jobType;
    }

    if (defaults.currency && result.salary) {
      if (!result.salary.currency) {
        result.salary.currency = defaults.currency;
      }
    }

    if (defaults.category && !result.category) {
      result.category = defaults.category;
    }

    // Clean and normalize data
    if (result.title) {
      result.title = result.title.trim();
    }

    if (result.company) {
      result.company = result.company.trim();
    }

    if (result.location) {
      result.location = result.location.trim();
    }

    if (result.description) {
      result.description = result.description.trim();
    }

    // Parse dates
    if (result.postedAt && typeof result.postedAt === 'string') {
      const parsedDate = new Date(result.postedAt);
      if (!isNaN(parsedDate.getTime())) {
        result.postedAt = parsedDate;
      }
    }

    if (result.expiresAt && typeof result.expiresAt === 'string') {
      const parsedDate = new Date(result.expiresAt);
      if (!isNaN(parsedDate.getTime())) {
        result.expiresAt = parsedDate;
      }
    }

    return result;
  }

  // Custom validation functions for specific field types
  validateSalary(salaryString, sourceConfig = {}) {
    if (!salaryString || typeof salaryString !== 'string') {
      return null;
    }

    const salaryRegex = /\$([0-9,]+)\s*[-–]\s*\$?([0-9,]+)/i;
    const match = salaryString.match(salaryRegex);

    if (match) {
      return {
        min: parseInt(match[1].replace(/,/g, '')),
        max: parseInt(match[2].replace(/,/g, '')),
        currency: sourceConfig.fieldDefaults?.currency || 'USD'
      };
    }

    // Try to parse single salary value
    const singleSalaryRegex = /\$?([0-9,]+)/i;
    const singleMatch = salaryString.match(singleSalaryRegex);

    if (singleMatch) {
      const amount = parseInt(singleMatch[1].replace(/,/g, ''));
      return {
        min: amount,
        max: amount,
        currency: sourceConfig.fieldDefaults?.currency || 'USD'
      };
    }

    return null;
  }

  validateLocation(locationString) {
    if (!locationString || typeof locationString !== 'string') {
      return locationString;
    }

    return locationString
      .replace(/^\s*,\s*$/, '') // Remove stray commas
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  validateRequirements(requirementsData) {
    if (!requirementsData) {
      return [];
    }

    // Handle string input
    if (typeof requirementsData === 'string') {
      return requirementsData
        .split(/[,\n\r]+/) // Split by commas or newlines
        .map(req => req.trim())
        .filter(req => req.length > 0);
    }

    // Handle array input
    if (Array.isArray(requirementsData)) {
      return requirementsData
        .map(req => typeof req === 'string' ? req.trim() : String(req))
        .filter(req => req.length > 0);
    }

    // Handle object input (convert to string)
    if (typeof requirementsData === 'object') {
      return Object.values(requirementsData)
        .map(req => String(req).trim())
        .filter(req => req.length > 0);
    }

    return [];
  }
}

module.exports = new DataValidator();