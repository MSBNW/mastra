# Agent Memory in Mastra: A Junior Developer's Guide

## Introduction

This guide explains how to implement and configure memory for agents in Mastra. Memory is a crucial feature that allows your agents to maintain context across interactions, remember previous messages, and search through conversation history.

## Understanding Agent Memory

Mastra agents come with a sophisticated memory system that:
- Stores conversation history (messages between users and the agent)
- Maintains contextual information
- Supports traditional message storage (recent messages)
- Enables vector-based semantic search (finding related information based on meaning)

All of this helps your agents maintain state across interactions and retrieve relevant historical context when needed.

## Key Concepts

### Threads and Resources

In Mastra, conversations are organized using two key identifiers:

1. **Thread ID** (`threadId`): Represents a specific conversation
   - Each distinct conversation has its own thread ID
   - Allows the system to maintain context for multiple conversations

2. **Resource ID** (`resourceId`): Typically identifies the user
   - Associates memory with specific users
   - Ensures that agent's memory and context are correctly associated with the right user

This separation allows you to manage multiple conversations (threads) for a single user, or even share conversation context across users if needed.

```typescript
// Example: Starting a conversation with a user
await agent.stream(
  [
    {
      role: 'system',
      content: `Chat with user started now ${new Date().toISOString()}.`,
    },
  ],
  {
    threadId: "project_123",
    resourceId: "user_123",
  },
);
```

## Basic Implementation

### 1. Initialize Memory

First, import the Memory class and create an instance:

```typescript
import { Memory } from '@mastra/memory';

// Create a memory instance with default settings
const memory = new Memory();

// Or with custom configuration
const memory = new Memory({
  options: {
    lastMessages: 10,    // Keep 10 most recent messages
    semanticRecall: {
      topK: 3,           // Include 3 semantically related messages
      messageRange: 2,   // Context around each related message
    },
  },
});
```

### 2. Attach Memory to an Agent

```typescript
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

const agent = new Agent({
  name: 'Customer Support Agent',
  instructions: 'You are a helpful customer support assistant...',
  model: openai('gpt-4o-mini'),
  memory: memory,  // Attach memory instance here
});
```

### 3. Use Memory in Conversations

When interacting with the agent, always include `threadId` and `resourceId`:

```typescript
// First message in conversation
const response = await agent.stream(
  "What kind of subscription plans do you offer?",
  {
    threadId: "conversation_abc123",
    resourceId: "customer_xyz789",
  }
);

// Later message in same conversation
const followUp = await agent.stream(
  "Which plan would you recommend for my needs?",
  {
    threadId: "conversation_abc123",  // Same thread ID to maintain context
    resourceId: "customer_xyz789",    // Same resource ID
  }
);
```

## Understanding Memory Features

### Recent Message History

By default, Mastra's memory keeps track of the 40 most recent messages in a conversation. You can customize this with the `lastMessages` setting:

```typescript
const memory = new Memory({
  options: {
    lastMessages: 5,  // Only keep 5 most recent messages
  }
});
```

This is useful when:
- You want to limit context window usage
- The conversation doesn't require extensive history
- You're building a more stateless agent

### Semantic Search

Semantic search is enabled by default and allows agents to find and recall relevant information from earlier in the conversation.

Here's how it works:
1. Each message is converted to a vector embedding
2. When a new message arrives, the system looks for similar messages using vector similarity
3. Context around semantically similar messages is included
4. All relevant context is provided to the agent

You can configure semantic search with:

```typescript
const memory = new Memory({
  options: {
    semanticRecall: {
      topK: 5,             // Include 5 most relevant past messages
      messageRange: 2,     // Include 2 messages before and after each result
    }
  }
});
```

To disable semantic search completely:

```typescript
const memory = new Memory({
  options: {
    semanticRecall: {
      enabled: false
    }
  }
});
```

## Customizing Memory for Different Use Cases

You can configure memory differently based on your agent's specific needs:

### Quick Response Agent (Minimal Context)

For agents that need to provide quick, stateless responses:

```typescript
const memory = new Memory({
  options: {
    lastMessages: 5,           // Only keep 5 recent messages
    semanticRecall: false,     // Disable semantic search
  }
});
```

### Project Management Agent (Extensive Context)

For agents that need to track complex conversations with many details:

```typescript
const memory = new Memory({
  options: {
    lastMessages: 50,          // Maintain longer conversation history
    semanticRecall: {
      topK: 5,                 // Find more relevant project details
      messageRange: 3,         // Include more context around each result
    }
  }
});
```

## Overriding Memory Settings Per Call

You can also override the memory settings for specific agent calls without changing the overall configuration:

```typescript
// Use different memory settings for this specific call
const response = await agent.stream(
  "What were we discussing about the search feature?",
  {
    threadId: "thread_456",
    resourceId: "user_123",
    memoryOptions: {
      lastMessages: 10,
      semanticRecall: {
        topK: 2,
        messageRange: 1,
      }
    }
  }
);
```

This is particularly useful when:
- A specific query needs more or less context
- You want to tune memory parameters based on the query type
- You're debugging memory issues

## Storage Options

Mastra supports multiple storage backends for memory:

### 1. LibSQL (Default)

```typescript
import { LibSQLStore } from "@mastra/core/storage/libsql";

const storage = new LibSQLStore({
  config: {
    url: "file:example.db",
  },
});
```

### 2. PostgreSQL

```typescript
import { PostgresStore } from "@mastra/pg";

const storage = new PostgresStore({
  host: "localhost",
  port: 5432,
  user: "postgres",
  database: "postgres",
  password: "postgres",
});
```

### 3. Custom Vector Database for Semantic Search

You can also customize which vector database and embedding model to use:

