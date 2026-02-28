"use client";

import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { createClient } from "@supabase/supabase-js";
import Uploader from "../components/Uploader";
import Progress from "../components/Progress";

const API_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3001";

let _supabase: ReturnType<typeof createClient> | null = null;
const getSupabase = () => {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
};

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketId, setSocketId] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "completed" | "error">("idle");
  const [productImageBase64, setProductImageBase64] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stores the generationId that is currently in-flight.
  // On socket reconnect we emit 'rejoin' with this so the gateway updates
  // its generationMap and the worker can find our new socket ID.
  const activeGenerationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setSocketId(newSocket.id || "");
      // If there's an active generation in-flight, re-register with the gateway
      // using the new socket ID. The gateway updates generationMap so the worker
      // emits to us instead of the now-dead original socket.
      if (activeGenerationIdRef.current) {
        newSocket.emit("rejoin", { generationId: activeGenerationIdRef.current });
      }
    });

    newSocket.on("generation-progress", (data) => {
      setStatus("processing");
      setMessage(data.message);
      setProgress(data.progress);
    });

    newSocket.on("generation-complete", (data) => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      activeGenerationIdRef.current = null;
      setStatus("completed");
      setResultUrl(data.resultUrl);
    });

    newSocket.on("generation-error", (data) => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      activeGenerationIdRef.current = null;
      setStatus("error");
      setErrorMsg(data.error);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleUploadComplete = async (generationId: string, _imageKey: string, base64Image?: string) => {
    if (!productImageBase64) return;

    setStatus("uploading");
    setMessage("Preparing your images...");
    setProgress(10);

    try {
      let mimeType = "image/jpeg";
      if (base64Image && base64Image.startsWith('data:')) {
        mimeType = base64Image.substring(5, base64Image.indexOf(';'));
      }

      // Step 1: Create the composite image in the browser (room + product reference box)
      const createCompositeImage = async (roomBase64: string, productUrl: string): Promise<string> => {
        return new Promise((resolve, reject) => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject("Canvas not supported");

          const roomImg = new Image();
          const productImg = new Image();
          roomImg.crossOrigin = "anonymous";
          productImg.crossOrigin = "anonymous";

          roomImg.onload = () => {
            canvas.width = roomImg.width;
            canvas.height = roomImg.height;
            ctx.drawImage(roomImg, 0, 0);

            productImg.onload = () => {
              const refWidth = canvas.width * 0.3;
              const refHeight = (productImg.height / productImg.width) * refWidth;
              ctx.fillStyle = "white";
              ctx.fillRect(canvas.width - refWidth - 40, canvas.height - refHeight - 40, refWidth + 40, refHeight + 40);
              ctx.drawImage(productImg, canvas.width - refWidth - 20, canvas.height - refHeight - 20, refWidth, refHeight);
              resolve(canvas.toDataURL(mimeType));
            };
            productImg.src = productUrl;
          };
          roomImg.src = roomBase64;
        });
      };

      const compositeDataUrl = await createCompositeImage(base64Image || "", productImageBase64);

      // Step 2: Convert the composite data URL to a Blob and upload it directly to
      // Supabase Storage. This keeps large binary data off the API gateway (offloading pattern).
      setMessage("Uploading to storage...");
      setProgress(20);

      const base64Only = compositeDataUrl.split(',')[1];
      const binaryStr = atob(base64Only);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });

      const imageKey = `composites/${generationId}.jpg`;
      const { error: uploadError } = await getSupabase().storage
        .from('visual-commerce')
        .upload(imageKey, blob, { contentType: mimeType, upsert: true });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      // Step 3: Tell the API gateway to enqueue a BullMQ job.
      // The gateway will pick this up, call Google AI with the composite image,
      // and push real-time progress events back via Socket.IO.
      setStatus("processing");
      setMessage("Queuing generation job...");
      setProgress(25);

      const response = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId,
          imageKey,
          socketId,
          productData: { name: "product", description: "the exact product shown in the reference image" }
        })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Failed to enqueue generation job");

      // Register this generation as active so the socket 'connect' handler
      // can emit 'rejoin' if the connection drops and re-establishes.
      activeGenerationIdRef.current = generationId;

      // Primary delivery: Socket.IO events from the BullMQ worker.
      // Fallback: poll Supabase every 3 seconds in case the Cloud Run container
      // scaled to zero and restarted mid-job, causing the Socket.IO connection
      // to reconnect with a new socket ID (making the old ID in the job stale).
      const maxWaitMs = 120_000;
      const started = Date.now();
      pollIntervalRef.current = setInterval(async () => {
        const pollInterval = pollIntervalRef.current;
        if (Date.now() - started > maxWaitMs) {
          if (pollInterval) clearInterval(pollInterval);
          setStatus("error");
          setErrorMsg("Generation timed out. Please try again.");
          return;
        }
        const { data: row } = await getSupabase()
          .from('generations')
          .select('status, generated_image_url')
          .eq('id', generationId)
          .single() as { data: { status: string; generated_image_url: string | null } | null; error: unknown };

        if (row?.status === 'completed' && row.generated_image_url) {
          if (pollInterval) clearInterval(pollInterval);
          // Only update state if Socket.IO hasn't already delivered the result
          setResultUrl(prev => prev || row.generated_image_url);
          setStatus(prev => prev === 'completed' ? prev : 'completed');
          setProgress(100);
        } else if (row?.status === 'failed') {
          if (pollInterval) clearInterval(pollInterval);
          setStatus(prev => prev === 'error' ? prev : 'error');
          setErrorMsg("Generation failed. Please try again.");
        }
      }, 3000);

    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setErrorMsg(err.message || "Failed to start generation. Please try again.");
    }
  };

  const resetFlow = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    activeGenerationIdRef.current = null;
    setStatus("idle");
    setProductImageBase64(null);
    setResultUrl("");
  };

  return (
    <main className="min-h-screen relative overflow-x-hidden flex flex-col">
      {/* Navigation */}
      <nav className="w-full p-8 md:px-16 flex items-center justify-between z-10 relative">
        <div className="text-[10px] font-bold uppercase tracking-widest border border-[#1a1a1a] px-4 py-2 rounded-full hover:bg-[#1a1a1a] hover:text-[#fdfbf7] cursor-pointer transition-colors">
          Menu
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-3 cursor-pointer group">
          LET'S TALK 
          <div className="w-8 h-8 rounded-full border border-[#1a1a1a] flex items-center justify-center group-hover:bg-[var(--accent)] transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19L19 5M19 5v10M19 5H9" /></svg>
          </div>
        </div>
      </nav>

      {/* Big Hero Text */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10 min-h-[60vh]">
        <div className="w-full max-w-7xl mx-auto flex flex-col items-center justify-center mb-16 md:mb-32 px-4 relative">
          <h1 className="text-[12vw] font-display font-bold leading-[0.8] tracking-[-0.02em] uppercase flex items-center justify-center gap-1 md:gap-3 w-full relative z-10">
            VISIROOM
          </h1>
        </div>

        <div className="w-full flex justify-between text-[10px] font-bold uppercase tracking-widest px-4 md:px-16 opacity-60">
          <span className="hidden md:inline">How it work</span>
          <span>AI Generative</span>
          <span>Visualization</span>
          <span className="hidden md:inline">Contact Us</span>
        </div>
      </div>
      
      {/* Typographic Block matching INSOMIO "ABOUT" slide */}
      <div className="w-full bg-[#fdfbf7] py-24 md:py-48 px-8 border-y border-[#1a1a1a] relative">
        {/* Floating pill badge */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1a1a1a] text-[var(--accent)] text-[10px] font-bold uppercase tracking-widest px-6 py-3 rounded-full shadow-[0_8px_0_var(--accent)] -rotate-6 z-20">
          VISIROOM
        </div>

        <div className="max-w-6xl mx-auto text-center relative flex flex-col items-center">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-12 border border-[#1a1a1a] px-4 py-2 rounded-full inline-block">
            About Product
          </p>
          
          <h2 className="text-4xl md:text-[6rem] font-display font-bold uppercase tracking-tighter leading-[0.85] text-[#1a1a1a]">
            ANY PRODUCT. <br/>
            ANY ROOM. SEE <br/>
            EXACTLY HOW IT <br/>
            LOOKS BEFORE <br/>
            YOU EVER BUY IT
            <div className="inline-block w-[1.5em] h-[0.6em] bg-[var(--accent)] border-[0.05em] border-[#1a1a1a] rounded-[1em] ml-4 -rotate-[15deg] translate-y-2 relative shadow-[-8px_8px_0px_#1a1a1a]"></div>
          </h2>

          <p className="mt-24 text-[10px] uppercase tracking-widest font-bold max-w-sm mx-auto leading-relaxed">
            AI Generative engine that helps you promote your interior products or services online
          </p>
        </div>
      </div>

      {/* How It Works Section */}
      <div className="w-full bg-[#ffffff] border-b border-[#1a1a1a]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row">
          <div className="w-full md:w-1/3 p-12 md:p-24 border-b md:border-b-0 md:border-r border-[#1a1a1a] flex flex-col items-center text-center justify-center relative group transition-colors hover:bg-[#fdfbf7]">
            <div className="text-[8rem] md:text-[12rem] font-display font-bold text-[#fdfbf7] absolute top-0 left-4 pointer-events-none group-hover:text-accent transition-colors leading-[0.8]" style={{ WebkitTextStroke: "2px #e5e5e5", paintOrder: "stroke fill" }}>1</div>
            <div className="w-24 h-24 rounded-full border border-[#1a1a1a] flex items-center justify-center mb-8 relative z-10 bg-[#fdfbf7] shadow-[8px_8px_0_#1a1a1a] group-hover:-translate-y-2 transition-transform">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <h3 className="text-3xl font-display font-bold uppercase tracking-tighter mb-4 relative z-10">Pick Any<br/>Product</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 leading-relaxed max-w-[200px] relative z-10">Upload any item — furniture, decor, lighting. Anything you want to see in your space.</p>
          </div>
          
          <div className="w-full md:w-1/3 p-12 md:p-24 border-b md:border-b-0 md:border-r border-[#1a1a1a] flex flex-col items-center text-center justify-center relative group transition-colors hover:bg-[#fdfbf7]">
            <div className="text-[8rem] md:text-[12rem] font-display font-bold text-[#fdfbf7] absolute top-0 left-4 pointer-events-none group-hover:text-accent transition-colors leading-[0.8]" style={{ WebkitTextStroke: "2px #e5e5e5", paintOrder: "stroke fill" }}>2</div>
            <div className="w-24 h-24 rounded-full border border-[#1a1a1a] flex items-center justify-center mb-8 relative z-10 bg-[#fdfbf7] shadow-[8px_8px_0_#1a1a1a] group-hover:-translate-y-2 transition-transform">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <h3 className="text-3xl font-display font-bold uppercase tracking-tighter mb-4 relative z-10">Show Your<br/>Space</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 leading-relaxed max-w-[200px] relative z-10">Snap a photo of any room — bedroom, living room, office. Anywhere you can imagine it.</p>
          </div>

          <div className="w-full md:w-1/3 p-12 md:p-24 flex flex-col items-center text-center justify-center relative group transition-colors hover:bg-[#fdfbf7]">
            <div className="text-[8rem] md:text-[12rem] font-display font-bold text-[#fdfbf7] absolute top-0 left-4 pointer-events-none group-hover:text-accent transition-colors leading-[0.8]" style={{ WebkitTextStroke: "2px #e5e5e5", paintOrder: "stroke fill" }}>3</div>
            <div className="w-24 h-24 rounded-full border border-[#1a1a1a] flex items-center justify-center mb-8 relative z-10 bg-accent shadow-[8px_8px_0_#1a1a1a] group-hover:-translate-y-2 transition-transform">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <h3 className="text-3xl font-display font-bold uppercase tracking-tighter mb-4 relative z-10">See It<br/>For Real</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 leading-relaxed max-w-[200px] relative z-10">AI places it in your room instantly. Know exactly how it looks before you spend a dollar.</p>
          </div>
        </div>
      </div>

      {/* The Upload Flow section matching the "Business grows faster" slide */}
      <div className="w-full flex flex-col lg:flex-row min-h-[90vh] bg-[#fdfbf7]">
        {/* Left side: Uploaders or Progress */}
        <div className="w-full lg:w-1/2 p-8 md:p-24 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-[#1a1a1a] bg-white relative">
          
          {/* Subtle background graphic matching the hamburger/circles reference */}
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
            <div className="w-[60%] aspect-square border-2 border-[#1a1a1a] rounded-[3rem]"></div>
          </div>

          <div className="w-full max-w-lg relative z-10">
            {status === "idle" && !productImageBase64 && (
              <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="inline-block px-4 py-2 bg-[var(--accent)] border border-[#1a1a1a] rounded-full text-[10px] font-bold uppercase tracking-widest mb-6 shadow-[4px_4px_0_#1a1a1a]">
                  Step 1
                </div>
                <Uploader 
                  apiUrl={API_URL} 
                  onUploadComplete={(_id, _key, base64) => setProductImageBase64(base64 || null)} 
                  label="Product Photo"
                  description="What are we placing?"
                />
              </div>
            )}

            {status === "idle" && productImageBase64 && (
              <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col gap-8">
                
                <div className="w-full bg-[#fdfbf7] border border-[#1a1a1a] rounded-[2rem] p-6 shadow-[8px_8px_0_#1a1a1a] flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <img src={productImageBase64} alt="Target Product" className="w-16 h-16 rounded-xl border border-[#1a1a1a] object-cover" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]">Target Found</span>
                      <span className="text-xl font-display font-bold uppercase tracking-tighter">Ready to blend</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setProductImageBase64(null)}
                    className="w-12 h-12 rounded-full border border-[#1a1a1a] flex items-center justify-center hover:bg-[var(--accent)] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="relative">
                  <div className="inline-block px-4 py-2 bg-[#1a1a1a] text-[var(--accent)] rounded-full text-[10px] font-bold uppercase tracking-widest mb-6 shadow-[4px_4px_0_var(--accent)]">
                    Step 2
                  </div>
                  <Uploader 
                    apiUrl={API_URL} 
                    onUploadComplete={handleUploadComplete} 
                    label="Room Photo"
                    description="Where is it going?"
                  />
                </div>
              </div>
            )}

            {(status === "uploading" || status === "processing") && (
              <div className="animate-in fade-in zoom-in-95 duration-700">
                <Progress progress={progress} message={message} />
              </div>
            )}

            {status === "completed" && (
              <div className="animate-in zoom-in-95 duration-700 flex flex-col gap-8">
                <div className="bg-[#fdfbf7] p-4 rounded-[2rem] border border-[#1a1a1a] shadow-[16px_16px_0px_#1a1a1a]">
                  <div className="w-full aspect-[4/3] rounded-[1.5rem] overflow-hidden border border-[#1a1a1a] bg-white">
                    {resultUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resultUrl} alt="Result" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <button 
                    onClick={resetFlow}
                    className="flex-1 bg-[#1a1a1a] text-[#fdfbf7] font-display font-bold uppercase tracking-widest py-6 rounded-full hover:bg-[var(--accent)] hover:text-[#1a1a1a] transition-colors border border-[#1a1a1a]"
                  >
                    Blend Another
                  </button>
                  {resultUrl && (
                    <a href={resultUrl} download="VisiRoom.jpg" className="w-20 bg-[var(--accent)] flex items-center justify-center rounded-full border border-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] hover:-translate-y-1 hover:shadow-[6px_6px_0_#1a1a1a] transition-all">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="bg-red-50 border border-[#1a1a1a] p-12 rounded-[2rem] text-center shadow-[16px_16px_0_#1a1a1a]">
                <h2 className="text-4xl font-display font-bold uppercase tracking-tighter mb-4">FAILED</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-12 opacity-60 leading-relaxed max-w-xs mx-auto">
                  {errorMsg}
                </p>
                <button 
                  onClick={resetFlow}
                  className="bg-[#1a1a1a] text-[#fdfbf7] font-display font-bold uppercase tracking-widest py-4 px-12 rounded-full hover:bg-[var(--accent)] hover:text-[#1a1a1a] transition-colors"
                >
                  Restart
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Right side: Typography matching "Advantage" slide */}
        <div className="w-full lg:w-1/2 p-8 md:p-24 flex flex-col justify-center">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-12 opacity-60">Advantage</p>
          <h2 className="text-6xl md:text-[8rem] font-display font-bold uppercase tracking-tighter leading-[0.85] text-[#1a1a1a] mb-12">
            DESIGN<br/>
            YOUR<br/>
            ROOM<br/>
            FASTER
          </h2>
          <p className="max-w-[280px] text-[10px] font-bold uppercase tracking-widest leading-relaxed opacity-60 mb-24">
            YOUR INTERIOR VISUALIZATION WILL ACCELERATE BECAUSE OF AN EFFECTIVE GENERATIVE AI STRATEGY.
          </p>
          
          <div className="flex gap-4">
            <button className="w-16 h-16 rounded-full border border-[#1a1a1a] flex items-center justify-center hover:bg-[var(--accent)] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>
            <button className="w-16 h-16 rounded-full border border-[#1a1a1a] flex items-center justify-center hover:bg-[var(--accent)] transition-colors shadow-[4px_4px_0_#1a1a1a]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* Dark footer area matching image 4 */}
      <footer className="w-full bg-[#1a1a1a] text-[#fdfbf7] py-24 md:py-32 px-8 md:px-16 flex flex-col justify-between min-h-[60vh]">
        <div className="flex flex-col md:flex-row justify-between items-start gap-16 md:gap-0">
          <p className="text-[10px] font-bold uppercase tracking-widest max-w-[280px] leading-relaxed opacity-60">
            VISUAL COMMERCE APPS THAT HELP YOU PROMOTE YOUR PRODUCTS OR SERVICES ONLINE
          </p>
          <div className="flex gap-12 text-[10px] font-bold uppercase tracking-widest">
            <a href="#" className="hover:text-[var(--accent)] transition-colors">About</a>
            <a href="#" className="hover:text-[var(--accent)] transition-colors">Service</a>
            <a href="#" className="hover:text-[var(--accent)] transition-colors">Article</a>
            <a href="#" className="hover:text-[var(--accent)] transition-colors">Contact</a>
          </div>
        </div>

        <div className="w-full flex items-center justify-center my-24 md:my-auto">
          <h2 className="text-[15vw] font-display font-bold leading-[0.8] tracking-[-0.02em] uppercase flex items-center gap-1 md:gap-2">
            VISIROOM
          </h2>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-12 md:gap-0 text-[10px] font-bold uppercase tracking-widest opacity-60">
          <p>© 2026 – COPYRIGHT<br/>ALL RIGHTS RESERVED</p>
          <div className="flex flex-col md:flex-row gap-12 md:gap-32">
            <div className="flex flex-col gap-2">
              <span className="text-[#fdfbf7] opacity-100">CONTACT US</span>
              <a href="#" className="hover:text-[var(--accent)] transition-colors">HELLO@VISIROOM.AI</a>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[#fdfbf7] opacity-100">LOCATION</span>
              <span>SAN FRANCISCO, CA<br/>SILICON VALLEY</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}