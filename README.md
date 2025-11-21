# AI/Job Importer System

A scalable job importer system for a job board platform built with the MERN stack. The system automatically fetches job data from multiple external APIs, queues jobs using Redis for background processing, imports into MongoDB, and provides comprehensive tracking with an admin interface.

## Features

- **Multi-source Job API Integration**: Connect to various external job APIs with XML/JSON support
- **Queue-based Processing**: Redis + BullMQ for reliable, scalable background job processing
- **Comprehensive Logging**: Detailed import history with metrics, error tracking, and audit trails
- **Admin Dashboard**: Next.js interface for monitoring imports, managing job sources, and viewing statistics
- **Scalable Architecture**: Modular design ready for microservices and horizontal scaling
- **Automated Scheduling**: Cron-based periodic imports with distributed locking
- **Deduplication**: Smart job deduplication using external IDs and content hashing
- **Health Monitoring**: Real-time system health checks and performance metrics

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Job Sources   │───▶│   API Gateway   │───▶│   Redis Queue   │
│  (XML/JSON APIs)│    │  (Express.js)   │    │   (BullMQ)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Admin UI      │◀───│   API Server    │◀───│  BG Workers     │
│  (Next.js)      │    │  (Express.js)   │    │  (Node.js)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   MongoDB       │    │   Import Logs   │
                       │   (Jobs DB)     │    │   (MongoDB)     │
                       └─────────────────┘    └─────────────────┘
```

## Technology Stack

- **Backend**: Node.js + Express.js
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Database**: MongoDB + Mongoose ODM
- **Queue**: Redis + BullMQ
- **Worker**: Node.js background processes
- **Authentication**: JWT tokens (configurable)
- **Validation**: Joi schemas
- **Monitoring**: Winston logging + Health checks
- **Development**: Docker Compose + Hot reloading

## Quick Start (Docker)

### Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ (for manual setup)
- MongoDB 6.0+ (for manual setup)
- Redis 7+ (for manual setup)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd job-importer-system

# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 2. Configure Environment Variables

Edit the environment files as needed:

**Backend (backend/.env):**
```bash
MONGODB_URI=mongodb://localhost:27017/job-importer
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this
NODE_ENV=development
WORKER_CONCURRENCY=5
BATCH_SIZE=100
```

**Frontend (frontend/.env):**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_ENABLE_POLLING=true
NEXT_PUBLIC_POLLING_INTERVAL=30000
```

### 3. Start All Services

```bash
# Start all services with Docker Compose
docker-compose up -d
```

This will start:
- Backend API server on http://localhost:3001
- Frontend dashboard on http://localhost:3000
- MongoDB on localhost:27017
- Redis on localhost:6379
- Background worker processes

### 4. Access the Applications

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api
- **Health Check**: http://localhost:3001/health

### 5. Optional Development Tools

Start additional development tools:

```bash
# Start Redis GUI (Redis Commander)
docker-compose --profile tools up redis-commander

# Start MongoDB GUI (MongoDB Express)
docker-compose --profile tools up mongo-express
```

Access at:
- Redis GUI: http://localhost:8081
- MongoDB GUI: http://localhost:8082 (admin/admin123)

## Manual Setup (Without Docker)

### 1. Prerequisites

```bash
# Node.js 18+
node --version

# MongoDB 6.0+
mongod --version

# Redis 7+
redis-server --version
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start the API server
npm run dev

# In another terminal, start the worker
npm run worker
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start the development server
npm run dev
```

## Configuration

### Job Source Configuration

The system supports flexible job source configuration with custom field mapping:

```javascript
const jobSource = {
  name: 'company-jobs-api',
  url: 'https://api.company.com/jobs.xml',
  format: 'xml',
  fieldMapping: {
    id: 'job_id',
    title: 'position_title',
    company: 'company_name',
    location: 'job_location',
    description: 'job_description',
    salary: 'salary_range',
    jobType: 'employment_type',
    category: 'job_category',
    requirements: 'required_skills',
    applicationUrl: 'apply_link',
    postedAt: 'posted_date'
  },
  settings: {
    fetchInterval: 6,  // hours
    batchSize: 500,
    concurrency: 3,
    timeout: 30000     // 30 seconds
  }
};
```

### Supported Formats

- **XML**: Job listings in XML format with configurable element mapping
- **JSON**: JSON job listings with support for nested data structures
- **RSS**: RSS feeds containing job postings

### Environment Variables

Key environment variables:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/job-importer
REDIS_HOST=localhost
REDIS_PORT=6379

# API
PORT=3001
JWT_SECRET=your-secret-key
API_RATE_LIMIT=100

# Worker
WORKER_CONCURRENCY=5
BATCH_SIZE=100
QUEUE_MAX_SIZE=10000

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=./logs
```

## Usage

### 1. Add Job Sources

Via API:
```bash
curl -X POST http://localhost:3001/api/admin/job-sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "example-feed",
    "url": "https://example.com/jobs.xml",
    "format": "xml",
    "isActive": true,
    "fieldMapping": {
      "title": "job_title",
      "company": "company_name"
    }
  }'
```

### 2. Start Import

```bash
curl -X POST http://localhost:3001/api/imports/start \
  -H "Content-Type: application/json" \
  -d '{"sourceId": "source-id-here"}'
```

### 3. Monitor Progress

- View import status in the dashboard at http://localhost:3000
- Check queue status: `curl http://localhost:3001/api/admin/queue/status`
- View system health: `curl http://localhost:3001/health`

### 4. Search Jobs

```bash
# Get all jobs
curl "http://localhost:3001/api/jobs?limit=10"

# Search jobs
curl -X POST http://localhost:3001/api/jobs/search \
  -H "Content-Type: application/json" \
  -d '{"q": "developer", "filters": {"location": "Remote"}}'
```

