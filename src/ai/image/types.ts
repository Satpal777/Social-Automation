export interface ImageOptions {
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
}

export interface ImageProvider {
  generate(prompt: string, options?: ImageOptions): Promise<Buffer>;
}
