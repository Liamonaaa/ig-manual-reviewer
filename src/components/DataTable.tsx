import React from 'react';
import { Check, Copy, ExternalLink, LoaderCircle, Pause, RotateCcw, X } from 'lucide-react';
import { Status, UserRow } from '../types';

interface Props {
  users: UserRow[];
  activeId: string | null;
  canUnfollow: boolean;
  isQueueProcessing: boolean;
  currentProcessingUsername: string | null;
  onManualUnfollow: (id: string) => void;
  onUpdateStatus: (id: string, status: Status) => void;
  onUpdateNote: (id: string, note: string) => void;
  onUpdateCategory: (id: string, category: string) => void;
  onSetActive: (id: string | null) => void;
}

function statusClassName(status: string) {
  return `status-${status.replace(/\s+/g, '-')}`;
}

export const DataTable: React.FC<Props> = ({
  users,
  activeId,
  canUnfollow,
  isQueueProcessing,
  currentProcessingUsername,
  onManualUnfollow,
  onUpdateStatus,
  onUpdateNote,
  onUpdateCategory,
  onSetActive,
}) => {
  const handleOpen = (username: string) => {
    window.open(`https://www.instagram.com/${username}/`, '_blank');
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="table-shell">
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Quick Actions</th>
              <th>Status</th>
              <th>Category</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isActive = user.id === activeId;
              const isProcessingThisUser = currentProcessingUsername?.toLowerCase() === user.username.toLowerCase();
              const rowLocked = isQueueProcessing;
              const displayStatus = isProcessingThisUser ? 'processing' : user.status;

              return (
                <tr
                  key={user.id}
                  className={`${isActive ? 'active-row' : ''} ${isProcessingThisUser ? 'processing-row' : ''}`}
                  onClick={() => onSetActive(user.id)}
                >
                  <td className="user-cell">
                    <div className="user-meta">
                      <span className="username">@{user.username}</span>
                      <span className="user-subline">
                        {isProcessingThisUser ? 'Bot is processing this profile now.' : 'Instagram profile'}
                      </span>
                    </div>
                    <div className="mini-actions">
                      <button
                        className="icon-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(user.username);
                        }}
                        title="Copy username"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button primary"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpen(user.username);
                        }}
                        title="Open profile"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="action-chip-row">
                      <button
                        className="chip-button chip-keep"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateStatus(user.id, 'kept');
                        }}
                        disabled={rowLocked}
                        title={rowLocked ? 'Stop the bot queue before editing statuses' : 'Mark as kept'}
                      >
                        <Check size={14} /> Keep
                      </button>
                      <button
                        className="chip-button chip-skip"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateStatus(user.id, 'skipped');
                        }}
                        disabled={rowLocked}
                        title={rowLocked ? 'Stop the bot queue before editing statuses' : 'Skip this profile'}
                      >
                        <Pause size={14} /> Skip
                      </button>
                      <button
                        className="chip-button chip-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          onManualUnfollow(user.id);
                        }}
                        disabled={!canUnfollow || rowLocked}
                        title={!canUnfollow ? 'Sign in first' : rowLocked ? 'Stop the bot queue before manual unfollows' : 'Unfollow now'}
                      >
                        {isProcessingThisUser ? <LoaderCircle size={14} className="spin" /> : <X size={14} />} Unfollow
                      </button>
                      {user.status !== 'pending' && (
                        <button
                          className="chip-button chip-reset"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUpdateStatus(user.id, 'pending');
                          }}
                          disabled={rowLocked}
                          title={rowLocked ? 'Stop the bot queue before editing statuses' : 'Move back to pending'}
                        >
                          <RotateCcw size={14} /> Pending
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${statusClassName(displayStatus)}`}>{displayStatus}</span>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={user.category}
                      onChange={(event) => onUpdateCategory(user.id, event.target.value)}
                      placeholder="friend, brand, creator"
                      className="inline-input"
                      disabled={rowLocked}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={user.notes}
                      onChange={(event) => onUpdateNote(user.id, event.target.value)}
                      placeholder="Anything worth remembering?"
                      className="inline-input full-width"
                      disabled={rowLocked}
                    />
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No profiles match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
