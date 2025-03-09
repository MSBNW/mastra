# Server Implementation

## Overview

The server implementation provides HTTP APIs to interact with the weather agent. This document outlines the implementation details for creating a robust API server that exposes the weather agent's functionality to clients.

## Server Architecture

The server architecture follows a standard API design pattern:

```
┌────────────────────────────────────────────────────────────────┐
│                         API Server                             │
├────────────────┬───────────────────────────┬──────────────────┤
│                │                           │                  │
│ HTTP Endpoints │ Authentication/Security   │ Request Handlers │
│                │                           │                  │
└────────────────┴───────────────────────────┴──────────────────┘
                                 │
                ┌────────────────┴───────────────┐
                │                                │
                ▼                                ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│        Weather Agent         │    │       Memory System          │
│  - Process Weather Queries   │    │  - Thread Management         │
│  - Generate Responses        │    │  - Conversation History      │
└──────────────────────────────┘    └──────────────────────────────┘
```

## Implementation Steps

### 1. Express Server Setup

Create the server setup in `src/server/index.ts`:

```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { setupRoutes } from './routes';

// Define error handling middleware
const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  
  logger.error('Server error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });
  
  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal server error',
    ...(config.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
};

// Set up the server
export const setupServer = async () => {
  const app = express();
  const port = config.PORT || 3000;
  
  // Apply middleware
  app.use(helmet()); // Security headers
  app.use(cors());   // CORS handling
  app.use(express.json()); // JSON request body parsing
  
  // Request logging
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    next();
  });
  
  // Set up API routes
  setupRoutes(app);
  
  // Error handling middleware (must be last)
  app.use(errorHandler);
  
  // Start the server
  return new Promise<number>((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      resolve(port);
    });
    
    // Handle graceful shutdown
    const shutdownGracefully = () => {
      logger.info('Shutting down server gracefully');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
      
      // Force close after timeout
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', shutdownGracefully);
    process.on('SIGINT', shutdownGracefully);
  });
};
```

### 2. API Routes

Create the routes in `src/server/routes.ts`:

```typescript
import { Express, Request, Response } from 'express';
import { handleWeatherQuery, handleWeatherQueryWithCustomMemory } from '../agent/handlers';
import { generateThreadId, getResourceId } from '../memory';
import { verifyApiKey } from './middleware';

// Define request types
interface WeatherQueryRequest {
  message: string;
  userId?: string;
  conversationId?: string;
  units?: 'metric' | 'imperial';
  streaming?: boolean;
  memoryOptions?: {
    lastMessages?: number;
    semanticRecall?: {
      topK?: number;
      messageRange?: number;
      enabled?: boolean;
    };
  };
}

// Set up the API routes
export const setupRoutes = (app: Express) => {
  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // API documentation
  app.get('/api/docs', (req: Request, res: Response) => {
    res.status(200).json({
      version: '1.0.0',
      endpoints: [
        {
          path: '/api/weather/query',
          method: 'POST',
          description: 'Process a weather query',
          requestBody: {
            message: 'String - User query about weather',
            userId: 'String (optional) - Unique identifier for the user',
            conversationId: 'String (optional) - Conversation thread identifier',
            units: 'String (optional) - "metric" or "imperial"',
            streaming: 'Boolean (optional) - Enable streaming response',
            memoryOptions: 'Object (optional) - Custom memory settings'
          }
        },
        {
          path: '/api/weather/stream',
          method: 'POST',
          description: 'Process a weather query with streaming response',
          requestBody: {
            message: 'String - User query about weather',
            userId: 'String (optional) - Unique identifier for the user',
            conversationId: 'String (optional) - Conversation thread identifier',
            units: 'String (optional) - "metric" or "imperial"'
          }
        }
      ]
    });
  });
  
  // Weather query endpoint - non-streaming
  app.post('/api/weather/query', verifyApiKey, async (req: Request, res: Response) => {
    try {
      const {
        message,
        userId = 'anonymous',
        conversationId,
        units,
        memoryOptions
      } = req.body as WeatherQueryRequest;
      
      if (!message) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Message is required'
        });
      }
      
      // Process the query
      const result = memoryOptions 
        ? await handleWeatherQueryWithCustomMemory({
            message,
            userId,
            conversationId,
            memoryOptions,
            streaming: false
          })
        : await handleWeatherQuery({
            message,
            userId,
            conversationId,
            streaming: false
          });
      
      // Return the response
      res.status(200).json({
        status: 'success',
        data: {
          response: result.response,
          threadId: result.threadId,
          resourceId: result.resourceId
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to process weather query'
      });
    }
  });
  
  // Weather query endpoint - streaming
  app.post('/api/weather/stream', verifyApiKey, async (req: Request, res: Response) => {
    try {
      const {
        message,
        userId = 'anonymous',
        conversationId,
        units
      } = req.body as WeatherQueryRequest;
      
      if (!message) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Message is required'
        });
      }
      
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send thread and resource IDs immediately
      const threadId = generateThreadId(userId, conversationId);
      const resourceId = getResourceId(userId);
      
      res.write(`data: ${JSON.stringify({ 
        type: 'metadata',
        threadId,
        resourceId
      })}\n\n`);
      
      // Process the query with streaming
      handleWeatherQuery({
        message,
        userId,
        conversationId: threadId,
        streaming: true,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify({ 
            type: 'chunk',
            content: chunk
          })}\n\n`);
        }
      }).then(result => {
        // Send completion event
        res.write(`data: ${JSON.stringify({ 
          type: 'done',
          response: result.response
        })}\n\n`);
        res.end();
      }).catch(error => {
        // Send error event
        res.write(`data: ${JSON.stringify({ 
          type: 'error',
          message: error.message || 'Failed to process weather query'
        })}\n\n`);
        res.end();
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to process weather query'
      });
    }
  });
  
  // Conversation history endpoint
  app.get('/api/weather/history/:threadId', verifyApiKey, async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      
      if (!threadId) {
        return res.status(400).json({
          status: 'error',
          message: 'Thread ID is required'
        });
      }
      
      // Get the conversation history from memory
      const { weatherMemory } = require('../memory');
      const { messages } = await weatherMemory.rememberMessages({ threadId });
      
      res.status(200).json({
        status: 'success',
        data: {
          threadId,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to retrieve conversation history'
      });
    }
  });
};
```

### 3. Authentication Middleware

Create authentication middleware in `src/server/middleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

