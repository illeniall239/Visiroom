"use client";

import { useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

interface UploaderProps {
  apiUrl: string;
  onUploadComplete: (generationId: string, imageKey: string, base64Image?: string) => void;
  label?: string;
  description?: string;
}

export default function Uploader({ apiUrl, onUploadComplete, label = "Upload", description = "Click or drag & drop" }: UploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    setError("");
    
    if (file.size > 10 * 1024 * 1024) {
      setError("FILE EXCEEDS 10MB LIMIT.");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("INVALID FORMAT. USE JPEG, PNG, WEBP.");
      return;
    }

    setIsUploading(true);

    try {
      const getBase64 = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(f);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = error => reject(error);
        });
      };

      const base64Image = await getBase64(file);

      setTimeout(() => {
        onUploadComplete(uuidv4(), "local_file", base64Image);
        setIsUploading(false);
      }, 400);

    } catch (err: any) {
      setError("PROCESSING FAILED.");
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      className={`relative w-full aspect-square md:aspect-auto md:h-80 border border-[#1a1a1a] rounded-[2rem] p-8 md:p-12 flex flex-col items-center justify-center text-center transition-all duration-300 overflow-hidden group
        ${isDragging ? "bg-[var(--accent)]" : "bg-[#ffffff] hover:bg-[#1a1a1a] hover:text-[#fdfbf7]"}
        ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        accept="image/jpeg,image/png,image/webp" 
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            processFile(e.target.files[0]);
          }
        }}
      />
      
      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full">
        {/* Animated icon container matching reference wireframe vibe */}
        <div className={`w-20 h-12 rounded-full border border-current flex items-center justify-center mb-8 transition-colors duration-300
          ${isDragging ? 'bg-[#1a1a1a] text-[var(--accent)]' : 'bg-[var(--accent)] text-[#1a1a1a] group-hover:bg-[var(--accent)] group-hover:text-[#1a1a1a]'}
        `}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>

        <h3 className="text-3xl font-display font-bold uppercase tracking-tighter leading-none mb-4">{label}</h3>
        <p className="text-[10px] md:text-xs uppercase tracking-widest font-medium opacity-60 max-w-[200px] leading-relaxed">
          {description}
        </p>
        
        {error && (
          <div className="absolute bottom-6 left-0 right-0 text-center">
            <span className="text-red-500 text-[10px] font-bold uppercase tracking-widest bg-red-50 px-3 py-1 rounded-full border border-red-200">
              {error}
            </span>
          </div>
        )}
        
        {isUploading && (
          <div className="absolute inset-0 bg-[#fdfbf7]/80 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-6 border border-[#1a1a1a] rounded-full overflow-hidden p-0.5">
                <div className="h-full w-1/3 bg-[#1a1a1a] rounded-full animate-[ping_1.5s_ease-in-out_infinite]"></div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]">PROCESSING</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}