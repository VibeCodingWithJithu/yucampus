import { describe, expect, it } from 'vitest';
import { emailSchema, mobileSchema, verifyOtpSchema } from './auth.js';
import { pageQuerySchema } from './index.js';

describe('mobileSchema', () => {
  it.each(['9876543210', '98765 43210', '+91 98765 43210', '09876543210', '919876543210'])(
    'accepts %s',
    (input) => {
      expect(mobileSchema.parse(input)).toBe('9876543210');
    },
  );

  it.each(['12345', '5876543210', '98765432101', 'abcdefghij'])('rejects %s', (input) => {
    expect(mobileSchema.safeParse(input).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Name@College.EDU.in ')).toBe('name@college.edu.in');
  });
});

describe('verifyOtpSchema', () => {
  it('needs exactly six digits', () => {
    expect(verifyOtpSchema.safeParse({ mobile: '9876543210', otp: '12345' }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ mobile: '9876543210', otp: '123456' }).success).toBe(true);
  });
});

describe('pageQuerySchema', () => {
  it('defaults to page 1 of 20 and caps page size at 50', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(pageQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});
