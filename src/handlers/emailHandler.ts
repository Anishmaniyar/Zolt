// export const emailHandler = async (job: any) => {
//   console.log('EMAIL JOB STARTED');
//   console.log('Data: ', job.data);

//   await new Promise((resolve) => setTimeout(resolve, 5000));

//   console.log('EMAIL JOB DONE');
// };

export const emailHandler = async (payload: Record<string, unknown>): Promise<void> => {
  console.log('EMAIL JOB STARTED');
  console.log('Data: ', payload);

  throw new Error('Simulated email delivery failure');
};
