import { z } from 'zod';

/** Indian mobile number: 10 digits starting 6-9. Spaces and a +91 / 0 prefix are accepted and removed. */
export const mobileSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

export const requestOtpSchema = z.object({ mobile: mobileSchema });
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  mobile: mobileSchema,
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
