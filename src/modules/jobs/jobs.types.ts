export type JobStatus = 'SCHEDULED' | 'QUEUED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type JobSortBy = 'createdAt' | 'runAt';

export type SortOrder = 'asc' | 'desc';

export interface GetJobsQuery {
  page: number;
  limit: number;
  status?: JobStatus;
  sortBy: JobSortBy;
  order: SortOrder;
}
