import { useEffect, useMemo, useState } from 'react';
import { Download, Layers, LogIn, LogOut, Moon, RefreshCw, Sun, Trash2, UserRoundPlus } from 'lucide-react';
import { CSVImporter } from './components/CSVImporter';
import { DataTable } from './components/DataTable';
import { useLocalStorage } from './hooks/useLocalStorage';
import { exportToCSV } from './utils/csv';
import { ImportResult, ImportSource, ImportSummary, Status, UserRow } from './types';
import './index.css';

const DEFAULT_BOT_API_BASE_URL = 'http://127.0.0.1:5000';

type BotUsersResponse = {
  success: boolean;
  remainingCount?: number;
  remainingUsers?: string[];
  authenticated?: boolean;
  instagramUsername?: string | null;
  pendingCount?: number;
  clientSessionId?: string;
  error?: string;
};

type AuthState = {
  authenticated: boolean;
  instagramUsername: string | null;
  serverReachable: boolean;
  error: string | null;
};

function createClientSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  return (trimmed || DEFAULT_BOT_API_BASE_URL).replace(/\/+$/, '');
}

function reconcileUsersWithRemaining(currentUsers: UserRow[], remainingUsers: string[]): UserRow[] {
  const remainingUsernameSet = new Set(remainingUsers.map(normalizeUsername));
  return currentUsers.filter((user) => remainingUsernameSet.has(normalizeUsername(user.username)));
}

function renderSummary(summary: ImportSummary | null): string | null {
  if (!summary) {
    return null;
  }

  return summary.details ? `${summary.label} | ${summary.details}` : summary.label;
}

const emptyAuthState: AuthState = {
  authenticated: false,
  instagramUsername: null,
  serverReachable: false,
  error: null,
};

