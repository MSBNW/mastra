# Image Analysis Tool Integration

## Overview

This document outlines the implementation plan for adding an image analysis capability to the weather agent. This feature will allow users to upload images of locations, and the agent will:

1. Analyze the image to identify the location
2. Extract visual location clues (landmarks, geography, etc.)
3. Make an educated guess about the depicted location
4. Provide weather information for that location

This creates a novel user experience where someone can share a photo and instantly get relevant weather information without explicitly naming the location.

## System Architecture

The image analysis feature extends our existing architecture with new components:

```
┌────────────────────────────────────────────────────────────────┐
│                         Weather Agent                          │
├────────────────┬────────────────────────────┬─────────────────┤
│                │                            │                 │
│ Weather Tool   │ Image Analysis Tool        │ Memory System   │
│                │ - Location Recognition     │                 │
│                │ - Visual Feature Extraction│                 │
└────────────────┴────────────────────────────┴─────────────────┘
                                │
               ┌───────────────┴────────────────┐
               │                                │
               ▼                                ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│  Vision API Integration   │      │  Extended API Server         │
│ - Image Processing        │      │ - Image Upload Endpoints     │
│ - Feature Detection       │      │ - Multipart Form Handling    │
└───────────────────────────┘      └──────────────────────────────┘
```

## Implementation Steps

### 1. Install Additional Dependencies

Update the project dependencies in `package.json`:

```typescript
// Add to existing dependencies
{
  "dependencies": {
    // Existing dependencies...
    "@ai-sdk/openai": "^1.0.0",     // For OpenAI Vision API
    "sharp": "^0.32.1",             // For image processing
    "multer": "^1.4.5-lts.1",       // For handling file uploads
    "form-data": "^4.0.0",          // For multipart form data
    "uuid": "^9.0.0"                // For generating unique IDs
  },
  "devDependencies": {
    // Existing dev dependencies...
    "@types/multer": "^1.4.7",
    "@types/sharp": "^0.31.1",
    "@types/uuid": "^9.0.1"
  }
}
```

Install these dependencies:

```bash
npm install @ai-sdk/openai sharp multer form-data uuid
npm install -D @types/multer @types/sharp @types/uuid
```

### 2. Image Analysis Tool Implementation

Create a new file `src/tools/imageAnalysis.ts`:

