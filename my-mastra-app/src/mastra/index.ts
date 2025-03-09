
import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { weatherWorkflow } from './workflows';
import { weatherAgent, newsAgent, imageAnalysisAgent } from './agents';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, newsAgent, imageAnalysisAgent },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
