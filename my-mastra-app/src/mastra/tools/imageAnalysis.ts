import { createTool } from '@mastra/core/tools';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// Set up the uploads directory
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure Google AI client
const getGoogleAIClient = () => {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is not set');
  }
  return new GoogleGenerativeAI(apiKey);
};

// Helper function to process an image (resize if needed)
const processImage = async (imagePath: string): Promise<string> => {
  try {
    // Get image metadata
    const metadata = await sharp(imagePath).metadata();
    
    // Check if image needs resizing
    const buffer = await fs.promises.readFile(imagePath);
    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    
    if (buffer.length > MAX_IMAGE_SIZE || (metadata.width && metadata.width > 2000)) {
      // Resize image
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
    console.error('Error processing image:', error);
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
    console.error('Error saving base64 image:', error);
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
    console.error('Error downloading image:', error);
    throw new Error('Failed to download image');
  }
};

// Create and export the image analysis tool
export const locationAnalysisTool = createTool({
  id: 'analyze-location',
  description: 'Analyzes an image to identify the location shown using vision AI',
  inputSchema: z.object({
    imageUrl: z.string().optional().describe('URL to an image of a location'),
    imageBase64: z.string().optional().describe('Base64-encoded image data'),
    imagePath: z.string().optional().describe('Path to a local image file'),
    question: z.string().optional().describe('Specific question about the image location (optional)'),
  }).refine(data => !!(data.imageUrl || data.imageBase64 || data.imagePath), {
    message: "At least one of imageUrl, imageBase64, or imagePath must be provided",
  }),
  outputSchema: z.object({
    analysis: z.string().describe('Detailed analysis of the location in the image'),
    location: z.string().nullable().describe('Identified location (if detected)'),
    confidence: z.string().describe('Confidence level in the location identification'),
    visualClues: z.array(z.string()).describe('Visual clues used to identify the location'),
  }),
  execute: async ({ context }) => {
    const { imageUrl, imageBase64, imagePath, question } = context;
    try {
      // Get the image from one of the provided sources
      let imageSrc: string;
      
      if (imagePath && fs.existsSync(imagePath)) {
        imageSrc = imagePath;
      } else if (imageUrl) {
        imageSrc = await downloadImage(imageUrl);
      } else if (imageBase64) {
        imageSrc = await saveBase64Image(imageBase64);
      } else {
        throw new Error('No valid image provided. Please provide an image URL, Base64 data, or file path.');
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
      
      // Initialize Google's Gemini model for vision tasks
      const genAI = getGoogleAIClient();
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-pro-exp-02-05",
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });
      
      // System prompt to instruct the model on the task
      const systemPrompt = 'You are a location identification expert. Your task is to analyze images and identify the location shown with as much specificity as possible.';
      
      // Combine system prompt with user prompt
      const fullPrompt = `${systemPrompt}\n\n${locationPrompt}`;
      
      // Generate content with the model
      const result = await model.generateContent([
        fullPrompt,
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Image
          }
        }
      ]);
      
      // Extract the analysis text
      const analysisText = result.response.text() || 'Could not analyze the image.';
      
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
      
      // Extract location, confidence, and visual clues from the analysis
      const analysisLines = analysisText.split('\n');
      
      // Extract potential location information
      let location: string | null = null;
      let confidence = 'Unknown';
      let visualClues: string[] = [];
      
      // Simple parsing of the analysisText to extract structured data
      for (const line of analysisLines) {
        // Look for location information
        if (line.includes('location') || line.includes('Location') || line.includes('LOCATION')) {
          const match = line.match(/[:]\s*(.*)/);
          if (match && match[1]) {
            location = match[1].trim();
          }
        }
        
        // Look for confidence level
        if (line.toLowerCase().includes('confidence')) {
          const match = line.match(/[:]\s*(.*)/);
          if (match && match[1]) {
            confidence = match[1].trim();
          } else if (line.toLowerCase().includes('high')) {
            confidence = 'High';
          } else if (line.toLowerCase().includes('medium')) {
            confidence = 'Medium';
          } else if (line.toLowerCase().includes('low')) {
            confidence = 'Low';
          }
        }
        
        // Look for visual clues
        if (line.toLowerCase().includes('clue') || line.toLowerCase().includes('feature') || line.toLowerCase().includes('identified by')) {
          const match = line.match(/[:]\s*(.*)/);
          if (match && match[1]) {
            visualClues.push(match[1].trim());
          }
        }
      }
      
      // If no structured data was extracted, make a best effort to parse the text
      if (!location) {
        // Try to find city/country mentions
        const cityCountryRegex = /((?:[A-Z][a-z]+\s?)+)(?:,\s+)?((?:[A-Z][a-z]+\s?)+)?/g;
        const matches = [...analysisText.matchAll(cityCountryRegex)];
        if (matches.length > 0) {
          location = matches[0][0];
        }
      }
      
      if (visualClues.length === 0) {
        // Extract sentences that might mention visual clues
        const sentences = analysisText.split(/[.!?]/).filter(s => s.trim().length > 0);
        visualClues = sentences
          .filter(s => 
            s.toLowerCase().includes('see') || 
            s.toLowerCase().includes('view') || 
            s.toLowerCase().includes('show') ||
            s.toLowerCase().includes('feature') ||
            s.toLowerCase().includes('landmark')
          )
          .map(s => s.trim())
          .slice(0, 3);
      }
      
      return {
        analysis: analysisText,
        location: location,
        confidence: confidence || 'Unknown',
        visualClues: visualClues.length > 0 ? visualClues : ['No specific visual clues extracted'],
      };
    } catch (error) {
      console.error('Error in location analysis tool:', error);
      throw new Error(`Failed to analyze image location: ${error.message || 'Unknown error'}`);
    }
  }
});
