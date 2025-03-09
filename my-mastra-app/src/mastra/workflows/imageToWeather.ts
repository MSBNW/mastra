import { Step, Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { locationAnalysisTool } from '../tools/imageAnalysis';
import { weatherTool } from '../tools';

// Step 1: Analyze the image to identify the location
const analyzeImage = new Step({
  id: 'analyze-image',
  description: 'Analyzes an image to identify a location',
  inputSchema: z.object({
    imageUrl: z.string().optional().describe('URL to an image of a location'),
    imageBase64: z.string().optional().describe('Base64-encoded image data'),
    imagePath: z.string().optional().describe('Path to a local image file'),
    fallbackLocation: z.string().optional().describe('Fallback location if image analysis fails')
  }).refine(data => !!(data.imageUrl || data.imageBase64 || data.imagePath), {
    message: "At least one of imageUrl, imageBase64, or imagePath must be provided"
  }),
  execute: async ({ context, mastra }) => {
    const triggerData = context?.getStepResult('trigger');
    
    if (!triggerData) {
      throw new Error('Trigger data not found');
    }
    
    // Call the locationAnalysisTool
    return await mastra.tools.locationAnalysisTool.execute({
      imageUrl: triggerData.imageUrl,
      imageBase64: triggerData.imageBase64,
      imagePath: triggerData.imagePath,
      question: "Analyze this image and identify the specific location shown. Look for landmarks, geography, architecture, signs, or other identifying features. Be as specific as possible with the city and country."
    });
  }
});

// Step 2: Get weather for the identified location
const getWeather = new Step({
  id: 'get-weather',
  description: 'Gets weather for the identified location',
  inputSchema: z.object({
    location: z.string().nullable(),
    confidence: z.string(),
    analysis: z.string(),
    visualClues: z.array(z.string())
  }),
  execute: async ({ context, mastra }) => {
    const imageResult = context?.getStepResult('analyze-image');
    const triggerData = context?.getStepResult('trigger');
    
    if (!imageResult) {
      throw new Error('Image analysis result not found');
    }
    
    // Use the location from the image analysis, or fallback to a provided location
    const location = imageResult.location || triggerData?.fallbackLocation;
    
    if (!location) {
      throw new Error('Could not identify a location from the image and no fallback location was provided');
    }
    
    // Call the weatherTool
    const weatherData = await mastra.tools.weatherTool.execute({
      location: location
    });
    
    // Create a combined response
    return {
      locationAnalysis: {
        analysis: imageResult.analysis,
        location: imageResult.location,
        confidence: imageResult.confidence,
        visualClues: imageResult.visualClues
      },
      weather: weatherData
    };
  }
});

// Define and export the workflow
const imageToWeatherWorkflow = new Workflow({
  name: 'image-to-weather',
  triggerSchema: z.object({
    imageUrl: z.string().optional().describe('URL to an image of a location'),
    imageBase64: z.string().optional().describe('Base64-encoded image data'),
    imagePath: z.string().optional().describe('Path to a local image file'),
    fallbackLocation: z.string().optional().describe('Fallback location if image analysis fails')
  }).refine(data => !!(data.imageUrl || data.imageBase64 || data.imagePath), {
    message: "At least one of imageUrl, imageBase64, or imagePath must be provided"
  })
})
.step(analyzeImage)
.then(getWeather);

imageToWeatherWorkflow.commit();

export { imageToWeatherWorkflow };