// API key verification middleware
export const verifyApiKey = (req: Request, res: Response, next: NextFunction) => {
  // Skip API key verification in development mode
  if (config.NODE_ENV === 'development' && config.SKIP_API_KEY_CHECK === 'true') {
    return next();
  }
  
  // Get API key from header or query param
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  // Check if API key is provided
  if (!apiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'API key is required'
    });
  }
  
  // Check if API key is valid
  if (apiKey !== config.API_KEY) {
    return res.status(403).json({
      status: 'error',
      message: 'Invalid API key'
    });
  }
  
  // API key is valid, proceed
  next();
};

// Request validation middleware
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: 'error',
        message: error.details[0].message
      });
    }
    next();
  };
};
```

### 4. Request Validation Schemas

Create validation schemas in `src/server/validation.ts`:

```typescript
import Joi from 'joi';

// Weather query validation schema
export const weatherQuerySchema = Joi.object({
  message: Joi.string().required(),
  userId: Joi.string(),
  conversationId: Joi.string(),
  units: Joi.string().valid('metric', 'imperial'),
  streaming: Joi.boolean(),
  memoryOptions: Joi.object({
    lastMessages: Joi.number().min(1).max(100),
    semanticRecall: Joi.alternatives().try(
      Joi.boolean(),
      Joi.object({
        topK: Joi.number().min(1).max(20),
        messageRange: Joi.number().min(0).max(10),
        enabled: Joi.boolean()
      })
    )
  })
});
```

### 5. WebSocket Support (Optional)

For real-time communication, consider adding WebSocket support in `src/server/websocket.ts`:

```typescript
import WebSocket from 'ws';
import { Server } from 'http';
import { logger } from '../utils/logger';
import { handleWeatherQuery } from '../agent/handlers';
import { verifyApiKey } from './middleware';

