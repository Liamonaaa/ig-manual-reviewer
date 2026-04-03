import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  Layers,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Sun,
  Trash2,
  Upload,
  UserRoundPlus,
  Workflow,
} from 'lucide-react';
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
  isProcessing?: boolean;
  stopRequested?: boolean;
  currentUsername?: string | null;
  lastProcessedUsername?: string | null;
  lastError?: string | null;
  processedCount?: number;
  totalLoadedCount?: number;
};

type AuthState = {
  authenticated: boolean;
  instagramUsername: string | null;
  serverReachable: boolean;
  error: string | null;
};

type QueueState = {
  isProcessing: boolean;
  stopRequested: boolean;
  currentUsername: string | null;
  lastProcessedUsername: string | null;
  lastError: string | null;
  remainingUsers: string[];
  pendingCount: number;
  processedCount: number;
  totalLoadedCount: number;
};

type NoticeState = {
  tone: 'info' | 'success' | 'danger';
  text: string;
} | null;

const emptyAuthState: AuthState = {
  authenticated: false,
  instagramUsername: null,
  serverReachable: false,
  error: null,
};

const emptyQueueState: QueueState = {
  isProcessing: false,
  stopRequested: false,
  currentUsername: null,
  lastProcessedUsername: null,
  lastError: null,
  remainingUsers: [],
  pendingCount: 0,
  processedCount: 0,
  totalLoadedCount: 0,
};

function createClientSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  return (trimmed || DEFAULT_BOT_API_BASE_URL).replace(/\/+$/, '');
}

function renderSummary(summary: ImportSummary | null): string | null {
  if (!summary) {
    return null;
  }

  return summary.details ? `${summary.label} | ${summary.details}` : summary.label;
}

function buildPendingRows(usernames: string[]): UserRow[] {
  return usernames.map((username, index) => ({
    id: createRowId(),
    username,
    status: 'pending' as Status,
    notes: '',
    category: '',
    originalIndex: index,
  }));
}

function reconcileUsersWithRemaining(currentUsers: UserRow[], remainingUsers: string[]): UserRow[] {
  const remainingUsernameSet = new Set(remainingUsers.map(normalizeUsername));
  return currentUsers.filter((user) => user.status !== 'pending' || remainingUsernameSet.has(normalizeUsername(user.username)));
}

function extractQueueState(data: BotUsersResponse): QueueState {
  return {
    isProcessing: Boolean(data.isProcessing),
    stopRequested: Boolean(data.stopRequested),
    currentUsername: data.currentUsername ?? null,
    lastProcessedUsername: data.lastProcessedUsername ?? null,
    lastError: data.lastError ?? null,
    remainingUsers: Array.isArray(data.remainingUsers) ? data.remainingUsers : [],
    pendingCount: data.remainingCount ?? data.pendingCount ?? 0,
    processedCount: data.processedCount ?? 0,
    totalLoadedCount: data.totalLoadedCount ?? 0,
  };
}

