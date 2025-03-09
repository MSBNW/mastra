import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { format, parse, isValid, addDays, isSameDay, differenceInDays, isWeekend, getDay, differenceInCalendarDays } from 'date-fns';
import twilio from 'twilio';

// Define the response interface for News API
interface NewsAPIResponse {
  status: string;
  totalResults: number;
  articles: {
    source: {
      id: string | null;
      name: string;
    };
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    urlToImage: string | null;
    publishedAt: string;
    content: string | null;
  }[];
}

interface GeocodingResponse {
  results: {
    latitude: number;
    longitude: number;
    name: string;
  }[];
}
interface WeatherResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    weather_code: number;
  };
}

// Holiday API interface
interface HolidayApiResponse {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

// Weather Tool
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

const getWeather = async (location: string) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = (await geocodingResponse.json()) as GeocodingResponse;

  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }

  const { latitude, longitude, name } = geocodingData.results[0];

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;

  const response = await fetch(weatherUrl);
  const data = (await response.json()) as WeatherResponse;

  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name,
  };
};

// News Tool
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

const getNews = async ({
  query,
  category,
  sources,
  language = 'en',
  count = 5,
}: {
  query?: string;
  category?: string;
  sources?: string;
  language?: string;
  count?: number;
}) => {
  // Get API key from environment variables
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey) {
    throw new Error('NEWS_API_KEY environment variable is not set');
  }

  // Build the API URL with parameters
  let apiUrl = 'https://newsapi.org/v2/top-headlines?';
  
  const params = new URLSearchParams();
  
  if (query) {
    params.append('q', query);
  }
  
  if (category) {
    params.append('category', category);
  }
  
  if (sources) {
    params.append('sources', sources);
  }
  
  params.append('language', language);
  params.append('pageSize', count.toString());
  params.append('apiKey', apiKey);
  
  apiUrl += params.toString();

  try {
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`News API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json() as NewsAPIResponse;
    
    // Transform the API response to match our output schema
    return {
      articles: data.articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source.name,
        url: article.url,
        publishedAt: article.publishedAt,
        imageUrl: article.urlToImage,
      })),
      totalResults: data.totalResults,
    };
  } catch (error) {
    throw new Error(`Failed to fetch news: ${error.message}`);
  }
};

// Image Analysis Tool
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

const analyzeImage = async (imageUrl: string, prompt?: string) => {
  try {
    // Get API key from environment variables
    const apiKey = process.env.GOOGLE_API_KEY;
    
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is not set');
    }

    // Initialize the Gemini API
    const genAI = new GoogleGenerativeAI(apiKey);
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

    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`);
    }
    const imageBytes = await response.arrayBuffer();
    
    // Convert to base64
    const base64 = Buffer.from(imageBytes).toString('base64');
    
    // Build the prompt for the model
    const analysisPrompt = prompt || 
      "Analyze this image in detail. Describe what you see, identify objects, people, text, and notable features. " +
      "What is the main subject? What is happening? What colors are present? What's the mood or sentiment?";
    
    // Generate content with the model
    const result = await model.generateContent([
      analysisPrompt,
      {
        inlineData: {
          mimeType: "image/jpeg", // Assuming JPEG, adjust as needed
          data: base64
        }
      }
    ]);
    
    const response_text = result.response.text();
    
    // Generate structured output
    // For a real implementation, you might want to use a more sophisticated 
    // approach to extract structured data from the model response
    const objects = extractObjects(response_text);
    const colors = extractColors(response_text);
    const sentiment = extractSentiment(response_text);
    const tags = generateTags(response_text);
    
    return {
      analysis: response_text,
      objects,
      colors,
      sentiment,
      tags,
    };
    
  } catch (error) {
    throw new Error(`Failed to analyze image: ${error.message}`);
  }
};

