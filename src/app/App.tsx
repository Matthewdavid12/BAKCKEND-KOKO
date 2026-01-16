import * as React from "react";

import { ChatArea } from "./components/ChatArea";
import { SidebarInset, SidebarProvider } from "./components/Sidebar"; // same module
import { ChatSidebar, type Chat } from "./components/Chatsidebar";

function makeId() {
  return Math.random().toString(36).slice(2);
}


export default function App() {
  const [chats, setChats] = React.useState<Chat[]>([
    { id: "welcome", title: "Welcome to Koko", updatedAt: Date.now() },
  ]);

  const [activeChatId, setActiveChatId] = React.useState<string>("welcome");

const onNewChat = () => {
  const id = makeId();
  const now = Date.now();

  const newChat: Chat = { id, title: "New chat", updatedAt: now };

  setChats((prev) => {
    // Prevent duplicate insert if updater runs twice in dev
    if (prev.some((c) => c.id === id)) return prev;
    return [newChat, ...prev];
  });

  setActiveChatId(id);
};

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-svh w-full bg-white">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          onNewChat={onNewChat}
          onSelectChat={setActiveChatId}
          onClear={() => {
            setChats([{ id: "welcome", title: "Welcome to Koko", updatedAt: Date.now() }]);
            setActiveChatId("welcome");
          }}
          onLogout={() => alert("Logout clicked")}
        />

        <SidebarInset className="bg-white">
          <ChatArea />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

