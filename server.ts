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
import { tripLedgerRouter } from './server/routes/tripLedger.ts';

function validateProductionConfiguration(): void {
  const appTimeZone = process.env.APP_TIME_ZONE?.trim() || 'Asia/Kolkata';
  try { new Intl.DateTimeFormat('en', { timeZone: appTimeZone }).format(new Date()); }
  catch { throw new Error(`APP_TIME_ZONE is not a valid IANA timezone: ${appTimeZone}`); }
  if (process.env.NODE_ENV !== 'production') return;
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
  if (sessionSecret.length < 32 || sessionSecret === 'CHANGE_ME_IN_PRODUCTION') {
    throw new Error('Production requires SESSION_SECRET with at least 32 characters of random data.');
  }
  const appUrl = process.env.APP_URL?.trim() ?? '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error('Production requires APP_URL to be the public HTTPS URL of this SettleUp installation.');
  }
  if (parsedUrl.protocol !== 'https:' || /localhost|127\.0\.0\.1/i.test(parsedUrl.hostname) || parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error('Production APP_URL must be a public HTTPS origin only, for example https://settleup.example.com.');
  }
}

async function startServer() {
  validateProductionConfiguration();
  initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });
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
  app.use('/api/trip-ledger', tripLedgerRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    console.error('Unhandled SettleUp request error:', err);
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
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
