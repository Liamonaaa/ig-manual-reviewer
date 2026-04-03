import React from 'react';
import { UserRow, Status } from '../types';
import { ExternalLink, Copy, Check, X, SkipForward, Clock } from 'lucide-react';

interface Props {
  users: UserRow[];
  activeId: string | null;
  onUpdateStatus: (id: string, status: Status) => void;
  onUpdateNote: (id: string, note: string) => void;
  onUpdateCategory: (id: string, category: string) => void;
  onSetActive: (id: string | null) => void;
}

export const DataTable: React.FC<Props> = ({
  users,
  activeId,
  onUpdateStatus,
  onUpdateNote,
  onUpdateCategory,
  onSetActive
}) => {

  const handleOpen = (username: string) => {
    window.open(`https://www.instagram.com/${username}/`, '_blank');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Actions</th>
            <th>Status</th>
            <th>Category</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr 
              key={u.id} 
              className={u.id === activeId ? 'active-row' : ''}
              onClick={() => onSetActive(u.id)}
            >
              <td className="user-cell">
                <span className="username">@{u.username}</span>
                <button className="icon-button" onClick={(e) => { e.stopPropagation(); copyToClipboard(u.username); }} title="Copy Username">
                  <Copy size={14} />
                </button>
                <button className="icon-button primary" onClick={(e) => { e.stopPropagation(); handleOpen(u.username); }} title="Open Profile">
                  <ExternalLink size={14} />
                </button>
              </td>
              <td className="actions-cell">
                <select 
                  value={u.status} 
                  onChange={(e) => onUpdateStatus(u.id, e.target.value as Status)}
                  className={`status-select status-${u.status.replace(' ', '-')}`}
                  disabled
                >
                  <option value="pending">Pending</option>
                  <option value="kept">Kept</option>
                  <option value="unfollowed manually">Unfollowed</option>
                  <option value="skipped">Skipped</option>
                </select>
                <div className="quick-actions">
                  <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(u.id, 'kept'); }} title="Keep (K)"><Check size={16} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(u.id, 'unfollowed manually'); }} title="Unfollow (U)"><X size={16} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(u.id, 'skipped'); }} title="Skip (S)"><SkipForward size={16} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(u.id, 'pending'); }} title="Pending"><Clock size={16} /></button>
                </div>
              </td>
              <td>
                <span className={`status-badge status-${u.status.replace(' ', '-')}`}>{u.status}</span>
              </td>
              <td>
                <input 
                  type="text" 
                  value={u.category} 
                  onChange={(e) => onUpdateCategory(u.id, e.target.value)} 
                  placeholder="e.g. friend"
                  className="inline-input"
                />
              </td>
              <td>
                <input 
                  type="text" 
                  value={u.notes} 
                  onChange={(e) => onUpdateNote(u.id, e.target.value)} 
                  placeholder="Add notes..."
                  className="inline-input full-width"
                />
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">No users match the current filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
