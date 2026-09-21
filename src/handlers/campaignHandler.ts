export const campaignHandler = async (job) => {
  console.log('CAMPAIGN JOB STARTED');
  console.log('Data: ', job.data);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('CAMPAIGN JOB DONE');
};
