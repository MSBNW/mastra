# Weather API Integration

## Overview

The Weather API integration is a crucial component that provides real-time weather data to our agent. This document outlines the implementation details for creating a robust and reliable weather API client.

## API Selection

For this implementation plan, we'll use OpenWeatherMap API, which offers:

1. **Comprehensive data**: Current weather, forecasts, historical data
2. **Global coverage**: Worldwide location support
3. **Reasonable free tier**: Sufficient for development and small-scale deployments
4. **Well-documented API**: Clear documentation with examples

Other viable alternatives include WeatherAPI, Weatherbit, or Tomorrow.io, each with their own advantages.

## Implementation Steps

### 1. Weather API Types

Create type definitions in `src/weather/types.ts`:

```typescript
// Weather API response types
export interface WeatherResponse {
  coord: {
    lon: number;
    lat: number;
  };
  weather: Array<{
    id: number;
    main: string;      // E.g., "Rain", "Snow", "Clear"
    description: string; // E.g., "light rain", "broken clouds"
    icon: string;      // Icon code
  }>;
  main: {
    temp: number;      // Temperature in Kelvin (convert as needed)
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;  // Atmospheric pressure in hPa
    humidity: number;  // Humidity percentage
  };
  visibility: number;  // Visibility in meters
  wind: {
    speed: number;     // Wind speed in meter/sec
    deg: number;       // Wind direction in degrees
    gust?: number;     // Wind gust in meter/sec (optional)
  };
  rain?: {
    "1h"?: number;     // Rain volume for last hour in mm
    "3h"?: number;     // Rain volume for last 3 hours in mm
  };
  snow?: {
    "1h"?: number;     // Snow volume for last hour in mm
    "3h"?: number;     // Snow volume for last 3 hours in mm
  };
  clouds: {
    all: number;       // Cloudiness percentage
  };
  dt: number;          // Time of data calculation (Unix timestamp)
  sys: {
    type: number;
    id: number;
    country: string;   // Country code
    sunrise: number;   // Sunrise time (Unix timestamp)
    sunset: number;    // Sunset time (Unix timestamp)
  };
  timezone: number;    // Shift from UTC in seconds
  id: number;          // City ID
  name: string;        // City name
  cod: number;         // Internal parameter
}

// Forecast response includes a list of forecasts
export interface ForecastResponse {
  cod: string;
  message: number;
  cnt: number;
  list: Array<{
    dt: number;
    main: WeatherResponse['main'];
    weather: WeatherResponse['weather'];
    clouds: WeatherResponse['clouds'];
    wind: WeatherResponse['wind'];
    visibility: number;
    pop: number;      // Probability of precipitation
    rain?: WeatherResponse['rain'];
    snow?: WeatherResponse['snow'];
    dt_txt: string;   // Forecast time in text format
  }>;
  city: {
    id: number;
    name: string;
    coord: WeatherResponse['coord'];
    country: string;
    population: number;
    timezone: number;
    sunrise: number;
    sunset: number;
  };
}

// Error response type
export interface WeatherErrorResponse {
  cod: string | number;
  message: string;
}

// Simplified weather data for internal use
export interface WeatherData {
  location: {
    name: string;
    country: string;
    lat: number;
    lon: number;
  };
  current: {
    temperature: number;
    feels_like: number;
    condition: string;
    conditionDescription: string;
    icon: string;
    humidity: number;
    pressure: number;
    windSpeed: number;
    windDirection: number;
    cloudiness: number;
    visibility: number;
    precipitation: number | null;
  };
  daily?: Array<{
    date: Date;
    temperature: {
      min: number;
      max: number;
    };
    condition: string;
    conditionDescription: string;
    icon: string;
    precipitation: number | null;
    precipitationProbability: number;
  }>;
  sun: {
    sunrise: Date;
    sunset: Date;
  };
  units: 'metric' | 'imperial';
  lastUpdated: Date;
}

// Units configuration
export type TemperatureUnit = 'metric' | 'imperial';

// Request parameters interface
export interface WeatherRequestParams {
  location: string;
  units?: TemperatureUnit;
  includeDaily?: boolean;
}
```

### 2. Weather API Client

Create the API client in `src/weather/client.ts`:

