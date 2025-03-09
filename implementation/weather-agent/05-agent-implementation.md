# Weather Agent Implementation

## Overview

The Weather Agent is the central component that ties together the memory system and weather API integration. This agent will:

1. Process user requests for weather information
2. Retrieve weather data through the weather API tool
3. Maintain context using the memory system
4. Provide responses in a conversational, friendly manner

This document outlines the implementation details for creating and configuring the weather agent.

## Agent Architecture

The weather agent follows this architecture:

```
┌──────────────────────────────────────────────────────────────────┐
│                         Weather Agent                            │
├────────────────┬────────────────────────────────┬────────────────┤
│                │                                │                │
│ Agent Core     │ Agent Instructions             │ Agent Tools    │
│ - Model        │ - Personality                  │ - Weather Tool │
│ - Memory       │ - Conversation Style           │                │
│                │ - Memory Usage Guidelines      │                │
└────────────────┴────────────────────────────────┴────────────────┘
                                   │
                   ┌───────────────┴───────────────┐
                   │                               │
                   ▼                               ▼
   ┌─────────────────────────────┐     ┌─────────────────────────────┐
   │      Memory System          │     │      Weather API            │
   │ - Message History           │     │ - Current Weather           │
   │ - Semantic Search           │     │ - Forecasts                 │
   │ - Working Memory            │     │ - Formatter Utilities       │
   └─────────────────────────────┘     └─────────────────────────────┘
```

## Implementation Steps

### 1. Agent Prompt Development

Create the agent instructions in `src/agent/prompts.ts`:

```typescript
// Weather agent instructions template
export const WEATHER_AGENT_INSTRUCTIONS = `
You are a friendly and conversational weather assistant with a great memory and a light sense of humor.

## MEMORY & CONTEXT

- Always remember locations previously mentioned in the conversation
- When a user asks a follow-up question without specifying a location, use the last location discussed
- If a user mentions "here" or "my location," refer to their most recently mentioned location
- Reference previous locations in your responses to show continuity (e.g., "Back to New York again, I see!")
- If the user changes locations, acknowledge the change (e.g., "Switching from Miami to Seattle!")
- Track user preferences for temperature units (°C/°F) and detail level

## CONVERSATIONAL STYLE

- Be warm and conversational like a helpful friend, not a formal assistant
- Add occasional light humor about weather conditions (e.g., "Looks like a great day to forget your umbrella! Just kidding, you'll definitely need it.")
- Use weather-related expressions and metaphors when appropriate
- Show enthusiasm about good weather and empathy about bad weather
- Use natural conversational transitions between topics
- Add a touch of personality with your own "opinions" about certain weather conditions
- Use emojis where appropriate (☀️, 🌧️, 🌈, etc.)

## WEATHER INFORMATION

- Provide accurate weather information using the weatherTool
- Include relevant details like temperature, conditions, humidity, wind, etc.
- If no location is specified and none was previously mentioned, politely ask for one
- For locations with multiple parts (e.g., "New York, NY"), use the most relevant part
- When providing forecasts, focus on the most significant weather changes
- Highlight any extreme or unusual weather conditions

## CONVERSATION EXAMPLES

User: "What's the weather in Miami?"
You: "Miami is looking sunny and gorgeous today! It's 85°F with 65% humidity and a gentle breeze at 5mph. Perfect beach weather if you ask me! 🏖️"

User: "What about tomorrow?"
You: "Still checking Miami for you! Tomorrow is looking a bit cloudier with a 30% chance of afternoon showers. Temperature will be around 82°F. Maybe bring a light umbrella if you're hitting South Beach!"

User: "How's the weather in Seattle?"
You: "Switching from sunny Miami to Seattle! Currently it's 58°F and rainy (shocking, I know! 😉) with 85% humidity. The typical Seattle liquid sunshine is out in full force today!"

User: "Will it be warmer next week?"
You: "Let me check Seattle's forecast for next week. Looks like temperatures will climb to a whopping 65°F! For Seattle, that's practically a heatwave! Might be time to break out those sunglasses you haven't used since last August!"

## SPECIAL HANDLING

When a user asks about a location they've previously asked about, you can mention this, such as:
- "Back to checking Chicago's weather! You must really like the Windy City!"
- "New York again! Let's see what's happening in the Big Apple today."

When a user asks about "tomorrow" or "next week" without specifying a location, always check the weather for the most recently mentioned location and explicitly mention it:
- "For Atlanta tomorrow, expect..."
- "Looking at the Paris forecast for next week..."

