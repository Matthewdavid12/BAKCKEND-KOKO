import { Paperclip, Send, Sparkles } from 'lucide-react';
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import kokoImage from "../../assets/koala_thinking.png"
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  message: string;
  sender: "user" | "ai";
  timestamp: string;
};

export function ChatMessage({ message, sender, timestamp }: Props) {
  const isAI = sender === "ai";

  // ✅ This MUST be inside the component (before return)
  const spaced = message
    .replace(/---\s*/g, "\n\n---\n\n")
    .replace(/###\s*/g, "\n\n### ")
    .replace(/\n{3,}/g, "\n\n");

  return (
    <div className={`flex gap-3 mb-4 ${isAI ? "" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm border ${
          isAI
            ? "bg-white border-gray-200 text-gray-900"
            : "bg-blue-500 border-blue-500 text-white"
        }`}
      >
        <div
          className={`prose prose-sm max-w-none leading-relaxed ${
            isAI ? "prose-gray" : "prose-invert"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {spaced}
          </ReactMarkdown>
        </div>

        <div className={`mt-2 text-xs ${isAI ? "text-gray-400" : "text-blue-100"}`}>
          {timestamp}
        </div>
      </div>
    </div>
  );
}


const resolveApiBase = () => {
  const rawBase = import.meta.env.VITE_API_BASE;
  if (rawBase && rawBase.trim().length > 0) {
    return rawBase.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:5000";
  }
  return "";
};

async function streamToFlask(message: string, onDelta: (t: string) => void) {
  const apiBase = resolveApiBase();
  const res = await fetch(`${apiBase}/chat_stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || "Flask error");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No stream reader");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank line
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      // each message has lines like: data: {...}
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const jsonStr = line.replace(/^data:\s*/, "").trim();
        if (!jsonStr) continue;

        const payload = JSON.parse(jsonStr);
        if (payload.delta) onDelta(payload.delta);
        if (payload.done) return;
      }
    }
  }
}

const suggestedPrompts = [
  'Summarize',
  'Key numbers',
  'Next steps',
  'Risks'
];

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
}

interface MemoryEntry {
  text: string;
  created_at: string;
}


export function ChatArea() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [memoryNote, setMemoryNote] = useState('');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<'idle' | 'saving' | 'loading'>('loading');

