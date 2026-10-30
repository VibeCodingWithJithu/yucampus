import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { FileStorage, UnconfiguredStorage } from './file-storage.js';
import { S3Storage } from './s3-storage.js';

@Global()
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [AppConfig],
      useFactory: async (config: AppConfig): Promise<FileStorage> => {
        if (!config.storage) {
          new Logger('Storage').warn('No S3 storage configured: file uploads are off. See .env.example.');
          return new UnconfiguredStorage();
        }
        const storage = new S3Storage(config.storage);
        if (!config.isProduction) {
          try {
            await storage.prepareForDevelopment(config.uploadOrigins);
          } catch (error) {
            new Logger('Storage').warn(`Could not reach file storage at ${config.storage.endpoint}: ${String(error)}`);
          }
        }
        return storage;
      },
    },
  ],
  exports: [FileStorage],
})
export class StorageModule {}