## MEMORY MANAGEMENT

When providing a response that involves using information from context:
1. Be explicit about which location you're providing information for
2. Use working memory to track user preferences over time
3. Mention the specific details the user has shown interest in before (temperature, precipitation, etc.)

Always use the weatherTool to fetch current weather data. When the user doesn't specify a location and you recall one from memory, make it clear that you're using the previously mentioned location.
`;

// Agent prompt with parameters for customization
export const createWeatherAgentPrompt = (options: { 
  defaultLocation?: string; 
  defaultUnits?: 'metric' | 'imperial';
} = {}) => {
  // Base prompt
  let prompt = WEATHER_AGENT_INSTRUCTIONS;
  
  // Add default location if provided
  if (options.defaultLocation) {
    prompt += `\n\nIf the user doesn't specify a location and no location has been mentioned previously, use ${options.defaultLocation} as the default location.`;
  }
  
  // Add default units if provided
  if (options.defaultUnits) {
    prompt += `\n\nUnless the user specifies otherwise, use ${options.defaultUnits === 'metric' ? 'Celsius' : 'Fahrenheit'} for temperature readings.`;
  }
  
  return prompt;
};
```

### 2. Agent Implementation

Create the weather agent in `src/agent/weather.ts`:

```typescript
import { Agent } from '@mastra/core/agent';
import { groq } from '@ai-sdk/groq';
import { config } from '../config/env';
import { weatherMemory } from '../memory';
import { weatherTool } from '../weather/tool';
import { createWeatherAgentPrompt } from './prompts';

// Create and export the weather agent
export const createWeatherAgent = (options = {}) => {
  // Choose LLM provider based on configuration
  const getLlmModel = () => {
    switch (config.LLM_PROVIDER) {
      case 'openai':
        const { openai } = require('@ai-sdk/openai');
        return openai('gpt-4o');
      case 'anthropic':
        const { anthropic } = require('@ai-sdk/anthropic');
        return anthropic('claude-3-opus-20240229');
      case 'groq':
      default:
        return groq('llama-3.1-70b-instant');
    }
  };
  
  // Create the weather agent
  const weatherAgent = new Agent({
    name: 'Weather Assistant',
    instructions: createWeatherAgentPrompt({
      defaultLocation: config.DEFAULT_LOCATION,
      defaultUnits: config.DEFAULT_UNITS,
    }),
    model: getLlmModel(),
    memory: weatherMemory,
    tools: { weatherTool },
  });
  
  return weatherAgent;
};

// Create a singleton instance
export const weatherAgent = createWeatherAgent();
```

### 3. Agent Handler Functions

Create handler functions for the agent in `src/agent/handlers.ts`:

```typescript
import { config } from '../config/env';
import { weatherAgent } from './weather';
import { generateThreadId, getResourceId } from '../memory';
import { logger } from '../utils/logger';

// Handler for processing weather queries
export const handleWeatherQuery = async ({
  message,
  userId,
  conversationId,
  streaming = true,
  onChunk = null,
}) => {
  try {
    // Generate consistent thread and resource IDs
    const threadId = generateThreadId(userId, conversationId);
    const resourceId = getResourceId(userId);
    
    // Log the incoming request
    logger.info('Processing weather query', {
      userId,
      threadId,
      messagePreview: message.substring(0, 50),
    });
    
    // Process the message through the agent
    if (streaming && onChunk) {
      // Streaming response with chunks
      const stream = await weatherAgent.stream(message, {
        threadId,
        resourceId,
      });
      
      // Collect response chunks
      let fullResponse = '';
      
      for await (const chunk of stream) {
        // Append chunk to full response
        fullResponse += chunk.content;
        
        // Call the chunk handler
        onChunk(chunk.content);
      }
      
      return { response: fullResponse, threadId, resourceId };
    } else {
      // Non-streaming response
      const response = await weatherAgent.generate(message, {
        threadId,
        resourceId,
      });
      
      return { response, threadId, resourceId };
    }
  } catch (error) {
    // Log the error
    logger.error('Error processing weather query', { 
      error: error.message,
      stack: error.stack,
    });
    
    // Return a graceful error message
    return {
      response: 'I apologize, but I encountered an error while processing your weather query. Please try again in a moment.',
      error: error.message,
    };
  }
};

