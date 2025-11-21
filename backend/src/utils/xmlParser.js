const xml2js = require('xml2js');
const winston = require('winston');

class XMLParser {
  constructor() {
    this.parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true,
      normalize: true,
      trim: true,
      emptyTag: null,
      strict: false
    });
  }

  async parse(xmlData, options = {}) {
    try {
      const result = await this.parser.parseStringPromise(xmlData);

      if (options.extractPath) {
        return this.extractByPath(result, options.extractPath);
      }

      return result;
    } catch (error) {
      winston.error('XML parsing failed:', error);
      throw new Error(`XML parsing failed: ${error.message}`);
    }
  }

  extractByPath(data, path) {
    const keys = path.split('.');
    let current = data;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }

    return current;
  }

  extractJobs(data, config) {
    try {
      let jobsContainer = data;

      // Extract jobs based on XML configuration
      if (config.xmlConfig && config.xmlConfig.rootElement) {
        jobsContainer = data[config.xmlConfig.rootElement] || data;
      }

      let jobs = [];

      if (config.xmlConfig && config.xmlConfig.jobElement) {
        const jobElement = config.xmlConfig.jobElement;

        if (Array.isArray(jobsContainer[jobElement])) {
          jobs = jobsContainer[jobElement];
        } else if (jobsContainer[jobElement]) {
          jobs = [jobsContainer[jobElement]];
        } else {
          // Try to find job elements within nested structures
          jobs = this.findJobElements(jobsContainer, jobElement);
        }
      } else {
        // Fallback: try to detect job-like structures
        jobs = this.detectJobStructures(jobsContainer);
      }

      // Normalize jobs to array
      if (!Array.isArray(jobs)) {
        jobs = [jobs];
      }

      // Filter out null/undefined values
      jobs = jobs.filter(job => job != null);

      winston.info(`Extracted ${jobs.length} jobs from XML data`);
      return jobs;

    } catch (error) {
      winston.error('Job extraction from XML failed:', error);
      throw new Error(`Job extraction failed: ${error.message}`);
    }
  }

  findJobElements(obj, elementName) {
    const jobs = [];

    if (Array.isArray(obj)) {
      for (const item of obj) {
        jobs.push(...this.findJobElements(item, elementName));
      }
    } else if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (key === elementName) {
          if (Array.isArray(value)) {
            jobs.push(...value);
          } else if (value) {
            jobs.push(value);
          }
        } else {
          jobs.push(...this.findJobElements(value, elementName));
        }
      }
    }

    return jobs;
  }

  detectJobStructures(obj) {
    const jobs = [];
    const jobIndicators = ['title', 'company', 'position', 'job', 'vacancy'];

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
          jobs.push(...this.detectJobStructures(value));
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
}

module.exports = new XMLParser();