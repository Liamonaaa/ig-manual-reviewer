export type Status = 'pending' | 'kept' | 'unfollowed manually' | 'skipped';

export interface UserRow {
  id: string;
  username: string;
  status: Status;
  notes: string;
  category: string;
  originalIndex: number;
}
