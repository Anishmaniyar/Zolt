import dotenv from 'dotenv';
dotenv.config();

import { startScheduler } from '../modules/scheduler/scheduler.service.js';

// Boot an isolated scheduler engine thread
startScheduler();
