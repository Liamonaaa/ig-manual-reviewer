import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';
import { UserRow } from '../types';

export const parseCSVFile = (file: File): Promise<UserRow[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows: UserRow[] = [];
          const seenUsernames = new Set<string>();
          let index = 0;

          for (const row of results.data as any[]) {
            const keys = Object.keys(row);
            const userKey = keys.find((key) => key.toLowerCase().includes('username') || key.toLowerCase() === 'user');

            if (!userKey) continue;

            let username = (row[userKey] || '').toString().trim();
            if (!username) continue;

            if (username.startsWith('@')) {
              username = username.substring(1);
            }

            const normalizedUsername = username.toLowerCase();

            if (seenUsernames.has(normalizedUsername)) continue;
            const rawStatus = (row.status || '').toString().trim().toLowerCase();
            const failureReason = (row.failureReason || row.failure_reason || row.error || row.notes || '').toString().trim();
            seenUsernames.add(normalizedUsername);

            rows.push({
              id: uuidv4(),
              username,
              status: rawStatus === 'failed' ? 'failed' : 'pending',
              notes: row.notes || '',
              category: row.category || '',
              originalIndex: index++,
              failureReason,
              lastAttemptAt: row.lastAttemptAt || row.last_attempt_at || '',
            });
          }
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};

export const exportToCSV = (users: UserRow[]) => {
  const data = users.map((user) => ({
    username: user.username,
    status: user.status,
    failureReason: user.failureReason || '',
    notes: user.notes,
    category: user.category,
    lastAttemptAt: user.lastAttemptAt || '',
  }));

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'instagram-review-export.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
