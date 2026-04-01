/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, Loader2, Key, Download, Camera, Trash2, X } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- IndexedDB Helper Functions ---
const DB_NAME = 'SharonCoDB';
const STORE_NAME = 'portraits';

interface SavedPortrait {
  id?: number;
  dataUrl: string;
  timestamp: number;
}

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
};

const saveImageToDB = async (dataUrl: string): Promise<number> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add({ dataUrl, timestamp: Date.now() });
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
};

const getImagesFromDB = async (): Promise<SavedPortrait[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result as SavedPortrait[];
      resolve(results.sort((a, b) => b.timestamp - a.timestamp));
    };
    request.onerror = () => reject(request.error);
  });
};

const clearImagesFromDB = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
// ----------------------------------

const SelectField = ({ label, value, onChange, options }: { label: string, value: string, onChange: (v: string) => void, options: string[] }) => (
  <div className="space-y-2">
    <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</label>
    <select 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent border-b border-gray-300 text-gray-900 text-sm py-2 outline-none focus:border-black transition-colors font-medium rounded-none cursor-pointer"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

const TextareaField = ({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (v: string) => void, placeholder: string }) => (
  <div className="space-y-2">
    <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</label>
    <textarea 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full bg-transparent border-b border-gray-300 text-gray-900 text-sm py-2 outline-none focus:border-black transition-colors font-medium rounded-none resize-none placeholder:text-gray-300"
    />
  </div>
);

export default function App() {
  const [hasKey, setHasKey] = useState(false);
  const [isCheckingKey, setIsCheckingKey] = useState(true);
  
  const [referenceImages, setReferenceImages] = useState<{data: string, mimeType: string}[]>([]);
  const [lightboxImage, setLightboxImage] = useState<SavedPortrait | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedPortraits, setSavedPortraits] = useState<SavedPortrait[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [framing, setFraming] = useState('Half Body');
  const [pose, setPose] = useState('Seated, leaning forward relaxed');
  const [attire, setAttire] = useState('Power Suit');
  const [attireColor, setAttireColor] = useState('Navy Blue');
  const [background, setBackground] = useState('Bright Modern Interior (Blurred)');
  const [expression, setExpression] = useState('Same expression as reference photo');
  const [platform, setPlatform] = useState('LinkedIn');
  const [customPrompt, setCustomPrompt] = useState('');

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
      setIsCheckingKey(false);
    };
    checkKey();
    
    // Load saved portraits on mount
    getImagesFromDB().then(setSavedPortraits).catch(console.error);

    // Paste handler
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64String = reader.result as string;
              setReferenceImages(prev => {
                if (prev.length >= 2) return prev;
                return [...prev, { data: base64String.split(',')[1], mimeType: file.type }];
              });
            };
            reader.readAsDataURL(file);
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setReferenceImages(prev => {
          if (prev.length >= 2) return prev;
          return [...prev, { data: base64String.split(',')[1], mimeType: file.type }];
        });
      };
      reader.readAsDataURL(file);
    });
    // Reset input so the same file can be selected again if removed
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearGallery = async () => {
    if (window.confirm('Are you sure you want to delete all saved portraits?')) {
      await clearImagesFromDB();
      setSavedPortraits([]);
    }
  };

  const generateHeadshots = async () => {
    if (referenceImages.length === 0) return;
    setIsGenerating(true);
    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      const basePrompt = `Create a premium, high-end professional portrait photography of the person in the reference image(s). 
Framing: ${framing}. 
Pose: ${pose}. 
Attire: ${attireColor !== 'No specific color' ? attireColor + ' ' : ''}${attire}. 
Background: ${background}. 
Expression: ${expression}. 
Intended Platform/Vibe: ${platform}. 
${customPrompt ? `Additional details: ${customPrompt}. ` : ''}
Style: Vanity Fair editorial style, modern luxury photobooth, high quality, 8k resolution, photorealistic, professional studio lighting, sharp focus. Maintain the exact facial features and identity of the person in the reference image(s).`;

      const imageParts = referenceImages.map(img => ({
        inlineData: {
          data: img.data,
          mimeType: img.mimeType,
        }
      }));

      // Generate 4 images in parallel
      const promises = Array.from({ length: 4 }).map(async (_, i) => {
        const variationPrompt = `${basePrompt} Variation ${i + 1}.`;
        
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: {
            parts: [
              ...imageParts,
              {
                text: variationPrompt,
              },
            ],
          },
          config: {
            imageConfig: {
              aspectRatio: "3:4", // Better aspect ratio for portraits
              imageSize: "1K"
            }
          }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            const dataUrl = `data:image/png;base64,${part.inlineData.data}`;
            await saveImageToDB(dataUrl); // Save to IndexedDB immediately
            return dataUrl;
          }
        }
        throw new Error("No image generated");
      });

      await Promise.all(promises);
      
      // Refresh gallery from DB
      const updatedPortraits = await getImagesFromDB();
      setSavedPortraits(updatedPortraits);
      
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || "";
      if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("API key not valid") || errorMessage.includes("API_KEY_INVALID")) {
        setHasKey(false);
        setError("API Key error. Please select a valid API key from a paid Google Cloud project.");
        if (window.aistudio?.openSelectKey) {
          await window.aistudio.openSelectKey();
          setHasKey(true);
        }
      } else {
        setError(errorMessage || "Failed to generate images");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (isCheckingKey) {
    return <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-black" /></div>;
  }

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center p-4 font-sans text-[#1A1A1A]">
        <div className="max-w-md w-full bg-white p-10 text-center border border-[#1A1A1A]/10 shadow-2xl">
          <div className="w-16 h-16 border border-black rounded-full flex items-center justify-center mx-auto mb-8">
            <Key className="w-6 h-6 text-black" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-serif mb-4">Studio Access</h1>
          <p className="text-gray-500 mb-10 text-sm leading-relaxed">
            To generate high-quality editorial portraits, please connect your Gemini API key from a paid Google Cloud project.
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full bg-black hover:bg-gray-800 text-white text-xs uppercase tracking-[0.2em] font-medium py-4 transition-colors"
          >
            Authenticate
          </button>
          <p className="mt-6 text-xs text-gray-400">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-gray-800 transition-colors">
              Learn more about billing
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F8F6] font-sans text-[#1A1A1A] selection:bg-black selection:text-white pb-20">
      {/* Header */}
      <header className="px-8 py-6 flex items-center justify-between border-b border-black/5 bg-white/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="font-serif text-2xl tracking-wide">Sharon & Co.</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-semibold hidden sm:block">
          Premium AI Portraits
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-4 space-y-12">
            
            <section>
              <h2 className="font-serif text-3xl mb-6 italic font-light">The Subject</h2>
              
              {/* Upload Area */}
              <div className="border border-black/20 bg-white p-8 text-center hover:border-black transition-colors relative group">
                {referenceImages.length < 2 && (
                  <input 
                    type="file" 
                    accept="image/*" 
                    multiple
                    onChange={handleImageUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                )}
                {referenceImages.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex justify-center gap-4">
                      {referenceImages.map((img, idx) => (
                        <div key={idx} className="relative w-24 h-24 sm:w-32 sm:h-32">
                          <img src={`data:${img.mimeType};base64,${img.data}`} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover rounded-full border-2 border-white shadow-lg" />
                          <button 
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeImage(idx); }}
                            className="absolute top-0 right-0 bg-red-500 text-white p-1.5 rounded-full hover:bg-red-600 z-20 shadow-md"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {referenceImages.length < 2 && (
                      <p className="text-[11px] uppercase tracking-widest text-gray-500 font-medium">Upload or paste another photo (Max 2)</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    <div className="w-12 h-12 border border-black/20 rounded-full flex items-center justify-center mx-auto group-hover:bg-black group-hover:text-white transition-colors">
                      <ImageIcon className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Upload or Paste Reference Photo(s)</p>
                      <p className="text-xs text-gray-400 mt-2">High-resolution PNG or JPG (Max 2)</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-serif text-3xl mb-6 italic font-light">Art Direction</h2>
              
              <div className="space-y-8 bg-white p-8 border border-black/10">
                <SelectField 
                  label="Framing" 
                  value={framing} 
                  onChange={setFraming} 
                  options={['Headshot', 'Shoulders', 'Half Body', '3/4 Length', 'Full Body']} 
                />
                <SelectField 
                  label="Pose" 
                  value={pose} 
                  onChange={setPose} 
                  options={[
                    'Standing confidently', 
                    'Sitting elegantly', 
                    'Seated, leaning forward relaxed', 
                    'Arms crossed', 
                    'Hands in pockets',
                    'Candid/Dynamic', 
                    'Looking off-camera',
                    'Power stance'
                  ]} 
                />
                <SelectField 
                  label="Attire Color" 
                  value={attireColor} 
                  onChange={setAttireColor} 
                  options={[
                    'Black', 'White', 'Navy Blue', 'Charcoal Grey', 'Light Grey', 
                    'Beige/Camel', 'Burgundy', 'Emerald Green', 'Pastel Pink', 
                    'Bold Red', 'Earthy Brown', 'Monochrome', 'No specific color'
                  ]} 
                />
                <SelectField 
                  label="Attire" 
                  value={attire} 
                  onChange={setAttire} 
                  options={[
                    'Business Casual (Button-down/Blouse)', 
                    'Formal Suit', 
                    'Power Suit', 
                    'Tailored Blazer',
                    'Smart Casual (Polo/Knitwear)',
                    'Creative Professional (Stylish Layers)',
                    'Tech Startup (T-shirt/Hoodie)',
                    'Classic Tweed/Wool Jacket',
                    'Elegant Evening Wear', 
                    'Minimalist Turtleneck', 
                    'Designer Casual',
                    'Medical/Lab Coat',
                    'Fitness/Athleisure'
                  ]} 
                />
                <SelectField 
                  label="Background" 
                  value={background} 
                  onChange={setBackground} 
                  options={[
                    'Minimalist Studio (Solid Color)', 
                    'Textured Canvas Backdrop', 
                    'Modern Architectural', 
                    'Bright Modern Interior (Blurred)',
                    'Contemporary Office Space',
                    'Executive Boardroom',
                    'Industrial Loft/Brick Wall',
                    'Library/Bookshelves',
                    'Cozy Coffee Shop/Cafe',
                    'Outdoor Urban (Cityscape)',
                    'Nature/Greenery (Park/Garden)',
                    'Soft Bokeh / Blurred',
                    'Gradient Color Wash'
                  ]} 
                />
                <SelectField 
                  label="Expression" 
                  value={expression} 
                  onChange={setExpression} 
                  options={[
                    'Approachable and confident', 
                    'Warm, genuine smile',
                    'Smile (no teeth)',
                    'Smile (with teeth)',
                    'Same expression as reference photo',
                    'Radiant and approachable',
                    'Serious and editorial', 
                    'Thoughtful and poised'
                  ]} 
                />
                <SelectField 
                  label="Platform Direction" 
                  value={platform} 
                  onChange={setPlatform} 
                  options={[
                    'LinkedIn', 
                    'Instagram',
                    'Facebook',
                    'Website',
                    'Press Release',
                    'Internal Company Directory'
                  ]} 
                />

                <TextareaField
                  label="Custom Prompt (Optional)"
                  value={customPrompt}
                  onChange={setCustomPrompt}
                  placeholder="e.g., Wearing a pink top under the white suit, soft natural lighting from the left..."
                />

                <div className="pt-4">
                  <button
                    onClick={generateHeadshots}
                    disabled={referenceImages.length === 0 || isGenerating}
                    className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs uppercase tracking-[0.2em] font-medium py-4 transition-colors flex items-center justify-center gap-3"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Develop Portraits'
                    )}
                  </button>
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-100 text-sm text-red-800">
                    {error}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-3xl italic font-light">The Gallery</h2>
              {savedPortraits.length > 0 && (
                <button 
                  onClick={handleClearGallery}
                  className="text-xs uppercase tracking-widest text-gray-400 hover:text-red-600 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear History
                </button>
              )}
            </div>
            
            <div className="bg-white border border-black/10 p-6 sm:p-10 min-h-[800px]">
              {isGenerating && (
                <div className="mb-12 p-12 border border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-black mx-auto mb-6" strokeWidth={1.5} />
                  <p className="text-black font-serif text-xl italic mb-2">Developing your portraits...</p>
                  <p className="text-xs uppercase tracking-widest text-gray-400">Please wait a moment</p>
                </div>
              )}

              {savedPortraits.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-12">
                  {savedPortraits.map((item, idx) => (
                    <div 
                      key={item.id} 
                      className="group relative bg-white p-3 border border-gray-100 shadow-sm transition-all duration-500 hover:z-50 hover:scale-[1.15] hover:shadow-2xl hover:-translate-y-2"
                    >
                      <div className="overflow-hidden relative bg-gray-100 cursor-pointer" onClick={() => setLightboxImage(item)}>
                        <img 
                          src={item.dataUrl} 
                          alt={`Generated portrait ${item.id}`} 
                          className="w-full aspect-[3/4] object-cover" 
                        />
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                          <a 
                            href={item.dataUrl} 
                            download={`sharon-co-portrait-${item.id}.png`} 
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white text-black px-6 py-3 text-xs uppercase tracking-[0.2em] font-medium flex items-center gap-2 hover:bg-gray-100 transition-colors transform translate-y-4 group-hover:translate-y-0 duration-300"
                          >
                            <Download className="w-4 h-4" />
                            Save Print
                          </a>
                        </div>
                      </div>
                      <div className="pt-4 text-center flex justify-between items-center px-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
                          Print {String(savedPortraits.length - idx).padStart(3, '0')}
                        </p>
                        <p className="text-[9px] text-gray-300">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !isGenerating && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 py-32">
                  <div className="text-center space-y-6 max-w-sm">
                    <div className="w-20 h-20 border border-gray-200 rounded-full flex items-center justify-center mx-auto">
                      <Camera className="w-8 h-8 text-gray-300" strokeWidth={1} />
                    </div>
                    <div className="space-y-2">
                      <p className="font-serif text-2xl text-gray-600 italic">Awaiting Subject</p>
                      <p className="text-sm text-gray-400 leading-relaxed">Upload a reference photo and define your art direction to begin the session.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8 backdrop-blur-sm" 
          onClick={() => setLightboxImage(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors" 
            onClick={() => setLightboxImage(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={lightboxImage.dataUrl} 
            className="max-w-full max-h-full object-contain shadow-2xl" 
            alt="Enlarged portrait" 
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </div>
  );
}
