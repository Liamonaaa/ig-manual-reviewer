import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';
import { ImportResult } from '../types';
import { parseImportFile } from '../utils/import-file';

interface Props {
  onImport: (result: ImportResult) => void;
}

export const CSVImporter: React.FC<Props> = ({ onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await parseImportFile(file);
      onImport(result);
    } catch (err) {
      alert('Failed to parse the selected file. Use a CSV or an Instagram export ZIP.');
      console.error(err);
    }
  };

  return (
    <div className="importer-container">
      <div 
        className="importer-card"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud size={48} className="importer-icon" />
        <h2>Import CSV or Instagram ZIP</h2>
        <p>Select a CSV with usernames or a ZIP exported directly from Instagram.</p>
        <p className="importer-hint">Instagram ZIP support automatically calculates who you follow that does not follow you back.</p>
        <input 
          type="file" 
          accept=".csv,.zip,application/zip" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          style={{ display: 'none' }} 
        />
      </div>
    </div>
  );
};
