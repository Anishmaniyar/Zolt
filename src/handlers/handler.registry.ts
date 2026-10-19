import { emailHandler } from './emailHandler.js';
import { campaignHandler } from './campaignHandler.js';
import { generateReportHandler } from './generateReport.js';
import { webHookHandler } from './sendWebHook.js';

export const handlerRegistry = {
  SEND_EMAIL: emailHandler,
  CREATE_CAMPAIGN: campaignHandler,
  GENERATE_REPORT: generateReportHandler,
  WEB_HOOK: webHookHandler,
};