// Calendar Tool
export const calendarTool = createTool({
  id: 'calendar-tool',
  description: 'Calendar utilities for date calculations, holiday checking, and business day operations',
  inputSchema: z.object({
    operation: z.enum([
      'get-date-info',
      'calculate-days-between',
      'add-days',
      'is-weekend',
      'is-business-day',
      'get-next-business-day',
      'get-holidays',
    ]).describe('The calendar operation to perform'),
    date: z.string().describe('Date in YYYY-MM-DD format'),
    endDate: z.string().optional().describe('End date in YYYY-MM-DD format (for date range operations)'),
    days: z.number().optional().describe('Number of days to add or subtract'),
    country: z.string().optional().default('US').describe('Country code for holiday information'),
    year: z.number().optional().describe('Year for holiday information'),
  }),
  outputSchema: z.object({
    result: z.union([z.string(), z.number(), z.boolean(), z.array(z.any())]),
    formattedDate: z.string().optional(),
    dayOfWeek: z.string().optional(),
    isWeekend: z.boolean().optional(),
    isBusinessDay: z.boolean().optional(),
    daysRemaining: z.object({
      inMonth: z.number().optional(),
      inYear: z.number().optional(),
    }).optional(),
    holidays: z.array(z.object({
      date: z.string(),
      name: z.string(),
      localName: z.string().optional(),
      countryCode: z.string().optional(),
    })).optional(),
  }),
  execute: async ({ context }) => {
    return await executeCalendarOperation(context);
  },
});

