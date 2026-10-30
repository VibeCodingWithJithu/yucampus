import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@yucampus/types';
import type { Response } from 'express';

/** An error with a stable `code` for clients to branch on and a plain-English `message` to show. */
export function apiError(statusCode: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode, code, message } satisfies ApiErrorBody, statusCode);
}

/** Makes every error response the same shape (ApiErrorBody) and keeps internals out of 500s. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      return { statusCode: 500, code: 'internal_error', message: 'Something went wrong. Please try again.' };
    }
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
      return { statusCode, code: String(body.code), message: String(body.message) };
    }
    const message = typeof body === 'string' ? body : exception.message;
    return { statusCode, code: statusCode === 404 ? 'not_found' : 'request_failed', message };
  }
}
