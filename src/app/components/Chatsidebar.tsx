"use client";

import * as React from "react";
import { Plus, Search, MessageSquare, Trash2, LogOut } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "./Sidebar"; // IMPORTANT: because your Sidebar system is currently in components/Sidebar.tsx

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "./ui/utils";

export type Chat = {
  id: string;
  title: string;
  pinned?: boolean;
  bookmarked?: boolean;
  updatedAt: number;
    messages: {
    id: string;
    text: string;
    sender: "user" | "ai";
    timestamp: string;
  }[];
};

type Props = {
  chats: Chat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onClear: () => void;
  onLogout: () => void;
};

export function ChatSidebar({
  chats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onClear,
  onLogout,
}: Props) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, query]);

  const chatList = filtered.filter((c) => !c.pinned && !c.bookmarked);
  const pinnedList = filtered.filter((c) => c.pinned);
  const bookmarkedList = filtered.filter((c) => c.bookmarked);



  

  return (
    <Sidebar className="min-h-svh !bg-gradient-to-b !from-blue-50 !to-blue-200/70">
      <SidebarHeader className="p-4 pb-3 !bg-transparent">
        <div className="p-4 border-b border-blue-200/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-200 rounded-lg flex items-center justify-center">
            <span className="text-3xl">🐨</span>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-semibold">Koko AI</div>
            <div className="text-xs text-muted-foreground">
              Helpful assistant for HCP
            </div>
            <div className="text-xs text-muted-foreground">Listening</div>
          </div>
        </div>
        </div>



        <div className="mt-3">
          <Button
            variant="secondary"
            className="w-full bg-white hover:bg-blue-50 text-blue-600 border border-blue-200 shadow-sm"
            onClick={onNewChat}
          >
            <Plus className="size-4" />
            New Chat
          </Button>
        </div>

        <div className="mt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats..."
              className="pl-9 rounded-xl bg-white/70"
            />
          </div>
        </div>

        <div className="mt-3">
          <Button
            variant="secondary"
            className="h-8 rounded-xl bg-blue-200/70 hover:bg-blue-200 px-3"
            onClick={() => setQuery("")}
          >
            All
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 pb-2 !bg-transparent">
        {/* CHATS */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs tracking-wide">
            CHATS
          </SidebarGroupLabel>

          <SidebarMenu>
            {chatList.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  New chat
                </div>
              </div>
            ) : (
              chatList
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={activeChatId === c.id}
                      onClick={() => onSelectChat(c.id)}
                    >
                      <MessageSquare className="size-4" />
                      <span className="truncate">{c.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/* PINNED */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs tracking-wide">
            PINNED
          </SidebarGroupLabel>

          {pinnedList.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">
              No pinned chats
            </div>
          ) : (
            <SidebarMenu>
              {pinnedList
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={activeChatId === c.id}
                      onClick={() => onSelectChat(c.id)}
                    >
                      <span className="truncate">{c.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          )}
        </SidebarGroup>

        {/* BOOKMARKS */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs tracking-wide">
            BOOKMARKS
          </SidebarGroupLabel>

          {bookmarkedList.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">
              No bookmarks
            </div>
          ) : (
            <SidebarMenu>
              {bookmarkedList
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={activeChatId === c.id}
                      onClick={() => onSelectChat(c.id)}
                    >
                      <span className="truncate">{c.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 !bg-transparent">
        <SidebarSeparator className="my-2" />
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            className={cn("justify-start gap-2")}
            onClick={onClear}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>

          <Button
            variant="ghost"
            className={cn("justify-start gap-2")}
            onClick={onLogout}
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
