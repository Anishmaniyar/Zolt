export const emailHandler = async (job) => {
  console.log('EMAIL JOB STARTED');
  console.log('Data: ', job.data);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('EMAIL JOB DONE');
};
