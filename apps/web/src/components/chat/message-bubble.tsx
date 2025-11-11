import { cn } from '@/lib/utils';
import { MessageRole } from '@ocsuite/types';
import { Bot, User } from 'lucide-react';

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
}

export function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-3 mb-4', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary' : 'bg-muted'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-foreground" />
        )}
      </div>

      {/* Message content */}
      <div className={cn('flex flex-col gap-1', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-lg px-4 py-2 max-w-[80%] break-words',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
          )}
        </div>
        {timestamp && (
          <span className="text-xs text-muted-foreground px-1">
            {new Date(timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
