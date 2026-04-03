import { useState, useEffect, useMemo } from 'react';
import { CSVImporter } from './components/CSVImporter';
import { DataTable } from './components/DataTable';
import { exportToCSV } from './utils/csv';
import { useLocalStorage } from './hooks/useLocalStorage';
import { UserRow, Status } from './types';
import { Moon, Sun, Download, Trash2, Layers } from 'lucide-react';
import './index.css';

export default function App() {
  const [users, setUsers] = useLocalStorage<UserRow[]>('ig-reviewer-users', []);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('ig-reviewer-theme', 'dark');
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

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


  // Actions
  const updateStatus = (id: string, status: Status) => {
    setUsers(curr => curr.map(u => u.id === id ? { ...u, status } : u));
    // Auto-advance if not pending
    if (status !== 'pending' && activeId === id) {
      const idx = paginatedUsers.findIndex(u => u.id === id);
      if (idx !== -1 && idx < paginatedUsers.length - 1) {
        setActiveId(paginatedUsers[idx + 1].id);
      }
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
            
            <div className="controls">
              <button className="action-button primary" onClick={() => bulkOpenNext(5)}>
                <Layers size={16} /> Bulk Open Next 5 Pending
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
            users={paginatedUsers} 
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
