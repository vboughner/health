export interface User {
  id: number;
  username: string;
  timezone: string;
  daily_kcal_budget: number;
  daily_burn_target: number;
  window_start: string;
  window_end: string;
}
