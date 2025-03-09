# RAG Agents in Mastra

## Introduction

Retrieval-Augmented Generation (RAG) agents in Mastra combine the power of large language models with the ability to retrieve and use relevant information from your own data sources. These agents can access knowledge bases, provide cited information, and ground their responses in your specific data.

RAG in Mastra helps you enhance LLM outputs by incorporating relevant context from your own data sources, improving accuracy and grounding responses in real information. This document outlines how to implement and optimize RAG agents in your Mastra applications.

## Core Components of RAG in Mastra

### 1. Document Processing

The basic building block of RAG is document processing. Documents can be processed into manageable chunks and enriched with metadata:

- Convert documents into chunks using strategies like recursive chunking or sliding windows
- Add metadata to chunks for better filtering and organization
- Use the `MDocument` class as the foundation for document handling

```typescript
// Initialize document
const doc = MDocument.fromText(`Your document text here...`);

// Create chunks
const chunks = await doc.chunk({
  strategy: "recursive",
  size: 512,
  overlap: 50,
});
```

### 2. Embedding Generation

Embeddings convert text into numerical vector representations that capture semantic meaning:

- Convert text chunks into vector embeddings using models like OpenAI's text-embedding-3-small
- Store embeddings in vector databases for efficient retrieval

```typescript
// Generate embeddings
const { embeddings } = await embedMany({
  values: chunks,
  model: openai.embedding("text-embedding-3-small"),
});
```

### 3. Vector Storage

Mastra supports multiple vector databases for storing and retrieving embeddings:

- **PgVector** (PostgreSQL)
- **Pinecone**
- **Qdrant**
- **Chroma**
- **Astra**
- **LibSQL**
- **Upstash**
- **Cloudflare Vectorize**

```typescript
// Store in vector database
const pgVector = new PgVector(process.env.POSTGRES_CONNECTION_STRING);
await pgVector.upsert({
  indexName: "embeddings",
  vectors: embeddings,
});
```

### 4. Retrieval Mechanisms

Mastra provides several ways to retrieve relevant information:

- **Basic semantic search** using vector similarity
- **Metadata filtering** with MongoDB-style query syntax
- **Re-ranking** for improved relevance
- **Graph-based retrieval** for complex document relationships

```typescript
// Basic retrieval
const results = await pgVector.query({
  indexName: "embeddings",
  queryVector: queryVector,
  topK: 3,
});
```

### 5. Agent Integration

The final step is integrating retrieval capabilities into agents:

- **Vector Query Tool** for agent-driven retrieval
- **Graph Query Tool** for relationship-aware retrieval

## Creating a RAG Agent

Here's a complete implementation pattern for a RAG agent in Mastra:

```typescript
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { createVectorQueryTool, PGVECTOR_PROMPT } from '@mastra/rag';
import { PgVector } from '@mastra/pg';

// 1. Set up your vector store
const pgVector = new PgVector(process.env.POSTGRES_CONNECTION_STRING);

// 2. Create a vector query tool
const vectorQueryTool = createVectorQueryTool({
  vectorStoreName: 'pgVector',
  indexName: 'embeddings',
  model: openai.embedding('text-embedding-3-small'),
  enableFilter: true,
});

// 3. Create your RAG agent
export const knowledgeAgent = new Agent({
  name: 'Knowledge Base Agent',
  instructions: `
    You are a helpful assistant with access to a knowledge base.
    When answering questions, use the vectorQueryTool to search for relevant information.
    Always cite your sources and be transparent about what you know and don't know.
    ${PGVECTOR_PROMPT} // This provides query syntax for the specific vector store
  `,
  model: openai('gpt-4o'),
  tools: { vectorQueryTool },
});

// 4. Register the agent with Mastra
export const mastra = new Mastra({
  agents: { knowledgeAgent },
  vectors: { pgVector },
});
```

## Advanced RAG Techniques

### 1. Hybrid Search

Combine vector similarity with keyword search for better results, especially useful for technical documentation with specific terms:

```typescript
const results = await pgVector.query({
  indexName: "embeddings",
  queryVector: queryEmbedding,
  topK: 10,
  hybridSearch: {
    query: "specific technical term",
    alpha: 0.5 // Balance between vector and keyword search
  }
});
```

### 2. Re-ranking

Apply more sophisticated relevance scoring after initial retrieval:

