import React, {useRef} from 'react';
import { UploadCloud } from 'lucide-react';
import { parseCSVFile } from '../utils/csv';
import { UserRow } from '../types';

interface Props {
  onImport: (users: UserRow[]) => void;
}

export const CSVImporter: React.FC<Props> = ({ onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const users = await parseCSVFile(file);
      onImport(users);
    } catch (err) {
      alert('Failed to parse CSV file.');
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
        <h2>Import CSV</h2>
        <p>Drop your CSV file here, or click to browse.</p>
        <p className="importer-hint">Required column: <strong>username</strong></p>
        <input 
          type="file" 
          accept=".csv" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          style={{ display: 'none' }} 
        />
      </div>
    </div>
  );
};
