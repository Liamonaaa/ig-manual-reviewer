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
            // Find username column regardless of case
            const keys = Object.keys(row);
            const userKey = keys.find(k => k.toLowerCase().includes('username') || k.toLowerCase() === 'user');
            
            if (!userKey) continue;
            
            let username = (row[userKey] || '').toString().trim();
            if (!username) continue;
            
            if (username.startsWith('@')) {
              username = username.substring(1);
            }

            if (seenUsernames.has(username)) continue;
            seenUsernames.add(username);

            rows.push({
              id: uuidv4(),
              username,
              status: ['pending', 'kept', 'unfollowed manually', 'skipped'].includes(row.status?.toLowerCase()) ? row.status.toLowerCase() : 'pending',
              notes: row.notes || '',
              category: row.category || '',
              originalIndex: index++,
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
  const data = users.map(u => ({
    username: u.username,
    status: u.status,
    notes: u.notes,
    category: u.category
  }));
  
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'reviewed_users.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
