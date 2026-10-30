import { Logger } from '@nestjs/common';
import { apiError } from '../common/api-error.js';

/** Delivers a one-time sign-in code to a phone. Swap the implementation to change SMS/WhatsApp provider. */
export abstract class OtpSender {
  abstract send(mobile: string, code: string, collegeName: string): Promise<void>;
}

/** Local development: prints the code in the API console instead of sending a message. */
export class ConsoleOtpSender extends OtpSender {
  private readonly logger = new Logger('OTP');

  async send(mobile: string, code: string): Promise<void> {
    this.logger.warn(`Sign-in code for +91 ${mobile}: ${code}  (local development only; nothing was sent)`);
  }
}

/** Production until an SMS provider is chosen and wired in: refuses instead of pretending to send. */
export class UnavailableOtpSender extends OtpSender {
  async send(): Promise<void> {
    throw apiError(503, 'otp_unavailable', 'Mobile sign-in is not available yet. Use your email and password.');
  }
}
