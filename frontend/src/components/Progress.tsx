"use client";

interface ProgressProps {
  progress: number;
  message: string;
}

export default function Progress({ progress, message }: ProgressProps) {
  return (
    <div className="w-full bg-[#fdfbf7] p-8 md:p-12 border border-[#1a1a1a] rounded-[2rem] shadow-[12px_12px_0px_var(--accent)] md:shadow-[24px_24px_0px_#1a1a1a]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-8 md:gap-0 border-b border-[#1a1a1a] pb-8">
        <h3 className="text-3xl md:text-5xl font-display font-bold uppercase tracking-tighter text-[#1a1a1a] leading-none max-w-xl">
          {message}
        </h3>
        <span className="text-6xl md:text-[5rem] font-display font-bold text-[var(--accent)] leading-none" 
              style={{ WebkitTextStroke: "2px #1a1a1a" }}>
          {progress}%
        </span>
      </div>
      
      <div className="w-full bg-[#ffffff] border-2 border-[#1a1a1a] rounded-full h-8 overflow-hidden p-1 relative">
        <div 
          className="bg-[var(--accent)] h-full rounded-full transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] border-r-2 border-[#1a1a1a]"
          style={{ width: `${progress}%` }}
        />
        {/* Animated striped overlay for loading feel */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgcGF0dGVyblRyYW5zZm9ybT0icm90YXRlKDQ1KSI+PGxpbmUgeDE9IjAiIHkxPSIwIiB4Mj0iMCIgeTI9IjQwIiBzdHJva2U9InJnYmEoMjYsIDI2LCAyNiwgMC4xKSIgc3Ryb2tlLXdpZHRoPSIyMCIgLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYSkiIC8+PC9zdmc+')] opacity-50 mix-blend-multiply animate-[slide_1s_linear_infinite]" />
      </div>
      
      <div className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-6">
        <Step label="Analyze Room" active={progress >= 25} done={progress > 25} />
        <Step label="Eval Lighting" active={progress >= 50} done={progress > 50} />
        <Step label="Generate Viz" active={progress >= 75} done={progress > 75} />
        <Step label="Finalize" active={progress >= 90} done={progress === 100} />
      </div>
    </div>
  );
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex flex-col space-y-4">
      <div className={`w-full h-1 transition-all duration-500
        ${done ? 'bg-[#1a1a1a]' : 
          active ? 'bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]' : 
          'bg-[#e5e5e5]'}
      `} />
      <span className={`text-[10px] font-bold uppercase tracking-widest ${active || done ? 'text-[#1a1a1a]' : 'text-[#a3a3a3]'}`}>
        {label}
      </span>
    </div>
  );
}