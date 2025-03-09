// Import SimpleMemory class from our local memory implementation
import { SimpleMemory } from './mastra/memory';

// Export a simple memory factory function for our agents
export function createMemory(options: any = {}) {
  return new SimpleMemory({
    lastMessages: options.lastMessages || 10,
    semanticRecall: options.semanticRecall || {
      enabled: true,
      topK: 3,
      messageRange: 1,
    },
    workingMemory: options.workingMemory || {
      enabled: false,
    },
  });
}