## API Endpoints

### Import Management
- `POST /api/imports/start` - Start new import
- `GET /api/imports` - List all imports
- `GET /api/imports/:id` - Get import details
- `POST /api/imports/:id/cancel` - Cancel import
- `GET /api/imports/:id/errors` - Get import errors

### Job Management
- `GET /api/jobs` - List jobs with pagination
- `GET /api/jobs/:id` - Get job details
- `PUT /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Delete job
- `POST /api/jobs/search` - Search jobs

### Admin (Admin access required)
- `GET /api/admin/overview` - System overview
- `GET /api/admin/job-sources` - Manage job sources
- `GET /api/admin/queue/status` - Queue status
- `GET /api/admin/scheduler/status` - Scheduler status

## Development

### Project Structure

```
job-importer-system/
├── backend/
│   ├── src/
│   │   ├── controllers/     # API endpoint handlers
│   │   ├── services/        # Business logic
│   │   ├── models/          # Database models
│   │   ├── routes/          # API routes
│   │   ├── middleware/      # Express middleware
│   │   ├── utils/           # Utility functions
│   │   ├── config/          # Configuration
│   │   └── app.js           # Express app
│   ├── workers/             # Background job processors
│   ├── tests/               # Test files
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/           # Next.js pages
│   │   ├── components/      # React components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API service layer
│   │   ├── types/           # TypeScript types
│   │   └── styles/          # CSS/styling
│   └── package.json
├── docker-compose.yml       # Development environment
├── README.md                # This file
└── .gitignore
```

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

### Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run type-check
```

## Deployment

### Production Deployment with Render

1. **MongoDB Atlas**: Set up MongoDB Atlas cluster
2. **Redis Cloud**: Set up Redis Cloud instance
3. **Backend Service**: Deploy to Render as Node.js service
4. **Frontend**: Deploy to Render as Next.js static site
5. **Workers**: Deploy as separate Render background service

### Environment Variables for Production

```bash
# Production database URLs
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/job-importer
REDIS_HOST=your-redis-cloud-host
REDIS_PORT=12345
REDIS_PASSWORD=your-redis-password

# Production settings
NODE_ENV=production
JWT_SECRET=your-production-jwt-secret
PORT=3001

# Worker optimization
WORKER_CONCURRENCY=10
BATCH_SIZE=1000
```

### Docker Production Deployment

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production services
docker-compose -f docker-compose.prod.yml up -d
```

## Monitoring and Maintenance

### Health Checks

- **System Health**: `GET /health`
- **Queue Status**: `GET /api/admin/queue/status`
- **Scheduler Status**: `GET /api/admin/scheduler/status`

### Logging

Logs are automatically written to:
- `logs/api-combined.log` - All API logs
- `logs/api-error.log` - Error logs only
- `logs/worker.log` - Worker process logs
- `logs/imports.log` - Import-specific logs

### Performance Metrics

- Import success rates
- Job processing speeds
- Queue depths and wait times
- Database query performance
- API response times

### Backup and Recovery

```bash
# Database backup
mongodump --uri="mongodb://localhost:27017/job-importer" --out=./backups/

# Restore backup
mongorestore --uri="mongodb://localhost:27017/job-importer" ./backups/job-importer/
```

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```bash
   # Check Redis status
   redis-cli ping

   # Restart Redis
   docker-compose restart redis
   ```

2. **MongoDB Connection Failed**
   ```bash
   # Check MongoDB status
   docker-compose logs mongo

   # Restart MongoDB
   docker-compose restart mongo
   ```

3. **Import Jobs Not Processing**
   ```bash
   # Check queue status
   curl http://localhost:3001/api/admin/queue/status

   # Restart worker
   docker-compose restart worker
   ```

### Debug Mode

Enable debug logging:
```bash
# Backend
LOG_LEVEL=debug npm run dev

# Frontend
NEXT_PUBLIC_DEBUG=true npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style and patterns
- Write tests for new features
- Update documentation
- Ensure all tests pass before submitting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [https://docs.jobimporter.com](https://docs.jobimporter.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/job-importer-system/issues)
- **Email**: support@jobimporter.com

## Architecture Decisions

### Queue System: BullMQ vs Bull
**Decision**: BullMQ (next-generation Bull)
- Better TypeScript support
- More active development
- Improved reliability
- Better error handling

### Database: MongoDB vs PostgreSQL
**Decision**: MongoDB
- Flexible schema for varied job data
- Better for unstructured API responses
- JSON storage for metadata
- Horizontal scaling capabilities

### Frontend: Next.js vs React SPA
**Decision**: Next.js
- Built-in routing and API routes
- Server-side rendering for admin dashboard
- Easy deployment options
- Better performance for data-heavy pages

### Real-time: WebSocket vs Polling
**Decision**: Simple polling (5-second intervals)
- Simpler implementation
- Lower infrastructure complexity
- Adequate for admin dashboard needs
- Can be upgraded to WebSocket later

## Performance Benchmarks

### Expected Performance

- **Small feeds (<100 jobs)**: <30 seconds
- **Medium feeds (100-1000 jobs)**: 2-5 minutes
- **Large feeds (1000+ jobs)**: 5-15 minutes
- **Concurrent imports**: 3-5 sources simultaneously

### Scaling Considerations

- **Vertical Scaling**: Increase worker concurrency, larger Redis memory
- **Horizontal Scaling**: Multiple backend instances, separate worker servers
- **Database**: MongoDB Atlas auto-scaling, proper indexing strategy
- **Queue**: Redis clustering, multiple workers across servers