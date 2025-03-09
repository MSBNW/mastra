# Memory System Implementation

## Overview

The memory system is a critical component of our weather agent that enables contextual conversations. It allows the agent to:

1. Remember previous locations mentioned by the user
2. Recall specific weather details from earlier in the conversation
3. Maintain context across multiple messages and sessions
4. Support semantic search for finding relevant past interactions

This document outlines the implementation details for setting up and configuring the memory system.

## Memory Architecture

The Mastra memory system consists of several key components:

```
┌───────────────────────────────────────────────┐
│                Memory System                  │
├───────────────┬───────────────┬───────────────┤
│  Message      │  Semantic     │  Storage      │
│  History      │  Search       │  Backend      │
└───────┬───────┴───────┬───────┴───────┬───────┘
        │               │               │
        ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Recent        │ │ Vector        │ │ Persistence   │
│ Messages      │ │ Embeddings    │ │ Layer         │
└───────────────┘ └───────────────┘ └───────────────┘
```

## Implementation Steps

### 1. Memory Configuration

Create a memory configuration module in `src/memory/index.ts`:

```typescript
import { Memory } from '@mastra/memory';
import { config } from '../config/env';

// Determine the storage backend based on configuration
const getStorageBackend = () => {
  switch (config.MEMORY_STORAGE_TYPE) {
    case 'postgres':
      const { PostgresStore } = require('@mastra/pg');
      return new PostgresStore({
        connectionString: config.MEMORY_STORAGE_URL,
      });
    case 'libsql':
    default:
      const { LibSQLStore } = require('@mastra/core/storage/libsql');
      return new LibSQLStore({
        config: {
          url: config.MEMORY_STORAGE_URL || 'file:weather-memory.db',
        },
      });
  }
};

// Configure memory for weather agent with optimized settings
export const weatherMemory = new Memory({
  storage: getStorageBackend(),
  options: {
    lastMessages: 20, // Keep more messages for weather context
    semanticRecall: {
      topK: 3,         // Number of semantically similar messages to retrieve
      messageRange: 2, // Context around each match (previous/next messages)
    },
    workingMemory: {
      enabled: true,   // Enable persistent working memory
      template: `
        <location>
          <current></current>
          <previous></previous>
          <favorites></favorites>
        </location>
        <preferences>
          <units></units>
          <detail_level></detail_level>
        </preferences>
      `,
    },
  },
});

// Utility to generate consistent thread IDs
export const generateThreadId = (userId: string, conversationId?: string) => {
  return conversationId || `weather_${userId}_${Date.now()}`;
};

// Utility to ensure consistent resource IDs
export const getResourceId = (userId: string) => {
  return `user_${userId}`;
};
```

### 2. Environment Configuration

Update the environment configuration in `src/config/env.ts` to handle memory-related settings:

```typescript
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
  // LLM settings
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'groq',
  
  // Weather API settings
  WEATHER_API_KEY: process.env.WEATHER_API_KEY || '',
  WEATHER_API_URL: process.env.WEATHER_API_URL || 'https://api.openweathermap.org/data/2.5',
  
  // Memory settings
  MEMORY_STORAGE_TYPE: process.env.MEMORY_STORAGE_TYPE || 'libsql',
  MEMORY_STORAGE_URL: process.env.MEMORY_STORAGE_URL || 'file:weather-memory.db',
  
  // Optional vector database settings
  VECTOR_DB_URL: process.env.VECTOR_DB_URL,
  
  // Server settings
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Validate required configuration
export const validateConfig = () => {
  const requiredVars = ['LLM_API_KEY', 'WEATHER_API_KEY'];
  const missingVars = requiredVars.filter(varName => !config[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
  
  return true;
};
```

### 3. Memory Utilities

Create additional utility functions for working with memory in `src/memory/utils.ts`:

```typescript
import { Memory } from '@mastra/memory';

// Extract location information from conversation context
export const extractLocationFromContext = async (
  memory: Memory,
  threadId: string,
  defaultLocation?: string
) => {
  try {
    // Get the system message which may contain working memory
    const systemMessage = await memory.getSystemMessage({ threadId });
    
    if (systemMessage) {
      // Check for location in working memory
      const locationMatch = /<current>(.*?)<\/current>/g.exec(systemMessage);
      if (locationMatch && locationMatch[1]) {
        return locationMatch[1];
      }
    }
    
    // If no location in working memory, check recent messages
    const { messages } = await memory.rememberMessages({ threadId });
    
    // Loop through messages in reverse (most recent first)
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      
      if (message.role === 'user') {
        // Use a regex to find location mentions
        // This is simplified - a more robust approach might use NLP
        const locationMatches = message.content.match(/weather (?:in|at|for) ([A-Za-z\s,]+)/i);
        if (locationMatches && locationMatches[1]) {
          return locationMatches[1].trim();
        }
      }
    }
    
    // Fall back to default location if provided
    return defaultLocation;
  } catch (error) {
    console.error('Error extracting location from context:', error);
    return defaultLocation;
  }
};

// Update working memory with location information
export const updateLocationInMemory = async (
  memory: Memory,
  threadId: string,
  location: string
) => {
  try {
    // Get current system message/working memory
    const systemMessage = await memory.getSystemMessage({ threadId });
    
    if (systemMessage) {
      // Update current location in working memory
      let updatedMessage = systemMessage;
      
      // Get current location to move to previous
      const currentMatch = /<current>(.*?)<\/current>/g.exec(systemMessage);
      const currentLocation = currentMatch && currentMatch[1] ? currentMatch[1] : '';
      
      if (currentLocation && currentLocation !== location) {
        // Move current to previous if they're different
        updatedMessage = updatedMessage.replace(
          /<previous>(.*?)<\/previous>/g,
          `<previous>${currentLocation}</previous>`
        );
      }
      
      // Update current location
      updatedMessage = updatedMessage.replace(
        /<current>(.*?)<\/current>/g,
        `<current>${location}</current>`
      );
      
      // Call updateWorkingMemory tool 
      // This implementation depends on the specific Memory implementation
      // For Mastra's Memory API, this is typically handled through special tags
      // in the agent's response
      
      // Note: In a complete implementation, this would be handled by the agent's
      // built-in working memory mechanism, but we include this as a utility method
      // for direct updates when needed
    }
  } catch (error) {
    console.error('Error updating location in memory:', error);
  }
};
```

