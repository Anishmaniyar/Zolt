import Router from 'express';

import jobRouter from '../modules/jobs/jobs.routes.js';

const rootRouter = Router();

rootRouter.use(jobRouter);

export default rootRouter;