```typescript
import { CoreTool } from '@mastra/core';
import { openai } from '@ai-sdk/openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// Configure OpenAI client with API key
const vision = openai('gpt-4o');

// Constants for image handling
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Interface for parameters
interface ImageAnalysisParams {
  imageUrl?: string;     // URL to an image
  imageBase64?: string;  // Base64-encoded image data
  imagePath?: string;    // Path to a local image file (server-side only)
  question?: string;     // Optional specific question about the image
}

// Helper function to process and resize image if needed
const processImage = async (imagePath: string): Promise<string> => {
  try {
    // Get image metadata
    const metadata = await sharp(imagePath).metadata();
    
    // Check if image needs resizing (if too large)
    const buffer = await fs.promises.readFile(imagePath);
    if (buffer.length > MAX_IMAGE_SIZE || (metadata.width && metadata.width > 2000)) {
      // Resize image to reduce size while maintaining aspect ratio
      const resizedImagePath = path.join(UPLOAD_DIR, `resized_${path.basename(imagePath)}`);
      await sharp(imagePath)
        .resize({
          width: 1500, 
          height: 1500,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toFile(resizedImagePath);
      
      return resizedImagePath;
    }
    
    return imagePath;
  } catch (error) {
    logger.error('Error processing image', { error });
    throw new Error('Failed to process image');
  }
};

// Helper function to save base64 image to file
const saveBase64Image = async (base64Data: string): Promise<string> => {
  try {
    // Remove data URL prefix if present
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
    
    // Create buffer from base64
    const buffer = Buffer.from(base64Image, 'base64');
    
    // Generate unique filename
    const filename = `${uuidv4()}.jpg`;
    const imagePath = path.join(UPLOAD_DIR, filename);
    
    // Write file
    await fs.promises.writeFile(imagePath, buffer);
    
    return imagePath;
  } catch (error) {
    logger.error('Error saving base64 image', { error });
    throw new Error('Failed to save base64 image');
  }
};

// Helper function to download image from URL
const downloadImage = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    
    // Generate unique filename with extension from content-type
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.split('/')[1] || 'jpg';
    const filename = `${uuidv4()}.${extension}`;
    const imagePath = path.join(UPLOAD_DIR, filename);
    
    // Write file
    await fs.promises.writeFile(imagePath, Buffer.from(buffer));
    
    return imagePath;
  } catch (error) {
    logger.error('Error downloading image', { error });
    throw new Error('Failed to download image');
  }
};

// Create the image analysis tool
export const imageAnalysisTool: CoreTool<ImageAnalysisParams> = {
  name: 'imageAnalysisTool',
  description: 'Analyzes an image to identify a location and its characteristics',
  parameters: {
    type: 'object',
    properties: {
      imageUrl: {
        type: 'string',
        description: 'URL to an image of a location'
      },
      imageBase64: {
        type: 'string',
        description: 'Base64-encoded image data'
      },
      imagePath: {
        type: 'string',
        description: 'Path to a local image file (server-side only)'
      },
      question: {
        type: 'string',
        description: 'Specific question about the image location (optional)'
      }
    },
    anyOf: [
      { required: ['imageUrl'] },
      { required: ['imageBase64'] },
      { required: ['imagePath'] }
    ]
  },
  execute: async ({ imageUrl, imageBase64, imagePath, question }) => {
    try {
      // Get the image path from one of the provided sources
      let imageSrc: string;
      
      if (imagePath && fs.existsSync(imagePath)) {
        imageSrc = imagePath;
      } else if (imageUrl) {
        imageSrc = await downloadImage(imageUrl);
      } else if (imageBase64) {
        imageSrc = await saveBase64Image(imageBase64);
      } else {
        return {
          content: [{ 
            type: 'text', 
            text: 'No valid image provided. Please provide an image URL, Base64 data, or file path.' 
          }],
          isError: true
        };
      }
      
      // Process the image (resize if needed)
      const processedImagePath = await processImage(imageSrc);
      
      // Read the image as base64 for OpenAI API
      const imageBuffer = await fs.promises.readFile(processedImagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Construct the prompt for location identification
      const locationPrompt = question || 
        "Analyze this image and identify the location shown. Look for landmarks, geography, architecture, signs, or other identifying features. " +
        "Please provide: 1) Your best guess of the specific location (city, country, and any specific landmarks), " +
        "2) The key visual clues that helped you identify it, " +
        "3) Your confidence level in this identification (high/medium/low). " +
        "If you cannot identify a specific location, describe the type of place it appears to be (e.g., 'coastal Mediterranean town', 'urban Asian city', etc.).";
      
      // Call Vision API to analyze the image
      const imageAnalysisResponse = await vision.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a location identification expert. Your task is to analyze images and identify the location shown with as much specificity as possible.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: locationPrompt },
              { 
                type: 'image_url', 
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 500
      });
      
      // Extract the analysis text
      const analysisText = imageAnalysisResponse.choices[0]?.message?.content || 'Could not analyze the image.';
      
      // Clean up temporary files
      if (imageSrc !== imagePath) {
        try {
          await fs.promises.unlink(imageSrc);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      if (processedImagePath !== imageSrc) {
        try {
          await fs.promises.unlink(processedImagePath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      // Return the analysis result
      return {
        content: [
          {
            type: 'text',
            text: analysisText
          }
        ],
        isError: false
      };
    } catch (error) {
      logger.error('Error in image analysis tool', { error });
      
      return {
        content: [
          {
            type: 'text',
            text: `Error analyzing image: ${error.message || 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }
};
```

### 3. Export the Image Analysis Tool

Update `src/tools/index.ts` to include the new tool:

```typescript
// Add to existing exports
export { imageAnalysisTool } from './imageAnalysis';
```

### 4. Location Extraction Utility

Create a function to extract location information from the image analysis in `src/tools/locationExtractor.ts`:

```typescript
import { logger } from '../utils/logger';

// Regular expressions for detecting locations
const LOCATION_PATTERNS = [
  /(?:located|location|place|city|town|in)\s+(?:in|at|of|near)?\s+([\w\s,]+)(?:\.|,|\s*$)/i,
  /(?:this is|this looks like|appears to be|seems to be)\s+([\w\s,]+)(?:\.|,|\s*$)/i,
  /([\w\s]+),\s+(?:\w+\s+)?(USA|US|United States|UK|United Kingdom|Canada|Australia|France|Germany|Italy|Spain|Japan|China|Russia|Brazil|Mexico)/i,
  /([\w\s]+)(?:\s+in)?\s+(?:the\s+)?(USA|US|United States|UK|United Kingdom|Canada|Australia|France|Germany|Italy|Spain|Japan|China|Russia|Brazil|Mexico)/i
];