### 4. Memory Storage Initialization

Create a module to initialize the memory storage in `src/memory/storage.ts`:

```typescript
import { config } from '../config/env';
import fs from 'fs';
import path from 'path';

// Initialize the memory storage database
export const initializeMemoryStorage = async () => {
  // For LibSQL file-based storage, ensure the directory exists
  if (config.MEMORY_STORAGE_TYPE === 'libsql' && 
      config.MEMORY_STORAGE_URL.startsWith('file:')) {
    
    // Extract the file path from the URL
    const dbPath = config.MEMORY_STORAGE_URL.replace('file:', '');
    const dbDir = path.dirname(dbPath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
      console.log(`Creating memory storage directory: ${dbDir}`);
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }
  
  // Additional initialization for other storage types would go here
  
  console.log(`Memory storage initialized with ${config.MEMORY_STORAGE_TYPE}`);
  return true;
};
```

## Memory Configuration Decisions

For the weather agent, we've made the following configuration choices:

1. **Increased `lastMessages` to 20**: Weather conversations often involve comparing conditions across days or locations, requiring more context than the default 10 messages.

2. **Set `topK` to 3 for semantic search**: This retrieves three semantically similar past messages, which helps when users ask about locations they've previously discussed.

3. **Set `messageRange` to 2**: This includes two messages before and after each semantically relevant message, providing better context for understanding the user's query.

4. **Enabled working memory**: This allows the agent to maintain structured information about:
   - Current location being discussed
   - Previous locations for reference
   - User preferences like temperature units (°F/°C)

## Thread and Resource Management

For proper memory functionality, it's essential to use consistent thread and resource IDs:

- **Thread ID**: Represents a specific conversation session
  - A new weather inquiry might create a new thread
  - Follow-up questions should use the same thread ID

- **Resource ID**: Identifies the user
  - Typically derived from user authentication
  - Enables personalization across multiple conversations

The utility functions `generateThreadId` and `getResourceId` help ensure consistent ID generation.

## Testing Memory Implementation

Create tests for the memory system in `tests/unit/memory.test.ts`:

```typescript
import { Memory } from '@mastra/memory';
import { extractLocationFromContext, updateLocationInMemory } from '../../src/memory/utils';

// Mock Memory implementation for testing
jest.mock('@mastra/memory');

describe('Memory System', () => {
  let mockMemory;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create a mock memory instance
    mockMemory = new Memory();
    mockMemory.getSystemMessage = jest.fn();
    mockMemory.rememberMessages = jest.fn();
  });
  
  describe('extractLocationFromContext', () => {
    test('should extract location from working memory', async () => {
      // Set up mock return value for getSystemMessage
      mockMemory.getSystemMessage.mockResolvedValue(`
        <location>
          <current>New York</current>
          <previous>Miami</previous>
          <favorites></favorites>
        </location>
      `);
      
      const location = await extractLocationFromContext(mockMemory, 'thread-123');
      expect(location).toBe('New York');
    });
    
    test('should extract location from recent messages if not in working memory', async () => {
      // No location in working memory
      mockMemory.getSystemMessage.mockResolvedValue(`
        <location>
          <current></current>
          <previous></previous>
          <favorites></favorites>
        </location>
      `);
      
      // But there is a location in recent messages
      mockMemory.rememberMessages.mockResolvedValue({
        messages: [
          { role: 'user', content: 'What is the weather in Boston today?' },
          { role: 'assistant', content: 'The weather in Boston is sunny...' }
        ]
      });
      
      const location = await extractLocationFromContext(mockMemory, 'thread-123');
      expect(location).toBe('Boston');
    });
    
    test('should return default location if no location found', async () => {
      // No location in working memory
      mockMemory.getSystemMessage.mockResolvedValue(null);
      
      // No location in recent messages
      mockMemory.rememberMessages.mockResolvedValue({
        messages: [
          { role: 'user', content: 'What will the weather be like tomorrow?' },
          { role: 'assistant', content: 'I need to know your location to answer that.' }
        ]
      });
      
      const location = await extractLocationFromContext(mockMemory, 'thread-123', 'Default City');
      expect(location).toBe('Default City');
    });
  });
});
```

## Next Steps

Proceed to [04-weather-api.md](04-weather-api.md) for details on implementing the Weather API integration.
