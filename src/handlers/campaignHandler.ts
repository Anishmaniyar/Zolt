export const campaignHandler = async (payload: any, signal: AbortSignal) => {
  console.log('CAMPAIGN JOB STARTED');
  console.log('Data: ', payload);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('CAMPAIGN JOB DONE');
};
