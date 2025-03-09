# Mastra Tools Guide

## Introduction to Tools in Mastra

Tools are a core part of the Mastra framework that enable agents to interact with external systems, process data, or perform specific functions. Each tool follows a consistent pattern:

1. **ID**: A unique identifier for the tool
2. **Description**: A clear explanation of what the tool does
3. **Input Schema**: A Zod schema defining the expected parameters
4. **Output Schema**: A Zod schema defining the return value structure
5. **Execute Function**: The implementation that performs the actual work

Tools allow your AI agents to extend beyond just text generation, giving them the ability to fetch real-time data, interact with APIs, analyze content, and take actions in the world.

## Tools Implemented in This Project

### 1. Weather Tool

The Weather Tool fetches current weather information for a specified location using the Open-Meteo API.

**Capabilities:**
- Geocoding to convert location names to coordinates
- Fetching current temperature, feels-like temperature, humidity, and wind data
- Interpreting weather codes into human-readable conditions

**Implementation:**
```typescript
export const weatherTool = createTool({
  id: 'get-weather',
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string(),
  }),
  execute: async ({ context }) => {
    return await getWeather(context.location);
  },
});
```

### 2. News Tool

The News Tool retrieves up-to-date news articles from NewsAPI.org based on topics, categories, sources, or languages.

**Capabilities:**
- Searching for news by query terms
- Filtering by news category (business, technology, sports, etc.)
- Filtering by news source
- Selecting news by language
- Limiting the number of results

**Implementation:**
```typescript
export const newsTool = createTool({
  id: 'get-news',
  description: 'Get latest news articles by topic, category, or source',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query term or phrase'),
    category: z
      .enum([
        'business',
        'entertainment',
        'general',
        'health',
        'science',
        'sports',
        'technology',
      ])
      .optional()
      .describe('News category to filter by'),
    sources: z.string().optional().describe('Comma-separated news sources to filter by'),
    language: z
      .enum(['ar', 'de', 'en', 'es', 'fr', 'he', 'it', 'nl', 'no', 'pt', 'ru', 'sv', 'zh'])
      .optional()
      .default('en')
      .describe('Language of the news articles'),
    count: z.number().min(1).max(100).optional().default(5).describe('Number of articles to return'),
  }),
  outputSchema: z.object({
    articles: z.array(
      z.object({
        title: z.string(),
        description: z.string().nullable(),
        source: z.string(),
        url: z.string(),
        publishedAt: z.string(),
        imageUrl: z.string().nullable(),
      })
    ),
    totalResults: z.number(),
  }),
  execute: async ({ context }) => {
    return await getNews(context);
  },
});
```

### 3. Image Analysis Tool

The Image Analysis Tool uses Google's Gemini multimodal model to analyze and describe images from URLs, extracting objects, colors, sentiment, and tags.

**Capabilities:**
- Analyzing images from URLs
- Responding to specific questions about images
- Identifying objects within images
- Extracting color information
- Determining sentiment/mood
- Generating relevant tags and categories

**Implementation:**
```typescript
export const imageAnalysisTool = createTool({
  id: 'analyze-image',
  description: 'Analyze image content using Google Gemini AI',
  inputSchema: z.object({
    imageUrl: z.string().describe('URL of the image to analyze'),
    prompt: z.string().optional().describe('Specific analysis prompt or question about the image'),
  }),
  outputSchema: z.object({
    analysis: z.string().describe('Detailed analysis of the image content'),
    objects: z.array(z.string()).describe('List of objects detected in the image'),
    colors: z.array(z.string()).optional().describe('Main colors in the image'),
    sentiment: z.string().optional().describe('Overall mood or sentiment of the image'),
    tags: z.array(z.string()).describe('Tags/categories for the image'),
  }),
  execute: async ({ context }) => {
    return await analyzeImage(context.imageUrl, context.prompt);
  },
});
```

## How to Implement New Tools

Adding a new tool to your Mastra application follows these steps:

1. **Select a Capability**: Decide what external API, data source, or functionality you want to expose to your agents.

2. **Get API Keys**: If your tool requires external API access, obtain the necessary API keys and add them to your `.env.development` file.

3. **Install Dependencies**: If needed, install any packages required by your tool implementation:
   ```bash
   npm install package-name
   ```

4. **Implement the Tool**: Create your tool using the `createTool` function from `@mastra/core/tools`:
   ```typescript
   export const myNewTool = createTool({
     id: 'tool-id',
     description: 'What the tool does',
     inputSchema: z.object({
       // Define input parameters with Zod
     }),
     outputSchema: z.object({
       // Define output structure with Zod
     }),
     execute: async ({ context }) => {
       // Implement the tool's functionality
       return result;
     },
   });
   ```

5. **Create or Update an Agent**: Add your tool to an existing agent or create a new agent that uses it:
   ```typescript
   export const myAgent = new Agent({
     name: 'Agent Name',
     instructions: `
       Instructions for how the agent should behave...
     `,
     model: groq('llama-3.3-70b-specdec'), // Or your LLM of choice
     tools: { myNewTool },
   });
   ```

6. **Register the Agent**: Update your Mastra instance to include your new agent:
   ```typescript
   export const mastra = new Mastra({
     agents: { existingAgent, myAgent },
     // Other Mastra configuration
   });
   ```

## Ideas for Additional Tools

Here are some ideas for other tools you could implement in your Mastra application:

### Data Processing Tools
- **Text Analysis Tool**: Analyze sentiment, extract entities, or summarize text
- **Data Visualization Tool**: Generate charts or graphs from data
- **Document Parsing Tool**: Extract structured data from PDFs, Word docs, or spreadsheets

### External API Tools
- **Search Tool**: Perform web searches and return results
- **Translation Tool**: Translate text between languages
- **Stock Price Tool**: Fetch current or historical stock prices
- **Social Media Tool**: Post to or fetch data from social media platforms

### Utility Tools
- **Calendar Tool**: Check dates, holidays, or schedule events
- **Math Tool**: Perform complex calculations
- **Database Query Tool**: Query a database for information
- **File Storage Tool**: Read from or write to a file system

### Advanced Tools
- **Code Execution Tool**: Run code in a sandbox environment
- **Email Tool**: Send or read emails
- **SMS Tool**: Send text messages
- **Voice Tool**: Convert text to speech or speech to text

### Multi-step Tools
- **Research Assistant**: Combine search, summarization, and data extraction
- **Trip Planner**: Combine weather, maps, and event information
- **Content Creator**: Generate text, create images, and format content

## Best Practices for Tool Development

1. **Type Safety**: Leverage Zod schemas to ensure proper typing of inputs and outputs
2. **Error Handling**: Implement robust error handling to gracefully manage API failures
3. **Rate Limiting**: Be mindful of API rate limits and implement throttling when needed
4. **Documentation**: Provide clear descriptions of what your tool does and how to use it
5. **Security**: Keep API keys and sensitive data in environment variables
6. **Testing**: Test your tools with a variety of inputs to ensure they work correctly
7. **Modularity**: Keep tools focused on specific tasks for better reusability

By following these guidelines and patterns, you can create powerful, extensible tools that enhance your AI agents' capabilities.