const handleSendMessage = async () => {
  if (!message.trim() || isTyping) return;

  const userText = message.trim();

  const userMsg: Message = {
    id: Date.now().toString(),
    text: userText,
    sender: "user",
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };

  const aiId = (Date.now() + 1).toString();

  const aiMsg: Message = {
    id: aiId,
    text: "",
    sender: "ai",
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };

  // add user + empty ai message
  setMessages((prev) => [...prev, userMsg, aiMsg]);
  setMessage("");
  setIsTyping(true);

  try {
    await streamToFlask(userText, (delta) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === aiId ? { ...m, text: m.text + delta } : m))
      );
    });
  } catch (err: any) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === aiId ? { ...m, text: `[Server error] ${err?.message ?? err}` } : m
      )
    );
  } finally {
    setIsTyping(false);
  }
};

  const loadMemories = async () => {
    setMemoryStatus('loading');
    try {
      const apiBase = resolveApiBase();
      const response = await fetch(`${apiBase}/memories`, { method: "GET" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load memories.');
      }
      setMemories(Array.isArray(payload?.memories) ? payload.memories : []);
    } catch (err) {
      setMemories([]);
    } finally {
      setMemoryStatus('idle');
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const handleSaveMemory = async () => {
    if (!memoryNote.trim() || memoryStatus === 'saving') return;
    setMemoryStatus('saving');
    try {
      const apiBase = resolveApiBase();
      const response = await fetch(`${apiBase}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: memoryNote.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save memory.');
      }
      if (payload?.memory) {
        setMemories((prev) => [...prev, payload.memory]);
      } else {
        await loadMemories();
      }
      setMemoryNote('');
    } catch (err) {
      // keep silent for now
    } finally {
      setMemoryStatus('idle');
    }
  };

  const handleClearMemories = async () => {
    if (memoryStatus === 'saving') return;
    setMemoryStatus('saving');
    try {
      const apiBase = resolveApiBase();
      const response = await fetch(`${apiBase}/memories`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to clear memories.');
      }
      setMemories([]);
    } catch (err) {
      // keep silent for now
    } finally {
      setMemoryStatus('idle');
    }
  };




  const handleUploadDocument = async (file: File) => {
    if (!file || isUploading) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      text: `Uploaded document: ${file.name}`,
      sender: "user",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const aiId = (Date.now() + 1).toString();
    const aiMsg: Message = {
      id: aiId,
      text: "",
      sender: "ai",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const apiBase = resolveApiBase();
      const response = await fetch(`${apiBase}/upload_doc`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Upload failed.");
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiId
            ? { ...msg, text: payload?.message || "Document uploaded. Ask me anything about it!" }
            : msg
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiId
            ? { ...msg, text: `[Upload error] ${err?.message ?? err}` }
            : msg
        )
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleUploadDocument(file);
    }
  };


  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center">
            <span className="text-xl">🐨</span>
          </div>
          <div className="flex-1">
            <h1 className="font-semibold text-gray-800 text-lg">Koko</h1>
          </div>
          {isTyping && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-blue-500 flex items-center gap-1"
            >
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              Typing...
            </motion.span>
          )}
        </div>
      </div>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center max-w-md"
            >
              <div className="relative inline-block mb-8">
                {/* Decorative question marks */}
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-6 -right-4 text-4xl text-blue-400"
                >
                  ?
                </motion.div>
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                  className="absolute -top-2 right-8 text-3xl text-blue-300"
                >
                  ?
                </motion.div>
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                  className="absolute top-4 -right-6 text-2xl text-blue-200"
                >
                  ?
                </motion.div>
                
                {/* Koko character */}
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-200/40 to-purple-200/40 rounded-full blur-3xl scale-150"></div>
                  <motion.img
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", stiffness: 300 }}
                    src={kokoImage} 
                    alt="Koko AI Character" 
                    className="relative w-64 h-64 object-contain drop-shadow-2xl"
                  />
                </div>
              </div>
              
              <div className="space-y-2 mb-6">
                <div className="flex items-center justify-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-500" />
                  <h2 className="text-2xl font-semibold text-gray-800">How can I help you today?</h2>
                </div>
                <p className="text-gray-500">Ask me anything or choose a suggestion below</p>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <AnimatePresence>
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg.text}
                  sender={msg.sender}
                  timestamp={msg.timestamp}
                />
              ))}
            </AnimatePresence>
            
            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3 mb-4"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-xl">🐨</span>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
                      className="w-2 h-2 bg-blue-400 rounded-full"
                    />
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
                      className="w-2 h-2 bg-blue-400 rounded-full"
                    />
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
                      className="w-2 h-2 bg-blue-400 rounded-full"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white p-6">
        <div className="max-w-4xl mx-auto">
                    <div className="mb-4 rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Long-term memory</h3>
                <p className="text-xs text-gray-500">
                  Save notes that Koko can reuse in future chats.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-gray-500 hover:text-red-500"
                onClick={handleClearMemories}
                disabled={memoryStatus === 'saving' || memories.length === 0}
              >
                Clear all
              </Button>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={memoryNote}
                onChange={(e) => setMemoryNote(e.target.value)}
                placeholder="Add something Koko should remember..."
                className="h-11 rounded-xl border-gray-300"
              />
              <Button
                onClick={handleSaveMemory}
                className="h-11 rounded-xl bg-blue-500 hover:bg-blue-600 text-white"
                disabled={memoryStatus === 'saving' || memoryNote.trim().length === 0}
              >
                Save memory
              </Button>
            </div>

          </div>

          {/* Message Input */}
          <div className="flex items-center gap-3 mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button 
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              aria-label="Upload document"
              className="h-12 w-12 rounded-xl border-gray-300 text-gray-600 hover:text-blue-600 hover:border-blue-300"
            >
            <Paperclip className="w-5 h-5" />
            </Button>
            <div className="relative flex-1">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Message Koko... (Enter to send, Shift+Enter for new line)"
                className="pr-12 h-14 text-base border-gray-300 shadow-sm focus:ring-2 focus:ring-blue-500/20 rounded-xl"
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Suggested Prompts */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500">Suggestions:</span>
            {suggestedPrompts.map((prompt, index) => (
              <motion.div
                key={index}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 rounded-full px-4 transition-all duration-200 hover:shadow-md"
                  onClick={() => setMessage(prompt)}
                >
                  {prompt}
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>

    
  );
}