// List of common landmarks with their locations
const LANDMARKS = {
  'Eiffel Tower': 'Paris, France',
  'Statue of Liberty': 'New York, USA',
  'Colosseum': 'Rome, Italy',
  'Big Ben': 'London, UK',
  'Sydney Opera House': 'Sydney, Australia',
  'Great Wall': 'Beijing, China',
  'Taj Mahal': 'Agra, India',
  'Pyramids': 'Cairo, Egypt',
  'Burj Khalifa': 'Dubai, UAE',
  'Golden Gate Bridge': 'San Francisco, USA',
  'Christ the Redeemer': 'Rio de Janeiro, Brazil',
  'Machu Picchu': 'Cusco, Peru',
  'Acropolis': 'Athens, Greece',
  'Sagrada Familia': 'Barcelona, Spain',
  'Empire State Building': 'New York, USA',
  'Kremlin': 'Moscow, Russia',
  'Brandenburg Gate': 'Berlin, Germany',
  'Tokyo Tower': 'Tokyo, Japan',
  'CN Tower': 'Toronto, Canada',
  'Petronas Towers': 'Kuala Lumpur, Malaysia',
  'Space Needle': 'Seattle, USA',
  'Hollywood Sign': 'Los Angeles, USA',
  'Forbidden City': 'Beijing, China',
  'Tower Bridge': 'London, UK',
  'Arc de Triomphe': 'Paris, France'
};

// Function to extract location from image analysis text
export const extractLocationFromAnalysis = (analysisText: string): string | null => {
  try {
    // Check for landmark mentions first (more reliable)
    for (const [landmark, location] of Object.entries(LANDMARKS)) {
      if (analysisText.includes(landmark)) {
        logger.info(`Found landmark reference: ${landmark} -> ${location}`);
        return location;
      }
    }
    
    // Try to extract location using regex patterns
    for (const pattern of LOCATION_PATTERNS) {
      const match = analysisText.match(pattern);
      if (match && match[1]) {
        const location = match[1].trim();
        if (location.length > 2) { // Minimum sensible location name length
          logger.info(`Extracted location using pattern: ${location}`);
          return location;
        }
      }
    }
    
    // If no patterns match, look for city/country names in the text
    const words = analysisText.split(/\s+/);
    const potentialLocations = words.filter(word => 
      word.length > 2 && word[0] === word[0].toUpperCase()
    );
    
    if (potentialLocations.length > 0) {
      const bestGuess = potentialLocations[0];
      logger.info(`Extracted potential location from capitalized words: ${bestGuess}`);
      return bestGuess;
    }
    
    // No location found
    logger.warn('Could not extract location from analysis text');
    return null;
  } catch (error) {
    logger.error('Error extracting location from analysis', { error });
    return null;
  }
};
```

### 5. Image-to-Weather Workflow Implementation

Create a workflow that connects image analysis to weather information in `src/workflows/imageToWeather.ts`:

```typescript
import { Workflow } from '@mastra/core/workflow';
import { imageAnalysisTool } from '../tools/imageAnalysis';
import { weatherTool } from '../tools/weather';
import { extractLocationFromAnalysis } from '../tools/locationExtractor';
import { logger } from '../utils/logger';

