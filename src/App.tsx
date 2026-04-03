import { useState, useEffect, useMemo } from 'react';
import { CSVImporter } from './components/CSVImporter';
import { DataTable } from './components/DataTable';
import { exportToCSV } from './utils/csv';
import { useLocalStorage } from './hooks/useLocalStorage';
import { UserRow, Status } from './types';
import { Moon, Sun, Download, Trash2, Layers } from 'lucide-react';
import initialUsersData from './initialUsers.json';
import './index.css';

const defaultUsers = initialUsersData as UserRow[];

export default function App() {
  const [users, setUsers] = useLocalStorage<UserRow[]>('ig-reviewer-data', defaultUsers);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('ig-reviewer-theme', 'dark');
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unfollowQueue, setUnfollowQueue] = useState<string[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  // Pagination & Batching
  const [batchSize, setBatchSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Apply Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Derived State
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (search && !u.username.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [users, search, statusFilter]);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * batchSize;
    return filteredUsers.slice(start, start + batchSize);
  }, [filteredUsers, currentPage, batchSize]);

  // Stats
  const stats = useMemo(() => {
    const total = users.length;
    const pending = users.filter(u => u.status === 'pending').length;
    const processed = total - pending;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
    return { total, pending, processed, percentage };
  }, [users]);

  // Keyboard Shortcuts Hook
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (!activeId) return;

      const currentIndex = paginatedUsers.findIndex(u => u.id === activeId);
      const activeUser = paginatedUsers[currentIndex];
      if (!activeUser) return;

      switch (e.key.toLowerCase()) {
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


  // Background sequential queue processor
  useEffect(() => {
    const processQueue = async () => {
      if (unfollowQueue.length === 0 || isProcessingQueue) return;
      
      setIsProcessingQueue(true);
      const id = unfollowQueue[0];
      const u = users.find(user => user.id === id);
      
      if (u) {
        try {
          const res = await fetch('http://127.0.0.1:5000/api/unfollow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u.username })
          });
          const data = await res.json();
          
          if (!data.success) {
            alert(`API Failed for ${u.username}:\n${data.error}`);
          } else {
            // Delete user on success
            setUsers(curr => curr.filter(currUser => currUser.id !== id));
          }
        } catch(e: any) {
          alert(`Network Error for ${u.username}:\n${e.message}`);
        }
      }
      
      setUnfollowQueue(prev => prev.slice(1));
      setIsProcessingQueue(false);
    };

    processQueue();
  }, [unfollowQueue, isProcessingQueue, users, setUsers]);

  // Actions
  const updateStatus = (id: string, status: Status) => {
    // Determine the next user to highlight BEFORE anything else
    const currentIndex = paginatedUsers.findIndex(u => u.id === id);
    if (currentIndex !== -1 && currentIndex < paginatedUsers.length - 1) {
      setActiveId(paginatedUsers[currentIndex + 1].id);
    }

    if (status === 'unfollowed manually') {
      if (!unfollowQueue.includes(id)) {
        setUnfollowQueue(prev => [...prev, id]);
      }
    } else {
      setUsers(curr => curr.map(u => u.id === id ? { ...u, status } : u));
    }
  };

  const autoQueueAll = () => {
    const confirmation = window.confirm(
      `🚨 סכנת חסימה! 🚨\n\nהכנסה של כל ה-${users.length} משתמשים במכה אחת בלי הפסקה לפעולת הבוט היא הדרך הבטוחה לחטוף חסימה או באן מאינסטגרם!\n\nהאם אתה בטוח שאתה רוצה לעשות את זה?`
    );
    if (confirmation) {
      const allPendingIds = users.filter(u => !unfollowQueue.includes(u.id)).map(u => u.id);
      setUnfollowQueue(prev => [...prev, ...allPendingIds]);
    }
  };

  const bulkOpenNext = (count: number) => {
    const nextPending = filteredUsers.filter(u => u.status === 'pending').slice(0, count);
    nextPending.forEach(u => {
      window.open(`https://www.instagram.com/${u.username}/`, '_blank');
    });
  };

  const handleClearSession = () => {
    if (window.confirm("Are you sure? This will delete all imported data and progress.")) {
      setUsers([]);
      setActiveId(null);
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
          <CSVImporter onImport={(data) => { setUsers(data); setCurrentPage(1); }} />
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
            
            <div className="table-actions" style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem'}}>
              <button className="primary-button" onClick={() => bulkOpenNext(batchSize)} disabled={paginatedUsers.length === 0}>
                <Layers size={16} /> Open Next {batchSize}
              </button>
              <button 
                 className="big-x-button" 
                 style={{padding: '0.5rem 1rem', display: 'flex', alignItems: 'center'}} 
                 onClick={autoQueueAll} 
                 disabled={users.length === 0 || unfollowQueue.length === users.length}>
                Auto-Queue All
              </button>
            </div>
          </div>
          <div className="filters-bar">
            <input 
              type="text" 
              placeholder="Search username..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as Status | 'all')} className="filter-select">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="kept">Kept</option>
              <option value="unfollowed manually">Unfollowed Manually</option>
              <option value="skipped">Skipped</option>
            </select>
            <select value={batchSize} onChange={e => { setBatchSize(Number(e.target.value)); setCurrentPage(1); }} className="filter-select">
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>

          <DataTable 
            users={paginatedUsers.map(u => unfollowQueue.includes(u.id) ? {...u, status: 'unfollowing...' as any} : u)} 
            activeId={activeId} 
            onSetActive={setActiveId}
            onUpdateStatus={updateStatus}
            onUpdateNote={(id, notes) => setUsers(curr => curr.map(u => u.id === id ? { ...u, notes } : u))}
            onUpdateCategory={(id, category) => setUsers(curr => curr.map(u => u.id === id ? { ...u, category } : u))}
          />

          <div className="pagination">
            <button 
              disabled={currentPage === 1} 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              className="action-button outline"
            >
              Previous Page
            </button>
            <span>Page {currentPage} of {Math.max(1, Math.ceil(filteredUsers.length / batchSize))}</span>
            <button 
              disabled={currentPage >= Math.ceil(filteredUsers.length / batchSize)} 
              onClick={() => setCurrentPage(p => p + 1)}
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
