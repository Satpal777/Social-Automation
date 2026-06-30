import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/lib/crypto.js';

describe('Crypto Utilities', () => {
  it('should encrypt and decrypt correctly', () => {
    const plaintext = 'Super secret token 123!';
    const encrypted = encrypt(plaintext);
    
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':').length).toBe(3); // iv:ciphertext:tag

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should throw an error on malformed ciphertext', () => {
    expect(() => decrypt('malformed-payload')).toThrow('Invalid encrypted payload');
    expect(() => decrypt('a:b')).toThrow('Invalid encrypted payload');
  });
});
