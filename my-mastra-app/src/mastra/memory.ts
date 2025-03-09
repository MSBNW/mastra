// Memory implementation for Mastra agents
// This provides enhanced capabilities for maintaining context in conversations

// Define the memory options interface
export interface MemoryOptions {
  lastMessages?: number;
  semanticRecall?: {
    enabled?: boolean;
    topK?: number;
    messageRange?: number;
  } | boolean;
  workingMemory?: {
    enabled: boolean;
    template?: string;
  };
}

// Mock storage types to satisfy the API requirements
type StorageThreadType = any;
type MessageType = any;

/**
 * Enhanced Memory class for Mastra agents
 * This simulates the main functionality of the full Memory implementation
 */
export class SimpleMemory {
  // Required properties that match the MastraMemory interface
  storage: any = {};
  vector: any = null;
  embedder: any = null;
  threadConfig: any = {};
  name: string = "Memory";
  logger: any = console;
  
  private options: MemoryOptions;
  private messages: Record<string, any[]> = {}; // Simple in-memory storage
  
  constructor(options: MemoryOptions = {}) {
    this.options = {
      lastMessages: options.lastMessages || 10,
      semanticRecall: options.semanticRecall || {
        enabled: true,
        topK: 3,
        messageRange: 1,
      },
      workingMemory: options.workingMemory || {
        enabled: false,
      }
    };
    
    // Initialize mock storage methods
    this.storage = {
      __getMessages: this.getMessages.bind(this),
      __saveMessages: this.saveMessages.bind(this),
      __getThreadById: this.getThreadById.bind(this),
      __getThreadsByResourceId: this.getThreadsByResourceId.bind(this),
      __saveThread: this.saveThread.bind(this),
      __updateThread: this.updateThread.bind(this),
      __deleteThread: this.deleteThread.bind(this)
    };
  }
  
  // Basic methods to satisfy the interface
  async query(params: any): Promise<any> {
    const { threadId } = params;
    const messages = this.messages[threadId] || [];
    const lastN = this.options.lastMessages || 10;
    return {
      messages: messages.slice(-lastN),
      uiMessages: messages.slice(-lastN)
    };
  }
  
  async rememberMessages(params: any): Promise<any> {
    const { threadId } = params;
    const messages = this.messages[threadId] || [];
    const lastN = this.options.lastMessages || 10;
    return {
      threadId,
      messages: messages.slice(-lastN),
      uiMessages: messages.slice(-lastN)
    };
  }
  
  // Mock storage methods
  private async getMessages({ threadId }: { threadId: string }): Promise<any[]> {
    return this.messages[threadId] || [];
  }
  
  private async saveMessages({ messages }: { messages: any[] }): Promise<any[]> {
    if (messages.length > 0) {
      const threadId = messages[0].threadId;
      if (!this.messages[threadId]) {
        this.messages[threadId] = [];
      }
      this.messages[threadId] = [...this.messages[threadId], ...messages];
    }
    return messages;
  }
  
  private async getThreadById({ threadId }: { threadId: string }): Promise<StorageThreadType | null> {
    return { 
      id: threadId, 
      title: `Thread ${threadId}`,
      resourceId: threadId.split('_')[0],
      metadata: {}
    };
  }
  
  private async getThreadsByResourceId({ resourceId }: { resourceId: string }): Promise<StorageThreadType[]> {
    return Object.keys(this.messages)
      .filter(threadId => threadId.startsWith(resourceId))
      .map(threadId => ({
        id: threadId,
        title: `Thread ${threadId}`,
        resourceId,
        metadata: {}
      }));
  }
  
  private async saveThread({ thread }: { thread: StorageThreadType }): Promise<StorageThreadType> {
    return thread;
  }
  
  private async updateThread({ id, title, metadata }: { id: string, title: string, metadata: Record<string, unknown> }): Promise<StorageThreadType> {
    return {
      id,
      title,
      resourceId: id.split('_')[0],
      metadata
    };
  }
  
  private async deleteThread({ threadId }: { threadId: string }): Promise<void> {
    delete this.messages[threadId];
  }
  
  // Getter to access memory options
  getOptions() {
    return this.options;
  }
  
  // These methods are just stubs to satisfy the interface
  async getSystemMessage(): Promise<string | null> {
    return null;
  }
  
  parseMessages(messages: any[]): any[] {
    return messages;
  }
  
  convertToUIMessages(messages: any[]): any[] {
    return messages;
  }
  
  getTools(): Record<string, any> {
    return {};
  }
  
  getMergedThreadConfig(config: any = {}): any {
    return { ...this.options, ...config };
  }
  
  async createEmbeddingIndex(): Promise<{ indexName: string }> {
    return { indexName: 'mock-index' };
  }
}

// Export a factory function for creating memory instances
export function createMemory(options: MemoryOptions = {}) {
  return new SimpleMemory(options);
}