```typescript
import { rerank } from "@mastra/rag";

// Get initial results from vector search
const initialResults = await pgVector.query({
  indexName: "embeddings",
  queryVector: queryEmbedding,
  topK: 10,
});

// Re-rank the results
const rerankedResults = await rerank(initialResults, query, openai('gpt-4o-mini'));
```

### 3. Graph-based Retrieval

Follow connections between related chunks, useful for complex document relationships:

```typescript
const graphQueryTool = createGraphQueryTool({
  vectorStoreName: 'pgVector',
  indexName: 'embeddings',
  model: openai.embedding('text-embedding-3-small'),
  graphOptions: {
    dimension: 1536,
    randomWalkSteps: 100,
    restartProb: 0.15,
    threshold: 0.7,
  }
});

// Use in an agent
export const graphRagAgent = new Agent({
  name: 'Graph RAG Agent',
  instructions: `
    You have access to a knowledge graph of connected information.
    Use the graphQueryTool to traverse relationships between concepts.
  `,
  model: openai('gpt-4o'),
  tools: { graphQueryTool },
});
```

### 4. Metadata Filtering

Filter by document source, date, category, or any other metadata field:

```typescript
const results = await pgVector.query({
  indexName: "embeddings",
  queryVector: embedding,
  topK: 10,
  filter: {
    source: "documentation",
    date: { $gt: "2024-01-01" },
    $or: [
      { category: "tutorials" },
      { category: "guides" }
    ]
  }
});
```

## Best Practices for RAG Agents

### Chunking Strategy

- Choose appropriate chunk sizes (typically 512-1024 tokens)
- Use overlap between chunks to maintain context (50-100 tokens)
- Consider semantic chunking for better coherence
- Adjust chunk size based on your specific content

### Embedding Models

- Use high-quality embedding models like text-embedding-3-small
- Ensure consistency by using the same model for documents and queries
- Consider domain-specific embedding models for specialized content
- Balance embedding quality with cost and performance requirements

### Agent Instructions

- Provide clear guidance on when to use retrieval
- Include vector store prompts for proper query syntax
- Instruct on how to handle cases where retrieval doesn't yield useful results
- Guide the agent on how to synthesize information from multiple sources

### Observability and Debugging

Mastra's RAG system includes observability features to help you optimize your retrieval pipeline:

- Track embedding generation performance and costs
- Monitor chunk quality and retrieval relevance
- Analyze query patterns and cache hit rates
- Export metrics to your observability platform

### Performance Optimization

- Implement caching for frequently accessed embeddings
- Use batch processing for large document collections
- Consider pre-filtering by metadata before vector search
- Optimize index settings for your specific use case

## Example Use Cases for RAG Agents

### 1. Documentation Assistant

Create a RAG agent that can answer questions about your product documentation:

```typescript
export const docsAgent = new Agent({
  name: 'Documentation Assistant',
  instructions: `
    You are a helpful documentation assistant for Product X.
    Use the vectorQueryTool to search our documentation for relevant information.
    Always include links to the full documentation when providing answers.
  `,
  model: openai('gpt-4o'),
  tools: { vectorQueryTool },
});
```

### 2. Knowledge Base Search

Build an agent that can search across multiple knowledge sources:

```typescript
export const knowledgeBaseAgent = new Agent({
  name: 'Knowledge Base Search',
  instructions: `
    You have access to our company knowledge base.
    When searching, consider which sources might be most relevant (HR policies, 
    technical documentation, or training materials).
    Filter by department when appropriate.
  `,
  model: openai('gpt-4o'),
  tools: { vectorQueryTool },
});
```

### 3. Research Assistant

Create an agent that can analyze research papers and find connections:

```typescript
export const researchAgent = new Agent({
  name: 'Research Assistant',
  instructions: `
    You are a research assistant that can analyze scientific papers.
    Use the graphQueryTool to find relationships between concepts across papers.
    Highlight contradictions and support between different research findings.
  `,
  model: openai('gpt-4o'),
  tools: { graphQueryTool },
});
```

## Conclusion

RAG agents in Mastra provide a powerful way to enhance LLM capabilities with your own data. By following the implementation patterns and best practices outlined in this document, you can create agents that provide accurate, relevant, and contextual responses based on your specific knowledge bases.

As you develop RAG agents, focus on optimizing each component of the RAG pipeline: document processing, embedding generation, vector storage, retrieval mechanisms, and agent integration. Each of these components can be fine-tuned to improve the overall performance and relevance of your RAG system.
