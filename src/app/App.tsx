import { Sidebar } from '@/app/components/Sidebar';
import { ChatArea } from '@/app/components/ChatArea';

export default function App() {
  return (
    <div className="size-full flex overflow-hidden">
      <Sidebar />
      <ChatArea />
    </div>
  );
}
