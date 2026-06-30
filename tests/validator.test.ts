import { describe, it, expect } from 'vitest';
import { validateContent } from '../src/content/validator.js';
import { ValidationError } from '../src/lib/errors.js';

describe('Content Validator', () => {
  const validBase = {
    hook: 'A short hook under 140 chars.',
    body: 'A realistic body describing software engineering practices.',
    cta: 'What do you think?',
    hashtags: ['#coding', '#design', '#architecture'],
  };

  it('should pass on valid text content', () => {
    expect(() => validateContent(validBase, 'text')).not.toThrow();
  });

  it('should fail if hook is missing or empty', () => {
    expect(() => validateContent({ ...validBase, hook: '' }, 'text')).toThrow(
      ValidationError
    );
  });

  it('should fail if hook exceeds 140 chars', () => {
    const longHook = 'a'.repeat(141);
    expect(() => validateContent({ ...validBase, hook: longHook }, 'text')).toThrow(
      ValidationError
    );
  });

  it('should fail if body exceeds 3000 chars', () => {
    const longBody = 'a'.repeat(3001);
    expect(() => validateContent({ ...validBase, body: longBody }, 'text')).toThrow(
      ValidationError
    );
  });

  it('should fail on invalid hashtags count', () => {
    // Too few (less than 3)
    expect(() =>
      validateContent({ ...validBase, hashtags: ['#one', '#two'] }, 'text')
    ).toThrow(ValidationError);

    // Too many (more than 5)
    expect(() =>
      validateContent(
        { ...validBase, hashtags: ['#one', '#two', '#three', '#four', '#five', '#six'] },
        'text'
      )
    ).toThrow(ValidationError);
  });

  it('should fail on duplicate hashtags', () => {
    expect(() =>
      validateContent({ ...validBase, hashtags: ['#one', '#two', '#one'] }, 'text')
    ).toThrow(ValidationError);
  });

  it('should validate carousel slides count', () => {
    // Carousel with correct slides count (3)
    const validCarousel = {
      ...validBase,
      slides: [
        { title: 'Slide 1', content: 'Content 1' },
        { title: 'Slide 2', content: 'Content 2' },
        { title: 'Slide 3', content: 'Content 3' },
      ],
    };
    expect(() => validateContent(validCarousel, 'carousel')).not.toThrow();

    // Less than 3 slides
    const invalidCarousel = {
      ...validBase,
      slides: [
        { title: 'Slide 1', content: 'Content 1' },
        { title: 'Slide 2', content: 'Content 2' },
      ],
    };
    expect(() => validateContent(invalidCarousel, 'carousel')).toThrow(ValidationError);
  });

  it('should validate poll options count', () => {
    // Valid poll (3 options)
    const validPoll = {
      ...validBase,
      pollQuestion: 'Which language is best?',
      pollOptions: ['TypeScript', 'Rust', 'Go'],
    };
    expect(() => validateContent(validPoll, 'poll')).not.toThrow();

    // Less than 2 options
    const invalidPoll = {
      ...validBase,
      pollQuestion: 'Which language is best?',
      pollOptions: ['TypeScript'],
    };
    expect(() => validateContent(invalidPoll, 'poll')).toThrow(ValidationError);
  });
});
