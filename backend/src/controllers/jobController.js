const Job = require('../models/Job');
const winston = require('winston');

class JobController {
  // Get all jobs with pagination and filtering
  async getJobs(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        source,
        category,
        jobType,
        location,
        company,
        search,
        activeOnly = true,
        sortBy = 'postedAt',
        sortOrder = 'desc',
        minSalary,
        maxSalary
      } = req.query;

      // Build filters
      const filters = {};

      if (activeOnly === 'true') {
        filters.isActive = true;
      }

      if (source) {
        filters.source = source;
      }

      if (category) {
        filters.category = new RegExp(category, 'i');
      }

      if (jobType) {
        filters.jobType = jobType;
      }

      if (location) {
        filters.location = new RegExp(location, 'i');
      }

      if (company) {
        filters.company = new RegExp(company, 'i');
      }

      // Salary filters
      if (minSalary || maxSalary) {
        filters['salary.min'] = {};
        if (minSalary) filters['salary.min'].$gte = parseInt(minSalary);
        if (maxSalary) filters['salary.max'] = { $lte: parseInt(maxSalary) };
      }

      // Date filters - only show jobs posted within last 90 days by default
      const daysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      filters.postedAt = { $gte: daysAgo };

      // Search functionality
      let searchResults;
      if (search) {
        searchResults = await Job.searchJobs(search, {
          activeOnly: activeOnly === 'true',
          jobType,
          category,
          limit: parseInt(limit) * 2, // Get more for filtering
          skip: 0
        });
      }

      // Build sort options
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Execute query
      let query, total;

      if (search) {
        // Use search results
        const searchIds = searchResults.map(job => job._id);
        query = Job.find({ _id: { $in: searchIds }, ...filters });
        total = searchResults.length;
      } else {
        query = Job.find(filters);
        total = await Job.countDocuments(filters);
      }

      const skip = (page - 1) * limit;

