import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { apiRouter } from './routes/api.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    service: 'Frank Eiselt AI Shop API',
    status: 'ok',
    version: '0.1.0',
    shop: 'frankeiselt.de',
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'frankeiselt-api',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1', apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid request',
      details: error.flatten(),
    });
  }

  console.error(error);
  return res.status(500).json({
    error: 'Internal server error',
  });
});

app.listen(env.PORT, () => {
  console.log(`Frank Eiselt AI Shop API listening on port ${env.PORT}`);
});
