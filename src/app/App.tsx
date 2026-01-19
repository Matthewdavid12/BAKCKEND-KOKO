import * as React from "react";

import { ChatArea, type Message } from "./components/ChatArea";
import { SidebarInset, SidebarProvider } from "./components/Sidebar"; // same module
import { ChatSidebar, type Chat } from "./components/Chatsidebar";

function makeId() {
  return Math.random().toString(36).slice(2);
}


export default function App() {
  const [chats, setChats] = React.useState<Chat[]>([
       { id: "welcome", title: "Welcome to Koko", updatedAt: Date.now(), messages: [] },
  ]);

  const [activeChatId, setActiveChatId] = React.useState<string>("welcome");

  const onNewChat = () => {
    const id = makeId();
    const now = Date.now();

  const newChat: Chat = { id, title: "New chat", updatedAt: now, messages: [] };

    setChats((prev) => {
      // Prevent duplicate insert if updater runs twice in dev
      if (prev.some((c) => c.id === id)) return prev;
      return [newChat, ...prev];
    });

    setActiveChatId(id);
  };

  const createChatTitle = (text: string) => {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (cleaned.length <= 40) return cleaned;
    return `${cleaned.slice(0, 40)}…`;
  };

  const updateChatMessages = React.useCallback(
    (chatId: string, updater: React.SetStateAction<Message[]>) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;
          const nextMessages =
            typeof updater === "function"
              ? (updater as (prev: Message[]) => Message[])(chat.messages)
              : updater;
          return { ...chat, messages: nextMessages };
        })
      );
    },
    []
  );

  const handleUserMessage = React.useCallback(
    (chatId: string, text: string) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;
          const hasUserMessage = chat.messages.some((msg) => msg.sender === "user");
          const nextTitle =
            !hasUserMessage && ["Welcome to Koko", "New chat"].includes(chat.title)
              ? createChatTitle(text)
              : chat.title;
          return { ...chat, title: nextTitle, updatedAt: Date.now() };
        })
      );
    },
    []
  );

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const activeMessages = activeChat?.messages ?? [];

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-svh w-full bg-white">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          onNewChat={onNewChat}
          onSelectChat={setActiveChatId}
          onClear={() => {
              setChats([
              { id: "welcome", title: "Welcome to Koko", updatedAt: Date.now(), messages: [] },
            ]);
            setActiveChatId("welcome");
          }}
          onLogout={() => alert("Logout clicked")}
        />

        <SidebarInset className="bg-white">
          <ChatArea
            activeChatId={activeChatId}
            messages={activeMessages}
            onUpdateChatMessages={updateChatMessages}
            onUserMessage={handleUserMessage}
          />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

