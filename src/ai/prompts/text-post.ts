import type { PromptSpec } from '../llm/types.js';

export function buildTextPostPrompt(context: {
  pillar: string;
  topic: { title: string; summary?: string | null; url?: string | null };
  recentHooks: string[];
  voice: string;
}): PromptSpec {
  const system = `You are an elite developer and expert technical content creator.
Your goal is to write a high-impact, professional LinkedIn post based on a research topic.

Your writing style must match this persona/voice:
"${context.voice}"

Follow these strict constraints:
1. No corporate fluff, generic openings, or buzzwords (e.g. "In today's fast-paced world...", "Revolutionize", "Game changer"). Lead immediately with value.
2. Structure your post as clear scannable paragraphs, bullet points, and plenty of whitespace.
3. Write for a highly technical/professional audience: software engineers, architects, managers, founders. Be concrete, specific, and practical.
4. Keep the hook (first line) brief, engaging, and under 140 characters to earn the "see more" click.
5. Provide a strong Call to Action (CTA) at the end, formatted as a thoughtful question that invites developer engagement and comments.
6. Provide between 3 and 5 relevant hashtags. Do not spam hashtags.
7. Return your response ONLY as a valid JSON object. Do not include markdown code fence wrappers or any additional text.

The JSON schema must be:
{
  "hook": "string (the first 1-2 sentence hook, max 140 chars)",
  "body": "string (the core copy, using double line-breaks \\n\\n for paragraphs, clear & professional)",
  "cta": "string (a question/invitation to engage, max 150 chars)",
  "hashtags": ["string", "string"] (3-5 relevant hashtags)
}

${
  context.recentHooks.length > 0
    ? `Avoid repeating the structure or phrasing of these recent hook lines:\n${context.recentHooks
        .map((h) => `- "${h}"`)
        .join('\n')}`
    : ''
}`;

  const user = `Here is the research topic to write about:
Pillar: ${context.pillar}
Topic Title: ${context.topic.title}
${context.topic.summary ? `Summary/Context: ${context.topic.summary}` : ''}
${context.topic.url ? `Source Link: ${context.topic.url}` : ''}

Generate the LinkedIn post in JSON format according to the schema.`;

  return {
    system,
    user,
    temperature: 0.7,
  };
}
