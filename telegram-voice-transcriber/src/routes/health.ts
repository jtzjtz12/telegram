import { Router, type Request, type Response } from 'express';

export const healthRouter = Router();

/**
 * GET /health
 * Simple healthcheck returning {"status":"ok"}
 */
healthRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});