// SMS Tool
export const smsTool = createTool({
  id: 'send-sms',
  description: 'Send SMS messages via Twilio',
  inputSchema: z.object({
    to: z.string().describe('Recipient phone number in E.164 format (e.g., +1234567890)'),
    message: z.string().describe('SMS message content'),
    mediaUrl: z.string().optional().describe('URL to media to include in the message (optional)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    sid: z.string().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  }),
  execute: async ({ context }) => {
    return await sendSMS(context.to, context.message, context.mediaUrl);
  },
});

const sendSMS = async (to: string, message: string, mediaUrl?: string) => {
  try {
    // Get Twilio credentials from environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Missing Twilio credentials in environment variables');
    }

    // Format the recipient number if not already in E.164 format
    let formattedNumber = to;
    if (!to.startsWith('+')) {
      // Remove any non-digit characters
      const digits = to.replace(/\D/g, '');
      
      // For US numbers, ensure they have country code
      if (digits.length === 10) {
        formattedNumber = `+1${digits}`;
      } else {
        formattedNumber = `+${digits}`;
      }
    }
    
    // Initialize Twilio client
    const client = twilio(accountSid, authToken);
    
    // Prepare message options
    const messageOptions: any = {
      body: message,
      from: fromNumber,
      to: formattedNumber,
    };
    
    // Add media URL if provided
    if (mediaUrl) {
      messageOptions.mediaUrl = [mediaUrl];
    }
    
    // Send the message
    const result = await client.messages.create(messageOptions);
    
    return {
      success: true,
      sid: result.sid,
      status: result.status,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error sending SMS',
      timestamp: new Date().toISOString(),
    };
  }
};

const executeCalendarOperation = async ({
  operation,
  date,
  endDate,
  days = 0,
  country = 'US',
  year,
}: {
  operation: string;
  date: string;
  endDate?: string;
  days?: number;
  country?: string;
  year?: number;
}) => {
  try {
    // Parse the input date
    const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
    
    if (!isValid(parsedDate)) {
      throw new Error(`Invalid date format: ${date}. Please use YYYY-MM-DD format.`);
    }
    
    // For operations that require an end date
    let parsedEndDate;
    if (endDate) {
      parsedEndDate = parse(endDate, 'yyyy-MM-dd', new Date());
      if (!isValid(parsedEndDate)) {
        throw new Error(`Invalid end date format: ${endDate}. Please use YYYY-MM-DD format.`);
      }
    }

    // Base response object that will be extended based on the operation
    const baseResponse = {
      formattedDate: format(parsedDate, 'MMMM d, yyyy'),
      dayOfWeek: format(parsedDate, 'EEEE'),
      isWeekend: isWeekend(parsedDate),
      isBusinessDay: !isWeekend(parsedDate), // Basic check, real implementation would check holidays too
    };

    // Execute the requested operation
    switch (operation) {
      case 'get-date-info':
        const currentDate = new Date();
        const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        const currentYear = new Date(currentDate.getFullYear(), 11, 31);
        
        return {
          ...baseResponse,
          result: format(parsedDate, 'MMMM d, yyyy (EEEE)'),
          daysRemaining: {
            inMonth: differenceInCalendarDays(currentMonth, parsedDate),
            inYear: differenceInCalendarDays(currentYear, parsedDate),
          },
        };
        
      case 'calculate-days-between':
        if (!parsedEndDate) {
          throw new Error('End date is required for days between calculation');
        }
        
        const daysBetween = differenceInDays(parsedEndDate, parsedDate);
        
        return {
          ...baseResponse,
          result: daysBetween,
          formattedDate: `${format(parsedDate, 'MMMM d, yyyy')} to ${format(parsedEndDate, 'MMMM d, yyyy')}`,
        };
        
      case 'add-days':
        const newDate = addDays(parsedDate, days);
        
        return {
          ...baseResponse,
          result: format(newDate, 'yyyy-MM-dd'),
          formattedDate: format(newDate, 'MMMM d, yyyy'),
          dayOfWeek: format(newDate, 'EEEE'),
          isWeekend: isWeekend(newDate),
          isBusinessDay: !isWeekend(newDate),
        };
        
      case 'is-weekend':
        return {
          ...baseResponse,
          result: isWeekend(parsedDate),
        };
        
      case 'is-business-day':
        // This implementation only checks weekends
        // In a production system, you would also check holidays
        const businessDay = !isWeekend(parsedDate);
        
        return {
          ...baseResponse,
          result: businessDay,
          isBusinessDay: businessDay,
        };
        
      case 'get-next-business-day':
        let nextBusinessDay = parsedDate;
        
        // Keep adding days until we find a business day
        do {
          nextBusinessDay = addDays(nextBusinessDay, 1);
        } while (isWeekend(nextBusinessDay));
        
        return {
          result: format(nextBusinessDay, 'yyyy-MM-dd'),
          formattedDate: format(nextBusinessDay, 'MMMM d, yyyy'),
          dayOfWeek: format(nextBusinessDay, 'EEEE'),
          isWeekend: false,
          isBusinessDay: true,
        };
        
      case 'get-holidays':
        // Use the year from the date if not explicitly provided
        const holidayYear = year || parsedDate.getFullYear();
        
        try {
          // Fetch holidays from public API
          const holidaysUrl = `https://date.nager.at/api/v3/PublicHolidays/${holidayYear}/${country}`;
          const response = await fetch(holidaysUrl);
          
          if (!response.ok) {
            throw new Error(`Failed to fetch holidays: ${response.status} ${response.statusText}`);
          }
          
          const holidays = await response.json() as HolidayApiResponse[];
          
          // Format the holidays
          const formattedHolidays = holidays.map(holiday => ({
            date: holiday.date,
            name: holiday.name,
            localName: holiday.localName,
            countryCode: holiday.countryCode,
          }));
          
          return {
            result: formattedHolidays,
            holidays: formattedHolidays,
          };
        } catch (error) {
          // If the API fails, return a simpler set of major US holidays
          // This is just a fallback for the demo
          if (country.toUpperCase() === 'US') {
            const majorHolidays = getMajorUSHolidays(holidayYear);
            return {
              result: majorHolidays,
              holidays: majorHolidays,
            };
          } else {
            throw new Error(`Failed to get holidays for ${country}: ${error.message}`);
          }
        }
        
      default:
        throw new Error(`Unknown calendar operation: ${operation}`);
    }
  } catch (error) {
    throw new Error(`Calendar tool error: ${error.message}`);
  }
};

// Helper function to get major US holidays when the API is unavailable
function getMajorUSHolidays(year: number) {
  return [
    { date: `${year}-01-01`, name: 'New Year\'s Day', localName: 'New Year\'s Day', countryCode: 'US' },
    { date: `${year}-01-15`, name: 'Martin Luther King Jr. Day', localName: 'Martin Luther King Jr. Day', countryCode: 'US' },
    { date: `${year}-02-19`, name: 'Presidents\' Day', localName: 'Washington\'s Birthday', countryCode: 'US' },
    { date: `${year}-05-27`, name: 'Memorial Day', localName: 'Memorial Day', countryCode: 'US' },
    { date: `${year}-06-19`, name: 'Juneteenth', localName: 'Juneteenth', countryCode: 'US' },
    { date: `${year}-07-04`, name: 'Independence Day', localName: 'Independence Day', countryCode: 'US' },
    { date: `${year}-09-02`, name: 'Labor Day', localName: 'Labor Day', countryCode: 'US' },
    { date: `${year}-10-14`, name: 'Columbus Day', localName: 'Columbus Day', countryCode: 'US' },
    { date: `${year}-11-11`, name: 'Veterans Day', localName: 'Veterans Day', countryCode: 'US' },
    { date: `${year}-11-28`, name: 'Thanksgiving Day', localName: 'Thanksgiving Day', countryCode: 'US' },
    { date: `${year}-12-25`, name: 'Christmas Day', localName: 'Christmas Day', countryCode: 'US' },
  ];
}

// Helper functions to extract structured information from the model response
function extractObjects(text: string): string[] {
  try {
    // Simple approach: look for sentences mentioning "see", "contains", "shows", etc.
    const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0);
    
    let objects: string[] = [];
    const objectIndicators = ['show', 'contain', 'depict', 'display', 'feature', 'include', 'with', 'has'];
    
    sentences.forEach(sentence => {
      const lowerSentence = sentence.toLowerCase();
      if (objectIndicators.some(indicator => lowerSentence.includes(indicator))) {
        // Extract nouns - this is a simplistic approach
        const words = sentence.match(/\b[A-Za-z][a-z]{2,}\b/g) || [];
        objects = [...objects, ...words.filter(w => !objectIndicators.includes(w.toLowerCase()))];
      }
    });
    
    // Deduplicate
    objects = [...new Set(objects)];
    
    // If no objects were found with the above method, extract potential object words
    if (objects.length === 0) {
      const commonObjects = [
        'person', 'people', 'man', 'woman', 'child', 'dog', 'cat', 'car', 'building', 
        'tree', 'flower', 'sky', 'water', 'phone', 'computer', 'chair', 'table', 'book'
      ];
      
      const words = text.match(/\b[A-Za-z][a-z]{2,}\b/g) || [];
      objects = words.filter(word => 
        commonObjects.includes(word.toLowerCase()) || 
        (word.length > 3 && !['the', 'and', 'that', 'with', 'have', 'this'].includes(word.toLowerCase()))
      );
      
      // Deduplicate
      objects = [...new Set(objects)];
    }
    
    return objects.slice(0, 10); // Limit to 10 objects
  } catch (e) {
    console.error("Error extracting objects:", e);
    return ["Unable to extract objects"];
  }
}

function extractColors(text: string): string[] {
  try {
    const colorList = [
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 
      'black', 'white', 'gray', 'grey', 'cyan', 'magenta', 'teal', 'turquoise',
      'lavender', 'maroon', 'beige', 'tan', 'navy', 'olive', 'gold', 'silver'
    ];
    
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const colors = words.filter(word => colorList.includes(word));
    
    // Deduplicate
    return [...new Set(colors)];
  } catch (e) {
    console.error("Error extracting colors:", e);
    return ["Unable to extract colors"];
  }
}

function extractSentiment(text: string): string {
  try {
    const positiveWords = ['happy', 'bright', 'cheerful', 'joyful', 'beautiful', 'peaceful', 'calm', 'serene'];
    const negativeWords = ['sad', 'dark', 'gloomy', 'somber', 'disturbing', 'troubling', 'angry', 'threatening'];
    const neutralWords = ['neutral', 'balanced', 'ordinary', 'common', 'typical', 'standard'];
    
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) positiveCount++;
      if (negativeWords.includes(word)) negativeCount++;
      if (neutralWords.includes(word)) neutralCount++;
    });
    
    if (positiveCount > negativeCount && positiveCount > neutralCount) {
      return 'Positive';
    } else if (negativeCount > positiveCount && negativeCount > neutralCount) {
      return 'Negative';
    } else {
      return 'Neutral';
    }
  } catch (e) {
    console.error("Error extracting sentiment:", e);
    return "Neutral";
  }
}