// Create the image-to-weather workflow
export const imageToWeatherWorkflow = new Workflow({
  name: 'Image to Weather Workflow',
  description: 'Analyzes an image to identify a location and fetches weather for that location',
  definition: {
    steps: {
      // Step 1: Analyze the image to identify the location
      analyzeImage: {
        tool: imageAnalysisTool,
        params: ({inputs}) => ({
          imageUrl: inputs.imageUrl,
          imageBase64: inputs.imageBase64,
          imagePath: inputs.imagePath,
          question: "Analyze this image and identify the specific location shown. Look for landmarks, geography, architecture, signs, or other identifying features. Be as specific as possible with the city and country."
        }),
      },
      
      // Step 2: Extract the location from the analysis
      extractLocation: {
        invoke: async ({steps}) => {
          const analysisResult = steps.analyzeImage.result;
          
          if (analysisResult.isError) {
            logger.error('Error in image analysis step', { error: analysisResult.content[0].text });
            return { location: null, analysisText: analysisResult.content[0].text };
          }
          
          const analysisText = analysisResult.content[0].text;
          const extractedLocation = extractLocationFromAnalysis(analysisText);
          
          logger.info('Extracted location from analysis', { 
            location: extractedLocation, 
            analysisText 
          });
          
          return {
            location: extractedLocation,
            analysisText: analysisText
          };
        }
      },
      
      // Step 3: Get weather for the extracted location
      getWeather: {
        tool: weatherTool,
        params: ({steps, inputs}) => {
          // Use extracted location, or fallback to user-provided location, or default location
          const location = steps.extractLocation.result.location || 
                           inputs.fallbackLocation || 
                           'Unable to determine location';
          
          if (location === 'Unable to determine location') {
            throw new Error('Could not identify a specific location from the image');
          }
          
          return {
            location: location,
            forecast: inputs.forecast || false,
            units: inputs.units || 'metric'
          };
        },
        catch: (error) => ({
          content: [
            {
              type: 'text',
              text: `I couldn't get the weather because: ${error.message}. Please provide a clearer image of a recognizable location, or specify a location directly.`
            }
          ],
          isError: true
        })
      },
      
      // Step 4: Format the final response combining analysis and weather
      formatResponse: {
        invoke: async ({steps}) => {
          const { analysisText } = steps.extractLocation.result;
          const weatherResult = steps.getWeather.result;
          
          if (weatherResult.isError) {
            return {
              content: [
                {
                  type: 'text',
                  text: weatherResult.content[0].text
                }
              ],
              isError: true
            };
          }
          
          const weatherText = weatherResult.content[0].text;
          
          // Create a combined response with both location analysis and weather
          return {
            content: [
              {
                type: 'text',
                text: `📍 **Location Analysis**:\n${analysisText}\n\n🌤️ **Weather Information**:\n${weatherText}`
              }
            ],
            isError: false
          };
        }
      }
    },
    
    // Define the workflow output based on the final step
    output: ({steps}) => steps.formatResponse.result
  }
});
```

### 6. Update Agent to Support Image Analysis

Modify the weather agent in `src/agent/weather.ts` to include the image analysis workflow:

```typescript
import { Agent } from '@mastra/core/agent';
import { groq } from '@ai-sdk/groq';
import { config } from '../config/env';
import { weatherMemory } from '../memory';
import { weatherTool } from '../tools/weather';
import { imageAnalysisTool } from '../tools/imageAnalysis'; // Add this
import { imageToWeatherWorkflow } from '../workflows/imageToWeather'; // Add this
import { createWeatherAgentPrompt } from './prompts';

// Create and export the weather agent
export const createWeatherAgent = (options = {}) => {
  // Choose LLM model based on configuration
  const getLlmModel = () => {
    // ... (existing code)
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
    tools: { 
      weatherTool,
      imageAnalysisTool // Add this
    },
    workflows: {
      imageToWeather: imageToWeatherWorkflow // Add this
    }
  });
  
  return weatherAgent;
};

// Create a singleton instance
export const weatherAgent = createWeatherAgent();
```

### 7. Update Agent Instructions

Modify the agent instructions in `src/agent/prompts.ts` to include guidance about the image analysis capability:

```typescript
// Add to the existing instructions
export const WEATHER_AGENT_INSTRUCTIONS = `
You are a friendly and conversational weather assistant with a great memory and a light sense of humor.

## MEMORY & CONTEXT
...

## CONVERSATIONAL STYLE
...

## WEATHER INFORMATION
...

## IMAGE ANALYSIS CAPABILITIES

You can analyze images to identify locations and provide weather information for those locations. When a user shares an image:

- Use the imageAnalysisTool to analyze the image and identify the location
- Explain what visual clues you used to identify the location
- Provide weather information for the identified location
- If you cannot identify the location confidently, ask the user for clarification

When using the image analysis capability:
- If you receive an image URL, use the imageAnalysisTool directly
- If the user wants both location identification and weather, use the imageToWeather workflow
- Always explain your reasoning about the location identification
- Express your level of confidence in the location identification

## IMAGE ANALYSIS EXAMPLES

User: [Shares image of the Eiffel Tower]
You: "I can see the Eiffel Tower in your image, which is the iconic landmark of Paris, France! The distinctive iron lattice structure is unmistakable. Currently in Paris, it's 62°F with partly cloudy skies and a gentle breeze. Perfect weather for climbing to the top and enjoying that spectacular view!"

User: [Shares image of a beach]
You: "That looks like a beautiful tropical beach! Based on the distinctive limestone formations and turquoise water, this appears to be Railay Beach in Thailand. The weather in Krabi, Thailand right now is 86°F and humid with scattered clouds. Perfect beach weather, though there's a slight chance of a brief afternoon shower, typical for this tropical paradise!"

## SPECIAL HANDLING
...
`;
```

### 8. Update Server to Handle Image Uploads

Modify the server to accept image uploads in `src/server/routes.ts`:

```typescript
import { Express, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { handleWeatherQuery, handleWeatherQueryWithCustomMemory } from '../agent/handlers';
import { generateThreadId, getResourceId } from '../memory';
import { verifyApiKey } from './middleware';
import { weatherAgent } from '../agent/weather';
import { logger } from '../utils/logger';

// Configure multer for image uploads
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
  }
});

