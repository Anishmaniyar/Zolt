import { emailHandler } from './emailHandler.js';
import { campaignHandler } from './campaignHandler.js';

export const handlerRegistry = {
  SEND_EMAIL: emailHandler,
  CREATE_CAMPAIGN: campaignHandler,
};