```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/env';
import {
  WeatherResponse,
  ForecastResponse,
  WeatherData,
  WeatherRequestParams,
  WeatherErrorResponse,
  TemperatureUnit
} from './types';

// Create a class for the weather API client
export class WeatherApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private cache: Map<string, { data: WeatherData, timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
  
  constructor() {
    this.apiKey = config.WEATHER_API_KEY;
    
    // Initialize axios client with base configuration
    this.client = axios.create({
      baseURL: config.WEATHER_API_URL,
      params: {
        appid: this.apiKey
      },
      timeout: 10000 // 10 seconds timeout
    });
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      this.handleApiError
    );
  }
  
  // Handle API errors with custom error messages
  private handleApiError(error: AxiosError<WeatherErrorResponse>) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const errorResponse = error.response.data;
      
      if (errorResponse.cod === '404' || errorResponse.cod === 404) {
        throw new Error(`Location not found. Please check the city name and try again.`);
      }
      
      if (errorResponse.cod === '401' || errorResponse.cod === 401) {
        throw new Error(`API authentication failed. Please check your API key.`);
      }
      
      throw new Error(`Weather API error: ${errorResponse.message}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error('Unable to connect to weather service. Please check your internet connection.');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`Error setting up weather request: ${error.message}`);
    }
  }
  
  // Get weather data from cache or API
  public async getWeather(params: WeatherRequestParams): Promise<WeatherData> {
    const { location, units = 'metric', includeDaily = true } = params;
    
    // Create cache key based on params
    const cacheKey = `${location}-${units}-${includeDaily}`;
    
    // Check if we have cached data that's still fresh
    const cachedData = this.cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp) < this.CACHE_TTL) {
      return cachedData.data;
    }
    
    try {
      // Fetch current weather
      const currentResponse = await this.client.get<WeatherResponse>('/weather', {
        params: {
          q: location,
          units: units
        }
      });
      
      let forecastResponse: { data: ForecastResponse } | null = null;
      
      // Fetch forecast if requested
      if (includeDaily) {
        forecastResponse = await this.client.get<ForecastResponse>('/forecast', {
          params: {
            q: location,
            units: units,
            cnt: 40  // 5 days forecast, 3-hour steps (8 per day)
          }
        });
      }
      
      // Transform API response to our WeatherData format
      const weatherData = this.transformWeatherData(
        currentResponse.data,
        forecastResponse?.data,
        units
      );
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: weatherData,
        timestamp: Date.now()
      });
      
      return weatherData;
    } catch (error) {
      // Let the interceptor handle known API errors
      // Re-throw other errors
      throw error;
    }
  }
  
  // Transform the raw API response to our internal format
  private transformWeatherData(
    current: WeatherResponse,
    forecast?: ForecastResponse | null,
    units: TemperatureUnit = 'metric'
  ): WeatherData {
    // Extract current weather data
    const weatherData: WeatherData = {
      location: {
        name: current.name,
        country: current.sys.country,
        lat: current.coord.lat,
        lon: current.coord.lon
      },
      current: {
        temperature: current.main.temp,
        feels_like: current.main.feels_like,
        condition: current.weather[0].main,
        conditionDescription: current.weather[0].description,
        icon: current.weather[0].icon,
        humidity: current.main.humidity,
        pressure: current.main.pressure,
        windSpeed: current.wind.speed,
        windDirection: current.wind.deg,
        cloudiness: current.clouds.all,
        visibility: current.visibility,
        precipitation: (current.rain?.['1h'] || current.snow?.['1h'] || 0) || null,
      },
      sun: {
        sunrise: new Date(current.sys.sunrise * 1000),
        sunset: new Date(current.sys.sunset * 1000)
      },
      units: units,
      lastUpdated: new Date(current.dt * 1000)
    };
    
    // Add forecast data if available
    if (forecast) {
      // Group forecast by day
      const dailyForecasts = this.groupForecastByDay(forecast);
      
      weatherData.daily = dailyForecasts.map(dayForecast => {
        // Find the forecast for mid-day (around noon)
        const noonForecast = dayForecast.find(f => {
          const hour = new Date(f.dt * 1000).getHours();
          return hour >= 11 && hour <= 13;
        }) || dayForecast[0];
        
        // Calculate min/max temperature for the day
        const minTemp = Math.min(...dayForecast.map(f => f.main.temp_min));
        const maxTemp = Math.max(...dayForecast.map(f => f.main.temp_max));
        
        // Calculate precipitation probability
        const avgPop = dayForecast.reduce((sum, f) => sum + f.pop, 0) / dayForecast.length;
        
        // Calculate total precipitation
        let totalPrecipitation = 0;
        for (const f of dayForecast) {
          totalPrecipitation += (f.rain?.['3h'] || 0) + (f.snow?.['3h'] || 0);
        }
        
        return {
          date: new Date(noonForecast.dt * 1000),
          temperature: {
            min: minTemp,
            max: maxTemp
          },
          condition: noonForecast.weather[0].main,
          conditionDescription: noonForecast.weather[0].description,
          icon: noonForecast.weather[0].icon,
          precipitation: totalPrecipitation > 0 ? totalPrecipitation : null,
          precipitationProbability: avgPop
        };
      });
    }
    
    return weatherData;
  }
  
  // Group forecast entries by day
  private groupForecastByDay(forecast: ForecastResponse) {
    const grouped: Array<ForecastResponse['list']> = [];
    
    // Use a Map to group by day (YYYY-MM-DD)
    const dayMap = new Map<string, typeof forecast.list>();
    
    forecast.list.forEach(item => {
      const date = new Date(item.dt * 1000);
      const day = date.toISOString().split('T')[0];
      
      if (!dayMap.has(day)) {
        dayMap.set(day, []);
      }
      
      dayMap.get(day)!.push(item);
    });
    
    // Convert map to array
    dayMap.forEach(dayForecasts => {
      grouped.push(dayForecasts);
    });
    
    return grouped;
  }
  
  // Clear the entire cache
  public clearCache() {
    this.cache.clear();
  }
  
  // Clear specific cache entry
  public clearCacheFor(location: string, units: TemperatureUnit = 'metric') {
    const keyPrefix = `${location}-${units}`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// Create and export a singleton instance
export const weatherClient = new WeatherApiClient();
```

### 3. Weather Formatter Utilities

Create utility functions to format weather data for the agent's responses in `src/weather/formatter.ts`:

```typescript
import { WeatherData } from './types';

// Format temperature with units
export const formatTemperature = (temp: number, units: 'metric' | 'imperial'): string => {
  const symbol = units === 'metric' ? '°C' : '°F';
  return `${Math.round(temp)}${symbol}`;
};

// Format wind direction as a cardinal direction
export const formatWindDirection = (degrees: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
};

// Format wind speed with units
export const formatWindSpeed = (speed: number, units: 'metric' | 'imperial'): string => {
  if (units === 'metric') {
    return `${speed.toFixed(1)} m/s`;
  } else {
    return `${speed.toFixed(1)} mph`;
  }
};

// Format weather condition with appropriate emoji
export const formatCondition = (condition: string): string => {
  const emojis: Record<string, string> = {
    'Clear': '☀️',
    'Clouds': '☁️',
    'Drizzle': '🌦️',
    'Rain': '🌧️',
    'Thunderstorm': '⛈️',
    'Snow': '❄️',
    'Mist': '🌫️',
    'Fog': '🌫️',
    'Smoke': '🌫️',
    'Haze': '🌫️',
    'Dust': '🌫️',
    'Sand': '🌫️',
    'Ash': '🌫️',
    'Squall': '💨',
    'Tornado': '🌪️'
  };
  
  const emoji = emojis[condition] || '';
  return `${condition} ${emoji}`;
};

// Format visibility in a human-readable way
export const formatVisibility = (meters: number): string => {
  if (meters >= 10000) {
    return 'Excellent (10+ km)';
  } else if (meters >= 5000) {
    return `Good (${(meters / 1000).toFixed(1)} km)`;
  } else if (meters >= 1000) {
    return `Moderate (${(meters / 1000).toFixed(1)} km)`;
  } else {
    return `Poor (${meters} m)`;
  }
};

// Format humidity with emoji
export const formatHumidity = (humidity: number): string => {
  let description = '';
  let emoji = '';
  
  if (humidity < 30) {
    description = 'very dry';
    emoji = '🏜️';
  } else if (humidity < 50) {
    description = 'comfortable';
    emoji = '👌';
  } else if (humidity < 70) {
    description = 'humid';
    emoji = '💦';
  } else {
    description = 'very humid';
    emoji = '💧💧';
  }
  
  return `${humidity}% (${description}) ${emoji}`;
};

// Format a complete weather report for a location
export const formatWeatherReport = (weather: WeatherData): string => {
  const { location, current, sun, units } = weather;
  
  return `
Weather for ${location.name}, ${location.country}:

Temperature: ${formatTemperature(current.temperature, units)}
Feels like: ${formatTemperature(current.feels_like, units)}
Condition: ${formatCondition(current.condition)} - ${current.conditionDescription}
Humidity: ${formatHumidity(current.humidity)}
Wind: ${formatWindSpeed(current.windSpeed, units)} from ${formatWindDirection(current.windDirection)}
Visibility: ${formatVisibility(current.visibility)}
Pressure: ${current.pressure} hPa
${current.precipitation ? `Precipitation: ${current.precipitation} mm` : ''}
Sunrise: ${sun.sunrise.toLocaleTimeString()}
Sunset: ${sun.sunset.toLocaleTimeString()}

Last updated: ${weather.lastUpdated.toLocaleString()}
  `.trim();
};

// Format a forecast summary
export const formatForecastSummary = (weather: WeatherData): string => {
  if (!weather.daily || weather.daily.length === 0) {
    return 'No forecast data available.';
  }
  
  const { location, units } = weather;
  const forecasts = weather.daily.slice(0, 5); // Up to 5 days
  
  let result = `Forecast for ${location.name}, ${location.country}:\n\n`;
  
  forecasts.forEach(day => {
    const date = day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const condition = formatCondition(day.condition);
    const tempRange = `${formatTemperature(day.temperature.min, units)} to ${formatTemperature(day.temperature.max, units)}`;
    const precipText = day.precipitation 
      ? `Precipitation: ${day.precipitation.toFixed(1)} mm`
      : `Precipitation chance: ${Math.round(day.precipitationProbability * 100)}%`;
    
    result += `${date}: ${condition}, ${tempRange}\n${precipText}\n\n`;
  });
  
  return result.trim();
};
```

### 4. Integration with Agent

Create a weather tool function that the agent can call in `src/weather/tool.ts`:

```typescript
import { CoreTool } from '@mastra/core';
import { weatherClient } from './client';
import { formatWeatherReport, formatForecastSummary } from './formatter';
import { extractLocationFromContext, updateLocationInMemory } from '../memory/utils';
import { weatherMemory } from '../memory';

// Define the weather tool parameters
interface WeatherToolParams {
  location?: string;
  forecast?: boolean;
  units?: 'metric' | 'imperial';
}

// Create the weather tool for the agent to use
export const weatherTool: CoreTool<WeatherToolParams> = {
  name: 'weatherTool',
  description: 'Get current weather information or forecast for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location (e.g., "New York" or "London, UK")'
      },
      forecast: {
        type: 'boolean',
        description: 'Whether to include a 5-day forecast (default: false)'
      },
      units: {
        type: 'string',
        enum: ['metric', 'imperial'],
        description: 'Units to use for temperature and wind speed (default: metric)'
      }
    },
    required: []
  },
  execute: async ({ location, forecast = false, units = 'metric' }, { threadId, resourceId }) => {
    try {
      // If no location is provided, try to extract it from context
      let effectiveLocation = location;
      
      if (!effectiveLocation && threadId) {
        effectiveLocation = await extractLocationFromContext(weatherMemory, threadId);
      }
      
      // If still no location, return an error message
      if (!effectiveLocation) {
        return {
          content: [
            {
              type: 'text',
              text: 'I need a location to check the weather. Please provide a city name or location.'
            }
          ],
          isError: false
        };
      }
      
      // Get weather data from the API
      const weatherData = await weatherClient.getWeather({
        location: effectiveLocation,
        units,
        includeDaily: forecast
      });
      
      // Update memory with the location if we have thread/resource IDs
      if (threadId) {
        await updateLocationInMemory(weatherMemory, threadId, effectiveLocation);
      }
      
      // Format the weather data as a text response
      const weatherText = formatWeatherReport(weatherData);
      const forecastText = forecast ? formatForecastSummary(weatherData) : '';
      
      // Return the formatted weather data
      return {
        content: [
          {
            type: 'text',
            text: forecast ? `${weatherText}\n\n${forecastText}` : weatherText
          }
        ],
        isError: false
      };
    } catch (error) {
      // Handle errors gracefully
      let errorMessage = 'Sorry, there was an error fetching the weather data.';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }
};
```

## Error Handling Strategy

The weather API client includes several layers of error handling:

1. **Input validation**: Ensures the location parameter is provided or extracted from context
2. **Network error handling**: Detects and reports connection issues
3. **API error handling**: Processes error responses from the weather API
4. **Graceful degradation**: Falls back to available data or clear error messages

## Caching Strategy

To minimize API calls and improve response times, the weather API client implements a caching strategy:

1. **Cache duration**: 10 minutes (configurable via CACHE_TTL)
2. **Cache key**: Based on location, units, and request type
3. **Cache invalidation**: Methods to clear specific entries or the entire cache
4. **Memory-based**: Uses a Map for in-memory caching

For production environments with multiple instances, consider implementing a distributed cache using Redis or similar.

## Integration with Memory System

The weather tool integrates with the memory system in two ways:

1. **Location extraction**: Uses the memory system to extract the last mentioned location when none is provided in the current request
2. **Location updating**: Updates the working memory with the current location for future reference

This integration enables natural conversations like:

```
User: "What's the weather in New York?"
Agent: [Provides New York weather]
User: "How about tomorrow?"
Agent: [Provides New York forecast, knowing the context]
```

## Testing Weather API Integration

Create tests for the weather API client in `tests/unit/weather.test.ts`:

```typescript
import { WeatherApiClient } from '../../src/weather/client';
import axios from 'axios';
import { mockWeatherResponse, mockForecastResponse } from '../mocks/weather-responses';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Weather API Client', () => {
  let weatherClient: WeatherApiClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios.create to return a mocked instance
    mockedAxios.create.mockReturnValue(mockedAxios);
    
    // Initialize the client
    weatherClient = new WeatherApiClient();
  });
  
  test('should fetch and format weather data correctly', async () => {
    // Mock successful weather API response
    mockedAxios.get.mockImplementation((url) => {
      if (url.includes('/weather')) {
        return Promise.resolve({ data: mockWeatherResponse });
      } else if (url.includes('/forecast')) {
        return Promise.resolve({ data: mockForecastResponse });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
    
    // Call the getWeather method
    const result = await weatherClient.getWeather({
      location: 'London',
      units: 'metric',
      includeDaily: true
    });
    
    // Verify the result structure
    expect(result).toMatchObject({
      location: {
        name: 'London',
        country: 'GB'
      },
      current: {
        temperature: expect.any(Number),
        condition: expect.any(String)
      },
      daily: expect.arrayContaining([
        expect.objectContaining({
          date: expect.any(Date),
          temperature: expect.objectContaining({
            min: expect.any(Number),
            max: expect.any(Number)
          })
        })
      ])
    });
    
    // Verify that both API calls were made
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
  
  test('should use cached data when available and fresh', async () => {
    // Mock successful weather API response for first call
    mockedAxios.get.mockImplementation((url) => {
      if (url.includes('/weather')) {
        return Promise.resolve({ data: mockWeatherResponse });
      } else if (url.includes('/forecast')) {
        return Promise.resolve({ data: mockForecastResponse });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
    
    // Make first call to populate cache
    await weatherClient.getWeather({
      location: 'London',
      units: 'metric',
      includeDaily: false
    });
    
    // Reset mock to verify no more calls are made
    mockedAxios.get.mockClear();
    
    // Make second call with same parameters
    await weatherClient.getWeather({
      location: 'London',
      units: 'metric',
      includeDaily: false
    });
    
    // Verify that no API calls were made the second time
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
  
  test('should handle API errors gracefully', async () => {
    // Mock API error
    mockedAxios.get.mockRejectedValue({
      response: {
        data: {
          cod: 404,
          message: 'City not found'
        }
      }
    });
    
    // Expect the getWeather call to throw an error
    await expect(weatherClient.getWeather({
      location: 'NonExistentCity',
      units: 'metric'
    })).rejects.toThrow('Location not found');
  });
});
```

## Next Steps

Proceed to [05-agent-implementation.md](05-agent-implementation.md) for details on implementing the weather agent with memory and API integration.
