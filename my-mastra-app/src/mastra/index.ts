
import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { weatherWorkflow, imageToWeatherWorkflow } from './workflows';
import { weatherAgent, newsAgent, imageAnalysisAgent, calendarAgent, smsAgent, locationWeatherAgent } from './agents';

export const mastra = new Mastra({
  workflows: { weatherWorkflow, imageToWeatherWorkflow },
  agents: { weatherAgent, newsAgent, imageAnalysisAgent, calendarAgent, smsAgent, locationWeatherAgent },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
