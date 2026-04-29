import React from 'react';
import { Copy, ExternalLink, LoaderCircle, RefreshCcw, X } from 'lucide-react';
import { UserRow } from '../types';

interface Props {
  title: string;
  subtitle: string;
  kind: 'pending' | 'failed';
  users: UserRow[];
  activeId: string | null;
  canAct: boolean;
  busyUserId: string | null;
  currentProcessingUsername: string | null;
  emptyText: string;
  actionLabel: string;
  actionBusyLabel: string;
  onAction: (id: string) => void;
  onSetActive: (id: string | null) => void;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return 'עדיין לא בוצעה פעולה';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export const DataTable: React.FC<Props> = ({
  title,
  subtitle,
  kind,
  users,
  activeId,
  canAct,
  busyUserId,
  currentProcessingUsername,
  emptyText,
  actionLabel,
  actionBusyLabel,
  onAction,
  onSetActive,
}) => {
  const handleOpen = (username: string) => {
    window.open(`https://www.instagram.com/${username}/`, '_blank');
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <section className="table-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{kind === 'pending' ? 'רשימת עבודה' : 'רשימת כשלונות'}</p>
          <h3>{title}</h3>
        </div>
        <span className={`tiny-badge ${kind === 'pending' ? 'tiny-badge-idle' : 'tiny-badge-danger'}`}>{users.length}</span>
      </div>
      <p className="panel-copy">{subtitle}</p>

      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>פרופיל</th>
              <th>מצב</th>
              <th>פרטים</th>
              <th>פעולה</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isActive = user.id === activeId;
              const isProcessingThisUser = currentProcessingUsername?.toLowerCase() === user.username.toLowerCase();
              const isBusy = busyUserId === user.id;
              const isAnotherRowBusy = Boolean(busyUserId && busyUserId !== user.id);
              const rowLocked = !canAct || isAnotherRowBusy;
              const statusLabel = kind === 'failed'
                ? 'לא הוסר'
                : isBusy
                  ? 'טוען...'
                  : isProcessingThisUser
                    ? 'הבוט עובד עכשיו'
                    : 'מוכן להסרה';
              const detailText = kind === 'failed'
                ? user.failureReason || 'הבוט לא הצליח להסיר את המשתמש הזה.'
                : isBusy
                  ? 'הבקשה נשלחה לבוט. ממתין לאישור...'
                  : isProcessingThisUser
                    ? 'הסרה אוטומטית פועלת כרגע ברקע.'
                    : 'לחץ על הכפתור כדי להסיר עוקב בצורה ידנית.';

              return (
                <tr
                  key={user.id}
                  className={`${isActive ? 'active-row' : ''} ${isProcessingThisUser || isBusy ? 'processing-row' : ''}`}
                  onClick={() => onSetActive(user.id)}
                >
                  <td className="user-cell">
                    <div className="user-meta">
                      <span className="username">@{user.username}</span>
                      <span className="user-subline">
                        {kind === 'failed' ? 'הועבר לרשימת כשלונות' : 'פרופיל אינסטגרם'}
                      </span>
                    </div>
                    <div className="mini-actions">
                      <button
                        className="icon-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(user.username);
                        }}
                        title="העתקת שם משתמש"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button primary"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpen(user.username);
                        }}
                        title="פתיחת פרופיל"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${kind === 'failed' ? 'status-failed' : isBusy || isProcessingThisUser ? 'status-processing' : 'status-pending'}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td>
                    <div className="detail-stack">
                      <span>{detailText}</span>
                      <span className="detail-meta">{formatTimestamp(user.lastAttemptAt)}</span>
                    </div>
                  </td>
                  <td>
                    <button
                      className={`chip-button ${kind === 'failed' ? 'chip-retry' : 'chip-danger'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction(user.id);
                      }}
                      disabled={rowLocked || isBusy}
                    >
                      {isBusy ? (
                        <>
                          <LoaderCircle size={14} className="spin" /> {actionBusyLabel}
                        </>
                      ) : kind === 'failed' ? (
                        <>
                          <RefreshCcw size={14} /> {actionLabel}
                        </>
                      ) : (
                        <>
                          <X size={14} /> {actionLabel}
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