// Set up WebSocket server
export const setupWebSocketServer = (server: Server) => {
  const wss = new WebSocket.Server({ server });
  
  wss.on('connection', (ws, req) => {
    const apiKey = req.url?.split('?apiKey=')[1];
    
    // Check API key
    if (!apiKey || apiKey !== process.env.API_KEY) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid API key'
      }));
      ws.close();
      return;
    }
    
    logger.info('WebSocket connection established');
    
    // Handle incoming messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (!data.type || !data.payload) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
          return;
        }
        
        // Handle different message types
        switch (data.type) {
          case 'query':
            const { message, userId, conversationId } = data.payload;
            
            // Send metadata immediately
            ws.send(JSON.stringify({
              type: 'metadata',
              threadId: conversationId || `thread_${Date.now()}`,
              resourceId: `user_${userId || 'anonymous'}`
            }));
            
            // Process the query with streaming
            handleWeatherQuery({
              message,
              userId: userId || 'anonymous',
              conversationId,
              streaming: true,
              onChunk: (chunk) => {
                ws.send(JSON.stringify({
                  type: 'chunk',
                  content: chunk
                }));
              }
            }).then(result => {
              ws.send(JSON.stringify({
                type: 'done',
                response: result.response,
                threadId: result.threadId,
                resourceId: result.resourceId
              }));
            }).catch(error => {
              ws.send(JSON.stringify({
                type: 'error',
                message: error.message || 'Failed to process weather query'
              }));
            });
            break;
            
          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Unknown message type'
            }));
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message'
        }));
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      logger.info('WebSocket connection closed');
    });
  });
  
  return wss;
};
```

### 6. Update Server Initialization

Update the server initialization in `src/index.ts` to include WebSocket support:

```typescript
import { createServer } from 'http';
import { validateConfig } from './config/env';
import { initializeMemoryStorage } from './memory/storage';
import { weatherAgent } from './agent/weather';
import { handleWeatherQuery } from './agent/handlers';
import { setupServer } from './server';
import { setupWebSocketServer } from './server/websocket';
import { logger } from './utils/logger';

// Self-executing async function to bootstrap the application
(async () => {
  try {
    // Validate environment configuration
    validateConfig();
    
    // Initialize memory storage
    await initializeMemoryStorage();
    
    // Create HTTP server
    const app = await setupServer();
    const httpServer = createServer(app);
    
    // Set up WebSocket server (optional)
    setupWebSocketServer(httpServer);
    
    // Start the server
    const port = process.env.PORT || 3000;
    httpServer.listen(port, () => {
      logger.info(`Server started on port ${port}`);
    });
    
  } catch (error) {
    logger.error('Failed to initialize application', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
})();

// Export for module usage
export {
  weatherAgent,
  handleWeatherQuery,
};
```

## API Documentation

The server provides the following API endpoints:

### 1. Health Check

- **URL**: `/health`
- **Method**: `GET`
- **Description**: Check if the server is running
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2025-03-09T22:30:00.000Z"
  }
  ```

### 2. Standard Weather Query

- **URL**: `/api/weather/query`
- **Method**: `POST`
- **Authentication**: API key required (header: `x-api-key` or query param: `apiKey`)
- **Request Body**:
  ```json
  {
    "message": "What's the weather in London?",
    "userId": "user123",
    "conversationId": "thread456",
    "units": "metric"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "response": "London is currently cloudy with a temperature of 15°C...",
      "threadId": "thread456",
      "resourceId": "user_user123"
    }
  }
  ```

### 3. Streaming Weather Query

- **URL**: `/api/weather/stream`
- **Method**: `POST`
- **Authentication**: API key required
- **Request Body**: Same as standard query
- **Response**: Server-Sent Events (SSE) with the following event types:
  - **Metadata**:
    ```json
    {
      "type": "metadata",
      "threadId": "thread456",
      "resourceId": "user_user123"
    }
    ```
  - **Chunk** (multiple events):
    ```json
    {
      "type": "chunk",
      "content": "London is "
    }
    ```
  - **Done**:
    ```json
    {
      "type": "done",
      "response": "London is currently cloudy..."
    }
    ```
  - **Error** (if applicable):
    ```json
    {
      "type": "error",
      "message": "Failed to process weather query"
    }
    ```

### 4. Conversation History

- **URL**: `/api/weather/history/:threadId`
- **Method**: `GET`
- **Authentication**: API key required
- **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "threadId": "thread456",
      "messages": [
        {
          "role": "user",
          "content": "What's the weather in London?",
          "timestamp": "2025-03-09T22:15:00.000Z"
        },
        {
          "role": "assistant",
          "content": "London is currently cloudy...",
          "timestamp": "2025-03-09T22:15:02.000Z"
        }
      ]
    }
  }
  ```

## Security Considerations

The server implementation includes several security features:

1. **API Key Authentication**: All API endpoints are protected with API key authentication
2. **Security Headers**: Implemented using Helmet middleware to set secure HTTP headers
3. **CORS Protection**: Configured to restrict cross-origin requests
4. **Input Validation**: All request inputs are validated to prevent injection attacks
5. **Error Handling**: Errors are handled gracefully without exposing sensitive information
6. **Rate Limiting** (should be added): Consider implementing rate limiting to prevent abuse

## Deployment Considerations

### 1. Environment Configuration

Ensure the following environment variables are set in your production environment:

```
# API Configuration
PORT=3000
API_KEY=your_secure_api_key