```typescript
import { openai } from '@ai-sdk/openai';
import { PgVector } from '@mastra/pg';

const memory = new Memory({
  // Use a different vector database (libsql is default)
  vector: new PgVector("postgresql://user:pass@localhost:5432/postgres"),
  
  // Use a different embedder (fastembed is default)
  embedder: openai.embedding("text-embedding-3-small"),
});
```

## Advanced Features

### Working Memory

Mastra also includes a working memory feature that allows agents to maintain persistent state beyond message history:

```typescript
const memory = new Memory({
  options: {
    workingMemory: {
      enabled: true,
    },
  },
});
```

This allows agents to build up knowledge and context over time.

## Common Pitfalls and Best Practices

### 1. Always Use Consistent IDs

Make sure you always use the same `threadId` and `resourceId` for the same conversation. Inconsistent IDs will result in context being lost.

❌ **Bad**: Using different thread IDs for the same conversation
```typescript
// First message
await agent.stream("Hi", { threadId: "convo1", resourceId: "user1" });

// Follow-up (WRONG)
await agent.stream("How are you?", { threadId: "thread2", resourceId: "user1" });
```

✅ **Good**: Using consistent thread IDs
```typescript
// First message
await agent.stream("Hi", { threadId: "convo1", resourceId: "user1" });

// Follow-up (CORRECT)
await agent.stream("How are you?", { threadId: "convo1", resourceId: "user1" });
```

### 2. Tune Memory Parameters for Your Use Case

Don't just use default values. Consider:
- How much context your agent needs
- Performance implications of large context windows
- Whether semantic search is helpful for your use case

### 3. Don't Overload with Too Much History

More doesn't always mean better:
- Large context windows can confuse the agent
- Excessive memory increases token usage
- Focus on quality of context over quantity

### 4. Test Memory Scenarios

Always test your agent with queries that reference previous context:
- "What did we talk about earlier?"
- "Can you remind me what I asked earlier?"
- "Remember when I mentioned X?"

## Debugging Memory Issues

If your agent isn't remembering things correctly:

1. Check thread/resource IDs are consistent
2. Ensure memory is properly configured and attached
3. Try increasing `lastMessages` or `topK` values
4. Verify the storage backend is working correctly

## Example: Complete Memory Implementation

Here's a full example of setting up a memory-enabled agent:

```typescript
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

// 1. Create custom storage backend
const storage = new PostgresStore({
  host: "localhost",
  port: 5432,
  user: "postgres",
  database: "postgres",
  password: "postgres",
});

// 2. Initialize memory with custom settings
const memory = new Memory({
  storage,                      // Custom storage backend
  options: {
    lastMessages: 20,           // Keep last 20 messages
    semanticRecall: {
      topK: 5,                  // Return 5 most similar messages
      messageRange: 2,          // Include 2 messages around each result
    },
    workingMemory: {
      enabled: true,            // Enable working memory
    },
  },
});

// 3. Create agent with memory
const customerSupportAgent = new Agent({
  name: 'Customer Support',
  instructions: `You are a helpful customer support agent...`,
  model: openai('gpt-4o-mini'),
  memory,
});

// 4. Use in conversations
export async function handleCustomerQuery(userId, conversationId, message) {
  return await customerSupportAgent.stream(
    message,
    {
      threadId: conversationId,
      resourceId: userId,
    }
  );
}
```

## Implementation Example: Weather Agent

Here's the actual implementation of memory for a Weather Agent in our application:

```typescript
import { groq } from '@ai-sdk/groq';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { weatherTool } from '../tools';

// Create a memory instance for the Weather Agent with optimized settings
const weatherMemory = new Memory({
  options: {
    lastMessages: 20, // Keep more messages for better context
    semanticRecall: {
      topK: 3,        // Include top 3 most relevant past messages
      messageRange: 2  // Include 2 messages before/after for context
    },
  },
});

export const weatherAgent = new Agent({
  name: 'Weather Agent',
  memory: weatherMemory,   // Attach the memory instance to the agent
  instructions: `
      You are a friendly and personable weather assistant with a great memory and a light sense of humor.
      
      // Instructions for maintaining context and conversational style...
  `,
  model: groq('llama-3.3-70b-specdec'),
  tools: { weatherTool },
});
```

### Configuration Decisions Explained

For the Weather Agent, we made the following memory configuration choices:

1. **Increased `lastMessages` to 20**: Weather queries often require more context than the default 10 messages, especially when users ask about multiple locations or compare conditions.

2. **Set `topK` to 3**: This retrieves the three most semantically similar past messages. For weather queries, this is particularly useful when users revisit locations they've asked about before, even if not in recent messages.

3. **Set `messageRange` to 2**: This includes two messages before and after each semantically similar message. For weather conversations, this surrounding context often contains important information about the user's specific interests (e.g., temperature, precipitation).

With this configuration, the Weather Agent can:
- Remember the most recently discussed locations
- Reference previous weather queries for comparison
- Retrieve context from earlier in the conversation when relevant
- Maintain a natural conversational flow with context awareness

When using the Weather Agent, you should include thread and resource IDs in your API calls:

```typescript
// Example API call with memory context
const response = await weatherAgent.stream(
  "What will the weather be like tomorrow?",
  {
    threadId: "weather_conversation_123",
    resourceId: "user_456",
  }
);
```

This implementation uses LibSQL as the default storage backend and fastembed-js for embeddings, which are automatically set up when you create a new Memory instance without specifying custom storage or embedding options.

## Conclusion

Memory is what makes your Mastra agents truly powerful, enabling them to maintain context, remember previous interactions, and provide personalized experiences. By understanding and properly configuring memory, you can create agents that feel more natural and helpful to users.

Remember that the default settings are a good starting point, but as shown with our Weather Agent example, you should customize memory based on your specific use case.