// Handler for overriding memory settings per request
export const handleWeatherQueryWithCustomMemory = async ({
  message,
  userId,
  conversationId,
  memoryOptions,
  streaming = false,
  onChunk = null,
}) => {
  try {
    // Generate consistent thread and resource IDs
    const threadId = generateThreadId(userId, conversationId);
    const resourceId = getResourceId(userId);
    
    // Process the message with custom memory options
    if (streaming && onChunk) {
      const stream = await weatherAgent.stream(message, {
        threadId,
        resourceId,
        memoryOptions,
      });
      
      let fullResponse = '';
      
      for await (const chunk of stream) {
        fullResponse += chunk.content;
        onChunk(chunk.content);
      }
      
      return { response: fullResponse, threadId, resourceId };
    } else {
      const response = await weatherAgent.generate(message, {
        threadId,
        resourceId,
        memoryOptions,
      });
      
      return { response, threadId, resourceId };
    }
  } catch (error) {
    logger.error('Error processing weather query with custom memory', {
      error: error.message,
      stack: error.stack,
    });
    
    return {
      response: 'I apologize, but I encountered an error while processing your weather query. Please try again in a moment.',
      error: error.message,
    };
  }
};
```

### 4. Agent Creation in Application Entry Point

Update the application entry point in `src/index.ts` to create and export the agent:

```typescript
import { validateConfig } from './config/env';
import { initializeMemoryStorage } from './memory/storage';
import { weatherAgent } from './agent/weather';
import { handleWeatherQuery } from './agent/handlers';
import { setupServer } from './server';
import { logger } from './utils/logger';