// Define request types
interface WeatherQueryRequest {
  // ... existing interface
}

interface ImageWeatherRequest {
  userId?: string;
  conversationId?: string;
  units?: 'metric' | 'imperial';
  message?: string;
  forecast?: boolean;
}

// Set up the API routes
export const setupRoutes = (app: Express) => {
  // ... existing routes
  
  // Image analysis + weather endpoint
  app.post(
    '/api/weather/image',
    verifyApiKey,
    upload.single('image'),
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({
            status: 'error',
            message: 'No image file uploaded'
          });
        }
        
        const {
          userId = 'anonymous',
          conversationId,
          units = 'metric',
          message = '',
          forecast = false
        } = req.body as ImageWeatherRequest;
        
        const threadId = generateThreadId(userId, conversationId);
        const resourceId = getResourceId(userId);
        
        logger.info('Processing image + weather request', {
          userId,
          threadId,
          filename: file.filename
        });
        
        // Use the imageToWeather workflow
        const result = await weatherAgent.workflow.imageToWeather({
          imageUrl: null,
          imageBase64: null,
          imagePath: file.path,
          fallbackLocation: null,
          units,
          forecast
        }, {
          threadId,
          resourceId
        });
        
        // Return the response
        res.status(200).json({
          status: 'success',
          data: {
            response: result.isError ? result.content[0].text : result.content[0].text,
            threadId,
            resourceId,
            isError: result.isError
          }
        });
        
        // Clean up the uploaded file
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to process image weather request'
        });
        
        // Clean up the uploaded file on error
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    }
  );
  
  // Image URL analysis endpoint
  app.post('/api/weather/image-url', verifyApiKey, async (req: Request, res: Response) => {
    try {
      const {
        imageUrl,
        userId = 'anonymous',
        conversationId,
        units = 'metric',
        forecast = false
      } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'Image URL is required'
        });
      }
      
      const threadId = generateThreadId(userId, conversationId);
      const resourceId = getResourceId(userId);
      
      logger.info('Processing image URL + weather request', {
        userId,
        threadId,
        imageUrl: imageUrl.substring(0, 100) // Log first 100 chars of URL
      });
      
      // Use the imageToWeather workflow
      const result = await weatherAgent.workflow.imageToWeather({
        imageUrl,
        imageBase64: null,
        imagePath: null,
        fallbackLocation: null,
        units,
        forecast
      }, {
        threadId,
        resourceId
      });
      
      // Return the response
      res.status(200).json({
        status: 'success',
        data: {
          response: result.isError ? result.content[0].text : result.content[0].text,
          threadId,
          resourceId,
          isError: result.isError
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to process image URL weather request'
      });
    }
  });
};
```

### 9. Add API Documentation for Image Endpoints

Update the API documentation in the `setupRoutes` function:

```typescript
// API documentation
app.get('/api/docs', (req: Request, res: Response) => {
  res.status(200).json({
    version: '1.0.0',
    endpoints: [
      // ... existing endpoints
      {
        path: '/api/weather/image',
        method: 'POST',
        description: 'Analyze an image to identify location and get weather',
        requestBody: {
          image: 'File - Image file upload (multipart/form-data)',
          userId: 'String (optional) - Unique identifier for the user',
          conversationId: 'String (optional) - Conversation thread identifier',
          units: 'String (optional) - "metric" or "imperial"',
          forecast: 'Boolean (optional) - Include forecast in response'
        }
      },
      {
        path: '/api/weather/image-url',
        method: 'POST',
        description: 'Analyze an image from URL to identify location and get weather',
        requestBody: {
          imageUrl: 'String - URL to an image',
          userId: 'String (optional) - Unique identifier for the user',
          conversationId: 'String (optional) - Conversation thread identifier',
          units: 'String (optional) - "metric" or "imperial"',
          forecast: 'Boolean (optional) - Include forecast in response'
        }
      }
    ]
  });
});
```

### 10. Update Environment Configuration

Add vision-related configuration to `src/config/env.ts`:

```typescript
export const config = {
  // ... existing config
  
  // Vision API settings
  VISION_API_KEY: process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || '',
  VISION_API_MODEL: process.env.VISION_API_MODEL || '