function shouldReconcileWithBot(data: BotUsersResponse): boolean {
  return Boolean((data.totalLoadedCount ?? 0) > 0 || (data.remainingUsers?.length ?? 0) > 0 || data.lastProcessedUsername);
}

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
  const [authState, setAuthState] = useState<AuthState>(emptyAuthState);
  const [queueState, setQueueState] = useState<QueueState>(emptyQueueState);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isQueueBusy, setIsQueueBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [batchSize, setBatchSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);

  const normalizedBotBaseUrl = useMemo(() => normalizeBaseUrl(botBaseUrl), [botBaseUrl]);
  const deferredSearch = useDeferredValue(search);
  const importSummaryText = renderSummary(importSummary);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    setBotBaseUrlInput(botBaseUrl);
  }, [botBaseUrl]);

  const filteredUsers = useMemo(() => users.filter((user) => {
    if (statusFilter !== 'all' && user.status !== statusFilter) {
      return false;
    }

    if (deferredSearch && !user.username.toLowerCase().includes(deferredSearch.toLowerCase())) {
      return false;
    }

    return true;
  }), [users, deferredSearch, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / batchSize));
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * batchSize;
    return filteredUsers.slice(start, start + batchSize);
  }, [filteredUsers, currentPage, batchSize]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const stats = useMemo(() => {
    const pending = users.filter((user) => user.status === 'pending').length;
    const kept = users.filter((user) => user.status === 'kept').length;
    const skipped = users.filter((user) => user.status === 'skipped').length;

    return {
      pending,
      kept,
      skipped,
      reviewed: kept + skipped,
      totalVisible: users.length,
    };
  }, [users]);

  const queueProgressBase = queueState.totalLoadedCount || stats.pending + queueState.processedCount;
  const queueProgressPercent = queueProgressBase > 0 ? Math.round((queueState.processedCount / queueProgressBase) * 100) : 0;
  const importSourceLabel = importSource === 'instagram-export' ? 'Instagram ZIP import' : importSource === 'csv' ? 'CSV import' : null;

  const buildApiUrl = (path: string, baseUrl = normalizedBotBaseUrl) => `${baseUrl}${path}`;

  const resetSessionData = (nextClientSessionId: string) => {
    setClientSessionId(nextClientSessionId);
    setUsers([]);
    setImportSummary(null);
    setImportSource('none');
    setActiveId(null);
    setAuthState(emptyAuthState);
    setQueueState(emptyQueueState);
    setLoginUsername('');
    setLoginPassword('');
    setSearch('');
    setStatusFilter('all');
    setCurrentPage(1);
    setShowImportPanel(false);
    setNotice(null);
  };

  const applyRemainingUsersFromBot = (remainingUsers: string[], silent = true) => {
    let removedPending = 0;
    let nextActiveId: string | null | undefined;
    let nextTotalPages = 1;

    setUsers((currentUsers) => {
      const currentPendingCount = currentUsers.filter((user) => user.status === 'pending').length;
      const updatedUsers = reconcileUsersWithRemaining(currentUsers, remainingUsers);
      const updatedPendingCount = updatedUsers.filter((user) => user.status === 'pending').length;

      removedPending = currentPendingCount - updatedPendingCount;
      nextTotalPages = Math.max(1, Math.ceil(updatedUsers.length / batchSize));

      if (updatedUsers.length === currentUsers.length) {
        return currentUsers;
      }

      if (activeId && !updatedUsers.some((user) => user.id === activeId)) {
        nextActiveId = updatedUsers[0]?.id ?? null;
      }

      return updatedUsers;
    });

    if (nextActiveId !== undefined) {
      setActiveId(nextActiveId);
    }

    setCurrentPage((page) => Math.min(page, nextTotalPages));

    if (removedPending > 0) {
      setNotice({ tone: 'success', text: `Bot finished ${removedPending} more account${removedPending === 1 ? '' : 's'}.` });
    } else if (!silent) {
      setNotice({ tone: 'info', text: 'Already synced with the bot.' });
    }
  };

  const applyBotState = (
    data: BotUsersResponse,
    options?: { reconcile?: boolean; silent?: boolean; allowRestore?: boolean },
  ) => {
    const queueSnapshot = extractQueueState(data);
    const shouldReconcile = options?.reconcile ?? false;
    const silent = options?.silent ?? true;
    const allowRestore = options?.allowRestore ?? true;

    setAuthState({
      authenticated: Boolean(data.authenticated),
      instagramUsername: data.authenticated ? data.instagramUsername ?? null : null,
      serverReachable: true,
      error: null,
    });
    setQueueState(queueSnapshot);

    if (!Array.isArray(data.remainingUsers)) {
      return;
    }

    if (allowRestore && users.length === 0 && queueSnapshot.remainingUsers.length > 0 && queueSnapshot.totalLoadedCount > 0) {
      const restoredUsers = buildPendingRows(queueSnapshot.remainingUsers);
      startTransition(() => {
        setUsers(restoredUsers);
        setActiveId(restoredUsers[0]?.id ?? null);
        if (importSource === 'none') {
          setImportSource('csv');
        }
        if (!importSummary) {
          setImportSummary({
            label: `Restored ${restoredUsers.length} queued accounts`,
            details: 'Recovered from your bot session.',
          });
        }
      });

      if (!silent) {
        setNotice({ tone: 'info', text: 'Restored your pending queue from the bot session.' });
      }

      return;
    }

    if (shouldReconcile && shouldReconcileWithBot(data)) {
      applyRemainingUsersFromBot(queueSnapshot.remainingUsers, silent);
    }
  };

  const fetchBotState = async (silent = true, reconcile = false, baseUrl = normalizedBotBaseUrl) => {
    if (!silent) {
      setIsSyncing(true);
    }

    try {
      const response = await fetch(`${buildApiUrl('/api/queue/status', baseUrl)}?clientSessionId=${encodeURIComponent(clientSessionId)}`);
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Bot status request failed with status ${response.status}`);
      }

      applyBotState(data, { reconcile, silent, allowRestore: true });

      if (!silent && data.lastError) {
        setNotice({ tone: 'danger', text: data.lastError });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState((currentState) => ({
        ...currentState,
        serverReachable: false,
        error: errorMessage,
      }));

      if (!silent) {
        setNotice({ tone: 'danger', text: `Failed to reach the bot: ${errorMessage}` });
      }
    } finally {
      if (!silent) {
        setIsSyncing(false);
      }
    }
  };

  const syncPendingUsersToBot = async (nextUsers: UserRow[], successText?: string) => {
    const response = await fetch(buildApiUrl('/api/replace-users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientSessionId,
        usernames: nextUsers.filter((user) => user.status === 'pending').map((user) => user.username),
      }),
    });
    const data = (await response.json()) as BotUsersResponse;

    if (!response.ok || !data.success) {
      throw new Error(data.error ?? `Bot list update failed with status ${response.status}`);
    }

    applyBotState(data, { reconcile: false, silent: true, allowRestore: false });

    if (successText) {
      setNotice({ tone: 'success', text: successText });
    }

    return data;
  };

  const handleApplyBotBaseUrl = () => {
    const normalized = normalizeBaseUrl(botBaseUrlInput);
    setBotBaseUrl(normalized);
    setNotice({ tone: 'info', text: `Bot URL set to ${normalized}` });
  };

  const handleLogin = async () => {
    if (!loginUsername.trim() || !loginPassword) {
      setNotice({ tone: 'danger', text: 'Enter your Instagram username and password first.' });
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

      applyBotState(data, { reconcile: false, silent: true, allowRestore: true });
      setLoginPassword('');

      if (users.length > 0) {
        await syncPendingUsersToBot(users);
      }

      setNotice({ tone: 'success', text: `Signed in as @${data.instagramUsername ?? loginUsername.trim()}.` });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAuthState({
        authenticated: false,
        instagramUsername: null,
        serverReachable: false,
        error: errorMessage,
      });
      setNotice({ tone: 'danger', text: `Login failed: ${errorMessage}` });
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (queueState.isProcessing) {
      setNotice({ tone: 'danger', text: 'Stop the bot queue before signing out.' });
      return;
    }

    setIsAuthBusy(true);

    try {
      const response = await fetch(buildApiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId }),
      });
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok && data.error) {
        throw new Error(data.error);
      }

      resetSessionData(createClientSessionId());
      setNotice({ tone: 'info', text: 'Signed out and started a fresh browser session.' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotice({ tone: 'danger', text: `Failed to sign out cleanly: ${errorMessage}` });
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleStartNewSession = async () => {
    if (queueState.isProcessing) {
      setNotice({ tone: 'danger', text: 'Stop the bot queue before starting a new session.' });
      return;
    }

    if (authState.authenticated) {
      await handleLogout();
      return;
    }

    resetSessionData(createClientSessionId());
    setNotice({ tone: 'info', text: 'Created a brand new browser session.' });
  };

  const handleImport = async (result: ImportResult) => {
    if (!authState.authenticated) {
      setNotice({ tone: 'danger', text: 'Sign in to Instagram first.' });
      return;
    }

    if (queueState.isProcessing) {
      setNotice({ tone: 'danger', text: 'Stop the bot queue before importing a new file.' });
      return;
    }

    setIsImporting(true);

    try {
      startTransition(() => {
        setUsers(result.users);
        setCurrentPage(1);
        setActiveId(result.users[0]?.id ?? null);
        setImportSummary(result.summary);
        setImportSource(result.source);
        setShowImportPanel(false);
      });

      await syncPendingUsersToBot(
        result.users,
        `Imported ${result.users.length} accounts and synced them to your private bot session.`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotice({ tone: 'danger', text: `Imported locally, but failed to update the bot queue: ${errorMessage}` });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSync = async () => {
    await fetchBotState(false, true);
  };

  const handleStartQueue = async () => {
    if (!authState.authenticated) {
      setNotice({ tone: 'danger', text: 'Sign in to Instagram first.' });
      return;
    }

    if (stats.pending === 0) {
      setNotice({ tone: 'info', text: 'There are no pending accounts left to process.' });
      return;
    }

    setIsQueueBusy(true);

    try {
      const response = await fetch(buildApiUrl('/api/queue/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId }),
      });
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Queue start failed with status ${response.status}`);
      }

      applyBotState(data, { reconcile: false, silent: true, allowRestore: false });
      setNotice({ tone: 'success', text: 'Bot queue started. The server is processing in the background now.' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotice({ tone: 'danger', text: `Failed to start the bot queue: ${errorMessage}` });
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleStopQueue = async () => {
    if (!queueState.isProcessing) {
      setNotice({ tone: 'info', text: 'The queue is already stopped.' });
      return;
    }

    setIsQueueBusy(true);

    try {
      const response = await fetch(buildApiUrl('/api/queue/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId }),
      });
      const data = (await response.json()) as BotUsersResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Queue stop failed with status ${response.status}`);
      }

      applyBotState(data, { reconcile: false, silent: true, allowRestore: false });
      setNotice({ tone: 'info', text: 'Stop requested. The current unfollow will finish, then the queue will stop.' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotice({ tone: 'danger', text: `Failed to stop the queue: ${errorMessage}` });
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleManualUnfollow = async (id: string) => {
    const user = users.find((currentUser) => currentUser.id === id);
    if (!user) {
      return;
    }

    if (!authState.authenticated) {
      setNotice({ tone: 'danger', text: 'Sign in to Instagram before unfollowing.' });
      return;
    }

    if (queueState.isProcessing) {
      setNotice({ tone: 'danger', text: 'Stop the background queue before running a manual unfollow.' });
      return;
    }

    setIsQueueBusy(true);

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

      let nextActiveId: string | null | undefined;
      let nextTotalPages = 1;

      setUsers((currentUsers) => {
        const updatedUsers = currentUsers.filter((currentUser) => currentUser.id !== id);
        nextTotalPages = Math.max(1, Math.ceil(updatedUsers.length / batchSize));

        if (activeId && !updatedUsers.some((currentUser) => currentUser.id === activeId)) {
          nextActiveId = updatedUsers[0]?.id ?? null;
        }

        return updatedUsers;
      });

      if (nextActiveId !== undefined) {
        setActiveId(nextActiveId);
      }

      setCurrentPage((page) => Math.min(page, nextTotalPages));
      applyBotState(data, { reconcile: false, silent: true, allowRestore: false });
      setNotice({ tone: 'success', text: `Unfollowed @${user.username}.` });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotice({ tone: 'danger', text: `Failed to unfollow @${user.username}: ${errorMessage}` });
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleStatusUpdate = (id: string, status: Status) => {
    void (async () => {
      if (status === 'unfollowed manually') {
        await handleManualUnfollow(id);
        return;
      }

      if (queueState.isProcessing) {
        setNotice({ tone: 'danger', text: 'Stop the bot queue before changing statuses.' });
        return;
      }

      let nextUsers: UserRow[] = [];
      let didChange = false;

      setUsers((currentUsers) => {
        nextUsers = currentUsers.map((user) => {
          if (user.id !== id || user.status === status) {
            return user;
          }

          didChange = true;
          return { ...user, status };
        });

        return nextUsers;
      });

      if (!didChange) {
        return;
      }

      try {
        await syncPendingUsersToBot(nextUsers);
        setNotice({
          tone: 'success',
          text: status === 'pending'
            ? 'Moved the profile back into the pending queue.'
            : status === 'kept'
              ? 'Marked as kept and removed it from the bot queue.'
              : 'Skipped this profile and removed it from the bot queue.',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setNotice({ tone: 'danger', text: `Failed to sync the updated list with the bot: ${errorMessage}` });
      }
    })();
  };

  const bulkOpenNext = (count: number) => {
    const nextPending = filteredUsers.filter((user) => user.status === 'pending').slice(0, count);
    nextPending.forEach((user) => {
      window.open(`https://www.instagram.com/${user.username}/`, '_blank');
    });
  };

  const handleClearSession = async () => {
    if (queueState.isProcessing) {
      setNotice({ tone: 'danger', text: 'Stop the bot queue before clearing the session.' });
      return;
    }

    if (!window.confirm('Clear the imported file and delete the current bot queue for this session?')) {
      return;
    }

    try {
      await syncPendingUsersToBot([]);
    } catch (error) {
      console.error('Failed to clear the bot queue', error);
    }

    startTransition(() => {
      setUsers([]);
      setImportSummary(null);
      setImportSource('none');
      setActiveId(null);
      setQueueState(emptyQueueState);
      setCurrentPage(1);
      setSearch('');
      setStatusFilter('all');
      setShowImportPanel(false);
    });

    setNotice({ tone: 'info', text: 'Cleared the imported session data from this browser.' });
  };

  useEffect(() => {
    void fetchBotState(true, false);
  }, [clientSessionId, normalizedBotBaseUrl]);

  useEffect(() => {
    if (!authState.authenticated && users.length === 0 && queueState.totalLoadedCount === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchBotState(true, queueState.isProcessing || queueState.totalLoadedCount > 0 || Boolean(queueState.lastProcessedUsername));
    }, queueState.isProcessing ? 1200 : 5000);

    return () => window.clearInterval(intervalId);
  }, [
    authState.authenticated,
    clientSessionId,
    normalizedBotBaseUrl,
    queueState.isProcessing,
    queueState.lastProcessedUsername,
    queueState.totalLoadedCount,
    users.length,
  ]);

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
          void handleManualUnfollow(activeId);
          break;
        case 'k':
          handleStatusUpdate(activeId, 'kept');
          break;
        case 's':
          handleStatusUpdate(activeId, 'skipped');
          break;
        case 'r':
          handleStatusUpdate(activeId, 'pending');
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

  const sessionChips = (
    <div className="status-strip">
      <span className={`status-pill ${authState.serverReachable ? 'status-online' : 'status-offline'}`}>
        <Bot size={14} /> {authState.serverReachable ? 'Bot reachable' : 'Bot offline'}
      </span>
      <span className={`status-pill ${authState.authenticated ? 'status-online' : 'status-idle'}`}>
        <CheckCircle2 size={14} /> {authState.authenticated ? `Signed in as @${authState.instagramUsername}` : 'Not signed in'}
      </span>
      <span className="status-pill status-idle">Session {clientSessionId.slice(0, 8)}</span>
      {importSourceLabel && <span className="status-pill status-idle">{importSourceLabel}</span>}
      {importSummaryText && <span className="status-pill status-idle">{importSummaryText}</span>}
    </div>
  );

  const connectionSettings = (
    <section className="settings-panel glass-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Connection settings</p>
          <h3>Keep every user on their own bot session</h3>
        </div>
        <button className="ghost-button" onClick={() => setShowConnectionSettings(false)}>
          Hide settings
        </button>
      </div>

      <div className="settings-grid">
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
        <div className="action-cluster">
          <button className="secondary-button" onClick={handleApplyBotBaseUrl}>
            Apply URL
          </button>
          <button className="ghost-button" onClick={() => void fetchBotState(false, false)} disabled={isSyncing}>
            <RefreshCw size={16} className={isSyncing ? 'spin' : ''} /> {isSyncing ? 'Checking...' : 'Check bot'}
          </button>
          <button className="ghost-button" onClick={() => void handleStartNewSession()} disabled={isAuthBusy}>
            <UserRoundPlus size={16} /> New session
          </button>
        </div>
      </div>

      <div className="settings-footnote">
        127.0.0.1 always means the current user's machine. Friends can use the same public site with their own bot URL and Instagram login.
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <div className="background-orb orb-a" />
      <div className="background-orb orb-b" />
      <div className="background-orb orb-c" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">IG</div>
          <div>
            <p className="eyebrow">Instagram Unfollow Control</p>
            <h1>Cleaner queue, faster bot, separate sessions</h1>
          </div>
        </div>

        <div className="topbar-actions">
          {authState.authenticated && (
            <>
              <button className="ghost-button" onClick={() => setShowConnectionSettings((current) => !current)}>
                <Settings2 size={16} /> Settings
              </button>
              <button className="ghost-button" onClick={() => void handleSync()} disabled={isSyncing}>
                <RefreshCw size={16} className={isSyncing ? 'spin' : ''} /> {isSyncing ? 'Syncing...' : 'Sync'}
              </button>
              <button className="ghost-button danger-text" onClick={() => void handleLogout()} disabled={isAuthBusy}>
                <LogOut size={16} /> Sign out
              </button>
            </>
          )}
          <button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {notice && <div className={`notice-banner notice-${notice.tone}`}>{notice.text}</div>}

      {!authState.authenticated ? (
        <main className="setup-layout">
          <section className="hero-panel glass-panel">
            <span className="eyebrow">Login-first onboarding</span>
            <h2>Connect your bot, sign into Instagram, then import the file.</h2>
            <p className="hero-copy">
              The site now starts with a proper onboarding flow. First connect to your own bot session,
              sign in to Instagram, and only then upload the Instagram export or CSV you want to work on.
            </p>

            <div className="feature-grid">
              <article className="feature-card">
                <Bot size={18} />
                <div>
                  <strong>Private bot session</strong>
                  <p>Each browser session keeps its own queue and its own Instagram login.</p>
                </div>
              </article>
              <article className="feature-card">
                <Workflow size={18} />
                <div>
                  <strong>Server-side queue worker</strong>
                  <p>The bot runs the queue in the background instead of waiting for the browser each time.</p>
                </div>
              </article>
              <article className="feature-card">
                <Clock3 size={18} />
                <div>
                  <strong>Resume-friendly flow</strong>
                  <p>Your browser session and bot queue stay in sync when you come back later.</p>
                </div>
              </article>
            </div>

            <div className="stepper">
              <span className="step-pill active">1 Connect</span>
              <span className="step-pill">2 Import</span>
              <span className="step-pill">3 Run</span>
            </div>
          </section>

          <section className="auth-panel glass-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Step 1</p>
                <h3>Sign in to your Instagram account</h3>
              </div>
              <span className={`tiny-badge ${authState.serverReachable ? 'tiny-badge-success' : 'tiny-badge-idle'}`}>
                {authState.serverReachable ? 'Bot online' : 'Bot not checked yet'}
              </span>
            </div>

            <div className="stack-form">
              <label className="field-group">
                <span>Instagram username</span>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  placeholder="your_instagram_username"
                  className="search-input"
                />
              </label>

              <label className="field-group">
                <span>Instagram password</span>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="Enter your Instagram password"
                  className="search-input"
                />
              </label>

              <button className="primary-button jumbo-button" onClick={() => void handleLogin()} disabled={isAuthBusy}>
                {isAuthBusy ? <LoaderCircle size={18} className="spin" /> : <LogIn size={18} />}
                {isAuthBusy ? 'Signing in...' : 'Connect Instagram'}
              </button>
            </div>

            <div className="inline-note">
              Need a different bot server or a fresh private session first?
            </div>

            <button className="ghost-button" onClick={() => setShowConnectionSettings((current) => !current)}>
              <Settings2 size={16} /> {showConnectionSettings ? 'Hide connection settings' : 'Open connection settings'}
            </button>

            {showConnectionSettings && connectionSettings}
            {sessionChips}
          </section>
        </main>
      ) : users.length === 0 ? (
        <main className="import-layout">
          <section className="import-hero glass-panel">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>Bring your Instagram export into the session</h2>
              <p className="hero-copy">
                You are already signed in as @{authState.instagramUsername}. Import your ZIP or CSV and the app will sync only pending accounts to your personal bot queue.
              </p>
            </div>
            <div className="hero-side-actions">
              <button className="ghost-button" onClick={() => setShowConnectionSettings((current) => !current)}>
                <Settings2 size={16} /> Settings
              </button>
              <button className="ghost-button" onClick={() => void handleStartNewSession()}>
                <UserRoundPlus size={16} /> New session
              </button>
            </div>
            {sessionChips}
          </section>

          {showConnectionSettings && connectionSettings}

          <section className="import-grid">
            <div className="glass-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Import</p>
                  <h3>Drop the official Instagram ZIP or a CSV</h3>
                </div>
                <span className="tiny-badge tiny-badge-success">Ready</span>
              </div>
              <CSVImporter onImport={handleImport} disabled={isImporting || queueState.isProcessing} />
            </div>

            <aside className="glass-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">What happens next</p>
                  <h3>Cleaner flow for real users</h3>
                </div>
              </div>
              <ul className="feature-list">
                <li>The file is parsed locally in the browser.</li>
                <li>Only pending usernames are synced to your bot session.</li>
                <li>After import, the bot can process the queue in the background.</li>
                <li>You can still keep, skip, or manually unfollow row by row.</li>
              </ul>
            </aside>
          </section>
        </main>
      ) : (
        <main className="workspace-layout">
          <section className="workspace-hero glass-panel">
            <div className="workspace-copy">
              <p className="eyebrow">Step 3</p>
              <h2>Review what matters. Let the bot do the repetitive work.</h2>
              <p className="hero-copy">
                The queue now runs inside the bot session, not in your browser. That removes one network round trip per unfollow and makes the whole flow feel much faster.
              </p>
            </div>

            <div className="workspace-actions">
              <button
                className="primary-button jumbo-button"
                onClick={() => void handleStartQueue()}
                disabled={queueState.isProcessing || isQueueBusy || stats.pending === 0}
              >
                {queueState.isProcessing || isQueueBusy ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
                {queueState.isProcessing ? 'Automation running' : `Start automation (${stats.pending})`}
              </button>
              <button className="secondary-button" onClick={() => void handleStopQueue()} disabled={!queueState.isProcessing || isQueueBusy}>
                <Square size={16} /> Stop
              </button>
              <button className="ghost-button" onClick={() => exportToCSV(users)}>
                <Download size={16} /> Export CSV
              </button>
              <button className="ghost-button" onClick={() => setShowImportPanel((current) => !current)} disabled={queueState.isProcessing}>
                <Upload size={16} /> {showImportPanel ? 'Hide importer' : 'Import another file'}
              </button>
            </div>

            <div className="progress-block">
              <div className="progress-meta">
                <span>Bot progress</span>
                <strong>{queueState.processedCount} / {queueProgressBase || 0}</strong>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${queueProgressPercent}%` }} />
              </div>
              <div className="progress-footer">
                <span>{queueProgressPercent}% completed</span>
                <span>
                  {queueState.currentUsername
                    ? `Now processing @${queueState.currentUsername}`
                    : queueState.lastProcessedUsername
                      ? `Last done: @${queueState.lastProcessedUsername}`
                      : 'Waiting for the next action'}
                </span>
              </div>
            </div>

            {sessionChips}
          </section>

          <section className="stats-grid">
            <article className="metric-card">
              <span className="metric-label">Pending queue</span>
              <strong>{stats.pending}</strong>
              <p>Profiles still eligible for unfollowing.</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Reviewed</span>
              <strong>{stats.reviewed}</strong>
              <p>Profiles you already kept or skipped.</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Processed by bot</span>
              <strong>{queueState.processedCount}</strong>
              <p>Completed background unfollows in this synced queue.</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Connected user</span>
              <strong>@{authState.instagramUsername}</strong>
              <p>Active Instagram account tied to this browser session.</p>
            </article>
          </section>

          <section className="control-panel glass-panel">
            <div className="control-row">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Workspace controls</p>
                  <h3>Filter the list and steer the queue</h3>
                </div>
              </div>

              <div className="action-cluster">
                <button className="ghost-button" onClick={() => bulkOpenNext(batchSize)} disabled={paginatedUsers.length === 0}>
                  <Layers size={16} /> Open next {batchSize}
                </button>
                <button className="ghost-button" onClick={() => setShowConnectionSettings((current) => !current)}>
                  <Settings2 size={16} /> Settings
                </button>
                <button className="ghost-button danger-text" onClick={() => void handleClearSession()} disabled={queueState.isProcessing}>
                  <Trash2 size={16} /> Clear session
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
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="kept">Kept</option>
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

            {queueState.lastError && <div className="inline-error">{queueState.lastError}</div>}
          </section>

          {showConnectionSettings && connectionSettings}

          {showImportPanel && (
            <section className="glass-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Import replacement</p>
                  <h3>Swap the queue with a new Instagram export</h3>
                </div>
              </div>
              <CSVImporter onImport={handleImport} disabled={isImporting || queueState.isProcessing} />
            </section>
          )}

          <DataTable
            users={paginatedUsers}
            activeId={activeId}
            canUnfollow={authState.authenticated}
            isQueueProcessing={queueState.isProcessing}
            currentProcessingUsername={queueState.currentUsername}
            onManualUnfollow={(id) => void handleManualUnfollow(id)}
            onUpdateStatus={handleStatusUpdate}
            onUpdateNote={(id, notes) => setUsers((currentUsers) => currentUsers.map((user) => (user.id === id ? { ...user, notes } : user)))}
            onUpdateCategory={(id, category) => setUsers((currentUsers) => currentUsers.map((user) => (user.id === id ? { ...user, category } : user)))}
            onSetActive={setActiveId}
          />

          <div className="pagination">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="ghost-button">
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} className="ghost-button">
              Next
            </button>
          </div>

          <div className="keyboard-shortcuts-hint">
            <strong>Keyboard:</strong> <kbd>O</kbd> open, <kbd>U</kbd> unfollow, <kbd>K</kbd> keep, <kbd>S</kbd> skip, <kbd>R</kbd> return to pending, <kbd>N</kbd>/<kbd>P</kbd> next and previous row.
          </div>
        </main>
      )}
    </div>
  );
}