      const jobs = await query
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Format jobs for API response
      const formattedJobs = jobs.map(job => new Job(job).toAPIResponse());

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          jobs: formattedJobs,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            itemsPerPage: parseInt(limit),
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
          },
          filters: {
            source,
            category,
            jobType,
            location,
            company,
            search,
            activeOnly: activeOnly === 'true',
            salaryRange: { min: minSalary, max: maxSalary }
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch jobs',
        details: error.message
      });
    }
  }

  // Get specific job details
  async getJob(req, res) {
    try {
      const { id } = req.params;

      const job = await Job.findById(id).lean();
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }

      const jobData = new Job(job).toAPIResponse();

      res.status(200).json({
        success: true,
        data: jobData
      });

    } catch (error) {
      winston.error('Failed to get job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch job',
        details: error.message
      });
    }
  }

  // Update a job
  async updateJob(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const job = await Job.findById(id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }

      // Update allowed fields only
      const allowedFields = [
        'title', 'company', 'location', 'description', 'salary',
        'jobType', 'category', 'requirements', 'applicationUrl',
        'postedAt', 'expiresAt', 'isActive', 'metadata'
      ];

      const updateObj = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateObj[field] = updateData[field];
        }
      }

      const updatedJob = await Job.findByIdAndUpdate(
        id,
        { $set: updateObj },
        { new: true, runValidators: true }
      ).lean();

      const jobData = new Job(updatedJob).toAPIResponse();

      res.status(200).json({
        success: true,
        data: jobData,
        message: 'Job updated successfully'
      });

      winston.info(`Job updated`, { jobId: id, updatedFields: Object.keys(updateObj) });

    } catch (error) {
      winston.error('Failed to update job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update job',
        details: error.message
      });
    }
  }

  // Delete a job
  async deleteJob(req, res) {
    try {
      const { id } = req.params;

      const job = await Job.findByIdAndDelete(id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Job deleted successfully',
        deletedJob: {
          id: job._id,
          title: job.title,
          company: job.company,
          source: job.source
        }
      });

      winston.info(`Job deleted`, { jobId: id, title: job.title, company: job.company });

    } catch (error) {
      winston.error('Failed to delete job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete job',
        details: error.message
      });
    }
  }

  // Get job statistics
  async getJobStats(req, res) {
    try {
      const { source, days = 30 } = req.query;

      // Get general statistics
      const totalJobs = await Job.countDocuments({ isActive: true });
      const activeJobs = await Job.countDocuments({ isActive: true });
      const inactiveJobs = await Job.countDocuments({ isActive: false });

      // Get source breakdown
      const sourceMatch = source ? { source } : {};
      const sourceStats = await Job.getStatsBySource();

      // Get category breakdown
      const categoryStats = await Job.aggregate([
        { $match: { isActive: true, ...sourceMatch } },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            avgSalaryMin: { $avg: '$salary.min' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]);

      // Get job type breakdown
      const jobTypeStats = await Job.aggregate([
        { $match: { isActive: true, ...sourceMatch } },
        {
          $group: {
            _id: '$jobType',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      // Get location breakdown
      const locationStats = await Job.aggregate([
        { $match: { isActive: true, ...sourceMatch } },
        {
          $group: {
            _id: '$location',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]);

      // Get recent trends (jobs posted per day)
      const trends = await Job.aggregate([
        {
          $match: {
            postedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
            ...sourceMatch
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$postedAt' },
              month: { $month: '$postedAt' },
              day: { $dayOfMonth: '$postedAt' }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
        }
      ]);

      // Get salary statistics
      const salaryStats = await Job.aggregate([
        { $match: { isActive: true, 'salary.min': { $gt: 0 }, ...sourceMatch } },
        {
          $group: {
            _id: null,
            avgSalaryMin: { $avg: '$salary.min' },
            avgSalaryMax: { $avg: '$salary.max' },
            minSalary: { $min: '$salary.min' },
            maxSalary: { $max: '$salary.max' },
            count: { $sum: 1 }
          }
        }
      ]);

      res.status(200).json({
        success: true,
        data: {
          overview: {
            totalJobs,
            activeJobs,
            inactiveJobs
          },
          breakdown: {
            sources: sourceStats,
            categories: categoryStats,
            jobTypes: jobTypeStats,
            locations: locationStats
          },
          trends,
          salary: salaryStats[0] || {
            avgSalaryMin: 0,
            avgSalaryMax: 0,
            minSalary: 0,
            maxSalary: 0,
            count: 0
          },
          period: {
            days: parseInt(days),
            startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            endDate: new Date()
          }
        }
      });

    } catch (error) {
      winston.error('Failed to get job stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch job statistics',
        details: error.message
      });
    }
  }

  // Bulk operations on jobs
  async bulkUpdateJobs(req, res) {
    try {
      const { jobIds, updateData } = req.body;

      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Job IDs array is required'
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Update data is required'
        });
      }

      // Validate update data
      const allowedFields = ['isActive', 'category', 'jobType'];
      const updateObj = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateObj[field] = updateData[field];
        }
      }

      if (Object.keys(updateObj).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update'
        });
      }

      const result = await Job.updateMany(
        { _id: { $in: jobIds } },
        { $set: updateObj },
        { runValidators: true }
      );

      res.status(200).json({
        success: true,
        data: {
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          requestedCount: jobIds.length,
          updateData: updateObj
        },
        message: `Updated ${result.modifiedCount} jobs successfully`
      });

      winston.info(`Bulk job update completed`, {
        requestedIds: jobIds.length,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        updateData: updateObj
      });

    } catch (error) {
      winston.error('Failed to bulk update jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to bulk update jobs',
        details: error.message
      });
    }
  }

  // Search jobs with advanced filters
  async searchJobs(req, res) {
    try {
      const {
        q: query,
        filters = {},
        page = 1,
        limit = 20,
        sortBy = 'relevance'
      } = req.body;

      if (!query || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Search query is required'
        });
      }

      const searchOptions = {
        ...filters,
        limit: parseInt(limit),
        skip: (page - 1) * limit
      };

      const results = await Job.searchJobs(query, searchOptions);

      // Get total count for pagination
      const totalQuery = Job.searchJobs(query, { ...filters, limit: 10000 });
      const total = totalQuery.length;

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          jobs: results.map(job => new Job(job).toAPIResponse()),
          search: {
            query,
            filters,
            sortBy
          },
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      winston.error('Failed to search jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search jobs',
        details: error.message
      });
    }
  }
}

module.exports = new JobController();