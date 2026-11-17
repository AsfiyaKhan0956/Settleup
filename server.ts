import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { initializeDatabase } from './server/db.ts';
import { verifySameOrigin } from './server/security.ts';
import { authRouter } from './server/routes/auth.ts';
import { groupsRouter } from './server/routes/groups.ts';
import { expensesRouter } from './server/routes/expenses.ts';
import { balancesRouter } from './server/routes/balances.ts';
import { analyticsRouter } from './server/routes/analytics.ts';
import { notificationsRouter } from './server/routes/notifications.ts';
import { profileRouter } from './server/routes/profile.ts';
import { assistantRouter } from './server/routes/assistant.ts';
import { personalRouter } from './server/routes/personal.ts';
import { manualBalancesRouter } from './server/routes/manualBalances.ts';

async function startServer() {
  initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use('/api', verifySameOrigin);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'SettleUp API' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/balances', balancesRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/assistant', assistantRouter);
  app.use('/api/personal', personalRouter);
  app.use('/api/manual-balances', manualBalancesRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SettleUp server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SettleUp server:', err);
  process.exit(1);
});