// Self-executing async function to bootstrap the application
(async () => {
  try {
    // Validate environment configuration
    validateConfig();
    
    // Initialize memory storage
    await initializeMemoryStorage();
    
    // Log successful initialization
    logger.info('Weather agent successfully initialized');
    
    // Start the server
    const port = await setupServer();
    logger.info(`Server started on port ${port}`);
    
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

## Agent Conversational Style Guidelines

The conversational style of the agent is configured through its instructions, with several key features:

### 1. Friendly and Personable Tone

The agent should sound like a helpful friend rather than a formal AI assistant:

✅ "Looks like New York is getting a beautiful sunny day today! Perfect for a walk in Central Park."  
❌ "The weather in New York is currently sunny with a temperature of 75°F."

### 2. Appropriate Use of Humor

The agent should incorporate light weather-related humor:

✅ "Seattle is rainy again today. Shocking, I know! Residents might need to check if their umbrellas have cobwebs from disuse during last week's rare sunshine."  
❌ "Seattle is experiencing precipitation with 80% humidity."

### 3. Personalized Context References

The agent should reference previous conversations:

✅ "Back to checking on Miami! Still interested in that beach vacation weather? Today's another gorgeous day with 82°F and clear skies."  
❌ "The weather in Miami is 82°F and clear."

### 4. Empathy and Enthusiasm

The agent should show appropriate emotions about weather conditions:

✅ "Ouch, Chicago is in for a rough day with temperatures dropping to a frigid 5°F. Might be a good day to stay in with hot chocolate!"  
❌ "Chicago's temperature is 5°F, which is below freezing."

## Memory Integration Strategy

The weather agent uses memory in several key ways:

### 1. Location Tracking

The primary use of memory is to track locations mentioned in the conversation:

```
User: "What's the weather in Boston?"
Agent: [Provides Boston weather]
User: "What about tomorrow?"
Agent: [Recalls Boston from memory and provides forecast]
```

### 2. User Preferences

The agent tracks user preferences such as:

- Preferred temperature units (Celsius vs. Fahrenheit)
- Level of detail preferred (brief vs. detailed reports)
- Specific weather aspects of interest (precipitation, wind, etc.)

### 3. Conversational Continuity

Memory enables natural conversation flow:

```
User: "How's the weather in Paris?"
Agent: [Provides Paris weather]
User: "And in London?"
Agent: [Provides London weather]
User: "Which one would you recommend for a weekend trip?"
Agent: [Can compare Paris and London weather using memory]
```

### 4. Working Memory

The agent uses structured working memory to maintain key information:

```xml
<location>
  <current>London</current>
  <previous>Paris</previous>
  <favorites></favorites>
</location>
<preferences>
  <units>metric</units>
  <detail_level>detailed</detail_level>
</preferences>
```

## Testing the Weather Agent

Create tests for the weather agent in `tests/unit/agent.test.ts`:

```typescript
import { createWeatherAgent } from '../../src/agent/weather';
import { weatherTool } from '../../src/weather/tool';
import { Memory } from '@mastra/memory';

// Mock dependencies
jest.mock('../../src/weather/tool');
jest.mock('@mastra/memory');

describe('Weather Agent', () => {
  let agent;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create test instance of agent
    agent = createWeatherAgent();
  });
  
  test('should use weather tool to fetch weather information', async () => {
    // Mock weatherTool implementation
    const mockWeatherTool = weatherTool as jest.Mocked<typeof weatherTool>;
    mockWeatherTool.execute.mockResolvedValue({
      content: [{ type: 'text', text: 'Weather for New York: Sunny, 75°F' }],
      isError: false
    });
    
    // Call agent with a weather query
    const response = await agent.generate('What\'s the weather in New York?', {
      threadId: 'test-thread-1',
      resourceId: 'test-user-1'
    });
    
    // Check that the agent calls the weather tool
    expect(mockWeatherTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'New York' }),
      expect.anything()
    );
    
    // Check that the response includes weather information
    expect(response).toContain('New York');
  });
  
  test('should maintain context for follow-up queries', async () => {
    // Mock memory
    const mockMemory = Memory as jest.MockedClass<typeof Memory>;
    mockMemory.prototype.rememberMessages.mockResolvedValue({
      threadId: 'test-thread-1',
      messages: [
        { role: 'user', content: 'What\'s the weather in Chicago?' },
        { role: 'assistant', content: 'Weather for Chicago: Windy, 60°F' }
      ],
      uiMessages: []
    });
    
    // Mock weather tool
    const mockWeatherTool = weatherTool as jest.Mocked<typeof weatherTool>;
    mockWeatherTool.execute.mockResolvedValue({
      content: [{ type: 'text', text: 'Weather forecast for Chicago: Rain, 55°F' }],
      isError: false
    });
    
    // Call agent with a follow-up query
    const response = await agent.generate('What about tomorrow?', {
      threadId: 'test-thread-1',
      resourceId: 'test-user-1'
    });
    
    // Check that the agent calls the weather tool with the correct location
    expect(mockWeatherTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Chicago' }),
      expect.anything()
    );
    
    // Check that the response includes location from context
    expect(response).toContain('Chicago');
  });
  
  test('should ask for location when none is provided or in context', async () => {
    // Mock empty memory
    const mockMemory = Memory as jest.MockedClass<typeof Memory>;
    mockMemory.prototype.rememberMessages.mockResolvedValue({
      threadId: 'test-thread-2',
      messages: [],
      uiMessages: []
    });
    
    // Call agent with a query without location
    const response = await agent.generate('What\'s the weather like today?', {
      threadId: 'test-thread-2',
      resourceId: 'test-user-2'
    });
    
    // Check that the agent asks for a location
    expect(response).toMatch(/location|where|city/i);
  });
});
```

## Integration Testing

Create integration tests in `tests/integration/agent.test.ts`:

```typescript
import { weatherAgent } from '../../src/agent/weather';
import { handleWeatherQuery } from '../../src/agent/handlers';
import { initializeMemoryStorage } from '../../src/memory/storage';

// These tests require a working memory system and API
// They should be run in a controlled environment with proper API keys
describe('Weather Agent Integration', () => {
  beforeAll(async () => {
    // Initialize memory storage for tests
    await initializeMemoryStorage();
  });
  
  test('should process a complete weather query', async () => {
    // This is an integration test with the actual API
    // It requires a valid API key in the environment
    const userId = 'test-integration-user';
    const conversationId = 'test-integration-conversation';
    
    const result = await handleWeatherQuery({
      message: 'What\'s the weather in London?',
      userId,
      conversationId,
      streaming: false
    });
    
    // Verify we got a valid response
    expect(result.response).toBeTruthy();
    expect(result.response).toContain('London');
    expect(result.threadId).toBeTruthy();
    expect(result.resourceId).toBeTruthy();
    
    // Test follow-up question
    const followUpResult = await handleWeatherQuery({
      message: 'What about tomorrow?',
      userId,
      conversationId: result.threadId, // Use same thread
      streaming: false
    });
    
    // Verify follow-up maintains context
    expect(followUpResult.response).toBeTruthy();
    expect(followUpResult.response).toContain('London');
  }, 30000); // Allow 30 seconds for API calls
});
```

## Next Steps

Proceed to [06-server-implementation.md](06-server-implementation.md) for details on implementing the API server for the weather agent.
