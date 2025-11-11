'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import { Message, Conversation, PersonaType } from '@ocsuite/types';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ChatInput } from '@/components/chat/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const personas: { value: PersonaType; label: string; disabled?: boolean }[] = [
  { value: 'ceo', label: 'CEO - Strategic Vision' },
  { value: 'cfo', label: 'CFO - Financial Analysis', disabled: true },
  { value: 'cmo', label: 'CMO - Marketing Strategy', disabled: true },
  { value: 'cto', label: 'CTO - Technical Leadership', disabled: true },
];

export default function ChatPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [selectedPersona, setSelectedPersona] = useState<PersonaType>('ceo');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  // Load or create conversation
  useEffect(() => {
    async function initializeConversation() {
      try {
        const api = createApiClient(getToken);
        const conversations = await api.getConversations();

        // Find existing conversation with selected persona
        let conv = conversations.find(
          (c) => c.personaType === selectedPersona
        );

        // Create new conversation if none exists
        if (!conv) {
          conv = await api.createConversation(selectedPersona);
        }

        setConversation(conv);

        // Load messages
        const msgs = await api.getMessages(conv.id);
        setMessages(msgs);
      } catch (error) {
        console.error('Failed to initialize conversation:', error);
        toast({
          title: 'Error',
          description: 'Failed to load conversation',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    }

    initializeConversation();
  }, [selectedPersona, getToken, toast]);

  const handleSendMessage = async (content: string) => {
    if (!conversation || isSending) return;

    setIsSending(true);
    setStreamingMessage('');

    // Add user message immediately
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      role: 'user',
      content,
      metadata: null,
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const api = createApiClient(getToken);
      let accumulatedContent = '';

      await api.sendMessage(
        conversation.id,
        content,
        (chunk) => {
          accumulatedContent += chunk;
          setStreamingMessage(accumulatedContent);
        },
        (messageId) => {
          // Message complete - add to messages list
          const assistantMessage: Message = {
            id: messageId,
            conversationId: conversation.id,
            tenantId: conversation.tenantId,
            role: 'assistant',
            content: accumulatedContent,
            metadata: null,
            createdAt: new Date(),
          };

          setMessages((prev) => [...prev, assistantMessage]);
          setStreamingMessage('');
          setIsSending(false);
        },
        (error) => {
          console.error('Streaming error:', error);
          toast({
            title: 'Error',
            description: 'Failed to send message',
            variant: 'destructive',
          });
          setIsSending(false);
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive',
      });
      setIsSending(false);
    }
  };

  const handlePersonaChange = (value: PersonaType) => {
    setSelectedPersona(value);
    setMessages([]);
    setConversation(null);
    setIsLoading(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Chat with C-Suite</h1>
          <p className="text-muted-foreground">
            Get strategic insights from your AI board members
          </p>
        </div>
        <Select value={selectedPersona} onValueChange={handlePersonaChange}>
          <SelectTrigger className="w-[250px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {personas.map((persona) => (
              <SelectItem
                key={persona.value}
                value={persona.value}
                disabled={persona.disabled}
              >
                {persona.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Chat Interface */}
      <Card className="h-[calc(100vh-16rem)]">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">
            Conversation with{' '}
            {personas.find((p) => p.value === selectedPersona)?.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex flex-col h-[calc(100%-5rem)]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && !streamingMessage && (
              <div className="text-center text-muted-foreground py-12">
                <p>No messages yet. Start the conversation!</p>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.createdAt}
              />
            ))}

            {streamingMessage && (
              <MessageBubble
                role="assistant"
                content={streamingMessage}
                isStreaming={true}
              />
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-4">
            <ChatInput
              onSend={handleSendMessage}
              disabled={isSending}
              placeholder={`Ask the ${selectedPersona.toUpperCase()} a question...`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