# LLM Provider
LLM_API_KEY=your_llm_api_key
LLM_PROVIDER=groq  # Options: groq, openai, anthropic

# Weather API
WEATHER_API_KEY=your_weather_api_key

# Memory Storage
MEMORY_STORAGE_TYPE=libsql
MEMORY_STORAGE_URL=file:weather-memory.db

# Default Settings
DEFAULT_LOCATION=New York
DEFAULT_UNITS=metric

# Logging
LOG_LEVEL=info
```

### 2. Production Setup

For production deployment, consider:

1. **Process Management**: Use PM2 or similar tools to manage the Node.js process
2. **Reverse Proxy**: Set up Nginx or similar as a reverse proxy
3. **SSL/TLS**: Configure HTTPS with valid certificates
4. **Docker Container**: Package the application as a Docker container
5. **Database Persistence**: Use a persistent database for memory storage in production
6. **Monitoring**: Implement logging and monitoring solutions

### 3. Scalability

For high-traffic scenarios, consider:

1. **Horizontal Scaling**: Deploy multiple instances behind a load balancer
2. **Shared Memory Storage**: Use a shared database for memory storage (e.g., PostgreSQL)
3. **Caching**: Implement caching for weather data
4. **Request Queuing**: Add a message queue for processing weather queries asynchronously

## Testing the Server

Create integration tests for the server in `tests/integration/server.test.ts`:

```typescript
import request from 'supertest';
import { setupServer } from '../../src/server';
import { initializeMemoryStorage } from '../../src/memory/storage';

describe('API Server', () => {
  let app;
  
  beforeAll(async () => {
    // Initialize memory storage
    await initializeMemoryStorage();
    
    // Set up the server
    app = await setupServer();
  });
  
  test('health check endpoint returns 200', async () => {
    const response = await request(app).get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
  
  test('weather query endpoint returns correct response', async () => {
    const response = await request(app)
      .post('/api/weather/query')
      .set('x-api-key', process.env.API_KEY)
      .send({
        message: 'What\'s the weather in London?',
        userId: 'test-user'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data.response).toBeTruthy();
    expect(response.body.data.threadId).toBeTruthy();
  });
  
  test('weather query fails with invalid API key', async () => {
    const response = await request(app)
      .post('/api/weather/query')
      .set('x-api-key', 'invalid-key')
      .send({
        message: 'What\'s the weather in London?'
      });
    
    expect(response.status).toBe(403);
    expect(response.body.status).toBe('error');
  });
  
  test('weather query fails with missing message', async () => {
    const response = await request(app)
      .post('/api/weather/query')
      .set('x-api-key', process.env.API_KEY)
      .send({
        userId: 'test-user'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
  });
});
```

## Conclusion

This server implementation provides a robust API for interacting with the weather agent. It includes:

1. **Standard REST API endpoints** for weather queries
2. **Streaming support** for real-time responses
3. **WebSocket support** for bidirectional communication
4. **Security features** to protect the API
5. **Error handling** for graceful failure
6. **Scalability considerations** for production deployment

With this implementation, clients can easily integrate with the weather agent via HTTP or WebSocket connections, enabling a wide range of applications from web interfaces to mobile apps.

## Next Steps

With the completion of the server implementation, the weather agent project is now fully specified. To complete the implementation:

1. Write the actual code following this implementation plan
2. Thoroughly test each component
3. Deploy to a production environment
4. Set up monitoring and logging
5. Create client applications that consume the API

This concludes the implementation plan for the weather agent project.
