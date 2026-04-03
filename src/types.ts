export type Status = 'pending' | 'kept' | 'unfollowed manually' | 'skipped';
export type ImportSource = 'csv' | 'instagram-export' | 'seed';

export interface UserRow {
  id: string;
  username: string;
  status: Status;
  notes: string;
  category: string;
  originalIndex: number;
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
