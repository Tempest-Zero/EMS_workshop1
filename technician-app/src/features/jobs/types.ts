export type JobsStackParamList = {
  /** The categories hub — the first screen of the Jobs track. */
  JobCategories: undefined;
  /** Three filtered views over the same list screen (route name = filter). */
  AvailableTasks: undefined;
  OngoingTasks: undefined;
  CompletedTasks: undefined;
  /** Legacy flat list, kept as the fallback route. */
  JobsList: undefined;
  JobDetail: { id: string; token: number };
  CompleteJob: { id: string; token: number };
  CreateJob: undefined;
  Travel: { id: string; token: number };
};
