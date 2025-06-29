"use client";

import type React from 'react';

interface LoadingIndicatorProps {
  message?: string;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ message = "Converting..." }) => {
  return (
    <div className="flex flex-col items-center space-y-3 p-4" role="status" aria-live="polite">
      <div 
        className="w-12 h-12 border-4 border-accent rounded-full animate-spin border-t-transparent"
        style={{
          boxShadow: "0 0 15px 2px hsl(var(--accent) / 0.5), inset 0 0 10px 1px hsl(var(--accent) / 0.3)",
        }}
      ></div>
      <p className="text-accent font-medium">{message}</p>
    </div>
  );
};

export default LoadingIndicator;
