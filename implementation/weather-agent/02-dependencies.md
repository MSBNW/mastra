# Dependencies and Environment Setup

## Required Packages

For our weather agent implementation, we'll need the following NPM packages:

### Core Dependencies

1. **@mastra/core**: The main Mastra framework for creating AI agents
   - Provides the core Agent class
   - Handles API routing and communication

2. **@mastra/memory**: Mastra's memory system for conversation context
   - Provides conversation persistence
   - Enables semantic search capabilities 

3. **@ai-sdk/[llm-provider]**: Language model provider SDK
   - Options include OpenAI, Anthropic, Groq, etc.
   - Choose based on model capabilities and pricing

### Weather API Integration

4. **axios** or **node-fetch**: HTTP client for API requests
   - Required for fetching weather data
   - Choose based on team familiarity

5. **weather-api-wrapper**: Select one of the following:
   - **openweathermap-api**: Popular and comprehensive weather API
   - **weatherapi-node**: Alternative with good free tier
   - **weatherbit-api**: Another option with good global coverage

### Development Dependencies

6. **typescript**: Type definitions for better development experience
7. **eslint**: Code linting for consistency
8. **jest** or **vitest**: For unit and integration testing

## Environment Setup

### 1. Project Initialization

Create a new project and install the required dependencies:

```bash
# Create project directory
mkdir weather-agent-app
cd weather-agent-app

# Initialize package.json
npm init -y

# Install core dependencies
npm install @mastra/core @mastra/memory @ai-sdk/groq

# Install HTTP client and weather API client
npm install axios

# Install development dependencies
npm install -D typescript @types/node eslint jest @types/jest
```

### 2. TypeScript Configuration

Create a `tsconfig.json` file with the following configuration:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

### 3. Environment Variables

Create a `.env` file to store API keys and configuration:

```
# LLM Provider API Keys
LLM_API_KEY=your_llm_api_key_here

# Weather API Keys
WEATHER_API_KEY=your_weather_api_key_here

# Memory Storage Configuration
MEMORY_STORAGE_TYPE=libsql  # Options: libsql, postgres, etc.
MEMORY_STORAGE_URL=file:weather-memory.db  # For libsql

# Optional: Vector Database (if not using default)
# VECTOR_DB_URL=your_vector_db_connection_string
```

Create a `.env.example` file with the same structure but without actual keys for version control.

### 4. Project Structure

Set up the following directory structure:

```
weather-agent-app/
├── .env                  # Environment variables (gitignored)
├── .env.example          # Example environment variables
├── .gitignore            # Git ignore file
├── package.json          # Project metadata and dependencies
├── tsconfig.json         # TypeScript configuration
├── src/
│   ├── index.ts          # Application entry point
│   ├── config/           # Configuration files
│   │   └── env.ts        # Environment variable handling
│   ├── memory/           # Memory system implementation
│   │   └── index.ts      # Memory configuration
│   ├── weather/          # Weather API integration
│   │   ├── client.ts     # Weather API client
│   │   └── types.ts      # Weather data types
│   ├── agent/            # Agent implementation
│   │   ├── index.ts      # Agent exports
│   │   ├── weather.ts    # Weather agent implementation
│   │   └── prompts.ts    # Agent instructions and prompts
│   └── server/           # API server implementation
│       ├── index.ts      # Server setup
│       └── routes.ts     # API routes
└── tests/                # Test files
    ├── unit/             # Unit tests
    └── integration/      # Integration tests
```

### 5. Version Control

Initialize git and create the `.gitignore` file:

```bash
git init

# Create .gitignore file
cat > .gitignore << EOL
node_modules/
dist/
.env
*.log
coverage/
*.db
EOL
```

## API Keys Setup

### 1. LLM Provider

Sign up for an account with your chosen LLM provider (e.g., Groq, OpenAI, etc.) and obtain an API key.

### 2. Weather API

Register for an account with your chosen weather API provider:

- **OpenWeatherMap**: [https://openweathermap.org/api](https://openweathermap.org/api)
- **WeatherAPI**: [https://www.weatherapi.com/](https://www.weatherapi.com/)
- **Weatherbit**: [https://www.weatherbit.io/](https://www.weatherbit.io/)

Obtain an API key and add it to your `.env` file.

## Next Steps

Proceed to [03-memory-system.md](03-memory-system.md) for details on implementing the memory system for the weather agent.
