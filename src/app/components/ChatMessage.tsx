import { motion } from 'motion/react';

interface ChatMessageProps {
  message: string;
  sender: 'user' | 'ai';
  timestamp?: string;
}

export function ChatMessage({ message, sender, timestamp }: ChatMessageProps) {
  const isUser = sender === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div className={`flex gap-3 max-w-2xl ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-gradient-to-br from-purple-400 to-purple-600' 
            : 'bg-gradient-to-br from-blue-100 to-blue-200'
        }`}>
          {isUser ? (
            <span className="text-white text-sm font-semibold">You</span>
          ) : (
            <span className="text-xl">🐨</span>
          )}
        </div>

        {/* Message Bubble */}
    
        <div className="flex flex-col">
          <div
            className={`rounded-2xl px-4 py-3 ${
              isUser
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-800 shadow-sm'
            }`}
          >
            {(() => {
              const blocks = message.replace(/\r\n/g, "\n").split(/\n\s*\n/);

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {blocks.filter(Boolean).map((block, i) => (
                    <div
                      key={i}
                      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}
                    >
                      {block.trim()}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          {timestamp && (
            <span className={`text-xs text-gray-400 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
              {timestamp}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
