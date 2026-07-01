export interface ImageOptions {
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
}

export interface GeneratedImage {
  buffer: Buffer;
  /** Actual format the provider produced — callers must not assume PNG. */
  mime: 'image/png' | 'image/jpeg';
}

export interface ImageProvider {
  generate(prompt: string, options?: ImageOptions): Promise<GeneratedImage>;
}
