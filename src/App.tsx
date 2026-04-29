import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
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
} from 'lucide-react';
import { CSVImporter } from './components/CSVImporter';
import { DataTable } from './components/DataTable';
import { useLocalStorage } from './hooks/useLocalStorage';
import { exportToCSV } from './utils/csv';
import { ImportResult, ImportSource, ImportSummary, UserRow } from './types';
import './index.css';

const DEFAULT_BOT_API_BASE_URL = 'http://127.0.0.1:5000';
const ACTIVE_QUEUE_POLL_INTERVAL_MS = 550;
const IDLE_QUEUE_POLL_INTERVAL_MS = 2500;
const AUTO_RECOVERY_RESTART_DELAY_MS = 300;

type BotUsersResponse = {
  success: boolean;
  remainingCount?: number;
  remainingUsers?: string[];
  authenticated?: boolean;
  instagramUsername?: string | null;
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

type NoticeState = { tone: 'info' | 'success' | 'danger'; text: string } | null;

type WorkspaceSnapshot = {
  users: UserRow[];
  importSource: ImportSource;
  importSummary: ImportSummary | null;
  savedAt: string;
};

const emptyAuthState: AuthState = { authenticated: false, instagramUsername: null, serverReachable: false, error: null };
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

const createClientSessionId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createRowId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeUsername = (username: string) => username.trim().replace(/^@+/, '').toLowerCase();
const normalizeBaseUrl = (url: string) => (url.trim() || DEFAULT_BOT_API_BASE_URL).replace(/\/+$/, '');
const renderSummary = (summary: ImportSummary | null) => (summary ? (summary.details ? `${summary.label} | ${summary.details}` : summary.label) : null);
const getActiveId = (rows: UserRow[]) => rows.find((user) => user.status === 'pending')?.id ?? rows[0]?.id ?? null;
const normalizeUsers = (rows: UserRow[]): UserRow[] =>
  rows.map((user, index): UserRow => ({
    id: user.id || createRowId(),
    username: normalizeUsername(user.username),
    status: user.status === 'failed' ? 'failed' : 'pending',
    notes: user.notes || '',
    category: user.category || '',
    originalIndex: typeof user.originalIndex === 'number' ? user.originalIndex : index,
    failureReason: user.failureReason || (user.status === 'failed' ? user.notes || 'המשתמש עדיין לא סומן כהוסר.' : ''),
    lastAttemptAt: user.lastAttemptAt || '',
  }));
const buildPendingRows = (usernames: string[]) =>
  usernames.map((username, index) => ({
    id: createRowId(),
    username: normalizeUsername(username),
    status: 'pending' as const,
    notes: '',
    category: '',
    originalIndex: index,
    failureReason: '',
    lastAttemptAt: '',
  }));
const reconcileUsersWithRemaining = (currentUsers: UserRow[], remainingUsers: string[], retainedPendingUsernames: string[] = []) => {
  const remaining = new Set([...remainingUsers.map(normalizeUsername), ...retainedPendingUsernames.map(normalizeUsername)]);
  return currentUsers.filter((user) => user.status !== 'pending' || remaining.has(normalizeUsername(user.username)));
};
const extractQueueState = (data: BotUsersResponse): QueueState => ({
  isProcessing: Boolean(data.isProcessing),
  stopRequested: Boolean(data.stopRequested),
  currentUsername: data.currentUsername ?? null,
  lastProcessedUsername: data.lastProcessedUsername ?? null,
  lastError: data.lastError ?? null,
  remainingUsers: Array.isArray(data.remainingUsers) ? data.remainingUsers.map(normalizeUsername) : [],
  pendingCount: data.remainingCount ?? 0,
  processedCount: data.processedCount ?? 0,
  totalLoadedCount: data.totalLoadedCount ?? 0,
});
const formatSavedAt = (value?: string) => {
  if (!value) return 'אין שמירה קודמת';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export default function App() {
  const [users, setUsers] = useLocalStorage<UserRow[]>('ig-reviewer-data', []);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('ig-reviewer-theme', 'dark');
  const [importSource, setImportSource] = useLocalStorage<ImportSource>('ig-reviewer-import-source', 'none');
  const [importSummary, setImportSummary] = useLocalStorage<ImportSummary | null>('ig-reviewer-import-summary', null);
  const [clientSessionId, setClientSessionId] = useLocalStorage('ig-reviewer-client-session-id', createClientSessionId());
  const [botBaseUrl, setBotBaseUrl] = useLocalStorage('ig-reviewer-bot-base-url', DEFAULT_BOT_API_BASE_URL);
  const [savedWorkspaces, setSavedWorkspaces] = useLocalStorage<Record<string, WorkspaceSnapshot>>('ig-reviewer-user-workspaces', {});
  const [botBaseUrlInput, setBotBaseUrlInput] = useState(botBaseUrl);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>(emptyAuthState);
  const [queueState, setQueueState] = useState<QueueState>(emptyQueueState);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isQueueBusy, setIsQueueBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [manualActionUserId, setManualActionUserId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [queueAutoRun, setQueueAutoRun] = useState(false);
  const [isQueueRecovering, setIsQueueRecovering] = useState(false);

  const normalizedBotBaseUrl = useMemo(() => normalizeBaseUrl(botBaseUrl), [botBaseUrl]);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const pendingUsers = useMemo(() => users.filter((user) => user.status === 'pending'), [users]);
  const failedUsers = useMemo(() => users.filter((user) => user.status === 'failed'), [users]);
  const filteredPendingUsers = useMemo(
    () => pendingUsers.filter((user) => `${user.username} ${user.failureReason || ''}`.toLowerCase().includes(deferredSearch)),
    [pendingUsers, deferredSearch],
  );
  const filteredFailedUsers = useMemo(
    () => failedUsers.filter((user) => `${user.username} ${user.failureReason || ''}`.toLowerCase().includes(deferredSearch)),
    [failedUsers, deferredSearch],
  );
  const totalPages = Math.max(1, Math.ceil(filteredPendingUsers.length / batchSize));
  const paginatedPendingUsers = useMemo(
    () => filteredPendingUsers.slice((currentPage - 1) * batchSize, currentPage * batchSize),
    [filteredPendingUsers, currentPage, batchSize],
  );
  const keyboardUsers = useMemo(() => [...paginatedPendingUsers, ...filteredFailedUsers], [paginatedPendingUsers, filteredFailedUsers]);
  const queueProgressBase = queueState.totalLoadedCount || queueState.processedCount + pendingUsers.length;
  const queueProgressPercent = queueProgressBase > 0 ? Math.round((queueState.processedCount / queueProgressBase) * 100) : 0;
  const importSummaryText = renderSummary(importSummary);
  const currentWorkspaceKey = authState.instagramUsername ? normalizeUsername(authState.instagramUsername) : '';
  const loginWorkspaceHint = loginUsername ? savedWorkspaces[normalizeUsername(loginUsername)] ?? null : null;
  const hasWorkspaceData = users.length > 0 || importSource !== 'none' || Boolean(importSummary);
  const isBotConnected = authState.authenticated && authState.serverReachable;
  const usersRef = useRef(users);
  const activeIdRef = useRef(activeId);
  const workspaceKeyRef = useRef(currentWorkspaceKey);
  const queueAutoRunRef = useRef(queueAutoRun);
  const autoRecoveryLockRef = useRef(false);
  const lastQueueUsernameRef = useRef<string | null>(null);
  const lastRecoveredFailureKeyRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('lang', 'he');
    document.documentElement.setAttribute('dir', 'rtl');
  }, [theme]);

  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { workspaceKeyRef.current = currentWorkspaceKey; }, [currentWorkspaceKey]);
  useEffect(() => { queueAutoRunRef.current = queueAutoRun; }, [queueAutoRun]);
  useEffect(() => setBotBaseUrlInput(botBaseUrl), [botBaseUrl]);
  useEffect(() => setCurrentPage((page) => Math.min(page, totalPages)), [totalPages]);
  useEffect(() => {
    if (!keyboardUsers.some((user) => user.id === activeId)) setActiveId(getActiveId(keyboardUsers));
  }, [keyboardUsers, activeId]);
  useEffect(() => {
    if (queueState.isProcessing && queueState.currentUsername) {
      lastQueueUsernameRef.current = normalizeUsername(queueState.currentUsername);
    }
  }, [queueState.isProcessing, queueState.currentUsername]);

  const buildApiUrl = (path: string, baseUrl = normalizedBotBaseUrl) => `${baseUrl}${path}`;

  const saveWorkspaceSnapshot = (instagramUsername: string, nextUsers: UserRow[], nextSource = importSource, nextSummary = importSummary) =>
    setSavedWorkspaces((current) => {
      const next = { ...current };
      const key = normalizeUsername(instagramUsername);
      const normalizedUsers = normalizeUsers(nextUsers);

      if (normalizedUsers.length === 0 && nextSource === 'none' && !nextSummary) {
        delete next[key];
      } else {
        next[key] = {
          users: normalizedUsers.map((user) => ({ ...user })),
          importSource: nextSource,
          importSummary: nextSummary,
          savedAt: new Date().toISOString(),
        };
      }

      return next;
    });

  const clearVisibleWorkspace = () => {
    startTransition(() => {
      setUsers([]);
      setImportSource('none');
      setImportSummary(null);
      setSearch('');
      setCurrentPage(1);
      setShowImportPanel(false);
      setActiveId(null);
    });
    usersRef.current = [];
    activeIdRef.current = null;
    setManualActionUserId(null);
    setQueueAutoRun(false);
    setIsQueueRecovering(false);
    queueAutoRunRef.current = false;
    autoRecoveryLockRef.current = false;
    lastQueueUsernameRef.current = null;
    lastRecoveredFailureKeyRef.current = null;
  };

  const persistUsersSnapshot = (nextUsers: UserRow[]) => {
    usersRef.current = nextUsers;

    startTransition(() => {
      setUsers(nextUsers);
      const nextActiveId =
        activeIdRef.current && nextUsers.some((user) => user.id === activeIdRef.current)
          ? activeIdRef.current
          : getActiveId(nextUsers);
      setActiveId(nextActiveId);
    });

    if (workspaceKeyRef.current) {
      saveWorkspaceSnapshot(workspaceKeyRef.current, nextUsers);
    }

    return nextUsers;
  };

  const movePendingUserToFailed = (username: string, reason: string) => {
    const normalizedUsername = normalizeUsername(username);
    const attemptTime = new Date().toISOString();
    let didMove = false;

    const nextUsers = usersRef.current.map((currentUser) => {
      if (normalizeUsername(currentUser.username) === normalizedUsername) {
        didMove = true;
        return {
          ...currentUser,
          status: 'failed' as const,
          notes: reason,
          failureReason: reason,
          lastAttemptAt: attemptTime,
        };
      }

      return currentUser;
    });

    if (!didMove) {
      return { didMove: false, nextUsers: usersRef.current };
    }

    persistUsersSnapshot(nextUsers);
    return { didMove: true, nextUsers };
  };

  const applyBotState = (data: BotUsersResponse, options?: { reconcile?: boolean; allowRestore?: boolean; silent?: boolean }) => {
    const queue = extractQueueState(data);

    setAuthState({
      authenticated: Boolean(data.authenticated),
      instagramUsername: data.authenticated ? normalizeUsername(data.instagramUsername ?? '') || null : null,
      serverReachable: true,
      error: null,
    });
    setQueueState(queue);

    if (!Array.isArray(data.remainingUsers)) return;

    if ((options?.allowRestore ?? true) && users.length === 0 && queue.remainingUsers.length > 0 && queue.totalLoadedCount > 0) {
      const restoredUsers = buildPendingRows(queue.remainingUsers);
      const nextSummary = importSummary ?? {
        label: `שוחזרו ${restoredUsers.length} חשבונות`,
        details: 'התור נשמר מהחיבור הקודם שלך.',
      };

      startTransition(() => {
        setUsers(restoredUsers);
        setImportSource(importSource === 'none' ? 'csv' : importSource);
        setImportSummary(nextSummary);
        setActiveId(getActiveId(restoredUsers));
      });

      if (data.instagramUsername) {
        saveWorkspaceSnapshot(data.instagramUsername, restoredUsers, importSource === 'none' ? 'csv' : importSource, nextSummary);
      }

      if (!options?.silent) {
        setNotice({ tone: 'info', text: 'התור הקודם שלך שוחזר אוטומטית.' });
      }

      return;
    }

    if (options?.reconcile && (queue.totalLoadedCount > 0 || queue.remainingUsers.length > 0 || queue.lastProcessedUsername)) {
      let nextUsersSnapshot: UserRow[] = users;
      let nextActiveId: string | null | undefined;
      const failedUsernameToRetain =
        !queue.isProcessing && queue.lastError
          ? normalizeUsername(queue.currentUsername || lastQueueUsernameRef.current || '')
          : '';

      setUsers((currentUsers) => {
        const updatedUsers = reconcileUsersWithRemaining(
          currentUsers,
          queue.remainingUsers,
          failedUsernameToRetain ? [failedUsernameToRetain] : [],
        );
        nextUsersSnapshot = updatedUsers;
        if (activeId && !updatedUsers.some((user) => user.id === activeId)) nextActiveId = getActiveId(updatedUsers);
        return updatedUsers;
      });

      if (nextActiveId !== undefined) setActiveId(nextActiveId);
      if (authState.instagramUsername) saveWorkspaceSnapshot(authState.instagramUsername, nextUsersSnapshot);
    }
  };

  const fetchBotState = async (silent = true, reconcile = false, baseUrl = normalizedBotBaseUrl) => {
    if (!silent) setIsSyncing(true);

    try {
      const response = await fetch(`${buildApiUrl('/api/queue/status', baseUrl)}?clientSessionId=${encodeURIComponent(clientSessionId)}`);
      const data = (await response.json()) as BotUsersResponse;
      if (!response.ok || !data.success) throw new Error(data.error ?? `הבקשה נכשלה עם קוד ${response.status}`);
      applyBotState(data, { reconcile, allowRestore: true, silent });
      if (!silent && data.lastError) setNotice({ tone: 'danger', text: data.lastError });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      setAuthState((current) => ({ ...current, serverReachable: false, error: message }));
      if (!silent) setNotice({ tone: 'danger', text: `לא הצלחתי להגיע לבוט: ${message}` });
    } finally {
      if (!silent) setIsSyncing(false);
    }
  };

  const syncPendingUsersToBot = async (nextUsers: UserRow[]) => {
    const response = await fetch(buildApiUrl('/api/replace-users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientSessionId,
        usernames: nextUsers.filter((user) => user.status === 'pending').map((user) => user.username),
      }),
    });
    const data = (await response.json()) as BotUsersResponse;
    if (!response.ok || !data.success) throw new Error(data.error ?? `העדכון נכשל עם קוד ${response.status}`);
    applyBotState(data, { reconcile: false, allowRestore: false, silent: true });
  };

  const requestQueueStart = async () => {
    const response = await fetch(buildApiUrl('/api/queue/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSessionId }),
    });
    const data = (await response.json()) as BotUsersResponse;
    if (!response.ok || !data.success) throw new Error(data.error ?? `ההפעלה נכשלה עם קוד ${response.status}`);
    applyBotState(data, { reconcile: false, allowRestore: false, silent: true });
    return data;
  };

  const setBotUrl = () => {
    const normalized = normalizeBaseUrl(botBaseUrlInput);
    setBotBaseUrl(normalized);
    setNotice({ tone: 'info', text: `כתובת הבוט עודכנה ל־${normalized}` });
  };

  const handleLogin = async () => {
    const instagramUsername = normalizeUsername(loginUsername);

    if (!instagramUsername) {
      setNotice({ tone: 'danger', text: 'צריך למלא שם משתמש.' });
      return;
    }

    setIsAuthBusy(true);

    try {
      const snapshot = savedWorkspaces[instagramUsername];

      setLoginUsername(instagramUsername);
      setAuthState({
        authenticated: true,
        instagramUsername,
        serverReachable: false,
        error: null,
      });
      setQueueState(emptyQueueState);

      if (snapshot) {
        const restoredUsers = normalizeUsers(snapshot.users);
        startTransition(() => {
          setUsers(restoredUsers);
          setImportSource(snapshot.importSource);
          setImportSummary(snapshot.importSummary);
          setSearch('');
          setCurrentPage(1);
          setActiveId(getActiveId(restoredUsers));
          setShowImportPanel(false);
        });
        setNotice({ tone: 'success', text: `נפתחה סביבת העבודה של @${instagramUsername}. ההתקדמות שלך חזרה אוטומטית.` });
      } else {
        clearVisibleWorkspace();
        setNotice({ tone: 'success', text: `נפתחה סביבת עבודה עבור @${instagramUsername}.` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      setAuthState({ authenticated: false, instagramUsername: null, serverReachable: false, error: message });
      setNotice({ tone: 'danger', text: `לא הצלחתי לפתוח סביבת עבודה: ${message}` });
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (queueState.isProcessing || manualActionUserId || isQueueRecovering) {
      setNotice({ tone: 'danger', text: 'עצור קודם את כל הפעולות הפעילות ואז תתנתק.' });
      return;
    }

    const disconnectedUser = authState.instagramUsername;
    setIsAuthBusy(true);
    clearVisibleWorkspace();
    setAuthState(emptyAuthState);
    setQueueState(emptyQueueState);
    setClientSessionId(createClientSessionId());
    setShowConnectionSettings(false);
    setLoginUsername(disconnectedUser ?? '');
    setNotice({ tone: 'info', text: disconnectedUser ? `התנתקת מ־@${disconnectedUser}. ההתקדמות נשמרה ותשוחזר כשתתחבר שוב.` : 'התנתקת.' });
    setIsAuthBusy(false);
  };

  const handleImport = async (result: ImportResult) => {
    if (!currentWorkspaceKey) {
      setNotice({ tone: 'danger', text: 'צריך להתחבר קודם לאינסטגרם.' });
      return;
    }

    if (queueState.isProcessing || isQueueRecovering) {
      setNotice({ tone: 'danger', text: 'עצור קודם את התור האוטומטי ואז טען קובץ חדש.' });
      return;
    }

    setQueueAutoRun(false);
    queueAutoRunRef.current = false;
    lastRecoveredFailureKeyRef.current = null;
    setIsImporting(true);
    const nextUsers = normalizeUsers(result.users);

    startTransition(() => {
      setUsers(nextUsers);
      setImportSource(result.source);
      setImportSummary(result.summary);
      setCurrentPage(1);
      setSearch('');
      setShowImportPanel(false);
      setActiveId(getActiveId(nextUsers));
    });
    saveWorkspaceSnapshot(currentWorkspaceKey, nextUsers, result.source, result.summary);

    if (!isBotConnected) {
      setNotice({ tone: 'success', text: `נטענו ${nextUsers.length} חשבונות. ההתקדמות נשמרת בדפדפן הזה.` });
      setIsImporting(false);
      return;
    }

    try {
      await syncPendingUsersToBot(nextUsers);
      setNotice({ tone: 'success', text: `נטענו ${nextUsers.length} חשבונות והם סונכרנו לבוט.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      setNotice({ tone: 'danger', text: `הקובץ נטען, אבל הסנכרון לבוט נכשל: ${message}` });
    } finally {
      setIsImporting(false);
    }
  };

  const handleStartQueue = async () => {
    if (!authState.authenticated) return setNotice({ tone: 'danger', text: 'צריך להתחבר קודם לאינסטגרם.' });
    if (!isBotConnected) return setNotice({ tone: 'info', text: 'האתר פועל במצב ידני. אפשר לפתוח פרופילים ולסמן משתמשים כהוסרו בלי שרת בוט.' });
    if (pendingUsers.length === 0) return setNotice({ tone: 'info', text: 'אין כרגע משתמשים שממתינים להסרה.' });
    if (isQueueRecovering) return setNotice({ tone: 'info', text: 'התור כבר מתאושש מתקלה וממשיך אוטומטית.' });

    setIsQueueBusy(true);
    try {
      lastRecoveredFailureKeyRef.current = null;
      autoRecoveryLockRef.current = false;
      await requestQueueStart();
      setQueueAutoRun(true);
      setNotice({ tone: 'success', text: 'התור האוטומטי התחיל לעבוד ברקע במצב מהיר.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      setQueueAutoRun(false);
      setNotice({ tone: 'danger', text: `לא הצלחתי להפעיל את התור: ${message}` });
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleStopQueue = async () => {
    if (!queueState.isProcessing && !isQueueRecovering) return setNotice({ tone: 'info', text: 'התור כבר עצור.' });

    setQueueAutoRun(false);
    queueAutoRunRef.current = false;
    setIsQueueRecovering(false);
    autoRecoveryLockRef.current = false;
    lastRecoveredFailureKeyRef.current = null;
    setIsQueueBusy(true);
    try {
      const response = await fetch(buildApiUrl('/api/queue/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId }),
      });
      const data = (await response.json()) as BotUsersResponse;
      if (!response.ok || !data.success) throw new Error(data.error ?? `העצירה נכשלה עם קוד ${response.status}`);
      applyBotState(data, { reconcile: false, allowRestore: false, silent: true });
      setNotice({ tone: 'info', text: 'נשלחה בקשת עצירה. הפעולה הנוכחית תסתיים ואז התור ייעצר.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      setNotice({ tone: 'danger', text: `לא הצלחתי לעצור את התור: ${message}` });
    } finally {
      setIsQueueBusy(false);
    }
  };

  const handleManualUnfollow = async (id: string) => {
    const user = usersRef.current.find((currentUser) => currentUser.id === id);
    if (!user || !currentWorkspaceKey) return;
    if (queueState.isProcessing || isQueueRecovering) return setNotice({ tone: 'danger', text: 'עצור קודם את התור האוטומטי ואז נסה שוב.' });
    if (manualActionUserId) return;

    if (!isBotConnected) {
      persistUsersSnapshot(usersRef.current.filter((currentUser) => currentUser.id !== id));
      setNotice({ tone: 'success', text: `@${user.username} סומן כהוסר מהרשימה.` });
      return;
    }

    setManualActionUserId(id);
    setNotice({ tone: 'info', text: `שולח לבוט בקשה להסיר את @${user.username}...` });

    try {
      const response = await fetch(buildApiUrl('/api/unfollow'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId, username: user.username }),
      });
      const data = (await response.json()) as BotUsersResponse;
      if (!response.ok || !data.success) throw new Error(data.error ?? `ההסרה נכשלה עם קוד ${response.status}`);

      persistUsersSnapshot(usersRef.current.filter((currentUser) => currentUser.id !== id));
      applyBotState(data, { reconcile: false, allowRestore: false, silent: true });
      setNotice({ tone: 'success', text: `העוקב של @${user.username} הוסר בהצלחה.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
      const { nextUsers: nextUsersSnapshot } = movePendingUserToFailed(user.username, message);
      try { await syncPendingUsersToBot(nextUsersSnapshot); } catch {}
      setNotice({ tone: 'danger', text: `לא הצלחתי להסיר את @${user.username}. המשתמש עבר לעמודת "לא הוסר".` });
    } finally {
      setManualActionUserId(null);
    }
  };

  const handleClearSession = async () => {
    if (!currentWorkspaceKey) return;
    if (queueState.isProcessing || manualActionUserId || isQueueRecovering) return setNotice({ tone: 'danger', text: 'עצור קודם את כל הפעולות הפעילות ואז נקה התקדמות.' });
    if (!window.confirm('למחוק את כל ההתקדמות השמורה של החשבון הזה?')) return;

    setQueueAutoRun(false);
    queueAutoRunRef.current = false;
    lastRecoveredFailureKeyRef.current = null;
    if (isBotConnected) {
      try { await syncPendingUsersToBot([]); } catch {}
    }

    setSavedWorkspaces((current) => {
      const next = { ...current };
      delete next[currentWorkspaceKey];
      return next;
    });
    clearVisibleWorkspace();
    setQueueState(emptyQueueState);
    setNotice({ tone: 'info', text: 'ההתקדמות השמורה נמחקה.' });
  };

  useEffect(() => {
    if (!queueAutoRun || queueState.isProcessing || isQueueRecovering || queueState.stopRequested || !queueState.lastError) return;

    const failedUsername = normalizeUsername(queueState.currentUsername || lastQueueUsernameRef.current || '');
    if (!failedUsername) {
      setQueueAutoRun(false);
      setNotice({ tone: 'danger', text: `התור נעצר על שגיאה ולא התקבל שם המשתמש שנכשל: ${queueState.lastError}` });
      return;
    }

    const isStillPending = usersRef.current.some(
      (user) => user.status === 'pending' && normalizeUsername(user.username) === failedUsername,
    );
    if (!isStillPending) return;

    const failureKey = `${failedUsername}::${queueState.lastError}::${queueState.processedCount}::${queueState.pendingCount}`;
    if (autoRecoveryLockRef.current || lastRecoveredFailureKeyRef.current === failureKey) return;

    autoRecoveryLockRef.current = true;
    lastRecoveredFailureKeyRef.current = failureKey;
    setIsQueueRecovering(true);

    void (async () => {
      try {
        const { nextUsers } = movePendingUserToFailed(failedUsername, queueState.lastError || 'הבוט עצר את ההסרה האוטומטית.');
        await syncPendingUsersToBot(nextUsers);

        const remainingPendingCount = nextUsers.filter((user) => user.status === 'pending').length;
        if (remainingPendingCount > 0 && queueAutoRunRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, AUTO_RECOVERY_RESTART_DELAY_MS));
          await requestQueueStart();
          setNotice({ tone: 'info', text: `@${failedUsername} הועבר ל"לא הוסר". התור המשיך אוטומטית.` });
        } else {
          setQueueAutoRun(false);
          setNotice({ tone: 'info', text: `@${failedUsername} הועבר ל"לא הוסר". לא נשארו משתמשים נוספים בתור.` });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
        setQueueAutoRun(false);
        setNotice({ tone: 'danger', text: `@${failedUsername} הועבר ל"לא הוסר", אבל ההמשך האוטומטי נכשל: ${message}` });
      } finally {
        setIsQueueRecovering(false);
        autoRecoveryLockRef.current = false;
      }
    })();
  }, [
    isQueueRecovering,
    queueAutoRun,
    queueState.currentUsername,
    queueState.isProcessing,
    queueState.lastError,
    queueState.pendingCount,
    queueState.processedCount,
    queueState.stopRequested,
  ]);

  useEffect(() => {
    if (!queueAutoRun || queueState.isProcessing || isQueueRecovering || queueState.lastError || pendingUsers.length > 0) return;

    setQueueAutoRun(false);
    lastQueueUsernameRef.current = null;
    lastRecoveredFailureKeyRef.current = null;
    setNotice({ tone: 'success', text: 'התור האוטומטי הסתיים בהצלחה.' });
  }, [isQueueRecovering, pendingUsers.length, queueAutoRun, queueState.isProcessing, queueState.lastError]);

  useEffect(() => {
    if (showConnectionSettings) void fetchBotState(true, false);
  }, [clientSessionId, normalizedBotBaseUrl, showConnectionSettings]);

  useEffect(() => {
    if (!isBotConnected) return;
    const intervalId = window.setInterval(() => {
      void fetchBotState(true, queueState.isProcessing || queueState.totalLoadedCount > 0 || Boolean(queueState.lastProcessedUsername));
    }, queueState.isProcessing || isQueueRecovering ? ACTIVE_QUEUE_POLL_INTERVAL_MS : IDLE_QUEUE_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [
    clientSessionId,
    isQueueRecovering,
    isBotConnected,
    normalizedBotBaseUrl,
    queueState.isProcessing,
    queueState.lastProcessedUsername,
    queueState.totalLoadedCount,
    users.length,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName) || !activeId) return;
      const currentIndex = keyboardUsers.findIndex((user) => user.id === activeId);
      const activeUser = keyboardUsers[currentIndex];
      if (!activeUser) return;
      if (event.key.toLowerCase() === 'o') window.open(`https://www.instagram.com/${activeUser.username}/`, '_blank');
      if (event.key.toLowerCase() === 'u') void handleManualUnfollow(activeId);
      if (event.key.toLowerCase() === 'n' && currentIndex < keyboardUsers.length - 1) setActiveId(keyboardUsers[currentIndex + 1].id);
      if (event.key.toLowerCase() === 'p' && currentIndex > 0) setActiveId(keyboardUsers[currentIndex - 1].id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeId, isQueueRecovering, keyboardUsers, queueState.isProcessing, manualActionUserId]);

  const statusStrip = (
    <div className="status-strip">
      <span className={`status-pill ${isBotConnected ? 'status-online' : 'status-idle'}`}>{isBotConnected ? 'בוט מחובר' : 'מצב ידני'}</span>
      <span className={`status-pill ${authState.authenticated ? 'status-online' : 'status-idle'}`}>{authState.authenticated ? `מחובר כ־@${authState.instagramUsername}` : 'לא מחובר'}</span>
      {(queueState.isProcessing || queueAutoRun || isQueueRecovering) && (
        <span className={`status-pill ${isQueueRecovering ? 'status-offline' : 'status-online'}`}>
          {isQueueRecovering ? 'מתאושש מתקלה' : 'תור מהיר פעיל'}
        </span>
      )}
      {importSource !== 'none' && <span className="status-pill status-idle">{importSource === 'instagram-export' ? 'קובץ אינסטגרם' : 'CSV'}</span>}
      {importSummaryText && <span className="status-pill status-idle">{importSummaryText}</span>}
    </div>
  );

  const settingsPanel = (
    <section className="glass-card settings-panel">
      <div className="panel-header"><div><p className="eyebrow">בוט</p><h3>כתובת חיבור</h3></div></div>
      <div className="settings-grid">
        <label className="field-group"><span>כתובת הבוט</span><input type="text" value={botBaseUrlInput} onChange={(event) => setBotBaseUrlInput(event.target.value)} className="field-input" placeholder="http://127.0.0.1:5000" /></label>
        <div className="action-cluster">
          <button className="secondary-button" onClick={setBotUrl}>שמירה</button>
          <button className="ghost-button" onClick={() => void fetchBotState(false, false)} disabled={isSyncing}><RefreshCw size={16} className={isSyncing ? 'spin' : ''} /> בדיקת חיבור</button>
        </div>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <div className="page-shell">
        <header className="topbar">
          <div className="brand-block"><div className="brand-mark">IG</div><div><p className="eyebrow">מערכת הסרת עוקבים</p><h1>עברית מלאה, פעולה אחת ברורה, והתקדמות שנשמרת</h1></div></div>
          <div className="topbar-actions">
            {authState.authenticated && <>
              {isBotConnected && <>
                <button className="ghost-button" onClick={() => setShowConnectionSettings((current) => !current)}><Settings2 size={16} /> הגדרות</button>
                <button className="ghost-button" onClick={() => void fetchBotState(false, true)} disabled={isSyncing}><RefreshCw size={16} className={isSyncing ? 'spin' : ''} /> {isSyncing ? 'מסנכרן...' : 'סנכרון'}</button>
              </>}
              <button className="ghost-button danger-text" onClick={() => void handleLogout()} disabled={isAuthBusy || isQueueRecovering}><LogOut size={16} /> התנתקות</button>
            </>}
            <button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </header>

        {notice && <div className={`notice-banner notice-${notice.tone}`}>{notice.text}</div>}

        {!authState.authenticated ? (
          <main className="setup-grid">
            <section className="glass-card hero-card">
              <p className="eyebrow">איך זה עובד</p>
              <h2>פותחים סביבת עבודה, מעלים קובץ, ומסמנים ידנית את מי שכבר הסרת.</h2>
              <ul className="bullet-list">
                <li>אין צורך בשרת מקומי או בסיסמה כדי להתחיל.</li>
                <li>כל ההתקדמות נשמרת לפי שם המשתמש שבחרת.</li>
                <li>פותחים פרופיל באינסטגרם, מבצעים הסרה ידנית, ואז מסמנים שהוסר.</li>
              </ul>
              {statusStrip}
            </section>

            <section className="glass-card auth-card">
              <div className="panel-header"><div><p className="eyebrow">כניסה</p><h3>פתיחת סביבת עבודה</h3></div><span className="tiny-badge tiny-badge-idle">מצב ידני</span></div>
              <div className="form-stack">
                <label className="field-group"><span>שם משתמש</span><input type="text" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} className="field-input" placeholder="your_instagram_username" /></label>
                {loginWorkspaceHint && <div className="saved-hint">נמצאה התקדמות שמורה: {loginWorkspaceHint.users.filter((user) => user.status === 'pending').length} ממתינים, {loginWorkspaceHint.users.filter((user) => user.status === 'failed').length} ב"לא הוסר". שמירה אחרונה: {formatSavedAt(loginWorkspaceHint.savedAt)}.</div>}
                <button className="primary-button jumbo-button" onClick={() => void handleLogin()} disabled={isAuthBusy}>{isAuthBusy ? <LoaderCircle size={18} className="spin" /> : <LogIn size={18} />}{isAuthBusy ? 'פותח...' : 'כניסה'}</button>
              </div>
            </section>
          </main>
        ) : !hasWorkspaceData ? (
          <main className="import-layout">
            <section className="glass-card hero-card"><p className="eyebrow">שלב 2</p><h2>עכשיו מעלים את קובץ האינסטגרם</h2><p className="panel-copy">סביבת העבודה של @{authState.instagramUsername} פתוחה. ברגע שתעלה קובץ, הכל יישמר לשם הזה ויחזור בפעם הבאה.</p>{statusStrip}</section>
            {showConnectionSettings && settingsPanel}
            <section className="workspace-grid">
              <div className="glass-card"><div className="panel-header"><div><p className="eyebrow">ייבוא</p><h3>ZIP של אינסטגרם או CSV</h3></div></div><CSVImporter onImport={handleImport} disabled={isImporting || queueState.isProcessing || isQueueRecovering || Boolean(manualActionUserId)} /></div>
              <aside className="glass-card side-card"><div className="panel-header"><div><p className="eyebrow">מה תקבל כאן</p><h3>מסך עבודה הרבה יותר נקי</h3></div></div><ul className="bullet-list"><li>רשימת משתמשים שממתינים לטיפול.</li><li>פתיחת פרופיל מהירה וסימון אחרי הסרה ידנית.</li><li>ההתקדמות חוזרת אוטומטית בכניסה הבאה.</li></ul></aside>
            </section>
          </main>
        ) : (
          <main className="workspace-layout">
            <section className="glass-card hero-card">
              <div className="hero-row"><div><p className="eyebrow">מרכז עבודה</p><h2>פותחים פרופיל, מסירים ידנית, ומסמנים שהוסר מהרשימה</h2><p className="panel-copy">האתר עובד ישירות בדפדפן ושומר את ההתקדמות מקומית, לכן הוא יעבוד גם לחברים שפותחים אותו מ־GitHub Pages.</p></div>{isBotConnected && <div className="hero-actions"><button className="primary-button jumbo-button" onClick={() => void handleStartQueue()} disabled={queueState.isProcessing || isQueueBusy || isQueueRecovering || Boolean(manualActionUserId) || pendingUsers.length === 0}>{queueState.isProcessing || isQueueBusy || isQueueRecovering ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}{isQueueRecovering ? 'מתאושש וממשיך...' : queueState.isProcessing ? 'התור עובד עכשיו' : `הפעלת תור (${pendingUsers.length})`}</button><button className="secondary-button" onClick={() => void handleStopQueue()} disabled={(!queueState.isProcessing && !isQueueRecovering) || isQueueBusy}><Square size={16} /> עצירה</button></div>}</div>
              {isBotConnected && <div className="progress-card"><div className="progress-head"><span>התקדמות הבוט</span><strong>{queueState.processedCount} / {queueProgressBase || 0}</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${queueProgressPercent}%` }} /></div><div className="progress-foot"><span>{queueProgressPercent}% הושלם</span><span>{isQueueRecovering ? 'מזהה תקלה, מעביר לכשלונות וממשיך אוטומטית' : queueState.currentUsername ? `כרגע מטפל ב־@${queueState.currentUsername}` : queueState.lastProcessedUsername ? `האחרון שהושלם: @${queueState.lastProcessedUsername}` : 'ממתין לפעולה הבאה'}</span></div></div>}
              {statusStrip}
            </section>

            <section className="summary-grid">
              <article className="summary-card"><Bot size={18} /><div><span className="summary-label">משתמש פעיל</span><strong>@{authState.instagramUsername}</strong></div></article>
              <article className="summary-card"><CheckCircle2 size={18} /><div><span className="summary-label">ממתינים להסרה</span><strong>{pendingUsers.length}</strong></div></article>
              <article className="summary-card danger-card"><AlertTriangle size={18} /><div><span className="summary-label">לא הוסר</span><strong>{failedUsers.length}</strong></div></article>
              <article className="summary-card success-card"><Download size={18} /><div><span className="summary-label">{isBotConnected ? 'הוסרו דרך הבוט' : 'נשארו ברשימה'}</span><strong>{isBotConnected ? queueState.processedCount : users.length}</strong></div></article>
            </section>

            <section className="glass-card controls-card">
              <div className="control-row"><div><p className="eyebrow">פעולות מהירות</p><h3>הכל במקום אחד</h3></div><div className="action-cluster"><button className="ghost-button" onClick={() => filteredPendingUsers.slice(0, batchSize).forEach((user) => window.open(`https://www.instagram.com/${user.username}/`, '_blank'))} disabled={filteredPendingUsers.length === 0}><Upload size={16} /> פתיחת הבאים</button><button className="ghost-button" onClick={() => exportToCSV(users)}><Download size={16} /> ייצוא CSV</button><button className="ghost-button" onClick={() => setShowImportPanel((current) => !current)} disabled={queueState.isProcessing || isQueueRecovering}><Upload size={16} /> {showImportPanel ? 'הסתרת ייבוא' : 'ייבוא חדש'}</button><button className="ghost-button danger-text" onClick={() => void handleClearSession()} disabled={queueState.isProcessing || isQueueRecovering || Boolean(manualActionUserId)}><Trash2 size={16} /> מחיקת התקדמות</button></div></div>
              <div className="filters-row"><label className="field-group"><span>חיפוש</span><input type="text" value={search} onChange={(event) => setSearch(event.target.value)} className="field-input" placeholder="שם משתמש או שגיאה" /></label><label className="field-group field-group-small"><span>בכל עמוד</span><select value={batchSize} onChange={(event) => { setBatchSize(Number(event.target.value)); setCurrentPage(1); }} className="field-input"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
              {isQueueRecovering && <div className="inline-info">זוהתה תקלה. המשתמש מועבר ל"לא הוסר" והתור ממשיך אוטומטית.</div>}
              {queueState.lastError && !isQueueRecovering && <div className="inline-error">{queueState.lastError}</div>}
            </section>

            {showImportPanel && <section className="glass-card"><div className="panel-header"><div><p className="eyebrow">החלפת רשימה</p><h3>טעינת קובץ חדש</h3></div></div><CSVImporter onImport={handleImport} disabled={isImporting || queueState.isProcessing || isQueueRecovering || Boolean(manualActionUserId)} /></section>}
            {showConnectionSettings && settingsPanel}

            <section className="workspace-grid">
              <DataTable title="ממתינים להסרה" subtitle="פותחים את הפרופיל, מסירים ידנית באינסטגרם, ואז מסמנים שהוסר מהרשימה." kind="pending" users={paginatedPendingUsers} activeId={activeId} canAct={authState.authenticated && !queueState.isProcessing && !isQueueRecovering} busyUserId={manualActionUserId} currentProcessingUsername={queueState.currentUsername} emptyText="אין כרגע משתמשים שממתינים להסרה." actionLabel="סמן הוסר" actionBusyLabel="טוען..." onAction={(id) => void handleManualUnfollow(id)} onSetActive={setActiveId} />
              <DataTable title="לא הוסר" subtitle="כאן נשמרים משתמשים שלא הוסרו, עם אפשרות לסמן אותם כהוסרו אחרי טיפול ידני." kind="failed" users={filteredFailedUsers} activeId={activeId} canAct={authState.authenticated && !queueState.isProcessing && !isQueueRecovering} busyUserId={manualActionUserId} currentProcessingUsername={queueState.currentUsername} emptyText="עדיין אין משתמשים ב-'לא הוסר'." actionLabel="סמן הוסר" actionBusyLabel="מנסה שוב..." onAction={(id) => void handleManualUnfollow(id)} onSetActive={setActiveId} />
            </section>

            <div className="footer-strip"><div className="pagination"><button className="ghost-button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>הקודם</button><span>עמוד {currentPage} מתוך {totalPages}</span><button className="ghost-button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>הבא</button></div><div className="keyboard-shortcuts-hint">קיצורי מקלדת: <kbd>O</kbd> פתיחת פרופיל, <kbd>U</kbd> הסרה, <kbd>N</kbd>/<kbd>P</kbd> מעבר בין שורות.</div></div>
          </main>
        )}
      </div>
    </div>
  );
}