function generateTags(text: string): string[] {
  try {
    // Common categories for images
    const commonTags = [
      'nature', 'portrait', 'landscape', 'urban', 'wildlife', 'food', 'architecture',
      'product', 'art', 'technology', 'travel', 'people', 'abstract', 'sports', 'fashion',
      'vehicle', 'animal', 'plant', 'interior', 'exterior', 'night', 'day', 'sunset', 'sunrise'
    ];
    
    const lowerText = text.toLowerCase();
    
    // Find which common tags are mentioned in the text
    const mentionedTags = commonTags.filter(tag => lowerText.includes(tag));
    
    // If we have enough tags, return them, otherwise generate some based on key words
    if (mentionedTags.length >= 3) {
      return mentionedTags;
    }
    
    // Extract potential tag words (nouns and adjectives that might describe the image)
    const words = text.match(/\b[A-Za-z][a-z]{3,}\b/g) || [];
    const potentialTags = words.filter(word => {
      const w = word.toLowerCase();
      return !['this', 'that', 'with', 'there', 'which', 'where', 'when', 'what', 'have', 'been'].includes(w);
    });
    
    // Combine the tags and deduplicate
    const allTags = [...mentionedTags, ...potentialTags];
    const uniqueTags = [...new Set(allTags)];
    
    return uniqueTags.slice(0, 8); // Limit to 8 tags
  } catch (e) {
    console.error("Error generating tags:", e);
    return ["image"];
  }
}

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return conditions[code] || 'Unknown';
}
