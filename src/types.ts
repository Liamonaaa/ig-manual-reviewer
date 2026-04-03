export type Status = 'pending' | 'failed';
export type ImportSource = 'csv' | 'instagram-export' | 'none';

export interface UserRow {
  id: string;
  username: string;
  status: Status;
  notes: string;
  category: string;
  originalIndex: number;
  failureReason?: string;
  lastAttemptAt?: string;
}

export interface ImportSummary {
  label: string;
  details?: string;
}

export interface ImportResult {
  users: UserRow[];
  source: ImportSource;
  summary: ImportSummary;
}
