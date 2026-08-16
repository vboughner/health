import { config } from './config';
import { openDatabase } from './db';
import { deleteExpiredSessions } from './auth';
import { createUsdaClient } from './usda';
import { buildApp } from './app';

async function main() {
  const db = openDatabase(config.dbPath);
  deleteExpiredSessions(db);

  const app = buildApp({
    db,
    usda: createUsdaClient(config.usdaApiKey),
    mediaDir: config.mediaDir,
    sessionSecret: config.sessionSecret,
    isProduction: config.isProduction,
    logger: true,
  });

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`database: ${config.dbPath}`);
  app.log.info(`recordings: ${config.mediaDir}`);
  app.log.info(
    `usda key: ${config.usdaApiKey ? 'configured' : 'MISSING — food search will be limited'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
