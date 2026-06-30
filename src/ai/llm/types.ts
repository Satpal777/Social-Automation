export interface PromptSpec {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  tier?: 'fast' | 'smart';
}

export interface LLMResult {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  generate(prompt: PromptSpec): Promise<LLMResult>;
  embed?(text: string): Promise<number[]>;
}