export default function App() {
  const [users, setUsers] = useLocalStorage<UserRow[]>('ig-reviewer-data', []);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('ig-reviewer-theme', 'dark');
  const [importSource, setImportSource] = useLocalStorage<ImportSource>('ig-reviewer-import-source', 'none');
  const [importSummary, setImportSummary] = useLocalStorage<ImportSummary | null>('ig-reviewer-import-summary', null);
  const [clientSessionId, setClientSessionId] = useLocalStorage<string>('ig-reviewer-client-session-id', createClientSessionId());
  const [botBaseUrl, setBotBaseUrl] = useLocalStorage<string>('ig-reviewer-bot-base-url', DEFAULT_BOT_API_BASE_URL);

  const [botBaseUrlInput, setBotBaseUrlInput] = useState(botBaseUrl);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unfollowQueue, setUnfollowQueue] = useState<string[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [hasAttemptedInitialSync, setHasAttemptedInitialSync] = useState(false);
  const [authState, setAuthState] = useState<AuthState>(emptyAuthState);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [batchSize, setBatchSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const normalizedBotBaseUrl = useMemo(() => normalizeBaseUrl(botBaseUrl), [botBaseUrl]);
  const importSummaryText = renderSummary(importSummary);
  const canUnfollow = authState.authenticated;
  const importSourceLabel = importSource === 'instagram-export'
    ? 'Instagram ZIP import'
    : importSource === 'csv'
      ? 'CSV import'
      : null;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    setBotBaseUrlInput(botBaseUrl);
  }, [botBaseUrl]);

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

  const buildApiUrl = (path: string) => `${normalizedBotBaseUrl}${path}`;

  const resetSessionData = (nextClientSessionId: string) => {
    setClientSessionId(nextClientSessionId);
    setUsers([]);
    setImportSummary(null);
    setImportSource('none');
    setActiveId(null);
    setUnfollowQueue([]);
    setSyncMessage(null);
    setHasAttemptedInitialSync(false);
    setCurrentPage(1);
    setSearch('');
    setStatusFilter('all');
    setLoginUsername('');
    setLoginPassword('');
    setAuthState(emptyAuthState);
  };

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

  const fetchSessionStatus = async (silent = true) => {
    setIsAuthBusy(true);

    try {
      const response = await fetch(`${buildApiUrl('/api/auth/status')}?clientSessionId=${encodeURIComponent(clientSessionId)}`);
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Status request failed with status ${response.status}`);
      }

      setAuthState({
        authenticated: Boolean(data.authenticated),
        instagramUsername: data.authenticated ? data.instagramUsername ?? null : null,
        serverReachable: true,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState({
        authenticated: false,
        instagramUsername: null,
        serverReachable: false,
        error: errorMessage,
      });

      if (!silent) {
        alert(`Failed to connect to the bot:\n${errorMessage}`);
      }
    } finally {
      setIsAuthBusy(false);
    }
  };

  const replaceBotUsers = async (importedUsers: UserRow[]) => {
    const response = await fetch(buildApiUrl('/api/replace-users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientSessionId,
        usernames: importedUsers.map((user) => user.username),
      }),
    });

    const data = (await response.json()) as BotUsersResponse;
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? `Bot list update failed with status ${response.status}`);
    }

    return data;
  };

  const syncWithBot = async (silent = false) => {
    if (users.length === 0) {
      return;
    }

    setIsSyncing(true);

    try {
      const response = await fetch(`${buildApiUrl('/api/sync-state')}?clientSessionId=${encodeURIComponent(clientSessionId)}`);
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success || !Array.isArray(data.remainingUsers)) {
        throw new Error(data.error ?? `Sync request failed with status ${response.status}`);
      }

      const updatedUsers = reconcileUsersWithRemaining(users, data.remainingUsers);
      const removedCount = users.length - updatedUsers.length;
      applySyncedUsers(updatedUsers, removedCount);

      if (removedCount === 0 && !silent) {
        setSyncMessage('Already synced with the bot.');
      }

      setAuthState((currentState) => ({
        ...currentState,
        authenticated: Boolean(data.authenticated),
        instagramUsername: data.authenticated ? data.instagramUsername ?? null : null,
        serverReachable: true,
        error: null,
      }));
    } catch (error) {
      console.error('Sync with bot failed', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState((currentState) => ({
        ...currentState,
        serverReachable: false,
        error: errorMessage,
      }));

      if (!silent) {
        alert(`Sync failed:\n${errorMessage}`);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImport = async (result: ImportResult) => {
    setUsers(result.users);
    setCurrentPage(1);
    setActiveId(result.users[0]?.id ?? null);
    setUnfollowQueue([]);
    setSyncMessage(null);
    setImportSummary(result.summary);
    setImportSource(result.source);
    setHasAttemptedInitialSync(true);

    try {
      const botState = await replaceBotUsers(result.users);
      setSyncMessage(
        `Imported ${result.users.length} accounts and synced ${botState.remainingCount ?? result.users.length} usernames to bot session ${clientSessionId.slice(0, 8)}.`,
      );
      setAuthState((currentState) => ({
        ...currentState,
        serverReachable: true,
        error: null,
      }));
    } catch (error) {
      console.error('Failed to sync imported list with the bot', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState((currentState) => ({
        ...currentState,
        serverReachable: false,
        error: errorMessage,
      }));
      setSyncMessage('Imported locally, but failed to update the bot queue.');
      alert(`Imported the file, but failed to update the bot queue:\n${errorMessage}`);
    }
  };

  const handleLogin = async () => {
    if (!loginUsername.trim() || !loginPassword) {
      alert('Enter your Instagram username and password first.');
      return;
    }

    setIsAuthBusy(true);

    try {
      const response = await fetch(buildApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSessionId,
          instagramUsername: loginUsername,
          instagramPassword: loginPassword,
        }),
      });
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Login failed with status ${response.status}`);
      }

      setAuthState({
        authenticated: true,
        instagramUsername: data.instagramUsername ?? loginUsername.trim(),
        serverReachable: true,
        error: null,
      });
      setLoginPassword('');
      setSyncMessage(`Signed in as ${data.instagramUsername ?? loginUsername.trim()}.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState({
        authenticated: false,
        instagramUsername: null,
        serverReachable: false,
        error: errorMessage,
      });
      alert(`Login failed:\n${errorMessage}`);
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setIsAuthBusy(true);

    try {
      await fetch(buildApiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId }),
      });
    } catch (error) {
      console.error('Logout request failed', error);
    } finally {
      setIsAuthBusy(false);
      resetSessionData(createClientSessionId());
    }
  };

  const handleStartNewSession = async () => {
    if (authState.authenticated) {
      await handleLogout();
      return;
    }

    resetSessionData(createClientSessionId());
  };

  const handleApplyBotBaseUrl = async () => {
    const normalized = normalizeBaseUrl(botBaseUrlInput);
    setBotBaseUrl(normalized);
    setSyncMessage(`Bot URL set to ${normalized}`);
  };

  useEffect(() => {
    void fetchSessionStatus(true);
  }, [clientSessionId, normalizedBotBaseUrl]);

  useEffect(() => {
    if (users.length === 0) {
      setHasAttemptedInitialSync(false);
      return;
    }

    if (hasAttemptedInitialSync) {
      return;
    }

    setHasAttemptedInitialSync(true);
    void syncWithBot(true);
  }, [users, clientSessionId, normalizedBotBaseUrl, hasAttemptedInitialSync]);

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
  }, [activeId, paginatedUsers]);

  useEffect(() => {
    const processQueue = async () => {
      if (unfollowQueue.length === 0 || isProcessingQueue || !canUnfollow) {
        return;
      }

      setIsProcessingQueue(true);
      const id = unfollowQueue[0];
      const user = users.find((currentUser) => currentUser.id === id);

      if (user) {
        try {
          const response = await fetch(buildApiUrl('/api/unfollow'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientSessionId,
              username: user.username,
            }),
          });
          const data = (await response.json()) as BotUsersResponse;

          if (!response.ok || !data.success) {
            throw new Error(data.error ?? `Unfollow failed with status ${response.status}`);
          }

          setUsers((currentUsers) => currentUsers.filter((currentUser) => currentUser.id !== id));
          setSyncMessage(`Unfollowed @${user.username} on ${authState.instagramUsername}.`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (errorMessage.toLowerCase().includes('sign in again')) {
            setAuthState((currentState) => ({
              ...currentState,
              authenticated: false,
              instagramUsername: null,
              serverReachable: true,
              error: errorMessage,
            }));
          }

          alert(`Unfollow failed for ${user.username}:\n${errorMessage}`);
        }
      }

      setUnfollowQueue((currentQueue) => currentQueue.slice(1));
      setIsProcessingQueue(false);
    };

    void processQueue();
  }, [unfollowQueue, isProcessingQueue, users, canUnfollow, clientSessionId, normalizedBotBaseUrl, authState.instagramUsername]);

  const updateStatus = (id: string, status: Status) => {
    const currentIndex = paginatedUsers.findIndex((user) => user.id === id);
    if (currentIndex !== -1 && currentIndex < paginatedUsers.length - 1) {
      setActiveId(paginatedUsers[currentIndex + 1].id);
    }

    if (status === 'unfollowed manually') {
      if (!canUnfollow) {
        alert('Log in to your Instagram account first.');
        return;
      }

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
    if (!canUnfollow) {
      alert('Log in to your Instagram account first.');
      return;
    }

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

  const handleClearSession = async () => {
    if (window.confirm('Are you sure? This will delete the imported data from this browser session.')) {
      try {
        await replaceBotUsers([]);
      } catch (error) {
        console.error('Failed to clear bot queue', error);
      }

      setUsers([]);
      setActiveId(null);
      setSyncMessage(null);
      setImportSummary(null);
      setImportSource('none');
      setHasAttemptedInitialSync(false);
      setUnfollowQueue([]);
    }
  };

  const connectionPanel = (
    <section className="connection-panel">
      <div className="connection-header">
        <div>
          <h2>Bot Session</h2>
          <p>Each browser session gets its own queue and Instagram login. Friends can use the same site with their own bot URL and account.</p>
        </div>
        <span className="session-chip">Session {clientSessionId.slice(0, 8)}</span>
      </div>

      <div className="connection-grid">
        <label className="field-group">
          <span>Bot URL</span>
          <input
            type="text"
            value={botBaseUrlInput}
            onChange={(event) => setBotBaseUrlInput(event.target.value)}
            placeholder="http://127.0.0.1:5000"
            className="search-input"
          />
        </label>
        <div className="connection-actions">
          <button className="action-button outline" onClick={() => void handleApplyBotBaseUrl()}>
            Apply Bot URL
          </button>
          <button className="action-button outline" onClick={() => void fetchSessionStatus(false)} disabled={isAuthBusy}>
            <RefreshCw size={16} /> {isAuthBusy ? 'Checking...' : 'Check Bot'}
          </button>
          <button className="action-button outline" onClick={() => void handleStartNewSession()}>
            <UserRoundPlus size={16} /> New Session
          </button>
        </div>
      </div>

      <div className="connection-grid">
        <label className="field-group">
          <span>Instagram Username</span>
          <input
            type="text"
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            placeholder="your_instagram_username"
            className="search-input"
          />
        </label>
        <label className="field-group">
          <span>Instagram Password</span>
          <input
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="Enter your Instagram password"
            className="search-input"
          />
        </label>
        <div className="connection-actions">
          <button className="action-button primary" onClick={() => void handleLogin()} disabled={isAuthBusy}>
            <LogIn size={16} /> {isAuthBusy ? 'Signing In...' : 'Sign In'}
          </button>
          <button className="action-button outline" onClick={() => void handleLogout()} disabled={!authState.authenticated || isAuthBusy}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>

      <div className="status-strip">
        <span className={`status-pill ${authState.serverReachable ? 'status-online' : 'status-offline'}`}>
          {authState.serverReachable ? 'Bot reachable' : 'Bot offline'}
        </span>
        <span className={`status-pill ${authState.authenticated ? 'status-online' : 'status-idle'}`}>
          {authState.authenticated ? `Logged in as ${authState.instagramUsername}` : 'Not logged in'}
        </span>
        {importSourceLabel && <span className="status-pill status-idle">{importSourceLabel}</span>}
        {importSummaryText && <span className="status-pill status-idle">{importSummaryText}</span>}
      </div>

      {(syncMessage || authState.error) && (
        <div className="keyboard-shortcuts-hint" style={{ marginTop: '1rem' }}>
          {syncMessage && <div><strong>Status:</strong> {syncMessage}</div>}
          {authState.error && <div style={{ marginTop: syncMessage ? '0.5rem' : 0 }}><strong>Bot Error:</strong> {authState.error}</div>}
        </div>
      )}
    </section>
  );

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
                <button className="action-button outline" onClick={() => void syncWithBot()} disabled={isSyncing}>
                  <RefreshCw size={16} /> {isSyncing ? 'Syncing...' : 'Sync Bot'}
                </button>
                <button className="action-button default" onClick={() => exportToCSV(users)}>
                  <Download size={16} /> Export
                </button>
                <button className="action-button danger" onClick={() => void handleClearSession()}>
                  <Trash2 size={16} /> Clear Session
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {users.length === 0 ? (
        <main className="app-main center-content">
          <div className="import-flow">
            {connectionPanel}
            <CSVImporter onImport={(result: ImportResult) => void handleImport(result)} />
          </div>
        </main>
      ) : (
        <main className="app-main dashboard">
          {connectionPanel}

          <div className="stats-bar">
            <div className="stat-card">
              <span className="stat-value">{stats.processed} / {stats.total}</span>
              <span className="stat-label">Processed ({stats.percentage}%)</span>
            </div>
            <div className="stat-card">
              <span className="stat-value text-warning">{stats.pending}</span>
              <span className="stat-label">Pending</span>
            </div>

            <div className="table-actions" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button className="primary-button" onClick={() => bulkOpenNext(batchSize)} disabled={paginatedUsers.length === 0}>
                <Layers size={16} /> Open Next {batchSize}
              </button>
              <button
                className="big-x-button"
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center' }}
                onClick={autoQueueAll}
                disabled={!canUnfollow || users.length === 0 || unfollowQueue.length === users.length}
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
            canUnfollow={canUnfollow}
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
