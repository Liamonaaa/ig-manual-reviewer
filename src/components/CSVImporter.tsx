import React, { useRef, useState } from 'react';
import { FileUp, LoaderCircle, Sparkles } from 'lucide-react';
import { ImportResult } from '../types';
import { parseImportFile } from '../utils/import-file';

interface Props {
  disabled?: boolean;
  onImport: (result: ImportResult) => Promise<void>;
}

export const CSVImporter: React.FC<Props> = ({ disabled = false, onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const importFile = async (file: File) => {
    setIsBusy(true);

    try {
      const result = await parseImportFile(file);
      await onImport(result);
    } catch (error) {
      console.error(error);
      alert('Failed to parse the selected file. Use a CSV or an Instagram export ZIP.');
    } finally {
      setIsBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await importFile(file);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    if (disabled || isBusy) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      await importFile(file);
    }
  };

  return (
    <div
      className={`import-dropzone ${isDragActive ? 'drag-active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => {
        if (!disabled && !isBusy) {
          fileInputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !isBusy) {
          setIsDragActive(true);
        }
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="import-dropzone-glow" />
      <div className="import-dropzone-content">
        <span className="eyebrow">
          <Sparkles size={14} /> Smart import
        </span>
        <div className="import-icon-shell">
          {isBusy ? <LoaderCircle size={34} className="spin" /> : <FileUp size={34} />}
        </div>
        <h3>{isBusy ? 'Reading your file...' : 'Drop your Instagram ZIP or CSV here'}</h3>
        <p>
          Import the official Instagram export and the app will calculate who you follow that does not follow you back.
        </p>
        <div className="import-actions-row">
          <button type="button" className="primary-button" disabled={disabled || isBusy}>
            {isBusy ? 'Importing...' : 'Choose File'}
          </button>
          <span className="import-file-meta">Supports `.zip` and `.csv`</span>
        </div>
      </div>
      <input
        type="file"
        accept=".csv,.zip,application/zip"
        ref={fileInputRef}
        onChange={(event) => void handleFileChange(event)}
        style={{ display: 'none' }}
        disabled={disabled || isBusy}
      />
    </div>
  );
};
