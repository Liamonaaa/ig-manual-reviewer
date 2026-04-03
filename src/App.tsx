import { useEffect, useMemo, useState } from 'react';
import { Moon, Sun, Download, Trash2, Layers, RefreshCw } from 'lucide-react';
import { CSVImporter } from './components/CSVImporter';
import { DataTable } from './components/DataTable';
import { useLocalStorage } from './hooks/useLocalStorage';
import { exportToCSV } from './utils/csv';
import { Status, UserRow } from './types';
import initialUsersData from './initialUsers.json';
import './index.css';

const defaultUsers = initialUsersData as UserRow[];
const BOT_API_BASE_URL = 'http://127.0.0.1:5000';

type SyncStateResponse = {
  success: boolean;
  remainingCount?: number;
  remainingUsers?: string[];
  error?: string;
};

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase();
}

function reconcileUsersWithRemaining(currentUsers: UserRow[], remainingUsers: string[]): UserRow[] {
  const remainingUsernameSet = new Set(remainingUsers.map(normalizeUsername));
  return currentUsers.filter((user) => remainingUsernameSet.has(normalizeUsername(user.username)));
}

export default function App() {
  const [users, setUsers] = useLocalStorage<UserRow[]>('ig-reviewer-data', defaultUsers);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('ig-reviewer-theme', 'dark');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unfollowQueue, setUnfollowQueue] = useState<string[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [hasAttemptedInitialSync, setHasAttemptedInitialSync] = useState(false);

  const [batchSize, setBatchSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const botManagedUsernames = useMemo(() => {
    return new Set(defaultUsers.map((user) => normalizeUsername(user.username)));
  }, []);

  const isBotDatasetCompatible = useMemo(() => {
    return users.every((user) => botManagedUsernames.has(normalizeUsername(user.username)));
  }, [users, botManagedUsernames]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) {
        return false;
      }

      if (search && !user.username.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [users, search, statusFilter]);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * batchSize;
    return filteredUsers.slice(start, start + batchSize);
  }, [filteredUsers, currentPage, batchSize]);

  const stats = useMemo(() => {
    const total = users.length;
    const pending = users.filter((user) => user.status === 'pending').length;
    const processed = total - pending;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
    return { total, pending, processed, percentage };
  }, [users]);

  const applySyncedUsers = (updatedUsers: UserRow[], removedCount: number) => {
    setUsers(updatedUsers);

    if (activeId && !updatedUsers.some((user) => user.id === activeId)) {
      setActiveId(updatedUsers[0]?.id ?? null);
    }

    const nextTotalPages = Math.max(1, Math.ceil(updatedUsers.length / batchSize));
    setCurrentPage((page) => Math.min(page, nextTotalPages));

    if (removedCount > 0) {
      setSyncMessage(`Synced ${removedCount} completed accounts from the bot.`);
    }
  };

  const syncWithBot = async (silent = false) => {
    if (users.length === 0) {
      return;
    }

    if (!isBotDatasetCompatible) {
      if (!silent) {
        alert('The current list does not match the bot dataset, so sync was skipped.');
      }
      return;
    }

    setIsSyncing(true);

    try {
      const response = await fetch(`${BOT_API_BASE_URL}/api/sync-state`);
      if (!response.ok) {
        throw new Error(`Sync request failed with status ${response.status}`);
      }

      const data = (await response.json()) as SyncStateResponse;
      if (!data.success || !Array.isArray(data.remainingUsers)) {
        throw new Error(data.error ?? 'Bot returned an invalid sync payload.');
      }

      const updatedUsers = reconcileUsersWithRemaining(users, data.remainingUsers);
      const removedCount = users.length - updatedUsers.length;
      applySyncedUsers(updatedUsers, removedCount);

      if (removedCount === 0 && !silent) {
        setSyncMessage('Already synced with the bot.');
      }
    } catch (error) {
      console.error('Sync with bot failed', error);

      if (!silent) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`Sync failed:\n${errorMessage}`);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (users.length === 0) {
      setHasAttemptedInitialSync(false);
      return;
    }

    if (hasAttemptedInitialSync || !isBotDatasetCompatible) {
      return;
    }

    setHasAttemptedInitialSync(true);
    void syncWithBot(true);
  }, [users.length, hasAttemptedInitialSync, isBotDatasetCompatible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
        return;
      }

      if (!activeId) {
        return;
      }

      const currentIndex = paginatedUsers.findIndex((user) => user.id === activeId);
      const activeUser = paginatedUsers[currentIndex];
      if (!activeUser) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'o':
          window.open(`https://www.instagram.com/${activeUser.username}/`, '_blank');
          break;
        case 'u':
          updateStatus(activeId, 'unfollowed manually');
          break;
        case 'k':
          updateStatus(activeId, 'kept');
          break;
        case 's':
          updateStatus(activeId, 'skipped');
          break;
        case 'n':
          if (currentIndex < paginatedUsers.length - 1) {
            setActiveId(paginatedUsers[currentIndex + 1].id);
          }
          break;
        case 'p':
          if (currentIndex > 0) {
            setActiveId(paginatedUsers[currentIndex - 1].id);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeId, paginatedUsers, users]);

  useEffect(() => {
    const processQueue = async () => {
      if (unfollowQueue.length === 0 || isProcessingQueue) {
        return;
      }

      setIsProcessingQueue(true);
      const id = unfollowQueue[0];
      const user = users.find((currentUser) => currentUser.id === id);

      if (user) {
        try {
          const response = await fetch(`${BOT_API_BASE_URL}/api/unfollow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username }),
          });
          const data = await response.json();

          if (!data.success) {
            alert(`API Failed for ${user.username}:\n${data.error}`);
          } else {
            setUsers((currentUsers) => currentUsers.filter((currentUser) => currentUser.id !== id));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          alert(`Network Error for ${user.username}:\n${errorMessage}`);
        }
      }

      setUnfollowQueue((currentQueue) => currentQueue.slice(1));
      setIsProcessingQueue(false);
    };

    void processQueue();
  }, [unfollowQueue, isProcessingQueue, users, setUsers]);

  const updateStatus = (id: string, status: Status) => {
    const currentIndex = paginatedUsers.findIndex((user) => user.id === id);
    if (currentIndex !== -1 && currentIndex < paginatedUsers.length - 1) {
      setActiveId(paginatedUsers[currentIndex + 1].id);
    }

    if (status === 'unfollowed manually') {
      if (!unfollowQueue.includes(id)) {
        setUnfollowQueue((currentQueue) => [...currentQueue, id]);
      }
      return;
    }

    setUsers((currentUsers) => currentUsers.map((user) => (
      user.id === id ? { ...user, status } : user
    )));
  };

  const autoQueueAll = () => {
    const confirmation = window.confirm(
      `Queue all ${users.length} users for unfollowing? This can trigger Instagram limits if you run too much at once.`,
    );

    if (confirmation) {
      const allPendingIds = users
        .filter((user) => !unfollowQueue.includes(user.id))
        .map((user) => user.id);
      setUnfollowQueue((currentQueue) => [...currentQueue, ...allPendingIds]);
    }
  };

  const bulkOpenNext = (count: number) => {
    const nextPending = filteredUsers.filter((user) => user.status === 'pending').slice(0, count);
    nextPending.forEach((user) => {
      window.open(`https://www.instagram.com/${user.username}/`, '_blank');
    });
  };

  const handleClearSession = () => {
    if (window.confirm('Are you sure? This will delete all imported data and progress.')) {
      setUsers([]);
      setActiveId(null);
      setSyncMessage(null);
      setHasAttemptedInitialSync(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1>Instagram Reviewer</h1>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle Theme">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {users.length > 0 && (
              <>
                <button
                  className="action-button outline"
                  onClick={() => void syncWithBot()}
                  disabled={isSyncing || !isBotDatasetCompatible}
                  title={isBotDatasetCompatible ? 'Sync with the local bot state' : 'Sync works only with the bot-managed dataset'}
                >
                  <RefreshCw size={16} /> {isSyncing ? 'Syncing...' : 'Sync Bot'}
                </button>
                <button className="action-button default" onClick={() => exportToCSV(users)}>
                  <Download size={16} /> Export
                </button>
                <button className="action-button danger" onClick={handleClearSession}>
                  <Trash2 size={16} /> Clear Session
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {users.length === 0 ? (
        <main className="app-main center-content">
          <CSVImporter
            onImport={(data) => {
              setUsers(data);
              setCurrentPage(1);
              setSyncMessage(null);
              setHasAttemptedInitialSync(false);
            }}
          />
        </main>
      ) : (
        <main className="app-main dashboard">
          <div className="stats-bar">
            <div className="stat-card">
              <span className="stat-value">{stats.processed} / {stats.total}</span>
              <span className="stat-label">Processed ({stats.percentage}%)</span>
            </div>
            <div className="stat-card">
              <span className="stat-value text-warning">{stats.pending}</span>
              <span className="stat-label">Pending</span>
            </div>
            {syncMessage && (
              <div className="stat-card">
                <span className="stat-value">{stats.total}</span>
                <span className="stat-label">{syncMessage}</span>
              </div>
            )}

            <div className="table-actions" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button className="primary-button" onClick={() => bulkOpenNext(batchSize)} disabled={paginatedUsers.length === 0}>
                <Layers size={16} /> Open Next {batchSize}
              </button>
              <button
                className="big-x-button"
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center' }}
                onClick={autoQueueAll}
                disabled={users.length === 0 || unfollowQueue.length === users.length}
              >
                Auto-Queue All
              </button>
            </div>
          </div>

          <div className="filters-bar">
            <input
              type="text"
              placeholder="Search username..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Status | 'all')} className="filter-select">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="kept">Kept</option>
              <option value="unfollowed manually">Unfollowed Manually</option>
              <option value="skipped">Skipped</option>
            </select>
            <select
              value={batchSize}
              onChange={(event) => {
                setBatchSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="filter-select"
            >
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>

          <DataTable
            users={paginatedUsers.map((user) => (unfollowQueue.includes(user.id) ? { ...user, status: 'unfollowing...' as Status } : user))}
            activeId={activeId}
            onSetActive={setActiveId}
            onUpdateStatus={updateStatus}
            onUpdateNote={(id, notes) => setUsers((currentUsers) => currentUsers.map((user) => (user.id === id ? { ...user, notes } : user)))}
            onUpdateCategory={(id, category) => setUsers((currentUsers) => currentUsers.map((user) => (user.id === id ? { ...user, category } : user)))}
          />

          <div className="pagination">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="action-button outline"
            >
              Previous Page
            </button>
            <span>Page {currentPage} of {Math.max(1, Math.ceil(filteredUsers.length / batchSize))}</span>
            <button
              disabled={currentPage >= Math.ceil(filteredUsers.length / batchSize)}
              onClick={() => setCurrentPage((page) => page + 1)}
              className="action-button outline"
            >
              Next Page
            </button>
          </div>

          <div className="keyboard-shortcuts-hint">
            <strong>Keyboard Shortcuts (on active row):</strong> <kbd>O</kbd> = Open Profile, <kbd>U</kbd> = Unfollow, <kbd>K</kbd> = Keep, <kbd>S</kbd> = Skip, <kbd>N</kbd> = Next Row, <kbd>P</kbd> = Prev Row
          </div>
        </main>
      )}
    </div>
  );
}
