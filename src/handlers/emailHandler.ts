// Simulates sending an email for a SEND_EMAIL job payload.
export const emailHandler = async (payload: any, signal: AbortSignal) => {
  console.log('EMAIL JOB STARTED');
  console.log('Data: ', payload);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('EMAIL JOB DONE');
};

// export const emailHandler = async (payload: Record<string, unknown>): Promise<void> => {
//   console.log('EMAIL JOB STARTED');
//   console.log('Data: ', payload);

//   throw new Error('Simulated email delivery failure');
// };
